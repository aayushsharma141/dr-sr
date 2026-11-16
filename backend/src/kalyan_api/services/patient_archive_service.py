"""Patient archival and data governance service (Phase 23)."""

from datetime import date
from typing import Any

from fastapi import Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from kalyan_api.clock import ist_today, utcnow
from kalyan_api.core.errors import ApiError
from kalyan_api.core.principal import Principal, build_audit_context
from kalyan_api.models import Patient, Visit, VisitStatus
from kalyan_api.schemas.patients import (
    ArchivalCandidateItem,
    BulkArchiveRequest,
    BulkArchiveResult,
    PatientOut,
)
from kalyan_api.services import audit_service, billing_service
from kalyan_api.services.audit_service import AuditAction


def _get_patient_dues(session: Session, patient_id: int) -> int:
    """Calculate total outstanding unpaid balance for a patient in paise."""
    dues = billing_service.patient_previous_dues(session, patient_id)
    return sum(d.due_paise for d in dues)


def find_archival_candidates(
    session: Session,
    inactivity_years: int = 3,
    district: str | None = None,
    zero_visits_only: bool = False,
    limit: int = 50,
) -> list[ArchivalCandidateItem]:
    """Identify candidate patient records for soft archival based on inactivity and dues."""
    today = ist_today()
    try:
        cutoff_date = today.replace(year=today.year - inactivity_years)
    except ValueError:
        # Leap year edge case (Feb 29)
        cutoff_date = today.replace(year=today.year - inactivity_years, day=28)

    # Base query: active, unmerged, unarchived patients
    stmt = (
        select(Patient)
        .where(
            Patient.is_active.is_(True),
            Patient.is_archived.is_(False),
            Patient.merged_into_id.is_(None),
        )
    )

    if district and district.strip():
        stmt = stmt.where(Patient.district.ilike(f"%{district.strip()}%"))

    candidates = session.scalars(stmt.order_by(Patient.created_at.asc()).limit(limit * 2)).all()

    results: list[ArchivalCandidateItem] = []

    for p in candidates:
        # Check visits
        visits = session.scalars(
            select(Visit)
            .where(Visit.patient_id == p.id)
            .order_by(Visit.visit_date.desc())
        ).all()
        visit_count = len(visits)

        if zero_visits_only and visit_count > 0:
            continue

        last_activity_date: date | None = None
        if visits:
            last_activity_date = visits[0].visit_date
        elif p.created_at:
            last_activity_date = p.created_at.date()

        # Check inactivity cutoff
        if last_activity_date and last_activity_date > cutoff_date:
            continue

        # Check financial dues
        total_dues = _get_patient_dues(session, p.id)

        # Check for open visits
        has_open = any(v.status == VisitStatus.OPEN.value for v in visits)

        can_archive = True
        blocking_reason = None

        if has_open:
            can_archive = False
            blocking_reason = "Patient has an active open visit"
        elif total_dues > 0:
            can_archive = False
            blocking_reason = f"Patient has outstanding dues of ₹{total_dues / 100:,.2f}"

        results.append(
            ArchivalCandidateItem(
                patient=PatientOut.model_validate(p),
                last_activity_date=last_activity_date,
                visit_count=visit_count,
                total_dues_paise=total_dues,
                can_archive=can_archive,
                blocking_reason=blocking_reason,
            )
        )

        if len(results) >= limit:
            break

    return results


def bulk_archive_patients(
    session: Session,
    principal: Principal,
    request: Request,
    payload: BulkArchiveRequest,
) -> BulkArchiveResult:
    """Administratively archive multiple eligible patient records with hard dues guard."""
    reason = payload.reason.strip()
    archived_count = 0
    skipped_count = 0
    skipped_details: list[dict[str, Any]] = []

    ctx = build_audit_context(request, principal)
    now = utcnow()

    for pid in payload.patient_ids:
        patient = session.scalar(
            select(Patient).where(Patient.id == pid).with_for_update()
        )
        if not patient:
            skipped_count += 1
            skipped_details.append({"patient_id": pid, "reason": "Patient not found"})
            continue

        if patient.is_archived:
            skipped_count += 1
            skipped_details.append({"patient_id": pid, "reason": "Patient already archived"})
            continue

        # Check open visit guard
        open_visit = session.scalar(
            select(Visit.id).where(Visit.patient_id == patient.id, Visit.status == VisitStatus.OPEN.value)
        )
        if open_visit:
            raise ApiError(
                status_code=400,
                code="open_visit_conflict",
                message=f"Cannot archive patient {patient.urn}: patient has an active open visit.",
            )

        # HARD FINANCIAL GUARD: Dues > 0 strictly blocks archival
        total_dues = _get_patient_dues(session, patient.id)
        if total_dues > 0:
            raise ApiError(
                status_code=400,
                code="patient_has_outstanding_dues",
                message=(
                    f"Cannot archive patient {patient.urn}: patient has outstanding dues of "
                    f"₹{total_dues / 100:,.2f}. All financial dues must be settled prior to archival."
                ),
            )

        # Soft archive
        patient.is_archived = True
        patient.archived_at = now
        patient.archived_by_user_id = principal.user_id
        patient.archive_reason = reason

        session.flush()

        audit_service.record(
            session,
            ctx,
            action=AuditAction.PATIENT_ARCHIVED,
            entity_type="PATIENT",
            entity_id=str(patient.id),
            before={"is_archived": False},
            after={"is_archived": True, "archive_reason": reason},
            reason=reason,
        )
        archived_count += 1

    return BulkArchiveResult(
        archived_count=archived_count,
        skipped_count=skipped_count,
        skipped_details=skipped_details,
        message=f"Successfully archived {archived_count} patient record(s).",
    )


def unarchive_patient(
    session: Session,
    principal: Principal,
    request: Request,
    patient_id: int,
    reason: str,
) -> PatientOut:
    """Restore an administratively archived patient record."""
    patient = session.scalar(
        select(Patient).where(Patient.id == patient_id).with_for_update()
    )
    if not patient:
        raise ApiError(status_code=404, code="patient_not_found", message=f"Patient #{patient_id} not found.")

    if not patient.is_archived:
        raise ApiError(
            status_code=400,
            code="patient_not_archived",
            message=f"Patient #{patient_id} is not currently archived.",
        )

    previous_reason = patient.archive_reason

    patient.is_archived = False
    patient.archived_at = None
    patient.archived_by_user_id = None
    patient.archive_reason = None

    session.flush()

    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        action=AuditAction.PATIENT_UNARCHIVED,
        entity_type="PATIENT",
        entity_id=str(patient.id),
        before={"is_archived": True, "archive_reason": previous_reason},
        after={"is_archived": False, "unarchive_reason": reason.strip()},
        reason=reason.strip(),
    )

    return PatientOut.model_validate(patient)
