"""Appointment booking and queue retrieval endpoints (APT-01, APT-02)."""

from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import String, and_, case, cast, func, or_, select
from sqlalchemy.orm import selectinload

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
from kalyan_api.models import (
    AllergyStatus,
    Appointment,
    AppointmentSource,
    AppointmentStatus,
    ConsultationStatus,
    Doctor,
    Patient,
    PatientAllergy,
    PriorityLevel,
    ReferralSource,
    Visit,
    VisitKind,
)
from kalyan_api.schemas.appointments import (
    AcknowledgeAlertRequest,
    AppointmentBucketCounts,
    AppointmentCreate,
    AppointmentListResponse,
    AppointmentRead,
    AppointmentStatusUpdate,
    CheckInDetailsIn,
    CheckInRequest,
    DoctorQueueItem,
    DoctorQueueResponse,
    NewPatientCheckIn,
    PriorityUpdate,
    ReassignRequest,
    RescheduleRequest,
    WalkInCreate,
)
from kalyan_api.services import (
    audit_service,
    booking_service,
    idempotency_service,
    ledger_service,
    patient_service,
    token_service,
)
from kalyan_api.services.appointment_service import validate_status_update
from kalyan_api.services.audit_service import AuditAction

# The booking locks moved to booking_service (RF-12); other routers and tests import them from here.
from kalyan_api.services.booking_service import (  # noqa: F401
    lock_department_for_booking,
    lock_doctor_for_booking,
)

router = APIRouter(prefix="/appointments", tags=["appointments"])
doctor_router = APIRouter(prefix="/doctor", tags=["doctor"])

_NOT_COMPLETED_CONSULTATION = or_(
    Appointment.consultation_status.is_(None),
    Appointment.consultation_status != ConsultationStatus.COMPLETED.value,
)
_COMPLETED_PRED = or_(
    Appointment.status.in_((AppointmentStatus.DONE.value, AppointmentStatus.COMPLETED.value)),
    Appointment.consultation_status == ConsultationStatus.COMPLETED.value,
)
_TO_ARRIVE_PRED = and_(
    Appointment.status.in_(
        (
            AppointmentStatus.BOOKED.value,
            AppointmentStatus.TO_ARRIVE.value,
            AppointmentStatus.REGISTERED.value,
        )
    ),
    _NOT_COMPLETED_CONSULTATION,
)
_CHECKED_IN_PRED = and_(
    Appointment.status.in_(
        (
            AppointmentStatus.ARRIVED.value,
            AppointmentStatus.CHECKED_IN.value,
            AppointmentStatus.WAITING.value,
            AppointmentStatus.IN_CONSULTATION.value,
        )
    ),
    _NOT_COMPLETED_CONSULTATION,
)
_NO_SHOW_PRED = and_(
    Appointment.status == AppointmentStatus.NO_SHOW.value,
    _NOT_COMPLETED_CONSULTATION,
)
_CANCELLED_PRED = and_(
    Appointment.status == AppointmentStatus.CANCELLED.value,
    _NOT_COMPLETED_CONSULTATION,
)
_ACTIVE_PRED = or_(_TO_ARRIVE_PRED, _CHECKED_IN_PRED)

_BUCKET_PREDICATES = {
    "active": _ACTIVE_PRED,
    "to_arrive": _TO_ARRIVE_PRED,
    "checked_in": _CHECKED_IN_PRED,
    "completed": _COMPLETED_PRED,
    "no_show": _NO_SHOW_PRED,
    "cancelled": _CANCELLED_PRED,
}


def _escape_like(term: str) -> str:
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _begin_idempotency(
    session: SessionDep,
    request: Request,
    principal: Principal,
    endpoint_key: str,
    payload: BaseModel,
) -> tuple[str | None, str | None, JSONResponse | None]:
    """Check optional Idempotency-Key before mutating; return a replay response when found."""
    idem_key = idempotency_service.extract_idempotency_key(request)
    if idem_key is None:
        return None, None, None
    req_hash = idempotency_service.hash_payload(payload)
    replay = idempotency_service.begin_idempotent_request(
        session,
        actor_user_id=principal.user_id,
        endpoint_key=endpoint_key,
        idempotency_key=idem_key,
        request_hash=req_hash,
    )
    if replay is not None:
        return (
            idem_key,
            req_hash,
            JSONResponse(status_code=replay.status_code, content=replay.body),
        )
    return idem_key, req_hash, None


def _store_idempotency(
    session: SessionDep,
    principal: Principal,
    endpoint_key: str,
    idem_key: str | None,
    req_hash: str | None,
    response_status: int,
    read_schema: BaseModel,
) -> None:
    """Flush a 2xx response into the active transaction when an Idempotency-Key was supplied."""
    if idem_key is None or req_hash is None:
        return
    idempotency_service.store_idempotent_response(
        session,
        actor_user_id=principal.user_id,
        endpoint_key=endpoint_key,
        idempotency_key=idem_key,
        request_hash=req_hash,
        response_status=response_status,
        response_body=read_schema.model_dump(mode="json"),
    )


def _check_in_details(payload: CheckInDetailsIn) -> booking_service.CheckInDetails:
    """The check-in desk's confirmations, as the booking service takes them (phase 22)."""
    return booking_service.CheckInDetails(
        referral_source=payload.referral_source.value,
        referrer_name=payload.referrer_name,
        visit_kind=payload.visit_kind.value if payload.visit_kind else None,
        priority_level=payload.priority_level.value,
        priority_reason=payload.priority_reason,
    )


_SUGGESTED_RANK = {
    PriorityLevel.EMERGENCY.value: 0,
    PriorityLevel.PRIORITY.value: 1,
    PriorityLevel.NORMAL.value: 2,
}


def _suggested_order_key(item: DoctorQueueItem) -> tuple[int, object, int]:
    """Sort key for the waiting list: EMERGENCY first by when it was classified, then by token."""
    rank = _SUGGESTED_RANK.get(item.priority_level, _SUGGESTED_RANK[PriorityLevel.NORMAL.value])
    token = item.token_number or 0
    if rank == 0:
        return (0, item.priority_updated_at or item.status_updated_at, token)
    return (rank, token, 0)


def _to_read_schema(appt: Appointment, visit: Visit | None = None) -> AppointmentRead:
    """Format an Appointment entity to its read schema; the visit adds its referral."""
    return AppointmentRead(
        id=appt.id,
        patient_id=appt.patient_id,
        patient_urn=appt.patient.urn,
        patient_name=appt.patient.full_name,
        patient_mobile=appt.patient.mobile,
        patient_age=appt.patient.age_years,
        doctor_id=appt.doctor_id,
        department_id=appt.department_id,
        doctor_name_en=appt.doctor.name_en,
        doctor_name_hi=appt.doctor.name_hi,
        department_name=appt.department.name_en if appt.department is not None else None,
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
        visit_kind=appt.visit_kind,
        priority_level=appt.priority_level,
        priority_reason=appt.priority_reason,
        priority_updated_at=appt.priority_updated_at,
        emergency_alerted_at=appt.emergency_alerted_at,
        alert_acknowledged_at=appt.alert_acknowledged_at,
        referral_source=visit.referral_source if visit is not None else None,
        referrer_name=visit.referrer_name if visit is not None else None,
        version_id=appt.version_id,
        created_at=appt.created_at,
        updated_at=appt.updated_at,
    )


def _record_booking_created(
    session,
    ctx,
    appt: Appointment,
    override_text: str | None = None,
    *,
    pre_check_in: bool = False,
) -> None:
    """Audit the creation of a booking; the keys of the original row are kept as they were."""
    after: dict[str, object] = {
        "patient_id": appt.patient_id,
        "patient_urn": appt.patient.urn,
        "doctor_id": appt.doctor_id,
        "department_id": appt.department_id,
        "appointment_date": appt.appointment_date.isoformat(),
        "token_number": None if pre_check_in else appt.token_number,
        "status": AppointmentStatus.BOOKED.value if pre_check_in else appt.status,
    }
    if pre_check_in:
        after["consultation_status"] = None
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
            "visit_kind": appt.visit_kind,
            "priority_level": appt.priority_level,
            "priority_reason": appt.priority_reason,
            "referral_source": result.visit.referral_source,
            "referrer_name": result.visit.referrer_name,
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
) -> AppointmentRead | JSONResponse:
    """Book a per-doctor daily appointment (APT-01).

    The booking has no token: it is issued at check-in (RF-12, owner decision 7), so queue
    order follows arrival.
    """
    if principal.role == Role.DOCTOR and (
        principal.doctor_id is None or payload.doctor_id != principal.doctor_id
    ):
        raise ApiError(
            status_code=403,
            code="scope_forbidden",
            message="Doctors can only book appointments for themselves.",
        )
    endpoint_key = "POST:/appointments"
    idem_key, req_hash, replay = _begin_idempotency(
        session, request, principal, endpoint_key, payload
    )
    if replay is not None:
        return replay

    issue_tok = bool(payload.issue_token)
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
        issue_token=issue_tok,
    )
    if issue_tok:
        appt.status = AppointmentStatus.TO_ARRIVE.value
        appt.priority_level = payload.priority_level.value
        appt.priority_reason = payload.priority_reason.strip() if payload.priority_reason else None
        session.flush()
    override_text = (payload.override_reason or "").strip() or None
    _record_booking_created(session, build_audit_context(request, principal), appt, override_text)
    read_schema = _to_read_schema(appt)
    _store_idempotency(session, principal, endpoint_key, idem_key, req_hash, 201, read_schema)
    return read_schema


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
) -> AppointmentRead | JSONResponse:
    """Register a walk-in: a booking for today checked in at once, with its token (RF-12)."""
    endpoint_key = "POST:/appointments/walk-in"
    idem_key, req_hash, replay = _begin_idempotency(
        session, request, principal, endpoint_key, payload
    )
    if replay is not None:
        return replay

    result = booking_service.walk_in(
        session,
        principal,
        patient_id=payload.patient_id,
        doctor_id=payload.doctor_id,
        department_id=payload.department_id,
        notes=payload.notes,
        override_reason=payload.override_reason,
        details=_check_in_details(payload),
    )
    ctx = build_audit_context(request, principal)
    appt = result.appointment
    override_text = (payload.override_reason or "").strip() or None
    # The booking was created with status BOOKED and no token; record it as it was created.
    _record_booking_created(session, ctx, appt, override_text, pre_check_in=True)
    _record_check_in(
        session,
        ctx,
        result,
        before={"status": AppointmentStatus.BOOKED.value, "consultation_status": None},
    )
    read_schema = _to_read_schema(appt, result.visit)
    _store_idempotency(session, principal, endpoint_key, idem_key, req_hash, 201, read_schema)
    return read_schema


@router.post(
    "/walk-in/new-patient",
    response_model=AppointmentRead,
    status_code=201,
    # Registers the patient and checks them in: both rights, in one policy marker.
    dependencies=[Depends(require(Permission.PATIENT_CREATE, Permission.VISIT_WRITE))],
)
def check_in_new_patient(
    payload: NewPatientCheckIn,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> AppointmentRead | JSONResponse:
    """Register a first-time patient and check them in, all or nothing (OD-22-03).

    One transaction: permanent URN and patient record, today's visit, the consultation with
    the chosen doctor and its token. If any step is refused, nothing is saved.
    """
    endpoint_key = "POST:/appointments/walk-in/new-patient"
    idem_key, req_hash, replay = _begin_idempotency(
        session, request, principal, endpoint_key, payload
    )
    if replay is not None:
        return replay

    if payload.to_arrive:
        doctor = lock_doctor_for_booking(session, payload.doctor_id)
        if not doctor or not doctor.is_active:
            raise ApiError(
                status_code=404,
                code="doctor_not_found",
                message="Doctor not found or inactive.",
            )
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

    patient = patient_service.create_patient(session, payload.patient)
    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        AuditAction.PATIENT_REGISTERED,
        "PATIENT",
        str(patient.id),
        after=patient_service.registration_audit_after(patient),
    )
    if payload.to_arrive:
        token = token_service.generate_next_daily_token(
            session, payload.doctor_id, clock.ist_today()
        )
        now = clock.utcnow()
        appt = Appointment(
            patient_id=patient.id,
            doctor_id=payload.doctor_id,
            department_id=payload.department_id,
            appointment_date=clock.ist_today(),
            token_number=token,
            status=AppointmentStatus.TO_ARRIVE.value,
            status_updated_at=now,
            source=AppointmentSource.WALK_IN.value,
            visit_kind=VisitKind.NEW.value,
            priority_level=payload.priority_level.value,
            priority_reason=payload.priority_reason,
            notes=payload.notes,
            created_by_user_id=principal.user_id,
        )
        session.add(appt)
        session.flush()
        _record_booking_created(session, ctx, appt)
        read_schema = _to_read_schema(appt)
        _store_idempotency(session, principal, endpoint_key, idem_key, req_hash, 201, read_schema)
        return read_schema

    result = booking_service.walk_in(
        session,
        principal,
        patient_id=patient.id,
        doctor_id=payload.doctor_id,
        department_id=payload.department_id,
        notes=payload.notes,
        details=_check_in_details(payload),
    )
    appt = result.appointment
    _record_booking_created(session, ctx, appt, pre_check_in=True)
    _record_check_in(
        session,
        ctx,
        result,
        before={"status": AppointmentStatus.BOOKED.value, "consultation_status": None},
    )
    read_schema = _to_read_schema(appt, result.visit)
    _store_idempotency(session, principal, endpoint_key, idem_key, req_hash, 201, read_schema)
    return read_schema


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
) -> AppointmentRead | JSONResponse:
    """Check a booked patient in on arrival: visit, token and waiting list (RF-12)."""
    endpoint_key = f"POST:/appointments/{id}/check-in"
    idem_key, req_hash, replay = _begin_idempotency(
        session, request, principal, endpoint_key, payload
    )
    if replay is not None:
        return replay

    appt = booking_service.lock_appointment(session, id)
    if not appt:
        raise ApiError(
            status_code=404, code="appointment_not_found", message="Appointment not found."
        )
    require_version(appt, payload.version_id, label="appointment")
    before = {
        "status": appt.status,
        "consultation_status": appt.consultation_status,
        "version_id": appt.version_id,
    }

    result = booking_service.check_in(
        session,
        appt,
        principal,
        _check_in_details(payload),
        expected_patient_id=payload.patient_id,
    )
    _record_check_in(session, build_audit_context(request, principal), result, before=before)
    read_schema = _to_read_schema(appt, result.visit)
    _store_idempotency(session, principal, endpoint_key, idem_key, req_hash, 200, read_schema)
    return read_schema


@router.patch(
    "/{id}/priority",
    response_model=AppointmentRead,
    dependencies=[Depends(require(Permission.VISIT_WRITE))],
)
def update_priority(
    id: int,
    payload: PriorityUpdate,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> AppointmentRead:
    """Mark a checked-in patient Normal, Priority or Emergency, with a reason (OD-22-06).

    The token and the place in the consultation are untouched. Each change is kept in the
    classification history and the audit log; Emergency raises an alert for the doctor.
    """
    appt = booking_service.lock_appointment(session, id)
    if not appt:
        raise ApiError(
            status_code=404, code="appointment_not_found", message="Appointment not found."
        )
    require_version(appt, payload.version_id, label="appointment")
    before = {
        "priority_level": appt.priority_level,
        "priority_reason": appt.priority_reason,
        "version_id": appt.version_id,
    }
    changed = booking_service.classify(
        session, appt, principal, payload.priority_level.value, payload.priority_reason
    )
    if changed:
        audit_service.record(
            session,
            build_audit_context(request, principal),
            action=AuditAction.APPOINTMENT_PRIORITY_CHANGED,
            entity_type="appointment",
            entity_id=appt.id,
            before=before,
            after={
                "priority_level": appt.priority_level,
                "priority_reason": appt.priority_reason,
                "emergency": appt.priority_level == PriorityLevel.EMERGENCY.value,
                "version_id": appt.version_id,
            },
            reason=appt.priority_reason,
        )
    return _to_read_schema(appt)


@router.post(
    "/{id}/acknowledge-alert",
    response_model=AppointmentRead,
    dependencies=[Depends(require(Permission.DASHBOARD_DOCTOR))],
)
def acknowledge_emergency_alert(
    id: int,
    payload: AcknowledgeAlertRequest,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> AppointmentRead:
    """The assigned doctor acknowledges an emergency alert on their own consultation (OD-22-09).

    The alert stays visible until this is called. The time and the doctor are kept.
    """
    if principal.role != Role.DOCTOR or principal.doctor_id is None:
        raise ApiError(
            status_code=403,
            code="doctor_only",
            message="Only doctors can acknowledge an emergency alert.",
        )
    appt = booking_service.lock_appointment(session, id)
    if not appt or appt.doctor_id != principal.doctor_id:
        raise ApiError(
            status_code=404,
            code="appointment_not_found",
            message="Appointment not found.",
        )
    require_version(appt, payload.version_id, label="appointment")
    before = {
        "alert_acknowledged_at": appt.alert_acknowledged_at.isoformat()
        if appt.alert_acknowledged_at
        else None,
        "version_id": appt.version_id,
    }
    booking_service.acknowledge_alert(session, appt, principal)
    audit_service.record(
        session,
        build_audit_context(request, principal),
        action=AuditAction.APPOINTMENT_ALERT_ACKNOWLEDGED,
        entity_type="appointment",
        entity_id=appt.id,
        before=before,
        after={
            "alert_acknowledged_at": appt.alert_acknowledged_at.isoformat(),
            "version_id": appt.version_id,
        },
        reason=None,
    )
    return _to_read_schema(appt)


@router.post(
    "/{id}/reassign",
    response_model=AppointmentRead,
    status_code=201,
    dependencies=[Depends(require(Permission.VISIT_WRITE))],
)
def reassign_appointment(
    id: int,
    payload: ReassignRequest,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> AppointmentRead:
    """Move a waiting patient to another doctor on the same visit (QUE-10, design §5).

    Reception only. The old consultation is kept as cancelled with the reason; the new one is
    returned (201) with a token from the new doctor's sequence.
    """
    appt = booking_service.lock_appointment(session, id)
    if not appt:
        raise ApiError(
            status_code=404,
            code="appointment_not_found",
            message="Appointment not found.",
        )
    require_version(appt, payload.version_id, label="appointment")
    before = {
        "status": appt.status,
        "consultation_status": appt.consultation_status,
        "doctor_id": appt.doctor_id,
        "department_id": appt.department_id,
        "token_number": appt.token_number,
        "version_id": appt.version_id,
    }
    successor = booking_service.reassign_waiting(
        session,
        appt,
        principal,
        new_doctor_id=payload.new_doctor_id,
        reason=payload.reason,
        new_department_id=payload.new_department_id,
    )
    audit_service.record(
        session,
        build_audit_context(request, principal),
        action=AuditAction.APPOINTMENT_REASSIGNED,
        entity_type="appointment",
        entity_id=appt.id,
        before=before,
        after={
            "status": appt.status,
            "consultation_status": appt.consultation_status,
            "successor_appointment_id": successor.id,
            "to_doctor_id": successor.doctor_id,
            "to_department_id": successor.department_id,
            "to_token_number": successor.token_number,
            "version_id": appt.version_id,
        },
        reason=payload.reason.strip(),
    )
    return _to_read_schema(successor)


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
    limit: int = Query(default=500, ge=1, le=500, description="Maximum rows to return"),
    offset: int = Query(default=0, ge=0, description="Number of rows to skip"),
    sort_by: Literal["token", "time"] = Query(
        default="token", description="Sort order: token or expected time"
    ),
    search: str | None = Query(
        default=None,
        description="Case-insensitive filter across patient, doctor, or token",
    ),
    status_bucket: Literal[
        "active", "to_arrive", "checked_in", "completed", "no_show", "cancelled", "all"
    ]
    | None = Query(default=None, description="Canonical operational status bucket"),
    principal: Principal = Depends(current_principal),
) -> AppointmentListResponse:
    """List appointments filtered by date, doctor, patient, search or status bucket (APT-02)."""
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

    base_filters = []
    if doctor_id is not None:
        base_filters.append(Appointment.doctor_id == doctor_id)
    if appointment_date is not None:
        base_filters.append(Appointment.appointment_date == appointment_date)
    if patient_id is not None:
        base_filters.append(Appointment.patient_id == patient_id)
    if status is not None:
        base_filters.append(Appointment.status == status.value)

    counts_stmt = select(
        func.count(Appointment.id).label("all_count"),
        func.coalesce(func.sum(case((_TO_ARRIVE_PRED, 1), else_=0)), 0).label("to_arrive"),
        func.coalesce(func.sum(case((_CHECKED_IN_PRED, 1), else_=0)), 0).label("checked_in"),
        func.coalesce(func.sum(case((_COMPLETED_PRED, 1), else_=0)), 0).label("completed"),
        func.coalesce(func.sum(case((_NO_SHOW_PRED, 1), else_=0)), 0).label("no_show"),
        func.coalesce(func.sum(case((_CANCELLED_PRED, 1), else_=0)), 0).label("cancelled"),
    ).select_from(Appointment)
    stmt = select(Appointment)

    search_term = (search or "").strip()
    if search_term:
        pattern = f"%{_escape_like(search_term)}%"
        counts_stmt = counts_stmt.join(Patient, Appointment.patient_id == Patient.id).join(
            Doctor, Appointment.doctor_id == Doctor.id
        )
        stmt = stmt.join(Patient, Appointment.patient_id == Patient.id).join(
            Doctor, Appointment.doctor_id == Doctor.id
        )
        search_clauses = [
            Patient.full_name.ilike(pattern, escape="\\"),
            Patient.urn.ilike(pattern, escape="\\"),
            Patient.mobile.ilike(pattern, escape="\\"),
            Doctor.name_en.ilike(pattern, escape="\\"),
            Doctor.name_hi.ilike(pattern, escape="\\"),
        ]
        # Match numeric tokens ("5", "#5", "05") exactly and formatted cabin tokens ("A-5", "A-05").
        raw_token = search_term.lstrip("#")
        if raw_token.isascii() and raw_token.isdigit():
            token_int = int(raw_token)
            if 1 <= token_int <= 2_147_483_647:
                search_clauses.append(
                    and_(
                        Appointment.token_number.is_not(None),
                        Appointment.token_number == token_int,
                    )
                )
        else:
            token_str = cast(Appointment.token_number, String)
            padded_token_str = case(
                (Appointment.token_number < 10, func.concat("0", token_str)),
                else_=token_str,
            )
            cabin_token = func.concat(Doctor.cabin_code, "-", token_str)
            cabin_token_padded = func.concat(Doctor.cabin_code, "-", padded_token_str)
            hash_token = func.concat("#", token_str)
            search_clauses.append(
                and_(
                    Appointment.token_number.is_not(None),
                    or_(
                        and_(
                            Doctor.cabin_code.is_not(None),
                            or_(
                                cabin_token.ilike(pattern, escape="\\"),
                                cabin_token_padded.ilike(pattern, escape="\\"),
                            ),
                        ),
                        hash_token.ilike(pattern, escape="\\"),
                    ),
                )
            )
        base_filters.append(or_(*search_clauses))

    if base_filters:
        counts_stmt = counts_stmt.where(*base_filters)
        stmt = stmt.where(*base_filters)

    counts_row = session.execute(counts_stmt).one()
    to_arrive_count = int(counts_row.to_arrive)
    checked_in_count = int(counts_row.checked_in)
    bucket_counts = AppointmentBucketCounts(
        active=to_arrive_count + checked_in_count,
        to_arrive=to_arrive_count,
        checked_in=checked_in_count,
        completed=int(counts_row.completed),
        no_show=int(counts_row.no_show),
        cancelled=int(counts_row.cancelled),
        all=int(counts_row.all_count),
    )

    if status_bucket is not None and status_bucket != "all":
        stmt = stmt.where(_BUCKET_PREDICATES[status_bucket])
        total = getattr(bucket_counts, status_bucket)
    else:
        total = bucket_counts.all

    if sort_by == "time":
        stmt = stmt.order_by(
            Appointment.appointment_date.desc(),
            Appointment.expected_time.asc().nulls_last(),
            Appointment.token_number.asc().nulls_last(),
            Appointment.id.asc(),
        )
    else:
        stmt = stmt.order_by(
            Appointment.appointment_date.desc(),
            Appointment.token_number.asc().nulls_last(),
            Appointment.expected_time.asc().nulls_last(),
            Appointment.id.asc(),
        )

    stmt = stmt.offset(offset).limit(limit)
    results = session.execute(stmt).scalars().all()

    return AppointmentListResponse(
        total=total,
        appointments=[_to_read_schema(a) for a in results],
        limit=limit,
        offset=offset,
        bucket_counts=bucket_counts,
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
    """Transition appointment status with optimistic locking and validation (APT-02).

    Since RF-12 slice 2 an ARRIVED or CHECKED_IN request is a check-in (visit, token,
    waiting list), and a checked-in patient only moves through the consultation.
    See validate_status_update.
    """
    appt = booking_service.lock_appointment(session, id)
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
    ctx = build_audit_context(request, principal)
    before = {
        "status": appt.status,
        "consultation_status": appt.consultation_status,
        "version_id": payload.version_id,
    }

    if payload.status in (AppointmentStatus.ARRIVED, AppointmentStatus.CHECKED_IN):
        # Referred By is required on every visit and defaults to Self (OD-22-16). This path has
        # no desk form, so the visit is opened with the default instead of having no referral.
        default_details = booking_service.CheckInDetails(referral_source=ReferralSource.SELF.value)
        result = booking_service.check_in(session, appt, principal, default_details)
        _record_check_in(session, ctx, result, before=before)
    else:
        consultation_target = validate_status_update(
            session, appt, payload.status, principal, payload.cancellation_reason
        )
        appt.status = payload.status.value
        appt.status_updated_at = clock.utcnow()
        if consultation_target is not None:
            appt.consultation_status = consultation_target.value
        if payload.cancellation_reason is not None:
            appt.cancellation_reason = payload.cancellation_reason
        appt.version_id += 1
        session.flush()
        if (
            appt.consultation_status == ConsultationStatus.CANCELLED.value
            or appt.status == AppointmentStatus.CANCELLED.value
        ):
            ledger_service.void_appointment_charges(
                session,
                appt,
                reason=payload.cancellation_reason,
                actor_user_id=principal.user_id,
                occurred_at=appt.status_updated_at,
            )

    audit_service.record(
        session,
        ctx,
        action=AuditAction.APPOINTMENT_STATUS_UPDATED,
        entity_type="appointment",
        entity_id=appt.id,
        before=before,
        after={
            "status": appt.status,
            "consultation_status": appt.consultation_status,
            "version_id": appt.version_id,
        },
        reason=payload.cancellation_reason,
    )

    return _to_read_schema(appt)


_NO_ALLERGY_TOKENS = {
    "none",
    "none reported",
    "nkda",
    "nka",
    "nil",
    "no",
    "no known allergies",
    "-",
}


def _format_queue_allergies(
    legacy_allergies: str | None, structured: list[PatientAllergy]
) -> str | None:
    """Merge active structured PatientAllergy rows with meaningful legacy Patient.allergies."""
    if not structured:
        return legacy_allergies
    parts: list[str] = []
    seen_lower: set[str] = set()
    for allergy in structured:
        substance = allergy.substance.strip()
        if not substance or substance.lower() in seen_lower:
            continue
        seen_lower.add(substance.lower())
        if allergy.severity in ("SEVERE", "LIFE_THREATENING"):
            sev_label = allergy.severity.replace("_", " ").title()
            parts.append(f"{substance} ({sev_label})")
        else:
            parts.append(substance)
    legacy_trimmed = (legacy_allergies or "").strip()
    if (
        legacy_trimmed
        and legacy_trimmed.lower() not in _NO_ALLERGY_TOKENS
        and legacy_trimmed.lower() not in seen_lower
    ):
        parts.append(legacy_trimmed)
    return ", ".join(parts) if parts else legacy_allergies


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
        .options(selectinload(Appointment.patient))
        .where(
            Appointment.doctor_id == principal.doctor_id,
            Appointment.appointment_date == today,
        )
        # Tokens are issued at check-in, so they follow arrival; bookings still waiting for their
        # patient have none and are ordered by the time the patient said they would come.
        .order_by(
            Appointment.token_number.asc().nulls_last(),
            Appointment.expected_time.asc().nulls_last(),
            Appointment.id.asc(),
        )
    )
    appointments = session.execute(stmt).scalars().all()

    # Batch-load active structured allergies for all queued patients (and merged aliases).
    allergies_by_patient: dict[int, list[PatientAllergy]] = {}
    queued_patient_ids = {a.patient_id for a in appointments}
    if queued_patient_ids:
        alias_rows = session.execute(
            select(Patient.id, Patient.merged_into_id).where(
                Patient.merged_into_id.in_(queued_patient_ids)
            )
        ).all()
        alias_to_master: dict[int, int] = {pid: pid for pid in queued_patient_ids}
        for alias_id, master_id in alias_rows:
            if master_id is not None:
                alias_to_master[alias_id] = master_id
        allergy_rows = (
            session.execute(
                select(PatientAllergy)
                .where(
                    PatientAllergy.patient_id.in_(alias_to_master.keys()),
                    PatientAllergy.status == AllergyStatus.ACTIVE.value,
                )
                .order_by(PatientAllergy.id.asc())
            )
            .scalars()
            .all()
        )
        for allergy in allergy_rows:
            master_id = alias_to_master.get(allergy.patient_id, allergy.patient_id)
            allergies_by_patient.setdefault(master_id, []).append(allergy)

    in_consultation: list[DoctorQueueItem] = []
    waiting: list[DoctorQueueItem] = []
    booked: list[DoctorQueueItem] = []
    completed: list[DoctorQueueItem] = []

    for a in appointments:
        if a.status == AppointmentStatus.RESCHEDULED.value:
            continue  # moved to another date; it has its own row there
        item = DoctorQueueItem(
            id=a.id,
            patient_id=a.patient_id,
            patient_urn=a.patient.urn,
            patient_name=a.patient.full_name,
            patient_gender=a.patient.gender,
            patient_age=a.patient.age_years,
            patient_mobile=a.patient.mobile,
            patient_allergies=_format_queue_allergies(
                a.patient.allergies, allergies_by_patient.get(a.patient_id, [])
            ),
            token_number=a.token_number,
            status=a.status,
            consultation_status=a.consultation_status,
            status_updated_at=a.status_updated_at,
            notes=a.notes,
            visit_kind=a.visit_kind,
            priority_level=a.priority_level,
            priority_reason=a.priority_reason,
            emergency_alerted_at=a.emergency_alerted_at,
            alert_acknowledged_at=a.alert_acknowledged_at,
            priority_updated_at=a.priority_updated_at,
            check_in_at=a.check_in_at,
            version_id=a.version_id,
        )
        if a.consultation_status == ConsultationStatus.IN_CONSULTATION.value:
            in_consultation.append(item)
        elif a.consultation_status == ConsultationStatus.WAITING.value or a.status in (
            AppointmentStatus.ARRIVED.value,
            AppointmentStatus.CHECKED_IN.value,
            AppointmentStatus.WAITING.value,
        ):
            waiting.append(item)
        elif a.status in (
            AppointmentStatus.BOOKED.value,
            AppointmentStatus.TO_ARRIVE.value,
            AppointmentStatus.REGISTERED.value,
        ):
            booked.append(item)
        elif (
            a.status in (AppointmentStatus.DONE.value, AppointmentStatus.COMPLETED.value)
            or a.consultation_status == ConsultationStatus.COMPLETED.value
        ):
            completed.append(item)

    # Suggested order (OD-22-07): EMERGENCY by classification time, then PRIORITY, then NORMAL,
    # each by token. The position is computed here and never stored; tokens never change.
    waiting.sort(key=_suggested_order_key)

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
