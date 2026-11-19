"""Clinical investigation orders and append-only results API (T2.3).

Routes (mounted under /api in main.py):
- POST  /api/encounters/{encounter_id}/investigations
- GET   /api/encounters/{encounter_id}/investigations
- GET   /api/patients/{patient_id}/investigations
- PATCH /api/investigations/{order_id}/status
- POST  /api/investigations/{order_id}/results

Guarantees:
- D-04: Strictly DOCTOR-only via Permission.ENCOUNTER_READ / Permission.ENCOUNTER_WRITE.
- DWS-04: Cross-doctor reads audited via ScopeFamily.CLINICAL_READ and audit_cross_doctor_list_read.
- D-03: Mutations scoped to the owning doctor via ScopeFamily.CLINICAL_WRITE (404 on mismatch).
- Optimistic locking via version_id (409 on stale version) and strict status transition enforcement.
- Patient-level list reads succeed on archived/merged patients with downward alias consolidation.
"""

from datetime import UTC

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import joinedload, selectinload

from kalyan_api import clock
from kalyan_api.core.errors import ApiError, require_version
from kalyan_api.core.permissions import Permission, Role
from kalyan_api.core.policy import require
from kalyan_api.core.principal import Principal, build_audit_context, current_principal
from kalyan_api.core.scope import (
    ScopeFamily,
    audit_cross_doctor_list_read,
    get_scoped_or_404,
    row_scope,
)
from kalyan_api.db.session import SessionDep
from kalyan_api.models import (
    ClinicalEncounter,
    Doctor,
    InvestigationOrder,
    InvestigationResult,
    InvestigationStatus,
    Patient,
    PatientDocument,
)
from kalyan_api.schemas.investigations import (
    InvestigationOrderCreate,
    InvestigationOrderOut,
    InvestigationResultCreate,
    InvestigationResultOut,
    InvestigationStatusUpdate,
)
from kalyan_api.services import audit_service
from kalyan_api.services.audit_service import AuditAction
from kalyan_api.services.code_sequence_service import (
    effective_patient_ids,
    require_active_unmerged_patient,
)

router = APIRouter(tags=["investigations"])

_ALLOWED_STATUS_TRANSITIONS: dict[InvestigationStatus, frozenset[InvestigationStatus]] = {
    InvestigationStatus.ORDERED: frozenset(
        {
            InvestigationStatus.SAMPLE_COLLECTED,
            InvestigationStatus.COMPLETED,
            InvestigationStatus.CANCELLED,
        }
    ),
    InvestigationStatus.SAMPLE_COLLECTED: frozenset(
        {
            InvestigationStatus.COMPLETED,
            InvestigationStatus.CANCELLED,
        }
    ),
    InvestigationStatus.COMPLETED: frozenset(),
    InvestigationStatus.CANCELLED: frozenset(),
}


def _require_doctor(principal: Principal) -> int:
    """Ensure the authenticated principal is a DOCTOR with a linked doctor profile."""
    if principal.role != Role.DOCTOR or principal.doctor_id is None:
        raise ApiError(status_code=403, code="doctor_only", message="Doctor access required.")
    return principal.doctor_id


def _result_to_out(
    result: InvestigationResult,
    *,
    recorded_by_username: str | None = None,
    document_title: str | None = None,
) -> InvestigationResultOut:
    """Serialize an InvestigationResult row."""
    username = recorded_by_username
    if username is None and result.recorded_by_user is not None:
        username = result.recorded_by_user.username
    doc_title = document_title
    if doc_title is None and result.document is not None:
        doc_title = result.document.title
    return InvestigationResultOut(
        id=result.id,
        order_id=result.order_id,
        patient_id=result.patient_id,
        document_id=result.document_id,
        document_title=doc_title,
        summary_text=result.summary_text,
        result_value=result.result_value,
        unit=result.unit,
        reference_range=result.reference_range,
        is_abnormal=result.is_abnormal,
        reported_at=result.reported_at,
        recorded_by_user_id=result.recorded_by_user_id,
        recorded_by_username=username,
        created_at=result.created_at,
    )


def _order_to_out(
    order: InvestigationOrder,
    *,
    encounter_code: str,
    doctor_name: str,
    results: list[InvestigationResult] | None = None,
) -> InvestigationOrderOut:
    """Serialize an InvestigationOrder row with results ordered newest first."""
    raw_results = order.results if results is None else results
    sorted_results = sorted(raw_results, key=lambda r: (r.reported_at, r.id), reverse=True)
    return InvestigationOrderOut(
        id=order.id,
        encounter_id=order.encounter_id,
        encounter_code=encounter_code,
        patient_id=order.patient_id,
        doctor_id=order.doctor_id,
        doctor_name=doctor_name,
        category=order.category,
        test_name=order.test_name,
        instructions=order.instructions,
        priority=order.priority,
        status=order.status,
        cancelled_reason=order.cancelled_reason,
        ordered_at=order.ordered_at,
        updated_at=order.updated_at,
        version_id=order.version_id,
        results=[_result_to_out(res) for res in sorted_results],
    )


@router.post(
    "/encounters/{encounter_id}/investigations",
    status_code=201,
    response_model=InvestigationOrderOut,
    dependencies=[Depends(require(Permission.ENCOUNTER_WRITE))],
)
def create_investigation_order(
    encounter_id: int,
    payload: InvestigationOrderCreate,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> InvestigationOrderOut:
    """Create an investigation order for an encounter owned by the calling doctor."""
    doctor_id = _require_doctor(principal)
    enc = get_scoped_or_404(
        session,
        ClinicalEncounter,
        encounter_id,
        principal,
        family=ScopeFamily.CLINICAL_WRITE,
        doctor_id_col=ClinicalEncounter.doctor_id,
    )
    if enc.is_finalised:
        raise ApiError(
            status_code=400,
            code="encounter_finalised",
            message="Cannot order investigations for a finalised clinical encounter.",
        )
    require_active_unmerged_patient(session, enc.patient_id)

    order = InvestigationOrder(
        encounter_id=enc.id,
        patient_id=enc.patient_id,
        doctor_id=doctor_id,
        category=payload.category.value,
        test_name=payload.test_name,
        instructions=payload.instructions,
        priority=payload.priority.value,
        status=InvestigationStatus.ORDERED.value,
    )
    session.add(order)
    session.flush()

    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        action=AuditAction.INVESTIGATION_ORDERED,
        entity_type="investigation_order",
        entity_id=order.id,
        after={
            "encounter_id": order.encounter_id,
            "encounter_code": enc.encounter_code,
            "patient_id": order.patient_id,
            "doctor_id": order.doctor_id,
            "category": order.category,
            "test_name": order.test_name,
            "priority": order.priority,
            "status": order.status,
            "version_id": order.version_id,
        },
    )

    return _order_to_out(
        order,
        encounter_code=enc.encounter_code,
        doctor_name=enc.doctor.name_en if enc.doctor else "",
        results=[],
    )


@router.get(
    "/encounters/{encounter_id}/investigations",
    response_model=list[InvestigationOrderOut],
    dependencies=[Depends(require(Permission.ENCOUNTER_READ))],
)
def list_encounter_investigations(
    encounter_id: int,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> list[InvestigationOrderOut]:
    """List investigation orders and results for an encounter (DWS-04 cross-doctor audited)."""
    _require_doctor(principal)
    enc = get_scoped_or_404(
        session,
        ClinicalEncounter,
        encounter_id,
        principal,
        family=ScopeFamily.CLINICAL_READ,
        doctor_id_col=ClinicalEncounter.doctor_id,
    )

    rows = session.execute(
        select(InvestigationOrder, Doctor.name_en)
        .outerjoin(Doctor, Doctor.id == InvestigationOrder.doctor_id)
        .options(
            selectinload(InvestigationOrder.results).joinedload(
                InvestigationResult.recorded_by_user
            ),
            selectinload(InvestigationOrder.results).joinedload(InvestigationResult.document),
        )
        .where(InvestigationOrder.encounter_id == enc.id)
        .order_by(InvestigationOrder.ordered_at.desc(), InvestigationOrder.id.desc())
    ).all()

    return [
        _order_to_out(order, encounter_code=enc.encounter_code, doctor_name=doctor_name or "")
        for order, doctor_name in rows
    ]


@router.get(
    "/patients/{patient_id}/investigations",
    response_model=list[InvestigationOrderOut],
    dependencies=[Depends(require(Permission.ENCOUNTER_READ))],
)
def list_patient_investigations(
    patient_id: int,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> list[InvestigationOrderOut]:
    """List consolidated investigation orders and results for a patient (with merged aliases)."""
    _require_doctor(principal)

    patient = session.get(Patient, patient_id)
    if patient is None:
        raise ApiError(
            status_code=404,
            code="patient_not_found",
            message=f"Patient #{patient_id} not found",
        )

    patient_ids = effective_patient_ids(session, patient_id)
    rows = session.execute(
        select(InvestigationOrder, ClinicalEncounter.encounter_code, Doctor.name_en)
        .join(ClinicalEncounter, ClinicalEncounter.id == InvestigationOrder.encounter_id)
        .outerjoin(Doctor, Doctor.id == InvestigationOrder.doctor_id)
        .options(
            selectinload(InvestigationOrder.results).joinedload(
                InvestigationResult.recorded_by_user
            ),
            selectinload(InvestigationOrder.results).joinedload(InvestigationResult.document),
        )
        .where(
            InvestigationOrder.patient_id.in_(patient_ids),
            row_scope(principal, ScopeFamily.CLINICAL_READ, InvestigationOrder.doctor_id),
        )
        .order_by(InvestigationOrder.ordered_at.desc(), InvestigationOrder.id.desc())
    ).all()

    orders = [row[0] for row in rows]
    audit_cross_doctor_list_read(
        session, principal, patient_id, "patient_investigations_list", orders
    )

    return [
        _order_to_out(order, encounter_code=encounter_code, doctor_name=doctor_name or "")
        for order, encounter_code, doctor_name in rows
    ]


@router.patch(
    "/investigations/{order_id}/status",
    response_model=InvestigationOrderOut,
    dependencies=[Depends(require(Permission.ENCOUNTER_WRITE))],
)
def update_investigation_status(
    order_id: int,
    payload: InvestigationStatusUpdate,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> InvestigationOrderOut:
    """Advance or cancel an investigation order owned by the calling doctor."""
    _require_doctor(principal)
    order = get_scoped_or_404(
        session,
        InvestigationOrder,
        order_id,
        principal,
        family=ScopeFamily.CLINICAL_WRITE,
        doctor_id_col=InvestigationOrder.doctor_id,
    )
    require_version(order, payload.version_id, label="investigation_order")

    current_status = InvestigationStatus(order.status)
    target_status = payload.status
    if target_status not in _ALLOWED_STATUS_TRANSITIONS[current_status]:
        raise ApiError(
            status_code=422,
            code="invalid_status_transition",
            message=(
                f"Cannot transition investigation order from {current_status.value} "
                f"to {target_status.value}."
            ),
        )

    reason: str | None = None
    if target_status == InvestigationStatus.CANCELLED:
        reason = (payload.cancelled_reason or "").strip()
        if len(reason) < 3:
            raise ApiError(
                status_code=422,
                code="cancelled_reason_required",
                message="A cancellation reason of at least 3 characters is required.",
            )

    before_state = {
        "status": order.status,
        "cancelled_reason": order.cancelled_reason,
        "version_id": order.version_id,
    }

    order.status = target_status.value
    if target_status == InvestigationStatus.CANCELLED:
        order.cancelled_reason = reason
    order.updated_at = clock.utcnow()
    session.flush()

    after_state = {
        "status": order.status,
        "cancelled_reason": order.cancelled_reason,
        "version_id": order.version_id,
    }

    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        action=AuditAction.INVESTIGATION_UPDATED,
        entity_type="investigation_order",
        entity_id=order.id,
        before=before_state,
        after=after_state,
        reason=order.cancelled_reason,
    )

    encounter_code = (
        session.scalar(
            select(ClinicalEncounter.encounter_code).where(
                ClinicalEncounter.id == order.encounter_id
            )
        )
        or ""
    )
    doctor_name = (
        session.scalar(select(Doctor.name_en).where(Doctor.id == order.doctor_id)) or ""
    )
    results = list(
        session.scalars(
            select(InvestigationResult)
            .options(
                joinedload(InvestigationResult.recorded_by_user),
                joinedload(InvestigationResult.document),
            )
            .where(InvestigationResult.order_id == order.id)
            .order_by(InvestigationResult.reported_at.desc(), InvestigationResult.id.desc())
        ).all()
    )

    return _order_to_out(
        order,
        encounter_code=encounter_code,
        doctor_name=doctor_name,
        results=results,
    )


@router.post(
    "/investigations/{order_id}/results",
    status_code=201,
    response_model=InvestigationResultOut,
    dependencies=[Depends(require(Permission.ENCOUNTER_WRITE))],
)
def record_investigation_result(
    order_id: int,
    payload: InvestigationResultCreate,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> InvestigationResultOut:
    """Record an append-only result and atomically mark the investigation order COMPLETED."""
    _require_doctor(principal)
    order = get_scoped_or_404(
        session,
        InvestigationOrder,
        order_id,
        principal,
        family=ScopeFamily.CLINICAL_WRITE,
        doctor_id_col=InvestigationOrder.doctor_id,
    )

    if order.status == InvestigationStatus.CANCELLED.value:
        raise ApiError(
            status_code=422,
            code="order_cancelled",
            message="Cannot record results for a cancelled investigation order.",
        )

    linked_doc: PatientDocument | None = None
    if payload.document_id is not None:
        linked_doc = session.get(PatientDocument, payload.document_id)
        if linked_doc is None:
            raise ApiError(
                status_code=404,
                code="document_not_found",
                message=f"Document #{payload.document_id} not found.",
            )
        allowed_patient_ids = effective_patient_ids(session, order.patient_id)
        if linked_doc.patient_id not in allowed_patient_ids:
            raise ApiError(
                status_code=422,
                code="document_patient_mismatch",
                message="Linked document does not belong to this patient.",
            )
        if linked_doc.is_archived:
            raise ApiError(
                status_code=422,
                code="document_archived",
                message="Cannot link an archived document to an investigation result.",
            )

    reported_at = payload.reported_at
    if reported_at is None:
        reported_at = clock.utcnow()
    elif reported_at.tzinfo is None:
        reported_at = reported_at.replace(tzinfo=UTC)

    previous_status = order.status
    result = InvestigationResult(
        order_id=order.id,
        patient_id=order.patient_id,
        document_id=linked_doc.id if linked_doc is not None else None,
        summary_text=payload.summary_text,
        result_value=payload.result_value,
        unit=payload.unit,
        reference_range=payload.reference_range,
        is_abnormal=payload.is_abnormal,
        reported_at=reported_at,
        recorded_by_user_id=principal.user_id,
    )
    session.add(result)

    if order.status != InvestigationStatus.COMPLETED.value:
        order.status = InvestigationStatus.COMPLETED.value
        order.updated_at = clock.utcnow()

    session.flush()

    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        action=AuditAction.INVESTIGATION_RESULT_RECORDED,
        entity_type="investigation_result",
        entity_id=result.id,
        after={
            "order_id": order.id,
            "patient_id": order.patient_id,
            "document_id": result.document_id,
            "order_status_before": previous_status,
            "order_status_after": order.status,
            "result_value": result.result_value,
            "unit": result.unit,
            "reference_range": result.reference_range,
            "is_abnormal": result.is_abnormal,
            "reported_at": result.reported_at.isoformat(),
            "recorded_by_user_id": result.recorded_by_user_id,
        },
    )

    return _result_to_out(
        result,
        recorded_by_username=principal.username,
        document_title=linked_doc.title if linked_doc is not None else None,
    )
