"""Patient registration, multi-modal search, demographics management,
and photo storage endpoints (PAT-01, PAT-02, PAT-03, PAT-04, PAT-05).
"""

import re
from collections.abc import Sequence
from datetime import date
from email.parser import BytesParser
from email.policy import default
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import FileResponse
from sqlalchemy import case, func, or_, select, union_all
from sqlalchemy.orm import aliased, noload

from kalyan_api.core.errors import ApiError, require_version
from kalyan_api.core.permissions import Permission, Role
from kalyan_api.core.policy import require
from kalyan_api.core.principal import (
    Principal,
    build_audit_context,
    current_principal,
    get_current_settings,
)
from kalyan_api.core.scope import audit_cross_doctor_list_read
from kalyan_api.db.session import SessionDep
from kalyan_api.models import (
    AllergyStatus,
    Appointment,
    BillItem,
    BillItemStatus,
    ConsultationStatus,
    Patient,
    PatientAllergy,
    Payment,
    Refund,
    TreatmentPlan,
    TreatmentPlanStatus,
    User,
    Visit,
)
from kalyan_api.schemas.patients import (
    DuplicateCheckResponse,
    PatientAllergyCreate,
    PatientAllergyOut,
    PatientAllergyUpdate,
    PatientCountResponse,
    PatientCreate,
    PatientOut,
    PatientUpdate,
)
from kalyan_api.services import audit_service, patient_service, photo_service
from kalyan_api.services.audit_service import AuditAction
from kalyan_api.services.code_sequence_service import (
    effective_patient_ids,
    require_active_unmerged_patient,
)

router = APIRouter(prefix="/patients", tags=["patients"])


def _clean_mobile(raw: str) -> str:
    """Normalize mobile to 10 digits (shared with new-patient check-in)."""
    return patient_service.clean_mobile(raw)


async def _extract_photo_bytes(request: Request) -> bytes:
    """Extract raw image bytes from multipart/form-data or binary body."""
    content_type = request.headers.get("content-type", "")
    body = await request.body()
    if not body:
        raise ApiError(status_code=422, code="empty_file", message="Uploaded photo is empty.")

    if content_type.startswith("multipart/form-data"):
        header = f"Content-Type: {content_type}\r\n\r\n".encode("latin1")
        msg = BytesParser(policy=default).parsebytes(header + body)
        for part in msg.iter_parts():
            payload = part.get_payload(decode=True)
            if payload:
                return payload
        raise ApiError(
            status_code=422, code="empty_file", message="Uploaded multipart file is empty."
        )

    return body


@router.post(
    "",
    status_code=201,
    dependencies=[Depends(require(Permission.PATIENT_CREATE))],
    response_model=PatientOut,
)
def register_patient(
    request: Request,
    payload: PatientCreate,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> PatientOut:
    """Register a new patient with 12 canonical demographic fields and atomic URN."""
    patient = patient_service.create_patient(session, payload)

    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        AuditAction.PATIENT_REGISTERED,
        "PATIENT",
        str(patient.id),
        after=patient_service.registration_audit_after(patient),
    )

    return PatientOut.model_validate(patient)


@router.get(
    "/check-duplicate",
    dependencies=[Depends(require(Permission.PATIENT_READ))],
    response_model=DuplicateCheckResponse,
)
def check_duplicate_patient(
    session: SessionDep,
    name: str = Query(..., min_length=2),
    mobile: str = Query(..., min_length=5),
) -> DuplicateCheckResponse:
    """Non-blocking duplicate warning matching normalized name and mobile."""
    norm_name = " ".join(name.strip().lower().split())
    clean_phone = _clean_mobile(mobile)

    stmt = select(Patient).where(
        func.lower(func.trim(Patient.full_name)) == norm_name,
        Patient.mobile.like(f"%{clean_phone}"),
        Patient.is_active.is_(True),
    )
    match = session.scalar(stmt)
    if not match and len(clean_phone) >= 10:
        match = session.scalar(
            select(Patient)
            .where(
                Patient.mobile.like(f"%{clean_phone[-10:]}"),
                Patient.is_active.is_(True),
            )
            .order_by(Patient.id.asc())
            .limit(1)
        )
    if match:
        return DuplicateCheckResponse(
            has_duplicate=True,
            matching_patient=PatientOut.model_validate(match),
        )

    return DuplicateCheckResponse(has_duplicate=False, matching_patient=None)


def _role_value(principal: Principal) -> str:
    return principal.role.value if hasattr(principal.role, "value") else str(principal.role)


def _raw_patient_dues_subquery(patient_ids: Sequence[int] | None = None):
    """Build per-patient outstanding due balance subquery (visits + active/completed packages).

    Matches billing_service.visit_totals and ledger_service.compute_patient_financial_kpis:
    - Visit charges: ACTIVE bill_items where appointment_id IS NULL or consultation COMPLETED.
    - Visit net paid: non-reversed payments (visit_id or appointment.visit_id) minus active refunds.
    - Package dues: ACTIVE/COMPLETED treatment_plans agreed_price minus net package payments.
    """
    visit_charges_sq = (
        select(
            BillItem.visit_id.label("visit_id"),
            func.coalesce(func.sum(BillItem.amount_paise), 0).label("billed"),
        )
        .outerjoin(Appointment, Appointment.id == BillItem.appointment_id)
        .where(
            BillItem.status == BillItemStatus.ACTIVE.value,
            or_(
                BillItem.appointment_id.is_(None),
                Appointment.consultation_status == ConsultationStatus.COMPLETED.value,
            ),
        )
        .group_by(BillItem.visit_id)
        .subquery()
    )

    pay_visit_col = func.coalesce(Payment.visit_id, Appointment.visit_id)
    visit_paid_sq = (
        select(
            pay_visit_col.label("visit_id"),
            func.coalesce(func.sum(Payment.amount_paise), 0).label("gross_paid"),
        )
        .outerjoin(Appointment, Appointment.id == Payment.appointment_id)
        .where(
            Payment.is_reversed.is_(False),
            pay_visit_col.is_not(None),
        )
        .group_by(pay_visit_col)
        .subquery()
    )

    ref_visit_col = func.coalesce(Refund.visit_id, Payment.visit_id, Appointment.visit_id)
    visit_refund_sq = (
        select(
            ref_visit_col.label("visit_id"),
            func.coalesce(func.sum(Refund.amount_paise), 0).label("refunded"),
        )
        .join(Payment, Payment.id == Refund.payment_id)
        .outerjoin(Appointment, Appointment.id == Payment.appointment_id)
        .where(
            Payment.is_reversed.is_(False),
            ref_visit_col.is_not(None),
        )
        .group_by(ref_visit_col)
        .subquery()
    )

    net_visit_paid = func.greatest(
        0,
        func.coalesce(visit_paid_sq.c.gross_paid, 0)
        - func.coalesce(visit_refund_sq.c.refunded, 0),
    )
    visit_due_expr = func.greatest(
        0,
        func.coalesce(visit_charges_sq.c.billed, 0) - net_visit_paid,
    )
    visit_dues_select = (
        select(
            Visit.patient_id.label("patient_id"),
            func.coalesce(func.sum(visit_due_expr), 0).label("due_paise"),
        )
        .outerjoin(visit_charges_sq, visit_charges_sq.c.visit_id == Visit.id)
        .outerjoin(visit_paid_sq, visit_paid_sq.c.visit_id == Visit.id)
        .outerjoin(visit_refund_sq, visit_refund_sq.c.visit_id == Visit.id)
    )
    if patient_ids is not None:
        visit_dues_select = visit_dues_select.where(Visit.patient_id.in_(patient_ids))
    visit_dues_select = visit_dues_select.group_by(Visit.patient_id)

    plan_paid_sq = (
        select(
            Payment.treatment_plan_id.label("plan_id"),
            func.coalesce(func.sum(Payment.amount_paise), 0).label("gross_paid"),
        )
        .where(
            Payment.is_reversed.is_(False),
            Payment.treatment_plan_id.is_not(None),
        )
        .group_by(Payment.treatment_plan_id)
        .subquery()
    )

    plan_refund_sq = (
        select(
            Payment.treatment_plan_id.label("plan_id"),
            func.coalesce(func.sum(Refund.amount_paise), 0).label("refunded"),
        )
        .join(Payment, Payment.id == Refund.payment_id)
        .where(
            Payment.is_reversed.is_(False),
            Payment.treatment_plan_id.is_not(None),
        )
        .group_by(Payment.treatment_plan_id)
        .subquery()
    )

    net_plan_paid = func.greatest(
        0,
        func.coalesce(plan_paid_sq.c.gross_paid, 0)
        - func.coalesce(plan_refund_sq.c.refunded, 0),
    )
    plan_due_expr = func.greatest(
        0,
        TreatmentPlan.agreed_price_paise - net_plan_paid,
    )
    plan_dues_select = (
        select(
            TreatmentPlan.patient_id.label("patient_id"),
            func.coalesce(func.sum(plan_due_expr), 0).label("due_paise"),
        )
        .outerjoin(plan_paid_sq, plan_paid_sq.c.plan_id == TreatmentPlan.id)
        .outerjoin(plan_refund_sq, plan_refund_sq.c.plan_id == TreatmentPlan.id)
        .where(
            TreatmentPlan.status.in_(
                [TreatmentPlanStatus.ACTIVE.value, TreatmentPlanStatus.COMPLETED.value]
            )
        )
    )
    if patient_ids is not None:
        plan_dues_select = plan_dues_select.where(TreatmentPlan.patient_id.in_(patient_ids))
    plan_dues_select = plan_dues_select.group_by(TreatmentPlan.patient_id)

    combined = union_all(visit_dues_select, plan_dues_select).subquery()
    return (
        select(
            combined.c.patient_id.label("patient_id"),
            func.coalesce(func.sum(combined.c.due_paise), 0).label("due_paise"),
        )
        .group_by(combined.c.patient_id)
        .subquery()
    )


def _enforce_due_balance_filter_role(
    principal: Principal,
    has_due_balance: bool | None,
) -> None:
    """Fail-closed AGENTS.md #7 guard: doctors cannot filter by financial due balance."""
    if has_due_balance is None:
        return
    if _role_value(principal) not in (Role.ADMIN.value, Role.RECEPTION.value):
        raise ApiError(
            status_code=403,
            code="forbidden",
            message="Filtering by due balance is restricted to Reception and Admin.",
        )


def _patient_search_stmt(
    q: str | None = None,
    *,
    status: Literal["active", "archived", "all"] = "active",
    gender: Literal["M", "F", "O"] | None = None,
    district: str | None = None,
    has_due_balance: bool | None = None,
):
    """Build the shared directory filter for list and count endpoints."""
    stmt = select(Patient)

    if status == "active":
        stmt = stmt.where(
            Patient.is_active.is_(True),
            Patient.is_archived.is_(False),
            Patient.merged_into_id.is_(None),
        )
    elif status == "archived":
        stmt = stmt.where(Patient.is_archived.is_(True))

    if gender is not None:
        stmt = stmt.where(Patient.gender == gender)

    if district and district.strip():
        stmt = stmt.where(Patient.district.ilike(f"%{district.strip()}%"))

    if q and q.strip():
        search_term = q.strip()
        digits = re.sub(r"\D", "", search_term)
        conditions = [
            Patient.urn.ilike(f"%{search_term}%"),
            Patient.full_name.ilike(f"%{search_term}%"),
            Patient.guardian_name.ilike(f"%{search_term}%"),
        ]
        if digits and len(digits) >= 3:
            conditions.append(Patient.mobile.like(f"%{digits}%"))

        stmt = stmt.where(or_(*conditions))

    if has_due_balance is not None:
        raw_dues_sq = _raw_patient_dues_subquery()
        child_patient = aliased(Patient)
        due_exists = (
            select(raw_dues_sq.c.patient_id)
            .outerjoin(child_patient, child_patient.id == raw_dues_sq.c.patient_id)
            .where(
                raw_dues_sq.c.due_paise > 0,
                or_(
                    raw_dues_sq.c.patient_id == Patient.id,
                    child_patient.merged_into_id == Patient.id,
                ),
            )
            .exists()
        )
        stmt = stmt.where(due_exists if has_due_balance else ~due_exists)

    return stmt


@router.get(
    "",
    dependencies=[Depends(require(Permission.PATIENT_READ))],
    response_model=list[PatientOut],
)
def list_or_search_patients(
    session: SessionDep,
    q: str | None = Query(default=None, description="Search query matching URN, mobile, or name."),
    status: Literal["active", "archived", "all"] = Query(
        default="active",
        description="Filter by patient record status: active, archived, or all.",
    ),
    gender: Literal["M", "F", "O"] | None = Query(
        default=None, description="Filter by patient gender (M, F, or O)."
    ),
    district: str | None = Query(
        default=None, description="Case-insensitive substring filter on patient district."
    ),
    has_due_balance: bool | None = Query(
        default=None,
        description="Filter by outstanding due balance (Admin/Reception only; 403 for Doctor).",
    ),
    sort_by: Literal["recent", "name", "urn"] = Query(
        default="recent", description="Directory sort order: recent, name, or urn."
    ),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    principal: Principal = Depends(current_principal),
) -> list[PatientOut]:
    """Search patients with server-side filters and batched directory summary stats."""
    _enforce_due_balance_filter_role(principal, has_due_balance)

    stmt = _patient_search_stmt(
        q,
        status=status,
        gender=gender,
        district=district,
        has_due_balance=has_due_balance,
    )
    if sort_by == "name":
        stmt = stmt.order_by(func.lower(Patient.full_name).asc(), Patient.id.asc())
    elif sort_by == "urn":
        stmt = stmt.order_by(Patient.urn.asc(), Patient.id.asc())
    else:
        stmt = stmt.order_by(Patient.created_at.desc(), Patient.id.desc())

    results = session.scalars(stmt.limit(limit).offset(offset)).all()
    if not results:
        return []

    page_ids = [p.id for p in results]

    # Batch lookup master URNs for merged records if any
    merged_master_ids = {p.merged_into_id for p in results if p.merged_into_id is not None}
    master_urn_map: dict[int, str] = {}
    if merged_master_ids:
        masters = session.execute(
            select(Patient.id, Patient.urn).where(Patient.id.in_(merged_master_ids))
        ).all()
        master_urn_map = {m_id: m_urn for m_id, m_urn in masters}

    # Batch lookup downward merged aliases so page stats match /patients/{id}/summary
    effective_ids_by_patient: dict[int, list[int]] = {pid: [pid] for pid in page_ids}
    child_rows = session.execute(
        select(Patient.id, Patient.merged_into_id).where(Patient.merged_into_id.in_(page_ids))
    ).all()
    for child_id, master_id in child_rows:
        if master_id in effective_ids_by_patient:
            effective_ids_by_patient[master_id].append(child_id)

    all_effective_ids = sorted(
        {eid for eids in effective_ids_by_patient.values() for eid in eids}
    )

    # Batch visit counts and latest visit dates across all effective IDs on this page
    visit_stats_rows = session.execute(
        select(
            Visit.patient_id,
            func.count(Visit.id),
            func.max(Visit.visit_date),
        )
        .where(Visit.patient_id.in_(all_effective_ids))
        .group_by(Visit.patient_id)
    ).all()
    raw_visit_count: dict[int, int] = {}
    raw_last_visit: dict[int, date | None] = {}
    for v_pid, v_cnt, v_max_date in visit_stats_rows:
        raw_visit_count[int(v_pid)] = int(v_cnt or 0)
        raw_last_visit[int(v_pid)] = v_max_date

    # Batch outstanding dues ONLY for ADMIN and RECEPTION (strictly None for DOCTOR, AGENTS.md #7)
    can_see_financial = _role_value(principal) in (Role.ADMIN.value, Role.RECEPTION.value)
    raw_due_map: dict[int, int] = {}
    if can_see_financial:
        raw_dues_sq = _raw_patient_dues_subquery(all_effective_ids)
        due_rows = session.execute(
            select(raw_dues_sq.c.patient_id, raw_dues_sq.c.due_paise)
        ).all()
        raw_due_map = {int(pid): int(due or 0) for pid, due in due_rows}

    out_list: list[PatientOut] = []
    for p in results:
        p_out = PatientOut.model_validate(p)
        if p.merged_into_id and p.merged_into_id in master_urn_map:
            p_out.merged_into_urn = master_urn_map[p.merged_into_id]

        eff_ids = effective_ids_by_patient[p.id]
        p_out.visit_count = sum(raw_visit_count.get(eid, 0) for eid in eff_ids)
        dates = [raw_last_visit[eid] for eid in eff_ids if raw_last_visit.get(eid) is not None]
        p_out.last_visit_date = max(dates) if dates else None
        p_out.outstanding_paise = (
            sum(raw_due_map.get(eid, 0) for eid in eff_ids) if can_see_financial else None
        )
        out_list.append(p_out)
    return out_list


@router.get(
    "/count",
    dependencies=[Depends(require(Permission.PATIENT_READ))],
    response_model=PatientCountResponse,
)
def count_patients(
    session: SessionDep,
    q: str | None = Query(default=None, description="Search query matching URN, mobile, or name."),
    status: Literal["active", "archived", "all"] = Query(
        default="active",
        description="Filter by patient record status: active, archived, or all.",
    ),
    gender: Literal["M", "F", "O"] | None = Query(
        default=None, description="Filter by patient gender (M, F, or O)."
    ),
    district: str | None = Query(
        default=None, description="Case-insensitive substring filter on patient district."
    ),
    has_due_balance: bool | None = Query(
        default=None,
        description="Filter by outstanding due balance (Admin/Reception only; 403 for Doctor).",
    ),
    principal: Principal = Depends(current_principal),
) -> PatientCountResponse:
    """Total patients matching the same filters the directory list endpoint uses."""
    _enforce_due_balance_filter_role(principal, has_due_balance)

    filtered_stmt = _patient_search_stmt(
        q,
        status=status,
        gender=gender,
        district=district,
        has_due_balance=has_due_balance,
    )
    stmt = select(func.count()).select_from(filtered_stmt.subquery())
    return PatientCountResponse(total=session.scalar(stmt) or 0)


@router.get(
    "/{id}",
    dependencies=[Depends(require(Permission.PATIENT_READ))],
    response_model=PatientOut,
)
def get_patient_by_id(
    id: int,
    session: SessionDep,
) -> PatientOut:
    """Retrieve full patient demographic record by identifier."""
    patient = session.get(Patient, id)
    if not patient:
        raise ApiError(status_code=404, code="not_found", message=f"Patient #{id} not found")
    out = PatientOut.model_validate(patient)
    if patient.merged_into_id:
        master = session.get(Patient, patient.merged_into_id)
        if master:
            out.merged_into_urn = master.urn
    return out


@router.patch(
    "/{id}",
    dependencies=[Depends(require(Permission.PATIENT_UPDATE))],
    response_model=PatientOut,
)
def update_patient_demographics(
    id: int,
    request: Request,
    payload: PatientUpdate,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> PatientOut:
    """Update demographic fields with optimistic concurrency control (409 on version mismatch)."""
    patient = session.scalar(select(Patient).where(Patient.id == id).with_for_update())
    if not patient:
        raise ApiError(status_code=404, code="not_found", message=f"Patient #{id} not found")

    require_version(patient, payload.version_id, "patient")

    before_state = {
        "full_name": patient.full_name,
        "guardian_name": patient.guardian_name,
        "gender": patient.gender,
        "dob": str(patient.dob) if patient.dob else None,
        "age_years": patient.age_years,
        "mobile": patient.mobile,
        "address": patient.address,
        "district": patient.district,
        "state": patient.state,
        "emergency_contact": patient.emergency_contact,
        "alternate_mobile": patient.alternate_mobile,
        "email": patient.email,
        "blood_group": patient.blood_group,
        "pin_code": patient.pin_code,
        "guardian_relationship": patient.guardian_relationship,
        "medical_history_notes": patient.medical_history_notes,
        "allergies": patient.allergies,
        "notes": patient.notes,
        "is_active": patient.is_active,
        "version_id": patient.version_id,
    }

    if payload.full_name is not None:
        patient.full_name = payload.full_name.strip()
    if payload.guardian_name is not None:
        patient.guardian_name = payload.guardian_name.strip()
    if payload.gender is not None:
        patient.gender = payload.gender
    if payload.dob is not None:
        patient.dob = payload.dob
    if payload.age_years is not None:
        patient.age_years = payload.age_years
    if payload.mobile is not None:
        patient.mobile = _clean_mobile(payload.mobile)
    if payload.address is not None:
        patient.address = payload.address.strip()
    if payload.district is not None:
        patient.district = payload.district.strip()
    if payload.state is not None:
        patient.state = payload.state.strip()
    if payload.emergency_contact is not None:
        patient.emergency_contact = (
            payload.emergency_contact.strip() if payload.emergency_contact else None
        )
    if "alternate_mobile" in payload.model_fields_set:
        patient.alternate_mobile = (
            _clean_mobile(payload.alternate_mobile) if payload.alternate_mobile else None
        )
    if "email" in payload.model_fields_set:
        patient.email = payload.email
    if "blood_group" in payload.model_fields_set:
        patient.blood_group = payload.blood_group
    if "pin_code" in payload.model_fields_set:
        patient.pin_code = payload.pin_code
    if "guardian_relationship" in payload.model_fields_set:
        patient.guardian_relationship = payload.guardian_relationship
    if "medical_history_notes" in payload.model_fields_set:
        patient.medical_history_notes = payload.medical_history_notes
    if payload.allergies is not None:
        patient.allergies = payload.allergies.strip()
    if payload.notes is not None:
        patient.notes = payload.notes.strip() if payload.notes else None
    if payload.is_active is not None:
        patient.is_active = payload.is_active

    session.flush()

    after_state = {
        "full_name": patient.full_name,
        "guardian_name": patient.guardian_name,
        "gender": patient.gender,
        "dob": str(patient.dob) if patient.dob else None,
        "age_years": patient.age_years,
        "mobile": patient.mobile,
        "address": patient.address,
        "district": patient.district,
        "state": patient.state,
        "emergency_contact": patient.emergency_contact,
        "alternate_mobile": patient.alternate_mobile,
        "email": patient.email,
        "blood_group": patient.blood_group,
        "pin_code": patient.pin_code,
        "guardian_relationship": patient.guardian_relationship,
        "medical_history_notes": patient.medical_history_notes,
        "allergies": patient.allergies,
        "notes": patient.notes,
        "is_active": patient.is_active,
        "version_id": patient.version_id,
    }

    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        AuditAction.PATIENT_UPDATED,
        "PATIENT",
        str(patient.id),
        before=before_state,
        after=after_state,
    )

    return PatientOut.model_validate(patient)


@router.post(
    "/{id}/photo",
    dependencies=[Depends(require(Permission.PHOTO_WRITE))],
    response_model=PatientOut,
)
async def upload_patient_photo(
    id: int,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> PatientOut:
    """Accept JPEG/PNG photo upload up to 5 MB and link to patient record."""
    patient = session.scalar(select(Patient).where(Patient.id == id).with_for_update())
    if not patient:
        raise ApiError(status_code=404, code="not_found", message=f"Patient #{id} not found")

    file_bytes = await _extract_photo_bytes(request)
    settings = get_current_settings(request)
    photos_dir = settings.photos_dir

    old_photo = patient.photo_path
    new_filename = photo_service.save_photo(file_bytes, photos_dir)
    patient.photo_path = new_filename
    session.flush()

    if old_photo:
        photo_service.delete_photo(old_photo, photos_dir)

    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        AuditAction.PHOTO_UPLOADED,
        "PATIENT",
        str(patient.id),
        after={"photo_path": new_filename, "size_bytes": len(file_bytes)},
    )

    return PatientOut.model_validate(patient)


@router.get(
    "/{id}/photo",
    dependencies=[Depends(require(Permission.PHOTO_READ))],
)
def get_patient_photo(
    id: int,
    request: Request,
    session: SessionDep,
) -> FileResponse:
    """Stream patient photo strictly to authenticated authorized sessions."""
    patient = session.get(Patient, id)
    if not patient:
        raise ApiError(status_code=404, code="not_found", message=f"Patient #{id} not found")
    if not patient.photo_path:
        raise ApiError(
            status_code=404, code="no_photo", message=f"Patient #{id} has no photo on file"
        )

    settings = get_current_settings(request)
    photos_dir = settings.photos_dir

    path = photo_service.get_photo_path(patient.photo_path, photos_dir)
    if not path.is_file():
        raise ApiError(
            status_code=404, code="photo_missing", message="Photo file not found on disk"
        )

    media_type = "image/png" if path.suffix.lower() == ".png" else "image/jpeg"
    return FileResponse(
        path=str(path),
        media_type=media_type,
        headers={"Cache-Control": "private, no-cache"},
    )


def _require_doctor(principal: Principal) -> int:
    """Ensure the authenticated principal is a DOCTOR with a linked doctor profile."""
    if principal.role != Role.DOCTOR or principal.doctor_id is None:
        raise ApiError(status_code=403, code="doctor_only", message="Doctor access required.")
    return principal.doctor_id


def _allergy_to_out(allergy: PatientAllergy, username: str | None) -> PatientAllergyOut:
    """Serialize a PatientAllergy row with its recorded_by_username."""
    return PatientAllergyOut(
        id=allergy.id,
        patient_id=allergy.patient_id,
        substance=allergy.substance,
        category=allergy.category,
        severity=allergy.severity,
        reaction=allergy.reaction,
        clinical_notes=allergy.clinical_notes,
        status=allergy.status,
        doctor_id=allergy.doctor_id,
        recorded_by_user_id=allergy.recorded_by_user_id,
        recorded_by_username=username,
        created_at=allergy.created_at,
        updated_at=allergy.updated_at,
        version_id=allergy.version_id,
    )


@router.get(
    "/{patient_id}/allergies",
    dependencies=[Depends(require(Permission.ENCOUNTER_READ))],
    response_model=list[PatientAllergyOut],
)
def list_patient_allergies(
    patient_id: int,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> list[PatientAllergyOut]:
    """List structured clinical allergies for a patient (DOCTOR only, D-04, DWS-04)."""
    _require_doctor(principal)

    patient = session.get(Patient, patient_id)
    if patient is None:
        raise ApiError(
            status_code=404,
            code="patient_not_found",
            message=f"Patient #{patient_id} not found",
        )

    patient_ids = effective_patient_ids(session, patient_id)
    status_order = case(
        (PatientAllergy.status == AllergyStatus.ACTIVE.value, 0),
        (PatientAllergy.status == AllergyStatus.INACTIVE.value, 1),
        else_=2,
    )
    rows = session.execute(
        select(PatientAllergy, User.username)
        .options(noload(PatientAllergy.recorded_by_user))
        .outerjoin(User, User.id == PatientAllergy.recorded_by_user_id)
        .where(PatientAllergy.patient_id.in_(patient_ids))
        .order_by(status_order, PatientAllergy.created_at.desc(), PatientAllergy.id.desc())
    ).all()

    allergies = [row[0] for row in rows]
    audit_cross_doctor_list_read(
        session, principal, patient_id, "patient_allergies_list", allergies
    )

    return [_allergy_to_out(allergy, username) for allergy, username in rows]


@router.post(
    "/{patient_id}/allergies",
    status_code=201,
    dependencies=[Depends(require(Permission.ALLERGY_WRITE))],
    response_model=PatientAllergyOut,
)
def create_patient_allergy(
    patient_id: int,
    request: Request,
    payload: PatientAllergyCreate,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> PatientAllergyOut:
    """Record a structured clinical allergy for an active, unmerged patient (DOCTOR only)."""
    doctor_id = _require_doctor(principal)
    require_active_unmerged_patient(session, patient_id)

    allergy = PatientAllergy(
        patient_id=patient_id,
        substance=payload.substance,
        category=payload.category.value,
        severity=payload.severity.value,
        reaction=payload.reaction,
        clinical_notes=payload.clinical_notes,
        status=payload.status.value,
        doctor_id=doctor_id,
        recorded_by_user_id=principal.user_id,
    )
    session.add(allergy)
    session.flush()

    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        AuditAction.ALLERGY_RECORDED,
        "PATIENT_ALLERGY",
        str(allergy.id),
        after={
            "patient_id": allergy.patient_id,
            "substance": allergy.substance,
            "category": allergy.category,
            "severity": allergy.severity,
            "reaction": allergy.reaction,
            "clinical_notes": allergy.clinical_notes,
            "status": allergy.status,
            "doctor_id": allergy.doctor_id,
            "recorded_by_user_id": allergy.recorded_by_user_id,
            "version_id": allergy.version_id,
        },
    )

    return _allergy_to_out(allergy, principal.username)


@router.patch(
    "/{patient_id}/allergies/{allergy_id}",
    dependencies=[Depends(require(Permission.ALLERGY_WRITE))],
    response_model=PatientAllergyOut,
)
def update_patient_allergy(
    patient_id: int,
    allergy_id: int,
    request: Request,
    payload: PatientAllergyUpdate,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> PatientAllergyOut:
    """Update a structured clinical allergy with optimistic version_id locking (DOCTOR only)."""
    _require_doctor(principal)
    require_active_unmerged_patient(session, patient_id)

    patient_ids = effective_patient_ids(session, patient_id)
    allergy = session.scalar(
        select(PatientAllergy)
        .where(
            PatientAllergy.id == allergy_id,
            PatientAllergy.patient_id.in_(patient_ids),
        )
        .with_for_update(of=PatientAllergy)
    )
    if allergy is None:
        raise ApiError(
            status_code=404,
            code="allergy_not_found",
            message=f"Allergy #{allergy_id} not found for patient #{patient_id}",
        )

    require_version(allergy, payload.version_id, "patient_allergy")

    before_state = {
        "substance": allergy.substance,
        "category": allergy.category,
        "severity": allergy.severity,
        "reaction": allergy.reaction,
        "clinical_notes": allergy.clinical_notes,
        "status": allergy.status,
        "version_id": allergy.version_id,
    }

    if payload.substance is not None:
        allergy.substance = payload.substance
    if payload.category is not None:
        allergy.category = payload.category.value
    if payload.severity is not None:
        allergy.severity = payload.severity.value
    if "reaction" in payload.model_fields_set:
        allergy.reaction = payload.reaction
    if "clinical_notes" in payload.model_fields_set:
        allergy.clinical_notes = payload.clinical_notes
    if payload.status is not None:
        allergy.status = payload.status.value

    session.flush()

    after_state = {
        "substance": allergy.substance,
        "category": allergy.category,
        "severity": allergy.severity,
        "reaction": allergy.reaction,
        "clinical_notes": allergy.clinical_notes,
        "status": allergy.status,
        "version_id": allergy.version_id,
    }

    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        AuditAction.ALLERGY_UPDATED,
        "PATIENT_ALLERGY",
        str(allergy.id),
        before=before_state,
        after=after_state,
    )

    recorded_by_username = (
        allergy.recorded_by_user.username if allergy.recorded_by_user is not None else None
    )
    return _allergy_to_out(allergy, recorded_by_username)
