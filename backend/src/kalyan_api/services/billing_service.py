"""Billing ledger computations shared by billing and dashboard routers.

Guarantees:
- Pending dues are derived dynamically from the payment ledger (BIL-03); no stored balances.
- Monetary values are integer paise only (BIL-02); reversed payments never count as paid.
"""

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from kalyan_api.models import Appointment, ConsultationStatus, Doctor, Payment, TreatmentPlan
from kalyan_api.schemas.billing import PendingDueOut


def visit_outstanding_paise(session: Session, visit_id: int) -> int:
    """Consultation fees of the visit's completed consultations that payments do not yet cover.

    Interim rule until invoices exist (K-63, RF-14). Each COMPLETED consultation owes its
    doctor's default fee, the fee the overpayment guard on POST /payments already uses.
    Payments linked to that appointment reduce it, reversed payments excluded, and never below
    zero. A consultation that was cancelled owes nothing. Treatment packages are not included;
    they stay in Pending Dues.
    """
    rows = session.execute(
        select(Appointment.id, Doctor.default_fee_paise)
        .join(Doctor, Doctor.id == Appointment.doctor_id)
        .where(
            Appointment.visit_id == visit_id,
            Appointment.consultation_status == ConsultationStatus.COMPLETED.value,
        )
    ).all()
    outstanding = 0
    for appointment_id, fee_paise in rows:
        if fee_paise <= 0:
            continue
        paid_paise: int = (
            session.scalar(
                select(func.coalesce(func.sum(Payment.amount_paise), 0)).where(
                    Payment.appointment_id == appointment_id,
                    Payment.is_reversed.is_(False),
                )
            )
            or 0
        )
        outstanding += max(0, fee_paise - paid_paise)
    return outstanding


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
