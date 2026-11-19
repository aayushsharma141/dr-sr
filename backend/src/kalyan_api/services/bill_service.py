"""Consultation fee adjustments (Phase 22, Wave 3; OD-22-11, OD-22-15, FEE-03..06, AUD-04).

Rules, all enforced here and at the endpoint (AGENTS.md: the backend authorises every change):
- Only the consultation's own line changes. Its amount moves; its original amount is kept.
- A visit that is closed is locked: no adjustment (design §5).
- A cancelled consultation has nothing to adjust.
- The adjustment cannot fall below what has already been paid on that consultation. A payment is
  never silently refunded or overwritten; a reversal is a separate, admin-only action.
- DISCOUNT lowers the amount; WAIVER sets it to zero; CORRECTION sets any different amount.
- Each change writes one history row with the old and new values, the reason, the actor and time.
"""

from datetime import UTC
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from kalyan_api.clock import IST, ist_today, utcnow
from kalyan_api.core.errors import ApiError
from kalyan_api.core.principal import Principal
from kalyan_api.models import (
    Appointment,
    BillItem,
    BillItemAdjustment,
    BillItemAdjustmentKind,
    BillItemCategory,
    BillItemSource,
    BillItemStatus,
    ClinicalEncounter,
    ConsultationStatus,
    Prescription,
    PrescriptionItem,
    PrescriptionStatus,
    TreatmentPlan,
    Visit,
    VisitStatus,
)
from kalyan_api.schemas.bill import BillLineCreate, DoctorLineCreate
from kalyan_api.services import ledger_service
from kalyan_api.services.billing_service import counts_toward_total, visit_totals


def line_amount_paise(quantity: Decimal, rate_paise: int) -> int:
    """Compute line amount in whole paise: quantity x rate_paise rounded half up (OD-E, BIL-02)."""
    raw = (quantity * Decimal(rate_paise)).to_integral_value(rounding=ROUND_HALF_UP)
    return int(raw)


def adjust_consultation_fee(
    session: Session,
    appt: Appointment,
    principal: Principal,
    *,
    kind: BillItemAdjustmentKind,
    new_amount_paise: int,
    reason: str,
    may_correct: bool,
) -> tuple[BillItem, BillItemAdjustment]:
    """Change a consultation's fee with a reason; return the line and the history row written.

    may_correct: only the admin may raise or set an arbitrary amount (CORRECTION). A doctor may
    discount or waive the fee of own consultation (design §6).
    """
    if appt.visit_id is None:
        raise ApiError(
            status_code=422,
            code="no_bill_line",
            message="This consultation has no bill yet.",
        )
    visit = session.get(Visit, appt.visit_id)
    if visit is None or visit.status != VisitStatus.OPEN.value:
        raise ApiError(
            status_code=422,
            code="visit_closed",
            message="The visit is closed, so its charges are locked.",
        )
    if appt.consultation_status == ConsultationStatus.CANCELLED.value:
        raise ApiError(
            status_code=422,
            code="consultation_cancelled",
            message="This consultation was cancelled, so there is no fee to adjust.",
        )

    if kind == BillItemAdjustmentKind.CORRECTION and not may_correct:
        raise ApiError(
            status_code=403,
            code="adjustment_kind_not_permitted",
            message="Only an administrator can correct a fee. Discount or waive it instead.",
        )

    line = session.scalar(
        select(BillItem)
        .where(
            BillItem.appointment_id == appt.id,
            BillItem.category == BillItemCategory.CONSULTATION.value,
        )
        .with_for_update()
    )
    if line is None:
        raise ApiError(
            status_code=422,
            code="no_bill_line",
            message="This consultation has no bill line to adjust.",
        )

    reason_text = (reason or "").strip()
    if len(reason_text) < 3:
        raise ApiError(
            status_code=422,
            code="adjustment_reason_required",
            message="Enter a reason of at least 3 characters.",
        )

    old_amount = line.amount_paise
    if kind == BillItemAdjustmentKind.WAIVER:
        if new_amount_paise != 0:
            raise ApiError(
                status_code=422,
                code="waiver_must_be_zero",
                message="A waiver sets the fee to zero.",
            )
    elif kind == BillItemAdjustmentKind.DISCOUNT:
        if not (0 <= new_amount_paise < old_amount):
            raise ApiError(
                status_code=422,
                code="discount_must_lower_fee",
                message="A discount must lower the fee and cannot be negative.",
            )
    if new_amount_paise == old_amount:
        raise ApiError(
            status_code=422,
            code="no_change",
            message="The fee is already this amount.",
        )
    if new_amount_paise < 0:
        raise ApiError(
            status_code=422,
            code="amount_negative",
            message="A fee cannot be negative.",
        )

    v_totals = visit_totals(session, [appt.visit_id])[appt.visit_id]
    delta = new_amount_paise - old_amount
    line_counted = counts_toward_total(line, appt.consultation_status)
    new_visit_total = v_totals.bill_total_paise + (delta if line_counted else 0)
    if new_visit_total < v_totals.paid_paise:
        raise ApiError(
            status_code=422,
            code="adjustment_below_paid",
            message="The fee cannot go below what has already been paid on this visit.",
            details={"visit_paid_paise": v_totals.paid_paise, "paid_paise": v_totals.paid_paise},
        )

    history = BillItemAdjustment(
        bill_item_id=line.id,
        old_quantity=line.quantity,
        new_quantity=line.quantity,
        old_rate_paise=line.rate_paise,
        new_rate_paise=new_amount_paise,
        old_amount_paise=old_amount,
        new_amount_paise=new_amount_paise,
        kind=kind.value,
        reason=reason_text,
        actor_user_id=principal.user_id,
    )
    session.add(history)
    line.rate_paise = new_amount_paise
    line.amount_paise = new_amount_paise
    session.flush()
    ledger_service.record_charge_adjustment(
        session,
        line,
        history,
        actor_user_id=principal.user_id,
    )
    return line, history


def add_reception_line(
    session: Session,
    visit: Visit,
    principal: Principal,
    payload: BillLineCreate,
) -> BillItem:
    """Add a reception bill line (medicine or additional particular) to an open visit.

    The caller locks the visit first (billing_service.lock_visit).
    """
    if visit.status != VisitStatus.OPEN.value:
        raise ApiError(
            status_code=422,
            code="visit_closed",
            message="The visit is closed, so its charges are locked.",
        )

    if payload.prescription_item_id is not None:
        if payload.category != BillItemCategory.MEDICINE.value:
            raise ApiError(
                status_code=422,
                code="prescription_item_not_on_visit",
                message="Prescription links are only allowed for medicine lines.",
            )
        valid_item = session.scalar(
            select(PrescriptionItem.id)
            .join(Prescription, Prescription.id == PrescriptionItem.prescription_id)
            .join(ClinicalEncounter, ClinicalEncounter.id == Prescription.encounter_id)
            .join(Appointment, Appointment.id == ClinicalEncounter.appointment_id)
            .where(
                PrescriptionItem.id == payload.prescription_item_id,
                Appointment.visit_id == visit.id,
                Prescription.status == PrescriptionStatus.AUTHORISED.value,
            )
        )
        if valid_item is None:
            raise ApiError(
                status_code=422,
                code="prescription_item_not_on_visit",
                message=(
                    "The prescribed medicine was not found on an authorised "
                    "prescription for this visit."
                ),
            )

    amount = line_amount_paise(payload.quantity, payload.rate_paise)
    item = BillItem(
        visit_id=visit.id,
        patient_id=visit.patient_id,
        appointment_id=None,
        treatment_plan_id=None,
        prescription_item_id=payload.prescription_item_id,
        category=payload.category,
        source=BillItemSource.RECEPTION.value,
        status=BillItemStatus.ACTIVE.value,
        description=payload.description,
        unit=payload.unit,
        quantity=payload.quantity,
        rate_paise=payload.rate_paise,
        original_amount_paise=amount,
        amount_paise=amount,
        created_by_user_id=principal.user_id,
    )
    session.add(item)
    session.flush()
    if item.amount_paise > 0:
        ledger_service.record_charge(session, item, actor_user_id=principal.user_id)
    return item


def void_line(
    session: Session,
    line: BillItem,
    principal: Principal,
    *,
    reason: str,
    own_same_day_only: bool,
) -> tuple[BillItem, BillItemAdjustment]:
    """Void a non-consultation bill line item with a reason and history row (OD-G, OD-22-15).

    The caller locks the visit first, then the line with_for_update().
    - own_same_day_only: True for reception (bill:write), requiring own same-day line (OD-G);
      False for admin (bill:adjust), allowing void of any non-consultation line on an open visit.
    - Consultation lines are never voided here (422 consultation_line_not_voidable).
    - Already voided lines are refused (409 line_already_voided).
    - Closed visits are locked (422 visit_closed).
    - Refused if voiding brings visit total below paid (422 void_below_paid).
    - Voiding updates line status to VOIDED and writes a BillItemAdjustment(kind=VOID).
    """
    reason_text = (reason or "").strip()
    if len(reason_text) < 3 or len(reason_text) > 500:
        raise ApiError(
            status_code=422,
            code="invalid_reason",
            message="Reason must be between 3 and 500 characters.",
        )

    if line.category == BillItemCategory.CONSULTATION.value:
        raise ApiError(
            status_code=422,
            code="consultation_line_not_voidable",
            message=(
                "Consultation lines cannot be voided here. "
                "Adjust the consultation fee instead."
            ),
        )

    if line.status != BillItemStatus.ACTIVE.value:
        raise ApiError(
            status_code=409,
            code="line_already_voided",
            message="This bill line is already voided.",
        )

    user_id = getattr(principal, "user_id", getattr(principal, "id", None))

    if own_same_day_only:
        created_dt = (
            line.created_at if line.created_at.tzinfo else line.created_at.replace(tzinfo=UTC)
        )
        created_ist_date = created_dt.astimezone(IST).date()
        if (
            line.source != BillItemSource.RECEPTION.value
            or line.created_by_user_id != user_id
            or created_ist_date != ist_today()
        ):
            raise ApiError(
                status_code=403,
                code="void_not_permitted",
                message="You can only void your own reception lines entered today.",
            )

    visit = session.get(Visit, line.visit_id)
    if visit is None or visit.status != VisitStatus.OPEN.value:
        raise ApiError(
            status_code=422,
            code="visit_closed",
            message="The visit is closed, so its charges are locked.",
        )

    v_totals = visit_totals(session, [line.visit_id])[line.visit_id]
    c_status = None
    if line.appointment_id is not None:
        appt = session.get(Appointment, line.appointment_id)
        c_status = appt.consultation_status if appt else None
    line_counted = counts_toward_total(line, c_status)
    new_visit_total = v_totals.bill_total_paise - (line.amount_paise if line_counted else 0)
    if new_visit_total < v_totals.paid_paise:
        raise ApiError(
            status_code=422,
            code="void_below_paid",
            message=(
                "Voiding this line would bring the visit total below "
                "what has already been paid."
            ),
            details={"visit_paid_paise": v_totals.paid_paise, "paid_paise": v_totals.paid_paise},
        )

    history = BillItemAdjustment(
        bill_item_id=line.id,
        old_quantity=line.quantity,
        new_quantity=line.quantity,
        old_rate_paise=line.rate_paise,
        new_rate_paise=line.rate_paise,
        old_amount_paise=line.amount_paise,
        new_amount_paise=0,
        kind=BillItemAdjustmentKind.VOID.value,
        reason=reason_text,
        actor_user_id=user_id,
    )
    session.add(history)

    now = utcnow()
    line.status = BillItemStatus.VOIDED.value
    line.void_reason = reason_text
    line.voided_by_user_id = user_id
    line.voided_at = now
    session.flush()
    ledger_service.record_charge_void(
        session,
        line,
        adjustment=history,
        actor_user_id=user_id,
    )

    return line, history


def correct_line(
    session: Session,
    line: BillItem,
    principal: Principal,
    *,
    quantity: Decimal | None = None,
    rate_paise: int | None = None,
    reason: str,
    own_same_day_only: bool,
) -> tuple[BillItem, BillItemAdjustment]:
    """Correct quantity and/or rate on an active non-consultation bill line (MED-11, OD-22-15).

    The caller locks the visit first, then the line with_for_update().
    - own_same_day_only: True for reception (bill:write), requiring own same-day line;
      False for admin (bill:adjust), allowing correction of any non-consultation line on
      an open visit.
    - Consultation lines are refused (422 consultation_line_not_correctable).
    - Package lines are refused (422 package_line_not_correctable).
    - Non-active lines are refused (409 line_not_active).
    - Closed visits are locked (422 visit_closed).
    - Refused if correction brings visit total below paid (422 correction_below_paid).
    - Must specify at least one of quantity or rate_paise, and new values must differ from
      old (422 no_change).
    - Writes BillItemAdjustment(kind=CORRECTION) and updates line quantity, rate_paise,
      and amount_paise. original_amount_paise is preserved.
    """
    reason_text = (reason or "").strip()
    if len(reason_text) < 3 or len(reason_text) > 500:
        raise ApiError(
            status_code=422,
            code="invalid_reason",
            message="Reason must be between 3 and 500 characters.",
        )

    if line.category == BillItemCategory.CONSULTATION.value:
        raise ApiError(
            status_code=422,
            code="consultation_line_not_correctable",
            message=(
                "Consultation lines cannot be corrected here. "
                "Adjust the consultation fee instead."
            ),
        )

    if line.category == BillItemCategory.PACKAGE.value:
        raise ApiError(
            status_code=422,
            code="package_line_not_correctable",
            message="Package lines cannot be corrected here.",
        )

    if line.status != BillItemStatus.ACTIVE.value:
        raise ApiError(
            status_code=409,
            code="line_not_active",
            message="Only active bill lines can be corrected.",
        )

    user_id = getattr(principal, "user_id", getattr(principal, "id", None))

    if own_same_day_only:
        created_dt = (
            line.created_at if line.created_at.tzinfo else line.created_at.replace(tzinfo=UTC)
        )
        created_ist_date = created_dt.astimezone(IST).date()
        if (
            line.source != BillItemSource.RECEPTION.value
            or line.created_by_user_id != user_id
            or created_ist_date != ist_today()
        ):
            raise ApiError(
                status_code=403,
                code="correction_not_permitted",
                message="You can only correct your own reception lines entered today.",
            )

    visit = session.get(Visit, line.visit_id)
    if visit is None or visit.status != VisitStatus.OPEN.value:
        raise ApiError(
            status_code=422,
            code="visit_closed",
            message="The visit is closed, so its charges are locked.",
        )

    new_quantity = quantity if quantity is not None else line.quantity
    new_rate_paise = rate_paise if rate_paise is not None else line.rate_paise

    if new_quantity <= 0:
        raise ApiError(
            status_code=422,
            code="invalid_quantity",
            message="Quantity must be greater than zero.",
        )
    if new_rate_paise < 0:
        raise ApiError(
            status_code=422,
            code="invalid_rate",
            message="Rate cannot be negative.",
        )

    new_amount_paise = line_amount_paise(new_quantity, new_rate_paise)
    old_amount_paise = line.amount_paise

    if new_quantity == line.quantity and new_rate_paise == line.rate_paise:
        raise ApiError(
            status_code=422,
            code="no_change",
            message="Quantity and rate are already these values.",
        )

    v_totals = visit_totals(session, [line.visit_id])[line.visit_id]
    delta = new_amount_paise - old_amount_paise
    c_status = None
    if line.appointment_id:
        appt = session.get(Appointment, line.appointment_id)
        if appt:
            c_status = appt.consultation_status
    line_counted = counts_toward_total(line, c_status)
    new_visit_total = v_totals.bill_total_paise + (delta if line_counted else 0)
    if new_visit_total < v_totals.paid_paise:
        raise ApiError(
            status_code=422,
            code="correction_below_paid",
            message=(
                "Correcting this line would bring the visit total below "
                "what has already been paid."
            ),
            details={"visit_paid_paise": v_totals.paid_paise, "paid_paise": v_totals.paid_paise},
        )

    history = BillItemAdjustment(
        bill_item_id=line.id,
        old_quantity=line.quantity,
        new_quantity=new_quantity,
        old_rate_paise=line.rate_paise,
        new_rate_paise=new_rate_paise,
        old_amount_paise=old_amount_paise,
        new_amount_paise=new_amount_paise,
        kind=BillItemAdjustmentKind.CORRECTION.value,
        reason=reason_text,
        actor_user_id=user_id,
    )
    session.add(history)

    line.quantity = new_quantity
    line.rate_paise = new_rate_paise
    line.amount_paise = new_amount_paise
    session.flush()
    ledger_service.record_charge_adjustment(
        session,
        line,
        history,
        actor_user_id=user_id,
    )

    return line, history


def add_doctor_line(
    session: Session,
    appt: Appointment,
    principal: Principal,
    payload: DoctorLineCreate,
) -> BillItem:
    """Doctor adds a procedure or package line to own consultation (design §6, OD-22-14, OD-C).

    The caller locks the visit first (billing_service.lock_visit), then locks the appointment
    (booking_service.lock_appointment).
    Status rules (owner decision B3, 2026-11-16):
    - Visit must be OPEN (422 visit_closed).
    - Consultation must NOT be CANCELLED (422 consultation_cancelled).
    - Every other consultation status is accepted, including COMPLETED.
    """
    if appt.visit_id is None:
        raise ApiError(
            status_code=422,
            code="visit_closed",
            message="This consultation is not associated with an open visit.",
        )
    visit = session.get(Visit, appt.visit_id)
    if visit is None or visit.status != VisitStatus.OPEN.value:
        raise ApiError(
            status_code=422,
            code="visit_closed",
            message="The visit is closed, so its charges are locked.",
        )

    if appt.consultation_status == ConsultationStatus.CANCELLED.value:
        raise ApiError(
            status_code=422,
            code="consultation_cancelled",
            message="This consultation was cancelled, so charges cannot be added.",
        )

    user_id = getattr(principal, "user_id", getattr(principal, "id", None))

    if payload.category == BillItemCategory.PROCEDURE.value:
        amount = line_amount_paise(payload.quantity, payload.rate_paise)  # type: ignore[arg-type]
        item = BillItem(
            visit_id=visit.id,
            patient_id=visit.patient_id,
            appointment_id=appt.id,
            treatment_plan_id=None,
            prescription_item_id=None,
            category=payload.category,
            source=BillItemSource.DOCTOR.value,
            status=BillItemStatus.ACTIVE.value,
            description=payload.description,  # type: ignore[arg-type]
            unit=payload.unit,
            quantity=payload.quantity,  # type: ignore[arg-type]
            rate_paise=payload.rate_paise,  # type: ignore[arg-type]
            original_amount_paise=amount,
            amount_paise=amount,
            created_by_user_id=user_id,
        )
    elif payload.category == BillItemCategory.PACKAGE.value:
        plan = session.get(TreatmentPlan, payload.treatment_plan_id)
        if plan is None or plan.patient_id != appt.patient_id:
            raise ApiError(
                status_code=404,
                code="plan_not_found",
                message="Treatment plan not found.",
            )
        item = BillItem(
            visit_id=visit.id,
            patient_id=visit.patient_id,
            appointment_id=appt.id,
            treatment_plan_id=plan.id,
            prescription_item_id=None,
            category=payload.category,
            source=BillItemSource.DOCTOR.value,
            status=BillItemStatus.ACTIVE.value,
            description=plan.plan_name,
            unit=None,
            quantity=Decimal("1"),
            rate_paise=0,
            original_amount_paise=0,
            amount_paise=0,
            created_by_user_id=user_id,
        )
    else:
        raise ApiError(
            status_code=422,
            code="invalid_category",
            message=f"Category {payload.category} is not permitted for doctor charges.",
        )

    session.add(item)
    session.flush()
    if item.amount_paise > 0:
        ledger_service.record_charge(session, item, actor_user_id=user_id)
    return item





