"""Appointment booking and queue retrieval endpoints (APT-01, APT-02)."""

from datetime import date

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select

from kalyan_api.core.errors import ApiError
from kalyan_api.core.permissions import Permission, Role
from kalyan_api.core.policy import require
from kalyan_api.core.principal import (
    Principal,
    build_audit_context,
    current_principal,
    get_current_settings,
)
from kalyan_api.db.session import SessionDep
from kalyan_api.models import Appointment, AppointmentStatus, Doctor, Patient
from kalyan_api.schemas.appointments import (
    AppointmentCreate,
    AppointmentListResponse,
    AppointmentRead,
)
from kalyan_api.services import audit_service, token_service
from kalyan_api.services.audit_service import AuditAction

router = APIRouter(prefix="/appointments", tags=["appointments"])


def _to_read_schema(appt: Appointment) -> AppointmentRead:
    """Format an Appointment entity to its read schema."""
    return AppointmentRead(
        id=appt.id,
        patient_id=appt.patient_id,
        patient_urn=appt.patient.urn,
        patient_name=appt.patient.full_name,
        patient_mobile=appt.patient.mobile,
        doctor_id=appt.doctor_id,
        doctor_name_en=appt.doctor.name_en,
        doctor_name_hi=appt.doctor.name_hi,
        appointment_date=appt.appointment_date,
        token_number=appt.token_number,
        status=appt.status,
        status_updated_at=appt.status_updated_at,
        cancellation_reason=appt.cancellation_reason,
        notes=appt.notes,
        version_id=appt.version_id,
        created_at=appt.created_at,
        updated_at=appt.updated_at,
    )


@router.post(
    "",
    response_model=AppointmentRead,
    status_code=201,
    dependencies=[Depends(require(Permission.APPOINTMENT_WRITE))],
)
def book_appointment(
    payload: AppointmentCreate,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
    settings=Depends(get_current_settings),
) -> AppointmentRead:
    """Book a per-doctor daily appointment with atomic token generation (APT-01)."""
    # 1. Validate active patient exists
    patient = session.get(Patient, payload.patient_id)
    if not patient or not patient.is_active:
        raise ApiError(
            status_code=404,
            code="patient_not_found",
            message="Patient not found or inactive.",
        )

    # 2. Validate active doctor exists
    doctor = session.get(Doctor, payload.doctor_id)
    if not doctor or not doctor.is_active:
        raise ApiError(
            status_code=404,
            code="doctor_not_found",
            message="Doctor not found or inactive.",
        )

    # 3. Generate sequential token for (doctor_id, appointment_date)
    token_num = token_service.generate_next_daily_token(
        session, payload.doctor_id, payload.appointment_date
    )

    # 4. Create appointment
    appt = Appointment(
        patient_id=payload.patient_id,
        doctor_id=payload.doctor_id,
        appointment_date=payload.appointment_date,
        token_number=token_num,
        status=AppointmentStatus.BOOKED.value,
        notes=payload.notes,
        created_by_user_id=principal.user_id,
    )
    session.add(appt)
    session.flush()

    # 5. Audit creation
    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        action=AuditAction.APPOINTMENT_CREATED,
        entity_type="appointment",
        entity_id=appt.id,
        after={
            "patient_id": appt.patient_id,
            "patient_urn": patient.urn,
            "doctor_id": appt.doctor_id,
            "appointment_date": appt.appointment_date.isoformat(),
            "token_number": appt.token_number,
            "status": appt.status,
        },
    )

    return _to_read_schema(appt)


@router.get(
    "",
    response_model=AppointmentListResponse,
    dependencies=[Depends(require(Permission.APPOINTMENT_READ))],
)
def list_appointments(
    session: SessionDep,
    appointment_date: date | None = Query(None, description="Filter by appointment date"),
    doctor_id: int | None = Query(None, description="Filter by doctor ID"),
    patient_id: int | None = Query(None, description="Filter by patient ID"),
    status: AppointmentStatus | None = Query(None, description="Filter by status"),
    principal: Principal = Depends(current_principal),
) -> AppointmentListResponse:
    """List appointments filtered by date, doctor, patient or status (APT-02)."""
    stmt = select(Appointment)

    # Scoping: if logged-in user is DOCTOR and hasn't explicitly filtered, scope to their doctor_id
    if principal.role == Role.DOCTOR and principal.doctor_id is not None:
        if doctor_id is None:
            doctor_id = principal.doctor_id
        elif doctor_id != principal.doctor_id:
            # Doctor cannot view another doctor's appointments
            raise ApiError(
                status_code=403,
                code="scope_forbidden",
                message="Doctors can only inspect their own appointments.",
            )

    if doctor_id is not None:
        stmt = stmt.where(Appointment.doctor_id == doctor_id)
    if appointment_date is not None:
        stmt = stmt.where(Appointment.appointment_date == appointment_date)
    if patient_id is not None:
        stmt = stmt.where(Appointment.patient_id == patient_id)
    if status is not None:
        stmt = stmt.where(Appointment.status == status.value)

    stmt = stmt.order_by(Appointment.appointment_date.desc(), Appointment.token_number.asc())
    results = session.execute(stmt).scalars().all()

    return AppointmentListResponse(
        total=len(results),
        appointments=[_to_read_schema(a) for a in results],
    )


@router.get(
    "/{id}",
    response_model=AppointmentRead,
    dependencies=[Depends(require(Permission.APPOINTMENT_READ))],
)
def get_appointment(
    id: int,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> AppointmentRead:
    """Retrieve an appointment by ID."""
    appt = session.get(Appointment, id)
    if not appt:
        raise ApiError(
            status_code=404,
            code="appointment_not_found",
            message="Appointment not found.",
        )

    # Role scope check for DOCTOR
    if (
        principal.role == Role.DOCTOR
        and principal.doctor_id is not None
        and appt.doctor_id != principal.doctor_id
    ):
        raise ApiError(
            status_code=404,
            code="appointment_not_found",
            message="Appointment not found.",
        )

    return _to_read_schema(appt)
