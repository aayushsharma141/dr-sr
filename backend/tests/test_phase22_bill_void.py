"""Phase 22 Bill Line Void Tests (OD-G, OD-22-15, BILL-06, owner decision 2026-11-16 option-a).

Tests:
1. Reception voids own same-day MEDICINE line with a valid reason:
   - Returns 200 with VOIDED status, void_reason, voided_by, voided_at, history row.
   - Database row status is VOIDED; amount_paise unchanged; void_integrity check satisfied.
   - BillItemAdjustment kind VOID created with old_amount = original amount, new_amount = 0.
   - Visit total drops by line amount; bill view shows it under voided_lines (BILL-06).
   - Audit log BILL_ITEM_VOIDED recorded.
2. Reception user B attempting to void user A's line is refused (403 void_not_permitted).
3. Reception user A attempting to void a line from an earlier IST day is refused (403 void_not_permitted).
4. Voiding a CONSULTATION line through either route is refused (422 consultation_line_not_voidable).
5. Voiding an already VOIDED line is refused (409 line_already_voided).
6. Reason validation: < 3 chars, > 500 chars, whitespace only rejected (422).
7. Voiding a line that would drop total below paid is refused (422 void_below_paid).
8. Closed visit charges are locked: void rejected (422 visit_closed).
9. Admin void route (POST /api/bill-items/{id}/admin-void):
   - Admin can void any non-consultation line on an open visit (owner decision (v)).
   - History and audit recorded.
   - Reception cannot access admin-void (403); Admin cannot access reception void (403).
10. Missing bill item returns 404 bill_item_not_found.
11. Direct service void_line tests verifying all branch conditions and integrity.
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
    User,
    Visit,
    VisitStatus,
)
from kalyan_api.schemas.bill import BillLineCreate, BillLineVoidRequest
from kalyan_api.services import audit_service, bill_service, billing_service
from kalyan_api.services.audit_service import AuditAction

TODAY = date(2026, 11, 2)
_TOKENS = itertools.count(500)


def _patient(db_session: Session, suffix: str) -> Patient:
    patient = Patient(
        urn=f"KH-2026-VOID{suffix}",
        full_name=f"Void Test Patient {suffix}",
        guardian_name="Guardian",
        gender="M",
        age_years=35,
        mobile="9876543299",
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
        description="Paracetamol 500mg",
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


def test_bill_line_void_request_schema():
    """Verify BillLineVoidRequest schema constraints (3-500 chars, extra forbidden)."""
    req = BillLineVoidRequest(reason="  Patient returned medicine  ")
    assert req.reason == "Patient returned medicine"

    # Too short (< 3)
    with pytest.raises(ValidationError):
        BillLineVoidRequest(reason="ab")

    # Whitespace only
    with pytest.raises(ValidationError):
        BillLineVoidRequest(reason="   ")

    # Too long (> 500)
    with pytest.raises(ValidationError):
        BillLineVoidRequest(reason="a" * 501)

    # Extra fields forbidden
    with pytest.raises(ValidationError):
        BillLineVoidRequest(reason="Valid reason", extra="disallowed")  # type: ignore[call-arg]


# ==========================================
# 2. Reception Void Own Same-Day Line (200)
# ==========================================


def test_reception_void_own_same_day_medicine_line(
    login_client: Any,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Reception voids its own same-day line: 200, row VOIDED, total drops, BILL-06."""
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

    # Before void: total should be 30000 + 10000 = 40000 paise
    bill_before = client.get(f"/api/visits/{visit.id}/bill").json()
    assert bill_before["bill_total_paise"] == 40000
    assert len(bill_before["voided_lines"]) == 0

    # Void the line via POST /api/bill-items/{id}/void
    res_void = client.post(
        f"/api/bill-items/{line_id}/void",
        json={"reason": "Patient returned it"},
    )
    assert res_void.status_code == 200, res_void.text
    void_data = res_void.json()
    assert void_data["id"] == line_id
    assert void_data["status"] == "VOIDED"
    assert void_data["counts_toward_total"] is False
    assert void_data["void_reason"] == "Patient returned it"
    assert void_data["voided_by_username"] == reception_user.username
    assert void_data["voided_at"] is not None
    assert len(void_data["history"]) == 1
    assert void_data["history"][0]["kind"] == "VOID"
    assert void_data["history"][0]["old_amount_paise"] == 10000
    assert void_data["history"][0]["new_amount_paise"] == 0
    assert void_data["history"][0]["reason"] == "Patient returned it"
    assert void_data["history"][0]["actor_user_id"] == reception_user.id

    # Check database row directly
    db_line = db_session.get(BillItem, line_id)
    assert db_line is not None
    assert db_line.status == BillItemStatus.VOIDED.value
    assert db_line.void_reason == "Patient returned it"
    assert db_line.voided_by_user_id == reception_user.id
    assert db_line.voided_at is not None
    # amount_paise stays unchanged (historical reference)
    assert db_line.amount_paise == 10000

    # Check BillItemAdjustment row
    adj = db_session.scalar(
        select(BillItemAdjustment).where(BillItemAdjustment.bill_item_id == line_id)
    )
    assert adj is not None
    assert adj.kind == BillItemAdjustmentKind.VOID.value
    assert adj.old_amount_paise == 10000
    assert adj.new_amount_paise == 0
    assert adj.reason == "Patient returned it"
    assert adj.actor_user_id == reception_user.id

    # After void: visit total drops by 10000 to 30000 paise (BILL-06)
    bill_after = client.get(f"/api/visits/{visit.id}/bill").json()
    assert bill_after["bill_total_paise"] == 30000
    assert len(bill_after["voided_lines"]) == 1
    assert bill_after["voided_lines"][0]["id"] == line_id
    assert bill_after["voided_lines"][0]["void_reason"] == "Patient returned it"

    # Audit log check
    audit_row = db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == AuditAction.BILL_ITEM_VOIDED.value,
            AuditLog.entity_id == str(line_id),
        )
    )
    assert audit_row is not None
    assert audit_row.actor_user_id == reception_user.id
    assert audit_row.reason == "Patient returned it"
    assert audit_row.before_data == {"amount_paise": 10000, "status": "ACTIVE"}
    assert audit_row.after_data["status"] == "VOIDED"
    assert audit_row.after_data["amount_paise"] == 0
    assert audit_row.after_data["line_id"] == line_id


# ==========================================
# 3. Permission and Scope Refusals (403)
# ==========================================


def test_reception_cannot_void_other_users_line(
    login_client: Any,
    reception_user: User,
    test_settings: Any,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Reception user B cannot void reception user A's line (OD-G: own lines only)."""
    from conftest import make_user

    user_b = make_user(db_session, test_settings, "RECEPTION", f"rec_b_{uuid.uuid4().hex[:6]}")

    patient = _patient(db_session, "02")
    visit = _visit(db_session, patient, reception_user)
    _consultation(db_session, visit, patient, doctor_a_user, reception_user)
    line = _reception_medicine_line(db_session, visit, patient, reception_user)

    client_b = login_client(user_b)
    res = client_b.post(
        f"/api/bill-items/{line.id}/void",
        json={"reason": "Trying to void other's line"},
    )
    assert res.status_code == 403, res.text
    assert res.json()["code"] == "void_not_permitted"

    # Line remains ACTIVE
    db_session.refresh(line)
    assert line.status == BillItemStatus.ACTIVE.value


def test_reception_cannot_void_older_line(
    login_client: Any,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Reception user cannot void a line created on an earlier IST day (OD-G: same-day only)."""
    patient = _patient(db_session, "03")
    visit = _visit(db_session, patient, reception_user)
    _consultation(db_session, visit, patient, doctor_a_user, reception_user)

    # Line created yesterday
    yesterday = ist_today() - timedelta(days=1)
    yesterday_dt = datetime.combine(yesterday, datetime.min.time(), tzinfo=IST)
    line = _reception_medicine_line(
        db_session, visit, patient, reception_user, created_at=yesterday_dt
    )

    client = login_client(reception_user)
    res = client.post(
        f"/api/bill-items/{line.id}/void",
        json={"reason": "Trying to void yesterday's line"},
    )
    assert res.status_code == 403, res.text
    assert res.json()["code"] == "void_not_permitted"

    # Line remains ACTIVE
    db_session.refresh(line)
    assert line.status == BillItemStatus.ACTIVE.value


# ==========================================
# 4. Consultation Line Refusal (422)
# ==========================================


def test_cannot_void_consultation_line(
    login_client: Any,
    reception_user: User,
    admin_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Consultation lines are never voided through bill-item void routes (422)."""
    patient = _patient(db_session, "04")
    visit = _visit(db_session, patient, reception_user)
    _appt, consult_line = _consultation(db_session, visit, patient, doctor_a_user, reception_user)

    rec_client = login_client(reception_user)
    res1 = rec_client.post(
        f"/api/bill-items/{consult_line.id}/void",
        json={"reason": "Attempt to void consultation"},
    )
    assert res1.status_code == 422, res1.text
    assert res1.json()["code"] == "consultation_line_not_voidable"

    admin_client = login_client(admin_user)
    res2 = admin_client.post(
        f"/api/bill-items/{consult_line.id}/admin-void",
        json={"reason": "Admin attempt to void consultation"},
    )
    assert res2.status_code == 422, res2.text
    assert res2.json()["code"] == "consultation_line_not_voidable"


# ==========================================
# 5. Already Voided Line Refusal (409)
# ==========================================


def test_cannot_void_already_voided_line(
    login_client: Any,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Voiding an already voided line returns 409 line_already_voided."""
    patient = _patient(db_session, "05")
    visit = _visit(db_session, patient, reception_user)
    _consultation(db_session, visit, patient, doctor_a_user, reception_user)
    line = _reception_medicine_line(db_session, visit, patient, reception_user)

    client = login_client(reception_user)
    res1 = client.post(
        f"/api/bill-items/{line.id}/void",
        json={"reason": "First void succeeds"},
    )
    assert res1.status_code == 200, res1.text

    # Second void on the same line
    res2 = client.post(
        f"/api/bill-items/{line.id}/void",
        json={"reason": "Second void must fail"},
    )
    assert res2.status_code == 409, res2.text
    assert res2.json()["code"] == "line_already_voided"


# ==========================================
# 6. Reason Validation Refusals (422)
# ==========================================


def test_short_and_invalid_reason_refused(
    login_client: Any,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Reason shorter than 3 or whitespace only is rejected (422)."""
    patient = _patient(db_session, "06")
    visit = _visit(db_session, patient, reception_user)
    _consultation(db_session, visit, patient, doctor_a_user, reception_user)
    line = _reception_medicine_line(db_session, visit, patient, reception_user)

    client = login_client(reception_user)
    # Shorter than 3
    res1 = client.post(
        f"/api/bill-items/{line.id}/void",
        json={"reason": "ab"},
    )
    assert res1.status_code == 422, res1.text

    # Whitespace only
    res2 = client.post(
        f"/api/bill-items/{line.id}/void",
        json={"reason": "   "},
    )
    assert res2.status_code == 422, res2.text

    # Line remains ACTIVE
    db_session.refresh(line)
    assert line.status == BillItemStatus.ACTIVE.value


# ==========================================
# 7. Paid Guard: void_below_paid (422)
# ==========================================


def test_void_below_paid_refused(
    login_client: Any,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Voiding a line that would drop total below what was paid is refused (422 void_below_paid)."""
    patient = _patient(db_session, "07")
    visit = _visit(db_session, patient, reception_user)
    # Consultation fee: 30000 paise (Rs 300)
    _consultation(db_session, visit, patient, doctor_a_user, reception_user, fee_paise=30000)
    # Medicine line: 20000 paise (Rs 200) -> total = 50000 paise
    line = _reception_medicine_line(
        db_session, visit, patient, reception_user, quantity=Decimal("2"), rate_paise=10000
    )

    client = login_client(reception_user)

    # Pay 40000 paise (Rs 400) on this visit
    pay_res = client.post(
        "/api/payments",
        json={
            "patient_id": patient.id,
            "visit_id": visit.id,
            "amount_paise": 40000,
            "payment_method": "CASH",
        },
    )
    assert pay_res.status_code == 201, pay_res.text

    # If line (20000) is voided, new total would be 30000, which is < paid (40000)
    res_void = client.post(
        f"/api/bill-items/{line.id}/void",
        json={"reason": "Patient returned but paid in full"},
    )
    assert res_void.status_code == 422, res_void.text
    err = res_void.json()
    assert err["code"] == "void_below_paid"
    assert err["details"]["visit_paid_paise"] == 40000

    # Line remains ACTIVE and total remains 50000
    db_session.refresh(line)
    assert line.status == BillItemStatus.ACTIVE.value
    totals = billing_service.visit_totals(db_session, [visit.id])[visit.id]
    assert totals.bill_total_paise == 50000
    assert totals.paid_paise == 40000


def test_void_allowed_when_new_total_at_least_paid(
    login_client: Any,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Voiding a line succeeds if new total remains >= paid."""
    patient = _patient(db_session, "08")
    visit = _visit(db_session, patient, reception_user)
    _consultation(db_session, visit, patient, doctor_a_user, reception_user, fee_paise=30000)
    line = _reception_medicine_line(
        db_session, visit, patient, reception_user, quantity=Decimal("2"), rate_paise=10000
    )

    client = login_client(reception_user)
    # Pay 25000 paise (Rs 250). New total after voiding 20000 will be 30000 >= 25000.
    pay_res = client.post(
        "/api/payments",
        json={
            "patient_id": patient.id,
            "visit_id": visit.id,
            "amount_paise": 25000,
            "payment_method": "CASH",
        },
    )
    assert pay_res.status_code == 201, pay_res.text

    res_void = client.post(
        f"/api/bill-items/{line.id}/void",
        json={"reason": "Partial payment only, void allowed"},
    )
    assert res_void.status_code == 200, res_void.text
    assert res_void.json()["status"] == "VOIDED"


# ==========================================
# 8. Closed Visit Refusal (422)
# ==========================================


def test_void_on_closed_visit_refused(
    login_client: Any,
    reception_user: User,
    admin_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Closed visit charges are locked: both reception and admin void are rejected (422 visit_closed)."""
    patient = _patient(db_session, "09")
    visit = _visit(
        db_session,
        patient,
        reception_user,
        status=VisitStatus.CLOSED.value,
        closed_by_user_id=reception_user.id,
        closed_at=utcnow(),
        close_reason="Completed and checked out",
    )
    _consultation(db_session, visit, patient, doctor_a_user, reception_user)
    line = _reception_medicine_line(db_session, visit, patient, reception_user)

    # Reception void
    rec_client = login_client(reception_user)
    res1 = rec_client.post(
        f"/api/bill-items/{line.id}/void",
        json={"reason": "Attempt on closed visit"},
    )
    assert res1.status_code == 422, res1.text
    assert res1.json()["code"] == "visit_closed"

    # Admin void (owner decision (iii): no edits after Patient Out, including admin)
    admin_client = login_client(admin_user)
    res2 = admin_client.post(
        f"/api/bill-items/{line.id}/admin-void",
        json={"reason": "Admin attempt on closed visit"},
    )
    assert res2.status_code == 422, res2.text
    assert res2.json()["code"] == "visit_closed"


# ==========================================
# 9. Admin Void Route (200 & RBAC)
# ==========================================


def test_admin_void_route_and_rbac(
    login_client: Any,
    admin_user: User,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Admin voids any non-consultation line on open visit (owner decision (v)).

    RBAC: Reception cannot call admin-void (403), Admin cannot call reception void (403).
    """
    patient = _patient(db_session, "10")
    visit = _visit(db_session, patient, reception_user)
    _consultation(db_session, visit, patient, doctor_a_user, reception_user)

    # Line created by another user or older date
    yesterday = ist_today() - timedelta(days=2)
    yesterday_dt = datetime.combine(yesterday, datetime.min.time(), tzinfo=IST)
    older_line = _reception_medicine_line(
        db_session, visit, patient, reception_user, created_at=yesterday_dt
    )

    admin_client = login_client(admin_user)
    rec_client = login_client(reception_user)

    # 1. Reception cannot call admin-void (403)
    res_rec_admin = rec_client.post(
        f"/api/bill-items/{older_line.id}/admin-void",
        json={"reason": "Reception trying admin-void"},
    )
    assert res_rec_admin.status_code == 403, res_rec_admin.text

    # 2. Admin cannot call reception void (403)
    res_admin_rec = admin_client.post(
        f"/api/bill-items/{older_line.id}/void",
        json={"reason": "Admin trying reception void"},
    )
    assert res_admin_rec.status_code == 403, res_admin_rec.text

    # 3. Admin voids the older line via admin-void: 200
    res_admin_void = admin_client.post(
        f"/api/bill-items/{older_line.id}/admin-void",
        json={"reason": "Admin authorized cancellation of stale medicine"},
    )
    assert res_admin_void.status_code == 200, res_admin_void.text
    void_data = res_admin_void.json()
    assert void_data["status"] == "VOIDED"
    assert void_data["void_reason"] == "Admin authorized cancellation of stale medicine"
    assert void_data["voided_by_username"] == admin_user.username

    # History row recorded with admin as actor
    adj = db_session.scalar(
        select(BillItemAdjustment).where(BillItemAdjustment.bill_item_id == older_line.id)
    )
    assert adj is not None
    assert adj.kind == BillItemAdjustmentKind.VOID.value
    assert adj.actor_user_id == admin_user.id


# ==========================================
# 10. Missing Bill Item (404)
# ==========================================


def test_missing_bill_item_returns_404(
    login_client: Any,
    reception_user: User,
    admin_user: User,
) -> None:
    """Voiding a non-existent bill item returns 404 bill_item_not_found."""
    rec_client = login_client(reception_user)
    res1 = rec_client.post("/api/bill-items/999999/void", json={"reason": "Void missing item"})
    assert res1.status_code == 404, res1.text
    assert res1.json()["code"] == "bill_item_not_found"

    admin_client = login_client(admin_user)
    res2 = admin_client.post(
        "/api/bill-items/999999/admin-void", json={"reason": "Admin missing item"}
    )
    assert res2.status_code == 404, res2.text
    assert res2.json()["code"] == "bill_item_not_found"


# ==========================================
# 11. Direct Service Unit Tests (void_line)
# ==========================================


def test_service_void_line_direct(
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Direct unit testing of bill_service.void_line branches."""
    patient = _patient(db_session, "11")
    visit = _visit(db_session, patient, reception_user)
    _appt, consult_line = _consultation(db_session, visit, patient, doctor_a_user, reception_user)
    med_line = _reception_medicine_line(db_session, visit, patient, reception_user)

    principal = Principal(
        user_id=reception_user.id,
        username=reception_user.username,
        role=reception_user.role,
        doctor_id=None,
        permissions=frozenset(),
        session_id=1,
        must_change_password=False,
    )

    # 1. Invalid reason length
    with pytest.raises(ApiError) as exc1:
        bill_service.void_line(
            db_session, med_line, principal, reason="ab", own_same_day_only=True
        )
    assert exc1.value.code == "invalid_reason"

    # 2. Consultation line refusal
    with pytest.raises(ApiError) as exc2:
        bill_service.void_line(
            db_session, consult_line, principal, reason="Valid reason", own_same_day_only=True
        )
    assert exc2.value.code == "consultation_line_not_voidable"

    # 3. Successful void
    line_ret, history_ret = bill_service.void_line(
        db_session, med_line, principal, reason="Valid cancellation", own_same_day_only=True
    )
    assert line_ret.status == BillItemStatus.VOIDED.value
    assert history_ret.kind == BillItemAdjustmentKind.VOID.value
    assert history_ret.new_amount_paise == 0

    # 4. Already voided refusal
    with pytest.raises(ApiError) as exc3:
        bill_service.void_line(
            db_session, med_line, principal, reason="Already voided", own_same_day_only=True
        )
    assert exc3.value.code == "line_already_voided"
