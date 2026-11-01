"""Physiotherapy treatment plans and packages endpoints (TRT-01, OQ-13).

Guarantees:
- Plan creation restricted to licensed doctors (PLAN_WRITE).
- Optimistic concurrency control via version_id (HTTP 409 on conflict).
- Mandatory cancellation reason for cancelled plans.
- In-transaction audit trail for all plan lifecycle transitions.
"""

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select

from kalyan_api import clock
from kalyan_api.core.errors import ApiError, require_version
from kalyan_api.core.permissions import Permission, Role
from kalyan_api.core.policy import require
from kalyan_api.core.principal import (
    Principal,
    build_audit_context,
    current_principal,
)
from kalyan_api.db.session import SessionDep
from kalyan_api.models import (
    ClinicalEncounter,
    Patient,
    TreatmentPlan,
    TreatmentPlanStatus,
)
from kalyan_api.schemas.treatment_plans import (
    TreatmentPlanCreate,
    TreatmentPlanOut,
    TreatmentPlanUpdate,
)
from kalyan_api.services import audit_service
from kalyan_api.services.audit_service import AuditAction

router = APIRouter(tags=["treatment-plans"])


def _to_plan_out(plan: TreatmentPlan) -> TreatmentPlanOut:
    """Format TreatmentPlan model to output schema."""
    return TreatmentPlanOut(
        id=plan.id,
        patient_id=plan.patient_id,
        patient_urn=plan.patient.urn if plan.patient else "",
        patient_name=plan.patient.full_name if plan.patient else "",
        doctor_id=plan.doctor_id,
        doctor_name=plan.doctor.name_en if plan.doctor else "",
        encounter_id=plan.encounter_id,
        plan_name=plan.plan_name,
        condition_diagnosis=plan.condition_diagnosis,
        referred_by=plan.referred_by,
        total_sessions=plan.total_sessions,
        completed_sessions=plan.completed_sessions,
        agreed_price_paise=plan.agreed_price_paise,
        status=plan.status,
        cancellation_reason=plan.cancellation_reason,
        version_id=plan.version_id,
        created_at=plan.created_at,
        updated_at=plan.updated_at,
    )


@router.post(
    "/treatment-plans",
    response_model=TreatmentPlanOut,
    status_code=201,
    dependencies=[Depends(require(Permission.PLAN_WRITE))],
)
def create_treatment_plan(
    payload: TreatmentPlanCreate,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> TreatmentPlanOut:
    """Create a new multi-session physiotherapy treatment package (TRT-01, OQ-13)."""
    if principal.role != Role.DOCTOR or principal.doctor_id is None:
        raise ApiError(
            status_code=403,
            code="doctor_only",
            message="Only authenticated doctors can create treatment plans.",
        )

    patient = session.get(Patient, payload.patient_id)
    if not patient or not patient.is_active:
        raise ApiError(status_code=404, code="patient_not_found", message="Patient not found.")

    if payload.encounter_id is not None:
        encounter = session.get(ClinicalEncounter, payload.encounter_id)
        if not encounter or encounter.doctor_id != principal.doctor_id:
            raise ApiError(
                status_code=404,
                code="encounter_not_found",
                message="Clinical encounter not found or not assigned to this doctor.",
            )

    plan = TreatmentPlan(
        patient_id=payload.patient_id,
        doctor_id=principal.doctor_id,
        encounter_id=payload.encounter_id,
        plan_name=payload.plan_name,
        condition_diagnosis=payload.condition_diagnosis,
        referred_by=payload.referred_by,
        total_sessions=payload.total_sessions,
        completed_sessions=0,
        agreed_price_paise=payload.agreed_price_paise,
        status=TreatmentPlanStatus.ACTIVE.value,
    )
    session.add(plan)
    session.flush()

    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        action=AuditAction.TREATMENT_PLAN_CREATED,
        entity_type="treatment_plan",
        entity_id=plan.id,
        after={
            "patient_id": plan.patient_id,
            "patient_urn": patient.urn,
            "doctor_id": plan.doctor_id,
            "plan_name": plan.plan_name,
            "total_sessions": plan.total_sessions,
            "agreed_price_paise": plan.agreed_price_paise,
        },
    )

    return _to_plan_out(plan)


@router.get(
    "/treatment-plans/{id}",
    response_model=TreatmentPlanOut,
    dependencies=[Depends(require(Permission.PLAN_READ))],
)
def get_treatment_plan(
    id: int,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> TreatmentPlanOut:
    """Retrieve details and progress of a treatment plan."""
    plan = session.get(TreatmentPlan, id)
    if not plan:
        raise ApiError(
            status_code=404,
            code="plan_not_found",
            message="Treatment plan not found.",
        )

    if principal.role == Role.DOCTOR and plan.doctor_id != principal.doctor_id:
        raise ApiError(
            status_code=404,
            code="plan_not_found",
            message="Treatment plan not found.",
        )

    return _to_plan_out(plan)


@router.get(
    "/patients/{patient_id}/treatment-plans",
    response_model=list[TreatmentPlanOut],
    dependencies=[Depends(require(Permission.PLAN_READ))],
)
def list_patient_treatment_plans(
    patient_id: int,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> list[TreatmentPlanOut]:
    """List historical and active treatment plans for a patient."""
    stmt = (
        select(TreatmentPlan)
        .where(TreatmentPlan.patient_id == patient_id)
        .order_by(TreatmentPlan.created_at.desc())
    )

    if principal.role == Role.DOCTOR:
        stmt = stmt.where(TreatmentPlan.doctor_id == principal.doctor_id)

    plans = session.execute(stmt).scalars().all()
    return [_to_plan_out(p) for p in plans]


@router.patch(
    "/treatment-plans/{id}",
    response_model=TreatmentPlanOut,
    dependencies=[Depends(require(Permission.PLAN_WRITE))],
)
def update_treatment_plan(
    id: int,
    payload: TreatmentPlanUpdate,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> TreatmentPlanOut:
    """Update or cancel a treatment plan with optimistic concurrency control."""
    if principal.role != Role.DOCTOR or principal.doctor_id is None:
        raise ApiError(
            status_code=403,
            code="doctor_only",
            message="Only authenticated doctors can update treatment plans.",
        )

    plan = session.get(TreatmentPlan, id)
    if not plan or plan.doctor_id != principal.doctor_id:
        raise ApiError(
            status_code=404,
            code="plan_not_found",
            message="Treatment plan not found.",
        )

    # Enforce optimistic locking
    require_version(plan, payload.version_id, label="treatment_plan")

    if plan.status == TreatmentPlanStatus.COMPLETED.value:
        raise ApiError(
            status_code=422,
            code="plan_completed",
            message="Completed treatment plans cannot be modified or cancelled.",
        )

    if plan.status == TreatmentPlanStatus.CANCELLED.value:
        raise ApiError(
            status_code=422,
            code="plan_already_cancelled",
            message="Cancelled treatment plans cannot be modified.",
        )

    before_state = {
        "plan_name": plan.plan_name,
        "total_sessions": plan.total_sessions,
        "status": plan.status,
        "version_id": plan.version_id,
    }

    is_cancellation = False
    if payload.status == TreatmentPlanStatus.CANCELLED:
        if not payload.cancellation_reason or len(payload.cancellation_reason.strip()) < 3:
            raise ApiError(
                status_code=422,
                code="cancellation_reason_required",
                message="A cancellation reason of at least 3 characters is required.",
            )
        plan.status = TreatmentPlanStatus.CANCELLED.value
        plan.cancellation_reason = payload.cancellation_reason.strip()
        is_cancellation = True
    elif payload.status is not None:
        plan.status = payload.status.value

    if payload.plan_name is not None:
        plan.plan_name = payload.plan_name
    if payload.condition_diagnosis is not None:
        plan.condition_diagnosis = payload.condition_diagnosis
    if payload.referred_by is not None:
        plan.referred_by = payload.referred_by
    if payload.total_sessions is not None:
        if payload.total_sessions < plan.completed_sessions:
            raise ApiError(
                status_code=422,
                code="total_sessions_less_than_completed",
                message=(
                    f"Total sessions ({payload.total_sessions}) cannot be less than "
                    f"already completed sessions ({plan.completed_sessions})."
                ),
            )
        plan.total_sessions = payload.total_sessions
        if plan.completed_sessions >= plan.total_sessions:
            plan.status = TreatmentPlanStatus.COMPLETED.value

    plan.version_id += 1
    plan.updated_at = clock.utcnow()
    session.flush()

    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        action=(
            AuditAction.TREATMENT_PLAN_CANCELLED
            if is_cancellation
            else AuditAction.TREATMENT_PLAN_UPDATED
        ),
        entity_type="treatment_plan",
        entity_id=plan.id,
        before=before_state,
        after={
            "plan_name": plan.plan_name,
            "total_sessions": plan.total_sessions,
            "status": plan.status,
            "cancellation_reason": plan.cancellation_reason,
            "version_id": plan.version_id,
        },
    )

    return _to_plan_out(plan)
