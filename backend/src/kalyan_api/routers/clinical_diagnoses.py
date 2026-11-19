"""Structured encounter diagnoses and longitudinal patient conditions endpoints (T2.2).

Guarantees:
- D-04: Strictly DOCTOR-only via ENCOUNTER_READ / ENCOUNTER_WRITE permissions.
- D-03: Mutations scoped to the owning doctor via ScopeFamily.CLINICAL_WRITE (404 on mismatch).
- DWS-04: Cross-doctor reads permitted for doctors and audited (CROSS_DOCTOR_CLINICAL_READ).
- Downward alias consolidation on patient condition reads; archived/merged reads allowed,
  archived/merged writes rejected (409).
- Finalised encounters reject diagnosis mutations (400 encounter_finalised).
"""

from typing import Any

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import case, select

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
    ConditionStatus,
    DiagnosisType,
    Doctor,
    EncounterDiagnosis,
    Patient,
    PatientCondition,
)
from kalyan_api.schemas.clinical_diagnoses import (
    EncounterDiagnosisCreate,
    EncounterDiagnosisOut,
    EncounterDiagnosisUpdate,
    PatientConditionCreate,
    PatientConditionOut,
    PatientConditionUpdate,
)
from kalyan_api.services import audit_service
from kalyan_api.services.audit_service import AuditAction
from kalyan_api.services.code_sequence_service import (
    effective_patient_ids,
    require_active_unmerged_patient,
)

router = APIRouter(tags=["clinical-diagnoses"])


def _require_doctor(principal: Principal) -> int:
    """Ensure the authenticated principal is a DOCTOR with a linked doctor profile."""
    if principal.role != Role.DOCTOR or principal.doctor_id is None:
        raise ApiError(status_code=403, code="doctor_only", message="Doctor access required.")
    return principal.doctor_id


def _condition_snapshot(condition: PatientCondition) -> dict[str, Any]:
    """Build JSON-safe audit snapshot for a PatientCondition row."""
    return {
        "patient_id": condition.patient_id,
        "doctor_id": condition.doctor_id,
        "condition_name": condition.condition_name,
        "icd10_code": condition.icd10_code,
        "status": condition.status,
        "onset_date": condition.onset_date.isoformat() if condition.onset_date else None,
        "resolved_date": condition.resolved_date.isoformat() if condition.resolved_date else None,
        "notes": condition.notes,
        "version_id": condition.version_id,
    }


def _diagnosis_snapshot(diag: EncounterDiagnosis) -> dict[str, Any]:
    """Build JSON-safe audit snapshot for an EncounterDiagnosis row."""
    return {
        "encounter_id": diag.encounter_id,
        "patient_id": diag.patient_id,
        "doctor_id": diag.doctor_id,
        "diagnosis_name": diag.diagnosis_name,
        "icd10_code": diag.icd10_code,
        "diagnosis_type": diag.diagnosis_type,
        "status": diag.status,
        "onset_date": diag.onset_date.isoformat() if diag.onset_date else None,
        "notes": diag.notes,
        "patient_condition_id": diag.patient_condition_id,
    }


def _condition_to_out(
    condition: PatientCondition,
    doctor_name: str | None,
) -> PatientConditionOut:
    """Serialize a PatientCondition row with resolved doctor_name."""
    return PatientConditionOut(
        id=condition.id,
        patient_id=condition.patient_id,
        doctor_id=condition.doctor_id,
        doctor_name=doctor_name,
        condition_name=condition.condition_name,
        icd10_code=condition.icd10_code,
        status=condition.status,
        onset_date=condition.onset_date,
        resolved_date=condition.resolved_date,
        notes=condition.notes,
        created_at=condition.created_at,
        updated_at=condition.updated_at,
        version_id=condition.version_id,
    )


def _diagnosis_to_out(
    diag: EncounterDiagnosis,
    *,
    doctor_name: str | None,
    encounter_code: str | None,
) -> EncounterDiagnosisOut:
    """Serialize an EncounterDiagnosis row with resolved doctor_name and encounter_code."""
    return EncounterDiagnosisOut(
        id=diag.id,
        encounter_id=diag.encounter_id,
        encounter_code=encounter_code,
        patient_id=diag.patient_id,
        doctor_id=diag.doctor_id,
        doctor_name=doctor_name,
        diagnosis_name=diag.diagnosis_name,
        icd10_code=diag.icd10_code,
        diagnosis_type=diag.diagnosis_type,
        status=diag.status,
        onset_date=diag.onset_date,
        notes=diag.notes,
        patient_condition_id=diag.patient_condition_id,
        created_at=diag.created_at,
        updated_at=diag.updated_at,
    )


def _validate_condition_for_patient(
    session: SessionDep,
    condition_id: int,
    patient_id: int,
) -> PatientCondition:
    """Ensure a referenced PatientCondition exists and belongs to the encounter's patient."""
    condition = session.get(PatientCondition, condition_id)
    if condition is None:
        raise ApiError(
            status_code=404,
            code="condition_not_found",
            message=f"Patient condition #{condition_id} not found.",
        )
    if condition.patient_id != patient_id:
        raise ApiError(
            status_code=422,
            code="condition_patient_mismatch",
            message="Patient condition does not belong to this encounter's patient.",
        )
    return condition


def _doctor_name(session: SessionDep, doctor_id: int) -> str | None:
    """Resolve doctor English display name by ID."""
    doctor = session.get(Doctor, doctor_id)
    return doctor.name_en if doctor is not None else None


@router.get(
    "/patients/{patient_id}/conditions",
    response_model=list[PatientConditionOut],
    dependencies=[Depends(require(Permission.ENCOUNTER_READ))],
)
def list_patient_conditions(
    patient_id: int,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> list[PatientConditionOut]:
    """List longitudinal conditions for a patient (DOCTOR only, D-04, DWS-04)."""
    _require_doctor(principal)

    patient = session.get(Patient, patient_id)
    if patient is None:
        raise ApiError(
            status_code=404,
            code="patient_not_found",
            message=f"Patient #{patient_id} not found.",
        )

    patient_ids = effective_patient_ids(session, patient_id)
    status_order = case(
        (PatientCondition.status == ConditionStatus.ACTIVE.value, 0),
        (PatientCondition.status == ConditionStatus.INACTIVE.value, 1),
        else_=2,
    )
    rows = session.execute(
        select(PatientCondition, Doctor.name_en)
        .outerjoin(Doctor, Doctor.id == PatientCondition.doctor_id)
        .where(
            PatientCondition.patient_id.in_(patient_ids),
            row_scope(principal, ScopeFamily.CLINICAL_READ, PatientCondition.doctor_id),
        )
        .order_by(status_order, PatientCondition.created_at.desc(), PatientCondition.id.desc())
    ).all()

    conditions = [row[0] for row in rows]
    audit_cross_doctor_list_read(
        session, principal, patient_id, "patient_conditions_list", conditions
    )

    return [_condition_to_out(condition, doc_name) for condition, doc_name in rows]


@router.post(
    "/patients/{patient_id}/conditions",
    status_code=201,
    response_model=PatientConditionOut,
    dependencies=[Depends(require(Permission.ENCOUNTER_WRITE))],
)
def create_patient_condition(
    patient_id: int,
    payload: PatientConditionCreate,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> PatientConditionOut:
    """Record a longitudinal condition for an active, unmerged patient (DOCTOR only)."""
    doctor_id = _require_doctor(principal)
    require_active_unmerged_patient(session, patient_id)

    condition = PatientCondition(
        patient_id=patient_id,
        doctor_id=doctor_id,
        condition_name=payload.condition_name,
        icd10_code=payload.icd10_code,
        status=payload.status.value,
        onset_date=payload.onset_date,
        resolved_date=payload.resolved_date,
        notes=payload.notes,
    )
    session.add(condition)
    session.flush()

    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        action=AuditAction.CONDITION_RECORDED,
        entity_type="PATIENT_CONDITION",
        entity_id=str(condition.id),
        after=_condition_snapshot(condition),
    )

    return _condition_to_out(condition, _doctor_name(session, doctor_id))


@router.patch(
    "/patients/{patient_id}/conditions/{condition_id}",
    response_model=PatientConditionOut,
    dependencies=[Depends(require(Permission.ENCOUNTER_WRITE))],
)
def update_patient_condition(
    patient_id: int,
    condition_id: int,
    payload: PatientConditionUpdate,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> PatientConditionOut:
    """Update an owned longitudinal condition with optimistic locking (DOCTOR only)."""
    _require_doctor(principal)

    condition: PatientCondition = get_scoped_or_404(
        session,
        PatientCondition,
        condition_id,
        principal,
        family=ScopeFamily.CLINICAL_WRITE,
        doctor_id_col=PatientCondition.doctor_id,
    )
    if condition.patient_id not in effective_patient_ids(session, patient_id):
        raise ApiError(status_code=404, code="not_found", message="Resource not found")

    require_active_unmerged_patient(session, patient_id)
    require_version(condition, payload.version_id, label="patient_condition")

    before_snap = _condition_snapshot(condition)

    if payload.condition_name is not None:
        condition.condition_name = payload.condition_name
    if "icd10_code" in payload.model_fields_set:
        condition.icd10_code = payload.icd10_code
    if payload.status is not None:
        condition.status = payload.status.value
    if "onset_date" in payload.model_fields_set:
        condition.onset_date = payload.onset_date
    if "resolved_date" in payload.model_fields_set:
        condition.resolved_date = payload.resolved_date
    if "notes" in payload.model_fields_set:
        condition.notes = payload.notes

    session.flush()
    after_snap = _condition_snapshot(condition)

    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        action=AuditAction.CONDITION_UPDATED,
        entity_type="PATIENT_CONDITION",
        entity_id=str(condition.id),
        before=before_snap,
        after=after_snap,
    )

    return _condition_to_out(condition, _doctor_name(session, condition.doctor_id))


@router.get(
    "/encounters/{encounter_id}/diagnoses",
    response_model=list[EncounterDiagnosisOut],
    dependencies=[Depends(require(Permission.ENCOUNTER_READ))],
)
def list_encounter_diagnoses(
    encounter_id: int,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> list[EncounterDiagnosisOut]:
    """List structured diagnoses recorded on an encounter (DOCTOR only, DWS-04)."""
    _require_doctor(principal)

    enc: ClinicalEncounter = get_scoped_or_404(
        session,
        ClinicalEncounter,
        encounter_id,
        principal,
        family=ScopeFamily.CLINICAL_READ,
        doctor_id_col=ClinicalEncounter.doctor_id,
    )

    type_order = case(
        (EncounterDiagnosis.diagnosis_type == DiagnosisType.PRIMARY.value, 0),
        (EncounterDiagnosis.diagnosis_type == DiagnosisType.SECONDARY.value, 1),
        else_=2,
    )
    rows = session.execute(
        select(EncounterDiagnosis, Doctor.name_en)
        .outerjoin(Doctor, Doctor.id == EncounterDiagnosis.doctor_id)
        .where(EncounterDiagnosis.encounter_id == enc.id)
        .order_by(type_order, EncounterDiagnosis.created_at.asc(), EncounterDiagnosis.id.asc())
    ).all()

    return [
        _diagnosis_to_out(diag, doctor_name=doc_name, encounter_code=enc.encounter_code)
        for diag, doc_name in rows
    ]


@router.post(
    "/encounters/{encounter_id}/diagnoses",
    status_code=201,
    response_model=EncounterDiagnosisOut,
    dependencies=[Depends(require(Permission.ENCOUNTER_WRITE))],
)
def create_encounter_diagnosis(
    encounter_id: int,
    payload: EncounterDiagnosisCreate,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> EncounterDiagnosisOut:
    """Record a structured diagnosis on an owned, unfinalised encounter (DOCTOR only)."""
    doctor_id = _require_doctor(principal)

    enc: ClinicalEncounter = get_scoped_or_404(
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
            message="Cannot add diagnoses to a finalised clinical encounter.",
        )
    require_active_unmerged_patient(session, enc.patient_id)

    ctx = build_audit_context(request, principal)
    condition_id: int | None = payload.patient_condition_id

    if payload.patient_condition_id is not None:
        _validate_condition_for_patient(session, payload.patient_condition_id, enc.patient_id)
    elif payload.promote_to_condition:
        promoted = PatientCondition(
            patient_id=enc.patient_id,
            doctor_id=doctor_id,
            condition_name=payload.diagnosis_name,
            icd10_code=payload.icd10_code,
            status=payload.status.value,
            onset_date=payload.onset_date,
            notes=payload.notes,
        )
        session.add(promoted)
        session.flush()
        condition_id = promoted.id
        audit_service.record(
            session,
            ctx,
            action=AuditAction.CONDITION_RECORDED,
            entity_type="PATIENT_CONDITION",
            entity_id=str(promoted.id),
            after={
                **_condition_snapshot(promoted),
                "promoted_from_encounter_id": enc.id,
            },
        )

    diag = EncounterDiagnosis(
        encounter_id=enc.id,
        patient_id=enc.patient_id,
        doctor_id=doctor_id,
        diagnosis_name=payload.diagnosis_name,
        icd10_code=payload.icd10_code,
        diagnosis_type=payload.diagnosis_type.value,
        status=payload.status.value,
        onset_date=payload.onset_date,
        notes=payload.notes,
        patient_condition_id=condition_id,
    )
    session.add(diag)
    session.flush()

    audit_service.record(
        session,
        ctx,
        action=AuditAction.DIAGNOSIS_RECORDED,
        entity_type="ENCOUNTER_DIAGNOSIS",
        entity_id=str(diag.id),
        after=_diagnosis_snapshot(diag),
    )

    return _diagnosis_to_out(
        diag,
        doctor_name=_doctor_name(session, doctor_id),
        encounter_code=enc.encounter_code,
    )


@router.patch(
    "/encounters/{encounter_id}/diagnoses/{diagnosis_id}",
    response_model=EncounterDiagnosisOut,
    dependencies=[Depends(require(Permission.ENCOUNTER_WRITE))],
)
def update_encounter_diagnosis(
    encounter_id: int,
    diagnosis_id: int,
    payload: EncounterDiagnosisUpdate,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> EncounterDiagnosisOut:
    """Update a structured diagnosis on an owned, unfinalised encounter (DOCTOR only)."""
    _require_doctor(principal)

    enc: ClinicalEncounter = get_scoped_or_404(
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
            message="Cannot modify diagnoses on a finalised clinical encounter.",
        )

    diag = session.scalar(
        select(EncounterDiagnosis).where(
            EncounterDiagnosis.id == diagnosis_id,
            EncounterDiagnosis.encounter_id == enc.id,
        )
    )
    if diag is None:
        raise ApiError(
            status_code=404,
            code="diagnosis_not_found",
            message=f"Diagnosis #{diagnosis_id} not found for encounter #{encounter_id}.",
        )

    if payload.patient_condition_id is not None:
        _validate_condition_for_patient(session, payload.patient_condition_id, enc.patient_id)

    before_snap = _diagnosis_snapshot(diag)

    if payload.diagnosis_name is not None:
        diag.diagnosis_name = payload.diagnosis_name
    if "icd10_code" in payload.model_fields_set:
        diag.icd10_code = payload.icd10_code
    if payload.diagnosis_type is not None:
        diag.diagnosis_type = payload.diagnosis_type.value
    if payload.status is not None:
        diag.status = payload.status.value
    if "onset_date" in payload.model_fields_set:
        diag.onset_date = payload.onset_date
    if "notes" in payload.model_fields_set:
        diag.notes = payload.notes
    if "patient_condition_id" in payload.model_fields_set:
        diag.patient_condition_id = payload.patient_condition_id

    session.flush()
    after_snap = _diagnosis_snapshot(diag)

    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        action=AuditAction.DIAGNOSIS_UPDATED,
        entity_type="ENCOUNTER_DIAGNOSIS",
        entity_id=str(diag.id),
        before=before_snap,
        after=after_snap,
    )

    return _diagnosis_to_out(
        diag,
        doctor_name=_doctor_name(session, diag.doctor_id),
        encounter_code=enc.encounter_code,
    )


@router.delete(
    "/encounters/{encounter_id}/diagnoses/{diagnosis_id}",
    status_code=204,
    dependencies=[Depends(require(Permission.ENCOUNTER_WRITE))],
)
def delete_encounter_diagnosis(
    encounter_id: int,
    diagnosis_id: int,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> Response:
    """Delete a structured diagnosis from an owned, unfinalised encounter (DOCTOR only)."""
    _require_doctor(principal)

    enc: ClinicalEncounter = get_scoped_or_404(
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
            message="Cannot delete diagnoses on a finalised clinical encounter.",
        )

    diag = session.scalar(
        select(EncounterDiagnosis).where(
            EncounterDiagnosis.id == diagnosis_id,
            EncounterDiagnosis.encounter_id == enc.id,
        )
    )
    if diag is None:
        raise ApiError(
            status_code=404,
            code="diagnosis_not_found",
            message=f"Diagnosis #{diagnosis_id} not found for encounter #{encounter_id}.",
        )

    before_snap = _diagnosis_snapshot(diag)
    diag_id = diag.id
    session.delete(diag)
    session.flush()

    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        action=AuditAction.DIAGNOSIS_UPDATED,
        entity_type="ENCOUNTER_DIAGNOSIS",
        entity_id=str(diag_id),
        before=before_snap,
        after={"deleted": True},
    )

    return Response(status_code=204)
