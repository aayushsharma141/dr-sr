"""Append-only financial ledger writers, refund number sequencing, and patient ledger queries.

Signed ledger convention (Migration 0036):
- Money is integer paise (`BigInteger`) everywhere.
- `DEBIT` (`signed_amount_paise = +amount_paise`) increases the patient's payable balance:
  charges, upward adjustments, package charges, legacy charges, payment reversals, refunds.
- `CREDIT` (`signed_amount_paise = -amount_paise`) decreases the patient's payable balance:
  payments, charge voids, downward adjustments, package cancellation credits.
- All writers call `session.flush()` inside the caller's transaction and skip 0-paise no-ops.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Literal

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session, selectinload

from kalyan_api import clock
from kalyan_api.core.errors import ApiError
from kalyan_api.models import (
    Appointment,
    BillItem,
    BillItemAdjustment,
    BillItemCategory,
    BillItemStatus,
    ClinicSettings,
    LedgerDirection,
    LedgerEntry,
    LedgerEntryType,
    LedgerReferenceType,
    Patient,
    Payment,
    Refund,
    RefundSequence,
    TreatmentPlan,
    TreatmentPlanStatus,
    Visit,
)
from kalyan_api.services import billing_service
from kalyan_api.services.code_sequence_service import effective_patient_ids
from kalyan_api.services.receipt_service import get_cycle_key


@dataclass(frozen=True)
class PatientFinancialKpis:
    """Consolidated patient financial KPI totals in integer paise."""

    total_billed_paise: int
    total_paid_paise: int
    total_refunded_paise: int
    outstanding_paise: int


@dataclass(frozen=True)
class LedgerEntryWithBalance:
    """One append-only ledger entry paired with its chronological running balance."""

    entry: LedgerEntry
    running_balance_paise: int
    actor_username: str | None


@dataclass(frozen=True)
class PaymentWithRefundSummary:
    """One patient payment enriched with refunded and remaining refundable paise."""

    payment: Payment
    refunded_paise: int
    remaining_refundable_paise: int


@dataclass(frozen=True)
class VisitBillLinkSummary:
    """Compact financial summary for linking a patient ledger to each visit bill."""

    visit_id: int
    visit_code: str
    visit_date: date
    status: str
    bill_total_paise: int
    paid_paise: int
    refunded_paise: int
    due_paise: int


@dataclass(frozen=True)
class PatientLedgerData:
    """Complete patient financial ledger projection (consolidating merged aliases)."""

    patient_id: int
    patient_urn: str
    total_billed_paise: int
    total_paid_paise: int
    total_refunded_paise: int
    outstanding_paise: int
    ledger_balance_paise: int
    entries: list[LedgerEntryWithBalance]
    total_entries: int
    limit: int
    offset: int
    payments: list[PaymentWithRefundSummary]
    refunds: list[Refund]
    visit_bills: list[VisitBillLinkSummary]


def _insert_entry(
    session: Session,
    *,
    patient_id: int,
    visit_id: int | None,
    entry_type: LedgerEntryType,
    direction: LedgerDirection,
    amount_paise: int,
    reference_type: LedgerReferenceType,
    reference_id: int,
    description: str,
    actor_user_id: int | None,
    occurred_at: datetime | None = None,
) -> LedgerEntry | None:
    """Insert a single immutable ledger row enforcing signed_amount_paise == +/-amount_paise."""
    if amount_paise <= 0:
        return None

    signed_amount = amount_paise if direction == LedgerDirection.DEBIT else -amount_paise
    entry = LedgerEntry(
        patient_id=patient_id,
        visit_id=visit_id,
        entry_type=entry_type.value,
        direction=direction.value,
        amount_paise=amount_paise,
        signed_amount_paise=signed_amount,
        reference_type=reference_type.value,
        reference_id=reference_id,
        description=description,
        actor_user_id=actor_user_id,
        occurred_at=occurred_at or clock.utcnow(),
    )
    session.add(entry)
    session.flush()
    return entry


def _resolve_payment_visit_id(session: Session, payment: Payment) -> int | None:
    """Resolve the effective visit_id for a payment (direct visit_id or via linked appointment)."""
    if payment.visit_id is not None:
        return payment.visit_id
    if payment.appointment_id is not None:
        appt_visit_id = session.scalar(
            select(Appointment.visit_id).where(
                Appointment.id == payment.appointment_id,
                Appointment.patient_id == payment.patient_id,
            )
        )
        return appt_visit_id
    return None


def record_charge(
    session: Session,
    bill_item: BillItem,
    *,
    actor_user_id: int | None = None,
    occurred_at: datetime | None = None,
) -> LedgerEntry | None:
    """Post a CHARGE DEBIT when a billable non-package bill item is created."""
    if bill_item.category == BillItemCategory.PACKAGE.value:
        return None
    amount = (
        bill_item.original_amount_paise
        if bill_item.original_amount_paise > 0
        else bill_item.amount_paise
    )
    if amount <= 0:
        return None

    return _insert_entry(
        session,
        patient_id=bill_item.patient_id,
        visit_id=bill_item.visit_id,
        entry_type=LedgerEntryType.CHARGE,
        direction=LedgerDirection.DEBIT,
        amount_paise=amount,
        reference_type=LedgerReferenceType.BILL_ITEM,
        reference_id=bill_item.id,
        description=bill_item.description,
        actor_user_id=actor_user_id if actor_user_id is not None else bill_item.created_by_user_id,
        occurred_at=occurred_at or bill_item.created_at or clock.utcnow(),
    )


def record_charge_adjustment(
    session: Session,
    bill_item: BillItem,
    adjustment: BillItemAdjustment,
    *,
    actor_user_id: int | None = None,
    occurred_at: datetime | None = None,
) -> LedgerEntry | None:
    """Post a CHARGE_ADJUSTMENT DEBIT (increase) or CREDIT (decrease) for a bill adjustment."""
    if bill_item.category == BillItemCategory.PACKAGE.value:
        return None
    delta = adjustment.new_amount_paise - adjustment.old_amount_paise
    if delta == 0:
        return None

    direction = LedgerDirection.DEBIT if delta > 0 else LedgerDirection.CREDIT
    return _insert_entry(
        session,
        patient_id=bill_item.patient_id,
        visit_id=bill_item.visit_id,
        entry_type=LedgerEntryType.CHARGE_ADJUSTMENT,
        direction=direction,
        amount_paise=abs(delta),
        reference_type=LedgerReferenceType.BILL_ITEM_ADJUSTMENT,
        reference_id=adjustment.id,
        description=f"{adjustment.kind}: {bill_item.description} ({adjustment.reason})",
        actor_user_id=actor_user_id if actor_user_id is not None else adjustment.actor_user_id,
        occurred_at=occurred_at or adjustment.created_at or clock.utcnow(),
    )


def record_charge_void(
    session: Session,
    bill_item: BillItem,
    *,
    adjustment: BillItemAdjustment | None = None,
    reason: str | None = None,
    actor_user_id: int | None = None,
    occurred_at: datetime | None = None,
) -> LedgerEntry | None:
    """Post a CHARGE_VOID CREDIT for an explicit line void or a cancelled consultation line."""
    if bill_item.category == BillItemCategory.PACKAGE.value:
        return None

    if adjustment is not None:
        amount = adjustment.old_amount_paise
        if amount <= 0:
            return None
        return _insert_entry(
            session,
            patient_id=bill_item.patient_id,
            visit_id=bill_item.visit_id,
            entry_type=LedgerEntryType.CHARGE_VOID,
            direction=LedgerDirection.CREDIT,
            amount_paise=amount,
            reference_type=LedgerReferenceType.BILL_ITEM_ADJUSTMENT,
            reference_id=adjustment.id,
            description=f"Void: {bill_item.description} ({adjustment.reason})",
            actor_user_id=actor_user_id if actor_user_id is not None else adjustment.actor_user_id,
            occurred_at=occurred_at or adjustment.created_at or clock.utcnow(),
        )

    amount = bill_item.amount_paise
    if amount <= 0 or bill_item.status != BillItemStatus.ACTIVE.value:
        return None

    # Idempotency guard when a cancelled consultation's bill line was already voided in ledger.
    already_voided = session.scalar(
        select(LedgerEntry.id).where(
            LedgerEntry.reference_type == LedgerReferenceType.BILL_ITEM.value,
            LedgerEntry.reference_id == bill_item.id,
            LedgerEntry.entry_type == LedgerEntryType.CHARGE_VOID.value,
        )
    )
    if already_voided is not None:
        return None

    reason_text = (reason or "").strip()
    desc = f"Cancelled consultation: {bill_item.description}"
    if reason_text:
        desc = f"{desc} ({reason_text})"

    return _insert_entry(
        session,
        patient_id=bill_item.patient_id,
        visit_id=bill_item.visit_id,
        entry_type=LedgerEntryType.CHARGE_VOID,
        direction=LedgerDirection.CREDIT,
        amount_paise=amount,
        reference_type=LedgerReferenceType.BILL_ITEM,
        reference_id=bill_item.id,
        description=desc,
        actor_user_id=actor_user_id if actor_user_id is not None else bill_item.created_by_user_id,
        occurred_at=occurred_at or clock.utcnow(),
    )


def void_appointment_charges(
    session: Session,
    appt: Appointment,
    *,
    reason: str | None = None,
    actor_user_id: int | None = None,
    occurred_at: datetime | None = None,
) -> list[LedgerEntry]:
    """Post CHARGE_VOID credits for all active non-package bill lines on a cancelled appointment."""
    items = list(
        session.scalars(
            select(BillItem).where(
                BillItem.appointment_id == appt.id,
                BillItem.status == BillItemStatus.ACTIVE.value,
                BillItem.category != BillItemCategory.PACKAGE.value,
                BillItem.amount_paise > 0,
            )
        ).all()
    )
    entries: list[LedgerEntry] = []
    for item in items:
        entry = record_charge_void(
            session,
            item,
            reason=reason,
            actor_user_id=actor_user_id,
            occurred_at=occurred_at,
        )
        if entry is not None:
            entries.append(entry)
    return entries


def record_package_charge(
    session: Session,
    plan: TreatmentPlan,
    *,
    actor_user_id: int | None = None,
    occurred_at: datetime | None = None,
) -> LedgerEntry | None:
    """Post a PACKAGE_CHARGE DEBIT when a treatment package is created with agreed_price > 0."""
    if plan.agreed_price_paise <= 0:
        return None
    return _insert_entry(
        session,
        patient_id=plan.patient_id,
        visit_id=None,
        entry_type=LedgerEntryType.PACKAGE_CHARGE,
        direction=LedgerDirection.DEBIT,
        amount_paise=plan.agreed_price_paise,
        reference_type=LedgerReferenceType.TREATMENT_PLAN,
        reference_id=plan.id,
        description=f"Treatment Package: {plan.plan_name}",
        actor_user_id=actor_user_id,
        occurred_at=occurred_at or plan.created_at or clock.utcnow(),
    )


def record_package_adjustment(
    session: Session,
    plan: TreatmentPlan,
    *,
    delta_paise: int,
    description: str | None = None,
    reason: str | None = None,
    actor_user_id: int | None = None,
    occurred_at: datetime | None = None,
) -> LedgerEntry | None:
    """Post a PACKAGE_ADJUSTMENT DEBIT/CREDIT for agreed price edits or plan cancellation."""
    if delta_paise == 0:
        return None
    direction = LedgerDirection.DEBIT if delta_paise > 0 else LedgerDirection.CREDIT
    if description is None:
        reason_text = (reason or "").strip()
        description = f"Package Adjustment: {plan.plan_name}"
        if reason_text:
            description = f"{description} ({reason_text})"
    return _insert_entry(
        session,
        patient_id=plan.patient_id,
        visit_id=None,
        entry_type=LedgerEntryType.PACKAGE_ADJUSTMENT,
        direction=direction,
        amount_paise=abs(delta_paise),
        reference_type=LedgerReferenceType.TREATMENT_PLAN,
        reference_id=plan.id,
        description=description,
        actor_user_id=actor_user_id,
        occurred_at=occurred_at or plan.updated_at or clock.utcnow(),
    )


def record_payment(
    session: Session,
    payment: Payment,
    *,
    actor_user_id: int | None = None,
    occurred_at: datetime | None = None,
) -> LedgerEntry | None:
    """Post a PAYMENT CREDIT when a payment receipt is recorded."""
    if payment.amount_paise <= 0:
        return None
    visit_id = _resolve_payment_visit_id(session, payment)
    return _insert_entry(
        session,
        patient_id=payment.patient_id,
        visit_id=visit_id,
        entry_type=LedgerEntryType.PAYMENT,
        direction=LedgerDirection.CREDIT,
        amount_paise=payment.amount_paise,
        reference_type=LedgerReferenceType.PAYMENT,
        reference_id=payment.id,
        description=f"Payment {payment.receipt_number} ({payment.payment_method})",
        actor_user_id=actor_user_id if actor_user_id is not None else payment.created_by_user_id,
        occurred_at=occurred_at or payment.created_at or clock.utcnow(),
    )


def record_payment_reversal(
    session: Session,
    payment: Payment,
    *,
    actor_user_id: int | None = None,
    occurred_at: datetime | None = None,
) -> LedgerEntry | None:
    """Post a PAYMENT_REVERSAL DEBIT when an admin reverses a posted payment."""
    if payment.amount_paise <= 0:
        return None
    visit_id = _resolve_payment_visit_id(session, payment)
    reason_suffix = f" ({payment.reversal_reason})" if payment.reversal_reason else ""
    return _insert_entry(
        session,
        patient_id=payment.patient_id,
        visit_id=visit_id,
        entry_type=LedgerEntryType.PAYMENT_REVERSAL,
        direction=LedgerDirection.DEBIT,
        amount_paise=payment.amount_paise,
        reference_type=LedgerReferenceType.PAYMENT,
        reference_id=payment.id,
        description=f"Payment Reversal {payment.receipt_number}{reason_suffix}",
        actor_user_id=actor_user_id if actor_user_id is not None else payment.reversed_by_user_id,
        occurred_at=occurred_at or payment.reversed_at or clock.utcnow(),
    )


def record_refund(
    session: Session,
    refund: Refund,
    *,
    payment: Payment | None = None,
    actor_user_id: int | None = None,
    occurred_at: datetime | None = None,
) -> LedgerEntry | None:
    """Post a REFUND DEBIT (and cancel-package credit if refunding a cancelled plan)."""
    if refund.amount_paise <= 0:
        return None
    parent_payment = payment if payment is not None else session.get(Payment, refund.payment_id)
    visit_id = refund.visit_id
    if visit_id is None and parent_payment is not None:
        visit_id = _resolve_payment_visit_id(session, parent_payment)

    receipt_part = f" for {parent_payment.receipt_number}" if parent_payment else ""
    ts = occurred_at or refund.created_at or clock.utcnow()
    actor = actor_user_id if actor_user_id is not None else refund.refunded_by_user_id

    entry = _insert_entry(
        session,
        patient_id=refund.patient_id,
        visit_id=visit_id,
        entry_type=LedgerEntryType.REFUND,
        direction=LedgerDirection.DEBIT,
        amount_paise=refund.amount_paise,
        reference_type=LedgerReferenceType.REFUND,
        reference_id=refund.id,
        description=(
            f"Refund {refund.refund_number}{receipt_part} "
            f"({refund.refund_method}): {refund.reason}"
        ),
        actor_user_id=actor,
        occurred_at=ts,
    )

    # If refunding a payment on a CANCELLED treatment plan, reduce the retained package charge so
    # refunding a cancelled package never creates phantom outstanding debt on the ledger.
    if parent_payment is not None and parent_payment.treatment_plan_id is not None:
        plan = session.get(TreatmentPlan, parent_payment.treatment_plan_id)
        if plan is not None and plan.status == TreatmentPlanStatus.CANCELLED.value:
            net_pkg_ledger_charge = int(
                session.scalar(
                    select(func.coalesce(func.sum(LedgerEntry.signed_amount_paise), 0)).where(
                        LedgerEntry.reference_type == LedgerReferenceType.TREATMENT_PLAN.value,
                        LedgerEntry.reference_id == plan.id,
                    )
                )
                or 0
            )
            credit_amount = min(refund.amount_paise, max(0, net_pkg_ledger_charge))
            if credit_amount > 0:
                record_package_adjustment(
                    session,
                    plan,
                    delta_paise=-credit_amount,
                    description=(
                        f"Cancelled Package Refund Adjustment: {plan.plan_name} "
                        f"({refund.refund_number})"
                    ),
                    actor_user_id=actor,
                    occurred_at=ts,
                )

    return entry


def allocate_next_refund_number(
    session: Session,
    cycle: str | None = None,
    ref_date: date | None = None,
) -> str:
    """Atomically allocate the next gap-free refund number (RFN-FY-NNNNNN)."""
    if ref_date is None:
        ref_date = clock.ist_today()
    if cycle is None:
        settings = session.scalar(select(ClinicSettings).where(ClinicSettings.id == 1))
        cycle = settings.receipt_sequence_cycle if settings else "FINANCIAL_YEAR"

    cycle_key = get_cycle_key(cycle, ref_date)

    session.execute(
        pg_insert(RefundSequence)
        .values(cycle_key=cycle_key, last_number=0)
        .on_conflict_do_nothing(index_elements=["cycle_key"])
    )
    seq_record = session.execute(
        select(RefundSequence).where(RefundSequence.cycle_key == cycle_key).with_for_update()
    ).scalar_one()

    seq_record.last_number += 1
    session.flush()
    return f"RFN-{cycle_key}-{seq_record.last_number:06d}"


def compute_patient_financial_kpis(
    session: Session,
    patient_ids: list[int],
    all_visit_ids: list[int] | None = None,
) -> PatientFinancialKpis:
    """Compute consolidated patient KPI totals netting active refunds against payments.

    Shared by `/patients/{id}/summary` and `/patients/{id}/ledger` so totals never drift.
    """
    if all_visit_ids is None:
        all_visit_ids = list(
            session.scalars(select(Visit.id).where(Visit.patient_id.in_(patient_ids))).all()
        )

    visit_totals_map = (
        billing_service.visit_totals(session, all_visit_ids) if all_visit_ids else {}
    )
    visit_billed = sum(vt.bill_total_paise for vt in visit_totals_map.values())
    visit_due = sum(vt.due_paise for vt in visit_totals_map.values())

    billable_plans = session.execute(
        select(TreatmentPlan.id, TreatmentPlan.agreed_price_paise).where(
            TreatmentPlan.patient_id.in_(patient_ids),
            TreatmentPlan.status.in_(
                [TreatmentPlanStatus.ACTIVE.value, TreatmentPlanStatus.COMPLETED.value]
            ),
        )
    ).all()

    plan_ids = [plan_id for plan_id, _ in billable_plans]
    plan_net_paid_map = (
        billing_service.net_paid_by_treatment_plans(session, plan_ids) if plan_ids else {}
    )

    package_billed = sum(int(price) for _, price in billable_plans)
    package_due = sum(
        max(0, int(price) - plan_net_paid_map.get(plan_id, 0))
        for plan_id, price in billable_plans
    )

    gross_paid = int(
        session.scalar(
            select(func.coalesce(func.sum(Payment.amount_paise), 0)).where(
                Payment.patient_id.in_(patient_ids),
                Payment.is_reversed.is_(False),
            )
        )
        or 0
    )
    total_refunded = int(
        session.scalar(
            select(func.coalesce(func.sum(Refund.amount_paise), 0))
            .join(Payment, Payment.id == Refund.payment_id)
            .where(
                Refund.patient_id.in_(patient_ids),
                Payment.is_reversed.is_(False),
            )
        )
        or 0
    )
    total_paid = max(0, gross_paid - total_refunded)
    total_billed = visit_billed + package_billed
    outstanding = visit_due + package_due

    return PatientFinancialKpis(
        total_billed_paise=total_billed,
        total_paid_paise=total_paid,
        total_refunded_paise=total_refunded,
        outstanding_paise=outstanding,
    )


def build_patient_ledger(
    session: Session,
    patient_id: int,
    *,
    limit: int = 50,
    offset: int = 0,
    order: Literal["desc", "asc"] = "desc",
) -> PatientLedgerData:
    """Build consolidated financial ledger, payments with refund status, refunds, and visit links.

    Allows reads on archived and merged patients (404 only if patient_id does not exist).
    Running balances are computed chronologically across all consolidated entries via SQL window
    function before pagination slicing so page 2+ balances stay exact.
    """
    patient = session.get(Patient, patient_id)
    if patient is None:
        raise ApiError(
            status_code=404,
            code="patient_not_found",
            message="Patient not found.",
        )

    patient_ids = effective_patient_ids(session, patient_id)

    visit_rows = session.execute(
        select(Visit.id, Visit.visit_code, Visit.visit_date, Visit.status)
        .where(Visit.patient_id.in_(patient_ids))
        .order_by(Visit.visit_date.desc(), Visit.id.desc())
    ).all()
    all_visit_ids = [row[0] for row in visit_rows]

    visit_totals_map = (
        billing_service.visit_totals(session, all_visit_ids) if all_visit_ids else {}
    )
    kpis = compute_patient_financial_kpis(session, patient_ids, all_visit_ids)

    total_entries = int(
        session.scalar(
            select(func.count(LedgerEntry.id)).where(LedgerEntry.patient_id.in_(patient_ids))
        )
        or 0
    )
    ledger_balance_paise = int(
        session.scalar(
            select(func.coalesce(func.sum(LedgerEntry.signed_amount_paise), 0)).where(
                LedgerEntry.patient_id.in_(patient_ids)
            )
        )
        or 0
    )

    # Window sum over chronological order BEFORE applying pagination limit/offset.
    running_sq = (
        select(
            LedgerEntry.id.label("entry_id"),
            func.sum(LedgerEntry.signed_amount_paise)
            .over(order_by=(LedgerEntry.occurred_at.asc(), LedgerEntry.id.asc()))
            .label("running_balance_paise"),
        )
        .where(LedgerEntry.patient_id.in_(patient_ids))
        .subquery()
    )

    order_clauses = (
        (LedgerEntry.occurred_at.asc(), LedgerEntry.id.asc())
        if order == "asc"
        else (LedgerEntry.occurred_at.desc(), LedgerEntry.id.desc())
    )
    entry_rows = session.execute(
        select(LedgerEntry, running_sq.c.running_balance_paise)
        .join(running_sq, running_sq.c.entry_id == LedgerEntry.id)
        .options(selectinload(LedgerEntry.actor_user))
        .order_by(*order_clauses)
        .limit(limit)
        .offset(offset)
    ).all()

    entries = [
        LedgerEntryWithBalance(
            entry=entry,
            running_balance_paise=int(running_bal or 0),
            actor_username=entry.actor_user.username if entry.actor_user else None,
        )
        for entry, running_bal in entry_rows
    ]

    payments_list = list(
        session.scalars(
            select(Payment)
            .where(Payment.patient_id.in_(patient_ids))
            .options(
                selectinload(Payment.patient),
                selectinload(Payment.treatment_plan),
                selectinload(Payment.created_by_user),
                selectinload(Payment.reversed_by_user),
            )
            .order_by(Payment.created_at.desc(), Payment.id.desc())
        ).all()
    )

    refunds_list = list(
        session.scalars(
            select(Refund)
            .where(Refund.patient_id.in_(patient_ids))
            .options(
                selectinload(Refund.refunded_by_user),
                selectinload(Refund.payment),
            )
            .order_by(Refund.created_at.desc(), Refund.id.desc())
        ).all()
    )

    refunded_by_payment: dict[int, int] = {}
    for ref in refunds_list:
        refunded_by_payment[ref.payment_id] = (
            refunded_by_payment.get(ref.payment_id, 0) + ref.amount_paise
        )

    payment_summaries = [
        PaymentWithRefundSummary(
            payment=p,
            refunded_paise=refunded_by_payment.get(p.id, 0),
            remaining_refundable_paise=(
                0 if p.is_reversed else max(0, p.amount_paise - refunded_by_payment.get(p.id, 0))
            ),
        )
        for p in payments_list
    ]

    visit_bills = [
        VisitBillLinkSummary(
            visit_id=v_id,
            visit_code=v_code,
            visit_date=v_date,
            status=v_status,
            bill_total_paise=visit_totals_map[v_id].bill_total_paise,
            paid_paise=visit_totals_map[v_id].paid_paise,
            refunded_paise=visit_totals_map[v_id].total_refunded_paise,
            due_paise=visit_totals_map[v_id].due_paise,
        )
        for v_id, v_code, v_date, v_status in visit_rows
        if v_id in visit_totals_map
    ]

    return PatientLedgerData(
        patient_id=patient.id,
        patient_urn=patient.urn,
        total_billed_paise=kpis.total_billed_paise,
        total_paid_paise=kpis.total_paid_paise,
        total_refunded_paise=kpis.total_refunded_paise,
        outstanding_paise=kpis.outstanding_paise,
        ledger_balance_paise=ledger_balance_paise,
        entries=entries,
        total_entries=total_entries,
        limit=limit,
        offset=offset,
        payments=payment_summaries,
        refunds=refunds_list,
        visit_bills=visit_bills,
    )
