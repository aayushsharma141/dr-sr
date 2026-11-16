"""Phase 22 Wave 3: discount, waive and correct a consultation fee, with a reason (OD-22-11).

Owner decisions of 2026-11-15 (.planning/phases/22-integrated-opd-workflow/22-DESIGN.md):
- OD-22-11: a doctor may reduce, discount or waive the fee of own consultation with a reason;
  reception adjusts only with an explicit permission (not granted by default); the original and
  revised amounts are kept.
- OD-22-15: after a payment nothing is silently overwritten, and a fee cannot fall below what has
  been paid. Corrections keep the previous value, reason, staff member and time.
Covers UAT FEE-03 (doctor reduces the fee), FEE-04 (doctor waives it), FEE-05 (reception without
permission is refused), FEE-06 (authorised adjustment) and AUD-04 (adjustment history).

The clock fixture freezes utcnow at 2026-11-02 04:30 UTC, which is 10:00 IST on 2 Nov 2026.
"""

from sqlalchemy import select

from kalyan_api.models import Appointment, AuditLog, BillItem, BillItemAdjustment, Patient, Visit
from kalyan_api.services import billing_service
from kalyan_api.services.audit_service import AuditAction


def _patient(db_session, suffix: str) -> Patient:
    patient = Patient(
        urn=f"KH-2026-FA{suffix}",
        full_name=f"Fee Patient {suffix}",
        guardian_name="Guardian",
        gender="M",
        age_years=55,
        mobile="9876500055",
        address="Ara",
    )
    db_session.add(patient)
    db_session.flush()
    return patient


def _billed_consultation(reception, db_session, doctor_user, suffix: str, fee: int = 30000):
    """Check a patient in at `fee` and mark the consultation completed, as the doctor would."""
    doctor_user.doctor.default_fee_paise = fee
    db_session.flush()
    dept = doctor_user.doctor.departments[0]
    response = reception.post(
        "/api/appointments/walk-in",
        json={
            "patient_id": _patient(db_session, suffix).id,
            "doctor_id": doctor_user.doctor_id,
            "department_id": dept.id,
            "referral_source": "SELF",
        },
    )
    assert response.status_code == 201, response.text
    walked = response.json()
    appt = db_session.get(Appointment, walked["id"])
    appt.consultation_status = "COMPLETED"
    db_session.flush()
    return walked


def _adjust(client, appointment_id: int, kind: str, amount: int, reason: str = "Reason given", route: str = "fee-adjustment"):
    return client.post(
        f"/api/appointments/{appointment_id}/{route}",
        json={"kind": kind, "new_amount_paise": amount, "reason": reason},
    )


def _line(db_session, appointment_id: int) -> BillItem:
    return db_session.scalars(
        select(BillItem).where(BillItem.appointment_id == appointment_id)
    ).one()


def test_doctor_waives_own_consultation_fee_and_the_dues_clear(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    reception = login_client(reception_user)
    walked = _billed_consultation(reception, db_session, doctor_a_user, "W1")

    response = _adjust(login_client(doctor_a_user), walked["id"], "WAIVER", 0, "Poor patient")

    assert response.status_code == 201, response.text
    body = response.json()
    assert (body["old_amount_paise"], body["new_amount_paise"], body["kind"]) == (30000, 0, "WAIVER")
    line = _line(db_session, walked["id"])
    assert line.amount_paise == 0
    assert line.original_amount_paise == 30000
    lines = billing_service.visit_charge_lines(db_session, [walked["visit_id"]])[walked["visit_id"]]
    assert [(l.fee_paise, l.balance_paise) for l in lines] == [(0, 0)]


def test_doctor_discounts_the_fee_and_the_history_is_kept(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    reception = login_client(reception_user)
    walked = _billed_consultation(reception, db_session, doctor_a_user, "D1")

    response = _adjust(login_client(doctor_a_user), walked["id"], "DISCOUNT", 10000, "Reduced fee")

    assert response.status_code == 201, response.text
    rows = db_session.scalars(
        select(BillItemAdjustment).where(BillItemAdjustment.bill_item_id == _line(db_session, walked["id"]).id)
    ).all()
    assert [(r.kind, r.old_amount_paise, r.new_amount_paise, r.reason) for r in rows] == [
        ("DISCOUNT", 30000, 10000, "Reduced fee")
    ]
    audit = db_session.scalars(
        select(AuditLog).where(
            AuditLog.action == AuditAction.BILL_ITEM_ADJUSTED.value,
            AuditLog.entity_id == str(walked["id"]),
        )
    ).one()
    assert audit.before_data == {"amount_paise": 30000}
    assert audit.after_data["amount_paise"] == 10000


def test_a_discount_cannot_raise_the_fee(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    reception = login_client(reception_user)
    walked = _billed_consultation(reception, db_session, doctor_a_user, "D2")

    response = _adjust(login_client(doctor_a_user), walked["id"], "DISCOUNT", 40000)

    assert response.status_code == 422
    assert response.json()["code"] == "discount_must_lower_fee"


def test_a_doctor_cannot_correct_a_fee(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    reception = login_client(reception_user)
    walked = _billed_consultation(reception, db_session, doctor_a_user, "C1")

    response = _adjust(login_client(doctor_a_user), walked["id"], "CORRECTION", 45000)

    assert response.status_code == 403
    assert response.json()["code"] == "adjustment_kind_not_permitted"
    assert _line(db_session, walked["id"]).amount_paise == 30000


def test_a_doctor_cannot_adjust_another_doctors_consultation(
    clock, login_client, reception_user, doctor_a_user, doctor_b_user, db_session
):
    reception = login_client(reception_user)
    walked = _billed_consultation(reception, db_session, doctor_a_user, "O1")

    response = _adjust(login_client(doctor_b_user), walked["id"], "WAIVER", 0)

    assert response.status_code == 404
    assert _line(db_session, walked["id"]).amount_paise == 30000


def test_reception_is_refused_without_the_bill_adjust_grant(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    reception = login_client(reception_user)
    walked = _billed_consultation(reception, db_session, doctor_a_user, "R1")

    response = _adjust(reception, walked["id"], "WAIVER", 0)

    assert response.status_code == 403


def test_admin_may_correct_a_fee_with_a_reason(
    clock, login_client, admin_user, reception_user, doctor_a_user, db_session
):
    reception = login_client(reception_user)
    walked = _billed_consultation(reception, db_session, doctor_a_user, "A1")

    response = _adjust(
        login_client(admin_user), walked["id"], "CORRECTION", 45000, "Wrong fee billed", route="fee-correction"
    )

    assert response.status_code == 201, response.text
    assert response.json()["kind"] == "CORRECTION"
    assert _line(db_session, walked["id"]).amount_paise == 45000


def test_a_waiver_must_be_zero(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    reception = login_client(reception_user)
    walked = _billed_consultation(reception, db_session, doctor_a_user, "W2")

    response = _adjust(login_client(doctor_a_user), walked["id"], "WAIVER", 5000)

    assert response.status_code == 422
    assert response.json()["code"] == "waiver_must_be_zero"


def test_a_fee_cannot_drop_below_what_has_been_paid(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    reception = login_client(reception_user)
    walked = _billed_consultation(reception, db_session, doctor_a_user, "P1")
    paid = reception.post(
        "/api/payments",
        json={
            "patient_id": walked["patient_id"],
            "appointment_id": walked["id"],
            "amount_paise": 20000,
            "payment_method": "CASH",
        },
    )
    assert paid.status_code in (200, 201), paid.text

    response = _adjust(login_client(doctor_a_user), walked["id"], "DISCOUNT", 10000)

    assert response.status_code == 422
    assert response.json()["code"] == "adjustment_below_paid"
    assert _line(db_session, walked["id"]).amount_paise == 30000


def test_a_closed_visit_is_locked(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    reception = login_client(reception_user)
    walked = _billed_consultation(reception, db_session, doctor_a_user, "L1")
    visit = db_session.get(Visit, walked["visit_id"])
    visit.status = "CLOSED"
    visit.closed_at = visit.opened_at
    visit.closed_by_user_id = reception_user.id
    visit.close_reason = "Settled earlier"
    db_session.flush()

    response = _adjust(login_client(doctor_a_user), walked["id"], "WAIVER", 0)

    assert response.status_code == 422
    assert response.json()["code"] == "visit_closed"


def test_a_short_reason_is_refused(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    reception = login_client(reception_user)
    walked = _billed_consultation(reception, db_session, doctor_a_user, "S1")

    response = _adjust(login_client(doctor_a_user), walked["id"], "WAIVER", 0, reason="ab")

    assert response.status_code == 422
    assert _line(db_session, walked["id"]).amount_paise == 30000


def test_fee_adjustment_guarded_by_visit_level_payment(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    """A visit with a ₹500 consultation paid ₹500 by a visit-level payment: a doctor waiver returns 422 adjustment_below_paid and the line is unchanged."""
    reception = login_client(reception_user)
    walked = _billed_consultation(reception, db_session, doctor_a_user, "VP1", fee=50000)

    # Pay ₹500 at visit level
    pay_res = reception.post(
        "/api/payments",
        json={
            "patient_id": walked["patient_id"],
            "visit_id": walked["visit_id"],
            "amount_paise": 50000,
            "payment_method": "CASH",
        },
    )
    assert pay_res.status_code == 201, pay_res.text

    # Doctor tries to waive fee to 0
    response = _adjust(login_client(doctor_a_user), walked["id"], "WAIVER", 0, reason="Waiving full fee")
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "adjustment_below_paid"
    assert response.json()["message"] == "The fee cannot go below what has already been paid on this visit."
    assert _line(db_session, walked["id"]).amount_paise == 50000


def test_fee_adjustment_multi_consultation_visit_totals(
    clock, login_client, reception_user, doctor_a_user, doctor_b_user, db_session
):
    """Two consultations of ₹500 each, ₹500 paid at visit level: discounting one to ₹0 is refused only if new total falls below paid."""
    reception = login_client(reception_user)
    doctor_a_user.doctor.default_fee_paise = 50000
    doctor_b_user.doctor.default_fee_paise = 50000
    db_session.flush()

    patient = _patient(db_session, "MC1")
    dept_a = doctor_a_user.doctor.departments[0]
    dept_b = doctor_b_user.doctor.departments[0]

    # Walk-in 1: Doctor A
    res1 = reception.post(
        "/api/appointments/walk-in",
        json={
            "patient_id": patient.id,
            "doctor_id": doctor_a_user.doctor_id,
            "department_id": dept_a.id,
            "referral_source": "SELF",
        },
    )
    assert res1.status_code == 201
    walked1 = res1.json()
    visit_id = walked1["visit_id"]

    # Walk-in 2: Doctor B on same visit
    res2 = reception.post(
        "/api/appointments/walk-in",
        json={
            "patient_id": patient.id,
            "doctor_id": doctor_b_user.doctor_id,
            "department_id": dept_b.id,
            "referral_source": "SELF",
        },
    )
    assert res2.status_code == 201
    walked2 = res2.json()
    assert walked2["visit_id"] == visit_id

    # Complete both consultations
    appt1 = db_session.get(Appointment, walked1["id"])
    appt1.consultation_status = "COMPLETED"
    appt2 = db_session.get(Appointment, walked2["id"])
    appt2.consultation_status = "COMPLETED"
    db_session.flush()

    # Total bill is ₹1000 (100,000 paise). Pay ₹500 (50,000 paise) at visit level
    pay_res = reception.post(
        "/api/payments",
        json={
            "patient_id": patient.id,
            "visit_id": visit_id,
            "amount_paise": 50000,
            "payment_method": "CASH",
        },
    )
    assert pay_res.status_code == 201, pay_res.text

    # Discount Doctor A's fee from ₹500 to ₹0: new visit total is ₹500 == paid ₹500 -> ALLOWED
    adj1 = _adjust(login_client(doctor_a_user), walked1["id"], "WAIVER", 0, reason="Waiving consultation A")
    assert adj1.status_code == 201, adj1.text
    assert _line(db_session, walked1["id"]).amount_paise == 0

    # Now total bill is ₹500, paid is ₹500. Doctor B tries to discount from ₹500 to ₹400 -> refused (< 500)
    adj2 = _adjust(login_client(doctor_b_user), walked2["id"], "DISCOUNT", 40000, reason="Trying discount B")
    assert adj2.status_code == 422, adj2.text
    assert adj2.json()["code"] == "adjustment_below_paid"
    assert adj2.json()["message"] == "The fee cannot go below what has already been paid on this visit."
    assert _line(db_session, walked2["id"]).amount_paise == 50000

