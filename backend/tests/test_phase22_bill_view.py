"""Phase 22 Plan 09: Visit bill view endpoint (OD-22-14, OD-22-15, OD-22-17, LED-03..07, D-04, T22-08).

Tests GET /api/visits/{id}/bill:
- Fixed 5-section OD-22-14 breakdown: CONSULTATION, PROCEDURE, PACKAGE, MEDICINE, ADDITIONAL
- Section subtotals and bill total match visit_totals exactly
- Active lines listed; cancelled consultation lines excluded; voided lines in voided_lines
- History per line from bill_item_adjustments (FEE-09 read path)
- Patient previous dues from closed visits (OD-22-17)
- Packages information only (LED-03..07, OD-C, D-04 clinical data hidden)
- Authorisation (Admin 200, Reception 200, Doctor 403, Anon 401, Unknown 404)
"""

from datetime import UTC, date, datetime
from decimal import Decimal

import pytest
from sqlalchemy import select

from kalyan_api.models import (
    Appointment,
    BillItem,
    BillItemAdjustment,
    BillItemAdjustmentKind,
    BillItemCategory,
    BillItemSource,
    BillItemStatus,
    ConsultationStatus,
    Doctor,
    Patient,
    Payment,
    TreatmentPlan,
    TreatmentSession,
    Visit,
    VisitStatus,
)
from kalyan_api.services import billing_service

TODAY = date(2026, 11, 2)


def _patient(db_session, suffix: str) -> Patient:
    patient = Patient(
        urn=f"KH-2026-BV{suffix}",
        full_name=f"BillView Patient {suffix}",
        guardian_name="Guardian",
        gender="M",
        age_years=42,
        mobile="9876543900",
        address="Ara, Bihar",
        is_active=True,
    )
    db_session.add(patient)
    db_session.flush()
    return patient


def _visit(db_session, patient: Patient, user, status=VisitStatus.OPEN.value, visit_date=TODAY, **fields) -> Visit:
    visit = Visit(
        patient_id=patient.id,
        visit_date=visit_date,
        status=status,
        opened_by_user_id=user.id,
        **fields,
    )
    db_session.add(visit)
    db_session.flush()
    return visit


def _consultation(
    db_session,
    visit: Visit,
    patient: Patient,
    doctor_user,
    user,
    status: str = ConsultationStatus.COMPLETED.value,
    fee: int = 50000,
    token: int = 1,
) -> tuple[Appointment, BillItem]:
    appt = Appointment(
        patient_id=patient.id,
        doctor_id=doctor_user.doctor_id,
        appointment_date=visit.visit_date,
        token_number=token,
        status="ARRIVED",
        consultation_status=status,
        visit_id=visit.id,
        created_by_user_id=user.id,
    )
    db_session.add(appt)
    db_session.flush()

    line = BillItem(
        visit_id=visit.id,
        patient_id=patient.id,
        appointment_id=appt.id,
        category=BillItemCategory.CONSULTATION.value,
        source=BillItemSource.SYSTEM.value,
        description=f"Consultation with {doctor_user.doctor.name_en}",
        quantity=Decimal("1"),
        rate_paise=fee,
        original_amount_paise=fee,
        amount_paise=fee,
        status=BillItemStatus.ACTIVE.value,
        created_by_user_id=user.id,
    )
    db_session.add(line)
    db_session.flush()
    return appt, line


def _add_line(
    db_session,
    visit: Visit,
    user,
    category: str,
    desc: str,
    rate: int,
    qty: Decimal = Decimal("1"),
    source: str = BillItemSource.RECEPTION.value,
    status: str = BillItemStatus.ACTIVE.value,
    **kwargs,
) -> BillItem:
    amount = int(qty * rate)
    line = BillItem(
        visit_id=visit.id,
        patient_id=visit.patient_id,
        category=category,
        source=source,
        description=desc,
        quantity=qty,
        rate_paise=rate,
        original_amount_paise=amount,
        amount_paise=amount,
        status=status,
        created_by_user_id=user.id,
        **kwargs,
    )
    db_session.add(line)
    db_session.flush()
    return line


# ---------------------------------------------------------------------------
# Task 1 Tests: Sections, Totals, Payments, Shared Rules
# ---------------------------------------------------------------------------


def test_bill_view_sections_grouping_and_subtotals(
    login_client, reception_user, doctor_a_user, db_session
):
    """Task 1: Completed consultation 50000, MEDICINE 10000, ADDITIONAL 5000.

    Fixed OD-22-14 section order: CONSULTATION, PROCEDURE, PACKAGE, MEDICINE, ADDITIONAL.
    Subtotals: 50000, 0, 0, 10000, 5000. Total: 65000.
    """
    patient = _patient(db_session, "T1A")
    visit = _visit(db_session, patient, reception_user)
    _consultation(db_session, visit, patient, doctor_a_user, reception_user, fee=50000)
    _add_line(db_session, visit, reception_user, BillItemCategory.MEDICINE.value, "Paracetamol 500mg", 10000)
    _add_line(db_session, visit, reception_user, BillItemCategory.ADDITIONAL.value, "Bandage Roll", 5000)

    client = login_client(reception_user)
    res = client.get(f"/api/visits/{visit.id}/bill")
    assert res.status_code == 200, res.text
    bill = res.json()

    assert bill["visit_id"] == visit.id
    assert bill["patient_id"] == patient.id
    assert bill["status"] == "OPEN"
    assert bill["locked"] is False
    assert bill["bill_total_paise"] == 65000
    assert bill["paid_paise"] == 0
    assert bill["due_paise"] == 65000

    section_cats = [s["category"] for s in bill["sections"]]
    assert section_cats == ["CONSULTATION", "PROCEDURE", "PACKAGE", "MEDICINE", "ADDITIONAL"]

    subtotals = {s["category"]: s["subtotal_paise"] for s in bill["sections"]}
    assert subtotals == {
        "CONSULTATION": 50000,
        "PROCEDURE": 0,
        "PACKAGE": 0,
        "MEDICINE": 10000,
        "ADDITIONAL": 5000,
    }

    # Verify line attributes
    med_section = next(s for s in bill["sections"] if s["category"] == "MEDICINE")
    assert len(med_section["lines"]) == 1
    med_line = med_section["lines"][0]
    assert med_line["source"] == "RECEPTION"
    assert med_line["rate_paise"] == 10000
    assert med_line["amount_paise"] == 10000
    assert med_line["original_amount_paise"] == 10000
    assert med_line["counts_toward_total"] is True


def test_bill_view_waiting_consultation_not_counted_in_subtotal(
    login_client, reception_user, doctor_a_user, db_session
):
    """Waiting consultation line appears in CONSULTATION section but counts_toward_total is False."""
    patient = _patient(db_session, "T1B")
    visit = _visit(db_session, patient, reception_user)
    _consultation(
        db_session,
        visit,
        patient,
        doctor_a_user,
        reception_user,
        status=ConsultationStatus.WAITING.value,
        fee=30000,
    )

    client = login_client(reception_user)
    res = client.get(f"/api/visits/{visit.id}/bill")
    assert res.status_code == 200
    bill = res.json()

    cons_section = next(s for s in bill["sections"] if s["category"] == "CONSULTATION")
    assert len(cons_section["lines"]) == 1
    assert cons_section["lines"][0]["counts_toward_total"] is False
    assert cons_section["subtotal_paise"] == 0
    assert bill["bill_total_paise"] == 0


def test_bill_view_cancelled_consultation_lines_excluded(
    login_client, reception_user, doctor_a_user, db_session
):
    """Lines of CANCELLED consultations are not listed as charges (rule ii)."""
    patient = _patient(db_session, "T1C")
    visit = _visit(db_session, patient, reception_user)
    _consultation(
        db_session,
        visit,
        patient,
        doctor_a_user,
        reception_user,
        status=ConsultationStatus.CANCELLED.value,
        fee=30000,
    )

    client = login_client(reception_user)
    res = client.get(f"/api/visits/{visit.id}/bill")
    assert res.status_code == 200
    bill = res.json()

    cons_section = next(s for s in bill["sections"] if s["category"] == "CONSULTATION")
    assert len(cons_section["lines"]) == 0
    assert cons_section["subtotal_paise"] == 0
    assert bill["bill_total_paise"] == 0


def test_bill_view_payments_and_reversed_payments(
    login_client, reception_user, doctor_a_user, db_session
):
    """Payment recorded against visit reduces due; reversed payment does not count."""
    patient = _patient(db_session, "T1D")
    visit = _visit(db_session, patient, reception_user)
    _consultation(db_session, visit, patient, doctor_a_user, reception_user, fee=65000)

    # Valid visit payment
    p1 = Payment(
        patient_id=patient.id,
        visit_id=visit.id,
        amount_paise=20000,
        payment_method="CASH",
        receipt_number="RCP-2026-P1",
        is_reversed=False,
        created_by_user_id=reception_user.id,
    )
    # Reversed payment
    p2 = Payment(
        patient_id=patient.id,
        visit_id=visit.id,
        amount_paise=10000,
        payment_method="UPI",
        receipt_number="RCP-2026-P2",
        is_reversed=True,
        reversal_reason="Mistake in UPI transaction ID",
        reversed_by_user_id=reception_user.id,
        reversed_at=datetime.now(UTC),
        created_by_user_id=reception_user.id,
    )
    db_session.add_all([p1, p2])
    db_session.flush()

    client = login_client(reception_user)
    res = client.get(f"/api/visits/{visit.id}/bill")
    assert res.status_code == 200
    bill = res.json()

    assert bill["bill_total_paise"] == 65000
    assert bill["paid_paise"] == 20000
    assert bill["due_paise"] == 45000
    assert len(bill["payments"]) == 2
    payments_by_rcp = {p["receipt_number"]: p for p in bill["payments"]}
    assert payments_by_rcp["RCP-2026-P1"]["is_reversed"] is False
    assert payments_by_rcp["RCP-2026-P1"]["amount_paise"] == 20000
    assert payments_by_rcp["RCP-2026-P2"]["is_reversed"] is True
    assert payments_by_rcp["RCP-2026-P2"]["amount_paise"] == 10000


# ---------------------------------------------------------------------------
# Task 2 Tests: History, Voided Lines, Previous Dues, Packages
# ---------------------------------------------------------------------------


def test_bill_view_adjustment_history(
    login_client, reception_user, doctor_a_user, db_session
):
    """FEE-09 read path: line carries history from bill_item_adjustments."""
    patient = _patient(db_session, "T2A")
    visit = _visit(db_session, patient, reception_user)
    appt, line = _consultation(db_session, visit, patient, doctor_a_user, reception_user, fee=50000)

    # Apply discount
    line.amount_paise = 30000
    adj = BillItemAdjustment(
        bill_item_id=line.id,
        old_quantity=Decimal("1"),
        new_quantity=Decimal("1"),
        old_rate_paise=50000,
        new_rate_paise=30000,
        old_amount_paise=50000,
        new_amount_paise=30000,
        kind=BillItemAdjustmentKind.DISCOUNT.value,
        reason="Senior citizen concession",
        actor_user_id=doctor_a_user.id,
    )
    db_session.add(adj)
    db_session.flush()

    client = login_client(reception_user)
    res = client.get(f"/api/visits/{visit.id}/bill")
    assert res.status_code == 200
    bill = res.json()

    cons_line = bill["sections"][0]["lines"][0]
    assert cons_line["amount_paise"] == 30000
    assert cons_line["original_amount_paise"] == 50000
    assert len(cons_line["history"]) == 1
    h = cons_line["history"][0]
    assert h["kind"] == "DISCOUNT"
    assert h["old_amount_paise"] == 50000
    assert h["new_amount_paise"] == 30000
    assert h["old"] == 50000
    assert h["new"] == 30000
    assert h["reason"] == "Senior citizen concession"
    assert h["actor_username"] == doctor_a_user.username


def test_bill_view_voided_lines(
    login_client, reception_user, doctor_a_user, db_session
):
    """Voided line appears under voided_lines only, not in any section or total."""
    patient = _patient(db_session, "T2B")
    visit = _visit(db_session, patient, reception_user)
    _consultation(db_session, visit, patient, doctor_a_user, reception_user, fee=50000)

    # Active medicine line
    _add_line(db_session, visit, reception_user, BillItemCategory.MEDICINE.value, "Syrup", 5000)

    # Voided line
    _add_line(
        db_session,
        visit,
        reception_user,
        BillItemCategory.ADDITIONAL.value,
        "Mistake line",
        15000,
        status=BillItemStatus.VOIDED.value,
        void_reason="Billed by mistake",
        voided_by_user_id=reception_user.id,
        voided_at=datetime.now(UTC),
    )

    client = login_client(reception_user)
    res = client.get(f"/api/visits/{visit.id}/bill")
    assert res.status_code == 200
    bill = res.json()

    # Total is only 50000 + 5000 = 55000
    assert bill["bill_total_paise"] == 55000

    # Additional section is empty
    add_sec = next(s for s in bill["sections"] if s["category"] == "ADDITIONAL")
    assert len(add_sec["lines"]) == 0
    assert add_sec["subtotal_paise"] == 0

    # Voided line is listed in voided_lines
    assert len(bill["voided_lines"]) == 1
    v = bill["voided_lines"][0]
    assert v["status"] == "VOIDED"
    assert v["void_reason"] == "Billed by mistake"
    assert v["voided_by_username"] == reception_user.username
    assert v["voided_at"] is not None
    assert v["counts_toward_total"] is False


def test_bill_view_previous_dues(
    login_client, reception_user, doctor_a_user, db_session
):
    """OD-22-17: previous closed visits of the same patient with due > 0 listed; does not change bill total."""
    patient = _patient(db_session, "T2C")

    # Earlier CLOSED visit with due 20000
    earlier_due_visit = _visit(
        db_session,
        patient,
        reception_user,
        status=VisitStatus.CLOSED.value,
        visit_date=date(2026, 10, 20),
        closed_at=datetime.now(UTC),
        closed_by_user_id=reception_user.id,
    )
    _consultation(db_session, earlier_due_visit, patient, doctor_a_user, reception_user, fee=20000)

    # Earlier CLOSED visit with due 0
    earlier_paid_visit = _visit(
        db_session,
        patient,
        reception_user,
        status=VisitStatus.CLOSED.value,
        visit_date=date(2026, 10, 15),
        closed_at=datetime.now(UTC),
        closed_by_user_id=reception_user.id,
    )
    _consultation(db_session, earlier_paid_visit, patient, doctor_a_user, reception_user, fee=30000)
    Payment(
        patient_id=patient.id,
        visit_id=earlier_paid_visit.id,
        amount_paise=30000,
        payment_method="CASH",
        receipt_number="RCP-EARLY-PAID",
        is_reversed=False,
        created_by_user_id=reception_user.id,
    )
    db_session.add(
        Payment(
            patient_id=patient.id,
            visit_id=earlier_paid_visit.id,
            amount_paise=30000,
            payment_method="CASH",
            receipt_number="RCP-EARLY-PAID",
            is_reversed=False,
            created_by_user_id=reception_user.id,
        )
    )
    db_session.flush()

    # Current OPEN visit with fee 40000
    current_visit = _visit(db_session, patient, reception_user)
    _consultation(db_session, current_visit, patient, doctor_a_user, reception_user, fee=40000)

    client = login_client(reception_user)
    res = client.get(f"/api/visits/{current_visit.id}/bill")
    assert res.status_code == 200
    bill = res.json()

    assert bill["bill_total_paise"] == 40000
    assert bill["due_paise"] == 40000
    assert bill["previous_dues_total_paise"] == 20000

    assert len(bill["previous_dues"]) == 1
    pd = bill["previous_dues"][0]
    assert pd["visit_id"] == earlier_due_visit.id
    assert pd["balance_paise"] == 20000
    assert doctor_a_user.doctor.name_en in pd["doctor_names"]


def test_bill_view_packages_information_only_and_no_clinical_fields(
    login_client, reception_user, doctor_a_user, db_session
):
    """LED-03..07, OD-C, D-04: packages are info-only, track sessions & balance, NO clinical fields."""
    patient = _patient(db_session, "T2D")
    visit = _visit(db_session, patient, reception_user)
    _consultation(db_session, visit, patient, doctor_a_user, reception_user, fee=50000)

    # Treatment plan with 10 sessions, agreed 100000, paid 40000
    plan = TreatmentPlan(
        patient_id=patient.id,
        doctor_id=doctor_a_user.doctor_id,
        plan_name="Knee Rehabilitation 10x",
        condition_diagnosis="Severe Osteoarthritis Grade 3",  # Clinical field!
        total_sessions=10,
        completed_sessions=0,
        agreed_price_paise=100000,
        status="ACTIVE",
    )
    db_session.add(plan)
    db_session.flush()

    pay = Payment(
        patient_id=patient.id,
        treatment_plan_id=plan.id,
        amount_paise=40000,
        payment_method="CASH",
        receipt_number="RCP-PLAN-1",
        is_reversed=False,
        created_by_user_id=reception_user.id,
    )
    db_session.add(pay)
    db_session.flush()

    client = login_client(reception_user)
    res = client.get(f"/api/visits/{visit.id}/bill")
    assert res.status_code == 200
    bill = res.json()

    # Bill total is untouched by package
    assert bill["bill_total_paise"] == 50000

    assert len(bill["packages"]) == 1
    pkg = bill["packages"][0]
    assert pkg["treatment_plan_id"] == plan.id
    assert pkg["plan_name"] == "Knee Rehabilitation 10x"
    assert pkg["total_sessions"] == 10
    assert pkg["completed_sessions"] == 0
    assert pkg["remaining_sessions"] == 10  # LED-03..05
    assert pkg["agreed_price_paise"] == 100000
    assert pkg["paid_paise"] == 40000
    assert pkg["balance_paise"] == 60000

    # D-04 strict check: NO clinical fields in response
    assert "condition_diagnosis" not in pkg
    assert "diagnosis" not in pkg
    assert "Severe Osteoarthritis" not in res.text

    # Complete 1 session (LED-06)
    plan.completed_sessions = 1
    db_session.flush()

    res2 = client.get(f"/api/visits/{visit.id}/bill")
    pkg2 = res2.json()["packages"][0]
    assert pkg2["completed_sessions"] == 1
    assert pkg2["remaining_sessions"] == 9  # LED-06


def test_bill_view_authorisation(
    login_client, reception_user, admin_user, doctor_a_user, db_session
):
    """Admin 200, Reception 200, Doctor 403, Anon 401, Unknown 404."""
    patient = _patient(db_session, "T1AUTH")
    visit = _visit(db_session, patient, reception_user)
    _consultation(db_session, visit, patient, doctor_a_user, reception_user, fee=30000)

    # Reception: 200
    reception_client = login_client(reception_user)
    assert reception_client.get(f"/api/visits/{visit.id}/bill").status_code == 200

    # Admin: 200
    admin_client = login_client(admin_user)
    assert admin_client.get(f"/api/visits/{visit.id}/bill").status_code == 200

    # Doctor: 403
    doc_client = login_client(doctor_a_user)
    assert doc_client.get(f"/api/visits/{visit.id}/bill").status_code == 403

    # Unknown visit: 404
    assert reception_client.get("/api/visits/9999999/bill").status_code == 404


def test_bill_view_totals_strictly_match_visit_totals_across_complex_visit(
    login_client, reception_user, doctor_a_user, doctor_b_user, db_session
):
    """Subtotals sum and bill totals strictly equal visit_totals dynamically."""
    patient = _patient(db_session, "COMPLEX")
    visit = _visit(db_session, patient, reception_user)

    # Completed consultation with Dr A: 30000
    _consultation(db_session, visit, patient, doctor_a_user, reception_user, fee=30000, token=10)
    # In-consultation with Dr B: 40000 (should not count yet)
    _consultation(
        db_session,
        visit,
        patient,
        doctor_b_user,
        reception_user,
        status=ConsultationStatus.IN_CONSULTATION.value,
        fee=40000,
        token=11,
    )
    # Cancelled with Dr B: 40000 (should not appear in charges)
    _consultation(
        db_session,
        visit,
        patient,
        doctor_b_user,
        reception_user,
        status=ConsultationStatus.CANCELLED.value,
        fee=40000,
        token=12,
    )

    # Direct items
    _add_line(db_session, visit, reception_user, BillItemCategory.MEDICINE.value, "Ointment", 8000)
    _add_line(db_session, visit, reception_user, BillItemCategory.ADDITIONAL.value, "Dressing", 2000)
    _add_line(
        db_session,
        visit,
        reception_user,
        BillItemCategory.ADDITIONAL.value,
        "Mistake",
        5000,
        status=BillItemStatus.VOIDED.value,
        void_reason="Cancelled by patient",
        voided_by_user_id=reception_user.id,
        voided_at=datetime.now(UTC),
    )

    # Payment of 15000
    db_session.add(
        Payment(
            patient_id=patient.id,
            visit_id=visit.id,
            amount_paise=15000,
            payment_method="CASH",
            receipt_number="RCP-COMPLEX-1",
            is_reversed=False,
            created_by_user_id=reception_user.id,
        )
    )
    db_session.flush()

    totals = billing_service.visit_totals(db_session, [visit.id])[visit.id]

    client = login_client(reception_user)
    res = client.get(f"/api/visits/{visit.id}/bill")
    assert res.status_code == 200
    bill = res.json()

    assert bill["bill_total_paise"] == totals.bill_total_paise
    assert bill["paid_paise"] == totals.paid_paise
    assert bill["due_paise"] == totals.due_paise
    assert sum(s["subtotal_paise"] for s in bill["sections"]) == totals.bill_total_paise

