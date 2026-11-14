"""SEC-04 remainder and BR-010: timeline scope and cross-doctor read audit on list endpoints.

Policy under test (core/scope.py, DWS-04): a doctor may read another doctor's clinical rows, and
every such read is audited. Appointments are not clinical rows; a doctor reads only their own,
exactly as the direct appointment endpoints enforce.

- The patient timeline must not give a doctor another doctor's appointments.
- The timeline audit must also cover other doctors' treatment plans and sessions.
- The encounter, prescription and treatment-plan list endpoints must write the same
  CROSS_DOCTOR_CLINICAL_READ event that single-record reads write, and must stay silent when
  the doctor reads only their own rows.
"""

from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from test_timeline_api import _seed_patient_activity

from kalyan_api.models import AuditLog, ClinicalEncounter, Prescription, TreatmentPlan, User


def _cross_reads(db_session: Session, actor: User) -> list[AuditLog]:
    db_session.expire_all()
    return list(
        db_session.scalars(
            select(AuditLog)
            .where(
                AuditLog.action == "CROSS_DOCTOR_CLINICAL_READ",
                AuditLog.actor_user_id == actor.id,
            )
            .order_by(AuditLog.id)
        )
    )


def _seed(db_session: Session, doctor_a: User, doctor_b: User, admin: User):
    """Patient whose appointment, plan and session belong to doctor A, plus encounters of both."""
    return _seed_patient_activity(db_session, doctor_a.doctor_id, doctor_b.doctor_id, admin)


# ------------------------------------------------------------------ timeline appointments


def test_timeline_hides_other_doctors_appointments_from_a_doctor(
    login_client: Any,
    doctor_a_user: User,
    doctor_b_user: User,
    admin_user: User,
    db_session: Session,
) -> None:
    patient = _seed(db_session, doctor_a_user, doctor_b_user, admin_user)

    as_b = login_client(doctor_b_user).get(f"/api/patients/{patient.id}/timeline")
    assert as_b.status_code == 200
    assert [i for i in as_b.json() if i["event_type"] == "APPOINTMENT"] == []

    as_a = login_client(doctor_a_user).get(f"/api/patients/{patient.id}/timeline")
    assert len([i for i in as_a.json() if i["event_type"] == "APPOINTMENT"]) == 1


def test_timeline_appointments_stay_visible_to_reception_and_admin(
    login_client: Any,
    doctor_a_user: User,
    doctor_b_user: User,
    admin_user: User,
    reception_user: User,
    db_session: Session,
) -> None:
    patient = _seed(db_session, doctor_a_user, doctor_b_user, admin_user)
    for user in (reception_user, admin_user):
        resp = login_client(user).get(f"/api/patients/{patient.id}/timeline")
        assert resp.status_code == 200
        assert len([i for i in resp.json() if i["event_type"] == "APPOINTMENT"]) == 1


# ------------------------------------------------------------------ timeline audit


def test_timeline_audit_covers_other_doctors_plans_and_sessions(
    login_client: Any,
    doctor_a_user: User,
    doctor_b_user: User,
    admin_user: User,
    db_session: Session,
) -> None:
    patient = _seed(db_session, doctor_a_user, doctor_b_user, admin_user)
    plan = db_session.scalar(select(TreatmentPlan).where(TreatmentPlan.patient_id == patient.id))

    resp = login_client(doctor_b_user).get(f"/api/patients/{patient.id}/timeline")
    assert resp.status_code == 200

    rows = _cross_reads(db_session, doctor_b_user)
    assert len(rows) == 1
    details = rows[0].after_data or {}
    assert details["source"] == "patient_timeline"
    assert details["treatment_plan_ids"] == [plan.id]
    assert len(details["session_ids"]) == 1


def test_timeline_of_own_records_writes_no_cross_doctor_audit(
    login_client: Any,
    doctor_a_user: User,
    admin_user: User,
    db_session: Session,
) -> None:
    patient = _seed_patient_activity(
        db_session, doctor_a_user.doctor_id, doctor_a_user.doctor_id, admin_user
    )
    resp = login_client(doctor_a_user).get(f"/api/patients/{patient.id}/timeline")
    assert resp.status_code == 200
    assert _cross_reads(db_session, doctor_a_user) == []


# ------------------------------------------------------------------ list endpoints


def test_encounter_list_audits_other_doctors_rows(
    login_client: Any,
    doctor_a_user: User,
    doctor_b_user: User,
    admin_user: User,
    db_session: Session,
) -> None:
    patient = _seed(db_session, doctor_a_user, doctor_b_user, admin_user)
    foreign = db_session.scalar(
        select(ClinicalEncounter).where(
            ClinicalEncounter.patient_id == patient.id,
            ClinicalEncounter.doctor_id == doctor_a_user.doctor_id,
        )
    )

    resp = login_client(doctor_b_user).get(f"/api/patients/{patient.id}/encounters")
    assert resp.status_code == 200
    assert len(resp.json()) == 2  # read-all policy is unchanged

    rows = _cross_reads(db_session, doctor_b_user)
    assert len(rows) == 1
    details = rows[0].after_data or {}
    assert details["source"] == "patient_encounters_list"
    assert details["actor_doctor_id"] == doctor_b_user.doctor_id
    assert details["record_ids"] == [foreign.id]
    assert str(rows[0].entity_id) == str(patient.id)


def test_prescription_list_audits_other_doctors_rows(
    login_client: Any,
    doctor_a_user: User,
    doctor_b_user: User,
    admin_user: User,
    db_session: Session,
) -> None:
    patient = _seed(db_session, doctor_a_user, doctor_b_user, admin_user)
    foreign = db_session.scalar(select(Prescription).where(Prescription.patient_id == patient.id))

    resp = login_client(doctor_b_user).get(f"/api/patients/{patient.id}/prescriptions")
    assert resp.status_code == 200
    assert len(resp.json()) == 1

    rows = _cross_reads(db_session, doctor_b_user)
    assert len(rows) == 1
    details = rows[0].after_data or {}
    assert details["source"] == "patient_prescriptions_list"
    assert details["record_ids"] == [foreign.id]


def test_treatment_plan_list_audits_other_doctors_rows(
    login_client: Any,
    doctor_a_user: User,
    doctor_b_user: User,
    admin_user: User,
    db_session: Session,
) -> None:
    patient = _seed(db_session, doctor_a_user, doctor_b_user, admin_user)
    foreign = db_session.scalar(select(TreatmentPlan).where(TreatmentPlan.patient_id == patient.id))

    resp = login_client(doctor_b_user).get(f"/api/patients/{patient.id}/treatment-plans")
    assert resp.status_code == 200
    assert len(resp.json()) == 1

    rows = _cross_reads(db_session, doctor_b_user)
    assert len(rows) == 1
    details = rows[0].after_data or {}
    assert details["source"] == "patient_treatment_plans_list"
    assert details["record_ids"] == [foreign.id]


def test_list_endpoints_write_no_audit_for_a_doctors_own_rows(
    login_client: Any,
    doctor_a_user: User,
    admin_user: User,
    db_session: Session,
) -> None:
    patient = _seed_patient_activity(
        db_session, doctor_a_user.doctor_id, doctor_a_user.doctor_id, admin_user
    )
    client: TestClient = login_client(doctor_a_user)
    for path in ("encounters", "prescriptions", "treatment-plans"):
        resp = client.get(f"/api/patients/{patient.id}/{path}")
        assert resp.status_code == 200, (path, resp.text)
        assert resp.json(), path
    assert _cross_reads(db_session, doctor_a_user) == []
