"""Concurrency-safe physiotherapy session sequence allocator and service functions (TRT-02)."""

from sqlalchemy import select
from sqlalchemy.orm import Session, lazyload

from kalyan_api.core.errors import ApiError
from kalyan_api.models import TreatmentPlan, TreatmentPlanStatus


def allocate_next_session_number(
    session: Session, treatment_plan_id: int
) -> tuple[TreatmentPlan, int]:
    """Locks the treatment plan row and returns the plan along with next contiguous session number.

    Guarantees:
    - Atomically selects TreatmentPlan FOR UPDATE without outer joins.
    - Rejects logging if plan is not ACTIVE or already COMPLETED.
    - Returns (TreatmentPlan, next_session_number).
    """
    plan = session.execute(
        select(TreatmentPlan)
        .options(lazyload(TreatmentPlan.patient), lazyload(TreatmentPlan.doctor))
        .where(TreatmentPlan.id == treatment_plan_id)
        .with_for_update()
    ).scalar_one_or_none()

    if plan is None:
        raise ApiError(status_code=404, code="plan_not_found", message="Treatment plan not found.")

    if plan.status != TreatmentPlanStatus.ACTIVE.value:
        raise ApiError(
            status_code=422,
            code="plan_not_active",
            message=f"Cannot log session: plan is {plan.status}.",
        )

    if plan.completed_sessions >= plan.total_sessions:
        raise ApiError(
            status_code=422,
            code="plan_already_completed",
            message="All sessions for this plan have already been completed.",
        )

    next_number = plan.completed_sessions + 1
    return plan, next_number
