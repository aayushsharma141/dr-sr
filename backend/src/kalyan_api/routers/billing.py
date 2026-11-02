"""Billing, sequential receipts, reversals, and pending dues endpoints (Phase 15).

Guarantees:
- Monetary amounts stored and transmitted as integer paise (BIL-02).
- Atomic gap-free sequential receipts via receipt sequence service (BIL-04).
- Overpayments exceeding package fees rejected via row-lock and DB trigger (BIL-02).
- Dynamic pending dues computation without mutable stored balances (BIL-03).
- Admin-authorized payment reversals with mandatory reason tracking (BIL-05).
- Audit trail for payment collection and reversal.
"""

from fastapi import APIRouter, Depends, Request
from sqlalchemy import func, select
from sqlalchemy.orm import lazyload, selectinload

from kalyan_api import clock
from kalyan_api.core.errors import ApiError
from kalyan_api.core.permissions import Permission
from kalyan_api.core.policy import require
from kalyan_api.core.principal import (
    Principal,
    build_audit_context,
    current_principal,
)
from kalyan_api.db.session import SessionDep
from kalyan_api.models import (
    Appointment,
    ClinicSettings,
    Patient,
    Payment,
    TreatmentPlan,
)
from kalyan_api.schemas.billing import (
    PaymentCreate,
    PaymentOut,
    PaymentReversalCreate,
    PendingDueOut,
)
from kalyan_api.services import audit_service
from kalyan_api.services.audit_service import AuditAction
from kalyan_api.services.receipt_service import allocate_next_receipt_number

router = APIRouter(tags=["billing"])


def _to_payment_out(p: Payment) -> PaymentOut:
    """Map Payment model to PaymentOut schema."""
    return PaymentOut(
        id=p.id,
        receipt_number=p.receipt_number,
        patient_id=p.patient_id,
        patient_urn=p.patient.urn if p.patient else "",
        patient_name=p.patient.full_name if p.patient else "",
        treatment_plan_id=p.treatment_plan_id,
        treatment_plan_name=p.treatment_plan.plan_name if p.treatment_plan else None,
        appointment_id=p.appointment_id,
        amount_paise=p.amount_paise,
        payment_method=p.payment_method,
        notes=p.notes,
        is_reversed=p.is_reversed,
        reversal_reason=p.reversal_reason,
        reversed_by_username=p.reversed_by_user.username if p.reversed_by_user else None,
        reversed_at=p.reversed_at,
        created_by_username=p.created_by_user.username if p.created_by_user else "",
        created_at=p.created_at,
    )


@router.post(
    "/payments",
    response_model=PaymentOut,
    status_code=201,
    dependencies=[Depends(require(Permission.PAYMENT_CREATE))],
)
def record_payment(
    payload: PaymentCreate,
    session: SessionDep,
    request: Request,
    principal: Principal = Depends(current_principal),
) -> PaymentOut:
    """Record a consultation or treatment package instalment payment (BIL-01, BIL-02)."""
    # 1. Verify patient exists
    patient = session.get(Patient, payload.patient_id)
    if not patient or not patient.is_active:
        raise ApiError(
            status_code=404,
            code="patient_not_found",
            message="Active patient not found.",
        )

    # 2. If treatment plan payment, serialize and enforce balance limits
    if payload.treatment_plan_id is not None:
        plan_stmt = (
            select(TreatmentPlan)
            .where(TreatmentPlan.id == payload.treatment_plan_id)
            .options(
                lazyload(TreatmentPlan.patient),
                lazyload(TreatmentPlan.doctor),
            )
            .with_for_update()
        )
        plan = session.execute(plan_stmt).scalar_one_or_none()
        if not plan or plan.patient_id != payload.patient_id:
            raise ApiError(
                status_code=404,
                code="plan_not_found",
                message="Treatment package not found for patient.",
            )
        if plan.status != "ACTIVE":
            raise ApiError(
                status_code=422,
                code="plan_not_active",
                message=f"Cannot record payment for {plan.status.lower()} treatment package.",
            )

        # Calculate current sum of non-reversed payments
        paid_stmt = select(func.coalesce(func.sum(Payment.amount_paise), 0)).where(
            Payment.treatment_plan_id == plan.id,
            Payment.is_reversed.is_(False),
        )
        already_paid: int = session.scalar(paid_stmt) or 0
        remaining_balance = plan.agreed_price_paise - already_paid

        if payload.amount_paise > remaining_balance:
            max_rupees = remaining_balance / 100
            attempted_rupees = payload.amount_paise / 100
            raise ApiError(
                status_code=422,
                code="overpayment_rejected",
                message=(
                    f"Payment of ₹{attempted_rupees:,.2f} exceeds remaining "
                    f"balance of ₹{max_rupees:,.2f}."
                ),
            )

    # 3. If appointment linked, verify
    if payload.appointment_id is not None:
        appt = session.get(Appointment, payload.appointment_id)
        if not appt or appt.patient_id != payload.patient_id:
            raise ApiError(
                status_code=404,
                code="appointment_not_found",
                message="Appointment not found for patient.",
            )

    # 4. Determine receipt sequence cycle from clinic settings
    settings = session.scalar(select(ClinicSettings).where(ClinicSettings.id == 1))
    cycle = settings.receipt_sequence_cycle if settings else "FINANCIAL_YEAR"

    receipt_number = allocate_next_receipt_number(session, cycle=cycle)

    # 5. Insert Payment
    payment = Payment(
        receipt_number=receipt_number,
        patient_id=payload.patient_id,
        treatment_plan_id=payload.treatment_plan_id,
        appointment_id=payload.appointment_id,
        amount_paise=payload.amount_paise,
        payment_method=payload.payment_method,
        notes=payload.notes,
        is_reversed=False,
        created_by_user_id=principal.user_id,
    )
    session.add(payment)
    session.flush()

    # 6. Audit Trail
    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        action=AuditAction.PAYMENT_RECORDED,
        entity_type="payment",
        entity_id=str(payment.id),
        after={
            "receipt_number": payment.receipt_number,
            "patient_id": payment.patient_id,
            "treatment_plan_id": payment.treatment_plan_id,
            "amount_paise": payment.amount_paise,
            "payment_method": payment.payment_method,
        },
    )

    return _to_payment_out(payment)


@router.get(
    "/payments/{id}",
    response_model=PaymentOut,
    dependencies=[Depends(require(Permission.PAYMENT_READ))],
)
def get_payment(id: int, session: SessionDep) -> PaymentOut:
    """Fetch payment details and receipt metadata (BIL-04)."""
    stmt = (
        select(Payment)
        .where(Payment.id == id)
        .options(
            selectinload(Payment.patient),
            selectinload(Payment.treatment_plan),
            selectinload(Payment.created_by_user),
            selectinload(Payment.reversed_by_user),
        )
    )
    payment = session.execute(stmt).scalar_one_or_none()
    if not payment:
        raise ApiError(
            status_code=404,
            code="payment_not_found",
            message="Payment transaction not found.",
        )
    return _to_payment_out(payment)


@router.get(
    "/patients/{patient_id}/payments",
    response_model=list[PaymentOut],
    dependencies=[Depends(require(Permission.PAYMENT_READ))],
)
def list_patient_payments(patient_id: int, session: SessionDep) -> list[PaymentOut]:
    """Retrieve full payment history for a patient (BIL-01)."""
    patient = session.get(Patient, patient_id)
    if not patient:
        raise ApiError(
            status_code=404,
            code="patient_not_found",
            message="Patient not found.",
        )

    stmt = (
        select(Payment)
        .where(Payment.patient_id == patient_id)
        .options(
            selectinload(Payment.patient),
            selectinload(Payment.treatment_plan),
            selectinload(Payment.created_by_user),
            selectinload(Payment.reversed_by_user),
        )
        .order_by(Payment.created_at.desc())
    )
    payments = session.execute(stmt).scalars().all()
    return [_to_payment_out(p) for p in payments]


@router.get(
    "/billing/pending-dues",
    response_model=list[PendingDueOut],
    dependencies=[Depends(require(Permission.PAYMENT_READ))],
)
def list_pending_dues(session: SessionDep) -> list[PendingDueOut]:
    """List active treatment packages with outstanding pending balances (BIL-03)."""
    # Query active plans
    stmt = (
        select(TreatmentPlan)
        .where(TreatmentPlan.status == "ACTIVE")
        .options(selectinload(TreatmentPlan.patient))
        .order_by(TreatmentPlan.created_at.desc())
    )
    active_plans = session.execute(stmt).scalars().all()

    dues: list[PendingDueOut] = []
    for plan in active_plans:
        paid_stmt = select(func.coalesce(func.sum(Payment.amount_paise), 0)).where(
            Payment.treatment_plan_id == plan.id,
            Payment.is_reversed.is_(False),
        )
        paid_paise: int = session.scalar(paid_stmt) or 0
        balance_paise = plan.agreed_price_paise - paid_paise

        if balance_paise > 0:
            dues.append(
                PendingDueOut(
                    treatment_plan_id=plan.id,
                    patient_id=plan.patient_id,
                    patient_urn=plan.patient.urn if plan.patient else "",
                    patient_name=plan.patient.full_name if plan.patient else "",
                    plan_name=plan.plan_name,
                    condition_diagnosis=plan.condition_diagnosis,
                    agreed_price_paise=plan.agreed_price_paise,
                    paid_paise=paid_paise,
                    balance_paise=balance_paise,
                    total_sessions=plan.total_sessions,
                    completed_sessions=plan.completed_sessions,
                )
            )

    return dues


@router.post(
    "/payments/{id}/reverse",
    response_model=PaymentOut,
    dependencies=[Depends(require(Permission.PAYMENT_REVERSE))],
)
def reverse_payment(
    id: int,
    payload: PaymentReversalCreate,
    session: SessionDep,
    request: Request,
    principal: Principal = Depends(current_principal),
) -> PaymentOut:
    """Admin-only payment reversal with mandatory reason tracking (BIL-05)."""
    stmt = (
        select(Payment)
        .where(Payment.id == id)
        .options(
            lazyload(Payment.patient),
            lazyload(Payment.treatment_plan),
            lazyload(Payment.created_by_user),
            lazyload(Payment.reversed_by_user),
        )
        .with_for_update()
    )
    payment = session.execute(stmt).scalar_one_or_none()
    if not payment:
        raise ApiError(
            status_code=404,
            code="payment_not_found",
            message="Payment transaction not found.",
        )

    if payment.is_reversed:
        raise ApiError(
            status_code=400,
            code="already_reversed",
            message="Payment transaction has already been reversed.",
        )

    before_state = {
        "is_reversed": payment.is_reversed,
        "amount_paise": payment.amount_paise,
        "receipt_number": payment.receipt_number,
    }

    # Perform reversal transition
    payment.is_reversed = True
    payment.reversal_reason = payload.reversal_reason.strip()
    payment.reversed_by_user_id = principal.user_id
    payment.reversed_at = clock.utcnow()
    session.flush()

    # Audit Trail
    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        action=AuditAction.PAYMENT_REVERSED,
        entity_type="payment",
        entity_id=str(payment.id),
        before=before_state,
        after={
            "is_reversed": True,
            "reversal_reason": payment.reversal_reason,
            "reversed_by_user_id": payment.reversed_by_user_id,
            "reversed_at": payment.reversed_at.isoformat() if payment.reversed_at else None,
        },
        reason=payload.reversal_reason.strip(),
    )

    return _to_payment_out(payment)
