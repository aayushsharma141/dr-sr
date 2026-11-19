"""Patient financial ledger and Admin-only payment refund endpoints (T3.3).

Routes (mounted under /api in main.py):
- GET  /api/patients/{patient_id}/ledger   (Permission.PAYMENT_READ — ADMIN + RECEPTION)
- POST /api/payments/{payment_id}/refunds  (Permission.PAYMENT_REFUND — ADMIN only, D-06)
- GET  /api/patients/{patient_id}/refunds  (Permission.PAYMENT_READ — ADMIN + RECEPTION)
"""

from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select
from sqlalchemy.orm import lazyload, selectinload

from kalyan_api.core.errors import ApiError
from kalyan_api.core.permissions import Permission
from kalyan_api.core.policy import require
from kalyan_api.core.principal import Principal, build_audit_context, current_principal
from kalyan_api.db.session import SessionDep
from kalyan_api.models import Appointment, Patient, Payment, Refund
from kalyan_api.schemas.ledger import (
    LedgerEntryOut,
    LedgerPaymentItemOut,
    LedgerVisitBillOut,
    PatientLedgerResponse,
    RefundCreate,
    RefundOut,
)
from kalyan_api.services import audit_service, ledger_service
from kalyan_api.services.audit_service import AuditAction
from kalyan_api.services.code_sequence_service import effective_patient_ids

router = APIRouter(tags=["ledger"])


def _to_refund_out(
    refund: Refund,
    *,
    payment_receipt_number: str | None = None,
    refunded_by_username: str | None = None,
) -> RefundOut:
    """Map a Refund ORM row to RefundOut."""
    resolved_receipt = (
        payment_receipt_number
        if payment_receipt_number is not None
        else (refund.payment.receipt_number if refund.payment else None)
    )
    resolved_username = (
        refunded_by_username
        if refunded_by_username is not None
        else (refund.refunded_by_user.username if refund.refunded_by_user else "")
    )
    return RefundOut(
        id=refund.id,
        refund_number=refund.refund_number,
        payment_id=refund.payment_id,
        payment_receipt_number=resolved_receipt,
        patient_id=refund.patient_id,
        visit_id=refund.visit_id,
        amount_paise=refund.amount_paise,
        refund_method=refund.refund_method,
        reason=refund.reason,
        refunded_by_user_id=refund.refunded_by_user_id,
        refunded_by_username=resolved_username,
        created_at=refund.created_at,
    )


def _to_ledger_payment_out(
    summary: ledger_service.PaymentWithRefundSummary,
) -> LedgerPaymentItemOut:
    """Map a PaymentWithRefundSummary dataclass to LedgerPaymentItemOut."""
    p = summary.payment
    return LedgerPaymentItemOut(
        id=p.id,
        receipt_number=p.receipt_number,
        patient_id=p.patient_id,
        patient_urn=p.patient_urn or (p.patient.urn if p.patient else ""),
        patient_name=p.patient_name or (p.patient.full_name if p.patient else ""),
        patient_mobile=p.patient_mobile or (p.patient.mobile if p.patient else None),
        patient_address=p.patient_address or (p.patient.address if p.patient else None),
        treatment_plan_id=p.treatment_plan_id,
        treatment_plan_name=p.treatment_plan.plan_name if p.treatment_plan else None,
        appointment_id=p.appointment_id,
        visit_id=p.visit_id,
        amount_paise=p.amount_paise,
        payment_method=p.payment_method,
        notes=p.notes,
        is_reversed=p.is_reversed,
        reversal_reason=p.reversal_reason,
        reversed_by_username=p.reversed_by_user.username if p.reversed_by_user else None,
        reversed_at=p.reversed_at,
        created_by_username=p.created_by_user.username if p.created_by_user else "",
        created_at=p.created_at,
        refunded_paise=summary.refunded_paise,
        remaining_refundable_paise=summary.remaining_refundable_paise,
    )


@router.get(
    "/patients/{patient_id}/ledger",
    response_model=PatientLedgerResponse,
    dependencies=[Depends(require(Permission.PAYMENT_READ))],
)
def get_patient_ledger(
    patient_id: int,
    session: SessionDep,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    order: Literal["desc", "asc"] = Query(default="desc"),
) -> PatientLedgerResponse:
    """Return consolidated patient financial ledger, KPIs, payments with refund status, and visits.

    Consolidates merged alias patients and permits reads on archived/merged patients.
    """
    data = ledger_service.build_patient_ledger(
        session,
        patient_id,
        limit=limit,
        offset=offset,
        order=order,
    )
    return PatientLedgerResponse(
        patient_id=data.patient_id,
        patient_urn=data.patient_urn,
        total_billed_paise=data.total_billed_paise,
        total_paid_paise=data.total_paid_paise,
        total_refunded_paise=data.total_refunded_paise,
        outstanding_paise=data.outstanding_paise,
        ledger_balance_paise=data.ledger_balance_paise,
        entries=[
            LedgerEntryOut(
                id=item.entry.id,
                patient_id=item.entry.patient_id,
                visit_id=item.entry.visit_id,
                entry_type=item.entry.entry_type,
                direction=item.entry.direction,  # type: ignore[arg-type]
                amount_paise=item.entry.amount_paise,
                signed_amount_paise=item.entry.signed_amount_paise,
                running_balance_paise=item.running_balance_paise,
                reference_type=item.entry.reference_type,
                reference_id=item.entry.reference_id,
                description=item.entry.description,
                actor_user_id=item.entry.actor_user_id,
                actor_username=item.actor_username,
                occurred_at=item.entry.occurred_at,
                created_at=item.entry.created_at,
            )
            for item in data.entries
        ],
        total_entries=data.total_entries,
        limit=data.limit,
        offset=data.offset,
        payments=[_to_ledger_payment_out(p) for p in data.payments],
        refunds=[_to_refund_out(r) for r in data.refunds],
        visits=[
            LedgerVisitBillOut(
                visit_id=v.visit_id,
                visit_code=v.visit_code,
                visit_date=v.visit_date,
                status=v.status,
                bill_total_paise=v.bill_total_paise,
                paid_paise=v.paid_paise,
                refunded_paise=v.refunded_paise,
                due_paise=v.due_paise,
            )
            for v in data.visit_bills
        ],
    )


@router.post(
    "/payments/{payment_id}/refunds",
    response_model=RefundOut,
    status_code=201,
    dependencies=[Depends(require(Permission.PAYMENT_REFUND))],
)
def create_payment_refund(
    payment_id: int,
    payload: RefundCreate,
    session: SessionDep,
    request: Request,
    principal: Principal = Depends(current_principal),
) -> RefundOut:
    """Issue an Admin-only partial or full refund against a non-reversed payment (D-06)."""
    # Lock parent payment FOR UPDATE (lazyload joined relations to avoid PG outer-join lock error).
    stmt = (
        select(Payment)
        .where(Payment.id == payment_id)
        .options(
            lazyload(Payment.patient),
            lazyload(Payment.treatment_plan),
            lazyload(Payment.created_by_user),
            lazyload(Payment.reversed_by_user),
        )
        .with_for_update()
    )
    payment = session.execute(stmt).scalar_one_or_none()
    if payment is None:
        raise ApiError(
            status_code=404,
            code="payment_not_found",
            message="Payment transaction not found.",
        )

    if payment.is_reversed:
        raise ApiError(
            status_code=422,
            code="payment_reversed",
            message="Cannot refund a payment that has already been reversed.",
        )

    already_refunded = int(
        session.scalar(
            select(func.coalesce(func.sum(Refund.amount_paise), 0)).where(
                Refund.payment_id == payment.id
            )
        )
        or 0
    )
    remaining_refundable = max(0, payment.amount_paise - already_refunded)
    if payload.amount_paise > remaining_refundable:
        raise ApiError(
            status_code=422,
            code="refund_exceeds_payment",
            message=(
                f"Refund of ₹{payload.amount_paise / 100:,.2f} exceeds remaining "
                f"refundable amount of ₹{remaining_refundable / 100:,.2f}."
            ),
        )

    resolved_visit_id = payment.visit_id
    if resolved_visit_id is None and payment.appointment_id is not None:
        resolved_visit_id = session.scalar(
            select(Appointment.visit_id).where(
                Appointment.id == payment.appointment_id,
                Appointment.patient_id == payment.patient_id,
            )
        )

    refund_number = ledger_service.allocate_next_refund_number(session)

    refund = Refund(
        refund_number=refund_number,
        payment_id=payment.id,
        patient_id=payment.patient_id,
        visit_id=resolved_visit_id,
        amount_paise=payload.amount_paise,
        refund_method=payload.refund_method,
        reason=payload.reason,
        refunded_by_user_id=principal.user_id,
    )
    session.add(refund)
    session.flush()

    ledger_service.record_refund(
        session,
        refund,
        payment=payment,
        actor_user_id=principal.user_id,
    )

    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        action=AuditAction.PAYMENT_REFUNDED,
        entity_type="refund",
        entity_id=str(refund.id),
        after={
            "refund_number": refund.refund_number,
            "payment_id": refund.payment_id,
            "payment_receipt_number": payment.receipt_number,
            "patient_id": refund.patient_id,
            "visit_id": refund.visit_id,
            "amount_paise": refund.amount_paise,
            "refund_method": refund.refund_method,
            "reason": refund.reason,
        },
        reason=refund.reason,
    )

    return _to_refund_out(
        refund,
        payment_receipt_number=payment.receipt_number,
        refunded_by_username=principal.username,
    )


@router.get(
    "/patients/{patient_id}/refunds",
    response_model=list[RefundOut],
    dependencies=[Depends(require(Permission.PAYMENT_READ))],
)
def list_patient_refunds(patient_id: int, session: SessionDep) -> list[RefundOut]:
    """List immutable payment refunds for a patient, consolidating merged aliases."""
    patient = session.get(Patient, patient_id)
    if patient is None:
        raise ApiError(
            status_code=404,
            code="patient_not_found",
            message="Patient not found.",
        )

    patient_ids = effective_patient_ids(session, patient_id)
    stmt = (
        select(Refund)
        .where(Refund.patient_id.in_(patient_ids))
        .options(
            selectinload(Refund.refunded_by_user),
            selectinload(Refund.payment),
        )
        .order_by(Refund.created_at.desc(), Refund.id.desc())
    )
    refunds = session.execute(stmt).scalars().all()
    return [_to_refund_out(r) for r in refunds]
