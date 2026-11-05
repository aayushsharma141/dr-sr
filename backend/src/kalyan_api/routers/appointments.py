"""Appointment booking and queue retrieval endpoints (APT-01, APT-02)."""

from datetime import date

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from kalyan_api import clock
from kalyan_api.core.errors import ApiError, require_version
from kalyan_api.core.permissions import Permission, Role
from kalyan_api.core.policy import require
from kalyan_api.core.principal import (
    Principal,
    build_audit_context,
    current_principal,
    get_current_settings,
)
from kalyan_api.db.session import SessionDep
from kalyan_api.models import Appointment, AppointmentStatus, Department, Doctor, Patient
from kalyan_api.schemas.appointments import (
    AppointmentCreate,
    AppointmentListResponse,
    AppointmentRead,
    AppointmentStatusUpdate,
    DoctorQueueItem,
    DoctorQueueResponse,
)
from kalyan_api.services import audit_service, token_service
from kalyan_api.services.appointment_service import validate_status_transition
from kalyan_api.services.audit_service import AuditAction

router = APIRouter(prefix="/appointments", tags=["appointments"])
doctor_router = APIRouter(prefix="/doctor", tags=["doctor"])


def lock_department_for_booking(session: Session, department_id: int) -> Department | None:
    """Read the department under a row lock, so a concurrent deactivation cannot slip past.

    Deactivation locks the same row, so either this read waits for it and sees is_active=False,
    or the deactivation waits for this booking to commit. Without the lock, a booking can read
    the department as active while it is being deactivated and still insert the appointment.
    """
    return session.scalar(
        select(Department).where(Department.id == department_id).with_for_update()
    )


def _to_read_schema(appt: Appointment) -> AppointmentRead:
    """Format an Appointment entity to its read schema."""
    return AppointmentRead(
        id=appt.id,
        patient_id=appt.patient_id,
        patient_urn=appt.patient.urn,
        patient_name=appt.patient.full_name,
        patient_mobile=appt.patient.mobile,
        doctor_id=appt.doctor_id,
        department_id=appt.department_id,
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

    # 3. Verify that the selected doctor belongs to the requested active department.
    department = lock_department_for_booking(session, payload.department_id)
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

    # 4. Generate sequential token for (doctor_id, appointment_date)
    token_num = token_service.generate_next_daily_token(
        session, payload.doctor_id, payload.appointment_date
    )

    # 5. Create appointment
    appt = Appointment(
        patient_id=payload.patient_id,
        doctor_id=payload.doctor_id,
        department_id=payload.department_id,
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
            "department_id": payload.department_id,
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

    # Role scope check for DOCTOR (D-04 doctor silo)
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


@router.patch(
    "/{id}/status",
    response_model=AppointmentRead,
    dependencies=[Depends(require(Permission.APPOINTMENT_WRITE))],
)
def update_appointment_status(
    id: int,
    payload: AppointmentStatusUpdate,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> AppointmentRead:
    """Transition appointment status with optimistic locking and validation (APT-02)."""
    appt = session.get(Appointment, id)
    if not appt:
        raise ApiError(
            status_code=404,
            code="appointment_not_found",
            message="Appointment not found.",
        )

    # Role scope check for DOCTOR (D-04 doctor silo)
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

    require_version(appt, payload.version_id, label="appointment")
    validate_status_transition(appt, payload.status, principal, payload.cancellation_reason)

    old_status = appt.status
    appt.status = payload.status.value
    appt.status_updated_at = clock.utcnow()
    if payload.cancellation_reason is not None:
        appt.cancellation_reason = payload.cancellation_reason
    appt.version_id += 1
    session.flush()

    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        action=AuditAction.APPOINTMENT_STATUS_UPDATED,
        entity_type="appointment",
        entity_id=appt.id,
        before={"status": old_status, "version_id": payload.version_id},
        after={"status": appt.status, "version_id": appt.version_id},
        reason=payload.cancellation_reason,
    )

    return _to_read_schema(appt)


@doctor_router.get(
    "/queue",
    response_model=DoctorQueueResponse,
    dependencies=[Depends(require(Permission.DASHBOARD_DOCTOR))],
)
@router.get(
    "/queue/today",
    response_model=DoctorQueueResponse,
    dependencies=[Depends(require(Permission.DASHBOARD_DOCTOR))],
)
def get_doctor_queue(
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> DoctorQueueResponse:
    """Retrieve today's consultation queue for the authenticated doctor (APT-02)."""
    if principal.role != Role.DOCTOR or principal.doctor_id is None:
        raise ApiError(
            status_code=403,
            code="doctor_only",
            message="Only authenticated doctors can inspect consultation queues.",
        )

    doctor = session.get(Doctor, principal.doctor_id)
    if not doctor:
        raise ApiError(status_code=404, code="doctor_not_found", message="Doctor not found.")

    today = clock.utcnow().date()

    # Query today's appointments for this doctor
    stmt = (
        select(Appointment)
        .where(
            Appointment.doctor_id == principal.doctor_id,
            Appointment.appointment_date == today,
        )
        .order_by(Appointment.token_number.asc())
    )
    appointments = session.execute(stmt).scalars().all()

    in_consultation: list[DoctorQueueItem] = []
    waiting: list[DoctorQueueItem] = []
    booked: list[DoctorQueueItem] = []
    completed: list[DoctorQueueItem] = []

    for a in appointments:
        item = DoctorQueueItem(
            id=a.id,
            patient_id=a.patient_id,
            patient_urn=a.patient.urn,
            patient_name=a.patient.full_name,
            patient_gender=a.patient.gender,
            patient_age=a.patient.age_years,
            patient_mobile=a.patient.mobile,
            patient_allergies=a.patient.allergies,
            token_number=a.token_number,
            status=a.status,
            status_updated_at=a.status_updated_at,
            notes=a.notes,
            version_id=a.version_id,
        )
        if a.status == AppointmentStatus.IN_CONSULTATION.value:
            in_consultation.append(item)
        elif a.status == AppointmentStatus.ARRIVED.value:
            waiting.append(item)
        elif a.status == AppointmentStatus.BOOKED.value:
            booked.append(item)
        else:
            completed.append(item)

    total_active = len(in_consultation) + len(waiting) + len(booked)

    return DoctorQueueResponse(
        doctor_id=doctor.id,
        doctor_name=doctor.name_en,
        queue_date=today,
        in_consultation=in_consultation,
        waiting=waiting,
        booked=booked,
        completed=completed,
        total_active=total_active,
    )
