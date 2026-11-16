"""Atomic lifecycle for new-patient arrivals before canonical patient registration."""

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from kalyan_api import clock
from kalyan_api.core.errors import ApiError, require_version
from kalyan_api.core.principal import Principal
from kalyan_api.models import (
    Appointment,
    AppointmentSource,
    AppointmentStatus,
    Patient,
    PendingOpdArrival,
    PriorityLevel,
    VisitKind,
)
from kalyan_api.schemas.opd_arrivals import (
    OpdArrivalCreate,
    OpdArrivalPriorityUpdate,
    OpdArrivalRegister,
)
from kalyan_api.services import audit_service, booking_service, patient_service, token_service
from kalyan_api.services.audit_service import AuditAction, AuditContext


def create_arrival(
    session: Session,
    principal: Principal,
    payload: OpdArrivalCreate,
    audit_context: AuditContext,
) -> PendingOpdArrival:
    """Persist minimum truthful intake data and reserve a doctor-specific token."""
    doctor = booking_service.lock_doctor_for_booking(session, payload.doctor_id)
    if doctor is None or not doctor.is_active:
        raise ApiError(
            status_code=404, code="doctor_not_found", message="Doctor not found or inactive."
        )
    department = booking_service.lock_department_for_booking(session, payload.department_id)
    if department is None:
        raise ApiError(
            status_code=422,
            code="department_not_found",
            message="Selected department does not exist.",
        )
    if not department.is_active:
        raise ApiError(
            status_code=422, code="department_inactive", message="Selected department is inactive."
        )
    if department not in doctor.departments:
        raise ApiError(
            status_code=422,
            code="doctor_department_mismatch",
            message="Selected doctor is not assigned to the selected department.",
        )
    if principal.doctor_id is not None and principal.doctor_id != doctor.id:
        raise ApiError(status_code=404, code="doctor_not_found", message="Doctor not found.")

    appointment_date = clock.ist_today()
    mobile = patient_service.clean_mobile(payload.mobile)
    pending_duplicate = session.scalar(
        select(PendingOpdArrival).where(
            PendingOpdArrival.mobile == mobile,
            PendingOpdArrival.doctor_id == doctor.id,
            PendingOpdArrival.appointment_date == appointment_date,
            PendingOpdArrival.status == "TO_ARRIVE",
        )
    )
    if pending_duplicate is not None:
        raise ApiError(
            status_code=409,
            code="duplicate_opd_arrival",
            message=(
                "This mobile number already has a pending arrival in this doctor’s queue today."
            ),
            details={
                "existing_arrival_id": pending_duplicate.id,
                "existing_token_number": pending_duplicate.token_number,
            },
        )

    existing_appointment = session.scalar(
        select(Appointment)
        .join(Patient, Patient.id == Appointment.patient_id)
        .where(
            Patient.mobile == mobile,
            Appointment.doctor_id == doctor.id,
            Appointment.appointment_date == appointment_date,
            Appointment.status.in_(booking_service.ACTIVE_BOOKING_STATUSES),
        )
    )
    if existing_appointment is not None:
        raise ApiError(
            status_code=409,
            code="duplicate_appointment",
            message=(
                "This patient already has an active appointment in this doctor’s queue today. "
                "Find the permanent patient record and use Check In."
            ),
            details={
                "existing_appointment_id": existing_appointment.id,
                "existing_token_number": existing_appointment.token_number,
                "existing_status": existing_appointment.status,
            },
        )

    token_number = token_service.generate_next_daily_token(session, doctor.id, appointment_date)
    level = payload.priority_level.value
    arrival = PendingOpdArrival(
        full_name=payload.full_name.strip(),
        age_years=payload.age_years,
        mobile=mobile,
        doctor_id=doctor.id,
        department_id=department.id,
        appointment_date=appointment_date,
        token_number=token_number,
        priority_level=level,
        priority_reason=(
            payload.priority_reason.strip() if level != PriorityLevel.NORMAL.value else None
        ),
        status="TO_ARRIVE",
        created_by_user_id=principal.user_id,
    )
    session.add(arrival)
    session.flush()
    audit_service.record(
        session,
        audit_context,
        AuditAction.OPD_ARRIVAL_CREATED,
        "pending_opd_arrival",
        arrival.id,
        after={
            "full_name": arrival.full_name,
            "age_years": arrival.age_years,
            "mobile": arrival.mobile,
            "doctor_id": arrival.doctor_id,
            "department_id": arrival.department_id,
            "appointment_date": arrival.appointment_date.isoformat(),
            "token_number": arrival.token_number,
            "priority_level": arrival.priority_level,
            "priority_reason": arrival.priority_reason,
            "status": arrival.status,
        },
        reason=arrival.priority_reason,
    )
    return arrival


def get_arrival(session: Session, arrival_id: int) -> PendingOpdArrival:
    arrival = session.scalar(select(PendingOpdArrival).where(PendingOpdArrival.id == arrival_id))
    if arrival is None:
        raise ApiError(
            status_code=404, code="opd_arrival_not_found", message="OPD arrival not found."
        )
    return arrival


def list_arrivals(session: Session, arrival_date: date) -> list[PendingOpdArrival]:
    return list(
        session.scalars(
            select(PendingOpdArrival)
            .where(
                PendingOpdArrival.appointment_date == arrival_date,
                PendingOpdArrival.status == "TO_ARRIVE",
            )
            .order_by(PendingOpdArrival.token_number, PendingOpdArrival.id)
        )
    )


def update_arrival_priority(
    session: Session,
    principal: Principal,
    arrival_id: int,
    payload: OpdArrivalPriorityUpdate,
    audit_context: AuditContext,
) -> PendingOpdArrival:
    arrival = session.scalar(
        select(PendingOpdArrival)
        .where(PendingOpdArrival.id == arrival_id)
        .with_for_update(of=PendingOpdArrival)
    )
    if arrival is None or (
        principal.doctor_id is not None and principal.doctor_id != arrival.doctor_id
    ):
        raise ApiError(
            status_code=404, code="opd_arrival_not_found", message="OPD arrival not found."
        )
    require_version(arrival, payload.version_id, label="OPD arrival")
    if arrival.status != "TO_ARRIVE" or arrival.appointment_date != clock.ist_today():
        raise ApiError(
            status_code=409,
            code="opd_arrival_not_active",
            message="Priority can only be changed for an active To Arrive entry.",
        )
    old_level = arrival.priority_level
    new_level = payload.priority_level.value
    reason = payload.reason.strip()
    if old_level == new_level:
        raise ApiError(
            status_code=422,
            code="priority_unchanged",
            message="Select a different priority to record a change.",
        )
    if len(reason) < 3:
        raise ApiError(
            status_code=422,
            code="priority_reason_required",
            message="Enter a reason of at least 3 characters for every priority change.",
        )

    arrival.priority_level = new_level
    arrival.priority_reason = reason
    session.flush()
    audit_service.record(
        session,
        audit_context,
        AuditAction.OPD_ARRIVAL_PRIORITY_CHANGED,
        "pending_opd_arrival",
        arrival.id,
        before={"priority_level": old_level},
        after={"priority_level": new_level},
        reason=reason,
    )
    return arrival


def register_arrival(
    session: Session,
    principal: Principal,
    arrival_id: int,
    payload: OpdArrivalRegister,
    audit_context: AuditContext,
) -> Appointment:
    """Promote a pending draft into a permanent patient and REGISTERED appointment atomically."""
    arrival = session.scalar(
        select(PendingOpdArrival)
        .where(PendingOpdArrival.id == arrival_id)
        .with_for_update(of=PendingOpdArrival)
    )
    if arrival is None:
        raise ApiError(
            status_code=404, code="opd_arrival_not_found", message="OPD arrival not found."
        )
    if principal.doctor_id is not None and principal.doctor_id != arrival.doctor_id:
        raise ApiError(
            status_code=404, code="opd_arrival_not_found", message="OPD arrival not found."
        )
    if arrival.status == "REGISTERED" and arrival.appointment_id is not None:
        existing = session.get(Appointment, arrival.appointment_id)
        if existing is not None:
            return existing
    if arrival.status != "TO_ARRIVE":
        raise ApiError(
            status_code=409,
            code="opd_arrival_already_registered",
            message="This OPD arrival has already been registered.",
        )
    require_version(arrival, payload.version_id, label="OPD arrival")
    if arrival.appointment_date != clock.ist_today():
        raise ApiError(
            status_code=422,
            code="opd_arrival_wrong_day",
            message=(
                "A pending arrival from another day cannot be registered into today’s OPD queue."
            ),
        )

    patient_data = payload.patient
    if (
        patient_data.full_name.strip() != arrival.full_name
        or patient_data.age_years != arrival.age_years
        or patient_service.clean_mobile(patient_data.mobile) != arrival.mobile
    ):
        raise ApiError(
            status_code=422,
            code="opd_arrival_demographics_mismatch",
            message="Patient name, age and mobile must match the pending arrival.",
        )

    patient = patient_service.create_patient(session, patient_data)
    audit_service.record(
        session,
        audit_context,
        AuditAction.PATIENT_REGISTERED,
        "PATIENT",
        patient.id,
        after=patient_service.registration_audit_after(patient),
    )

    # Reuse the normal booking validation path. The token was reserved at draft creation and is
    # attached after validation; no second token is allocated and a duplicate active booking
    # causes the whole patient+appointment transaction to roll back.
    appointment = booking_service.create_booking(
        session,
        principal,
        patient_id=patient.id,
        doctor_id=arrival.doctor_id,
        department_id=arrival.department_id,
        appointment_date=arrival.appointment_date,
        source=AppointmentSource.WALK_IN,
        issue_token=False,
    )
    appointment.token_number = arrival.token_number
    appointment.status = AppointmentStatus.REGISTERED.value
    appointment.status_updated_at = clock.utcnow()
    appointment.visit_kind = VisitKind.NEW.value
    appointment.priority_level = arrival.priority_level
    appointment.priority_reason = arrival.priority_reason
    session.flush()

    audit_service.record(
        session,
        audit_context,
        AuditAction.APPOINTMENT_CREATED,
        "appointment",
        appointment.id,
        after={
            "patient_id": patient.id,
            "patient_urn": patient.urn,
            "doctor_id": appointment.doctor_id,
            "department_id": appointment.department_id,
            "appointment_date": appointment.appointment_date.isoformat(),
            "token_number": appointment.token_number,
            "priority_level": appointment.priority_level,
            "priority_reason": appointment.priority_reason,
            "status": appointment.status,
        },
        reason=arrival.priority_reason,
    )
    arrival.patient_id = patient.id
    arrival.appointment_id = appointment.id
    arrival.status = "REGISTERED"
    arrival.status_updated_at = clock.utcnow()
    session.flush()
    audit_service.record(
        session,
        audit_context,
        AuditAction.OPD_ARRIVAL_REGISTERED,
        "pending_opd_arrival",
        arrival.id,
        before={"status": "TO_ARRIVE"},
        after={
            "status": "REGISTERED",
            "patient_id": patient.id,
            "appointment_id": appointment.id,
            "token_number": arrival.token_number,
        },
    )
    return appointment
