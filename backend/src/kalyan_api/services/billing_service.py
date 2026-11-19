"""Billing ledger computations shared by billing and dashboard routers.

Guarantees:
- Visit balances are derived dynamically from ACTIVE bill lines and payments (design §4).
- Pending dues are derived dynamically from the payment ledger (BIL-03); no stored balances.
- Monetary values are integer paise only (BIL-02); reversed payments never count as paid.
- No DB trigger guards overpayments on visits; app-level locking and checks enforce limits (P6).
"""

from collections.abc import Iterable
from dataclasses import dataclass

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from kalyan_api.core.errors import ApiError
from kalyan_api.models import (
    Appointment,
    BillItem,
    BillItemCategory,
    ConsultationStatus,
    Doctor,
    Patient,
    Payment,
    Refund,
    TreatmentPlan,
    Visit,
    VisitStatus,
)
from kalyan_api.schemas.bill import PackageInfoOut, PreviousDueOut
from kalyan_api.schemas.billing import PendingDueOut, VisitDueOut


@dataclass(frozen=True)
class VisitChargeLine:
    """What one consultation in a visit costs, what was paid against it, and what is still due."""

    appointment_id: int
    visit_id: int
    doctor_id: int
    doctor_name_en: str
    consultation_status: str | None
    fee_paise: int
    paid_paise: int
    balance_paise: int
    # Fees are collected after the consultation (owner decision 6), so only a completed one can
    # take a payment; a cancelled one owes nothing.
    collectable: bool


@dataclass(frozen=True)
class VisitTotals:
    """Consolidated visit-level financial totals (design §4)."""

    visit_id: int
    bill_total_paise: int
    paid_paise: int
    due_paise: int
    has_completed: bool
    has_active: bool
    total_refunded_paise: int = 0


def net_paid_by_treatment_plans(session: Session, plan_ids: Iterable[int]) -> dict[int, int]:
    """Return net paid paise (non-reversed payments minus active refunds) per treatment plan."""
    ids = list(plan_ids)
    if not ids:
        return {}

    paid_rows = session.execute(
        select(
            Payment.treatment_plan_id,
            func.coalesce(func.sum(Payment.amount_paise), 0),
        )
        .where(
            Payment.treatment_plan_id.in_(ids),
            Payment.is_reversed.is_(False),
        )
        .group_by(Payment.treatment_plan_id)
    ).all()
    gross_by_plan = {int(pid): int(amt) for pid, amt in paid_rows if pid is not None}

    refund_rows = session.execute(
        select(
            Payment.treatment_plan_id,
            func.coalesce(func.sum(Refund.amount_paise), 0),
        )
        .join(Payment, Payment.id == Refund.payment_id)
        .where(
            Payment.treatment_plan_id.in_(ids),
            Payment.is_reversed.is_(False),
        )
        .group_by(Payment.treatment_plan_id)
    ).all()
    refunded_by_plan = {int(pid): int(amt) for pid, amt in refund_rows if pid is not None}

    return {
        pid: max(0, gross_by_plan.get(pid, 0) - refunded_by_plan.get(pid, 0))
        for pid in ids
    }


def package_net_paid_paise(session: Session, treatment_plan_id: int) -> int:
    """Return net paid paise (non-reversed payments minus active refunds) for one package."""
    return net_paid_by_treatment_plans(session, [treatment_plan_id]).get(treatment_plan_id, 0)


def counts_toward_total(
    status_or_line: str | BillItem,
    category_or_consultation_status: str | None = None,
    appointment_id: int | None = None,
    consultation_status: str | None = None,
) -> bool:
    """Determine if a bill line counts toward the visit's bill total (design §4, option-a).

    Rules:
    - Must be ACTIVE (VOIDED lines never count).
    - If appointment-linked:
      * CANCELLED consultation lines never count (rule ii).
      * CONSULTATION lines count only once consultation is COMPLETED (owner decision 6).
      * Other appointment lines (procedure, etc.) count when consultation is COMPLETED (rule i).
    - If not appointment-linked (direct visit line, e.g. medicine):
      * Counts as soon as ACTIVE.
    """
    if isinstance(status_or_line, str):
        status = status_or_line
        appt_id = appointment_id
        c_status = consultation_status
    else:
        status = getattr(status_or_line, "status", "ACTIVE")
        appt_id = getattr(status_or_line, "appointment_id", None)
        c_status = category_or_consultation_status

    if status != "ACTIVE":
        return False
    if appt_id is not None:
        if c_status == ConsultationStatus.CANCELLED.value:
            return False
        return c_status == ConsultationStatus.COMPLETED.value
    return True


def visit_totals(
    session: Session, visit_ids: Iterable[int]
) -> dict[int, VisitTotals]:
    """Calculate consolidated visit totals for a batch of visits.

    Guarantees:
    - total = sum of ACTIVE bill lines that are due (option-a).
    - count CONSULTATION lines only once consultation is COMPLETED (owner decision 6).
    - exclude lines of CANCELLED appointments (P4).
    - fail closed (W4, K-63): a COMPLETED consultation with no CONSULTATION line fails closed
      with ApiError(422, 'consultation_missing_bill_line').
    - paid = non-reversed payments (visit_id or appointment_id in visit, counted once)
      minus active refunds.
    - due = max(0, total - paid).
    """
    ids = list(visit_ids)
    if not ids:
        return {}

    appts = session.execute(
        select(
            Appointment.id,
            Appointment.visit_id,
            Appointment.consultation_status,
            Doctor.default_fee_paise,
        )
        .join(Doctor, Doctor.id == Appointment.doctor_id)
        .where(Appointment.visit_id.in_(ids))
    ).all()

    appt_status_map: dict[int, str | None] = {}
    completed_appts_by_visit: dict[int, set[int]] = {v_id: set() for v_id in ids}
    completed_appts_fee: dict[int, int] = {}
    has_completed_map: dict[int, bool] = {v_id: False for v_id in ids}
    has_active_map: dict[int, bool] = {v_id: False for v_id in ids}

    active_statuses = (
        ConsultationStatus.WAITING.value,
        ConsultationStatus.IN_CONSULTATION.value,
    )
    for appt_id, v_id, c_status, doc_fee in appts:
        appt_status_map[appt_id] = c_status
        if c_status == ConsultationStatus.COMPLETED.value:
            completed_appts_by_visit[v_id].add(appt_id)
            completed_appts_fee[appt_id] = doc_fee or 0
            has_completed_map[v_id] = True
        elif c_status in active_statuses:
            has_active_map[v_id] = True

    bill_items = session.execute(
        select(
            BillItem.id,
            BillItem.visit_id,
            BillItem.appointment_id,
            BillItem.category,
            BillItem.status,
            BillItem.amount_paise,
        ).where(BillItem.visit_id.in_(ids))
    ).all()

    consultation_lines_by_appt: dict[int, set[int]] = {v_id: set() for v_id in ids}
    for _, v_id, appt_id, category, _, _ in bill_items:
        if appt_id is not None and category == BillItemCategory.CONSULTATION.value:
            consultation_lines_by_appt[v_id].add(appt_id)

    # Fail closed check (W4, K-63): a COMPLETED consultation with no CONSULTATION line fails closed
    # when the doctor has a fee (> 0). Never billed at doctor's current default fee.
    for v_id in ids:
        missing = completed_appts_by_visit[v_id] - consultation_lines_by_appt[v_id]
        if any(completed_appts_fee.get(a_id, 0) > 0 for a_id in missing):
            raise ApiError(
                status_code=422,
                code="consultation_missing_bill_line",
                message="A completed consultation is missing its consultation bill line.",
            )

    total_by_visit: dict[int, int] = {v_id: 0 for v_id in ids}
    for _, v_id, appt_id, category, status, amount_paise in bill_items:
        c_status = appt_status_map.get(appt_id) if appt_id is not None else None
        if counts_toward_total(status, category, appt_id, c_status):
            total_by_visit[v_id] += amount_paise

    paid_rows = session.execute(
        select(
            func.coalesce(Payment.visit_id, Appointment.visit_id).label("v_id"),
            func.coalesce(func.sum(Payment.amount_paise), 0),
        )
        .outerjoin(Appointment, Appointment.id == Payment.appointment_id)
        .where(
            Payment.is_reversed.is_(False),
            or_(
                Payment.visit_id.in_(ids),
                Appointment.visit_id.in_(ids),
            ),
        )
        .group_by(func.coalesce(Payment.visit_id, Appointment.visit_id))
    ).all()

    paid_by_visit: dict[int, int] = {row[0]: int(row[1]) for row in paid_rows}

    refund_visit_col = func.coalesce(Refund.visit_id, Payment.visit_id, Appointment.visit_id)
    refund_rows = session.execute(
        select(
            refund_visit_col.label("v_id"),
            func.coalesce(func.sum(Refund.amount_paise), 0),
        )
        .join(Payment, Payment.id == Refund.payment_id)
        .outerjoin(Appointment, Appointment.id == Payment.appointment_id)
        .where(
            Payment.is_reversed.is_(False),
            or_(
                Refund.visit_id.in_(ids),
                Payment.visit_id.in_(ids),
                Appointment.visit_id.in_(ids),
            ),
        )
        .group_by(refund_visit_col)
    ).all()
    refunded_by_visit: dict[int, int] = {row[0]: int(row[1]) for row in refund_rows}

    totals: dict[int, VisitTotals] = {}
    for v_id in ids:
        tot = total_by_visit.get(v_id, 0)
        refunded = refunded_by_visit.get(v_id, 0)
        pd = max(0, paid_by_visit.get(v_id, 0) - refunded)
        totals[v_id] = VisitTotals(
            visit_id=v_id,
            bill_total_paise=tot,
            paid_paise=pd,
            due_paise=max(0, tot - pd),
            has_completed=has_completed_map.get(v_id, False),
            has_active=has_active_map.get(v_id, False),
            total_refunded_paise=refunded,
        )
    return totals


def visit_charge_lines(
    session: Session, visit_ids: Iterable[int]
) -> dict[int, list[VisitChargeLine]]:
    """The consultation charges of each visit, in check-in order.

    Each COMPLETED consultation owes the fee saved on its bill line at check-in (OD-22-10). A
    later change to the doctor's default fee does not change it (K-63, FEE-07).
    Payments linked to that appointment reduce it, reversed payments excluded, and never below
    zero. A consultation that was cancelled, or is still waiting or in progress, owes nothing
    yet. Treatment packages are not included; they stay in Pending Dues.
    Per-consultation paid/balance covers appointment-linked payments only; visit-level payments
    are reflected in visit_totals.
    """
    ids = list(visit_ids)
    lines: dict[int, list[VisitChargeLine]] = {visit_id: [] for visit_id in ids}
    if not ids:
        return lines

    rows = session.execute(
        select(
            Appointment.id,
            Appointment.visit_id,
            Appointment.doctor_id,
            Doctor.name_en,
            Appointment.consultation_status,
            Doctor.default_fee_paise,
        )
        .join(Doctor, Doctor.id == Appointment.doctor_id)
        .where(Appointment.visit_id.in_(ids))
        .order_by(Appointment.id)
    ).all()

    appointment_ids = [row[0] for row in rows]
    # The fee is the consultation's bill line, saved at check-in (OD-22-10, K-63, FEE-07).
    # Fail closed (W4, K-63): completed consultations must have a CONSULTATION bill line.
    line_fee_by_appointment: dict[int, int] = {}
    if appointment_ids:
        line_fee_by_appointment = {
            appointment_id: int(amount)
            for appointment_id, amount in session.execute(
                select(BillItem.appointment_id, BillItem.amount_paise).where(
                    BillItem.appointment_id.in_(appointment_ids),
                    BillItem.category == BillItemCategory.CONSULTATION.value,
                )
            )
        }
    paid_by_appointment: dict[int, int] = {}
    refunded_by_appointment: dict[int, int] = {}
    if appointment_ids:
        paid_by_appointment = {
            appointment_id: int(total)
            for appointment_id, total in session.execute(
                select(Payment.appointment_id, func.coalesce(func.sum(Payment.amount_paise), 0))
                .where(
                    Payment.appointment_id.in_(appointment_ids),
                    Payment.is_reversed.is_(False),
                )
                .group_by(Payment.appointment_id)
            )
        }
        refunded_by_appointment = {
            appointment_id: int(total)
            for appointment_id, total in session.execute(
                select(Payment.appointment_id, func.coalesce(func.sum(Refund.amount_paise), 0))
                .join(Payment, Payment.id == Refund.payment_id)
                .where(
                    Payment.appointment_id.in_(appointment_ids),
                    Payment.is_reversed.is_(False),
                )
                .group_by(Payment.appointment_id)
            )
        }

    for appointment_id, visit_id, doctor_id, doctor_name, status, doctor_default_fee in rows:
        completed = status == ConsultationStatus.COMPLETED.value
        if (
            completed
            and appointment_id not in line_fee_by_appointment
            and (doctor_default_fee or 0) > 0
        ):
            raise ApiError(
                status_code=422,
                code="consultation_missing_bill_line",
                message="A completed consultation is missing its consultation bill line.",
            )
        fee_paise = line_fee_by_appointment.get(appointment_id, 0)
        paid_paise = max(
            0,
            paid_by_appointment.get(appointment_id, 0)
            - refunded_by_appointment.get(appointment_id, 0),
        )
        lines[visit_id].append(
            VisitChargeLine(
                appointment_id=appointment_id,
                visit_id=visit_id,
                doctor_id=doctor_id,
                doctor_name_en=doctor_name,
                consultation_status=status,
                fee_paise=fee_paise,
                paid_paise=paid_paise,
                balance_paise=max(0, fee_paise - paid_paise) if completed and fee_paise > 0 else 0,
                collectable=completed,
            )
        )
    return lines


def consultation_fee_paise(session: Session, appointment_id: int) -> int | None:
    """The fee saved on the consultation's bill line, or None when it has no line yet."""
    return session.scalar(
        select(BillItem.amount_paise).where(
            BillItem.appointment_id == appointment_id,
            BillItem.category == BillItemCategory.CONSULTATION.value,
        )
    )


def visit_payments(session: Session, visit_id: int) -> list[Payment]:
    """Every payment on the visit or its consultations, newest first (reversed included)."""
    return list(
        session.scalars(
            select(Payment)
            .outerjoin(Appointment, Appointment.id == Payment.appointment_id)
            .where(
                or_(
                    Payment.visit_id == visit_id,
                    Appointment.visit_id == visit_id,
                )
            )
            .options(selectinload(Payment.created_by_user))
            .order_by(Payment.created_at.desc(), Payment.id.desc())
        )
    )


def lock_visit(session: Session, visit_id: int) -> Visit | None:
    """Read the visit under a row lock, so concurrent writers serialize."""
    return session.scalar(
        select(Visit)
        .where(Visit.id == visit_id)
        .with_for_update()
    )


def visit_outstanding_paise(session: Session, visit_id: int) -> int:
    """What is still due on the visit: the visit-level due amount."""
    return visit_totals(session, [visit_id])[visit_id].due_paise


def compute_visit_dues(session: Session) -> list[VisitDueOut]:
    """Charges still owed on visits that were closed with a balance, newest first.

    A visit closed with money due keeps its balance (owner decision 8). Only CLOSED visits are
    listed: an open one is still at checkout. Paying one of these does not reopen the visit.
    """
    visits = session.execute(
        select(Visit, Patient)
        .join(Patient, Patient.id == Visit.patient_id)
        .where(Visit.status == VisitStatus.CLOSED.value)
        .order_by(Visit.visit_date.desc(), Visit.id.desc())
    ).all()
    if not visits:
        return []

    visit_ids = [visit.id for visit, _ in visits]
    totals = visit_totals(session, visit_ids)

    appts = session.execute(
        select(Appointment.visit_id, Doctor.name_en)
        .join(Doctor, Doctor.id == Appointment.doctor_id)
        .where(
            Appointment.visit_id.in_(visit_ids),
            Appointment.consultation_status == ConsultationStatus.COMPLETED.value,
        )
        .order_by(Appointment.id.asc())
    ).all()

    doctor_names_by_visit: dict[int, list[str]] = {v_id: [] for v_id in visit_ids}
    for v_id, doc_name in appts:
        doctor_names_by_visit[v_id].append(doc_name)

    dues: list[VisitDueOut] = []
    for visit, patient in visits:
        tot = totals.get(visit.id)
        if not tot or tot.due_paise <= 0:
            continue
        dues.append(
            VisitDueOut(
                visit_id=visit.id,
                patient_id=patient.id,
                patient_urn=patient.urn,
                patient_name=patient.full_name,
                doctor_names=doctor_names_by_visit.get(visit.id, []),
                visit_date=visit.visit_date,
                bill_total_paise=tot.bill_total_paise,
                paid_paise=tot.paid_paise,
                balance_paise=tot.due_paise,
                close_reason=visit.close_reason,
            )
        )
    return dues


def compute_pending_dues(session: Session) -> list[PendingDueOut]:
    """Return active and completed treatment packages with a positive outstanding balance, newest
    first (BR-003)."""
    stmt = (
        select(TreatmentPlan)
        .where(TreatmentPlan.status.in_(["ACTIVE", "COMPLETED"]))
        .options(selectinload(TreatmentPlan.patient))
        .order_by(TreatmentPlan.created_at.desc())
    )
    plans = session.execute(stmt).scalars().all()
    if not plans:
        return []

    plan_ids = [plan.id for plan in plans]
    paid_by_plan = net_paid_by_treatment_plans(session, plan_ids)

    dues: list[PendingDueOut] = []
    for plan in plans:
        paid_paise: int = paid_by_plan.get(plan.id, 0)
        balance_paise = plan.agreed_price_paise - paid_paise

        if balance_paise > 0:
            dues.append(
                PendingDueOut(
                    treatment_plan_id=plan.id,
                    patient_id=plan.patient_id,
                    patient_urn=plan.patient.urn if plan.patient else "",
                    patient_name=plan.patient.full_name if plan.patient else "",
                    plan_name=plan.plan_name,
                    # D-04/FB-05: clinical diagnosis hidden from billing dues
                    condition_diagnosis=None,
                    agreed_price_paise=plan.agreed_price_paise,
                    paid_paise=paid_paise,
                    balance_paise=balance_paise,
                    total_sessions=plan.total_sessions,
                    completed_sessions=plan.completed_sessions,
                )
            )

    return dues


def patient_previous_dues(
    session: Session, patient_id: int, exclude_visit_id: int | None = None
) -> list[PreviousDueOut]:
    """Outstanding dues on previously closed visits of the same patient (OD-22-17)."""
    merged_ids = session.scalars(
        select(Patient.id).where(Patient.merged_into_id == patient_id)
    ).all()
    effective_ids = [patient_id, *merged_ids]
    stmt = select(Visit).where(
        Visit.patient_id.in_(effective_ids),
        Visit.status == VisitStatus.CLOSED.value,
    )
    if exclude_visit_id is not None:
        stmt = stmt.where(Visit.id != exclude_visit_id)
    stmt = stmt.order_by(Visit.visit_date.desc(), Visit.id.desc())
    closed_visits = session.execute(stmt).scalars().all()
    if not closed_visits:
        return []

    visit_ids = [v.id for v in closed_visits]
    totals = visit_totals(session, visit_ids)

    dues_visit_ids = [
        v_id for v_id in visit_ids if totals.get(v_id) and totals[v_id].due_paise > 0
    ]
    if not dues_visit_ids:
        return []

    appts = session.execute(
        select(Appointment.visit_id, Doctor.name_en)
        .join(Doctor, Doctor.id == Appointment.doctor_id)
        .where(
            Appointment.visit_id.in_(dues_visit_ids),
            Appointment.consultation_status != ConsultationStatus.CANCELLED.value,
        )
        .order_by(Appointment.id.asc())
    ).all()

    doctor_names_by_visit: dict[int, list[str]] = {v_id: [] for v_id in dues_visit_ids}
    for v_id, doc_name in appts:
        if doc_name not in doctor_names_by_visit[v_id]:
            doctor_names_by_visit[v_id].append(doc_name)

    results: list[PreviousDueOut] = []
    for visit in closed_visits:
        if visit.id in dues_visit_ids:
            tot = totals[visit.id]
            results.append(
                PreviousDueOut(
                    visit_id=visit.id,
                    visit_date=visit.visit_date,
                    doctor_names=doctor_names_by_visit.get(visit.id, []),
                    balance_paise=tot.due_paise,
                )
            )
    return results


def patient_package_summaries(session: Session, patient_id: int) -> list[PackageInfoOut]:
    """Information-only treatment package summaries for one patient (LED-03..07, OD-C, D-04).

    Strictly clinical-free (no condition_diagnosis or notes).
    """
    stmt = (
        select(TreatmentPlan)
        .where(
            TreatmentPlan.patient_id == patient_id,
            TreatmentPlan.status.in_(["ACTIVE", "COMPLETED"]),
        )
        .order_by(TreatmentPlan.created_at.desc(), TreatmentPlan.id.desc())
    )
    plans = session.execute(stmt).scalars().all()
    if not plans:
        return []

    plan_ids = [plan.id for plan in plans]
    paid_map = net_paid_by_treatment_plans(session, plan_ids)

    summaries: list[PackageInfoOut] = []
    for plan in plans:
        paid_paise = int(paid_map.get(plan.id, 0))
        balance_paise = max(0, plan.agreed_price_paise - paid_paise)
        remaining = max(0, plan.total_sessions - plan.completed_sessions)
        summaries.append(
            PackageInfoOut(
                treatment_plan_id=plan.id,
                plan_name=plan.plan_name,
                status=plan.status,
                total_sessions=plan.total_sessions,
                completed_sessions=plan.completed_sessions,
                remaining_sessions=remaining,
                agreed_price_paise=plan.agreed_price_paise,
                paid_paise=paid_paise,
                balance_paise=balance_paise,
            )
        )
    return summaries
