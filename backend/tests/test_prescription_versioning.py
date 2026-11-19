"""Milestone 2 Prescription Versioning, Amendment & Tamper-Trigger tests (T2.5).

Guarantees:
- Encounter-linked AUTHORISED -> amend -> v2 (revision_number=2, supersedes_prescription_id=v1,
  amendment_reason recorded, original v1 marked SUPERSEDED with items intact, PRESCRIPTION_AMENDED
  audit recorded, chained v2 -> v3 works under uq_prescriptions_active_per_encounter).
- Standalone (encounter_id=None) AUTHORISED -> amend -> v2 (including authorise_immediately=False
  draft amendment followed by authorise).
- Cancelling a SUPERSEDED prescription returns 409 already_superseded; amending DRAFT, CANCELLED,
  or SUPERSEDED returns 422 invalid_prescription_state; short reason returns 422.
- OD-B: GET /api/visits/{id}/prescribed-medicines returns ONLY AUTHORISED v2 items (never v1
  SUPERSEDED items), and billing rejects linking a SUPERSEDED v1 prescription_item_id.
- Cross-doctor amend returns 404; Admin and Reception return 403 (D-04).
- Downward alias consolidation on GET /api/patients/{id}/prescriptions includes revision metadata.
- PostgreSQL tamper triggers on owner_engine (rolled-back tx) reject direct SQL UPDATE/DELETE
  on AUTHORISED, SUPERSEDED, and CANCELLED prescriptions and INSERT/UPDATE/DELETE on their
  prescription_items.
"""

from datetime import UTC, date, datetime
from typing import Any

import pytest
from sqlalchemy import Engine, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from kalyan_api.models import (
    Appointment,
    AuditLog,
    ClinicalEncounter,
    Patient,
    User,
    Visit,
)


def _seed_patient(
    db_session: Session,
    *,
    urn: str,
    full_name: str = "Rx Version Patient",
) -> Patient:
    patient = Patient(
        urn=urn,
        full_name=full_name,
        guardian_name="Guardian",
        gender="M",
        age_years=48,
        mobile="9876503333",
        address="Hospital Road, Ara",
        district="Bhojpur",
        state="Bihar",
    )
    db_session.add(patient)
    db_session.flush()
    return patient


def _seed_visit_and_encounter(
    db_session: Session,
    *,
    patient: Patient,
    doctor_user: User,
    reception_user: User,
) -> tuple[Visit, ClinicalEncounter]:
    assert doctor_user.doctor_id is not None
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
        doctor_id=doctor_user.doctor_id,
        appointment_date=date(2026, 11, 2),
        token_number=11,
        status="ARRIVED",
        consultation_status="COMPLETED",
        visit_id=visit.id,
        created_by_user_id=reception_user.id,
    )
    db_session.add(appt)
    db_session.flush()

    enc = ClinicalEncounter(
        patient_id=patient.id,
        doctor_id=doctor_user.doctor_id,
        appointment_id=appt.id,
        visit_id=visit.id,
        encounter_date=datetime(2026, 11, 2, 8, 0, tzinfo=UTC),
        symptoms="Knee pain and stiffness",
        clinical_notes="Mild effusion",
        diagnosis="Osteoarthritis Knee",
        created_by_user_id=doctor_user.id,
    )
    db_session.add(enc)
    db_session.flush()
    return visit, enc


def test_encounter_linked_prescription_amend_odb_and_guards(
    login_client: Any,
    admin_user: User,
    reception_user: User,
    doctor_a_user: User,
    doctor_b_user: User,
    db_session: Session,
) -> None:
    """AUTHORISED -> amend -> v2 preserves v1 SUPERSEDED, enforces guards & OD-B filtering."""
    admin_c = login_client(admin_user)
    rec_c = login_client(reception_user)
    doc_a_c = login_client(doctor_a_user)
    doc_b_c = login_client(doctor_b_user)

    patient = _seed_patient(db_session, urn="KH-2026-RXV1")
    visit, enc = _seed_visit_and_encounter(
        db_session,
        patient=patient,
        doctor_user=doctor_a_user,
        reception_user=reception_user,
    )

    # 1. Issue AUTHORISED v1 linked to encounter
    v1_resp = doc_a_c.post(
        "/api/prescriptions",
        json={
            "patient_id": patient.id,
            "encounter_id": enc.id,
            "status": "AUTHORISED",
            "diagnosis": "Osteoarthritis Knee",
            "dietary_advice": "Low salt diet",
            "items": [
                {
                    "item_order": 1,
                    "medicine_name": "Tab Paracetamol 500mg",
                    "form": "Tablet",
                    "dosage": "1 tab",
                    "frequency": "BD",
                    "duration_days": 5,
                }
            ],
        },
    )
    assert v1_resp.status_code == 201, v1_resp.text
    v1 = v1_resp.json()
    assert v1["revision_number"] == 1
    assert v1["supersedes_prescription_id"] is None
    assert v1["status"] == "AUTHORISED"
    v1_item_id = v1["items"][0]["id"]

    amend_payload = {
        "amendment_reason": "Updated dosage after gastric sensitivity report",
        "items": [
            {
                "item_order": 1,
                "medicine_name": "Tab Acetaminophen 650mg",
                "form": "Tablet",
                "dosage": "1 tab",
                "frequency": "OD",
                "duration_days": 7,
            },
            {
                "item_order": 2,
                "medicine_name": "Cap Pantoprazole 40mg",
                "form": "Capsule",
                "dosage": "1 cap",
                "frequency": "OD",
                "duration_days": 7,
            },
        ],
        "authorise_immediately": True,
    }

    # D-04: Admin & Reception strictly 403 on amend; cross-doctor returns 404
    assert (
        admin_c.post(f"/api/prescriptions/{v1['id']}/amend", json=amend_payload).status_code == 403
    )
    assert (
        rec_c.post(f"/api/prescriptions/{v1['id']}/amend", json=amend_payload).status_code == 403
    )
    assert (
        doc_b_c.post(f"/api/prescriptions/{v1['id']}/amend", json=amend_payload).status_code == 404
    )

    # Short amendment_reason (<5 chars) rejected with 422
    short_reason = doc_a_c.post(
        f"/api/prescriptions/{v1['id']}/amend",
        json={**amend_payload, "amendment_reason": "fix"},
    )
    assert short_reason.status_code == 422

    # 2. Doctor A amends v1 -> v2 (201 AUTHORISED)
    v2_resp = doc_a_c.post(f"/api/prescriptions/{v1['id']}/amend", json=amend_payload)
    assert v2_resp.status_code == 201, v2_resp.text
    v2 = v2_resp.json()
    assert v2["id"] != v1["id"]
    assert v2["encounter_id"] == enc.id
    assert v2["status"] == "AUTHORISED"
    assert v2["revision_number"] == 2
    assert v2["supersedes_prescription_id"] == v1["id"]
    assert v2["amendment_reason"] == "Updated dosage after gastric sensitivity report"
    assert v2["diagnosis"] == "Osteoarthritis Knee"
    assert v2["dietary_advice"] == "Low salt diet"
    assert [it["medicine_name"] for it in v2["items"]] == [
        "Tab Acetaminophen 650mg",
        "Cap Pantoprazole 40mg",
    ]

    # Original v1 is now SUPERSEDED with original items intact
    v1_after = doc_a_c.get(f"/api/prescriptions/{v1['id']}")
    assert v1_after.status_code == 200
    v1_data = v1_after.json()
    assert v1_data["status"] == "SUPERSEDED"
    assert v1_data["is_printable"] is False
    assert len(v1_data["items"]) == 1
    assert v1_data["items"][0]["id"] == v1_item_id
    assert v1_data["items"][0]["medicine_name"] == "Tab Paracetamol 500mg"

    # PRESCRIPTION_AMENDED audit row verified
    amend_audit = db_session.scalar(
        select(AuditLog)
        .where(
            AuditLog.action == "PRESCRIPTION_AMENDED",
            AuditLog.entity_id == str(v2["id"]),
        )
        .order_by(AuditLog.id.desc())
    )
    assert amend_audit is not None
    assert amend_audit.before_data["prescription_id"] == v1["id"]
    assert amend_audit.after_data["new_revision_number"] == 2
    assert amend_audit.reason == "Updated dosage after gastric sensitivity report"

    # 3. Guards on SUPERSEDED v1: cancel -> 409 already_superseded; re-amend -> 422; PUT -> 409
    cancel_v1 = doc_a_c.post(
        f"/api/prescriptions/{v1['id']}/cancel",
        json={"reason": "Attempt cancel on superseded"},
    )
    assert cancel_v1.status_code == 409
    assert cancel_v1.json()["code"] == "already_superseded"

    reamend_v1 = doc_a_c.post(f"/api/prescriptions/{v1['id']}/amend", json=amend_payload)
    assert reamend_v1.status_code == 422
    assert reamend_v1.json()["code"] == "invalid_prescription_state"

    put_v1 = doc_a_c.put(
        f"/api/prescriptions/{v1['id']}",
        json={"diagnosis": "Tampered", "version_id": v1_data["version_id"]},
    )
    assert put_v1.status_code == 409
    assert put_v1.json()["code"] == "prescription_locked"

    # 4. OD-B: /api/visits/{id}/prescribed-medicines returns ONLY AUTHORISED v2 items
    meds_resp = rec_c.get(f"/api/visits/{visit.id}/prescribed-medicines")
    assert meds_resp.status_code == 200, meds_resp.text
    meds = meds_resp.json()
    v2_item_ids = {it["id"] for it in v2["items"]}
    assert {m["prescription_item_id"] for m in meds} == v2_item_ids
    assert v1_item_id not in {m["prescription_item_id"] for m in meds}

    # Billing rejects linking SUPERSEDED v1 item, accepts AUTHORISED v2 item
    bill_v1 = rec_c.post(
        f"/api/visits/{visit.id}/bill-items",
        json={
            "category": "MEDICINE",
            "description": "Old Paracetamol",
            "quantity": "1",
            "rate_paise": 500,
            "prescription_item_id": v1_item_id,
        },
    )
    assert bill_v1.status_code == 422
    assert bill_v1.json()["code"] == "prescription_item_not_on_visit"

    bill_v2 = rec_c.post(
        f"/api/visits/{visit.id}/bill-items",
        json={
            "category": "MEDICINE",
            "description": "Acetaminophen 650mg",
            "quantity": "1",
            "rate_paise": 600,
            "prescription_item_id": v2["items"][0]["id"],
        },
    )
    assert bill_v2.status_code == 201, bill_v2.text

    # 5. Chained amendment v2 -> v3 succeeds on same encounter
    v3_resp = doc_a_c.post(
        f"/api/prescriptions/{v2['id']}/amend",
        json={
            "amendment_reason": "Extended duration to 10 days",
            "items": [
                {
                    "item_order": 1,
                    "medicine_name": "Tab Acetaminophen 650mg",
                    "form": "Tablet",
                    "dosage": "1 tab",
                    "frequency": "OD",
                    "duration_days": 10,
                }
            ],
        },
    )
    assert v3_resp.status_code == 201, v3_resp.text
    v3 = v3_resp.json()
    assert v3["revision_number"] == 3
    assert v3["supersedes_prescription_id"] == v2["id"]
    assert doc_a_c.get(f"/api/prescriptions/{v2['id']}").json()["status"] == "SUPERSEDED"


def test_standalone_prescription_draft_amend_and_alias_consolidation(
    login_client: Any,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Standalone (encounter_id=None) amend as DRAFT, state guards, and alias consolidation."""
    doc_a_c = login_client(doctor_a_user)
    master = _seed_patient(db_session, urn="KH-2026-RXV2", full_name="Master Rx Patient")
    secondary = _seed_patient(db_session, urn="KH-2026-RXV3", full_name="Secondary Rx Patient")

    # Standalone DRAFT cannot be amended (422)
    draft_resp = doc_a_c.post(
        "/api/prescriptions",
        json={
            "patient_id": secondary.id,
            "status": "DRAFT",
            "diagnosis": "Seasonal rhinitis",
            "items": [
                {
                    "item_order": 1,
                    "medicine_name": "Tab Cetirizine 10mg",
                    "dosage": "1 tab",
                    "frequency": "HS",
                    "duration_days": 5,
                }
            ],
        },
    )
    assert draft_resp.status_code == 201
    draft_rx = draft_resp.json()
    assert draft_rx["encounter_id"] is None

    amend_draft = doc_a_c.post(
        f"/api/prescriptions/{draft_rx['id']}/amend",
        json={
            "amendment_reason": "Cannot amend draft directly",
            "items": [
                {
                    "item_order": 1,
                    "medicine_name": "Tab Levocetirizine 5mg",
                    "dosage": "1 tab",
                    "frequency": "HS",
                    "duration_days": 5,
                }
            ],
        },
    )
    assert amend_draft.status_code == 422
    assert amend_draft.json()["code"] == "invalid_prescription_state"

    # Authorise standalone v1, then amend with authorise_immediately=False -> v2 DRAFT
    auth = doc_a_c.post(f"/api/prescriptions/{draft_rx['id']}/authorise")
    assert auth.status_code == 200

    v2_draft_resp = doc_a_c.post(
        f"/api/prescriptions/{draft_rx['id']}/amend",
        json={
            "amendment_reason": "Switching to non-sedating antihistamine",
            "authorise_immediately": False,
            "items": [
                {
                    "item_order": 1,
                    "medicine_name": "Tab Fexofenadine 120mg",
                    "dosage": "1 tab",
                    "frequency": "OD",
                    "duration_days": 7,
                }
            ],
        },
    )
    assert v2_draft_resp.status_code == 201, v2_draft_resp.text
    v2_draft = v2_draft_resp.json()
    assert v2_draft["encounter_id"] is None
    assert v2_draft["status"] == "DRAFT"
    assert v2_draft["revision_number"] == 2
    assert v2_draft["supersedes_prescription_id"] == draft_rx["id"]
    assert doc_a_c.get(f"/api/prescriptions/{draft_rx['id']}").json()["status"] == "SUPERSEDED"

    # Authorise v2 draft, then cancel v2, then verify CANCELLED cannot be amended (422)
    assert doc_a_c.post(f"/api/prescriptions/{v2_draft['id']}/authorise").status_code == 200
    cancel_v2 = doc_a_c.post(
        f"/api/prescriptions/{v2_draft['id']}/cancel",
        json={"reason": "Patient reported rash"},
    )
    assert cancel_v2.status_code == 200
    amend_cancelled = doc_a_c.post(
        f"/api/prescriptions/{v2_draft['id']}/amend",
        json={
            "amendment_reason": "Cannot amend cancelled prescription",
            "items": [
                {
                    "item_order": 1,
                    "medicine_name": "Tab Loratadine 10mg",
                    "dosage": "1 tab",
                    "frequency": "OD",
                    "duration_days": 5,
                }
            ],
        },
    )
    assert amend_cancelled.status_code == 422
    assert amend_cancelled.json()["code"] == "invalid_prescription_state"

    # Merge secondary into master -> GET /patients/{master}/prescriptions consolidates aliases
    secondary.merged_into_id = master.id
    secondary.merged_at = datetime.now(UTC)
    secondary.is_active = False
    db_session.flush()

    listed = doc_a_c.get(f"/api/patients/{master.id}/prescriptions")
    assert listed.status_code == 200
    by_id = {row["id"]: row for row in listed.json()}
    assert {draft_rx["id"], v2_draft["id"]}.issubset(by_id.keys())
    assert by_id[v2_draft["id"]]["revision_number"] == 2
    assert by_id[v2_draft["id"]]["supersedes_prescription_id"] == draft_rx["id"]
    assert by_id[v2_draft["id"]]["amendment_reason"] == "Switching to non-sedating antihistamine"


def test_prescription_and_item_db_tamper_triggers(owner_engine: Engine) -> None:
    """PG triggers reject UPDATE/DELETE on AUTHORISED/SUPERSEDED/CANCELLED Rx & their items."""
    with owner_engine.connect() as conn:
        tx = conn.begin()
        try:
            doc_id = conn.scalar(
                text(
                    "INSERT INTO doctors (name_en, default_fee_paise, is_active) "
                    "VALUES ('Dr. Rx Trigger', 30000, true) RETURNING id"
                )
            )
            user_id = conn.scalar(
                text(
                    "INSERT INTO users (username, full_name, role, doctor_id, password_hash, "
                    "is_active) VALUES ('rx_trig_doc', 'Rx Trig', 'DOCTOR', :did, 'hash', true) "
                    "RETURNING id"
                ),
                {"did": doc_id},
            )
            pat_id = conn.scalar(
                text(
                    "INSERT INTO patients (urn, full_name, guardian_name, gender, age_years, "
                    "mobile, address) VALUES ('KH-2026-RXTRG', 'Rx Trig Pat', 'Guard', 'M', 40, "
                    "'9876543233', 'Ara') RETURNING id"
                )
            )

            def _seed_rx_with_status(target_status: str) -> tuple[int, int]:
                rx_id = conn.scalar(
                    text(
                        "INSERT INTO prescriptions (patient_id, doctor_id, status, diagnosis, "
                        "revision_number, version_id) "
                        "VALUES (:pid, :did, 'DRAFT', 'Trigger Test Diag', 1, 1) RETURNING id"
                    ),
                    {"pid": pat_id, "did": doc_id},
                )
                item_id = conn.scalar(
                    text(
                        "INSERT INTO prescription_items (prescription_id, item_order, "
                        "medicine_name, dosage, frequency, duration_days) "
                        "VALUES (:rxid, 1, 'Tab Ibuprofen', '400mg', 'BD', 5) RETURNING id"
                    ),
                    {"rxid": rx_id},
                )
                # Transition DRAFT -> AUTHORISED first, then to terminal state if needed
                conn.execute(
                    text(
                        "UPDATE prescriptions SET status = 'AUTHORISED', authorised_at = NOW() "
                        "WHERE id = :rxid"
                    ),
                    {"rxid": rx_id},
                )
                if target_status == "SUPERSEDED":
                    conn.execute(
                        text("UPDATE prescriptions SET status = 'SUPERSEDED' WHERE id = :rxid"),
                        {"rxid": rx_id},
                    )
                elif target_status == "CANCELLED":
                    conn.execute(
                        text(
                            "UPDATE prescriptions SET status = 'CANCELLED', cancelled_at = NOW(), "
                            "cancelled_by_user_id = :uid, "
                            "cancellation_reason = 'Cancelled for trigger test' WHERE id = :rxid"
                        ),
                        {"rxid": rx_id, "uid": user_id},
                    )
                assert rx_id is not None and item_id is not None
                return int(rx_id), int(item_id)

            for status_label in ("AUTHORISED", "SUPERSEDED", "CANCELLED"):
                rx_id, item_id = _seed_rx_with_status(status_label)

                # 1. Direct UPDATE of core field on prescription -> rejected
                with conn.begin_nested() as sp:
                    with pytest.raises(DBAPIError):
                        conn.execute(
                            text(
                                "UPDATE prescriptions SET diagnosis = 'Tampered' "
                                "WHERE id = :rxid"
                            ),
                            {"rxid": rx_id},
                        )
                    sp.rollback()

                # 2. Direct UPDATE of status back to DRAFT -> rejected
                with conn.begin_nested() as sp:
                    with pytest.raises(DBAPIError):
                        conn.execute(
                            text("UPDATE prescriptions SET status = 'DRAFT' WHERE id = :rxid"),
                            {"rxid": rx_id},
                        )
                    sp.rollback()

                # 3. Direct DELETE on prescription -> rejected
                with conn.begin_nested() as sp:
                    with pytest.raises(DBAPIError):
                        conn.execute(
                            text("DELETE FROM prescriptions WHERE id = :rxid"),
                            {"rxid": rx_id},
                        )
                    sp.rollback()

                # 4. Direct INSERT into prescription_items -> rejected
                with conn.begin_nested() as sp:
                    with pytest.raises(DBAPIError):
                        conn.execute(
                            text(
                                "INSERT INTO prescription_items (prescription_id, item_order, "
                                "medicine_name, dosage, frequency, duration_days) "
                                "VALUES (:rxid, 2, 'Tamper Med', '10mg', 'OD', 3)"
                            ),
                            {"rxid": rx_id},
                        )
                    sp.rollback()

                # 5. Direct UPDATE on prescription_items -> rejected
                with conn.begin_nested() as sp:
                    with pytest.raises(DBAPIError):
                        conn.execute(
                            text(
                                "UPDATE prescription_items SET medicine_name = 'Tampered Med' "
                                "WHERE id = :iid"
                            ),
                            {"iid": item_id},
                        )
                    sp.rollback()

                # 6. Direct DELETE on prescription_items -> rejected
                with conn.begin_nested() as sp:
                    with pytest.raises(DBAPIError):
                        conn.execute(
                            text("DELETE FROM prescription_items WHERE id = :iid"),
                            {"iid": item_id},
                        )
                    sp.rollback()
        finally:
            tx.rollback()
