"""Milestone 1 Patient Records Foundation & Workspace API integration tests (T1.5).

Guarantees:
- Atomic visit_code (VIS-YY-NNNNNN) and encounter_code (ENC-YY-NNNNNN) allocation, DB BEFORE INSERT
  fallback triggers on direct ORM inserts, and finalised encounter tamper lock on encounter_code
  and visit_id (verified via owner_engine inside a rolled-back transaction).
- clinical_encounters.visit_id propagation from visit-linked appointments, explicit walk-in
  visit_id validation, and NULL preservation for unlinked legacy rows.
- computed_age_years from dob against clock.ist_today() with age_years fallback.
- Structured clinical allergies CRUD: strictly DOCTOR-only (403 for RECEPTION & ADMIN on
  GET/POST/PATCH), DWS-04 cross-doctor read audit, optimistic locking (409), archived/merged
  write block (409) vs read (200), audit trail, and downward alias consolidation.
- VisitDetail.payments includes visit-level payments (visit_id set, appointment_id=None).
- Strict D-04 & AGENTS.md #7 role redaction on GET /api/patients/{id}/summary and /visits:
  - DOCTOR: full active_allergies + allergy_alert + clinical KPIs/encounter links; NULL financials.
  - RECEPTION: safety-only allergy_alert (active_allergies=None, zero reaction/clinical_notes) +
    financial KPIs/totals; NULL clinical KPIs/encounter links.
  - ADMIN: allergy_alert=None, active_allergies=None, NULL clinical KPIs/encounter links;
    financial KPIs/totals populated.
- kalyan_app least-privilege DB role can SELECT/INSERT/UPDATE patient_allergies, visit_sequences,
  and encounter_sequences (and cannot DELETE from patient_allergies).
"""

import re
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy import Engine, select, text
from sqlalchemy.exc import DBAPIError, ProgrammingError
from sqlalchemy.orm import Session

from kalyan_api.models import (
    Appointment,
    AuditLog,
    BillItem,
    BillItemCategory,
    BillItemSource,
    BillItemStatus,
    ClinicalEncounter,
    Doctor,
    EncounterSequence,
    Patient,
    PatientAllergy,
    Payment,
    Prescription,
    PrescriptionItem,
    TreatmentPlan,
    User,
    Visit,
    VisitSequence,
)
from kalyan_api.services.code_sequence_service import (
    allocate_encounter_code,
    allocate_visit_code,
)

VISIT_CODE_RE = re.compile(r"^VIS-\d{2}-\d{6}$")
ENCOUNTER_CODE_RE = re.compile(r"^ENC-\d{2}-\d{6}$")


def _seed_patient(
    db_session: Session,
    *,
    urn: str,
    full_name: str = "Workspace Patient",
    age_years: int = 34,
    dob: date | None = None,
) -> Patient:
    patient = Patient(
        urn=urn,
        full_name=full_name,
        guardian_name="Guardian Name",
        gender="M",
        age_years=age_years,
        dob=dob,
        mobile="9876500001",
        address="Hospital Road, Ara",
        district="Bhojpur",
        state="Bihar",
    )
    db_session.add(patient)
    db_session.flush()
    return patient


def test_visit_and_encounter_codes_atomic_and_db_triggers(
    db_session: Session,
    doctor_a_user: User,
    reception_user: User,
) -> None:
    """Codes are unique VIS/ENC-YY-NNNNNN and DB triggers populate direct ORM inserts."""
    # 1. Atomic sequence allocator produces strictly ascending year-scoped codes
    v1 = allocate_visit_code(db_session, date(2026, 11, 2))
    v2 = allocate_visit_code(db_session, date(2026, 11, 3))
    v_next_yr = allocate_visit_code(db_session, date(2027, 1, 1))
    assert VISIT_CODE_RE.match(v1) and VISIT_CODE_RE.match(v2)
    assert v1 != v2
    assert v1.startswith("VIS-26-") and v2.startswith("VIS-26-")
    assert int(v2.split("-")[-1]) == int(v1.split("-")[-1]) + 1
    assert v_next_yr.startswith("VIS-27-")

    e1 = allocate_encounter_code(db_session, date(2026, 11, 2))
    e2 = allocate_encounter_code(db_session, date(2026, 11, 3))
    e_next_yr = allocate_encounter_code(db_session, date(2027, 1, 1))
    assert ENCOUNTER_CODE_RE.match(e1) and ENCOUNTER_CODE_RE.match(e2)
    assert e1 != e2
    assert e1.startswith("ENC-26-") and e2.startswith("ENC-26-")
    assert int(e2.split("-")[-1]) == int(e1.split("-")[-1]) + 1
    assert e_next_yr.startswith("ENC-27-")

    # 2. Direct ORM insert without codes triggers DB BEFORE INSERT fallback + RETURNING
    patient = _seed_patient(db_session, urn="KH-2026-WS01")
    visit = Visit(
        patient_id=patient.id,
        visit_date=date(2026, 11, 2),
        status="OPEN",
        opened_by_user_id=reception_user.id,
    )
    db_session.add(visit)
    db_session.flush()
    assert visit.visit_code is not None
    assert VISIT_CODE_RE.match(visit.visit_code)
    assert visit.visit_code.startswith("VIS-26-")

    assert doctor_a_user.doctor_id is not None
    encounter = ClinicalEncounter(
        patient_id=patient.id,
        doctor_id=doctor_a_user.doctor_id,
        visit_id=visit.id,
        encounter_date=datetime(2026, 11, 2, 5, 0, tzinfo=UTC),
        symptoms="Knee pain",
        clinical_notes="Mild swelling",
        diagnosis="Sprain",
        created_by_user_id=doctor_a_user.id,
    )
    db_session.add(encounter)
    db_session.flush()
    assert encounter.encounter_code is not None
    assert ENCOUNTER_CODE_RE.match(encounter.encounter_code)
    assert encounter.encounter_code.startswith("ENC-26-")


def test_finalised_encounter_tamper_lock_on_code_and_visit_id(owner_engine: Engine) -> None:
    """DB trigger rejects tampering with encounter_code or visit_id on finalised encounters."""
    with owner_engine.connect() as conn:
        tx = conn.begin()
        try:
            doc_id = conn.scalar(
                text(
                    "INSERT INTO doctors (name_en, default_fee_paise, is_active) "
                    "VALUES ('Dr. Lock Test', 30000, true) RETURNING id"
                )
            )
            user_id = conn.scalar(
                text(
                    "INSERT INTO users (username, full_name, role, doctor_id, password_hash, "
                    "is_active) VALUES ('lock_doc', 'Lock Doc', 'DOCTOR', :did, 'hash', true) "
                    "RETURNING id"
                ),
                {"did": doc_id},
            )
            pat_id = conn.scalar(
                text(
                    "INSERT INTO patients (urn, full_name, guardian_name, gender, age_years, "
                    "mobile, address) VALUES ('KH-2026-LOCK', 'Lock Pat', 'Guard', 'M', 40, "
                    "'9876543211', 'Ara') RETURNING id"
                )
            )
            visit_id_1 = conn.scalar(
                text(
                    "INSERT INTO visits (patient_id, visit_date, status, opened_by_user_id, "
                    "version_id) VALUES (:pid, DATE '2026-11-02', 'OPEN', :uid, 1) RETURNING id"
                ),
                {"pid": pat_id, "uid": user_id},
            )
            visit_id_2 = conn.scalar(
                text(
                    "INSERT INTO visits (patient_id, visit_date, status, opened_by_user_id, "
                    "closed_by_user_id, closed_at, version_id) "
                    "VALUES (:pid, DATE '2026-11-03', 'CLOSED', :uid, :uid, NOW(), 1) "
                    "RETURNING id"
                ),
                {"pid": pat_id, "uid": user_id},
            )
            enc_id = conn.scalar(
                text(
                    "INSERT INTO clinical_encounters (patient_id, doctor_id, visit_id, "
                    "symptoms, clinical_notes, diagnosis, is_finalised, finalised_at, "
                    "created_by_user_id, version_id) VALUES (:pid, :did, :vid, 'S', 'N', 'D', "
                    "true, NOW(), :uid, 1) RETURNING id"
                ),
                {"pid": pat_id, "did": doc_id, "vid": visit_id_1, "uid": user_id},
            )

            # Tampering encounter_code on a finalised encounter must be blocked by trigger
            with conn.begin_nested() as sp1:
                with pytest.raises(DBAPIError):
                    conn.execute(
                        text(
                            "UPDATE clinical_encounters SET encounter_code = 'ENC-99-999999' "
                            "WHERE id = :eid"
                        ),
                        {"eid": enc_id},
                    )
                sp1.rollback()

            # Tampering visit_id on a finalised encounter must be blocked by trigger
            with conn.begin_nested() as sp2:
                with pytest.raises(DBAPIError):
                    conn.execute(
                        text("UPDATE clinical_encounters SET visit_id = :vid2 WHERE id = :eid"),
                        {"vid2": visit_id_2, "eid": enc_id},
                    )
                sp2.rollback()
        finally:
            tx.rollback()


def test_encounter_visit_id_propagation_walkin_and_legacy_null(
    login_client: Any,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Encounter inherits visit_id from appointment, accepts valid walk-in, preserves NULL."""
    rec_c = login_client(reception_user)
    doc_c = login_client(doctor_a_user)
    assert doctor_a_user.doctor_id is not None
    doc = db_session.get(Doctor, doctor_a_user.doctor_id)
    assert doc is not None and doc.departments
    dept_id = doc.departments[0].id

    patient = _seed_patient(db_session, urn="KH-2026-WS02")
    other_patient = _seed_patient(db_session, urn="KH-2026-WS03", full_name="Other Patient")

    # 1. Visit-linked appointment via walk-in check-in -> encounter inherits visit_id
    walkin_resp = rec_c.post(
        "/api/appointments/walk-in",
        json={
            "patient_id": patient.id,
            "doctor_id": doctor_a_user.doctor_id,
            "department_id": dept_id,
            "referral_source": "SELF",
        },
    )
    assert walkin_resp.status_code == 201, walkin_resp.text
    appt_data = walkin_resp.json()
    visit_id = appt_data["visit_id"]
    assert visit_id is not None

    # Conflicting explicit visit_id with appointment_id -> 422 visit_mismatch
    bad_link = doc_c.post(
        "/api/encounters",
        json={
            "patient_id": patient.id,
            "appointment_id": appt_data["id"],
            "visit_id": visit_id + 999,
            "symptoms": "Pain",
            "clinical_notes": "Notes",
            "diagnosis": "Diag",
        },
    )
    assert bad_link.status_code == 422
    assert bad_link.json()["code"] == "visit_mismatch"

    enc_from_appt = doc_c.post(
        "/api/encounters",
        json={
            "patient_id": patient.id,
            "appointment_id": appt_data["id"],
            "symptoms": "Back pain",
            "clinical_notes": "Checked posture",
            "diagnosis": "Lumbar strain",
        },
    )
    assert enc_from_appt.status_code == 201, enc_from_appt.text
    enc_json = enc_from_appt.json()
    assert enc_json["visit_id"] == visit_id
    assert ENCOUNTER_CODE_RE.match(enc_json["encounter_code"])

    # 2. Walk-in encounter (no appointment_id) with valid explicit visit_id
    enc_walkin = doc_c.post(
        "/api/encounters",
        json={
            "patient_id": patient.id,
            "visit_id": visit_id,
            "symptoms": "Follow-up query",
            "clinical_notes": "Reviewed",
            "diagnosis": "Improving",
        },
    )
    assert enc_walkin.status_code == 201, enc_walkin.text
    assert enc_walkin.json()["visit_id"] == visit_id
    assert enc_walkin.json()["appointment_id"] is None

    # Walk-in encounter with another patient's visit_id -> 422 visit_patient_mismatch
    other_visit = Visit(
        patient_id=other_patient.id,
        visit_date=date(2026, 11, 2),
        status="OPEN",
        opened_by_user_id=reception_user.id,
    )
    db_session.add(other_visit)
    db_session.flush()
    mismatch_resp = doc_c.post(
        "/api/encounters",
        json={
            "patient_id": patient.id,
            "visit_id": other_visit.id,
            "symptoms": "Wrong visit",
            "clinical_notes": "Notes",
            "diagnosis": "Diag",
        },
    )
    assert mismatch_resp.status_code == 422
    assert mismatch_resp.json()["code"] == "visit_patient_mismatch"

    # Walk-in encounter with nonexistent visit_id -> 404 visit_not_found
    missing_visit = doc_c.post(
        "/api/encounters",
        json={
            "patient_id": patient.id,
            "visit_id": 9999999,
            "symptoms": "Missing visit",
            "clinical_notes": "Notes",
            "diagnosis": "Diag",
        },
    )
    assert missing_visit.status_code == 404
    assert missing_visit.json()["code"] == "visit_not_found"

    # 3. Unlinked / legacy encounter preserves visit_id = None
    enc_unlinked = doc_c.post(
        "/api/encounters",
        json={
            "patient_id": patient.id,
            "symptoms": "Phone review",
            "clinical_notes": "Unlinked legacy note",
            "diagnosis": "Stable",
        },
    )
    assert enc_unlinked.status_code == 201, enc_unlinked.text
    assert enc_unlinked.json()["visit_id"] is None


def test_computed_age_years_from_dob_and_fallback(
    login_client: Any,
    reception_user: User,
    clock: dict[str, datetime],
) -> None:
    """computed_age_years computes exact IST birthday age from dob or falls back to age_years."""
    # clock fixture freezes UTC to 2026-11-02 04:30 UTC (2026-11-02 10:00 IST)
    _ = clock
    rec_c = login_client(reception_user)

    base = {
        "guardian_name": "Guardian",
        "gender": "F",
        "mobile": "9876511111",
        "address": "Station Road, Ara",
        "district": "Bhojpur",
        "state": "Bihar",
    }

    # Birthday today (1990-11-02 -> 36 on 2026-11-02)
    r_today = rec_c.post(
        "/api/patients",
        json={**base, "full_name": "Bday Today", "dob": "1990-11-02", "age_years": 30},
    )
    assert r_today.status_code == 201, r_today.text
    assert r_today.json()["computed_age_years"] == 36

    # Birthday tomorrow (1990-11-03 -> still 35 on 2026-11-02)
    r_tomorrow = rec_c.post(
        "/api/patients",
        json={**base, "full_name": "Bday Tomorrow", "dob": "1990-11-03", "age_years": 30},
    )
    assert r_tomorrow.status_code == 201, r_tomorrow.text
    assert r_tomorrow.json()["computed_age_years"] == 35

    # No DOB -> falls back to stored age_years
    r_fallback = rec_c.post(
        "/api/patients",
        json={**base, "full_name": "Age Fallback", "age_years": 47},
    )
    assert r_fallback.status_code == 201, r_fallback.text
    assert r_fallback.json()["dob"] is None
    assert r_fallback.json()["computed_age_years"] == 47


def test_clinical_allergies_crud_rbac_audit_locking_and_alias_consolidation(
    login_client: Any,
    admin_user: User,
    reception_user: User,
    doctor_a_user: User,
    doctor_b_user: User,
    db_session: Session,
) -> None:
    """Allergies CRUD is DOCTOR-only, audited (incl. DWS-04), locked, and consolidates aliases."""
    admin_c = login_client(admin_user)
    rec_c = login_client(reception_user)
    doc_a_c = login_client(doctor_a_user)
    doc_b_c = login_client(doctor_b_user)

    master = _seed_patient(db_session, urn="KH-2026-AL01", full_name="Master Allergy Patient")
    secondary = _seed_patient(db_session, urn="KH-2026-AL02", full_name="Merged Alias Patient")
    archived = _seed_patient(db_session, urn="KH-2026-AL03", full_name="Archived Patient")
    archived.is_archived = True
    archived.archived_at = datetime.now(UTC)
    db_session.flush()

    create_payload = {
        "substance": "Penicillin",
        "category": "DRUG",
        "severity": "LIFE_THREATENING",
        "reaction": "Anaphylaxis",
        "clinical_notes": "Avoid all beta-lactams",
    }

    # 1. RECEPTION & ADMIN strictly 403 on GET and POST
    for forbidden_c in (admin_c, rec_c):
        assert forbidden_c.get(f"/api/patients/{master.id}/allergies").status_code == 403
        assert (
            forbidden_c.post(
                f"/api/patients/{master.id}/allergies", json=create_payload
            ).status_code
            == 403
        )

    # 2. DOCTOR A records allergy -> 201 + ALLERGY_RECORDED audit
    created = doc_a_c.post(f"/api/patients/{master.id}/allergies", json=create_payload)
    assert created.status_code == 201, created.text
    allergy = created.json()
    assert allergy["substance"] == "Penicillin"
    assert allergy["severity"] == "LIFE_THREATENING"
    assert allergy["doctor_id"] == doctor_a_user.doctor_id
    assert allergy["recorded_by_username"] == doctor_a_user.username
    assert allergy["version_id"] == 1

    rec_audit = db_session.scalar(
        select(AuditLog)
        .where(
            AuditLog.action == "ALLERGY_RECORDED",
            AuditLog.entity_id == str(allergy["id"]),
        )
        .order_by(AuditLog.id.desc())
    )
    assert rec_audit is not None
    assert rec_audit.after_data["substance"] == "Penicillin"

    # RECEPTION & ADMIN also strictly 403 on PATCH
    patch_body = {"version_id": 1, "severity": "SEVERE"}
    for forbidden_c in (admin_c, rec_c):
        assert (
            forbidden_c.patch(
                f"/api/patients/{master.id}/allergies/{allergy['id']}",
                json=patch_body,
            ).status_code
            == 403
        )

    # 3. DOCTOR B reads master's allergies -> 200 + DWS-04 cross-doctor audit
    read_b = doc_b_c.get(f"/api/patients/{master.id}/allergies")
    assert read_b.status_code == 200
    assert len(read_b.json()) == 1
    assert read_b.json()[0]["id"] == allergy["id"]

    cross_audit = db_session.scalar(
        select(AuditLog)
        .where(
            AuditLog.action == "CROSS_DOCTOR_CLINICAL_READ",
            AuditLog.actor_user_id == doctor_b_user.id,
            AuditLog.entity_id == str(master.id),
        )
        .order_by(AuditLog.id.desc())
    )
    assert cross_audit is not None
    assert cross_audit.after_data["source"] == "patient_allergies_list"
    assert allergy["id"] in cross_audit.after_data["record_ids"]

    # 4. Optimistic locking: stale version_id -> 409; valid update -> 200 + ALLERGY_UPDATED audit
    stale = doc_a_c.patch(
        f"/api/patients/{master.id}/allergies/{allergy['id']}",
        json={"version_id": 99, "severity": "SEVERE"},
    )
    assert stale.status_code == 409
    assert stale.json()["code"] == "version_conflict"

    updated = doc_a_c.patch(
        f"/api/patients/{master.id}/allergies/{allergy['id']}",
        json={
            "version_id": 1,
            "severity": "SEVERE",
            "clinical_notes": "Confirmed skin test",
        },
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["version_id"] == 2
    assert updated.json()["severity"] == "SEVERE"
    assert updated.json()["clinical_notes"] == "Confirmed skin test"

    upd_audit = db_session.scalar(
        select(AuditLog)
        .where(
            AuditLog.action == "ALLERGY_UPDATED",
            AuditLog.entity_id == str(allergy["id"]),
        )
        .order_by(AuditLog.id.desc())
    )
    assert upd_audit is not None
    assert upd_audit.before_data["severity"] == "LIFE_THREATENING"
    assert upd_audit.after_data["severity"] == "SEVERE"

    # 5. Archived patient: POST/PATCH blocked (409), GET succeeds (200)
    assert (
        doc_a_c.post(f"/api/patients/{archived.id}/allergies", json=create_payload).status_code
        == 409
    )
    assert doc_a_c.get(f"/api/patients/{archived.id}/allergies").status_code == 200

    # 6. Downward alias consolidation & merged patient write block (409) vs read (200)
    sec_allergy_resp = doc_a_c.post(
        f"/api/patients/{secondary.id}/allergies",
        json={
            "substance": "Latex",
            "category": "OTHER",
            "severity": "MODERATE",
            "reaction": "Contact dermatitis",
        },
    )
    assert sec_allergy_resp.status_code == 201
    sec_allergy_id = sec_allergy_resp.json()["id"]

    # Merge secondary into master
    secondary.merged_into_id = master.id
    secondary.merged_at = datetime.now(UTC)
    secondary.is_active = False
    db_session.flush()

    # Writes on merged secondary are blocked (409), reads on secondary still succeed (200)
    assert (
        doc_a_c.post(f"/api/patients/{secondary.id}/allergies", json=create_payload).status_code
        == 409
    )
    assert (
        doc_a_c.patch(
            f"/api/patients/{secondary.id}/allergies/{sec_allergy_id}",
            json={"version_id": 1, "status": "RESOLVED"},
        ).status_code
        == 409
    )
    assert doc_a_c.get(f"/api/patients/{secondary.id}/allergies").status_code == 200

    # Reading master's allergies consolidates both master and merged secondary allergies
    consolidated = doc_a_c.get(f"/api/patients/{master.id}/allergies")
    assert consolidated.status_code == 200
    substances = {row["substance"] for row in consolidated.json()}
    assert substances == {"Penicillin", "Latex"}


def test_visit_detail_includes_visit_level_payments_and_visit_code(
    login_client: Any,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """VisitDetail exposes visit_code and includes visit-level payments (appointment_id=None)."""
    rec_c = login_client(reception_user)
    patient = _seed_patient(db_session, urn="KH-2026-VP01")
    assert doctor_a_user.doctor_id is not None

    visit = Visit(
        patient_id=patient.id,
        visit_date=date(2026, 11, 2),
        status="OPEN",
        opened_by_user_id=reception_user.id,
    )
    db_session.add(visit)
    db_session.flush()

    appt = Appointment(
        patient_id=patient.id,
        doctor_id=doctor_a_user.doctor_id,
        appointment_date=date(2026, 11, 2),
        token_number=1,
        status="ARRIVED",
        consultation_status="COMPLETED",
        visit_id=visit.id,
        created_by_user_id=reception_user.id,
    )
    db_session.add(appt)
    db_session.flush()

    db_session.add(
        BillItem(
            visit_id=visit.id,
            patient_id=patient.id,
            appointment_id=appt.id,
            category=BillItemCategory.CONSULTATION.value,
            source=BillItemSource.SYSTEM.value,
            status=BillItemStatus.ACTIVE.value,
            description="Consultation Fee",
            quantity=Decimal("1"),
            rate_paise=50000,
            original_amount_paise=50000,
            amount_paise=50000,
            created_by_user_id=reception_user.id,
        )
    )
    visit_payment = Payment(
        receipt_number="RCP-2026-VL0001",
        patient_id=patient.id,
        visit_id=visit.id,
        appointment_id=None,
        amount_paise=30000,
        payment_method="CASH",
        is_reversed=False,
        created_by_user_id=reception_user.id,
    )
    db_session.add(visit_payment)
    db_session.flush()

    resp = rec_c.get(f"/api/visits/{visit.id}")
    assert resp.status_code == 200, resp.text
    detail = resp.json()
    assert VISIT_CODE_RE.match(detail["visit_code"])
    assert detail["total_paid_paise"] == 30000
    assert detail["outstanding_paise"] == 20000
    assert len(detail["payments"]) == 1
    pay = detail["payments"][0]
    assert pay["id"] == visit_payment.id
    assert pay["visit_id"] == visit.id
    assert pay["appointment_id"] is None
    assert pay["amount_paise"] == 30000


def test_patient_summary_and_visits_strict_role_redaction(
    login_client: Any,
    admin_user: User,
    reception_user: User,
    doctor_a_user: User,
    doctor_b_user: User,
    db_session: Session,
) -> None:
    """/summary and /visits strictly enforce D-04 allergy/clinical and AGENTS.md #7 boundaries."""
    admin_c = login_client(admin_user)
    rec_c = login_client(reception_user)
    doc_b_c = login_client(doctor_b_user)

    assert doctor_a_user.doctor_id is not None
    doc_a = db_session.get(Doctor, doctor_a_user.doctor_id)
    assert doc_a is not None and doc_a.departments
    dept_id = doc_a.departments[0].id

    patient = _seed_patient(db_session, urn="KH-2026-RED1", full_name="Redaction Patient")

    # Seed active allergies (with private clinical reaction/notes) + one inactive allergy
    db_session.add_all(
        [
            PatientAllergy(
                patient_id=patient.id,
                substance="Penicillin",
                category="DRUG",
                severity="LIFE_THREATENING",
                reaction="SECRET_REACTION_ANAPHYLAXIS",
                clinical_notes="SECRET_CLINICAL_NOTE_BETA_LACTAM",
                status="ACTIVE",
                doctor_id=doctor_a_user.doctor_id,
                recorded_by_user_id=doctor_a_user.id,
            ),
            PatientAllergy(
                patient_id=patient.id,
                substance="Dust",
                category="ENVIRONMENTAL",
                severity="MILD",
                reaction="Sneezing",
                clinical_notes="Seasonal rhinitis",
                status="ACTIVE",
                doctor_id=doctor_a_user.doctor_id,
                recorded_by_user_id=doctor_a_user.id,
            ),
            PatientAllergy(
                patient_id=patient.id,
                substance="Ibuprofen",
                category="DRUG",
                severity="MODERATE",
                reaction="Old rash",
                status="INACTIVE",
                doctor_id=doctor_a_user.doctor_id,
                recorded_by_user_id=doctor_a_user.id,
            ),
        ]
    )

    # Seed visit, appointment, bill item, partial payment, treatment plan, encounter, prescription
    visit = Visit(
        patient_id=patient.id,
        visit_date=date(2026, 11, 2),
        status="OPEN",
        opened_by_user_id=reception_user.id,
    )
    db_session.add(visit)
    db_session.flush()

    appt = Appointment(
        patient_id=patient.id,
        doctor_id=doctor_a_user.doctor_id,
        department_id=dept_id,
        appointment_date=date(2026, 11, 2),
        token_number=7,
        status="ARRIVED",
        consultation_status="COMPLETED",
        visit_id=visit.id,
        created_by_user_id=reception_user.id,
    )
    db_session.add(appt)
    db_session.flush()

    db_session.add(
        BillItem(
            visit_id=visit.id,
            patient_id=patient.id,
            appointment_id=appt.id,
            category=BillItemCategory.CONSULTATION.value,
            source=BillItemSource.SYSTEM.value,
            status=BillItemStatus.ACTIVE.value,
            description="Consultation Fee",
            quantity=Decimal("1"),
            rate_paise=50000,
            original_amount_paise=50000,
            amount_paise=50000,
            created_by_user_id=reception_user.id,
        )
    )
    db_session.add(
        Payment(
            receipt_number="RCP-2026-RED001",
            patient_id=patient.id,
            visit_id=visit.id,
            appointment_id=None,
            amount_paise=20000,
            payment_method="CASH",
            is_reversed=False,
            created_by_user_id=reception_user.id,
        )
    )
    db_session.add(
        TreatmentPlan(
            patient_id=patient.id,
            doctor_id=doctor_a_user.doctor_id,
            plan_name="Physio Rehab",
            condition_diagnosis="Frozen Shoulder",
            total_sessions=5,
            agreed_price_paise=100000,
            status="ACTIVE",
        )
    )
    enc = ClinicalEncounter(
        patient_id=patient.id,
        doctor_id=doctor_a_user.doctor_id,
        appointment_id=appt.id,
        visit_id=visit.id,
        department_id=dept_id,
        encounter_date=datetime(2026, 11, 2, 6, 0, tzinfo=UTC),
        symptoms="Shoulder pain",
        clinical_notes="Limited ROM",
        diagnosis="SECRET_DIAGNOSIS_ADHESIVE_CAPSULITIS",
        is_finalised=True,
        finalised_at=datetime(2026, 11, 2, 6, 30, tzinfo=UTC),
        created_by_user_id=doctor_a_user.id,
    )
    db_session.add(enc)
    rx = Prescription(
        patient_id=patient.id,
        doctor_id=doctor_a_user.doctor_id,
        diagnosis="Adhesive capsulitis",
        status="DRAFT",
    )
    db_session.add(rx)
    db_session.flush()
    db_session.add(
        PrescriptionItem(
            prescription_id=rx.id,
            item_order=1,
            medicine_name="Paracetamol 500mg",
            dosage="1 tab",
            frequency="BD",
            duration_days=5,
        )
    )
    db_session.flush()
    rx.status = "AUTHORISED"
    db_session.flush()

    # --- 1. DOCTOR (doctor_b reading doctor_a's records) ---
    doc_sum_resp = doc_b_c.get(f"/api/patients/{patient.id}/summary")
    assert doc_sum_resp.status_code == 200, doc_sum_resp.text
    doc_sum = doc_sum_resp.json()
    assert doc_sum["total_visits"] == 1
    assert doc_sum["active_treatment_plans"] == 1
    assert doc_sum["allergy_alert"] == {
        "has_allergies": True,
        "count": 2,
        "highest_severity": "LIFE_THREATENING",
        "alert_labels": ["Penicillin", "Dust"],
    }
    assert doc_sum["active_allergies"] is not None
    assert len(doc_sum["active_allergies"]) == 2
    assert doc_sum["active_allergies"][0]["reaction"] == "SECRET_REACTION_ANAPHYLAXIS"
    assert doc_sum["active_allergies"][0]["clinical_notes"] == "SECRET_CLINICAL_NOTE_BETA_LACTAM"
    assert doc_sum["prescriptions_count"] == 1
    assert doc_sum["active_conditions_count"] == 0
    assert doc_sum["latest_encounter"] is not None
    assert doc_sum["latest_encounter"]["encounter_code"] == enc.encounter_code
    assert (
        doc_sum["latest_encounter"]["diagnosis_summary"] == "SECRET_DIAGNOSIS_ADHESIVE_CAPSULITIS"
    )
    # AGENTS.md #7: Doctor receives strictly NULL financial KPIs
    assert doc_sum["total_billed_paise"] is None
    assert doc_sum["total_paid_paise"] is None
    assert doc_sum["total_refunded_paise"] is None
    assert doc_sum["outstanding_paise"] is None

    doc_vis_resp = doc_b_c.get(f"/api/patients/{patient.id}/visits")
    assert doc_vis_resp.status_code == 200, doc_vis_resp.text
    doc_vis = doc_vis_resp.json()
    assert doc_vis["total"] == 1
    v_item_doc = doc_vis["items"][0]
    assert v_item_doc["visit_code"] == visit.visit_code
    assert v_item_doc["encounter_links"] is not None
    assert len(v_item_doc["encounter_links"]) == 1
    assert v_item_doc["encounter_links"][0]["encounter_code"] == enc.encounter_code
    assert v_item_doc["bill_total_paise"] is None
    assert v_item_doc["paid_paise"] is None
    assert v_item_doc["due_paise"] is None
    assert v_item_doc["payment_status"] is None

    # --- 2. RECEPTION ---
    rec_sum_resp = rec_c.get(f"/api/patients/{patient.id}/summary")
    assert rec_sum_resp.status_code == 200, rec_sum_resp.text
    rec_sum = rec_sum_resp.json()
    assert rec_sum["allergy_alert"] == {
        "has_allergies": True,
        "count": 2,
        "highest_severity": "LIFE_THREATENING",
        "alert_labels": ["Penicillin", "Dust"],
    }
    assert rec_sum["active_allergies"] is None
    assert "SECRET_REACTION_ANAPHYLAXIS" not in rec_sum_resp.text
    assert "SECRET_CLINICAL_NOTE_BETA_LACTAM" not in rec_sum_resp.text
    assert "SECRET_DIAGNOSIS_ADHESIVE_CAPSULITIS" not in rec_sum_resp.text
    assert rec_sum["prescriptions_count"] is None
    assert rec_sum["active_conditions_count"] is None
    assert rec_sum["latest_encounter"] is None
    # Financial KPIs: 50,000 visit + 100,000 package = 150,000 billed; 20,000 paid; 130,000 due
    assert rec_sum["total_billed_paise"] == 150000
    assert rec_sum["total_paid_paise"] == 20000
    assert rec_sum["total_refunded_paise"] == 0
    assert rec_sum["outstanding_paise"] == 130000

    rec_vis_resp = rec_c.get(f"/api/patients/{patient.id}/visits")
    assert rec_vis_resp.status_code == 200, rec_vis_resp.text
    v_item_rec = rec_vis_resp.json()["items"][0]
    assert v_item_rec["encounter_links"] is None
    assert v_item_rec["bill_total_paise"] == 50000
    assert v_item_rec["paid_paise"] == 20000
    assert v_item_rec["due_paise"] == 30000
    assert v_item_rec["payment_status"] == "PARTIAL"

    # --- 3. ADMIN ---
    adm_sum_resp = admin_c.get(f"/api/patients/{patient.id}/summary")
    assert adm_sum_resp.status_code == 200, adm_sum_resp.text
    adm_sum = adm_sum_resp.json()
    assert adm_sum["allergy_alert"] is None
    assert adm_sum["active_allergies"] is None
    assert "Penicillin" not in adm_sum_resp.text
    assert "SECRET_REACTION_ANAPHYLAXIS" not in adm_sum_resp.text
    assert "SECRET_DIAGNOSIS_ADHESIVE_CAPSULITIS" not in adm_sum_resp.text
    assert adm_sum["prescriptions_count"] is None
    assert adm_sum["active_conditions_count"] is None
    assert adm_sum["latest_encounter"] is None
    assert adm_sum["total_billed_paise"] == 150000
    assert adm_sum["total_paid_paise"] == 20000
    assert adm_sum["total_refunded_paise"] == 0
    assert adm_sum["outstanding_paise"] == 130000

    adm_vis_resp = admin_c.get(f"/api/patients/{patient.id}/visits")
    assert adm_vis_resp.status_code == 200, adm_vis_resp.text
    v_item_adm = adm_vis_resp.json()["items"][0]
    assert v_item_adm["encounter_links"] is None
    assert v_item_adm["bill_total_paise"] == 50000
    assert v_item_adm["paid_paise"] == 20000
    assert v_item_adm["due_paise"] == 30000
    assert v_item_adm["payment_status"] == "PARTIAL"


def test_kalyan_app_role_privileges_on_m1_tables(
    db_session: Session,
    doctor_a_user: User,
) -> None:
    """kalyan_app (db_session) can SELECT/INSERT/UPDATE M1 tables and cannot DELETE allergies."""
    patient = _seed_patient(db_session, urn="KH-2026-PRV1")

    # 1. patient_allergies: INSERT, SELECT, UPDATE succeed; DELETE denied
    allergy = PatientAllergy(
        patient_id=patient.id,
        substance="Sulfa",
        category="DRUG",
        severity="MODERATE",
        status="ACTIVE",
        doctor_id=doctor_a_user.doctor_id,
        recorded_by_user_id=doctor_a_user.id,
    )
    db_session.add(allergy)
    db_session.flush()

    fetched = db_session.get(PatientAllergy, allergy.id)
    assert fetched is not None and fetched.substance == "Sulfa"
    fetched.severity = "SEVERE"
    db_session.flush()
    assert db_session.get(PatientAllergy, allergy.id).severity == "SEVERE"  # type: ignore[union-attr]

    with db_session.begin_nested() as sp:
        with pytest.raises(ProgrammingError):
            db_session.execute(
                text("DELETE FROM patient_allergies WHERE id = :aid"),
                {"aid": allergy.id},
            )
        sp.rollback()

    # 2. visit_sequences & encounter_sequences: INSERT, SELECT, UPDATE succeed
    v_seq = VisitSequence(year=2098, last_number=1)
    e_seq = EncounterSequence(year=2098, last_number=1)
    db_session.add_all([v_seq, e_seq])
    db_session.flush()

    v_loaded = db_session.get(VisitSequence, 2098)
    e_loaded = db_session.get(EncounterSequence, 2098)
    assert v_loaded is not None and e_loaded is not None
    v_loaded.last_number = 2
    e_loaded.last_number = 2
    db_session.flush()
    assert db_session.get(VisitSequence, 2098).last_number == 2  # type: ignore[union-attr]
    assert db_session.get(EncounterSequence, 2098).last_number == 2  # type: ignore[union-attr]
