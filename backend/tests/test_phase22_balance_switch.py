"""Phase 22 Plan 05: Visit-level balance switch regression test.

Proves that before and after switching from per-consultation balance computation
to visit-level computation (VisitTotals), every visit's outstanding and closed dues
match across all data shapes (S1..S13, BILL-01, BILL-02, BILL-16, BILL-17).

Freeze clock utcnow at 2026-11-02 04:30 UTC.
"""

from datetime import UTC, date, datetime
from pathlib import Path
import sys

import pytest
from sqlalchemy import select

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from kalyan_api.core.errors import ApiError
from kalyan_api.models import (
    Appointment,
    BillItem,
    BillItemCategory,
    BillItemSource,
    ConsultationStatus,
    Doctor,
    Patient,
    Payment,
    TreatmentPlan,
    Visit,
    VisitStatus,
)
from kalyan_api.services import billing_service
from scripts.phase22_balance_compare import compare_visit_balances


def _patient(db_session, suffix: str) -> Patient:
    patient = Patient(
        urn=f"KH-2026-BS{suffix}",
        full_name=f"Balance Patient {suffix}",
        guardian_name="Guardian",
        gender="M",
        age_years=35,
        mobile=f"987654{suffix.zfill(4)}",
        address="Ara",
    )
    db_session.add(patient)
    db_session.flush()
    return patient


def _set_doctor_fee(doctor_user, paise: int) -> None:
    doctor_user.doctor.default_fee_paise = paise


def _walk_in(reception, patient: Patient, doctor_user):
    dept = doctor_user.doctor.departments[0]
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


def _complete_consultation(db_session, appt_id: int) -> None:
    appt = db_session.get(Appointment, appt_id)
    assert appt is not None
    appt.consultation_status = ConsultationStatus.COMPLETED.value
    db_session.flush()


def _closed_visit_dues(reception, visit_id: int) -> int:
    """Helper summing balance_paise for visit_id from GET /api/billing/visit-dues."""
    res = reception.get("/api/billing/visit-dues")
    assert res.status_code == 200, res.text
    items = res.json()
    return sum(item["balance_paise"] for item in items if item["visit_id"] == visit_id)


# ---------------------------------------------------------------------------
# Scenarios S1 .. S13
# ---------------------------------------------------------------------------


def test_s1_completed_and_unpaid(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    """S1: completed and unpaid: outstanding equals the line fee."""
    _set_doctor_fee(doctor_a_user, 30000)
    reception = login_client(reception_user)
    patient = _patient(db_session, "0001")
    walked = _walk_in(reception, patient, doctor_a_user)
    _complete_consultation(db_session, walked["id"])

    res = reception.get(f"/api/visits/{walked['visit_id']}")
    assert res.status_code == 200, res.text
    detail = res.json()
    assert detail["outstanding_paise"] == 30000
    assert detail["total_paid_paise"] == 0
    assert len(detail["consultations"]) == 1
    c = detail["consultations"][0]
    assert (c["fee_paise"], c["paid_paise"], c["balance_paise"], c["collectable"]) == (
        30000,
        0,
        30000,
        True,
    )


def test_s2_completed_part_paid(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    """S2: completed, part-paid by appointment payment: fee minus paid."""
    _set_doctor_fee(doctor_a_user, 30000)
    reception = login_client(reception_user)
    patient = _patient(db_session, "0002")
    walked = _walk_in(reception, patient, doctor_a_user)
    _complete_consultation(db_session, walked["id"])

    pay_res = reception.post(
        "/api/payments",
        json={
            "patient_id": patient.id,
            "appointment_id": walked["id"],
            "amount_paise": 10000,
            "payment_method": "CASH",
        },
    )
    assert pay_res.status_code == 201, pay_res.text

    res = reception.get(f"/api/visits/{walked['visit_id']}")
    assert res.status_code == 200, res.text
    detail = res.json()
    assert detail["outstanding_paise"] == 20000
    assert detail["total_paid_paise"] == 10000


def test_s3_completed_fully_paid(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    """S3: completed, fully paid: 0."""
    _set_doctor_fee(doctor_a_user, 30000)
    reception = login_client(reception_user)
    patient = _patient(db_session, "0003")
    walked = _walk_in(reception, patient, doctor_a_user)
    _complete_consultation(db_session, walked["id"])

    pay_res = reception.post(
        "/api/payments",
        json={
            "patient_id": patient.id,
            "appointment_id": walked["id"],
            "amount_paise": 30000,
            "payment_method": "UPI",
        },
    )
    assert pay_res.status_code == 201, pay_res.text

    res = reception.get(f"/api/visits/{walked['visit_id']}")
    assert res.status_code == 200, res.text
    detail = res.json()
    assert detail["outstanding_paise"] == 0
    assert detail["total_paid_paise"] == 30000


def test_s4_two_completed_consultations_one_paid(
    clock, login_client, reception_user, doctor_a_user, doctor_b_user, db_session
):
    """S4: two completed consultations in one visit, one paid: the other's fee."""
    dept = doctor_a_user.doctor.departments[0]
    if dept not in doctor_b_user.doctor.departments:
        doctor_b_user.doctor.departments.append(dept)
    _set_doctor_fee(doctor_a_user, 30000)
    _set_doctor_fee(doctor_b_user, 50000)
    db_session.flush()

    reception = login_client(reception_user)
    patient = _patient(db_session, "0004")
    walked_a = _walk_in(reception, patient, doctor_a_user)
    walked_b = _walk_in(reception, patient, doctor_b_user)
    assert walked_a["visit_id"] == walked_b["visit_id"]

    _complete_consultation(db_session, walked_a["id"])
    _complete_consultation(db_session, walked_b["id"])

    pay_res = reception.post(
        "/api/payments",
        json={
            "patient_id": patient.id,
            "appointment_id": walked_a["id"],
            "amount_paise": 30000,
            "payment_method": "CASH",
        },
    )
    assert pay_res.status_code == 201, pay_res.text

    res = reception.get(f"/api/visits/{walked_a['visit_id']}")
    assert res.status_code == 200, res.text
    detail = res.json()
    assert detail["outstanding_paise"] == 50000
    assert detail["total_paid_paise"] == 30000


def test_s5_one_completed_and_one_waiting(
    clock, login_client, reception_user, doctor_a_user, doctor_b_user, db_session
):
    """S5: one completed and one WAITING consultation: only the completed fee."""
    dept = doctor_a_user.doctor.departments[0]
    if dept not in doctor_b_user.doctor.departments:
        doctor_b_user.doctor.departments.append(dept)
    _set_doctor_fee(doctor_a_user, 30000)
    _set_doctor_fee(doctor_b_user, 50000)
    db_session.flush()

    reception = login_client(reception_user)
    patient = _patient(db_session, "0005")
    walked_a = _walk_in(reception, patient, doctor_a_user)
    walked_b = _walk_in(reception, patient, doctor_b_user)
    assert walked_a["visit_id"] == walked_b["visit_id"]

    _complete_consultation(db_session, walked_a["id"])
    # walked_b remains WAITING

    res = reception.get(f"/api/visits/{walked_a['visit_id']}")
    assert res.status_code == 200, res.text
    detail = res.json()
    assert detail["outstanding_paise"] == 30000
    assert detail["total_paid_paise"] == 0


def test_s6_reassigned_consultation_completed(
    clock, login_client, reception_user, doctor_a_user, doctor_b_user, db_session
):
    """S6: waiting consultation reassigned, new one completed: one fee (the new doctor's), not two."""
    dept = doctor_a_user.doctor.departments[0]
    if dept not in doctor_b_user.doctor.departments:
        doctor_b_user.doctor.departments.append(dept)
    _set_doctor_fee(doctor_a_user, 30000)
    _set_doctor_fee(doctor_b_user, 70000)
    db_session.flush()

    reception = login_client(reception_user)
    patient = _patient(db_session, "0006")
    walked = _walk_in(reception, patient, doctor_a_user)

    reassign_res = reception.post(
        f"/api/appointments/{walked['id']}/reassign",
        json={
            "version_id": walked["version_id"],
            "new_doctor_id": doctor_b_user.doctor_id,
            "reason": "Reassign to specialist",
        },
    )
    assert reassign_res.status_code == 201, reassign_res.text
    new_appt_id = reassign_res.json()["id"]

    _complete_consultation(db_session, new_appt_id)

    res = reception.get(f"/api/visits/{walked['visit_id']}")
    assert res.status_code == 200, res.text
    detail = res.json()
    assert detail["outstanding_paise"] == 70000
    assert detail["total_paid_paise"] == 0


def test_s7_cancelled_visit(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    """S7: visit cancelled with its only consultation cancelled: 0."""
    _set_doctor_fee(doctor_a_user, 30000)
    reception = login_client(reception_user)
    patient = _patient(db_session, "0007")
    walked = _walk_in(reception, patient, doctor_a_user)

    # Cancel the consultation first
    cancel_appt = reception.patch(
        f"/api/appointments/{walked['id']}/status",
        json={
            "version_id": walked["version_id"],
            "status": "CANCELLED",
            "cancellation_reason": "Patient decided to leave",
        },
    )
    assert cancel_appt.status_code == 200, cancel_appt.text

    cancel_res = reception.post(
        f"/api/visits/{walked['visit_id']}/cancel",
        json={"version_id": 1, "reason": "Patient decided to leave"},
    )
    assert cancel_res.status_code == 200, cancel_res.text

    res = reception.get(f"/api/visits/{walked['visit_id']}")
    assert res.status_code == 200, res.text
    assert res.json()["outstanding_paise"] == 0


def test_s8_closed_with_balance_and_reason(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    """S8: closed with a balance and a reason: the closed-visit dues total for that visit equals the balance; a later payment lowers it; the visit stays CLOSED."""
    _set_doctor_fee(doctor_a_user, 30000)
    reception = login_client(reception_user)
    patient = _patient(db_session, "0008")
    walked = _walk_in(reception, patient, doctor_a_user)
    _complete_consultation(db_session, walked["id"])

    close_res = reception.post(
        f"/api/visits/{walked['visit_id']}/close",
        json={"version_id": 1, "reason": "Patient to pay balance tomorrow"},
    )
    assert close_res.status_code == 200, close_res.text
    assert close_res.json()["status"] == "CLOSED"

    # Closed visit dues total equals balance
    assert _closed_visit_dues(reception, walked["visit_id"]) == 30000

    # Later payment lowers it
    pay_res = reception.post(
        "/api/payments",
        json={
            "patient_id": patient.id,
            "appointment_id": walked["id"],
            "amount_paise": 10000,
            "payment_method": "CASH",
        },
    )
    assert pay_res.status_code == 201, pay_res.text

    assert _closed_visit_dues(reception, walked["visit_id"]) == 20000

    res = reception.get(f"/api/visits/{walked['visit_id']}")
    assert res.status_code == 200, res.text
    detail = res.json()
    assert detail["status"] == "CLOSED"
    assert detail["outstanding_paise"] == 20000


def test_s9_fee_waived_and_discounted(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    """S9: fee waived: 0; fee discounted: the discounted amount."""
    _set_doctor_fee(doctor_a_user, 30000)
    reception = login_client(reception_user)
    doctor_client = login_client(doctor_a_user)

    # Part A: Waived
    patient_a = _patient(db_session, "0009A")
    walked_a = _walk_in(reception, patient_a, doctor_a_user)
    _complete_consultation(db_session, walked_a["id"])

    waive_res = doctor_client.post(
        f"/api/appointments/{walked_a['id']}/fee-adjustment",
        json={"kind": "WAIVER", "new_amount_paise": 0, "reason": "Indigent patient"},
    )
    assert waive_res.status_code == 201, waive_res.text

    res_a = reception.get(f"/api/visits/{walked_a['visit_id']}")
    assert res_a.status_code == 200, res_a.text
    assert res_a.json()["outstanding_paise"] == 0

    # Part B: Discounted
    patient_b = _patient(db_session, "0009B")
    walked_b = _walk_in(reception, patient_b, doctor_a_user)
    _complete_consultation(db_session, walked_b["id"])

    disc_res = doctor_client.post(
        f"/api/appointments/{walked_b['id']}/fee-adjustment",
        json={"kind": "DISCOUNT", "new_amount_paise": 18000, "reason": "Senior citizen"},
    )
    assert disc_res.status_code == 201, disc_res.text

    res_b = reception.get(f"/api/visits/{walked_b['visit_id']}")
    assert res_b.status_code == 200, res_b.text
    assert res_b.json()["outstanding_paise"] == 18000


def test_s10_doctor_default_fee_change_after_checkin(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    """S10: doctor default fee changed after check-in: outstanding unchanged (FEE-07, BILL-19)."""
    _set_doctor_fee(doctor_a_user, 30000)
    reception = login_client(reception_user)
    patient = _patient(db_session, "0010")
    walked = _walk_in(reception, patient, doctor_a_user)
    _complete_consultation(db_session, walked["id"])

    # Doctor increases fee to 60000
    _set_doctor_fee(doctor_a_user, 60000)
    db_session.flush()

    res = reception.get(f"/api/visits/{walked['visit_id']}")
    assert res.status_code == 200, res.text
    assert res.json()["outstanding_paise"] == 30000


def test_s11_completed_consultation_without_bill_line(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    """S11: completed consultation with no CONSULTATION line (inserted through the ORM).

    AFTER (Task 3): Fail closed (W4, K-63) — refused with consultation_missing_bill_line error,
    never falls back to doctor.default_fee_paise.
    """
    _set_doctor_fee(doctor_a_user, 40000)
    patient = _patient(db_session, "0011")
    visit = Visit(
        patient_id=patient.id,
        visit_date=date(2026, 11, 2),
        status=VisitStatus.OPEN.value,
        opened_by_user_id=reception_user.id,
    )
    db_session.add(visit)
    db_session.flush()

    appt = Appointment(
        patient_id=patient.id,
        doctor_id=doctor_a_user.doctor_id,
        appointment_date=date(2026, 11, 2),
        token_number=991,
        status="ARRIVED",
        consultation_status=ConsultationStatus.COMPLETED.value,
        visit_id=visit.id,
        created_by_user_id=reception_user.id,
    )
    db_session.add(appt)
    db_session.flush()

    reception = login_client(reception_user)
    res = reception.get(f"/api/visits/{visit.id}")
    assert res.status_code == 422, res.text
    assert res.json()["code"] == "consultation_missing_bill_line"

    with pytest.raises(ApiError) as exc_info:
        billing_service.visit_totals(db_session, [visit.id])
    assert exc_info.value.code == "consultation_missing_bill_line"


def test_s12_treatment_plan_payment_leaves_visit_outstanding_unchanged(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    """S12: treatment-plan payment for the same patient: visit outstanding unchanged."""
    _set_doctor_fee(doctor_a_user, 30000)
    reception = login_client(reception_user)
    patient = _patient(db_session, "0012")
    walked = _walk_in(reception, patient, doctor_a_user)
    _complete_consultation(db_session, walked["id"])

    plan = TreatmentPlan(
        patient_id=patient.id,
        doctor_id=doctor_a_user.doctor_id,
        plan_name="Physio 10-Pack",
        condition_diagnosis="Low back pain",
        total_sessions=10,
        agreed_price_paise=100000,
        status="ACTIVE",
    )
    db_session.add(plan)
    db_session.flush()

    # Pay against treatment plan
    pay_res = reception.post(
        "/api/payments",
        json={
            "patient_id": patient.id,
            "treatment_plan_id": plan.id,
            "amount_paise": 50000,
            "payment_method": "CASH",
        },
    )
    assert pay_res.status_code == 201, pay_res.text

    res = reception.get(f"/api/visits/{walked['visit_id']}")
    assert res.status_code == 200, res.text
    detail = res.json()
    assert detail["outstanding_paise"] == 30000
    assert detail["total_paid_paise"] == 0


def test_s13_reversed_payment_does_not_count(
    clock, login_client, reception_user, admin_user, doctor_a_user, db_session
):
    """S13: reversed payment: does not count."""
    _set_doctor_fee(doctor_a_user, 30000)
    reception = login_client(reception_user)
    admin_client = login_client(admin_user)
    patient = _patient(db_session, "0013")
    walked = _walk_in(reception, patient, doctor_a_user)
    _complete_consultation(db_session, walked["id"])

    pay_res = reception.post(
        "/api/payments",
        json={
            "patient_id": patient.id,
            "appointment_id": walked["id"],
            "amount_paise": 30000,
            "payment_method": "CASH",
        },
    )
    assert pay_res.status_code == 201, pay_res.text
    payment_id = pay_res.json()["id"]

    res_paid = reception.get(f"/api/visits/{walked['visit_id']}")
    assert res_paid.json()["outstanding_paise"] == 0
    assert res_paid.json()["total_paid_paise"] == 30000

    rev_res = admin_client.post(
        f"/api/payments/{payment_id}/reverse",
        json={"reversal_reason": "Payment entered by mistake"},
    )
    assert rev_res.status_code == 200, rev_res.text

    res_rev = reception.get(f"/api/visits/{walked['visit_id']}")
    assert res_rev.json()["outstanding_paise"] == 30000
    assert res_rev.json()["total_paid_paise"] == 0


# ---------------------------------------------------------------------------
# BILL-01, BILL-02, BILL-16, BILL-17
# ---------------------------------------------------------------------------


def test_bill_01_ready_for_checkout_once_consultation_completed(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    """BILL-01: visit appears in ready_for_checkout once completed."""
    _set_doctor_fee(doctor_a_user, 30000)
    reception = login_client(reception_user)
    patient = _patient(db_session, "B001")
    walked = _walk_in(reception, patient, doctor_a_user)

    # Before completion: not in ready_for_checkout
    res_before = reception.get("/api/visits?ready_for_checkout=true")
    assert res_before.status_code == 200, res_before.text
    ids_before = [v["id"] for v in res_before.json()["visits"]]
    assert walked["visit_id"] not in ids_before

    _complete_consultation(db_session, walked["id"])

    # After completion: present in ready_for_checkout
    res_after = reception.get("/api/visits?ready_for_checkout=true")
    assert res_after.status_code == 200, res_after.text
    ids_after = [v["id"] for v in res_after.json()["visits"]]
    assert walked["visit_id"] in ids_after


def test_bill_02_consultation_charge_reads_the_fee(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    """BILL-02: consultation charge reads the fee."""
    _set_doctor_fee(doctor_a_user, 30000)
    reception = login_client(reception_user)
    patient = _patient(db_session, "B002")
    walked = _walk_in(reception, patient, doctor_a_user)
    _complete_consultation(db_session, walked["id"])

    res = reception.get(f"/api/visits/{walked['visit_id']}")
    assert res.status_code == 200, res.text
    detail = res.json()
    assert len(detail["consultations"]) == 1
    c = detail["consultations"][0]
    assert c["fee_paise"] == 30000
    assert c["balance_paise"] == 30000


def test_bill_16_patient_out_with_balance_and_no_reason_refused(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    """BILL-16: Patient Out with a balance and no reason returns 422."""
    _set_doctor_fee(doctor_a_user, 30000)
    reception = login_client(reception_user)
    patient = _patient(db_session, "B016")
    walked = _walk_in(reception, patient, doctor_a_user)
    _complete_consultation(db_session, walked["id"])

    # No reason
    res_no = reception.post(
        f"/api/visits/{walked['visit_id']}/close",
        json={"version_id": 1, "reason": None},
    )
    assert res_no.status_code == 422, res_no.text

    # Whitespace-only reason
    res_ws = reception.post(
        f"/api/visits/{walked['visit_id']}/close",
        json={"version_id": 1, "reason": "   "},
    )
    assert res_ws.status_code == 422, res_ws.text


def test_bill_17_patient_out_with_balance_and_reason_closes(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    """BILL-17: Patient Out with a balance and a reason closes the visit."""
    _set_doctor_fee(doctor_a_user, 30000)
    reception = login_client(reception_user)
    patient = _patient(db_session, "B017")
    walked = _walk_in(reception, patient, doctor_a_user)
    _complete_consultation(db_session, walked["id"])

    res = reception.post(
        f"/api/visits/{walked['visit_id']}/close",
        json={"version_id": 1, "reason": "Approved delayed settlement"},
    )
    assert res.status_code == 200, res.text
    detail = res.json()
    assert detail["status"] == "CLOSED"
    assert detail["close_reason"] == "Approved delayed settlement"


# ---------------------------------------------------------------------------
# Compare script test (Task 3: xfail removed)
# ---------------------------------------------------------------------------


def test_compare_script_reports_zero_mismatches(db_session):
    """The comparison script reports zero mismatches on the test database."""
    mismatches = compare_visit_balances(db_session)
    assert mismatches == []


# ---------------------------------------------------------------------------
# Task 3 New-Behaviour Tests
# ---------------------------------------------------------------------------


def test_visit_id_payment_lowers_outstanding(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    """New: a payment with visit_id (inserted via ORM) lowers the visit outstanding."""
    _set_doctor_fee(doctor_a_user, 30000)
    reception = login_client(reception_user)
    patient = _patient(db_session, "V001")
    walked = _walk_in(reception, patient, doctor_a_user)
    _complete_consultation(db_session, walked["id"])

    # Insert payment directly with visit_id
    pay = Payment(
        receipt_number="RCP-2026-V001",
        patient_id=patient.id,
        visit_id=walked["visit_id"],
        amount_paise=15000,
        payment_method="CASH",
        is_reversed=False,
        created_by_user_id=reception_user.id,
    )
    db_session.add(pay)
    db_session.flush()

    res = reception.get(f"/api/visits/{walked['visit_id']}")
    assert res.status_code == 200, res.text
    detail = res.json()
    assert detail["outstanding_paise"] == 15000
    assert detail["total_paid_paise"] == 15000


def test_payment_with_appointment_id_counted_once(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    """New: a payment carrying an appointment_id of the visit is counted exactly once."""
    _set_doctor_fee(doctor_a_user, 30000)
    reception = login_client(reception_user)
    patient = _patient(db_session, "V002")
    walked = _walk_in(reception, patient, doctor_a_user)
    _complete_consultation(db_session, walked["id"])

    pay_res = reception.post(
        "/api/payments",
        json={
            "patient_id": patient.id,
            "appointment_id": walked["id"],
            "amount_paise": 10000,
            "payment_method": "CASH",
        },
    )
    assert pay_res.status_code == 201, pay_res.text

    totals = billing_service.visit_totals(db_session, [walked["visit_id"]])[walked["visit_id"]]
    assert totals.paid_paise == 10000
    assert totals.due_paise == 20000

    res = reception.get(f"/api/visits/{walked['visit_id']}")
    assert res.status_code == 200, res.text
    assert res.json()["total_paid_paise"] == 10000
    assert res.json()["outstanding_paise"] == 20000


def test_direct_bill_lines_active_voided_and_package(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    """New: an ACTIVE MEDICINE line without an appointment adds its amount; VOIDED adds nothing; PACKAGE adds 0."""
    from decimal import Decimal

    _set_doctor_fee(doctor_a_user, 30000)
    reception = login_client(reception_user)
    patient = _patient(db_session, "V003")
    walked = _walk_in(reception, patient, doctor_a_user)
    _complete_consultation(db_session, walked["id"])

    # Active medicine line without appointment
    med_line = BillItem(
        visit_id=walked["visit_id"],
        patient_id=patient.id,
        category="MEDICINE",
        source=BillItemSource.RECEPTION.value,
        description="Paracetamol 500mg",
        quantity=Decimal("10"),
        rate_paise=500,
        original_amount_paise=5000,
        amount_paise=5000,
        status="ACTIVE",
        created_by_user_id=reception_user.id,
    )
    db_session.add(med_line)
    db_session.flush()

    res1 = reception.get(f"/api/visits/{walked['visit_id']}")
    assert res1.status_code == 200, res1.text
    assert res1.json()["outstanding_paise"] == 35000  # 30000 + 5000

    # Voided line adds nothing
    voided_line = BillItem(
        visit_id=walked["visit_id"],
        patient_id=patient.id,
        category="ADDITIONAL",
        source=BillItemSource.RECEPTION.value,
        description="X-Ray Chest",
        quantity=Decimal("1"),
        rate_paise=60000,
        original_amount_paise=60000,
        amount_paise=60000,
        status="VOIDED",
        void_reason="Cancelled by doctor",
        voided_by_user_id=reception_user.id,
        voided_at=datetime(2026, 11, 2, 5, 0, tzinfo=UTC),
        created_by_user_id=reception_user.id,
    )
    db_session.add(voided_line)
    db_session.flush()

    res2 = reception.get(f"/api/visits/{walked['visit_id']}")
    assert res2.json()["outstanding_paise"] == 35000  # unchanged

    # Package reference line (amount 0) changes nothing
    pkg_plan = TreatmentPlan(
        patient_id=patient.id,
        doctor_id=doctor_a_user.doctor_id,
        plan_name="Physio 5-Pack",
        condition_diagnosis="Knee pain",
        total_sessions=5,
        agreed_price_paise=50000,
        status="ACTIVE",
    )
    db_session.add(pkg_plan)
    db_session.flush()

    pkg_line = BillItem(
        visit_id=walked["visit_id"],
        patient_id=patient.id,
        treatment_plan_id=pkg_plan.id,
        category="PACKAGE",
        source=BillItemSource.RECEPTION.value,
        description="Package Reference",
        quantity=Decimal("1"),
        rate_paise=0,
        original_amount_paise=0,
        amount_paise=0,
        status="ACTIVE",
        created_by_user_id=reception_user.id,
    )
    db_session.add(pkg_line)
    db_session.flush()

    res3 = reception.get(f"/api/visits/{walked['visit_id']}")
    assert res3.json()["outstanding_paise"] == 35000  # unchanged


def test_procedure_line_payable_when_consultation_completed(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    """New: a PROCEDURE line on a consultation follows rule (i): payable when consultation completes."""
    from decimal import Decimal

    _set_doctor_fee(doctor_a_user, 30000)
    reception = login_client(reception_user)
    patient = _patient(db_session, "V004")
    walked = _walk_in(reception, patient, doctor_a_user)

    # Add a procedure line to the appointment while waiting
    proc_line = BillItem(
        visit_id=walked["visit_id"],
        patient_id=patient.id,
        appointment_id=walked["id"],
        category="PROCEDURE",
        source=BillItemSource.DOCTOR.value,
        description="Wound dressing",
        quantity=Decimal("1"),
        rate_paise=12000,
        original_amount_paise=12000,
        amount_paise=12000,
        status="ACTIVE",
        created_by_user_id=doctor_a_user.id,
    )
    db_session.add(proc_line)
    db_session.flush()

    # While consultation is WAITING: 0 due
    res_waiting = reception.get(f"/api/visits/{walked['visit_id']}")
    assert res_waiting.json()["outstanding_paise"] == 0

    # Once consultation completes: 30000 + 12000 = 42000 due
    _complete_consultation(db_session, walked["id"])
    res_completed = reception.get(f"/api/visits/{walked['visit_id']}")
    assert res_completed.json()["outstanding_paise"] == 42000
