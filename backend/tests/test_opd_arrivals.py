"""Persisted pending OPD arrivals and atomic promotion into permanent patient records."""

from sqlalchemy import func, select

from kalyan_api import clock as app_clock
from kalyan_api.models import Appointment, AuditLog, Patient, PendingOpdArrival


def _draft_payload(doctor_user, **overrides):
    body = {
        "full_name": "Nisha Kumari",
        "age_years": 32,
        "mobile": "9876500142",
        "doctor_id": doctor_user.doctor_id,
        "department_id": doctor_user.doctor.departments[0].id,
        "priority_level": "PRIORITY",
        "priority_reason": "Needs preferential attention",
    }
    body.update(overrides)
    return body


def _patient_payload(**overrides):
    body = {
        "full_name": "Nisha Kumari",
        "guardian_name": "Suresh Kumar",
        "gender": "F",
        "age_years": 32,
        "mobile": "9876500142",
        "address": "Station Road, Ara",
        "district": "Bhojpur",
        "state": "Bihar",
        "allergies": "None reported",
    }
    body.update(overrides)
    return body


def test_pending_arrival_reserves_doctor_token_without_creating_patient(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    client = login_client(reception_user)
    response = client.post("/api/opd-arrivals", json=_draft_payload(doctor_a_user))

    assert response.status_code == 201, response.text
    data = response.json()
    assert data["status"] == "TO_ARRIVE"
    assert data["token_number"] >= 1
    assert data["priority_level"] == "PRIORITY"
    assert data["priority_reason"] == "Needs preferential attention"
    assert data["appointment_date"] == app_clock.ist_today().isoformat()
    assert data["mobile"] == "9876500142"

    persisted = db_session.get(PendingOpdArrival, data["id"])
    assert persisted is not None
    assert persisted.created_by_user_id == reception_user.id
    assert persisted.patient_id is None
    assert persisted.appointment_id is None
    reloaded = client.get(f"/api/opd-arrivals?arrival_date={data['appointment_date']}")
    assert reloaded.status_code == 200, reloaded.text
    assert any(item["id"] == data["id"] for item in reloaded.json()["arrivals"])
    assert (
        db_session.scalar(
            select(func.count()).select_from(Patient).where(Patient.full_name == "Nisha Kumari")
        )
        == 0
    )


def test_duplicate_pending_arrival_for_same_mobile_and_doctor_is_refused(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    client = login_client(reception_user)
    first = client.post("/api/opd-arrivals", json=_draft_payload(doctor_a_user))
    assert first.status_code == 201, first.text

    duplicate = client.post("/api/opd-arrivals", json=_draft_payload(doctor_a_user))

    assert duplicate.status_code == 409
    assert duplicate.json()["code"] == "duplicate_opd_arrival"
    assert duplicate.json()["details"]["existing_token_number"] == first.json()["token_number"]
    assert (
        db_session.scalar(
            select(func.count())
            .select_from(PendingOpdArrival)
            .where(
                PendingOpdArrival.mobile == "9876500142",
                PendingOpdArrival.doctor_id == doctor_a_user.doctor_id,
                PendingOpdArrival.appointment_date == app_clock.ist_today(),
                PendingOpdArrival.status == "TO_ARRIVE",
            )
        )
        == 1
    )


def test_pending_arrival_priority_change_requires_reason_and_audits_staff(
    login_client, reception_user, doctor_a_user, db_session
):
    client = login_client(reception_user)
    created = client.post(
        "/api/opd-arrivals",
        json=_draft_payload(doctor_a_user, priority_level="NORMAL", priority_reason=None),
    )
    assert created.status_code == 201, created.text
    draft = created.json()

    response = client.patch(
        f"/api/opd-arrivals/{draft['id']}/priority",
        json={
            "version_id": draft["version_id"],
            "priority_level": "EMERGENCY",
            "reason": "Severe acute pain",
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["priority_level"] == "EMERGENCY"
    assert response.json()["priority_reason"] == "Severe acute pain"
    assert response.json()["version_id"] == draft["version_id"] + 1
    event = db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "OPD_ARRIVAL_PRIORITY_CHANGED",
            AuditLog.entity_id == str(draft["id"]),
        )
    )
    assert event is not None
    assert event.actor_user_id == reception_user.id
    assert event.reason == "Severe acute pain"

    missing_reason = client.patch(
        f"/api/opd-arrivals/{draft['id']}/priority",
        json={
            "version_id": response.json()["version_id"],
            "priority_level": "NORMAL",
            "reason": " ",
        },
    )
    assert missing_reason.status_code == 422


def test_registration_promotes_pending_arrival_with_same_token_and_priority(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    client = login_client(reception_user)
    created = client.post("/api/opd-arrivals", json=_draft_payload(doctor_a_user))
    assert created.status_code == 201, created.text
    draft = created.json()

    response = client.post(
        f"/api/opd-arrivals/{draft['id']}/register",
        json={"version_id": draft["version_id"], "patient": _patient_payload()},
    )

    assert response.status_code == 201, response.text
    appointment_data = response.json()
    assert appointment_data["status"] == "REGISTERED"
    assert appointment_data["patient_urn"].startswith("KH-")
    assert appointment_data["token_number"] == draft["token_number"]
    assert appointment_data["priority_level"] == "PRIORITY"
    assert appointment_data["priority_reason"] == "Needs preferential attention"
    assert appointment_data["patient_age"] == 32
    assert appointment_data["department_name"] == doctor_a_user.doctor.departments[0].name_en

    persisted_draft = db_session.get(PendingOpdArrival, draft["id"])
    appointment = db_session.get(Appointment, appointment_data["id"])
    patient = db_session.get(Patient, appointment_data["patient_id"])
    assert persisted_draft.status == "REGISTERED"
    assert persisted_draft.patient_id == patient.id
    assert persisted_draft.appointment_id == appointment.id
    assert appointment.token_number == persisted_draft.token_number
    assert appointment.status == "REGISTERED"
    assert appointment.patient_id == patient.id
    assert (
        db_session.scalar(
            select(func.count())
            .select_from(AuditLog)
            .where(
                AuditLog.action == "OPD_ARRIVAL_CREATED",
                AuditLog.entity_id == str(draft["id"]),
            )
        )
        == 1
    )

    retry = client.post(
        f"/api/opd-arrivals/{draft['id']}/register",
        json={"version_id": draft["version_id"], "patient": _patient_payload()},
    )
    assert retry.status_code == 201, retry.text
    assert retry.json()["id"] == appointment.id
    assert retry.json()["patient_id"] == patient.id
    linked_draft = client.get(f"/api/opd-arrivals/{draft['id']}")
    assert linked_draft.status_code == 200
    assert linked_draft.json()["appointment_id"] == appointment.id
    assert linked_draft.json()["patient_id"] == patient.id
    assert (
        db_session.scalar(
            select(func.count())
            .select_from(AuditLog)
            .where(
                AuditLog.action == "PATIENT_REGISTERED",
                AuditLog.entity_id == str(patient.id),
            )
        )
        == 1
    )


def test_registration_mismatch_saves_neither_patient_nor_appointment(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    client = login_client(reception_user)
    created = client.post("/api/opd-arrivals", json=_draft_payload(doctor_a_user))
    assert created.status_code == 201, created.text
    draft = created.json()

    response = client.post(
        f"/api/opd-arrivals/{draft['id']}/register",
        json={
            "version_id": draft["version_id"],
            "patient": _patient_payload(full_name="Different Name"),
        },
    )

    assert response.status_code == 422
    assert (
        db_session.scalar(
            select(func.count()).select_from(Patient).where(Patient.full_name == "Nisha Kumari")
        )
        == 0
    )
    assert (
        db_session.scalar(
            select(func.count())
            .select_from(Appointment)
            .where(
                Appointment.doctor_id == doctor_a_user.doctor_id,
                Appointment.appointment_date == app_clock.ist_today(),
                Appointment.token_number == draft["token_number"],
            )
        )
        == 0
    )
    persisted = db_session.get(PendingOpdArrival, draft["id"])
    assert persisted.status == "TO_ARRIVE"
    assert persisted.patient_id is None
    assert persisted.appointment_id is None


def test_arrival_requires_priority_reason_and_existing_permissions(
    login_client, reception_user, doctor_a_user
):
    reception = login_client(reception_user)
    no_reason = reception.post(
        "/api/opd-arrivals",
        json=_draft_payload(doctor_a_user, priority_level="EMERGENCY", priority_reason=" "),
    )
    assert no_reason.status_code == 422

    doctor = login_client(doctor_a_user)
    denied = doctor.post(
        "/api/opd-arrivals",
        json=_draft_payload(doctor_a_user, priority_level="NORMAL", priority_reason=None),
    )
    assert denied.status_code == 403

