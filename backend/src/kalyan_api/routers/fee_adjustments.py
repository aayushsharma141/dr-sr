"""Consultation fee adjustment endpoints (Phase 22, Wave 3; OD-22-11, FEE-03..06, AUD-04).

Two routes, one per permission, so every rule is enforced by the route policy (require):
- POST /appointments/{id}/fee-adjustment  (bill:clinical, doctor): discount or waive the fee of
  own consultation. A doctor never corrects a fee upward.
- POST /appointments/{id}/fee-correction  (bill:adjust, admin): any kind, including a correction.

Reception holds neither permission by default (design §6), so it is refused by the route policy.
services/bill_service.py enforces the amount rules and the visit and payment locks.
"""

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select

from kalyan_api.core.errors import ApiError
from kalyan_api.core.permissions import Permission
from kalyan_api.core.policy import require
from kalyan_api.core.principal import Principal, build_audit_context, current_principal
from kalyan_api.db.session import SessionDep
from kalyan_api.models import Appointment, BillItemAdjustmentKind
from kalyan_api.schemas.fee_adjustment import FeeAdjustmentOut, FeeAdjustmentRequest
from kalyan_api.services import audit_service, bill_service, billing_service, booking_service
from kalyan_api.services.audit_service import AuditAction

router = APIRouter(prefix="/appointments", tags=["billing"])


def _apply(
    session: SessionDep,
    request: Request,
    principal: Principal,
    appointment_id: int,
    payload: FeeAdjustmentRequest,
    *,
    may_correct: bool,
    own_only: bool,
) -> FeeAdjustmentOut:
    appt_visit_id = session.scalar(
        select(Appointment.visit_id).where(Appointment.id == appointment_id)
    )
    if appt_visit_id is not None:
        billing_service.lock_visit(session, appt_visit_id)

    appt = booking_service.lock_appointment(session, appointment_id)
    if not appt or (own_only and appt.doctor_id != principal.doctor_id):
        raise ApiError(
            status_code=404, code="appointment_not_found", message="Appointment not found."
        )
    if appt_visit_id is not None and appt.visit_id != appt_visit_id:
        if appt.visit_id is not None:
            billing_service.lock_visit(session, appt.visit_id)
    line, history = bill_service.adjust_consultation_fee(
        session,
        appt,
        principal,
        kind=BillItemAdjustmentKind(payload.kind),
        new_amount_paise=payload.new_amount_paise,
        reason=payload.reason,
        may_correct=may_correct,
    )
    audit_service.record(
        session,
        build_audit_context(request, principal),
        action=AuditAction.BILL_ITEM_ADJUSTED,
        entity_type="appointment",
        entity_id=appt.id,
        before={"amount_paise": history.old_amount_paise},
        after={
            "amount_paise": history.new_amount_paise,
            "kind": history.kind,
            "bill_item_id": line.id,
        },
        reason=history.reason,
    )
    return FeeAdjustmentOut(
        bill_item_id=line.id,
        appointment_id=appt.id,
        kind=history.kind,
        old_amount_paise=history.old_amount_paise,
        new_amount_paise=history.new_amount_paise,
        reason=history.reason,
        actor_user_id=history.actor_user_id,
        created_at=history.created_at,
    )


@router.post(
    "/{id}/fee-adjustment",
    response_model=FeeAdjustmentOut,
    status_code=201,
    dependencies=[Depends(require(Permission.BILL_CLINICAL))],
)
def discount_or_waive_own_fee(
    id: int,
    payload: FeeAdjustmentRequest,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> FeeAdjustmentOut:
    """A doctor discounts or waives the fee of own consultation, with a reason (OD-22-11)."""
    if principal.doctor_id is None:
        raise ApiError(status_code=403, code="doctor_only", message="Only doctors can do this.")
    return _apply(
        session, request, principal, id, payload, may_correct=False, own_only=True
    )


@router.post(
    "/{id}/fee-correction",
    response_model=FeeAdjustmentOut,
    status_code=201,
    dependencies=[Depends(require(Permission.BILL_ADJUST))],
)
def adjust_any_consultation_fee(
    id: int,
    payload: FeeAdjustmentRequest,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> FeeAdjustmentOut:
    """The administrator discounts, waives or corrects any consultation fee, with a reason."""
    return _apply(
        session, request, principal, id, payload, may_correct=True, own_only=False
    )
