"""Phase 22 Bill Line Quantity and Rate Correction Tests (MED-11, OD-22-15, owner decision option-a).

Tests:
1. Schema validation (BillLineCorrectRequest):
   - quantity only, rate only, or both accepted.
   - reason required (3-500 chars, whitespace trimmed).
   - extra fields forbidden.
   - at least one of quantity or rate_paise required.
2. Reception corrects own same-day MEDICINE line quantity:
   - Line 2 x 5000 -> quantity 3. Amount becomes 15000; visit total increases by 5000.
   - Original amount paise preserved as 10000.
   - BillItemAdjustment kind CORRECTION created with old/new quantity, rate, amount, reason, actor.
   - AuditLog BILL_ITEM_ADJUSTED recorded.
3. Reception corrects own same-day line rate:
   - Rate changes, amount recomputes via line_amount_paise.
4. Reception corrects both quantity and rate.
5. Permission and scope refusals (403):
   - Reception cannot correct other user's line (403 correction_not_permitted).
   - Reception cannot correct earlier IST day line (403 correction_not_permitted).
6. Consultation line refusal:
   - Cannot correct CONSULTATION lines (422 consultation_line_not_correctable).
7. Package line refusal:
   - Cannot correct PACKAGE lines (422 package_line_not_correctable).
8. Non-active line refusal:
   - Cannot correct VOIDED line (409 line_not_active).
9. Closed visit refusal:
   - Cannot correct line on closed visit (422 visit_closed).
10. Paid guard:
    - Correction that drops visit total below paid is refused (422 correction_below_paid).
11. No-change refusal:
    - Same quantity and rate as existing line rejected (422 no_change).
12. Admin correction route (POST /api/bill-items/{id}/admin-correct):
    - Admin can correct any non-consultation line on open visit (owner decision (v)).
    - RBAC isolation: reception cannot call admin-correct (403); admin cannot call reception correct (403).
13. Missing item 404 bill_item_not_found.
14. Direct service unit tests.
"""

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import itertools
from typing import Any
import uuid

import pytest
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from kalyan_api.clock import IST, ist_today, utcnow
from kalyan_api.core.errors import ApiError
from kalyan_api.core.principal import Principal
from kalyan_api.models import (
    Appointment,
    AuditLog,
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
    User,
    Visit,
    VisitStatus,
)
from kalyan_api.schemas.bill import BillLineCorrectRequest
from kalyan_api.services import audit_service, bill_service, billing_service
from kalyan_api.services.audit_service import AuditAction

TODAY = date(2026, 11, 2)
_TOKENS = itertools.count(600)


def _patient(db_session: Session, suffix: str) -> Patient:
    patient = Patient(
        urn=f"KH-2026-CORR{suffix}",
        full_name=f"Correct Test Patient {suffix}",
        guardian_name="Guardian",
        gender="M",
        age_years=40,
        mobile="9876543288",
        address="Ara",
    )
    db_session.add(patient)
    db_session.flush()
    return patient


def _visit(
    db_session: Session,
    patient: Patient,
    user: User,
    status: str = VisitStatus.OPEN.value,
    visit_date: date | None = None,
    **fields: Any,
) -> Visit:
    visit = Visit(
        patient_id=patient.id,
        visit_date=visit_date or TODAY,
        status=status,
        opened_by_user_id=user.id,
        **fields,
    )
    db_session.add(visit)
    db_session.flush()
    return visit


def _consultation(
    db_session: Session,
    visit: Visit,
    patient: Patient,
    doctor_user: User,
    user: User,
    status: str = ConsultationStatus.COMPLETED.value,
    fee_paise: int = 30000,
) -> tuple[Appointment, BillItem]:
    appt = Appointment(
        patient_id=patient.id,
        doctor_id=doctor_user.doctor_id,
        appointment_date=visit.visit_date,
        token_number=next(_TOKENS),
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
        status=BillItemStatus.ACTIVE.value,
        description="Consultation fee",
        quantity=Decimal("1"),
        rate_paise=fee_paise,
        original_amount_paise=fee_paise,
        amount_paise=fee_paise,
        created_by_user_id=user.id,
    )
    db_session.add(line)
    db_session.flush()
    return appt, line


def _reception_medicine_line(
    db_session: Session,
    visit: Visit,
    patient: Patient,
    user: User,
    quantity: Decimal = Decimal("2"),
    rate_paise: int = 5000,
    created_at: datetime | None = None,
) -> BillItem:
    amount = bill_service.line_amount_paise(quantity, rate_paise)
    line = BillItem(
        visit_id=visit.id,
        patient_id=patient.id,
        appointment_id=None,
        category=BillItemCategory.MEDICINE.value,
        source=BillItemSource.RECEPTION.value,
        status=BillItemStatus.ACTIVE.value,
        description="Amoxicillin 250mg",
        unit="strip",
        quantity=quantity,
        rate_paise=rate_paise,
        original_amount_paise=amount,
        amount_paise=amount,
        created_by_user_id=user.id,
    )
    if created_at is not None:
        line.created_at = created_at
    db_session.add(line)
    db_session.flush()
    return line


# ==========================================
# 1. Schema Validation Tests
# ==========================================


def test_bill_line_correct_request_schema():
    """Verify BillLineCorrectRequest schema constraints."""
    req1 = BillLineCorrectRequest(quantity=Decimal("3"), reason="  Patient requested more strips  ")
    assert req1.quantity == Decimal("3")
    assert req1.rate_paise is None
    assert req1.reason == "Patient requested more strips"

    req2 = BillLineCorrectRequest(rate_paise=6000, reason="Price revised")
    assert req2.quantity is None
    assert req2.rate_paise == 6000

    req3 = BillLineCorrectRequest(quantity=Decimal("1.5"), rate_paise=4000, reason="Updated both")
    assert req3.quantity == Decimal("1.5")
    assert req3.rate_paise == 4000

    # Short reason (<3 chars)
    with pytest.raises(ValidationError):
        BillLineCorrectRequest(quantity=Decimal("3"), reason="no")

    # Whitespace only reason
    with pytest.raises(ValidationError):
        BillLineCorrectRequest(quantity=Decimal("3"), reason="   ")

    # Long reason (>500 chars)
    with pytest.raises(ValidationError):
        BillLineCorrectRequest(quantity=Decimal("3"), reason="x" * 501)

    # Extra fields forbidden
    with pytest.raises(ValidationError):
        BillLineCorrectRequest(quantity=Decimal("3"), reason="Valid reason", extra="disallowed")  # type: ignore[call-arg]

    # Neither quantity nor rate_paise provided
    with pytest.raises(ValidationError):
        BillLineCorrectRequest(reason="Valid reason but no fields")

    # Invalid quantity (<= 0)
    with pytest.raises(ValidationError):
        BillLineCorrectRequest(quantity=Decimal("0"), reason="Zero quantity")

    with pytest.raises(ValidationError):
        BillLineCorrectRequest(quantity=Decimal("-1"), reason="Negative quantity")

    # Invalid rate (< 0)
    with pytest.raises(ValidationError):
        BillLineCorrectRequest(rate_paise=-100, reason="Negative rate")


# ==========================================
# 2. Reception Quantity and Rate Correction
# ==========================================


def test_reception_correct_own_same_day_quantity(
    login_client: Any,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Reception corrects quantity of own same-day line: 200, row updated, total increases, history written."""
    client = login_client(reception_user)
    patient = _patient(db_session, "01")
    visit = _visit(db_session, patient, reception_user)
    _consultation(db_session, visit, patient, doctor_a_user, reception_user, fee_paise=30000)

    # Reception adds medicine line: 2 x Rs 50 = Rs 100 (10000 paise)
    res_add = client.post(
        f"/api/visits/{visit.id}/bill-items",
        json={
            "category": "MEDICINE",
            "description": "Amoxicillin 250mg",
            "unit": "strip",
            "quantity": "2",
            "rate_paise": 5000,
        },
    )
    assert res_add.status_code == 201, res_add.text
    line_id = res_add.json()["id"]

    # Before correction: visit total = 30000 + 10000 = 40000 paise
    bill_before = client.get(f"/api/visits/{visit.id}/bill").json()
    assert bill_before["bill_total_paise"] == 40000

    # Correct quantity to 3: 3 x 5000 = 15000 paise
    res_corr = client.post(
        f"/api/bill-items/{line_id}/correct",
        json={
            "quantity": "3",
            "reason": "Doctor increased dosage to 3 strips",
        },
    )
    assert res_corr.status_code == 200, res_corr.text
    corr_data = res_corr.json()
    assert corr_data["id"] == line_id
    assert corr_data["status"] == "ACTIVE"
    assert corr_data["quantity"] == "3" or Decimal(corr_data["quantity"]) == Decimal("3")
    assert corr_data["rate_paise"] == 5000
    assert corr_data["amount_paise"] == 15000
    assert corr_data["original_amount_paise"] == 10000

    # History row verified
    assert len(corr_data["history"]) == 1
    h = corr_data["history"][0]
    assert h["kind"] == "CORRECTION"
    assert Decimal(h["old_quantity"]) == Decimal("2")
    assert Decimal(h["new_quantity"]) == Decimal("3")
    assert h["old_rate_paise"] == 5000
    assert h["new_rate_paise"] == 5000
    assert h["old_amount_paise"] == 10000
    assert h["new_amount_paise"] == 15000
    assert h["reason"] == "Doctor increased dosage to 3 strips"
    assert h["actor_user_id"] == reception_user.id

    # Database row verified directly
    db_line = db_session.get(BillItem, line_id)
    assert db_line is not None
    assert db_line.quantity == Decimal("3")
    assert db_line.rate_paise == 5000
    assert db_line.amount_paise == 15000
    assert db_line.original_amount_paise == 10000

    # Bill view shows new total: 30000 + 15000 = 45000 paise
    bill_after = client.get(f"/api/visits/{visit.id}/bill").json()
    assert bill_after["bill_total_paise"] == 45000

    # Audit log check
    audit_row = db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == AuditAction.BILL_ITEM_ADJUSTED.value,
            AuditLog.entity_id == str(line_id),
        )
    )
    assert audit_row is not None
    assert audit_row.actor_user_id == reception_user.id
    assert audit_row.reason == "Doctor increased dosage to 3 strips"
    assert audit_row.before_data["amount_paise"] == 10000
    assert audit_row.after_data["amount_paise"] == 15000


def test_reception_correct_rate_and_both(
    login_client: Any,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Reception updates rate only, then updates both quantity and rate."""
    client = login_client(reception_user)
    patient = _patient(db_session, "02")
    visit = _visit(db_session, patient, reception_user)
    _consultation(db_session, visit, patient, doctor_a_user, reception_user)
    line = _reception_medicine_line(db_session, visit, patient, reception_user, quantity=Decimal("2"), rate_paise=5000)

    # 1. Update rate to 6000: 2 x 6000 = 12000
    res1 = client.post(
        f"/api/bill-items/{line.id}/correct",
        json={"rate_paise": 6000, "reason": "Price correction per updated catalog"},
    )
    assert res1.status_code == 200, res1.text
    d1 = res1.json()
    assert d1["rate_paise"] == 6000
    assert d1["amount_paise"] == 12000

    # 2. Update both quantity and rate: 4 x 4000 = 16000
    res2 = client.post(
        f"/api/bill-items/{line.id}/correct",
        json={"quantity": "4", "rate_paise": 4000, "reason": "Patient bought 4 strips at bulk rate"},
    )
    assert res2.status_code == 200, res2.text
    d2 = res2.json()
    assert Decimal(d2["quantity"]) == Decimal("4")
    assert d2["rate_paise"] == 4000
    assert d2["amount_paise"] == 16000
    assert len(d2["history"]) == 2


# ==========================================
# 3. Permission and Scope Refusals (403)
# ==========================================


def test_reception_cannot_correct_others_line(
    login_client: Any,
    reception_user: User,
    doctor_a_user: User,
    test_settings: Any,
    db_session: Session,
) -> None:
    """Reception user B cannot correct reception user A's line (403 correction_not_permitted)."""
    user_b = User(
        username=f"rec_b_{uuid.uuid4().hex[:6]}",
        password_hash=reception_user.password_hash,
        role="RECEPTION",
        full_name="Receptionist B",
        is_active=True,
        must_change_password=False,
    )
    db_session.add(user_b)
    db_session.flush()

    patient = _patient(db_session, "03")
    visit = _visit(db_session, patient, reception_user)
    _consultation(db_session, visit, patient, doctor_a_user, reception_user)
    line = _reception_medicine_line(db_session, visit, patient, reception_user)

    client_b = login_client(user_b)
    res = client_b.post(
        f"/api/bill-items/{line.id}/correct",
        json={"quantity": "5", "reason": "Trying to edit other user line"},
    )
    assert res.status_code == 403, res.text
    assert res.json()["code"] == "correction_not_permitted"

    # Line remains unchanged
    db_session.refresh(line)
    assert line.quantity == Decimal("2")
    assert line.amount_paise == 10000


def test_reception_cannot_correct_older_line(
    login_client: Any,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Reception cannot correct a line created yesterday (403 correction_not_permitted)."""
    patient = _patient(db_session, "04")
    visit = _visit(db_session, patient, reception_user)
    _consultation(db_session, visit, patient, doctor_a_user, reception_user)

    yesterday = ist_today() - timedelta(days=1)
    yesterday_dt = datetime.combine(yesterday, datetime.min.time(), tzinfo=IST)
    line = _reception_medicine_line(db_session, visit, patient, reception_user, created_at=yesterday_dt)

    client = login_client(reception_user)
    res = client.post(
        f"/api/bill-items/{line.id}/correct",
        json={"quantity": "5", "reason": "Trying to edit yesterday's line"},
    )
    assert res.status_code == 403, res.text
    assert res.json()["code"] == "correction_not_permitted"


# ==========================================
# 4. Business Guard Refusals (422 / 409)
# ==========================================


def test_cannot_correct_consultation_line(
    login_client: Any,
    reception_user: User,
    admin_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Consultation lines cannot be corrected via bill-item correct routes (422)."""
    patient = _patient(db_session, "05")
    visit = _visit(db_session, patient, reception_user)
    _appt, consult_line = _consultation(db_session, visit, patient, doctor_a_user, reception_user)

    rec_client = login_client(reception_user)
    res1 = rec_client.post(
        f"/api/bill-items/{consult_line.id}/correct",
        json={"rate_paise": 20000, "reason": "Attempting to change consult fee"},
    )
    assert res1.status_code == 422, res1.text
    assert res1.json()["code"] == "consultation_line_not_correctable"

    admin_client = login_client(admin_user)
    res2 = admin_client.post(
        f"/api/bill-items/{consult_line.id}/admin-correct",
        json={"rate_paise": 20000, "reason": "Admin attempting to change consult fee"},
    )
    assert res2.status_code == 422, res2.text
    assert res2.json()["code"] == "consultation_line_not_correctable"


def test_cannot_correct_package_line(
    login_client: Any,
    reception_user: User,
    admin_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Package lines cannot be corrected via bill-item correct routes (422)."""
    patient = _patient(db_session, "06")
    visit = _visit(db_session, patient, reception_user)
    plan = TreatmentPlan(
        patient_id=patient.id,
        doctor_id=doctor_a_user.doctor_id,
        plan_name="Physio 10-Session Package",
        condition_diagnosis="Cervical Spondylosis",
        total_sessions=10,
        agreed_price_paise=500000,
    )
    db_session.add(plan)
    db_session.flush()

    pkg_line = BillItem(
        visit_id=visit.id,
        patient_id=patient.id,
        treatment_plan_id=plan.id,
        category=BillItemCategory.PACKAGE.value,
        source=BillItemSource.SYSTEM.value,
        status=BillItemStatus.ACTIVE.value,
        description="Physio 10-Session Package",
        quantity=Decimal("1"),
        rate_paise=0,
        original_amount_paise=0,
        amount_paise=0,
        created_by_user_id=reception_user.id,
    )
    db_session.add(pkg_line)
    db_session.flush()

    admin_client = login_client(admin_user)
    res = admin_client.post(
        f"/api/bill-items/{pkg_line.id}/admin-correct",
        json={"quantity": "2", "reason": "Change package quantity"},
    )
    assert res.status_code == 422, res.text
    assert res.json()["code"] == "package_line_not_correctable"


def test_cannot_correct_non_active_line(
    login_client: Any,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Voided line cannot be corrected (409 line_not_active)."""
    patient = _patient(db_session, "07")
    visit = _visit(db_session, patient, reception_user)
    _consultation(db_session, visit, patient, doctor_a_user, reception_user)
    line = _reception_medicine_line(db_session, visit, patient, reception_user)

    # Mark line as VOIDED
    line.status = BillItemStatus.VOIDED.value
    line.void_reason = "Test void"
    line.voided_by_user_id = reception_user.id
    line.voided_at = utcnow()
    db_session.flush()

    client = login_client(reception_user)
    res = client.post(
        f"/api/bill-items/{line.id}/correct",
        json={"quantity": "3", "reason": "Try correcting voided line"},
    )
    assert res.status_code == 409, res.text
    assert res.json()["code"] == "line_not_active"


def test_cannot_correct_closed_visit(
    login_client: Any,
    reception_user: User,
    admin_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Closed visit charges are locked: correction rejected (422 visit_closed)."""
    patient = _patient(db_session, "08")
    visit = _visit(
        db_session,
        patient,
        reception_user,
        status=VisitStatus.CLOSED.value,
        closed_at=utcnow(),
        closed_by_user_id=reception_user.id,
        close_reason="COMPLETED",
    )
    line = _reception_medicine_line(db_session, visit, patient, reception_user)

    rec_client = login_client(reception_user)
    res1 = rec_client.post(
        f"/api/bill-items/{line.id}/correct",
        json={"quantity": "3", "reason": "Try correcting closed visit"},
    )
    assert res1.status_code == 422, res1.text
    assert res1.json()["code"] == "visit_closed"

    admin_client = login_client(admin_user)
    res2 = admin_client.post(
        f"/api/bill-items/{line.id}/admin-correct",
        json={"quantity": "3", "reason": "Admin trying closed visit"},
    )
    assert res2.status_code == 422, res2.text
    assert res2.json()["code"] == "visit_closed"


def test_cannot_correct_below_paid(
    login_client: Any,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Correction that would drop visit bill total below paid is refused (422 correction_below_paid)."""
    patient = _patient(db_session, "09")
    visit = _visit(db_session, patient, reception_user)
    _consultation(db_session, visit, patient, doctor_a_user, reception_user, fee_paise=30000)
    line = _reception_medicine_line(db_session, visit, patient, reception_user, quantity=Decimal("2"), rate_paise=5000)

    # Total is 30000 + 10000 = 40000 paise. Record payment of 38000 paise.
    payment = Payment(
        patient_id=patient.id,
        visit_id=visit.id,
        amount_paise=38000,
        payment_method="CASH",
        receipt_number="REC-CORR-01",
        created_by_user_id=reception_user.id,
    )
    db_session.add(payment)
    db_session.flush()

    # Reducing quantity to 1 makes line 5000, new total 35000 < 38000 paid -> refused
    client = login_client(reception_user)
    res = client.post(
        f"/api/bill-items/{line.id}/correct",
        json={"quantity": "1", "reason": "Reducing quantity below payment"},
    )
    assert res.status_code == 422, res.text
    assert res.json()["code"] == "correction_below_paid"
    assert res.json()["details"]["visit_paid_paise"] == 38000

    # Line remains untouched
    db_session.refresh(line)
    assert line.quantity == Decimal("2")
    assert line.amount_paise == 10000


def test_correct_no_change_refused(
    login_client: Any,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Submitting the same quantity and rate is refused (422 no_change)."""
    patient = _patient(db_session, "10")
    visit = _visit(db_session, patient, reception_user)
    _consultation(db_session, visit, patient, doctor_a_user, reception_user)
    line = _reception_medicine_line(db_session, visit, patient, reception_user, quantity=Decimal("2"), rate_paise=5000)

    client = login_client(reception_user)
    res = client.post(
        f"/api/bill-items/{line.id}/correct",
        json={"quantity": "2", "rate_paise": 5000, "reason": "No actual change"},
    )
    assert res.status_code == 422, res.text
    assert res.json()["code"] == "no_change"


# ==========================================
# 5. Admin Correction & RBAC Isolation
# ==========================================


def test_admin_correct_route_and_rbac(
    login_client: Any,
    reception_user: User,
    admin_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Admin can correct any non-consultation line on open visit; strict RBAC isolation enforced."""
    patient = _patient(db_session, "11")
    visit = _visit(db_session, patient, reception_user)
    _consultation(db_session, visit, patient, doctor_a_user, reception_user)

    # Line created yesterday by reception
    yesterday = ist_today() - timedelta(days=1)
    yesterday_dt = datetime.combine(yesterday, datetime.min.time(), tzinfo=IST)
    older_line = _reception_medicine_line(
        db_session, visit, patient, reception_user, quantity=Decimal("2"), rate_paise=5000, created_at=yesterday_dt
    )

    rec_client = login_client(reception_user)
    admin_client = login_client(admin_user)
    doc_client = login_client(doctor_a_user)

    # 1. Reception cannot call admin-correct (403)
    res1 = rec_client.post(
        f"/api/bill-items/{older_line.id}/admin-correct",
        json={"quantity": "3", "reason": "Reception trying admin route"},
    )
    assert res1.status_code == 403, res1.text

    # 2. Doctor cannot call either route (403)
    res2a = doc_client.post(
        f"/api/bill-items/{older_line.id}/correct",
        json={"quantity": "3", "reason": "Doctor trying correct"},
    )
    assert res2a.status_code == 403, res2a.text

    res2b = doc_client.post(
        f"/api/bill-items/{older_line.id}/admin-correct",
        json={"quantity": "3", "reason": "Doctor trying admin correct"},
    )
    assert res2b.status_code == 403, res2b.text

    # 3. Admin cannot call reception correct (403)
    res3 = admin_client.post(
        f"/api/bill-items/{older_line.id}/correct",
        json={"quantity": "3", "reason": "Admin trying reception route"},
    )
    assert res3.status_code == 403, res3.text

    # 4. Admin succeeds on admin-correct (200)
    res4 = admin_client.post(
        f"/api/bill-items/{older_line.id}/admin-correct",
        json={"quantity": "3", "reason": "Admin fixing billing entry from yesterday"},
    )
    assert res4.status_code == 200, res4.text
    d4 = res4.json()
    assert d4["quantity"] == "3" or Decimal(d4["quantity"]) == Decimal("3")
    assert d4["amount_paise"] == 15000
    assert d4["history"][0]["actor_user_id"] == admin_user.id


def test_missing_bill_item_returns_404(
    login_client: Any,
    reception_user: User,
    admin_user: User,
) -> None:
    """Missing bill item returns 404 bill_item_not_found."""
    rec_client = login_client(reception_user)
    res1 = rec_client.post("/api/bill-items/999999/correct", json={"quantity": "2", "reason": "Missing item"})
    assert res1.status_code == 404, res1.text
    assert res1.json()["code"] == "bill_item_not_found"

    admin_client = login_client(admin_user)
    res2 = admin_client.post("/api/bill-items/999999/admin-correct", json={"quantity": "2", "reason": "Missing item"})
    assert res2.status_code == 404, res2.text
    assert res2.json()["code"] == "bill_item_not_found"
