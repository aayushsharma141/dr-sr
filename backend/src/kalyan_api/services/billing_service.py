"""Billing ledger computations shared by billing and dashboard routers.

Guarantees:
- Pending dues are derived dynamically from the payment ledger (BIL-03); no stored balances.
- Monetary values are integer paise only (BIL-02); reversed payments never count as paid.
"""

from collections.abc import Iterable
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from kalyan_api.models import (
    Appointment,
    ConsultationStatus,
    Doctor,
    Patient,
    Payment,
    TreatmentPlan,
    Visit,
    VisitStatus,
)
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


def visit_charge_lines(
    session: Session, visit_ids: Iterable[int]
) -> dict[int, list[VisitChargeLine]]:
    """The consultation charges of each visit, in check-in order.

    Interim rule until invoices exist (K-63, RF-14). Each COMPLETED consultation owes its
    doctor's default fee, the fee the overpayment guard on POST /payments already uses.
    Payments linked to that appointment reduce it, reversed payments excluded, and never below
    zero. A consultation that was cancelled, or is still waiting or in progress, owes nothing
    yet. Treatment packages are not included; they stay in Pending Dues.
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
    paid_by_appointment: dict[int, int] = {}
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

    for appointment_id, visit_id, doctor_id, doctor_name, status, fee_paise in rows:
        completed = status == ConsultationStatus.COMPLETED.value
        paid_paise = paid_by_appointment.get(appointment_id, 0)
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


def visit_payments(session: Session, visit_id: int) -> list[Payment]:
    """Every payment recorded against the visit's consultations, newest first (reversed too)."""
    return list(
        session.scalars(
            select(Payment)
            .join(Appointment, Appointment.id == Payment.appointment_id)
            .where(Appointment.visit_id == visit_id)
            .options(selectinload(Payment.created_by_user))
            .order_by(Payment.created_at.desc(), Payment.id.desc())
        )
    )


def visit_outstanding_paise(session: Session, visit_id: int) -> int:
    """What is still due on the visit: the sum of its consultation balances."""
    return sum(line.balance_paise for line in visit_charge_lines(session, [visit_id])[visit_id])


def compute_visit_dues(session: Session) -> list[VisitDueOut]:
    """Consultation fees still owed on visits that were closed with a balance, newest first.

    A visit closed with money due keeps its balance (owner decision 8). Only CLOSED visits are
    listed: an open one is still at checkout. Paying one of these does not reopen the visit.
    """
    visits = session.execute(
        select(Visit, Patient)
        .join(Patient, Patient.id == Visit.patient_id)
        .where(Visit.status == VisitStatus.CLOSED.value)
        .order_by(Visit.visit_date.desc(), Visit.id.desc())
    ).all()
    lines_by_visit = visit_charge_lines(session, [visit.id for visit, _ in visits])

    dues: list[VisitDueOut] = []
    for visit, patient in visits:
        for line in lines_by_visit[visit.id]:
            if line.balance_paise <= 0:
                continue
            dues.append(
                VisitDueOut(
                    visit_id=visit.id,
                    appointment_id=line.appointment_id,
                    patient_id=patient.id,
                    patient_urn=patient.urn,
                    patient_name=patient.full_name,
                    doctor_name_en=line.doctor_name_en,
                    visit_date=visit.visit_date,
                    fee_paise=line.fee_paise,
                    paid_paise=line.paid_paise,
                    balance_paise=line.balance_paise,
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

    dues: list[PendingDueOut] = []
    for plan in plans:
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
