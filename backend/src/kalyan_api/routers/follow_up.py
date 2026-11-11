"""Clinical follow-up recommendation workflow and reception privacy isolation (DWS-08).

Guarantees:
- Doctors create follow-up recommendations during consultation.
- Strict clinical privacy separation: Receptionist queries and schemas NEVER select or expose
  clinical_reason (D-19-19, R-3, T-19-07).
- Both doctor and reception can convert recommendations to scheduled appointments (D-19-18).
- Unbooked recommendations remain open/overdue until explicitly booked or closed with a reason
  (D-19-21).
"""

from datetime import UTC, date, datetime

from fastapi import APIRouter, Depends, Query, Request
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
from kalyan_api.core.scope import ScopeFamily, get_scoped_or_404
from kalyan_api.db.session import SessionDep
from kalyan_api.models import (
    Appointment,
    AppointmentStatus,
    ClinicalEncounter,
    Doctor,
    FollowUpRecommendation,
    FollowUpStatus,
    Patient,
)
from kalyan_api.routers.appointments import lock_department_for_booking
from kalyan_api.schemas.follow_up import (
    DoctorFollowUpResponse,
    FollowUpBookRequest,
    FollowUpCloseRequest,
    FollowUpRecommendationCreate,
    ReceptionFollowUpResponse,
)
from kalyan_api.services import audit_service, token_service
from kalyan_api.services.audit_service import AuditAction

router = APIRouter(tags=["follow-ups"])


def _infer_follow_up_department_id(session, rec: FollowUpRecommendation, doctor: Doctor) -> int:
    """Pick the department for a follow-up booking when the caller did not name one.

    Uses the original encounter's department if the recommended doctor belongs to it,
    otherwise the doctor's only active department. Anything else is ambiguous, so the
    caller must choose (422 department_required) rather than the server guessing.
    """
    member_ids = {d.id for d in doctor.departments}
    encounter = session.get(ClinicalEncounter, rec.encounter_id)
    if encounter is not None and encounter.department_id in member_ids:
        return encounter.department_id

    active = [d.id for d in doctor.departments if d.is_active]
    if len(active) == 1:
        return active[0]
    if not active and len(member_ids) == 1:
        # Report the real problem (inactive department) instead of "choose one".
        return next(iter(member_ids))
    raise ApiError(
        status_code=422,
        code="department_required",
        message=(
            "The department for this follow-up could not be worked out from the doctor "
            "and the original consultation. Choose the department."
        ),
    )


def _to_doctor_response(rec: FollowUpRecommendation) -> DoctorFollowUpResponse:
    """Format recommendation for doctor viewing, including clinical rationale."""
    return DoctorFollowUpResponse(
        id=rec.id,
        encounter_id=rec.encounter_id,
        patient_id=rec.patient_id,
        patient_name=rec.patient.full_name if rec.patient else "",
        patient_urn=rec.patient.urn if rec.patient else "",
        doctor_id=rec.doctor_id,
        doctor_name=rec.doctor.name_en if rec.doctor else "",
        recommended_doctor_id=rec.recommended_doctor_id,
        recommended_doctor_name=rec.recommended_doctor.name_en if rec.recommended_doctor else "",
        recommended_date=rec.recommended_date,
        clinical_reason=rec.clinical_reason,
        status=rec.status,
        booked_appointment_id=rec.booked_appointment_id,
        closed_reason=rec.closed_reason,
        closed_by_user_id=rec.closed_by_user_id,
        closed_at=rec.closed_at,
        version_id=rec.version_id,
        created_at=rec.created_at,
        updated_at=rec.updated_at,
    )


def _to_reception_response(rec: FollowUpRecommendation) -> ReceptionFollowUpResponse:
    """Format recommendation for reception booking, strictly omitting clinical_reason."""
    return ReceptionFollowUpResponse(
        id=rec.id,
        encounter_id=rec.encounter_id,
        patient_id=rec.patient_id,
        patient_name=rec.patient.full_name if rec.patient else "",
        patient_urn=rec.patient.urn if rec.patient else "",
        patient_mobile=rec.patient.mobile if rec.patient else None,
        recommended_doctor_id=rec.recommended_doctor_id,
        recommended_doctor_name=rec.recommended_doctor.name_en if rec.recommended_doctor else "",
        recommended_date=rec.recommended_date,
        status=rec.status,
        booked_appointment_id=rec.booked_appointment_id,
        created_at=rec.created_at,
    )


@router.post(
    "/encounters/{id}/follow-up",
    response_model=DoctorFollowUpResponse,
    status_code=201,
    dependencies=[Depends(require(Permission.ENCOUNTER_WRITE))],
)
def create_encounter_follow_up(
    id: int,
    payload: FollowUpRecommendationCreate,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> DoctorFollowUpResponse:
    """Record a clinical follow-up recommendation for an encounter (D-19-18, D-19-20)."""
    if principal.role != Role.DOCTOR or principal.doctor_id is None:
        raise ApiError(
            status_code=403,
            code="doctor_only",
            message="Only authenticated doctors can record follow-up recommendations.",
        )

    encounter = get_scoped_or_404(
        session,
        ClinicalEncounter,
        id,
        principal,
        family=ScopeFamily.CLINICAL_WRITE,
        doctor_id_col=ClinicalEncounter.doctor_id,
    )

    # Check if recommendation already exists for this encounter
    existing = session.execute(
        select(FollowUpRecommendation).where(FollowUpRecommendation.encounter_id == id)
    ).scalar_one_or_none()
    if existing:
        raise ApiError(
            status_code=409,
            code="follow_up_exists",
            message="A follow-up recommendation already exists for this encounter.",
        )

    target_doctor_id = payload.recommended_doctor_id or encounter.doctor_id
    target_doctor = session.get(Doctor, target_doctor_id)
    if not target_doctor or not target_doctor.is_active:
        raise ApiError(
            status_code=404,
            code="doctor_not_found",
            message="Recommended doctor not found or inactive.",
        )

    rec = FollowUpRecommendation(
        encounter_id=encounter.id,
        patient_id=encounter.patient_id,
        doctor_id=encounter.doctor_id,
        recommended_doctor_id=target_doctor_id,
        recommended_date=payload.recommended_date,
        clinical_reason=payload.clinical_reason,
        status=FollowUpStatus.PENDING.value,
    )
    session.add(rec)
    session.flush()

    # Re-query with eager relationships
    stmt = (
        select(FollowUpRecommendation)
        .where(FollowUpRecommendation.id == rec.id)
        .options(
            selectinload(FollowUpRecommendation.patient),
            selectinload(FollowUpRecommendation.doctor),
            selectinload(FollowUpRecommendation.recommended_doctor),
        )
    )
    refreshed_rec = session.execute(stmt).scalar_one()

    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        action=AuditAction.FOLLOW_UP_RECOMMENDED,
        entity_type="follow_up_recommendation",
        entity_id=refreshed_rec.id,
        after={
            "encounter_id": refreshed_rec.encounter_id,
            "patient_id": refreshed_rec.patient_id,
            "doctor_id": refreshed_rec.doctor_id,
            "recommended_doctor_id": refreshed_rec.recommended_doctor_id,
            "recommended_date": refreshed_rec.recommended_date.isoformat(),
        },
    )

    return _to_doctor_response(refreshed_rec)


@router.get(
    "/encounters/{id}/follow-up",
    response_model=DoctorFollowUpResponse,
    dependencies=[Depends(require(Permission.ENCOUNTER_READ))],
)
def get_encounter_follow_up(
    id: int,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> DoctorFollowUpResponse:
    """Retrieve full clinical follow-up recommendation with clinical reason for doctor."""
    if principal.role != Role.DOCTOR or principal.doctor_id is None:
        raise ApiError(
            status_code=403,
            code="doctor_only",
            message="Only authenticated doctors can inspect clinical follow-up details.",
        )

    get_scoped_or_404(
        session,
        ClinicalEncounter,
        id,
        principal,
        family=ScopeFamily.CLINICAL_READ,
        doctor_id_col=ClinicalEncounter.doctor_id,
    )

    stmt = (
        select(FollowUpRecommendation)
        .where(FollowUpRecommendation.encounter_id == id)
        .options(
            selectinload(FollowUpRecommendation.patient),
            selectinload(FollowUpRecommendation.doctor),
            selectinload(FollowUpRecommendation.recommended_doctor),
        )
    )
    rec = session.execute(stmt).scalar_one_or_none()
    if not rec:
        raise ApiError(
            status_code=404,
            code="follow_up_not_found",
            message="No follow-up recommendation found for this encounter.",
        )

    return _to_doctor_response(rec)


@router.get(
    "/reception/follow-ups",
    response_model=list[ReceptionFollowUpResponse],
    dependencies=[Depends(require(Permission.APPOINTMENT_READ))],
)
def list_reception_follow_ups(
    session: SessionDep,
    status: str | None = Query(None, description="Filter by status (PENDING, BOOKED, CLOSED)"),
    date_from: date | None = Query(None, description="Recommended date on or after"),
    date_to: date | None = Query(None, description="Recommended date on or before"),
    overdue: bool | None = Query(None, description="Filter for overdue pending recommendations"),
) -> list[ReceptionFollowUpResponse]:
    """
    Query follow-up recommendations for administrative booking (D-19-19, DWS-08).

    CRITICAL PRIVACY INVARIANT:
    clinical_reason is STRICTLY omitted from both query and response.
    """
    stmt = (
        select(
            FollowUpRecommendation.id,
            FollowUpRecommendation.encounter_id,
            FollowUpRecommendation.patient_id,
            Patient.full_name.label("patient_name"),
            Patient.urn.label("patient_urn"),
            Patient.mobile.label("patient_mobile"),
            FollowUpRecommendation.recommended_doctor_id,
            Doctor.name_en.label("recommended_doctor_name"),
            FollowUpRecommendation.recommended_date,
            FollowUpRecommendation.status,
            FollowUpRecommendation.booked_appointment_id,
            FollowUpRecommendation.created_at,
        )
        .join(Patient, FollowUpRecommendation.patient_id == Patient.id)
        .join(Doctor, FollowUpRecommendation.recommended_doctor_id == Doctor.id)
        .order_by(
            FollowUpRecommendation.recommended_date.asc(), FollowUpRecommendation.created_at.desc()
        )
    )

    if status:
        stmt = stmt.where(FollowUpRecommendation.status == status.upper())

    if date_from:
        stmt = stmt.where(FollowUpRecommendation.recommended_date >= date_from)

    if date_to:
        stmt = stmt.where(FollowUpRecommendation.recommended_date <= date_to)

    if overdue is True:
        today = clock.ist_today()
        stmt = stmt.where(
            FollowUpRecommendation.status == FollowUpStatus.PENDING.value,
            FollowUpRecommendation.recommended_date < today,
        )

    rows = session.execute(stmt).all()
    return [
        ReceptionFollowUpResponse(
            id=r.id,
            encounter_id=r.encounter_id,
            patient_id=r.patient_id,
            patient_name=r.patient_name,
            patient_urn=r.patient_urn,
            patient_mobile=r.patient_mobile,
            recommended_doctor_id=r.recommended_doctor_id,
            recommended_doctor_name=r.recommended_doctor_name,
            recommended_date=r.recommended_date,
            status=r.status,
            booked_appointment_id=r.booked_appointment_id,
            created_at=r.created_at,
        )
        for r in rows
    ]


@router.post(
    "/follow-ups/{id}/book",
    response_model=ReceptionFollowUpResponse,
    dependencies=[Depends(require(Permission.APPOINTMENT_WRITE))],
)
def book_follow_up(
    id: int,
    payload: FollowUpBookRequest,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> ReceptionFollowUpResponse:
    """Convert recommendation to a scheduled appointment (D-19-18). Accessible by Doctor or Reception."""  # noqa: E501 - published as the OpenAPI description; wrapping changes the text
    stmt = (
        select(FollowUpRecommendation)
        .where(FollowUpRecommendation.id == id)
        .options(
            selectinload(FollowUpRecommendation.patient),
            selectinload(FollowUpRecommendation.recommended_doctor),
        )
    )
    rec = session.execute(stmt).scalar_one_or_none()
    if not rec:
        raise ApiError(
            status_code=404,
            code="follow_up_not_found",
            message="Follow-up recommendation not found.",
        )

    if rec.status != FollowUpStatus.PENDING.value:
        raise ApiError(
            status_code=409,
            code="invalid_status",
            message=(
                f"Cannot book follow-up with status '{rec.status}'. Only PENDING recommendations "
                "can be booked."
            ),
        )

    appt_date = payload.appointment_date or rec.recommended_date

    # Same booking rules as POST /appointments (BR-012; ADR-23, ADR-24, ADR-25).
    patient = rec.patient
    if not patient or not patient.is_active:
        raise ApiError(
            status_code=404, code="patient_not_found", message="Patient not found or inactive."
        )
    doctor = rec.recommended_doctor
    if not doctor or not doctor.is_active:
        raise ApiError(
            status_code=404, code="doctor_not_found", message="Doctor not found or inactive."
        )

    department_id = payload.department_id or _infer_follow_up_department_id(session, rec, doctor)
    department = lock_department_for_booking(session, department_id)
    if department is None:
        raise ApiError(
            status_code=422,
            code="department_not_found",
            message="Selected department does not exist.",
        )
    if not department.is_active:
        raise ApiError(
            status_code=422,
            code="department_inactive",
            message="Selected department is inactive and cannot accept new appointments.",
        )
    if department not in doctor.departments:
        raise ApiError(
            status_code=422,
            code="doctor_department_mismatch",
            message="Selected doctor is not assigned to the selected department.",
        )

    # Check duplicate appointment with the same doctor on the same date (BR-006)
    active_statuses = [
        AppointmentStatus.BOOKED.value,
        AppointmentStatus.ARRIVED.value,
        AppointmentStatus.IN_CONSULTATION.value,
        AppointmentStatus.DONE.value,
    ]
    existing_appt = session.scalar(
        select(Appointment).where(
            Appointment.patient_id == rec.patient_id,
            Appointment.doctor_id == rec.recommended_doctor_id,
            Appointment.appointment_date == appt_date,
            Appointment.status.in_(active_statuses),
        )
    )
    if existing_appt is not None:
        override = (payload.override_reason or "").strip()
        if len(override) < 5:
            raise ApiError(
                status_code=409,
                code="duplicate_appointment",
                message=(
                    "Patient already has an active appointment with this doctor on this date. "
                    "An override reason of at least 5 characters is required."
                ),
                details={
                    "existing_appointment_id": existing_appt.id,
                    "existing_token_number": existing_appt.token_number,
                    "existing_status": existing_appt.status,
                },
            )

    # Generate sequential token for doctor and date
    token_num = token_service.generate_next_daily_token(
        session, rec.recommended_doctor_id, appt_date
    )

    override_text = (payload.override_reason or "").strip() or None
    final_notes = payload.notes
    if override_text:
        final_notes = (
            f"{final_notes} | [Override: {override_text}]"
            if final_notes
            else f"[Override: {override_text}]"
        )

    appt = Appointment(
        patient_id=rec.patient_id,
        doctor_id=rec.recommended_doctor_id,
        department_id=department.id,
        appointment_date=appt_date,
        token_number=token_num,
        status=AppointmentStatus.BOOKED.value,
        notes=final_notes,
        created_by_user_id=principal.user_id,
    )
    session.add(appt)
    session.flush()

    rec.status = FollowUpStatus.BOOKED.value
    rec.booked_appointment_id = appt.id
    session.flush()

    ctx = build_audit_context(request, principal)
    audit_after = {
        "booked_appointment_id": appt.id,
        "status": rec.status,
        "appointment_date": appt_date.isoformat(),
        "token_number": token_num,
    }
    if override_text:
        audit_after["override_reason"] = override_text

    audit_service.record(
        session,
        ctx,
        action=AuditAction.FOLLOW_UP_BOOKED,
        entity_type="follow_up_recommendation",
        entity_id=rec.id,
        after=audit_after,
    )

    return _to_reception_response(rec)


@router.post(
    "/follow-ups/{id}/close",
    response_model=ReceptionFollowUpResponse,
    dependencies=[Depends(require(Permission.APPOINTMENT_WRITE))],
)
def close_follow_up(
    id: int,
    payload: FollowUpCloseRequest,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> ReceptionFollowUpResponse:
    """Close an unbooked recommendation with recorded reason (D-19-21)."""
    stmt = (
        select(FollowUpRecommendation)
        .where(FollowUpRecommendation.id == id)
        .options(
            selectinload(FollowUpRecommendation.patient),
            selectinload(FollowUpRecommendation.recommended_doctor),
        )
    )
    rec = session.execute(stmt).scalar_one_or_none()
    if not rec:
        raise ApiError(
            status_code=404,
            code="follow_up_not_found",
            message="Follow-up recommendation not found.",
        )

    if rec.status != FollowUpStatus.PENDING.value:
        raise ApiError(
            status_code=409,
            code="invalid_status",
            message=(
                f"Cannot close follow-up with status '{rec.status}'. Only PENDING recommendations "
                "can be closed."
            ),
        )

    reason = payload.reason.strip()
    if len(reason) < 3:
        raise ApiError(
            status_code=422,
            code="invalid_reason",
            message="Closure reason must be at least 3 characters.",
        )

    rec.status = FollowUpStatus.CLOSED.value
    rec.closed_reason = reason
    rec.closed_by_user_id = principal.user_id
    rec.closed_at = datetime.now(UTC)
    session.flush()

    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        action=AuditAction.FOLLOW_UP_CLOSED,
        entity_type="follow_up_recommendation",
        entity_id=rec.id,
        after={
            "status": rec.status,
            "closed_reason": rec.closed_reason,
            "closed_by_user_id": rec.closed_by_user_id,
            "closed_at": rec.closed_at.isoformat(),
        },
    )

    return _to_reception_response(rec)
