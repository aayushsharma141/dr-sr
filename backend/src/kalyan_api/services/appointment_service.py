"""Appointment workflow state machine and validation service (APT-02)."""

from kalyan_api import clock
from kalyan_api.core.errors import ApiError
from kalyan_api.core.permissions import Role
from kalyan_api.core.principal import Principal
from kalyan_api.models import Appointment, AppointmentBookingMode, AppointmentStatus

# Valid status transitions
ALLOWED_TRANSITIONS: dict[AppointmentStatus, set[AppointmentStatus]] = {
    AppointmentStatus.BOOKED: {
        AppointmentStatus.ARRIVED,
        AppointmentStatus.CANCELLED,
        AppointmentStatus.NO_SHOW,
    },
    AppointmentStatus.ARRIVED: {
        AppointmentStatus.IN_CONSULTATION,
        AppointmentStatus.CANCELLED,
        AppointmentStatus.NO_SHOW,
    },
    AppointmentStatus.IN_CONSULTATION: {
        AppointmentStatus.DONE,
        AppointmentStatus.CANCELLED,
    },
    AppointmentStatus.DONE: set(),
    AppointmentStatus.CANCELLED: set(),
    AppointmentStatus.NO_SHOW: set(),
}


def validate_status_transition(
    appt: Appointment,
    target_status: AppointmentStatus,
    principal: Principal,
    cancellation_reason: str | None = None,
) -> None:
    """Validate that transition from appt.status to target_status is permitted."""
    current = AppointmentStatus(appt.status)

    if target_status == current:
        return

    if (
        appt.booking_mode == AppointmentBookingMode.SCHEDULED.value
        and target_status == AppointmentStatus.ARRIVED
        and appt.appointment_date < clock.ist_today()
    ):
        raise ApiError(
            status_code=422,
            code="appointment_date_elapsed",
            message="This scheduled visit date has passed. Mark it as No-show or create a new booking.",
        )

    if (
        target_status in {
            AppointmentStatus.ARRIVED,
            AppointmentStatus.IN_CONSULTATION,
            AppointmentStatus.DONE,
            AppointmentStatus.NO_SHOW,
        }
        and appt.appointment_date > clock.ist_today()
    ):
        raise ApiError(
            status_code=422,
            code="appointment_not_due",
            message="A future scheduled visit cannot be checked in or completed before its clinic date.",
        )

    allowed = ALLOWED_TRANSITIONS.get(current, set())
    if target_status not in allowed:
        raise ApiError(
            status_code=422,
            code="invalid_status_transition",
            message=(
                f"Cannot transition appointment from '{current.value}' to '{target_status.value}'."
            ),
            details={
                "current_status": current.value,
                "target_status": target_status.value,
                "allowed_transitions": [s.value for s in allowed],
            },
        )

    # Cancellation requires explanation
    if target_status == AppointmentStatus.CANCELLED and not (
        cancellation_reason and cancellation_reason.strip()
    ):
        raise ApiError(
            status_code=422,
            code="cancellation_reason_required",
            message="A cancellation reason must be provided when cancelling an appointment.",
        )

    # Doctor-only transition enforcement: IN_CONSULTATION and DONE must be initiated by DOCTOR
    if target_status in (AppointmentStatus.IN_CONSULTATION, AppointmentStatus.DONE):
        if principal.role != Role.DOCTOR:
            raise ApiError(
                status_code=403,
                code="doctor_status_forbidden",
                message=(f"Transitioning to '{target_status.value}' is restricted to doctors."),
            )
        # Furthermore, doctor can only transition their own appointments
        if principal.doctor_id != appt.doctor_id:
            raise ApiError(
                status_code=403,
                code="scope_forbidden",
                message="Doctors can only transition appointments assigned to them.",
            )
