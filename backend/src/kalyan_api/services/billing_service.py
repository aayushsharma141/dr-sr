"""Billing ledger computations shared by billing and dashboard routers.

Guarantees:
- Pending dues are derived dynamically from the payment ledger (BIL-03); no stored balances.
- Monetary values are integer paise only (BIL-02); reversed payments never count as paid.
"""

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from kalyan_api.models import Payment, TreatmentPlan
from kalyan_api.schemas.billing import PendingDueOut


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
                    condition_diagnosis=plan.condition_diagnosis,
                    agreed_price_paise=plan.agreed_price_paise,
                    paid_paise=paid_paise,
                    balance_paise=balance_paise,
                    total_sessions=plan.total_sessions,
                    completed_sessions=plan.completed_sessions,
                )
            )

    return dues
