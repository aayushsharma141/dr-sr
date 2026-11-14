"""RF-12 slice 2: the token moves to check-in and the status endpoint follows the new rules.

Owner decisions of 2026-11-13: the token is issued at check-in, so a booking has none and queue
order follows arrival; a patient who is checked in can only move through the consultation
(start, complete, cancel), never back to "not arrived"; the doctor can only open a consultation
for a patient reception has checked in; the visit stays open until reception closes it.

The clock fixture freezes utcnow at 2026-11-02 04:30 UTC, which is 10:00 IST on 2 Nov 2026.
"""

from datetime import date, timedelta
from types import SimpleNamespace

import pytest

from kalyan_api.core.errors import ApiError
from kalyan_api.core.permissions import ROLE_PERMISSIONS, Role
from kalyan_api.core.principal import Principal
from kalyan_api.models import Appointment, AppointmentStatus, ConsultationStatus, Patient, Visit
from kalyan_api.services.appointment_service import validate_status_update

TODAY = date(2026, 11, 2)
TOMORROW = TODAY + timedelta(days=1)


def _patient(db_session, suffix: str) -> Patient:
    patient = Patient(
        urn=f"KH-2026-D1{suffix}",
        full_name=f"Cutover Patient {suffix}",
        guardian_name="Guardian",
        gender="F",
        age_years=41,
        mobile="9876543501",
        address="Ara",
    )
    db_session.add(patient)
    db_session.flush()
    return patient


def _book(client, patient, doctor_user, appointment_date=TODAY, **extra) -> dict:
    response = client.post(
        "/api/appointments",
        json={
            "patient_id": patient.id,
            "doctor_id": doctor_user.doctor_id,
            "department_id": doctor_user.doctor.departments[0].id,
            "appointment_date": appointment_date.isoformat(),
            **extra,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _patch_status(client, appointment: dict, status: str, **extra):
    return client.patch(
        f"/api/appointments/{appointment['id']}/status",
        json={"status": status, "version_id": appointment["version_id"], **extra},
    )


def _checked_in(client, patient, doctor_user, appointment_date=TODAY) -> dict:
    """Book, then check in through PATCH /status, as the current screens still do."""
    booking = _book(client, patient, doctor_user, appointment_date)
    response = _patch_status(client, booking, "ARRIVED")
    assert response.status_code == 200, response.text
    return response.json()


# ----------------------------------------------------------- token at check-in


def test_booking_has_no_token_and_check_in_issues_them_in_arrival_order(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    client = login_client(reception_user)
    first = _book(client, _patient(db_session, "T1"), doctor_a_user)
    second = _book(client, _patient(db_session, "T2"), doctor_a_user)
    assert first["token_number"] is None
    assert second["token_number"] is None

    # The patient booked second arrives first, so they are first in the queue.
    assert _patch_status(client, second, "ARRIVED").json()["token_number"] == 1
    assert _patch_status(client, first, "ARRIVED").json()["token_number"] == 2


def test_arrived_through_the_status_endpoint_is_a_real_check_in(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    patient = _patient(db_session, "T3")
    client = login_client(reception_user)

    arrived = _checked_in(client, patient, doctor_a_user)

    assert arrived["status"] == "ARRIVED"
    assert arrived["consultation_status"] == "WAITING"
    assert arrived["token_number"] == 1
    assert arrived["visit_id"] is not None
    assert arrived["check_in_at"] is not None
    visit = db_session.get(Visit, arrived["visit_id"])
    assert visit is not None and visit.patient_id == patient.id and visit.status == "OPEN"


def test_a_doctor_cannot_check_a_patient_in_through_the_status_endpoint(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    booking = _book(login_client(reception_user), _patient(db_session, "T4"), doctor_a_user)

    response = _patch_status(login_client(doctor_a_user), booking, "ARRIVED")

    assert response.status_code == 403
    assert response.json()["code"] == "reception_only"
    assert db_session.get(Appointment, booking["id"]).status == "BOOKED"


def test_the_status_endpoint_checks_in_only_on_the_appointment_date(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    client = login_client(reception_user)
    booking = _book(client, _patient(db_session, "T5"), doctor_a_user, TOMORROW)

    response = _patch_status(client, booking, "ARRIVED")

    assert response.status_code == 422
    assert response.json()["code"] == "check_in_wrong_day"


def test_setting_the_same_status_again_is_refused(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    client = login_client(reception_user)
    arrived = _checked_in(client, _patient(db_session, "T6"), doctor_a_user)

    response = _patch_status(client, arrived, "ARRIVED")

    assert response.status_code == 422
    assert response.json()["code"] == "status_unchanged"


# ----------------------------------------------------- not arrived and cancelled


def test_a_checked_in_patient_cannot_be_marked_not_arrived(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    client = login_client(reception_user)
    arrived = _checked_in(client, _patient(db_session, "N1"), doctor_a_user)

    response = _patch_status(client, arrived, "NO_SHOW")

    assert response.status_code == 422
    assert response.json()["code"] == "invalid_status_transition"
    assert db_session.get(Appointment, arrived["id"]).status == "ARRIVED"


def test_not_arrived_cannot_be_marked_before_the_appointment_date(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    client = login_client(reception_user)
    booking = _book(client, _patient(db_session, "N2"), doctor_a_user, TOMORROW)

    response = _patch_status(client, booking, "NO_SHOW")

    assert response.status_code == 422
    assert response.json()["code"] == "no_show_before_date"


def test_a_booking_cannot_jump_to_a_consultation_status(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    booking = _book(login_client(reception_user), _patient(db_session, "N3"), doctor_a_user)

    for target in ("IN_CONSULTATION", "DONE", "RESCHEDULED"):
        response = _patch_status(login_client(doctor_a_user), booking, target)
        assert response.status_code == 422, (target, response.text)
        assert response.json()["code"] == "invalid_status_transition"


# ------------------------------------------------------- consultation, in step


def test_the_consultation_status_follows_the_doctor_through_the_status_endpoint(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    reception = login_client(reception_user)
    doctor = login_client(doctor_a_user)
    arrived = _checked_in(reception, _patient(db_session, "C1"), doctor_a_user)

    # Reception cannot start a consultation; only the treating doctor can.
    refused = _patch_status(reception, arrived, "IN_CONSULTATION")
    assert (refused.status_code, refused.json()["code"]) == (403, "doctor_status_forbidden")

    started = _patch_status(doctor, arrived, "IN_CONSULTATION")
    assert started.status_code == 200, started.text
    assert started.json()["consultation_status"] == "IN_CONSULTATION"
    assert started.json()["status"] == "IN_CONSULTATION"

    done = _patch_status(doctor, started.json(), "DONE")
    assert done.status_code == 200, done.text
    assert done.json()["consultation_status"] == "COMPLETED"
    assert done.json()["status"] == "DONE"


def test_cancelling_the_consultation_needs_a_reason_and_lets_the_visit_be_cancelled(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    client = login_client(reception_user)
    arrived = _checked_in(client, _patient(db_session, "C2"), doctor_a_user)

    no_reason = _patch_status(client, arrived, "CANCELLED")
    assert (no_reason.status_code, no_reason.json()["code"]) == (
        422,
        "cancellation_reason_required",
    )

    cancelled = _patch_status(
        client, arrived, "CANCELLED", cancellation_reason="Patient left before being seen"
    )
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["consultation_status"] == "CANCELLED"
    assert cancelled.json()["status"] == "CANCELLED"

    visit = client.get(f"/api/visits/{arrived['visit_id']}").json()
    done = client.post(
        f"/api/visits/{arrived['visit_id']}/cancel",
        json={"version_id": visit["version_id"], "reason": "Patient left before being seen"},
    )
    assert done.status_code == 200, done.text
    assert done.json()["status"] == "CANCELLED"


# ------------------------------------------------------------------ encounters


def _open_encounter(doctor_client, patient, appointment_id: int):
    return doctor_client.post(
        "/api/encounters",
        json={
            "patient_id": patient.id,
            "appointment_id": appointment_id,
            "symptoms": "Lower back pain",
            "clinical_notes": "Pain on forward flexion",
            "diagnosis": "Lumbar strain",
        },
    )


def test_a_doctor_cannot_open_a_consultation_for_a_patient_who_is_not_checked_in(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    patient = _patient(db_session, "E1")
    booking = _book(login_client(reception_user), patient, doctor_a_user)

    response = _open_encounter(login_client(doctor_a_user), patient, booking["id"])

    assert response.status_code == 422
    assert response.json()["code"] == "not_checked_in"
    assert db_session.get(Appointment, booking["id"]).status == "BOOKED"


def test_opening_the_encounter_starts_the_consultation_and_finalising_completes_it(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    patient = _patient(db_session, "E2")
    reception = login_client(reception_user)
    doctor = login_client(doctor_a_user)
    arrived = _checked_in(reception, patient, doctor_a_user)

    opened = _open_encounter(doctor, patient, arrived["id"])
    assert opened.status_code == 201, opened.text
    appt = db_session.get(Appointment, arrived["id"])
    db_session.refresh(appt)
    assert appt.consultation_status == ConsultationStatus.IN_CONSULTATION.value
    assert appt.status == AppointmentStatus.IN_CONSULTATION.value

    # Reopening the same encounter is harmless.
    assert _open_encounter(doctor, patient, arrived["id"]).status_code == 200

    finalised = doctor.post(
        f"/api/encounters/{opened.json()['id']}/finalise",
        json={"symptoms": "Lower back pain", "diagnosis": "Lumbar strain"},
    )
    assert finalised.status_code == 200, finalised.text
    db_session.refresh(appt)
    assert appt.consultation_status == ConsultationStatus.COMPLETED.value
    assert appt.status == AppointmentStatus.DONE.value


def test_a_cancelled_consultation_cannot_be_started_again(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    patient = _patient(db_session, "E3")
    reception = login_client(reception_user)
    arrived = _checked_in(reception, patient, doctor_a_user)
    assert (
        _patch_status(
            reception, arrived, "CANCELLED", cancellation_reason="Patient left"
        ).status_code
        == 200
    )

    response = _open_encounter(login_client(doctor_a_user), patient, arrived["id"])

    assert response.status_code == 422
    assert response.json()["code"] == "invalid_consultation_transition"


def test_from_phone_booking_to_patient_out(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    """The whole flow through the real endpoints: book, check in, consult, check out, close."""
    patient = _patient(db_session, "F1")
    doctor_a_user.doctor.default_fee_paise = 30000
    reception = login_client(reception_user)
    doctor = login_client(doctor_a_user)

    booking = _book(reception, patient, doctor_a_user, source="PHONE", expected_time="10:30:00")
    assert booking["token_number"] is None

    arrived = reception.post(
        f"/api/appointments/{booking['id']}/check-in", json={"version_id": booking["version_id"]}
    ).json()
    assert (arrived["token_number"], arrived["consultation_status"]) == (1, "WAITING")

    opened = _open_encounter(doctor, patient, arrived["id"])
    doctor.post(
        f"/api/encounters/{opened.json()['id']}/finalise",
        json={"symptoms": "Lower back pain", "diagnosis": "Lumbar strain"},
    )

    detail = reception.get(f"/api/visits/{arrived['visit_id']}").json()
    assert [c["consultation_status"] for c in detail["consultations"]] == ["COMPLETED"]
    assert detail["outstanding_paise"] == 30000

    paid = reception.post(
        "/api/payments",
        json={
            "patient_id": patient.id,
            "appointment_id": arrived["id"],
            "amount_paise": 30000,
            "payment_method": "CASH",
        },
    )
    assert paid.status_code == 201, paid.text

    closed = reception.post(
        f"/api/visits/{arrived['visit_id']}/close", json={"version_id": detail["version_id"]}
    )
    assert closed.status_code == 200, closed.text
    assert closed.json()["status"] == "CLOSED"
    assert closed.json()["outstanding_paise"] == 0

    # Closed visits stay in the patient's history.
    listing = reception.get("/api/visits", params={"patient_id": patient.id}).json()
    assert [v["status"] for v in listing["visits"]] == ["CLOSED"]


# ----------------------------------------------------------------- doctor queue


def test_the_doctor_queue_follows_the_consultation_status(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    reception = login_client(reception_user)
    doctor = login_client(doctor_a_user)

    waiting_first = _checked_in(reception, _patient(db_session, "Q1"), doctor_a_user)
    waiting_second = _checked_in(reception, _patient(db_session, "Q2"), doctor_a_user)
    seen = _checked_in(reception, _patient(db_session, "Q3"), doctor_a_user)
    started = _patch_status(doctor, seen, "IN_CONSULTATION").json()
    _patch_status(doctor, started, "DONE")
    in_room = _checked_in(reception, _patient(db_session, "Q4"), doctor_a_user)
    _patch_status(doctor, in_room, "IN_CONSULTATION")
    not_yet = _book(reception, _patient(db_session, "Q5"), doctor_a_user, expected_time="12:00:00")
    moved = _book(reception, _patient(db_session, "Q6"), doctor_a_user)
    reception.post(
        f"/api/appointments/{moved['id']}/reschedule",
        json={"version_id": moved["version_id"], "appointment_date": TOMORROW.isoformat()},
    )

    queue = doctor.get("/api/doctor/queue").json()

    assert [i["id"] for i in queue["waiting"]] == [waiting_first["id"], waiting_second["id"]]
    assert [i["token_number"] for i in queue["waiting"]] == [1, 2]
    assert [i["id"] for i in queue["in_consultation"]] == [in_room["id"]]
    assert [i["id"] for i in queue["completed"]] == [seen["id"]]
    assert [i["id"] for i in queue["booked"]] == [not_yet["id"]]
    assert queue["booked"][0]["token_number"] is None
    assert queue["booked"][0]["consultation_status"] is None
    assert queue["total_active"] == 4
    everyone = {
        i["id"] for key in ("waiting", "in_consultation", "completed", "booked") for i in queue[key]
    }
    assert moved["id"] not in everyone  # the old, rescheduled booking is not in today's queue


# --------------------------------------------------------------------- timeline


def test_the_timeline_names_a_tokenless_booking_without_a_token(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    patient = _patient(db_session, "L1")
    reception = login_client(reception_user)
    _book(reception, patient, doctor_a_user, TOMORROW)
    _checked_in(reception, _patient(db_session, "L2"), doctor_a_user)  # takes token 1
    arrived = _checked_in(reception, patient, doctor_a_user)  # same patient, token 2

    titles = [
        item["title"]
        for item in reception.get(f"/api/patients/{patient.id}/timeline").json()
        if item["event_type"] == "APPOINTMENT"
    ]

    assert any(t.startswith("Appointment with ") for t in titles)  # tomorrow's, no token
    assert any(t.startswith(f"Token #{arrived['token_number']}: ") for t in titles)


# ---------------------------------------------------- validate_status_update rules


def _principal(role: Role, doctor_id: int | None = None) -> Principal:
    return Principal(
        user_id=1,
        username=role.value.lower(),
        role=role,
        doctor_id=doctor_id,
        permissions=ROLE_PERMISSIONS[role],
        session_id=1,
        must_change_password=False,
    )


class _FakeSession:
    def scalar(self, _statement):
        return None

    def get(self, _model, _ident):
        return None


def _appt(status: AppointmentStatus, consultation: ConsultationStatus | None):
    return SimpleNamespace(
        id=1,
        status=status.value,
        appointment_date=TODAY,
        doctor_id=7,
        consultation_status=consultation.value if consultation else None,
        visit_id=None,
    )


def test_validate_status_update_returns_the_consultation_status_it_sets(clock):
    doctor = _principal(Role.DOCTOR, 7)
    waiting = _appt(AppointmentStatus.ARRIVED, ConsultationStatus.WAITING)

    assert (
        validate_status_update(_FakeSession(), waiting, AppointmentStatus.IN_CONSULTATION, doctor)
        is ConsultationStatus.IN_CONSULTATION
    )
    # A booking that is not checked in sets no consultation status.
    booked = _appt(AppointmentStatus.BOOKED, None)
    assert (
        validate_status_update(
            _FakeSession(), booked, AppointmentStatus.CANCELLED, _principal(Role.RECEPTION), "x"
        )
        is None
    )


def test_a_finished_consultation_reports_the_old_error_code_for_a_further_move(clock):
    done = _appt(AppointmentStatus.DONE, ConsultationStatus.COMPLETED)

    with pytest.raises(ApiError) as exc_info:
        validate_status_update(
            _FakeSession(), done, AppointmentStatus.CANCELLED, _principal(Role.RECEPTION), "x"
        )

    assert exc_info.value.code == "invalid_status_transition"
    assert exc_info.value.status_code == 422
