"""Physiotherapy treatment plans and packages endpoints (TRT-01, OQ-13).

Guarantees:
- Plan creation restricted to licensed doctors (PLAN_WRITE).
- Optimistic concurrency control via version_id (HTTP 409 on conflict).
- Mandatory cancellation reason for cancelled plans.
- In-transaction audit trail for all plan lifecycle transitions.
"""

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select, true
from sqlalchemy.orm import Session, selectinload

from kalyan_api import clock
from kalyan_api.core.errors import ApiError, require_version
from kalyan_api.core.permissions import Permission, Role
from kalyan_api.core.policy import require
from kalyan_api.core.principal import (
    Principal,
    build_audit_context,
    current_principal,
)
from kalyan_api.core.scope import (
    ScopeFamily,
    audit_cross_doctor_list_read,
    get_scoped_or_404,
    row_scope,
)
from kalyan_api.db.session import SessionDep
from kalyan_api.models import (
    ClinicalEncounter,
    Department,
    Patient,
    TreatmentPlan,
    TreatmentPlanStatus,
    doctor_departments,
)
from kalyan_api.schemas.treatment_plans import (
    TreatmentPlanCreate,
    TreatmentPlanOut,
    TreatmentPlanUpdate,
)
from kalyan_api.services import audit_service, billing_service, ledger_service
from kalyan_api.services.audit_service import AuditAction
from kalyan_api.services.code_sequence_service import effective_patient_ids

router = APIRouter(tags=["treatment-plans"])


def _require_physiotherapy_doctor(session: Session, principal: Principal) -> None:
    """Ensure the doctor belongs to a Physiotherapy department before managing rehab packages."""
    codes = session.scalars(
        select(Department.code)
        .join(doctor_departments, doctor_departments.c.department_id == Department.id)
        .where(doctor_departments.c.doctor_id == principal.doctor_id)
    ).all()
    if not any("PHYSIO" in (code or "").strip().upper() for code in codes):
        raise ApiError(
            status_code=403,
            code="specialty_required",
            message="Only Physiotherapy doctors can manage physiotherapy treatment packages.",
        )


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
    _require_physiotherapy_doctor(session, principal)

    patient = session.get(Patient, payload.patient_id)
    if not patient or not patient.is_active:
        raise ApiError(status_code=404, code="patient_not_found", message="Patient not found.")

    encounter: ClinicalEncounter | None = None
    if payload.encounter_id is not None:
        encounter = get_scoped_or_404(
            session,
            ClinicalEncounter,
            payload.encounter_id,
            principal,
            family=ScopeFamily.CLINICAL_WRITE,
            doctor_id_col=ClinicalEncounter.doctor_id,
        )
        # BR-001: the encounter must belong to the same patient (or merged alias) as the plan.
        if encounter.patient_id not in effective_patient_ids(session, payload.patient_id):
            raise ApiError(
                status_code=404,
                code="encounter_not_found",
                message="Encounter not found for this patient.",
            )

    plan_patient_id = (
        encounter.patient_id
        if (payload.encounter_id is not None and encounter is not None)
        else payload.patient_id
    )
    plan = TreatmentPlan(
        patient_id=plan_patient_id,
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
    if plan.agreed_price_paise > 0:
        ledger_service.record_package_charge(
            session,
            plan,
            actor_user_id=principal.user_id,
            occurred_at=plan.created_at,
        )

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
    "/treatment-plans",
    response_model=list[TreatmentPlanOut],
    dependencies=[Depends(require(Permission.PLAN_READ))],
)
def list_treatment_plans(
    session: SessionDep,
    status: str | None = Query(
        "ACTIVE",
        description="Filter by status (ACTIVE, COMPLETED, CANCELLED, or ALL)",
    ),
    limit: int = Query(50, ge=1, le=200),
    principal: Principal = Depends(current_principal),
) -> list[TreatmentPlanOut]:
    """List treatment plans scoped to the logged-in doctor's roster."""
    valid_statuses = {s.value for s in TreatmentPlanStatus}
    status_filter: str | None = None
    if status is not None:
        normalized = status.strip().upper()
        if normalized != "ALL":
            if normalized not in valid_statuses:
                raise ApiError(
                    status_code=422,
                    code="invalid_plan_status",
                    message=(
                        f"Invalid status '{status}'. Must be one of: "
                        f"{', '.join(sorted(valid_statuses))}, or ALL."
                    ),
                )
            status_filter = normalized

    filters = []
    if principal.role == Role.DOCTOR:
        if principal.doctor_id is None:
            return []
        filters.append(TreatmentPlan.doctor_id == principal.doctor_id)

    if status_filter is not None:
        filters.append(TreatmentPlan.status == status_filter)

    stmt = (
        select(TreatmentPlan)
        .options(
            selectinload(TreatmentPlan.patient),
            selectinload(TreatmentPlan.doctor),
        )
        .where(*filters)
        .order_by(TreatmentPlan.updated_at.desc(), TreatmentPlan.id.desc())
        .limit(limit)
    )
    plans = session.execute(stmt).scalars().all()
    return [_to_plan_out(p) for p in plans]


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
    if principal.role in (Role.ADMIN, Role.RECEPTION):
        plan = session.get(TreatmentPlan, id)
        if not plan:
            raise ApiError(
                status_code=404,
                code="plan_not_found",
                message="Treatment plan not found.",
            )
    else:
        plan = get_scoped_or_404(
            session,
            TreatmentPlan,
            id,
            principal,
            family=ScopeFamily.CLINICAL_READ,
            doctor_id_col=TreatmentPlan.doctor_id,
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
    scope_expr = (
        true()
        if principal.role in (Role.ADMIN, Role.RECEPTION)
        else row_scope(principal, ScopeFamily.CLINICAL_READ, TreatmentPlan.doctor_id)
    )
    patient_ids = effective_patient_ids(session, patient_id)
    stmt = (
        select(TreatmentPlan)
        .where(TreatmentPlan.patient_id.in_(patient_ids), scope_expr)
        .order_by(TreatmentPlan.created_at.desc())
    )

    plans = session.execute(stmt).scalars().all()
    audit_cross_doctor_list_read(
        session, principal, patient_id, "patient_treatment_plans_list", plans
    )
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

    plan = get_scoped_or_404(
        session,
        TreatmentPlan,
        id,
        principal,
        family=ScopeFamily.CLINICAL_WRITE,
        doctor_id_col=TreatmentPlan.doctor_id,
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

    old_agreed_price = plan.agreed_price_paise
    before_state = {
        "plan_name": plan.plan_name,
        "total_sessions": plan.total_sessions,
        "status": plan.status,
        "version_id": plan.version_id,
    }

    if payload.total_sessions is not None and payload.total_sessions < plan.completed_sessions:
        raise ApiError(
            status_code=422,
            code="total_sessions_less_than_completed",
            message=(
                f"Total sessions ({payload.total_sessions}) cannot be less than "
                f"already completed sessions ({plan.completed_sessions})."
            ),
        )

    effective_total = (
        payload.total_sessions if payload.total_sessions is not None else plan.total_sessions
    )

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
    elif payload.status == TreatmentPlanStatus.COMPLETED:
        if plan.completed_sessions < effective_total:
            raise ApiError(
                status_code=422,
                code="sessions_incomplete",
                message=(
                    f"Cannot mark plan as completed: "
                    f"{plan.completed_sessions}/{effective_total} sessions completed."
                ),
            )
        plan.status = TreatmentPlanStatus.COMPLETED.value
    elif payload.status is not None:
        plan.status = payload.status.value

    if payload.plan_name is not None:
        plan.plan_name = payload.plan_name
    if payload.condition_diagnosis is not None:
        plan.condition_diagnosis = payload.condition_diagnosis
    if payload.referred_by is not None:
        plan.referred_by = payload.referred_by
    if payload.total_sessions is not None:
        plan.total_sessions = payload.total_sessions
        if plan.completed_sessions >= plan.total_sessions:
            plan.status = TreatmentPlanStatus.COMPLETED.value

    if getattr(payload, "agreed_price_paise", None) is not None:
        plan.agreed_price_paise = payload.agreed_price_paise

    plan.version_id += 1
    plan.updated_at = clock.utcnow()
    session.flush()

    if plan.agreed_price_paise != old_agreed_price:
        ledger_service.record_package_adjustment(
            session,
            plan,
            delta_paise=plan.agreed_price_paise - old_agreed_price,
            actor_user_id=principal.user_id,
            occurred_at=plan.updated_at,
        )

    if is_cancellation and plan.agreed_price_paise > 0:
        net_paid = billing_service.package_net_paid_paise(session, plan.id)
        uncollected = max(0, plan.agreed_price_paise - net_paid)
        if uncollected > 0:
            reason_suffix = (
                f" ({plan.cancellation_reason})" if plan.cancellation_reason else ""
            )
            ledger_service.record_package_adjustment(
                session,
                plan,
                delta_paise=-uncollected,
                description=f"Package Cancelled: {plan.plan_name}{reason_suffix}",
                actor_user_id=principal.user_id,
                occurred_at=plan.updated_at,
            )

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
