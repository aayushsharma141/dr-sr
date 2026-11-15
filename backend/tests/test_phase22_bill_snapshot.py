"""Phase 22 Wave 3, first slice: the consultation fee is saved on the bill at check-in (FEE-07).

Owner decision OD-22-10 (.planning/phases/22-integrated-opd-workflow/22-DESIGN.md): at check-in the
doctor's current fee is saved as a bill line, and later fee changes never alter existing bills.
This is the K-63 defect that the UAT report recorded as FEE-07.

The clock fixture freezes utcnow at 2026-11-02 04:30 UTC, which is 10:00 IST on 2 Nov 2026.
"""

from datetime import UTC, datetime

from sqlalchemy import select

from kalyan_api.models import Appointment, BillItem, Patient, Visit
from kalyan_api.services import billing_service

COMPLETED = "COMPLETED"


def _patient(db_session, suffix: str) -> Patient:
    patient = Patient(
        urn=f"KH-2026-S3{suffix}",
        full_name=f"Snapshot Patient {suffix}",
        guardian_name="Guardian",
        gender="F",
        age_years=40,
        mobile="9876500044",
        address="Ara",
    )
    db_session.add(patient)
    db_session.flush()
    return patient


def _walk_in(reception, patient, doctor_user, dept):
    response = reception.post(
        "/api/appointments/walk-in",
        json={
            "patient_id": patient.id,
            "doctor_id": doctor_user.doctor_id,
            "department_id": dept.id,
            "referral_source": "SELF",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _complete(db_session, appointment_id: int) -> None:
    """Stand in for the doctor completing the consultation (the doctor's own flow is tested elsewhere)."""
    appt = db_session.get(Appointment, appointment_id)
    appt.consultation_status = COMPLETED
    db_session.flush()


def _set_fee(doctor_user, paise: int) -> None:
    doctor_user.doctor.default_fee_paise = paise


def _line(db_session, appointment_id: int) -> BillItem:
    return db_session.scalars(
        select(BillItem).where(BillItem.appointment_id == appointment_id)
    ).one()


def test_check_in_saves_the_fee_as_the_consultation_bill_line(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    dept = doctor_a_user.doctor.departments[0]
    _set_fee(doctor_a_user, 30000)
    reception = login_client(reception_user)

    walked = _walk_in(reception, _patient(db_session, "L1"), doctor_a_user, dept)

    line = _line(db_session, walked["id"])
    assert line.category == "CONSULTATION"
    assert line.source == "SYSTEM"
    assert line.amount_paise == 30000
    assert line.rate_paise == 30000
    assert line.visit_id == walked["visit_id"]


def test_a_later_fee_change_leaves_an_existing_bill_unchanged(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    """FEE-07: the old patient's bill stays at the fee it was billed at."""
    dept = doctor_a_user.doctor.departments[0]
    _set_fee(doctor_a_user, 30000)
    reception = login_client(reception_user)
    walked = _walk_in(reception, _patient(db_session, "F1"), doctor_a_user, dept)
    _complete(db_session, walked["id"])

    before = billing_service.visit_charge_lines(db_session, [walked["visit_id"]])[walked["visit_id"]]
    _set_fee(doctor_a_user, 45000)
    db_session.flush()
    after = billing_service.visit_charge_lines(db_session, [walked["visit_id"]])[walked["visit_id"]]

    assert [(l.fee_paise, l.balance_paise) for l in before] == [(30000, 30000)]
    assert [(l.fee_paise, l.balance_paise) for l in after] == [(30000, 30000)]


def test_a_visit_closed_with_a_balance_keeps_its_billed_amount(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    dept = doctor_a_user.doctor.departments[0]
    _set_fee(doctor_a_user, 30000)
    reception = login_client(reception_user)
    walked = _walk_in(reception, _patient(db_session, "F2"), doctor_a_user, dept)
    _complete(db_session, walked["id"])
    visit = db_session.get(Visit, walked["visit_id"])
    visit.status = "CLOSED"
    visit.closed_at = datetime(2026, 11, 2, 5, 0, tzinfo=UTC)
    visit.closed_by_user_id = reception_user.id
    visit.close_reason = "Patient to pay later"
    db_session.flush()

    _set_fee(doctor_a_user, 45000)
    db_session.flush()
    dues = [d for d in billing_service.compute_visit_dues(db_session) if d.visit_id == visit.id]

    assert [(d.fee_paise, d.balance_paise) for d in dues] == [(30000, 30000)]


def test_a_new_check_in_after_a_fee_change_is_billed_at_the_new_fee(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    dept = doctor_a_user.doctor.departments[0]
    _set_fee(doctor_a_user, 30000)
    reception = login_client(reception_user)
    _walk_in(reception, _patient(db_session, "N1"), doctor_a_user, dept)

    _set_fee(doctor_a_user, 45000)
    db_session.flush()
    later = _walk_in(reception, _patient(db_session, "N2"), doctor_a_user, dept)

    assert _line(db_session, later["id"]).amount_paise == 45000


def test_the_payment_guard_uses_the_saved_fee_not_the_current_one(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    """A payment above the billed fee is refused even when the doctor's fee has since risen."""
    dept = doctor_a_user.doctor.departments[0]
    _set_fee(doctor_a_user, 30000)
    reception = login_client(reception_user)
    patient = _patient(db_session, "P1")
    walked = _walk_in(reception, patient, doctor_a_user, dept)
    _complete(db_session, walked["id"])
    _set_fee(doctor_a_user, 45000)
    db_session.flush()

    response = reception.post(
        "/api/payments",
        json={
            "patient_id": patient.id,
            "appointment_id": walked["id"],
            "amount_paise": 35000,
            "payment_method": "CASH",
        },
    )

    assert response.status_code == 422, response.text
    assert response.json()["code"] == "overpayment_rejected"


def test_a_reassigned_consultation_is_billed_at_the_new_doctors_fee(
    clock, login_client, reception_user, doctor_a_user, doctor_b_user, db_session
):
    dept = doctor_a_user.doctor.departments[0]
    if dept not in doctor_b_user.doctor.departments:
        doctor_b_user.doctor.departments.append(dept)
    _set_fee(doctor_a_user, 30000)
    _set_fee(doctor_b_user, 70000)
    db_session.flush()
    reception = login_client(reception_user)
    walked = _walk_in(reception, _patient(db_session, "R1"), doctor_a_user, dept)

    moved = reception.post(
        f"/api/appointments/{walked['id']}/reassign",
        json={
            "version_id": walked["version_id"],
            "new_doctor_id": doctor_b_user.doctor_id,
            "reason": "Second opinion",
        },
    )

    assert moved.status_code == 201, moved.text
    assert _line(db_session, walked["id"]).amount_paise == 30000
    assert _line(db_session, moved.json()["id"]).amount_paise == 70000


def test_a_consultation_without_a_line_falls_back_to_the_doctors_current_fee(
    clock, doctor_a_user, reception_user, db_session
):
    """Rows that never went through check-in have no bill line. They keep the previous behaviour."""
    _set_fee(doctor_a_user, 52000)
    patient = _patient(db_session, "X1")
    visit = Visit(
        patient_id=patient.id,
        visit_date=datetime(2026, 11, 2, tzinfo=UTC).date(),
        status="OPEN",
        opened_by_user_id=reception_user.id,
    )
    db_session.add(visit)
    db_session.flush()
    appt = Appointment(
        patient_id=patient.id,
        doctor_id=doctor_a_user.doctor_id,
        appointment_date=visit.visit_date,
        token_number=900,
        status="ARRIVED",
        consultation_status=COMPLETED,
        visit_id=visit.id,
        created_by_user_id=reception_user.id,
    )
    db_session.add(appt)
    db_session.flush()

    lines = billing_service.visit_charge_lines(db_session, [visit.id])[visit.id]

    assert [(l.fee_paise, l.balance_paise) for l in lines] == [(52000, 52000)]
