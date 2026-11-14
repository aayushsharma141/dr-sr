"""Appointment booking and queue retrieval endpoints (APT-01, APT-02)."""

from datetime import date

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import select

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
from kalyan_api.models import Appointment, AppointmentStatus, Doctor
from kalyan_api.schemas.appointments import (
    AppointmentCreate,
    AppointmentListResponse,
    AppointmentRead,
    AppointmentStatusUpdate,
    CheckInRequest,
    DoctorQueueItem,
    DoctorQueueResponse,
    RescheduleRequest,
    WalkInCreate,
)
from kalyan_api.services import audit_service, booking_service
from kalyan_api.services.appointment_service import validate_status_transition
from kalyan_api.services.audit_service import AuditAction

# The booking locks moved to booking_service (RF-12); other routers and tests import them from here.
from kalyan_api.services.booking_service import (  # noqa: F401
    lock_department_for_booking,
    lock_doctor_for_booking,
)

router = APIRouter(prefix="/appointments", tags=["appointments"])
doctor_router = APIRouter(prefix="/doctor", tags=["doctor"])


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
        check_in_at=appt.check_in_at,
        cancellation_reason=appt.cancellation_reason,
        notes=appt.notes,
        source=appt.source,
        expected_time=appt.expected_time,
        visit_id=appt.visit_id,
        consultation_status=appt.consultation_status,
        rescheduled_from_id=appt.rescheduled_from_id,
        version_id=appt.version_id,
        created_at=appt.created_at,
        updated_at=appt.updated_at,
    )


def _record_booking_created(
    session, ctx, appt: Appointment, override_text: str | None = None
) -> None:
    """Audit the creation of a booking; the keys of the original row are kept as they were."""
    after: dict[str, object] = {
        "patient_id": appt.patient_id,
        "patient_urn": appt.patient.urn,
        "doctor_id": appt.doctor_id,
        "department_id": appt.department_id,
        "appointment_date": appt.appointment_date.isoformat(),
        "token_number": appt.token_number,
        "status": appt.status,
    }
    if appt.source:
        after["source"] = appt.source
    if appt.expected_time:
        after["expected_time"] = appt.expected_time.isoformat()
    if appt.rescheduled_from_id:
        after["rescheduled_from_id"] = appt.rescheduled_from_id
    if override_text:
        after["override_reason"] = override_text
    audit_service.record(
        session,
        ctx,
        action=AuditAction.APPOINTMENT_CREATED,
        entity_type="appointment",
        entity_id=appt.id,
        after=after,
    )


def _record_check_in(session, ctx, result: booking_service.CheckInResult, before: dict) -> None:
    """Audit a check-in, and the visit it opened when it opened one."""
    appt = result.appointment
    audit_service.record(
        session,
        ctx,
        action=AuditAction.APPOINTMENT_CHECKED_IN,
        entity_type="appointment",
        entity_id=appt.id,
        before=before,
        after={
            "status": appt.status,
            "consultation_status": appt.consultation_status,
            "token_number": appt.token_number,
            "visit_id": appt.visit_id,
            "version_id": appt.version_id,
        },
    )
    if result.visit_opened:
        audit_service.record(
            session,
            ctx,
            action=AuditAction.VISIT_OPENED,
            entity_type="visit",
            entity_id=result.visit.id,
            after={
                "patient_id": result.visit.patient_id,
                "visit_date": result.visit.visit_date.isoformat(),
                "opened_by_appointment_id": appt.id,
            },
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
    """Book a per-doctor daily appointment with atomic token generation (APT-01).

    Still issues the token at booking. RF-12 slice 2 moves that to check-in.
    """
    appt = booking_service.create_booking(
        session,
        principal,
        patient_id=payload.patient_id,
        doctor_id=payload.doctor_id,
        department_id=payload.department_id,
        appointment_date=payload.appointment_date,
        notes=payload.notes,
        override_reason=payload.override_reason,
        source=payload.source,
        expected_time=payload.expected_time,
        issue_token=True,
    )
    override_text = (payload.override_reason or "").strip() or None
    _record_booking_created(session, build_audit_context(request, principal), appt, override_text)
    return _to_read_schema(appt)


@router.post(
    "/walk-in",
    response_model=AppointmentRead,
    status_code=201,
    dependencies=[Depends(require(Permission.VISIT_WRITE))],
)
def register_walk_in(
    payload: WalkInCreate,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> AppointmentRead:
    """Register a walk-in: a booking for today checked in at once, with its token (RF-12)."""
    result = booking_service.walk_in(
        session,
        principal,
        patient_id=payload.patient_id,
        doctor_id=payload.doctor_id,
        department_id=payload.department_id,
        notes=payload.notes,
        override_reason=payload.override_reason,
    )
    ctx = build_audit_context(request, principal)
    appt = result.appointment
    override_text = (payload.override_reason or "").strip() or None
    # The booking was created with status BOOKED and no token; record it as it was created.
    _record_booking_created(session, ctx, appt, override_text)
    _record_check_in(session, ctx, result, before={"status": AppointmentStatus.BOOKED.value})
    return _to_read_schema(appt)


@router.post(
    "/{id}/check-in",
    response_model=AppointmentRead,
    dependencies=[Depends(require(Permission.VISIT_WRITE))],
)
def check_in_appointment(
    id: int,
    payload: CheckInRequest,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> AppointmentRead:
    """Check a booked patient in on arrival: visit, token and waiting list (RF-12)."""
    appt = booking_service.lock_appointment(session, id)
    if not appt:
        raise ApiError(
            status_code=404, code="appointment_not_found", message="Appointment not found."
        )
    require_version(appt, payload.version_id, label="appointment")
    before = {"status": appt.status, "version_id": appt.version_id}

    result = booking_service.check_in(session, appt, principal)
    _record_check_in(session, build_audit_context(request, principal), result, before=before)
    return _to_read_schema(appt)


@router.post(
    "/{id}/reschedule",
    response_model=AppointmentRead,
    status_code=201,
    dependencies=[Depends(require(Permission.APPOINTMENT_WRITE))],
)
def reschedule_appointment(
    id: int,
    payload: RescheduleRequest,
    request: Request,
    response: Response,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> AppointmentRead:
    """Move a booking to another date, keeping the old one in history (RF-12).

    Returns the new booking (201). A time-only change on the same date edits the booking in
    place and returns it (200).
    """
    appt = booking_service.lock_appointment(session, id)
    if not appt or (
        principal.role == Role.DOCTOR
        and principal.doctor_id is not None
        and appt.doctor_id != principal.doctor_id
    ):
        raise ApiError(
            status_code=404, code="appointment_not_found", message="Appointment not found."
        )
    require_version(appt, payload.version_id, label="appointment")
    before = {
        "status": appt.status,
        "appointment_date": appt.appointment_date.isoformat(),
        "expected_time": appt.expected_time.isoformat() if appt.expected_time else None,
    }

    old, new = booking_service.reschedule(
        session,
        appt,
        principal,
        new_date=payload.appointment_date,
        new_time=payload.expected_time,
    )

    ctx = build_audit_context(request, principal)
    after = {
        "status": old.status,
        "appointment_date": old.appointment_date.isoformat(),
        "expected_time": old.expected_time.isoformat() if old.expected_time else None,
    }
    if new is not None:
        after["new_appointment_id"] = new.id
        after["new_appointment_date"] = new.appointment_date.isoformat()
    audit_service.record(
        session,
        ctx,
        action=AuditAction.APPOINTMENT_RESCHEDULED,
        entity_type="appointment",
        entity_id=old.id,
        before=before,
        after=after,
        reason=(payload.reason or "").strip() or None,
    )
    if new is None:
        response.status_code = 200
        return _to_read_schema(old)
    _record_booking_created(session, ctx, new)
    return _to_read_schema(new)


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
    validate_status_transition(
        appt, payload.status, principal, payload.cancellation_reason, session=session
    )

    old_status = appt.status
    appt.status = payload.status.value
    appt.status_updated_at = clock.utcnow()
    if payload.status == AppointmentStatus.ARRIVED and appt.check_in_at is None:
        appt.check_in_at = clock.utcnow()
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

    today = clock.ist_today()

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
