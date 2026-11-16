"""Patient duplicate detection and non-destructive alias-pointer merge service (Phase 23)."""

from difflib import SequenceMatcher
from typing import Any

from fastapi import Request
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from kalyan_api.clock import utcnow
from kalyan_api.core.errors import ApiError
from kalyan_api.core.principal import Principal, build_audit_context
from kalyan_api.models import Patient, Visit
from kalyan_api.schemas.patients import (
    DuplicateCandidatePair,
    PatientMergeRequest,
    PatientMergeResult,
    PatientOut,
)
from kalyan_api.services import audit_service
from kalyan_api.services.audit_service import AuditAction

ALLOWED_OVERRIDE_FIELDS = frozenset(
    {
        "full_name",
        "guardian_name",
        "gender",
        "dob",
        "age_years",
        "mobile",
        "address",
        "district",
        "state",
        "emergency_contact",
        "allergies",
        "notes",
    }
)


def normalize_name(name: str) -> str:
    """Normalize a person's name for comparison (lowercased, collapsed whitespace)."""
    return " ".join(name.strip().lower().split())


def compute_name_similarity(name1: str, name2: str) -> float:
    """Compute string similarity ratio between two normalized names."""
    n1 = normalize_name(name1)
    n2 = normalize_name(name2)
    if n1 == n2:
        return 1.0
    return round(SequenceMatcher(None, n1, n2).ratio(), 3)


def check_open_visit(session: Session, patient_id: int) -> tuple[bool, str | None]:
    """Check if a patient has an active unclosed visit (open visit guard)."""
    stmt = (
        select(Visit)
        .where(Visit.patient_id == patient_id, Visit.closed_at.is_(None))
        .order_by(Visit.created_at.desc())
    )
    open_visit = session.execute(stmt).scalars().first()
    if open_visit:
        return True, f"Open visit #{open_visit.id} (started {open_visit.created_at.isoformat()})"
    return False, None


def get_patient_visit_count(session: Session, patient_id: int) -> int:
    """Count total visits recorded for a patient."""
    count = session.execute(
        select(func.count(Visit.id)).where(Visit.patient_id == patient_id)
    ).scalar_one()
    return int(count)


def find_duplicate_candidates(session: Session, limit: int = 50) -> list[DuplicateCandidatePair]:
    """Find pairs of active patients sharing the same mobile and similar full names."""
    # 1. Find mobile numbers associated with multiple active unmerged patients
    mobile_subq = (
        select(Patient.mobile)
        .where(
            Patient.is_active.is_(True),
            Patient.merged_into_id.is_(None),
            Patient.is_archived.is_(False),
            Patient.mobile.is_not(None),
            func.length(Patient.mobile) >= 10,
        )
        .group_by(Patient.mobile)
        .having(func.count(Patient.id) > 1)
        .subquery()
    )

    stmt = (
        select(Patient)
        .where(
            Patient.mobile.in_(select(mobile_subq.c.mobile)),
            Patient.is_active.is_(True),
            Patient.merged_into_id.is_(None),
            Patient.is_archived.is_(False),
        )
        .order_by(Patient.mobile, Patient.created_at.asc(), Patient.id.asc())
    )
    patients = session.execute(stmt).scalars().all()

    # Group by mobile
    by_mobile: dict[str, list[Patient]] = {}
    for p in patients:
        by_mobile.setdefault(p.mobile, []).append(p)

    pairs: list[DuplicateCandidatePair] = []
    for mobile, group in by_mobile.items():
        if len(group) < 2:
            continue
        # Compare first (oldest, master candidate) with subsequent records
        primary = group[0]
        for candidate in group[1:]:
            sim = compute_name_similarity(primary.full_name, candidate.full_name)
            match_reason = "Exact mobile & name match" if sim >= 0.95 else "Exact mobile match with similar name"
            
            p_has_open, p_open_desc = check_open_visit(session, primary.id)
            c_has_open, c_open_desc = check_open_visit(session, candidate.id)
            has_open = p_has_open or c_has_open
            open_desc = p_open_desc or c_open_desc

            p_visits = get_patient_visit_count(session, primary.id)
            c_visits = get_patient_visit_count(session, candidate.id)

            pairs.append(
                DuplicateCandidatePair(
                    master=PatientOut.model_validate(primary),
                    duplicate=PatientOut.model_validate(candidate),
                    similarity_score=sim,
                    match_reason=match_reason,
                    master_visit_count=p_visits,
                    duplicate_visit_count=c_visits,
                    has_open_visit=has_open,
                    open_visit_details=open_desc,
                )
            )
            if len(pairs) >= limit:
                return pairs

    return pairs


def merge_patients(
    session: Session,
    principal: Principal,
    request: Request,
    payload: PatientMergeRequest,
) -> PatientMergeResult:
    """Execute a non-destructive alias-pointer merge of secondary patient into master patient."""
    if payload.master_patient_id == payload.secondary_patient_id:
        raise ApiError(
            status_code=400,
            code="invalid_merge_target",
            message="Cannot merge a patient record into itself.",
        )

    # 1. Row-level locks in deterministic ID order to prevent deadlocks
    first_id = min(payload.master_patient_id, payload.secondary_patient_id)
    second_id = max(payload.master_patient_id, payload.secondary_patient_id)

    p1 = session.execute(select(Patient).where(Patient.id == first_id).with_for_update()).scalar_one_or_none()
    p2 = session.execute(select(Patient).where(Patient.id == second_id).with_for_update()).scalar_one_or_none()

    if not p1 or not p2:
        raise ApiError(status_code=404, code="patient_not_found", message="One or both patients not found.")

    master = p1 if p1.id == payload.master_patient_id else p2
    secondary = p2 if p1.id == payload.master_patient_id else p1

    if not master.is_active or master.merged_into_id is not None:
        raise ApiError(
            status_code=400,
            code="master_inactive_or_merged",
            message=f"Master patient #{master.id} ({master.urn}) is deactivated or already merged into #{master.merged_into_id}.",
        )

    if not secondary.is_active or secondary.merged_into_id is not None:
        raise ApiError(
            status_code=400,
            code="secondary_already_merged",
            message=f"Secondary patient #{secondary.id} ({secondary.urn}) is already inactive or merged.",
        )

    # 2. Open visit safety guard (Fail-Closed)
    m_open, m_desc = check_open_visit(session, master.id)
    if m_open:
        raise ApiError(
            status_code=400,
            code="open_visit_conflict",
            message=f"Cannot merge patient files: Master patient #{master.id} has an open visit ({m_desc}). Please close or complete the visit first.",
        )

    s_open, s_desc = check_open_visit(session, secondary.id)
    if s_open:
        raise ApiError(
            status_code=400,
            code="open_visit_conflict",
            message=f"Cannot merge patient files: Secondary patient #{secondary.id} has an open visit ({s_desc}). Please close or complete the visit first.",
        )

    # 3. Apply optional demographic overrides to master record
    if payload.demographic_overrides:
        for field, value in payload.demographic_overrides.items():
            if field in ALLOWED_OVERRIDE_FIELDS and value is not None:
                setattr(master, field, value)

    # 4. Deactivate secondary patient and record alias pointer
    now = utcnow()
    secondary.is_active = False
    secondary.merged_into_id = master.id
    secondary.merged_at = now
    secondary.merged_by_user_id = principal.user_id
    secondary.merge_reason = payload.reason.strip()

    session.flush()

    # 5. Emit PATIENT_MERGED audit event
    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        action=AuditAction.PATIENT_MERGED,
        entity_type="PATIENT",
        entity_id=str(secondary.id),
        before={"is_active": True, "merged_into_id": None},
        after={
            "is_active": False,
            "merged_into_id": master.id,
            "master_urn": master.urn,
            "secondary_urn": secondary.urn,
            "overrides": payload.demographic_overrides or {},
        },
        reason=payload.reason.strip(),
    )

    return PatientMergeResult(
        master=PatientOut.model_validate(master),
        secondary=PatientOut.model_validate(secondary),
        message=f"Successfully merged patient {secondary.urn} into {master.urn}.",
    )


def unmerge_patient(
    session: Session,
    principal: Principal,
    request: Request,
    patient_id: int,
    reason: str,
) -> PatientOut:
    """Reverse a prior alias-pointer merge, restoring the secondary patient to active status."""
    patient = session.execute(
        select(Patient).where(Patient.id == patient_id).with_for_update()
    ).scalar_one_or_none()

    if not patient:
        raise ApiError(status_code=404, code="patient_not_found", message=f"Patient #{patient_id} not found.")

    if patient.merged_into_id is None:
        raise ApiError(
            status_code=400,
            code="patient_not_merged",
            message=f"Patient #{patient_id} ({patient.urn}) is not a merged record.",
        )

    previous_master_id = patient.merged_into_id
    previous_reason = patient.merge_reason

    # Reactivate
    patient.merged_into_id = None
    patient.merged_at = None
    patient.merged_by_user_id = None
    patient.merge_reason = None
    patient.is_active = True

    session.flush()

    # Emit PATIENT_UNMERGED audit event
    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        action=AuditAction.PATIENT_UNMERGED,
        entity_type="PATIENT",
        entity_id=str(patient.id),
        before={"merged_into_id": previous_master_id, "is_active": False},
        after={
            "merged_into_id": None,
            "is_active": True,
            "previous_merge_reason": previous_reason,
        },
        reason=reason.strip(),
    )

    return PatientOut.model_validate(patient)
