"""Milestone 2 Structured Encounter Diagnoses & Longitudinal Conditions tests (T2.5).

Guarantees:
- Longitudinal patient_conditions CRUD, optimistic locking (409), audit trail,
  archived/merged patient write block (409) vs read (200), and downward alias consolidation.
- Encounter diagnoses CRUD, link validation, atomic promote_to_condition=True, and
  conflicting patient_condition_id + promote_to_condition=True rejection (422).
- Finalised encounter mutation blocked at API (400 encounter_finalised) AND PostgreSQL
  trigger level (trg_prevent_finalised_encounter_diagnosis_tampering via owner_engine).
- Strict D-04 enforcement: 403 for ADMIN and RECEPTION on all 7 endpoints.
- Strict DWS-04 enforcement: doctor_b reads succeed (200) with CROSS_DOCTOR_CLINICAL_READ
  audit; doctor_b writes return 404 (ScopeFamily.CLINICAL_WRITE).
- GET /api/patients/{id}/summary reports real active_conditions_count (incl. merged aliases)
  for DOCTOR and strictly None for RECEPTION and ADMIN.
- Least-privilege kalyan_app cannot DELETE from patient_conditions.
"""

from datetime import UTC, datetime
from typing import Any

import pytest
from sqlalchemy import Engine, select, text
from sqlalchemy.exc import DBAPIError, ProgrammingError
from sqlalchemy.orm import Session

from kalyan_api.models import (
    AuditLog,
    ClinicalEncounter,
    Patient,
    PatientCondition,
    User,
)


def _seed_patient(
    db_session: Session,
    *,
    urn: str,
    full_name: str = "Diagnosis Test Patient",
) -> Patient:
    patient = Patient(
        urn=urn,
        full_name=full_name,
        guardian_name="Guardian",
        gender="M",
        age_years=42,
        mobile="9876501111",
        address="Hospital Road, Ara",
        district="Bhojpur",
        state="Bihar",
    )
    db_session.add(patient)
    db_session.flush()
    return patient


def _seed_encounter(
    db_session: Session,
    *,
    patient: Patient,
    doctor_user: User,
    is_finalised: bool = False,
) -> ClinicalEncounter:
    assert doctor_user.doctor_id is not None
    enc = ClinicalEncounter(
        patient_id=patient.id,
        doctor_id=doctor_user.doctor_id,
        encounter_date=datetime(2026, 11, 2, 6, 0, tzinfo=UTC),
        symptoms="Persistent lower back pain",
        clinical_notes="Tenderness at L4-L5",
        diagnosis="Lumbar spondylosis",
        is_finalised=is_finalised,
        finalised_at=datetime(2026, 11, 2, 6, 30, tzinfo=UTC) if is_finalised else None,
        created_by_user_id=doctor_user.id,
    )
    db_session.add(enc)
    db_session.flush()
    return enc


def test_patient_conditions_crud_locking_alias_consolidation_and_summary(
    login_client: Any,
    admin_user: User,
    reception_user: User,
    doctor_a_user: User,
    doctor_b_user: User,
    db_session: Session,
) -> None:
    """Longitudinal conditions CRUD, optimistic locking, alias consolidation, and /summary KPI."""
    admin_c = login_client(admin_user)
    rec_c = login_client(reception_user)
    doc_a_c = login_client(doctor_a_user)
    doc_b_c = login_client(doctor_b_user)

    master = _seed_patient(db_session, urn="KH-2026-CD01", full_name="Master Cond Patient")
    secondary = _seed_patient(db_session, urn="KH-2026-CD02", full_name="Secondary Cond Patient")
    archived = _seed_patient(db_session, urn="KH-2026-CD03", full_name="Archived Cond Patient")
    archived.is_archived = True
    archived.archived_at = datetime.now(UTC)
    db_session.flush()

    create_payload = {
        "condition_name": "Essential Hypertension",
        "icd10_code": "I10",
        "status": "ACTIVE",
        "onset_date": "2024-03-15",
        "notes": "On regular ACE inhibitor",
    }

    # D-04: Admin and Reception strictly 403 on GET & POST
    for forbidden_c in (admin_c, rec_c):
        assert forbidden_c.get(f"/api/patients/{master.id}/conditions").status_code == 403
        assert (
            forbidden_c.post(
                f"/api/patients/{master.id}/conditions", json=create_payload
            ).status_code
            == 403
        )

    # Doctor A creates condition -> 201 + CONDITION_RECORDED audit
    created = doc_a_c.post(f"/api/patients/{master.id}/conditions", json=create_payload)
    assert created.status_code == 201, created.text
    cond = created.json()
    assert cond["condition_name"] == "Essential Hypertension"
    assert cond["icd10_code"] == "I10"
    assert cond["status"] == "ACTIVE"
    assert cond["doctor_id"] == doctor_a_user.doctor_id
    assert cond["doctor_name"] == "Dr. Anil"
    assert cond["version_id"] == 1

    rec_audit = db_session.scalar(
        select(AuditLog)
        .where(
            AuditLog.action == "CONDITION_RECORDED",
            AuditLog.entity_id == str(cond["id"]),
        )
        .order_by(AuditLog.id.desc())
    )
    assert rec_audit is not None
    assert rec_audit.after_data["condition_name"] == "Essential Hypertension"

    # D-04: Admin and Reception strictly 403 on PATCH
    for forbidden_c in (admin_c, rec_c):
        assert (
            forbidden_c.patch(
                f"/api/patients/{master.id}/conditions/{cond['id']}",
                json={"version_id": 1, "status": "RESOLVED"},
            ).status_code
            == 403
        )

    # DWS-04: Doctor B reads -> 200 + CROSS_DOCTOR_CLINICAL_READ audit; writes -> 404
    read_b = doc_b_c.get(f"/api/patients/{master.id}/conditions")
    assert read_b.status_code == 200
    assert len(read_b.json()) == 1
    assert read_b.json()[0]["id"] == cond["id"]

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
    assert cross_audit.after_data["source"] == "patient_conditions_list"
    assert cond["id"] in cross_audit.after_data["record_ids"]

    write_b = doc_b_c.patch(
        f"/api/patients/{master.id}/conditions/{cond['id']}",
        json={"version_id": 1, "status": "RESOLVED"},
    )
    assert write_b.status_code == 404

    # Optimistic locking: stale version_id -> 409; valid update -> 200 + CONDITION_UPDATED audit
    stale = doc_a_c.patch(
        f"/api/patients/{master.id}/conditions/{cond['id']}",
        json={"version_id": 99, "status": "INACTIVE"},
    )
    assert stale.status_code == 409
    assert stale.json()["code"] == "version_conflict"

    updated = doc_a_c.patch(
        f"/api/patients/{master.id}/conditions/{cond['id']}",
        json={
            "version_id": 1,
            "status": "RESOLVED",
            "resolved_date": "2026-11-01",
            "notes": "Controlled without medication",
        },
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["version_id"] == 2
    assert updated.json()["status"] == "RESOLVED"
    assert updated.json()["resolved_date"] == "2026-11-01"

    upd_audit = db_session.scalar(
        select(AuditLog)
        .where(
            AuditLog.action == "CONDITION_UPDATED",
            AuditLog.entity_id == str(cond["id"]),
        )
        .order_by(AuditLog.id.desc())
    )
    assert upd_audit is not None
    assert upd_audit.before_data["status"] == "ACTIVE"
    assert upd_audit.after_data["status"] == "RESOLVED"

    # Add an ACTIVE condition on master + an ACTIVE condition on secondary, then merge secondary
    active_master = doc_a_c.post(
        f"/api/patients/{master.id}/conditions",
        json={"condition_name": "Type 2 Diabetes", "icd10_code": "E11", "status": "ACTIVE"},
    )
    assert active_master.status_code == 201

    active_sec = doc_a_c.post(
        f"/api/patients/{secondary.id}/conditions",
        json={"condition_name": "Osteoarthritis Knee", "icd10_code": "M17", "status": "ACTIVE"},
    )
    assert active_sec.status_code == 201
    sec_cond_id = active_sec.json()["id"]

    # Archived patient blocks writes (409) but allows reads (200)
    assert (
        doc_a_c.post(f"/api/patients/{archived.id}/conditions", json=create_payload).status_code
        == 409
    )
    assert doc_a_c.get(f"/api/patients/{archived.id}/conditions").status_code == 200

    # Merge secondary into master
    secondary.merged_into_id = master.id
    secondary.merged_at = datetime.now(UTC)
    secondary.is_active = False
    db_session.flush()

    # Merged secondary blocks writes (409) but allows reads (200)
    assert (
        doc_a_c.post(f"/api/patients/{secondary.id}/conditions", json=create_payload).status_code
        == 409
    )
    assert (
        doc_a_c.patch(
            f"/api/patients/{secondary.id}/conditions/{sec_cond_id}",
            json={"version_id": 1, "status": "INACTIVE"},
        ).status_code
        == 409
    )
    assert doc_a_c.get(f"/api/patients/{secondary.id}/conditions").status_code == 200

    # Master consolidates conditions; ACTIVE sorted before RESOLVED
    listed = doc_a_c.get(f"/api/patients/{master.id}/conditions")
    assert listed.status_code == 200
    rows = listed.json()
    assert len(rows) == 3
    assert {r["condition_name"] for r in rows} == {
        "Essential Hypertension",
        "Type 2 Diabetes",
        "Osteoarthritis Knee",
    }
    assert [r["status"] for r in rows] == ["ACTIVE", "ACTIVE", "RESOLVED"]

    # /summary active_conditions_count: 2 active (master + merged alias, excluding RESOLVED)
    # for DOCTOR; strictly None for RECEPTION and ADMIN under D-04
    doc_sum = doc_b_c.get(f"/api/patients/{master.id}/summary")
    assert doc_sum.status_code == 200
    assert doc_sum.json()["active_conditions_count"] == 2

    rec_sum = rec_c.get(f"/api/patients/{master.id}/summary")
    assert rec_sum.status_code == 200
    assert rec_sum.json()["active_conditions_count"] is None

    adm_sum = admin_c.get(f"/api/patients/{master.id}/summary")
    assert adm_sum.status_code == 200
    assert adm_sum.json()["active_conditions_count"] is None


def test_encounter_diagnoses_crud_promote_rbac_and_finalised_api_guard(
    login_client: Any,
    admin_user: User,
    reception_user: User,
    doctor_a_user: User,
    doctor_b_user: User,
    db_session: Session,
) -> None:
    """Encounter diagnoses CRUD, promote_to_condition, D-04/DWS-04, and finalised 400 guard."""
    admin_c = login_client(admin_user)
    rec_c = login_client(reception_user)
    doc_a_c = login_client(doctor_a_user)
    doc_b_c = login_client(doctor_b_user)

    patient = _seed_patient(db_session, urn="KH-2026-DG01")
    other_patient = _seed_patient(db_session, urn="KH-2026-DG02", full_name="Other Patient")
    enc = _seed_encounter(db_session, patient=patient, doctor_user=doctor_a_user)

    assert doctor_a_user.doctor_id is not None
    other_cond = PatientCondition(
        patient_id=other_patient.id,
        doctor_id=doctor_a_user.doctor_id,
        condition_name="Asthma",
        status="ACTIVE",
    )
    db_session.add(other_cond)
    db_session.flush()

    # D-04: Admin and Reception strictly 403 on GET & POST encounter diagnoses
    base_diag = {
        "diagnosis_name": "Lumbar Disc Herniation",
        "icd10_code": "M51.2",
        "diagnosis_type": "PRIMARY",
        "status": "ACTIVE",
        "notes": "Confirmed on MRI",
    }
    for forbidden_c in (admin_c, rec_c):
        assert forbidden_c.get(f"/api/encounters/{enc.id}/diagnoses").status_code == 403
        assert (
            forbidden_c.post(f"/api/encounters/{enc.id}/diagnoses", json=base_diag).status_code
            == 403
        )

    # Validation: conflicting patient_condition_id + promote_to_condition=True -> 422
    conflict = doc_a_c.post(
        f"/api/encounters/{enc.id}/diagnoses",
        json={**base_diag, "patient_condition_id": other_cond.id, "promote_to_condition": True},
    )
    assert conflict.status_code == 422

    # Validation: linking another patient's condition -> 422 condition_patient_mismatch
    mismatch = doc_a_c.post(
        f"/api/encounters/{enc.id}/diagnoses",
        json={**base_diag, "patient_condition_id": other_cond.id},
    )
    assert mismatch.status_code == 422
    assert mismatch.json()["code"] == "condition_patient_mismatch"

    # 1. Create diagnosis with promote_to_condition=True -> creates linked PatientCondition
    promoted = doc_a_c.post(
        f"/api/encounters/{enc.id}/diagnoses",
        json={**base_diag, "promote_to_condition": True},
    )
    assert promoted.status_code == 201, promoted.text
    diag_1 = promoted.json()
    assert diag_1["encounter_code"] == enc.encounter_code
    assert diag_1["patient_condition_id"] is not None
    assert diag_1["diagnosis_type"] == "PRIMARY"

    conds = doc_a_c.get(f"/api/patients/{patient.id}/conditions").json()
    assert len(conds) == 1
    assert conds[0]["id"] == diag_1["patient_condition_id"]
    assert conds[0]["condition_name"] == "Lumbar Disc Herniation"

    cond_audit = db_session.scalar(
        select(AuditLog)
        .where(
            AuditLog.action == "CONDITION_RECORDED",
            AuditLog.entity_id == str(diag_1["patient_condition_id"]),
        )
        .order_by(AuditLog.id.desc())
    )
    assert cond_audit is not None
    assert cond_audit.after_data["promoted_from_encounter_id"] == enc.id

    # 2. Create secondary diagnosis (unpromoted) -> update -> delete
    sec_resp = doc_a_c.post(
        f"/api/encounters/{enc.id}/diagnoses",
        json={
            "diagnosis_name": "Sciatica",
            "icd10_code": "M54.3",
            "diagnosis_type": "SECONDARY",
            "status": "ACTIVE",
        },
    )
    assert sec_resp.status_code == 201, sec_resp.text
    diag_2 = sec_resp.json()
    assert diag_2["patient_condition_id"] is None

    # D-04: Admin and Reception strictly 403 on PATCH & DELETE
    for forbidden_c in (admin_c, rec_c):
        assert (
            forbidden_c.patch(
                f"/api/encounters/{enc.id}/diagnoses/{diag_2['id']}",
                json={"notes": "blocked"},
            ).status_code
            == 403
        )
        assert (
            forbidden_c.delete(f"/api/encounters/{enc.id}/diagnoses/{diag_2['id']}").status_code
            == 403
        )

    # DWS-04: Doctor B reads -> 200 + CROSS_DOCTOR_CLINICAL_READ audit; writes -> 404
    read_b = doc_b_c.get(f"/api/encounters/{enc.id}/diagnoses")
    assert read_b.status_code == 200
    assert [d["diagnosis_type"] for d in read_b.json()] == ["PRIMARY", "SECONDARY"]

    cross_enc_audit = db_session.scalar(
        select(AuditLog)
        .where(
            AuditLog.action == "CROSS_DOCTOR_CLINICAL_READ",
            AuditLog.actor_user_id == doctor_b_user.id,
            AuditLog.entity_id == str(enc.id),
        )
        .order_by(AuditLog.id.desc())
    )
    assert cross_enc_audit is not None

    assert doc_b_c.post(f"/api/encounters/{enc.id}/diagnoses", json=base_diag).status_code == 404
    assert (
        doc_b_c.patch(
            f"/api/encounters/{enc.id}/diagnoses/{diag_2['id']}",
            json={"notes": "cross-doctor"},
        ).status_code
        == 404
    )
    assert (
        doc_b_c.delete(f"/api/encounters/{enc.id}/diagnoses/{diag_2['id']}").status_code == 404
    )

    # Doctor A updates and deletes diag_2
    patched = doc_a_c.patch(
        f"/api/encounters/{enc.id}/diagnoses/{diag_2['id']}",
        json={"diagnosis_type": "PROVISIONAL", "notes": "Rule out piriformis syndrome"},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["diagnosis_type"] == "PROVISIONAL"
    assert patched.json()["notes"] == "Rule out piriformis syndrome"

    deleted = doc_a_c.delete(f"/api/encounters/{enc.id}/diagnoses/{diag_2['id']}")
    assert deleted.status_code == 204

    remaining = doc_a_c.get(f"/api/encounters/{enc.id}/diagnoses").json()
    assert [d["id"] for d in remaining] == [diag_1["id"]]

    # 3. Finalise encounter -> all diagnosis mutations rejected with 400 encounter_finalised
    fin = doc_a_c.post(
        f"/api/encounters/{enc.id}/finalise",
        json={
            "symptoms": enc.symptoms,
            "clinical_notes": enc.clinical_notes,
            "diagnosis": enc.diagnosis,
            "version_id": enc.version_id,
        },
    )
    assert fin.status_code == 200, fin.text

    post_fin = doc_a_c.post(f"/api/encounters/{enc.id}/diagnoses", json=base_diag)
    assert post_fin.status_code == 400
    assert post_fin.json()["code"] == "encounter_finalised"

    patch_fin = doc_a_c.patch(
        f"/api/encounters/{enc.id}/diagnoses/{diag_1['id']}",
        json={"notes": "post-finalisation tamper"},
    )
    assert patch_fin.status_code == 400
    assert patch_fin.json()["code"] == "encounter_finalised"

    del_fin = doc_a_c.delete(f"/api/encounters/{enc.id}/diagnoses/{diag_1['id']}")
    assert del_fin.status_code == 400
    assert del_fin.json()["code"] == "encounter_finalised"


def test_finalised_encounter_diagnosis_db_tamper_trigger(owner_engine: Engine) -> None:
    """DB trigger blocks direct INSERT/UPDATE/DELETE on encounter_diagnoses once finalised."""
    with owner_engine.connect() as conn:
        tx = conn.begin()
        try:
            doc_id = conn.scalar(
                text(
                    "INSERT INTO doctors (name_en, default_fee_paise, is_active) "
                    "VALUES ('Dr. Diag Trigger', 30000, true) RETURNING id"
                )
            )
            user_id = conn.scalar(
                text(
                    "INSERT INTO users (username, full_name, role, doctor_id, password_hash, "
                    "is_active) VALUES ('diag_trig_doc', 'Diag Trig', 'DOCTOR', :did, 'hash', "
                    "true) RETURNING id"
                ),
                {"did": doc_id},
            )
            pat_id = conn.scalar(
                text(
                    "INSERT INTO patients (urn, full_name, guardian_name, gender, age_years, "
                    "mobile, address) VALUES ('KH-2026-DTRG', 'Diag Trig Pat', 'Guard', 'M', 35, "
                    "'9876543222', 'Ara') RETURNING id"
                )
            )
            enc_id = conn.scalar(
                text(
                    "INSERT INTO clinical_encounters (patient_id, doctor_id, symptoms, "
                    "clinical_notes, diagnosis, is_finalised, created_by_user_id, version_id) "
                    "VALUES (:pid, :did, 'S', 'N', 'D', false, :uid, 1) RETURNING id"
                ),
                {"pid": pat_id, "did": doc_id, "uid": user_id},
            )
            diag_id = conn.scalar(
                text(
                    "INSERT INTO encounter_diagnoses (encounter_id, patient_id, doctor_id, "
                    "diagnosis_name, diagnosis_type, status) "
                    "VALUES (:eid, :pid, :did, 'Initial Diag', 'PRIMARY', 'ACTIVE') RETURNING id"
                ),
                {"eid": enc_id, "pid": pat_id, "did": doc_id},
            )

            # Finalise encounter directly
            conn.execute(
                text(
                    "UPDATE clinical_encounters SET is_finalised = true, finalised_at = NOW() "
                    "WHERE id = :eid"
                ),
                {"eid": enc_id},
            )

            # Direct INSERT rejected by trigger
            with conn.begin_nested() as sp1:
                with pytest.raises(DBAPIError, match="finalised clinical encounter"):
                    conn.execute(
                        text(
                            "INSERT INTO encounter_diagnoses (encounter_id, patient_id, doctor_id, "
                            "diagnosis_name, diagnosis_type, status) "
                            "VALUES (:eid, :pid, :did, 'Tamper', 'SECONDARY', 'ACTIVE')"
                        ),
                        {"eid": enc_id, "pid": pat_id, "did": doc_id},
                    )
                sp1.rollback()

            # Direct UPDATE rejected by trigger
            with conn.begin_nested() as sp2:
                with pytest.raises(DBAPIError, match="finalised clinical encounter"):
                    conn.execute(
                        text(
                            "UPDATE encounter_diagnoses SET diagnosis_name = 'Tampered' "
                            "WHERE id = :dgid"
                        ),
                        {"dgid": diag_id},
                    )
                sp2.rollback()

            # Direct DELETE rejected by trigger
            with conn.begin_nested() as sp3:
                with pytest.raises(DBAPIError, match="finalised clinical encounter"):
                    conn.execute(
                        text("DELETE FROM encounter_diagnoses WHERE id = :dgid"),
                        {"dgid": diag_id},
                    )
                sp3.rollback()
        finally:
            tx.rollback()


def test_kalyan_app_cannot_delete_patient_conditions(
    db_session: Session,
    doctor_a_user: User,
) -> None:
    """Least-privilege kalyan_app role has no DELETE privilege on patient_conditions."""
    patient = _seed_patient(db_session, urn="KH-2026-CPRIV")
    assert doctor_a_user.doctor_id is not None
    cond = PatientCondition(
        patient_id=patient.id,
        doctor_id=doctor_a_user.doctor_id,
        condition_name="Chronic Kidney Disease",
        status="ACTIVE",
    )
    db_session.add(cond)
    db_session.flush()

    with db_session.begin_nested() as sp:
        with pytest.raises(ProgrammingError):
            db_session.execute(
                text("DELETE FROM patient_conditions WHERE id = :cid"),
                {"cid": cond.id},
            )
        sp.rollback()
