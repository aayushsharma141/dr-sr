"""Phase 22 check-in: new-patient check-in, visit type, referral and classification.

Owner decisions of 2026-11-15 (.planning/phases/22-integrated-opd-workflow/22-DESIGN.md):
OD-22-03 a first-time patient is registered and checked in in one step; OD-22-05 the visit
type is recorded only; OD-22-06/07/09 Priority and Emergency need a reason, never change the
token, and every change is kept; OD-22-16 Referred By is required per visit, defaults to Self
at the desk, and a second consultation the same day keeps the visit's referral.

The clock fixture freezes utcnow at 2026-11-02 04:30 UTC, which is 10:00 IST on 2 Nov 2026.
"""

import pytest
from sqlalchemy import Engine, func, select, text
from sqlalchemy.exc import DBAPIError

from kalyan_api import clock as app_clock
from kalyan_api.models import (
    Appointment,
    AuditLog,
    ConsultationPriorityEvent,
    Patient,
    Visit,
)


def _new_patient_body(doctor_user, name: str = "Sita Devi", **extra):
    return {
        "patient": {
            "full_name": name,
            "guardian_name": "Ram Prasad",
            "gender": "O",
            "age_years": 41,
            "mobile": "9876500011",
            "address": "Station Road, Ara",
        },
        "doctor_id": doctor_user.doctor_id,
        "department_id": doctor_user.doctor.departments[0].id,
        "referral_source": "SELF",
        **extra,
    }


def _patient(db_session, suffix: str) -> Patient:
    patient = Patient(
        urn=f"KH-2026-P22{suffix}",
        full_name=f"Phase Twenty Two {suffix}",
        guardian_name="Guardian",
        gender="F",
        age_years=52,
        mobile="9876500022",
        address="Ara",
    )
    db_session.add(patient)
    db_session.flush()
    return patient


def _walk_in(client, patient, doctor_user, **extra):
    return client.post(
        "/api/appointments/walk-in",
        json={
            "patient_id": patient.id,
            "doctor_id": doctor_user.doctor_id,
            "department_id": doctor_user.doctor.departments[0].id,
            "referral_source": "SELF",
            **extra,
        },
    )


def _events(db_session, appointment_id: int) -> list[ConsultationPriorityEvent]:
    return list(
        db_session.scalars(
            select(ConsultationPriorityEvent)
            .where(ConsultationPriorityEvent.appointment_id == appointment_id)
            .order_by(ConsultationPriorityEvent.id)
        )
    )


# ------------------------------------------------------------------ new-patient check-in


def test_new_patient_check_in_registers_opens_visit_and_issues_token(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    client = login_client(reception_user)

    response = client.post(
        "/api/appointments/walk-in/new-patient", json=_new_patient_body(doctor_a_user)
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["patient_urn"].startswith("KH-")
    assert body["status"] == "ARRIVED"
    assert body["consultation_status"] == "WAITING"
    assert body["token_number"] == 1
    assert body["visit_kind"] == "NEW"
    assert body["priority_level"] == "NORMAL"
    assert body["referral_source"] == "SELF"

    patient = db_session.get(Patient, body["patient_id"])
    assert patient.gender == "O"
    visit = db_session.get(Visit, body["visit_id"])
    assert visit.referral_source == "SELF"
    assert visit.referral_recorded_by_user_id == reception_user.id
    actions = set(
        db_session.scalars(
            select(AuditLog.action).where(
                AuditLog.entity_type == "PATIENT", AuditLog.entity_id == str(patient.id)
            )
        )
    )
    assert "PATIENT_REGISTERED" in actions


def test_new_patient_check_in_saves_nothing_when_check_in_is_refused(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    client = login_client(reception_user)
    body = _new_patient_body(doctor_a_user, name="Never Saved Patient")
    body["department_id"] = 987654  # not a department of this doctor

    response = client.post("/api/appointments/walk-in/new-patient", json=body)

    assert response.status_code >= 400
    count = db_session.scalar(
        select(func.count()).select_from(Patient).where(Patient.full_name == "Never Saved Patient")
    )
    assert count == 0


def test_a_first_visit_cannot_be_a_follow_up(clock, login_client, reception_user, doctor_a_user):
    client = login_client(reception_user)

    response = client.post(
        "/api/appointments/walk-in/new-patient",
        json=_new_patient_body(doctor_a_user, visit_kind="FOLLOW_UP"),
    )

    assert response.status_code == 422


# ------------------------------------------------------------------ referral


def test_referral_is_required_on_every_check_in(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    client = login_client(reception_user)
    patient = _patient(db_session, "R1")
    body = {
        "patient_id": patient.id,
        "doctor_id": doctor_a_user.doctor_id,
        "department_id": doctor_a_user.doctor.departments[0].id,
    }

    missing = client.post("/api/appointments/walk-in", json=body)
    unnamed = client.post("/api/appointments/walk-in", json={**body, "referral_source": "DOCTOR"})

    assert missing.status_code == 422
    assert unnamed.status_code == 422


def test_referral_is_kept_per_visit_and_a_second_consultation_does_not_overwrite_it(
    clock, login_client, reception_user, doctor_a_user, doctor_b_user, db_session
):
    client = login_client(reception_user)
    patient = _patient(db_session, "R2")

    first = _walk_in(
        client,
        patient,
        doctor_a_user,
        referral_source="DOCTOR",
        referrer_name="Dr. Anil Kumar",
        visit_kind="FOLLOW_UP",
    )
    assert first.status_code == 201, first.text
    second = _walk_in(client, patient, doctor_b_user, referral_source="SELF", visit_kind="NEW")
    assert second.status_code == 201, second.text

    assert first.json()["visit_id"] == second.json()["visit_id"]
    assert second.json()["referral_source"] == "DOCTOR"
    assert second.json()["referrer_name"] == "Dr. Anil Kumar"
    assert first.json()["visit_kind"] == "FOLLOW_UP"
    assert second.json()["visit_kind"] == "NEW"


# ------------------------------------------------------------------ classification


def test_priority_and_emergency_need_a_reason(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    client = login_client(reception_user)
    patient = _patient(db_session, "C1")

    response = _walk_in(client, patient, doctor_a_user, priority_level="EMERGENCY")

    assert response.status_code == 422


def test_emergency_at_check_in_alerts_and_is_recorded(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    client = login_client(reception_user)
    patient = _patient(db_session, "C2")

    response = _walk_in(
        client,
        patient,
        doctor_a_user,
        priority_level="EMERGENCY",
        priority_reason="Severe acute pain",
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["priority_level"] == "EMERGENCY"
    assert body["priority_reason"] == "Severe acute pain"
    assert body["emergency_alerted_at"] is not None
    assert body["alert_acknowledged_at"] is None
    events = _events(db_session, body["id"])
    assert [(e.event, e.from_level, e.to_level) for e in events] == [
        ("CLASSIFIED", None, "EMERGENCY")
    ]
    assert events[0].actor_user_id == reception_user.id


def test_reclassifying_keeps_the_token_and_appends_history(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    client = login_client(reception_user)
    checked_in = _walk_in(client, _patient(db_session, "C3"), doctor_a_user).json()
    appt_id = checked_in["id"]

    priority = client.patch(
        f"/api/appointments/{appt_id}/priority",
        json={
            "priority_level": "PRIORITY",
            "priority_reason": "Elderly, 82 years",
            "version_id": checked_in["version_id"],
        },
    )
    assert priority.status_code == 200, priority.text
    emergency = client.patch(
        f"/api/appointments/{appt_id}/priority",
        json={
            "priority_level": "EMERGENCY",
            "priority_reason": "Breathing difficulty",
            "version_id": priority.json()["version_id"],
        },
    )
    assert emergency.status_code == 200, emergency.text
    normal = client.patch(
        f"/api/appointments/{appt_id}/priority",
        json={"priority_level": "NORMAL", "version_id": emergency.json()["version_id"]},
    )
    assert normal.status_code == 200, normal.text

    assert priority.json()["token_number"] == checked_in["token_number"]
    assert emergency.json()["token_number"] == checked_in["token_number"]
    assert emergency.json()["emergency_alerted_at"] is not None
    assert normal.json()["priority_level"] == "NORMAL"
    assert normal.json()["priority_reason"] is None
    assert normal.json()["emergency_alerted_at"] is None
    assert [(e.from_level, e.to_level, e.reason) for e in _events(db_session, appt_id)] == [
        ("NORMAL", "PRIORITY", "Elderly, 82 years"),
        ("PRIORITY", "EMERGENCY", "Breathing difficulty"),
        ("EMERGENCY", "NORMAL", None),
    ]
    audited = db_session.scalar(
        select(func.count())
        .select_from(AuditLog)
        .where(
            AuditLog.entity_type == "appointment",
            AuditLog.entity_id == str(appt_id),
            AuditLog.action == "APPOINTMENT_PRIORITY_CHANGED",
        )
    )
    assert audited == 3


def test_reclassifying_a_stale_version_is_refused(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    client = login_client(reception_user)
    checked_in = _walk_in(client, _patient(db_session, "C4"), doctor_a_user).json()

    stale = client.patch(
        f"/api/appointments/{checked_in['id']}/priority",
        json={
            "priority_level": "PRIORITY",
            "priority_reason": "Pregnant",
            "version_id": checked_in["version_id"] - 1,
        },
    )

    assert stale.status_code == 409


def test_a_patient_not_yet_checked_in_cannot_be_classified(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    patient = _patient(db_session, "C5")
    appt = Appointment(
        patient_id=patient.id,
        doctor_id=doctor_a_user.doctor_id,
        department_id=doctor_a_user.doctor.departments[0].id,
        appointment_date=app_clock.ist_today(),
        status="BOOKED",
        created_by_user_id=reception_user.id,
    )
    db_session.add(appt)
    db_session.flush()

    response = login_client(reception_user).patch(
        f"/api/appointments/{appt.id}/priority",
        json={"priority_level": "PRIORITY", "priority_reason": "Elderly", "version_id": 1},
    )

    assert response.status_code == 422
    assert response.json()["code"] == "classification_closed"


def test_doctor_queue_shows_the_classification(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    client = login_client(reception_user)
    _walk_in(
        client,
        _patient(db_session, "C6"),
        doctor_a_user,
        priority_level="PRIORITY",
        priority_reason="Wheelchair user",
    )

    queue = login_client(doctor_a_user).get("/api/appointments/queue/today")

    assert queue.status_code == 200, queue.text
    waiting = queue.json()["waiting"]
    assert [w["priority_level"] for w in waiting] == ["PRIORITY"]
    assert waiting[0]["priority_reason"] == "Wheelchair user"


def test_classification_history_cannot_be_edited_by_the_application(app_engine: Engine):
    with app_engine.connect() as conn:
        grants = set(
            conn.scalars(
                text(
                    "SELECT privilege_type FROM information_schema.role_table_grants"
                    " WHERE grantee = 'kalyan_app'"
                    " AND table_name = 'consultation_priority_events'"
                )
            )
        )
        assert grants == {"SELECT", "INSERT"}
        with pytest.raises(DBAPIError):
            conn.execute(text("UPDATE consultation_priority_events SET reason = 'x'"))
