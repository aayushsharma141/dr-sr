"""Physiotherapy treatment sessions, immutability locks, and addenda endpoints (TRT-02, TRT-03).

Guarantees:
- Concurrency-safe contiguous session numbering (1..N).
- Finalised sessions cannot be edited or deleted (HTTP 400 Bad Request).
- Retrospective clinical corrections must be recorded as dated addenda.
- Doctor silo isolation and least-privilege role access control.
- In-transaction audit trail for session logging and addenda creation.
"""

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from kalyan_api import clock
from kalyan_api.core.errors import ApiError
from kalyan_api.core.permissions import Permission, Role
from kalyan_api.core.policy import require
from kalyan_api.core.principal import (
    Principal,
    build_audit_context,
    current_principal,
)
from kalyan_api.db.session import SessionDep
from kalyan_api.models import (
    TreatmentPlan,
    TreatmentSession,
    TreatmentSessionAddendum,
)
from kalyan_api.schemas.treatment_sessions import (
    TreatmentSessionAddendumCreate,
    TreatmentSessionAddendumOut,
    TreatmentSessionCreate,
    TreatmentSessionOut,
)
from kalyan_api.services import audit_service
from kalyan_api.services.audit_service import AuditAction
from kalyan_api.services.session_service import allocate_next_session_number

router = APIRouter(tags=["treatment-sessions"])


def _to_session_out(sess: TreatmentSession) -> TreatmentSessionOut:
    """Format TreatmentSession model to output schema including addenda."""
    sorted_addenda = sorted(sess.addenda, key=lambda a: (a.created_at, a.id))
    addenda_out = [
        TreatmentSessionAddendumOut(
            id=a.id,
            session_id=a.session_id,
            author_user_id=a.author_user_id,
            author_name=(
                a.author_user.full_name
                if a.author_user and a.author_user.full_name
                else (a.author_user.username if a.author_user else "")
            ),
            note=a.note,
            created_at=a.created_at,
        )
        for a in sorted_addenda
    ]

    return TreatmentSessionOut(
        id=sess.id,
        treatment_plan_id=sess.treatment_plan_id,
        patient_id=sess.patient_id,
        patient_urn=sess.patient.urn if sess.patient else "",
        patient_name=sess.patient.full_name if sess.patient else "",
        doctor_id=sess.doctor_id,
        doctor_name=sess.doctor.name_en if sess.doctor else "",
        session_number=sess.session_number,
        session_date=sess.session_date,
        vas_score=sess.vas_score,
        modalities=sess.modalities or [],
        clinical_notes=sess.clinical_notes,
        is_finalised=sess.is_finalised,
        created_by_user_id=sess.created_by_user_id,
        created_by_username=sess.created_by_user.username if sess.created_by_user else "",
        created_at=sess.created_at,
        addenda=addenda_out,
    )


@router.post(
    "/treatment-plans/{plan_id}/sessions",
    response_model=TreatmentSessionOut,
    status_code=201,
    dependencies=[Depends(require(Permission.SESSION_LOG_WRITE))],
)
def log_treatment_session(
    plan_id: int,
    payload: TreatmentSessionCreate,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> TreatmentSessionOut:
    """Log an individual physiotherapy session with VAS score and modalities (TRT-02)."""
    if principal.role != Role.DOCTOR or principal.doctor_id is None:
        raise ApiError(
            status_code=403,
            code="doctor_only",
            message="Only authenticated doctors can log treatment sessions.",
        )

    # Concurrency-safe atomic allocation locking plan row
    plan, next_session_number = allocate_next_session_number(session, plan_id)

    if plan.doctor_id != principal.doctor_id:
        raise ApiError(
            status_code=404,
            code="plan_not_found",
            message="Treatment plan not found.",
        )

    session_date = payload.session_date or clock.utcnow().date()

    sess = TreatmentSession(
        treatment_plan_id=plan.id,
        patient_id=plan.patient_id,
        doctor_id=principal.doctor_id,
        session_number=next_session_number,
        session_date=session_date,
        vas_score=payload.vas_score,
        modalities=payload.modalities,
        clinical_notes=payload.clinical_notes,
        is_finalised=True,
        created_by_user_id=principal.user_id,
    )
    session.add(sess)
    session.flush()

    # Re-query with eager relationships
    stmt = (
        select(TreatmentSession)
        .where(TreatmentSession.id == sess.id)
        .options(selectinload(TreatmentSession.addenda))
    )
    refreshed_sess = session.execute(stmt).scalar_one()

    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        action=AuditAction.TREATMENT_SESSION_LOGGED,
        entity_type="treatment_session",
        entity_id=refreshed_sess.id,
        after={
            "treatment_plan_id": plan.id,
            "session_number": next_session_number,
            "vas_score": payload.vas_score,
            "modalities": payload.modalities,
            "patient_id": plan.patient_id,
        },
    )

    return _to_session_out(refreshed_sess)


@router.get(
    "/treatment-plans/{plan_id}/sessions",
    response_model=list[TreatmentSessionOut],
    dependencies=[Depends(require(Permission.SESSION_LOG_READ))],
)
def list_treatment_sessions(
    plan_id: int,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> list[TreatmentSessionOut]:
    """Retrieve chronological sessions and VAS scores for a treatment plan."""
    plan = session.get(TreatmentPlan, plan_id)
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

    stmt = (
        select(TreatmentSession)
        .where(TreatmentSession.treatment_plan_id == plan_id)
        .options(selectinload(TreatmentSession.addenda))
        .order_by(TreatmentSession.session_number.asc())
    )
    sessions = session.execute(stmt).scalars().all()
    return [_to_session_out(s) for s in sessions]


@router.patch(
    "/treatment-sessions/{id}",
    status_code=400,
    dependencies=[Depends(require(Permission.SESSION_LOG_WRITE))],
)
def update_treatment_session(id: int) -> None:
    """Rejects direct session modification; records are immutable (TRT-03)."""
    raise ApiError(
        status_code=400,
        code="immutable_record",
        message="Finalised treatment sessions cannot be modified. Append an addendum instead.",
    )


@router.delete(
    "/treatment-sessions/{id}",
    status_code=400,
    dependencies=[Depends(require(Permission.SESSION_LOG_WRITE))],
)
def delete_treatment_session(id: int) -> None:
    """Rejects direct session deletion; records are immutable (TRT-03)."""
    raise ApiError(
        status_code=400,
        code="immutable_record",
        message="Finalised treatment sessions cannot be deleted.",
    )


@router.post(
    "/treatment-sessions/{id}/addenda",
    response_model=TreatmentSessionAddendumOut,
    status_code=201,
    dependencies=[Depends(require(Permission.SESSION_LOG_WRITE))],
)
def create_session_addendum(
    id: int,
    payload: TreatmentSessionAddendumCreate,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> TreatmentSessionAddendumOut:
    """Append a retrospective clinical note or correction to a finalised session (TRT-03)."""
    if principal.role != Role.DOCTOR or principal.doctor_id is None:
        raise ApiError(
            status_code=403,
            code="doctor_only",
            message="Only authenticated doctors can append session addenda.",
        )

    sess = session.get(TreatmentSession, id)
    if not sess or sess.doctor_id != principal.doctor_id:
        raise ApiError(
            status_code=404,
            code="session_not_found",
            message="Treatment session not found.",
        )

    addendum = TreatmentSessionAddendum(
        session_id=sess.id,
        author_user_id=principal.user_id,
        note=payload.note.strip(),
    )
    session.add(addendum)
    session.flush()

    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        action=AuditAction.TREATMENT_SESSION_ADDENDUM_ADDED,
        entity_type="treatment_session_addendum",
        entity_id=addendum.id,
        after={
            "session_id": sess.id,
            "author_user_id": principal.user_id,
            "note": addendum.note,
        },
    )

    return TreatmentSessionAddendumOut(
        id=addendum.id,
        session_id=addendum.session_id,
        author_user_id=addendum.author_user_id,
        author_name=principal.username,
        note=addendum.note,
        created_at=addendum.created_at,
    )
