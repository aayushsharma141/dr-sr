"""Milestone 2 Clinical Investigation Orders & Append-Only Results tests (T2.5).

Guarantees:
- Full lifecycle: ORDERED -> SAMPLE_COLLECTED -> result recorded -> COMPLETED, plus
  additional append-only results returned newest-first.
- Invalid status transitions rejected with 422 invalid_status_transition; stale version_id
  rejected with 409 version_conflict; recording results on CANCELLED rejected with 422.
- Cancelling requires trimmed cancelled_reason >= 3 chars (422 cancelled_reason_required).
- Downward alias consolidation on GET /api/patients/{id}/investigations and archived/merged
  read (200) vs write block (409).
- Strict D-04 enforcement: 403 for ADMIN and RECEPTION on all 5 endpoints.
- Strict DWS-04 enforcement: doctor_b reads succeed (200) with CROSS_DOCTOR_CLINICAL_READ
  audit; doctor_b writes return 404 (ScopeFamily.CLINICAL_WRITE).
- Least-privilege kalyan_app cannot DELETE orders or UPDATE/DELETE append-only results.
"""

from datetime import UTC, datetime
from typing import Any

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.orm import Session

from kalyan_api.models import (
    AuditLog,
    ClinicalEncounter,
    InvestigationOrder,
    InvestigationResult,
    Patient,
    User,
)


def _seed_patient(
    db_session: Session,
    *,
    urn: str,
    full_name: str = "Investigation Patient",
) -> Patient:
    patient = Patient(
        urn=urn,
        full_name=full_name,
        guardian_name="Guardian",
        gender="F",
        age_years=36,
        mobile="9876502222",
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
) -> ClinicalEncounter:
    assert doctor_user.doctor_id is not None
    enc = ClinicalEncounter(
        patient_id=patient.id,
        doctor_id=doctor_user.doctor_id,
        encounter_date=datetime(2026, 11, 2, 7, 0, tzinfo=UTC),
        symptoms="Fatigue and joint stiffness",
        clinical_notes="Ordered baseline workup",
        diagnosis="Suspected rheumatoid arthritis",
        created_by_user_id=doctor_user.id,
    )
    db_session.add(enc)
    db_session.flush()
    return enc


def test_investigation_lifecycle_transitions_cancel_and_results(
    login_client: Any,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Order -> SAMPLE_COLLECTED -> result -> COMPLETED, invalid transitions 422, cancel reason."""
    doc_a_c = login_client(doctor_a_user)
    patient = _seed_patient(db_session, urn="KH-2026-INV1")
    enc = _seed_encounter(db_session, patient=patient, doctor_user=doctor_a_user)

    # 1. Create order -> 201 ORDERED + INVESTIGATION_ORDERED audit
    order_resp = doc_a_c.post(
        f"/api/encounters/{enc.id}/investigations",
        json={
            "category": "LAB",
            "test_name": "Complete Blood Count (CBC)",
            "priority": "URGENT",
            "instructions": "Collect EDTA sample",
        },
    )
    assert order_resp.status_code == 201, order_resp.text
    order = order_resp.json()
    assert order["status"] == "ORDERED"
    assert order["priority"] == "URGENT"
    assert order["encounter_code"] == enc.encounter_code
    assert order["version_id"] == 1
    assert order["results"] == []

    ord_audit = db_session.scalar(
        select(AuditLog)
        .where(
            AuditLog.action == "INVESTIGATION_ORDERED",
            AuditLog.entity_id == str(order["id"]),
        )
        .order_by(AuditLog.id.desc())
    )
    assert ord_audit is not None
    assert ord_audit.after_data["test_name"] == "Complete Blood Count (CBC)"

    # 2. Stale version_id -> 409 version_conflict
    stale = doc_a_c.patch(
        f"/api/investigations/{order['id']}/status",
        json={"status": "SAMPLE_COLLECTED", "version_id": 99},
    )
    assert stale.status_code == 409
    assert stale.json()["code"] == "version_conflict"

    # 3. Advance ORDERED -> SAMPLE_COLLECTED -> 200 + INVESTIGATION_UPDATED audit
    collected = doc_a_c.patch(
        f"/api/investigations/{order['id']}/status",
        json={"status": "SAMPLE_COLLECTED", "version_id": 1},
    )
    assert collected.status_code == 200, collected.text
    assert collected.json()["status"] == "SAMPLE_COLLECTED"
    assert collected.json()["version_id"] == 2

    upd_audit = db_session.scalar(
        select(AuditLog)
        .where(
            AuditLog.action == "INVESTIGATION_UPDATED",
            AuditLog.entity_id == str(order["id"]),
        )
        .order_by(AuditLog.id.desc())
    )
    assert upd_audit is not None
    assert upd_audit.before_data["status"] == "ORDERED"
    assert upd_audit.after_data["status"] == "SAMPLE_COLLECTED"

    # 4. Invalid reverse transition SAMPLE_COLLECTED -> ORDERED -> 422
    bad_rev = doc_a_c.patch(
        f"/api/investigations/{order['id']}/status",
        json={"status": "ORDERED", "version_id": 2},
    )
    assert bad_rev.status_code == 422
    assert bad_rev.json()["code"] == "invalid_status_transition"

    # 5. Record result -> 201 + atomically transitions order to COMPLETED
    res1 = doc_a_c.post(
        f"/api/investigations/{order['id']}/results",
        json={
            "summary_text": "Mild anemia noted; WBC normal",
            "result_value": "10.8",
            "unit": "g/dL",
            "reference_range": "12.0-15.5",
            "is_abnormal": True,
            "reported_at": "2026-11-02T09:00:00Z",
        },
    )
    assert res1.status_code == 201, res1.text
    r1 = res1.json()
    assert r1["is_abnormal"] is True
    assert r1["recorded_by_username"] == doctor_a_user.username

    res_audit = db_session.scalar(
        select(AuditLog)
        .where(
            AuditLog.action == "INVESTIGATION_RESULT_RECORDED",
            AuditLog.entity_id == str(r1["id"]),
        )
        .order_by(AuditLog.id.desc())
    )
    assert res_audit is not None
    assert res_audit.after_data["order_status_before"] == "SAMPLE_COLLECTED"
    assert res_audit.after_data["order_status_after"] == "COMPLETED"

    # Append a newer supplemental result -> results returned newest-first
    res2 = doc_a_c.post(
        f"/api/investigations/{order['id']}/results",
        json={
            "summary_text": "Peripheral smear: normocytic normochromic",
            "is_abnormal": False,
            "reported_at": "2026-11-02T11:30:00Z",
        },
    )
    assert res2.status_code == 201, res2.text
    r2 = res2.json()

    enc_list = doc_a_c.get(f"/api/encounters/{enc.id}/investigations")
    assert enc_list.status_code == 200
    orders_data = enc_list.json()
    assert len(orders_data) == 1
    assert orders_data[0]["status"] == "COMPLETED"
    assert [r["id"] for r in orders_data[0]["results"]] == [r2["id"], r1["id"]]

    # 6. Terminal COMPLETED rejects any further status transition -> 422
    comp_ver = orders_data[0]["version_id"]
    for target in ("ORDERED", "SAMPLE_COLLECTED", "CANCELLED"):
        resp = doc_a_c.patch(
            f"/api/investigations/{order['id']}/status",
            json={
                "status": target,
                "cancelled_reason": "Trying to cancel completed" if target == "CANCELLED" else None,
                "version_id": comp_ver,
            },
        )
        assert resp.status_code == 422
        assert resp.json()["code"] == "invalid_status_transition"

    # 7. Cancel workflow: requires trimmed reason >= 3 chars; terminal CANCELLED blocks results
    order2 = doc_a_c.post(
        f"/api/encounters/{enc.id}/investigations",
        json={"category": "IMAGING", "test_name": "X-Ray Knee AP/Lat"},
    ).json()

    for bad_reason in (None, "   ", "no"):
        bad_cancel = doc_a_c.patch(
            f"/api/investigations/{order2['id']}/status",
            json={"status": "CANCELLED", "cancelled_reason": bad_reason, "version_id": 1},
        )
        assert bad_cancel.status_code == 422
        assert bad_cancel.json()["code"] == "cancelled_reason_required"

    good_cancel = doc_a_c.patch(
        f"/api/investigations/{order2['id']}/status",
        json={
            "status": "CANCELLED",
            "cancelled_reason": "Patient brought recent external X-Ray",
            "version_id": 1,
        },
    )
    assert good_cancel.status_code == 200, good_cancel.text
    assert good_cancel.json()["status"] == "CANCELLED"
    assert good_cancel.json()["cancelled_reason"] == "Patient brought recent external X-Ray"

    # Recording result on CANCELLED order -> 422 order_cancelled
    res_on_cancelled = doc_a_c.post(
        f"/api/investigations/{order2['id']}/results",
        json={"summary_text": "Should fail"},
    )
    assert res_on_cancelled.status_code == 422
    assert res_on_cancelled.json()["code"] == "order_cancelled"

    # Transitioning out of CANCELLED -> 422 invalid_status_transition
    uncancel = doc_a_c.patch(
        f"/api/investigations/{order2['id']}/status",
        json={"status": "ORDERED", "version_id": good_cancel.json()["version_id"]},
    )
    assert uncancel.status_code == 422
    assert uncancel.json()["code"] == "invalid_status_transition"


def test_investigations_rbac_dws04_and_alias_consolidation(
    login_client: Any,
    admin_user: User,
    reception_user: User,
    doctor_a_user: User,
    doctor_b_user: User,
    db_session: Session,
) -> None:
    """D-04 403 for Admin/Reception, DWS-04 cross-doctor audit & 404 writes, alias consolidation."""
    admin_c = login_client(admin_user)
    rec_c = login_client(reception_user)
    doc_a_c = login_client(doctor_a_user)
    doc_b_c = login_client(doctor_b_user)

    master = _seed_patient(db_session, urn="KH-2026-INV2", full_name="Master Inv Patient")
    secondary = _seed_patient(db_session, urn="KH-2026-INV3", full_name="Secondary Inv Patient")
    archived = _seed_patient(db_session, urn="KH-2026-INV4", full_name="Archived Inv Patient")

    enc_master = _seed_encounter(db_session, patient=master, doctor_user=doctor_a_user)
    enc_sec = _seed_encounter(db_session, patient=secondary, doctor_user=doctor_a_user)
    enc_arch = _seed_encounter(db_session, patient=archived, doctor_user=doctor_a_user)
    archived.is_archived = True
    archived.archived_at = datetime.now(UTC)
    db_session.flush()

    order_payload = {"category": "PATHOLOGY", "test_name": "ESR", "priority": "ROUTINE"}

    # Order on master & secondary
    m_order = doc_a_c.post(
        f"/api/encounters/{enc_master.id}/investigations", json=order_payload
    ).json()
    s_order = doc_a_c.post(
        f"/api/encounters/{enc_sec.id}/investigations",
        json={"category": "DIAGNOSTIC", "test_name": "ECG 12-Lead"},
    ).json()

    # D-04: Admin & Reception strictly 403 on all 5 endpoints
    for forbidden_c in (admin_c, rec_c):
        assert (
            forbidden_c.post(
                f"/api/encounters/{enc_master.id}/investigations", json=order_payload
            ).status_code
            == 403
        )
        assert forbidden_c.get(f"/api/encounters/{enc_master.id}/investigations").status_code == 403
        assert forbidden_c.get(f"/api/patients/{master.id}/investigations").status_code == 403
        assert (
            forbidden_c.patch(
                f"/api/investigations/{m_order['id']}/status",
                json={"status": "SAMPLE_COLLECTED", "version_id": 1},
            ).status_code
            == 403
        )
        assert (
            forbidden_c.post(
                f"/api/investigations/{m_order['id']}/results",
                json={"summary_text": "Blocked"},
            ).status_code
            == 403
        )

    # DWS-04: doctor_b reads succeed with CROSS_DOCTOR_CLINICAL_READ audit; writes -> 404
    enc_read_b = doc_b_c.get(f"/api/encounters/{enc_master.id}/investigations")
    assert enc_read_b.status_code == 200
    assert len(enc_read_b.json()) == 1

    enc_cross = db_session.scalar(
        select(AuditLog)
        .where(
            AuditLog.action == "CROSS_DOCTOR_CLINICAL_READ",
            AuditLog.actor_user_id == doctor_b_user.id,
            AuditLog.entity_id == str(enc_master.id),
        )
        .order_by(AuditLog.id.desc())
    )
    assert enc_cross is not None

    pat_read_b = doc_b_c.get(f"/api/patients/{master.id}/investigations")
    assert pat_read_b.status_code == 200

    pat_cross = db_session.scalar(
        select(AuditLog)
        .where(
            AuditLog.action == "CROSS_DOCTOR_CLINICAL_READ",
            AuditLog.actor_user_id == doctor_b_user.id,
            AuditLog.entity_id == str(master.id),
        )
        .order_by(AuditLog.id.desc())
    )
    assert pat_cross is not None
    assert pat_cross.after_data["source"] == "patient_investigations_list"
    assert m_order["id"] in pat_cross.after_data["record_ids"]

    assert (
        doc_b_c.post(
            f"/api/encounters/{enc_master.id}/investigations", json=order_payload
        ).status_code
        == 404
    )
    assert (
        doc_b_c.patch(
            f"/api/investigations/{m_order['id']}/status",
            json={"status": "SAMPLE_COLLECTED", "version_id": 1},
        ).status_code
        == 404
    )
    assert (
        doc_b_c.post(
            f"/api/investigations/{m_order['id']}/results",
            json={"summary_text": "Cross-doctor write blocked"},
        ).status_code
        == 404
    )

    # Archived patient: order creation blocked (409), read succeeds (200)
    assert (
        doc_a_c.post(
            f"/api/encounters/{enc_arch.id}/investigations", json=order_payload
        ).status_code
        == 409
    )
    assert doc_a_c.get(f"/api/patients/{archived.id}/investigations").status_code == 200

    # Merge secondary into master -> master consolidates both orders; secondary read still 200
    secondary.merged_into_id = master.id
    secondary.merged_at = datetime.now(UTC)
    secondary.is_active = False
    db_session.flush()

    assert (
        doc_a_c.post(
            f"/api/encounters/{enc_sec.id}/investigations", json=order_payload
        ).status_code
        == 409
    )
    assert doc_a_c.get(f"/api/patients/{secondary.id}/investigations").status_code == 200

    consolidated = doc_a_c.get(f"/api/patients/{master.id}/investigations")
    assert consolidated.status_code == 200
    assert {row["id"] for row in consolidated.json()} == {m_order["id"], s_order["id"]}


def test_kalyan_app_least_privilege_on_investigation_tables(
    db_session: Session,
    doctor_a_user: User,
) -> None:
    """kalyan_app cannot DELETE investigation_orders or UPDATE/DELETE investigation_results."""
    patient = _seed_patient(db_session, urn="KH-2026-IPRIV")
    enc = _seed_encounter(db_session, patient=patient, doctor_user=doctor_a_user)
    assert doctor_a_user.doctor_id is not None

    order = InvestigationOrder(
        encounter_id=enc.id,
        patient_id=patient.id,
        doctor_id=doctor_a_user.doctor_id,
        category="LAB",
        test_name="HbA1c",
        priority="ROUTINE",
        status="ORDERED",
    )
    db_session.add(order)
    db_session.flush()

    result = InvestigationResult(
        order_id=order.id,
        patient_id=patient.id,
        summary_text="6.1%",
        recorded_by_user_id=doctor_a_user.id,
    )
    db_session.add(result)
    db_session.flush()

    with db_session.begin_nested() as sp1:
        with pytest.raises(ProgrammingError):
            db_session.execute(
                text("UPDATE investigation_results SET summary_text = 'tamper' WHERE id = :rid"),
                {"rid": result.id},
            )
        sp1.rollback()

    with db_session.begin_nested() as sp2:
        with pytest.raises(ProgrammingError):
            db_session.execute(
                text("DELETE FROM investigation_results WHERE id = :rid"),
                {"rid": result.id},
            )
        sp2.rollback()

    with db_session.begin_nested() as sp3:
        with pytest.raises(ProgrammingError):
            db_session.execute(
                text("DELETE FROM investigation_orders WHERE id = :oid"),
                {"oid": order.id},
            )
        sp3.rollback()


def test_create_investigation_order_rejects_finalised_encounter(
    login_client: Any,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Cannot order investigations for finalised encounters (HTTP 400 encounter_finalised)."""
    doc_a_c = login_client(doctor_a_user)
    patient = _seed_patient(db_session, urn="KH-2026-INV-FIN")
    enc = _seed_encounter(db_session, patient=patient, doctor_user=doctor_a_user)

    # Finalise the encounter
    finalise_resp = doc_a_c.post(
        f"/api/encounters/{enc.id}/finalise",
        json={"symptoms": "Resolved headache", "diagnosis": "Tension headache"},
    )
    assert finalise_resp.status_code == 200, finalise_resp.text
    assert finalise_resp.json()["is_finalised"] is True

    # Ordering investigations on finalised encounter must fail with 400 encounter_finalised
    order_resp = doc_a_c.post(
        f"/api/encounters/{enc.id}/investigations",
        json={
            "category": "LAB",
            "test_name": "Serum Creatinine",
            "priority": "ROUTINE",
            "instructions": "Standard panel",
        },
    )
    assert order_resp.status_code == 400, order_resp.text
    err = order_resp.json()
    assert err["code"] == "encounter_finalised"
    assert "finalised" in err["message"].lower()

