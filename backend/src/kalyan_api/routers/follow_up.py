"""Clinical follow-up recommendation workflow and reception privacy isolation (DWS-08).

Guarantees:
- Doctors create follow-up recommendations during consultation.
- Strict clinical privacy separation: Receptionist queries and schemas NEVER select or expose clinical_reason (D-19-19, R-3, T-19-07).
- Both doctor and reception can convert recommendations to scheduled appointments (D-19-18).
- Unbooked recommendations remain open/overdue until explicitly booked or closed with a reason (D-19-21).
"""

from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import selectinload

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
    Appointment,
    AppointmentStatus,
    ClinicalEncounter,
    Doctor,
    FollowUpRecommendation,
    FollowUpStatus,
    Patient,
)
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

    encounter = session.get(ClinicalEncounter, id)
    if not encounter:
        raise ApiError(status_code=404, code="encounter_not_found", message="Clinical encounter not found.")

    if encounter.doctor_id != principal.doctor_id:
        raise ApiError(
            status_code=404,
            code="encounter_not_found",
            message="Clinical encounter not found or not assigned to this doctor.",
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

    encounter = session.get(ClinicalEncounter, id)
    if not encounter:
        raise ApiError(status_code=404, code="encounter_not_found", message="Clinical encounter not found.")

    if encounter.doctor_id != principal.doctor_id:
        raise ApiError(status_code=404, code="encounter_not_found", message="Clinical encounter not found.")

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
        .order_by(FollowUpRecommendation.recommended_date.asc(), FollowUpRecommendation.created_at.desc())
    )

    if status:
        stmt = stmt.where(FollowUpRecommendation.status == status.upper())

    if date_from:
        stmt = stmt.where(FollowUpRecommendation.recommended_date >= date_from)

    if date_to:
        stmt = stmt.where(FollowUpRecommendation.recommended_date <= date_to)

    if overdue is True:
        today = date.today()
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
    """Convert recommendation to a scheduled appointment (D-19-18). Accessible by Doctor or Reception."""
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
        raise ApiError(status_code=404, code="follow_up_not_found", message="Follow-up recommendation not found.")

    if rec.status != FollowUpStatus.PENDING.value:
        raise ApiError(
            status_code=409,
            code="invalid_status",
            message=f"Cannot book follow-up with status '{rec.status}'. Only PENDING recommendations can be booked.",
        )

    appt_date = payload.appointment_date or rec.recommended_date

    # Generate sequential token for doctor and date
    token_num = token_service.generate_next_daily_token(
        session, rec.recommended_doctor_id, appt_date
    )

    appt = Appointment(
        patient_id=rec.patient_id,
        doctor_id=rec.recommended_doctor_id,
        appointment_date=appt_date,
        token_number=token_num,
        status=AppointmentStatus.BOOKED.value,
        notes=payload.notes,
        created_by_user_id=principal.user_id,
    )
    session.add(appt)
    session.flush()

    rec.status = FollowUpStatus.BOOKED.value
    rec.booked_appointment_id = appt.id
    session.flush()

    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        action=AuditAction.FOLLOW_UP_BOOKED,
        entity_type="follow_up_recommendation",
        entity_id=rec.id,
        after={
            "booked_appointment_id": appt.id,
            "status": rec.status,
            "appointment_date": appt_date.isoformat(),
            "token_number": token_num,
        },
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
        raise ApiError(status_code=404, code="follow_up_not_found", message="Follow-up recommendation not found.")

    if rec.status != FollowUpStatus.PENDING.value:
        raise ApiError(
            status_code=409,
            code="invalid_status",
            message=f"Cannot close follow-up with status '{rec.status}'. Only PENDING recommendations can be closed.",
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
    rec.closed_at = datetime.now(timezone.utc)
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
