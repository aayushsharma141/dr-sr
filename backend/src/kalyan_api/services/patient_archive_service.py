"""Patient archival and data governance service (Phase 23)."""

from collections import defaultdict
from datetime import date
from typing import Any

from fastapi import Request
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from kalyan_api.clock import ist_today, utcnow
from kalyan_api.core.errors import ApiError
from kalyan_api.core.principal import Principal, build_audit_context
from kalyan_api.models import Patient, TreatmentPlan, TreatmentPlanStatus, Visit, VisitStatus
from kalyan_api.schemas.patients import (
    ArchivalCandidateItem,
    BulkArchiveRequest,
    BulkArchiveResult,
    PatientOut,
)
from kalyan_api.services import audit_service, billing_service
from kalyan_api.services.audit_service import AuditAction
from kalyan_api.services.code_sequence_service import effective_patient_ids


def _package_dues_by_owner(
    session: Session, owner_by_patient_id: dict[int, int]
) -> dict[int, int]:
    """Sum unpaid ACTIVE/COMPLETED treatment package balances in paise, rolled up by owner ID."""
    if not owner_by_patient_id:
        return {}
    plans = session.execute(
        select(
            TreatmentPlan.id,
            TreatmentPlan.patient_id,
            TreatmentPlan.agreed_price_paise,
        ).where(
            TreatmentPlan.patient_id.in_(list(owner_by_patient_id.keys())),
            TreatmentPlan.status.in_(
                [TreatmentPlanStatus.ACTIVE.value, TreatmentPlanStatus.COMPLETED.value]
            ),
        )
    ).all()
    if not plans:
        return {}
    paid_by_plan = billing_service.net_paid_by_treatment_plans(
        session, [plan_id for plan_id, _, _ in plans]
    )
    dues: dict[int, int] = defaultdict(int)
    for plan_id, pat_id, agreed_price in plans:
        balance = max(0, int(agreed_price) - paid_by_plan.get(plan_id, 0))
        if balance > 0:
            dues[owner_by_patient_id[pat_id]] += balance
    return dues


def _get_patient_dues(session: Session, patient_id: int) -> int:
    """Calculate total outstanding unpaid balance (visits + treatment packages) in paise."""
    visit_dues = sum(
        d.due_paise for d in billing_service.patient_previous_dues(session, patient_id)
    )
    owner_map = {pid: patient_id for pid in effective_patient_ids(session, patient_id)}
    package_dues = _package_dues_by_owner(session, owner_map).get(patient_id, 0)
    return visit_dues + package_dues


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

    # Inactivity condition pushed into SQL:
    # 1. No visits after cutoff_date
    has_recent_visit = select(Visit.id).where(
        Visit.patient_id == Patient.id,
        Visit.visit_date > cutoff_date,
    ).exists()
    has_any_visit = select(Visit.id).where(Visit.patient_id == Patient.id).exists()

    stmt = select(Patient).where(
        Patient.is_active.is_(True),
        Patient.is_archived.is_(False),
        Patient.merged_into_id.is_(None),
        ~has_recent_visit,
        or_(has_any_visit, func.date(Patient.created_at) <= cutoff_date),
    )

    if zero_visits_only:
        stmt = stmt.where(~has_any_visit, func.date(Patient.created_at) <= cutoff_date)

    if district and district.strip():
        stmt = stmt.where(Patient.district.ilike(f"%{district.strip()}%"))

    candidates = session.scalars(stmt.order_by(Patient.created_at.asc()).limit(limit)).all()

    if not candidates:
        return []

    candidate_ids = [p.id for p in candidates]
    owner_by_patient_id: dict[int, int] = {pid: pid for pid in candidate_ids}
    merged_rows = session.execute(
        select(Patient.id, Patient.merged_into_id).where(Patient.merged_into_id.in_(candidate_ids))
    ).all()
    for child_id, master_id in merged_rows:
        if master_id is not None:
            owner_by_patient_id[child_id] = master_id

    # Batch load all visits for candidate patients and their merged aliases
    all_visits = session.scalars(
        select(Visit)
        .where(Visit.patient_id.in_(list(owner_by_patient_id.keys())))
        .order_by(Visit.visit_date.desc())
    ).all()

    visits_by_patient: dict[int, list[Visit]] = defaultdict(list)
    for v in all_visits:
        visits_by_patient[owner_by_patient_id[v.patient_id]].append(v)

    # Batch dues calculations across all visits and ACTIVE/COMPLETED treatment packages
    all_visit_ids = [v.id for v in all_visits]
    visit_totals_map = billing_service.visit_totals(session, all_visit_ids) if all_visit_ids else {}

    dues_by_patient: dict[int, int] = defaultdict(int)
    for v in all_visits:
        totals = visit_totals_map.get(v.id)
        if totals and totals.due_paise > 0:
            dues_by_patient[owner_by_patient_id[v.patient_id]] += totals.due_paise

    for owner_id, pkg_due in _package_dues_by_owner(session, owner_by_patient_id).items():
        dues_by_patient[owner_id] += pkg_due

    results: list[ArchivalCandidateItem] = []
    for p in candidates:
        p_visits = visits_by_patient.get(p.id, [])
        visit_count = len(p_visits)

        last_activity_date: date | None = None
        if p_visits:
            last_activity_date = p_visits[0].visit_date
        elif p.created_at:
            last_activity_date = p.created_at.date()

        total_dues = dues_by_patient.get(p.id, 0)
        has_open = any(v.status == VisitStatus.OPEN.value for v in p_visits)

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
