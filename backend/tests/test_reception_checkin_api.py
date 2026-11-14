"""API behaviour of check-in, walk-in, reschedule and visits (RF-12, slice 1).

Owner decisions of 2026-11-13: reception checks a patient in on arrival (a late arrival the same
day too), which opens or joins the visit, issues the token and puts the consultation in the
doctor's waiting list; a walk-in is a booking for today checked in at once; a reschedule keeps
the old booking and creates a linked new one; reception closes the visit at checkout, with a
reason when money is still due.

The clock fixture freezes utcnow at 2026-11-02 04:30 UTC, which is 10:00 IST on 2 Nov 2026.
"""

from datetime import date, timedelta

from sqlalchemy import select

from kalyan_api.models import (
    Appointment,
    AppointmentStatus,
    AuditLog,
    Patient,
    Visit,
    VisitStatus,
)

TODAY = date(2026, 11, 2)
TOMORROW = TODAY + timedelta(days=1)
YESTERDAY = TODAY - timedelta(days=1)


def _patient(db_session, suffix: str) -> Patient:
    patient = Patient(
        urn=f"KH-2026-C1{suffix}",
        full_name=f"Check In Patient {suffix}",
        guardian_name="Guardian",
        gender="M",
        age_years=36,
        mobile="9876543401",
        address="Ara",
    )
    db_session.add(patient)
    db_session.flush()
    return patient


def _book(client, patient, doctor_user, appointment_date=TODAY, **extra):
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


def _tokenless_booking(db_session, patient, doctor_user, reception_user, appointment_date=TODAY):
    appt = Appointment(
        patient_id=patient.id,
        doctor_id=doctor_user.doctor_id,
        department_id=doctor_user.doctor.departments[0].id,
        appointment_date=appointment_date,
        token_number=None,
        status=AppointmentStatus.BOOKED.value,
        created_by_user_id=reception_user.id,
    )
    db_session.add(appt)
    db_session.flush()
    return appt


def _check_in(client, appointment_id: int, version_id: int = 1):
    return client.post(
        f"/api/appointments/{appointment_id}/check-in", json={"version_id": version_id}
    )


def _audit_actions(db_session, entity_type: str, entity_id: int) -> list[str]:
    return list(
        db_session.scalars(
            select(AuditLog.action).where(
                AuditLog.entity_type == entity_type, AuditLog.entity_id == str(entity_id)
            )
        )
    )


# ----------------------------------------------------------------- booking


def test_phone_booking_records_source_and_expected_time(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    patient = _patient(db_session, "A1")
    booking = _book(
        login_client(reception_user),
        patient,
        doctor_a_user,
        TOMORROW,
        source="PHONE",
        expected_time="10:30:00",
    )

    assert booking["source"] == "PHONE"
    assert booking["expected_time"] == "10:30:00"
    assert booking["status"] == "BOOKED"
    assert booking["visit_id"] is None
    assert booking["consultation_status"] is None
    assert booking["rescheduled_from_id"] is None


# ---------------------------------------------------------------- check-in


def test_check_in_opens_a_visit_and_queues_the_consultation(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    patient = _patient(db_session, "B1")
    client = login_client(reception_user)
    booking = _book(client, patient, doctor_a_user)

    response = _check_in(client, booking["id"])

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "ARRIVED"
    assert body["consultation_status"] == "WAITING"
    assert booking["token_number"] is None
    assert body["token_number"] == 1
    assert body["check_in_at"] is not None
    assert body["version_id"] == 2
    assert body["visit_id"] is not None

    visit = client.get(f"/api/visits/{body['visit_id']}").json()
    assert visit["status"] == "OPEN"
    assert visit["patient_id"] == patient.id
    assert visit["visit_date"] == TODAY.isoformat()
    assert [c["appointment_id"] for c in visit["consultations"]] == [booking["id"]]
    assert visit["consultations"][0]["consultation_status"] == "WAITING"

    assert "APPOINTMENT_CHECKED_IN" in _audit_actions(db_session, "appointment", booking["id"])
    assert _audit_actions(db_session, "visit", body["visit_id"]) == ["VISIT_OPENED"]


def test_check_in_issues_the_token_of_a_booking_that_has_none(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    first = _tokenless_booking(
        db_session, _patient(db_session, "B2"), doctor_a_user, reception_user
    )
    second = _tokenless_booking(
        db_session, _patient(db_session, "B3"), doctor_a_user, reception_user
    )
    client = login_client(reception_user)

    # Tokens follow arrival order, not booking order.
    assert _check_in(client, second.id).json()["token_number"] == 1
    assert _check_in(client, first.id).json()["token_number"] == 2


def test_a_second_doctor_joins_the_same_visit(
    clock, login_client, reception_user, doctor_a_user, doctor_b_user, db_session
):
    patient = _patient(db_session, "B4")
    client = login_client(reception_user)
    first = _book(client, patient, doctor_a_user)
    second = _book(client, patient, doctor_b_user)

    visit_a = _check_in(client, first["id"]).json()["visit_id"]
    visit_b = _check_in(client, second["id"]).json()["visit_id"]

    assert visit_a == visit_b
    assert db_session.scalar(select(Visit.id).where(Visit.patient_id == patient.id)) == visit_a
    # Only the first check-in opened the visit.
    assert _audit_actions(db_session, "visit", visit_a) == ["VISIT_OPENED"]


def test_a_late_arrival_marked_not_arrived_can_still_check_in(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    patient = _patient(db_session, "B5")
    client = login_client(reception_user)
    booking = _book(client, patient, doctor_a_user)
    missed = client.patch(
        f"/api/appointments/{booking['id']}/status",
        json={"status": "NO_SHOW", "version_id": booking["version_id"]},
    )
    assert missed.status_code == 200
    assert missed.json()["status"] == "NO_SHOW"

    response = _check_in(client, booking["id"], missed.json()["version_id"])

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "ARRIVED"
    assert response.json()["visit_id"] is not None


def test_check_in_is_refused_for_a_booking_on_another_day(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    patient = _patient(db_session, "B6")
    client = login_client(reception_user)
    booking = _book(client, patient, doctor_a_user, TOMORROW)

    response = _check_in(client, booking["id"])

    assert response.status_code == 422
    assert response.json()["code"] == "check_in_wrong_day"


def test_check_in_with_a_stale_version_is_a_conflict(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    patient = _patient(db_session, "B7")
    client = login_client(reception_user)
    booking = _book(client, patient, doctor_a_user)

    assert _check_in(client, booking["id"], version_id=7).status_code == 409
    assert db_session.get(Appointment, booking["id"]).status == "BOOKED"


def test_only_reception_checks_a_patient_in(
    clock, login_client, reception_user, doctor_a_user, admin_user, db_session
):
    patient = _patient(db_session, "B8")
    booking = _book(login_client(reception_user), patient, doctor_a_user)

    assert _check_in(login_client(doctor_a_user), booking["id"]).status_code == 403
    assert _check_in(login_client(admin_user), booking["id"]).status_code == 403
    assert db_session.get(Appointment, booking["id"]).status == "BOOKED"


def test_check_in_unknown_appointment_is_not_found(clock, login_client, reception_user):
    assert _check_in(login_client(reception_user), 999999).status_code == 404


def test_an_open_visit_from_an_earlier_day_blocks_check_in(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    patient = _patient(db_session, "B9")
    stale = Visit(
        patient_id=patient.id,
        visit_date=YESTERDAY,
        status=VisitStatus.OPEN.value,
        opened_by_user_id=reception_user.id,
    )
    db_session.add(stale)
    db_session.flush()
    client = login_client(reception_user)
    booking = _book(client, patient, doctor_a_user)

    response = _check_in(client, booking["id"])

    assert response.status_code == 409
    assert response.json()["code"] == "open_visit_from_earlier_day"
    assert db_session.get(Appointment, booking["id"]).status == "BOOKED"


# ----------------------------------------------------------------- walk-in


def _walk_in(client, patient, doctor_user, **extra):
    return client.post(
        "/api/appointments/walk-in",
        json={
            "patient_id": patient.id,
            "doctor_id": doctor_user.doctor_id,
            "department_id": doctor_user.doctor.departments[0].id,
            **extra,
        },
    )


def test_walk_in_is_a_booking_for_today_checked_in_at_once(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    patient = _patient(db_session, "W1")
    client = login_client(reception_user)

    response = _walk_in(client, patient, doctor_a_user, notes="Referral")

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["appointment_date"] == TODAY.isoformat()
    assert body["source"] == "WALK_IN"
    assert body["status"] == "ARRIVED"
    assert body["consultation_status"] == "WAITING"
    assert body["token_number"] == 1
    assert body["visit_id"] is not None
    actions = _audit_actions(db_session, "appointment", body["id"])
    assert "APPOINTMENT_CREATED" in actions and "APPOINTMENT_CHECKED_IN" in actions

    # The next walk-in for the same doctor gets the next token.
    other = _walk_in(client, _patient(db_session, "W2"), doctor_a_user)
    assert other.json()["token_number"] == 2


def test_walk_in_for_a_patient_already_booked_today_needs_an_override(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    patient = _patient(db_session, "W3")
    client = login_client(reception_user)
    _book(client, patient, doctor_a_user)

    refused = _walk_in(client, patient, doctor_a_user)
    assert refused.status_code == 409
    assert refused.json()["code"] == "duplicate_appointment"

    allowed = _walk_in(client, patient, doctor_a_user, override_reason="Second visit, same day")
    assert allowed.status_code == 201


def test_a_failed_walk_in_leaves_no_booking_behind(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    patient = _patient(db_session, "W4")
    db_session.add(
        Visit(
            patient_id=patient.id,
            visit_date=YESTERDAY,
            status=VisitStatus.OPEN.value,
            opened_by_user_id=reception_user.id,
        )
    )
    db_session.flush()

    response = _walk_in(login_client(reception_user), patient, doctor_a_user)

    assert response.status_code == 409
    assert response.json()["code"] == "open_visit_from_earlier_day"
    assert (
        db_session.scalars(select(Appointment).where(Appointment.patient_id == patient.id)).all()
        == []
    )


def test_only_reception_registers_walk_ins(
    clock, login_client, reception_user, doctor_a_user, admin_user, db_session
):
    patient = _patient(db_session, "W5")

    assert _walk_in(login_client(doctor_a_user), patient, doctor_a_user).status_code == 403
    assert _walk_in(login_client(admin_user), patient, doctor_a_user).status_code == 403


# -------------------------------------------------------------- reschedule


def _reschedule(client, appointment, new_date, **extra):
    return client.post(
        f"/api/appointments/{appointment['id']}/reschedule",
        json={
            "version_id": appointment["version_id"],
            "appointment_date": new_date.isoformat(),
            **extra,
        },
    )


def test_reschedule_keeps_the_old_booking_and_links_the_new_one(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    patient = _patient(db_session, "R1")
    client = login_client(reception_user)
    booking = _book(client, patient, doctor_a_user, source="PHONE", expected_time="10:00:00")

    response = _reschedule(
        client,
        booking,
        TODAY + timedelta(days=3),
        expected_time="11:00:00",
        reason="Patient asked for another day",
    )

    assert response.status_code == 201, response.text
    new = response.json()
    assert new["id"] != booking["id"]
    assert new["rescheduled_from_id"] == booking["id"]
    assert new["appointment_date"] == (TODAY + timedelta(days=3)).isoformat()
    assert new["expected_time"] == "11:00:00"
    assert new["source"] == "PHONE"
    assert new["status"] == "BOOKED"
    assert new["token_number"] is None

    old = client.get(f"/api/appointments/{booking['id']}").json()
    assert old["status"] == "RESCHEDULED"

    row = db_session.scalar(
        select(AuditLog).where(
            AuditLog.entity_type == "appointment",
            AuditLog.entity_id == str(booking["id"]),
            AuditLog.action == "APPOINTMENT_RESCHEDULED",
        )
    )
    assert row is not None
    assert row.reason == "Patient asked for another day"


def test_a_time_only_change_edits_the_booking_in_place(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    patient = _patient(db_session, "R2")
    client = login_client(reception_user)
    booking = _book(client, patient, doctor_a_user, expected_time="10:00:00")

    moved = _reschedule(client, booking, TODAY, expected_time="11:30:00")
    assert moved.status_code == 200, moved.text
    assert moved.json()["id"] == booking["id"]
    assert moved.json()["expected_time"] == "11:30:00"
    assert moved.json()["status"] == "BOOKED"

    unchanged = _reschedule(client, moved.json(), TODAY, expected_time="11:30:00")
    assert unchanged.status_code == 422
    assert unchanged.json()["code"] == "reschedule_nothing_changed"


def test_reschedule_to_a_past_date_is_refused(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    patient = _patient(db_session, "R3")
    client = login_client(reception_user)
    booking = _book(client, patient, doctor_a_user)

    response = _reschedule(client, booking, YESTERDAY)

    assert response.status_code == 422
    assert response.json()["code"] == "reschedule_date_in_past"


def test_a_checked_in_booking_cannot_be_rescheduled(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    patient = _patient(db_session, "R4")
    client = login_client(reception_user)
    booking = _book(client, patient, doctor_a_user)
    checked_in = _check_in(client, booking["id"]).json()

    response = _reschedule(client, checked_in, TOMORROW)

    assert response.status_code == 422
    assert response.json()["code"] == "invalid_status_transition"


def test_reschedule_onto_a_date_with_a_booking_needs_an_override(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    patient = _patient(db_session, "R5")
    client = login_client(reception_user)
    booking = _book(client, patient, doctor_a_user)
    _book(client, patient, doctor_a_user, TOMORROW)

    response = _reschedule(client, booking, TOMORROW)

    assert response.status_code == 409
    assert response.json()["code"] == "duplicate_appointment"
    assert client.get(f"/api/appointments/{booking['id']}").json()["status"] == "BOOKED"


def test_only_reception_reschedules(
    clock, login_client, reception_user, doctor_a_user, admin_user, db_session
):
    patient = _patient(db_session, "R6")
    booking = _book(login_client(reception_user), patient, doctor_a_user)

    as_doctor = _reschedule(login_client(doctor_a_user), booking, TOMORROW)
    assert as_doctor.status_code == 403
    assert as_doctor.json()["code"] == "reception_only"
    assert _reschedule(login_client(admin_user), booking, TOMORROW).status_code == 403


# ------------------------------------------------------------------ visits


def _checked_in_visit(client, db_session, suffix, doctor_user, fee_paise=30000):
    """Check a patient in, then mark the consultation completed the way the doctor flow will."""
    doctor_user.doctor.default_fee_paise = fee_paise
    patient = _patient(db_session, suffix)
    booking = _book(client, patient, doctor_user)
    checked_in = _check_in(client, booking["id"]).json()
    appt = db_session.get(Appointment, booking["id"])
    appt.consultation_status = "COMPLETED"
    db_session.flush()
    return patient, checked_in


def test_visit_list_filters_by_patient_and_status(
    clock, login_client, reception_user, admin_user, doctor_a_user, db_session
):
    client = login_client(reception_user)
    patient, checked_in = _checked_in_visit(client, db_session, "V1", doctor_a_user)

    listing = client.get("/api/visits", params={"patient_id": patient.id}).json()
    assert listing["total"] == 1
    assert listing["visits"][0]["id"] == checked_in["visit_id"]
    assert (
        client.get("/api/visits", params={"patient_id": patient.id, "status": "CLOSED"}).json()[
            "total"
        ]
        == 0
    )
    # Admin reads visits too.
    assert login_client(admin_user).get(f"/api/visits/{checked_in['visit_id']}").status_code == 200


def test_closing_a_visit_with_money_due_needs_a_reason(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    client = login_client(reception_user)
    _patient_row, checked_in = _checked_in_visit(client, db_session, "V2", doctor_a_user)
    visit_id = checked_in["visit_id"]
    detail = client.get(f"/api/visits/{visit_id}").json()
    assert detail["outstanding_paise"] == 30000

    refused = client.post(
        f"/api/visits/{visit_id}/close", json={"version_id": detail["version_id"]}
    )
    assert refused.status_code == 422
    assert refused.json()["code"] == "close_reason_required"

    closed = client.post(
        f"/api/visits/{visit_id}/close",
        json={"version_id": detail["version_id"], "reason": "Pays with the next instalment"},
    )
    assert closed.status_code == 200, closed.text
    assert closed.json()["status"] == "CLOSED"
    assert closed.json()["close_reason"] == "Pays with the next instalment"

    row = db_session.scalar(
        select(AuditLog).where(
            AuditLog.entity_type == "visit",
            AuditLog.entity_id == str(visit_id),
            AuditLog.action == "VISIT_CLOSED",
        )
    )
    assert row is not None
    assert row.after_data["outstanding_paise"] == 30000

    # A closed visit does not change again.
    again = client.post(
        f"/api/visits/{visit_id}/close",
        json={"version_id": closed.json()["version_id"], "reason": "again"},
    )
    assert again.status_code == 422
    assert again.json()["code"] == "visit_not_open"


def test_a_paid_visit_closes_without_a_reason(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    client = login_client(reception_user)
    patient, checked_in = _checked_in_visit(client, db_session, "V3", doctor_a_user)
    paid = client.post(
        "/api/payments",
        json={
            "patient_id": patient.id,
            "appointment_id": db_session.scalar(
                select(Appointment.id).where(Appointment.visit_id == checked_in["visit_id"])
            ),
            "amount_paise": 30000,
            "payment_method": "CASH",
        },
    )
    assert paid.status_code == 201, paid.text
    detail = client.get(f"/api/visits/{checked_in['visit_id']}").json()
    assert detail["outstanding_paise"] == 0

    closed = client.post(
        f"/api/visits/{checked_in['visit_id']}/close", json={"version_id": detail["version_id"]}
    )

    assert closed.status_code == 200, closed.text
    assert closed.json()["status"] == "CLOSED"
    assert closed.json()["close_reason"] is None


def test_a_reversed_payment_no_longer_counts_as_paid(
    clock, login_client, reception_user, admin_user, doctor_a_user, db_session
):
    client = login_client(reception_user)
    patient, checked_in = _checked_in_visit(client, db_session, "V4", doctor_a_user)
    appointment_id = db_session.scalar(
        select(Appointment.id).where(Appointment.visit_id == checked_in["visit_id"])
    )
    payment = client.post(
        "/api/payments",
        json={
            "patient_id": patient.id,
            "appointment_id": appointment_id,
            "amount_paise": 30000,
            "payment_method": "CASH",
        },
    ).json()
    reversed_ = login_client(admin_user).post(
        f"/api/payments/{payment['id']}/reverse",
        json={"reversal_reason": "Entered against the wrong patient"},
    )
    assert reversed_.status_code == 200, reversed_.text

    detail = client.get(f"/api/visits/{checked_in['visit_id']}").json()
    assert detail["outstanding_paise"] == 30000


def test_a_visit_with_a_waiting_consultation_cannot_close(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    client = login_client(reception_user)
    patient = _patient(db_session, "V5")
    checked_in = _check_in(client, _book(client, patient, doctor_a_user)["id"]).json()

    response = client.post(
        f"/api/visits/{checked_in['visit_id']}/close", json={"version_id": 1, "reason": "x"}
    )

    assert response.status_code == 422
    assert response.json()["code"] == "consultation_in_progress"


def test_a_visit_where_nobody_was_seen_is_cancelled(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    client = login_client(reception_user)
    patient = _patient(db_session, "V6")
    booking = _book(client, patient, doctor_a_user)
    checked_in = _check_in(client, booking["id"]).json()
    visit_id = checked_in["visit_id"]

    blocked = client.post(
        f"/api/visits/{visit_id}/cancel", json={"version_id": 1, "reason": "Patient left"}
    )
    assert blocked.status_code == 422
    assert blocked.json()["code"] == "consultation_in_progress"

    cancelled_consultation = client.patch(
        f"/api/appointments/{booking['id']}/status",
        json={
            "status": "CANCELLED",
            "version_id": checked_in["version_id"],
            "cancellation_reason": "Patient left before being seen",
        },
    )
    assert cancelled_consultation.status_code == 200
    appt = db_session.get(Appointment, booking["id"])
    appt.consultation_status = "CANCELLED"
    db_session.flush()

    cancelled = client.post(
        f"/api/visits/{visit_id}/cancel", json={"version_id": 1, "reason": "Patient left"}
    )
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "CANCELLED"
    assert cancelled.json()["cancel_reason"] == "Patient left"
    assert "VISIT_CANCELLED" in _audit_actions(db_session, "visit", visit_id)


def test_visit_not_found(clock, login_client, reception_user):
    client = login_client(reception_user)
    assert client.get("/api/visits/999999").status_code == 404
    assert client.post("/api/visits/999999/close", json={"version_id": 1}).status_code == 404
