"""Pydantic schemas for appointment booking, status updates and queue management."""

from datetime import date, datetime, time

from pydantic import BaseModel, ConfigDict, Field, model_validator

from kalyan_api.models import (
    REFERRAL_SOURCES_NEEDING_NAME,
    AppointmentSource,
    AppointmentStatus,
    PriorityLevel,
    ReferralSource,
    VisitKind,
)
from kalyan_api.schemas.patients import PatientCreate


class CheckInDetailsIn(BaseModel):
    """What reception confirms at check-in (phase 22, OD-22-05/06/16).

    Referred By is required on every check-in and the desk pre-fills it with SELF. The visit
    type is recorded only and never sets the fee. PRIORITY and EMERGENCY need a reason.
    """

    referral_source: ReferralSource = Field(..., description="Who referred the patient (OD-22-16)")
    referrer_name: str | None = Field(
        default=None,
        max_length=120,
        description="Referring doctor, person or organisation; required for those sources",
    )
    visit_kind: VisitKind | None = Field(
        default=None, description="NEW or FOLLOW_UP; recorded only, never sets the fee"
    )
    priority_level: PriorityLevel = Field(
        default=PriorityLevel.NORMAL, description="Queue classification; the token never changes"
    )
    priority_reason: str | None = Field(
        default=None, max_length=500, description="Required for PRIORITY and EMERGENCY"
    )

    @model_validator(mode="after")
    def _check_reason_and_referrer(self) -> "CheckInDetailsIn":
        if (
            self.priority_level != PriorityLevel.NORMAL
            and len((self.priority_reason or "").strip()) < 3
        ):
            raise ValueError("Enter a reason for marking the patient Priority or Emergency.")
        if (
            self.referral_source.value in REFERRAL_SOURCES_NEEDING_NAME
            and len((self.referrer_name or "").strip()) < 2
        ):
            raise ValueError("Enter the name of the referring doctor, person or organisation.")
        return self


class AppointmentCreate(BaseModel):
    """Payload to book an appointment (APT-01)."""

    patient_id: int = Field(..., gt=0, description="Target patient ID")
    doctor_id: int = Field(..., gt=0, description="Target doctor ID")
    department_id: int = Field(..., gt=0, description="Configured department/specialty ID")
    appointment_date: date = Field(..., description="Scheduled appointment date")
    notes: str | None = Field(default=None, max_length=1000, description="Reception notes")
    source: AppointmentSource | None = Field(
        default=None, description="How the appointment was made (RF-12); empty when unknown"
    )
    expected_time: time | None = Field(
        default=None,
        description="Time the patient said they would come; shown to spot late arrivals (RF-12)",
    )
    override_reason: str | None = Field(
        default=None,
        max_length=500,
        description=(
            "Reason of at least 5 characters to override duplicate booking on the same date "
            "(BR-006)"
        ),
    )
    issue_token: bool = Field(
        default=False,
        description="When true, allocates token atomically for doctor queue (TO_ARRIVE)",
    )


class WalkInCreate(CheckInDetailsIn):
    """Payload to register a walk-in: a booking for today that is checked in at once (RF-12)."""

    patient_id: int = Field(..., gt=0, description="Target patient ID")
    doctor_id: int = Field(..., gt=0, description="Target doctor ID")
    department_id: int = Field(..., gt=0, description="Configured department/specialty ID")
    notes: str | None = Field(default=None, max_length=1000, description="Reception notes")
    override_reason: str | None = Field(
        default=None,
        max_length=500,
        description="Reason of at least 5 characters to override a duplicate booking (BR-006)",
    )


class CheckInRequest(CheckInDetailsIn):
    """Payload to check a booked patient in on arrival (RF-12)."""

    version_id: int = Field(..., gt=0, description="Optimistic locking version ID")


class NewPatientCheckIn(CheckInDetailsIn):
    """Register a first-time patient and check them in, in one transaction (OD-22-03).

    The patient receives a permanent URN, today's visit is opened and the consultation joins
    the doctor's waiting list with its token. A first visit is always a NEW consultation.
    """

    patient: PatientCreate
    doctor_id: int = Field(..., gt=0, description="Consulting doctor ID")
    department_id: int = Field(..., gt=0, description="Configured department/specialty ID")
    notes: str | None = Field(default=None, max_length=1000, description="Reception notes")
    to_arrive: bool = Field(
        default=False,
        description="When true, issues token and places in TO_ARRIVE status pending registration",
    )

    @model_validator(mode="after")
    def _first_visit_is_new(self) -> "NewPatientCheckIn":
        if self.visit_kind == VisitKind.FOLLOW_UP:
            raise ValueError("A first visit cannot be a follow-up.")
        self.visit_kind = VisitKind.NEW
        return self


class PriorityUpdate(BaseModel):
    """Change a checked-in patient's classification (OD-22-06). The token never changes."""

    priority_level: PriorityLevel
    priority_reason: str | None = Field(
        default=None, max_length=500, description="Required for PRIORITY and EMERGENCY"
    )
    version_id: int = Field(..., gt=0, description="Optimistic locking version ID")

    @model_validator(mode="after")
    def _check_reason(self) -> "PriorityUpdate":
        if (
            self.priority_level != PriorityLevel.NORMAL
            and len((self.priority_reason or "").strip()) < 3
        ):
            raise ValueError("Enter a reason for marking the patient Priority or Emergency.")
        return self


class ReassignRequest(BaseModel):
    """Move a waiting patient to another doctor on the same visit (design §5, QUE-10).

    The old consultation is cancelled with this reason and a new WAITING consultation is
    created for the new doctor, with a token from that doctor's sequence.
    """

    version_id: int = Field(..., gt=0, description="Optimistic locking version ID")
    new_doctor_id: int = Field(..., gt=0, description="Doctor to move the patient to")
    new_department_id: int | None = Field(
        default=None,
        gt=0,
        description=(
            "Required when the new doctor is not in the current department; must be one of the "
            "new doctor's departments (owner decision Q19)"
        ),
    )
    reason: str = Field(..., min_length=3, max_length=500, description="Why it was moved")


class AcknowledgeAlertRequest(BaseModel):
    """Doctor acknowledges an emergency alert on their own consultation (OD-22-09)."""

    version_id: int = Field(..., gt=0, description="Optimistic locking version ID")


class RescheduleRequest(BaseModel):
    """Payload to move a booking to another date, or to change its expected time (RF-12)."""

    version_id: int = Field(..., gt=0, description="Optimistic locking version ID")
    appointment_date: date = Field(..., description="New date; today or later")
    expected_time: time | None = Field(default=None, description="New expected time, if any")
    reason: str | None = Field(default=None, max_length=500, description="Why it was moved")


class AppointmentStatusUpdate(BaseModel):
    """Payload to transition appointment workflow status (APT-02)."""

    status: AppointmentStatus = Field(..., description="Target status")
    version_id: int = Field(..., gt=0, description="Optimistic locking version ID")
    cancellation_reason: str | None = Field(
        default=None, max_length=500, description="Required when moving to CANCELLED"
    )


class AppointmentRead(BaseModel):
    """Detailed appointment record."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    patient_id: int
    patient_urn: str
    patient_name: str
    patient_mobile: str
    doctor_id: int
    department_id: int | None = None
    doctor_name_en: str
    doctor_name_hi: str | None = None
    appointment_date: date
    # Issued at check-in (RF-12); empty while the booking has not been checked in.
    token_number: int | None = None
    status: str
    status_updated_at: datetime
    check_in_at: datetime | None = None
    cancellation_reason: str | None = None
    notes: str | None = None
    source: str | None = None
    expected_time: time | None = None
    visit_id: int | None = None
    consultation_status: str | None = None
    rescheduled_from_id: int | None = None
    # Phase 22: visit type and classification of this consultation.
    visit_kind: str | None = None
    priority_level: str = "NORMAL"
    priority_reason: str | None = None
    priority_updated_at: datetime | None = None
    emergency_alerted_at: datetime | None = None
    alert_acknowledged_at: datetime | None = None
    # The visit's Referred By; filled on check-in responses only.
    referral_source: str | None = None
    referrer_name: str | None = None
    version_id: int
    created_at: datetime
    updated_at: datetime


class AppointmentListResponse(BaseModel):
    """Paginated or filtered appointment list response."""

    total: int
    appointments: list[AppointmentRead]


class DoctorQueueItem(BaseModel):
    """Item in doctor consultation queue."""

    id: int
    patient_id: int
    patient_urn: str
    patient_name: str
    patient_gender: str
    patient_age: int
    patient_mobile: str
    patient_allergies: str
    token_number: int | None = None
    status: str
    consultation_status: str | None = None
    status_updated_at: datetime
    notes: str | None = None
    # Phase 22: classification and visit type, for badges and the suggested order.
    visit_kind: str | None = None
    priority_level: str = "NORMAL"
    priority_reason: str | None = None
    emergency_alerted_at: datetime | None = None
    alert_acknowledged_at: datetime | None = None
    priority_updated_at: datetime | None = None
    check_in_at: datetime | None = None
    version_id: int


class DoctorQueueResponse(BaseModel):
    """Doctor daily consultation queue divided by operational sections (APT-02)."""

    doctor_id: int
    doctor_name: str
    queue_date: date
    in_consultation: list[DoctorQueueItem]
    waiting: list[DoctorQueueItem]
    booked: list[DoctorQueueItem]
    completed: list[DoctorQueueItem]
    total_active: int
