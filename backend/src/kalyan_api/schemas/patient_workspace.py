"""Role-redacted Pydantic schemas for Patient Workspace summary and visit history (T1.4).

Role boundaries (D-04, AGENTS.md #7):
- Allergy safety alerts: populated for RECEPTION and DOCTOR; strictly None for ADMIN.
- Full clinical allergies (`active_allergies`): strictly DOCTOR only; None for RECEPTION and ADMIN.
- Clinical KPIs and encounter links: strictly DOCTOR only; None for ADMIN and RECEPTION.
- Financial KPIs and visit bill/payment totals: ADMIN and RECEPTION only; strictly None for DOCTOR.
"""

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from kalyan_api.schemas.bill import BillPaymentOut
from kalyan_api.schemas.clinical_diagnoses import EncounterDiagnosisOut
from kalyan_api.schemas.encounters import AddendumRead
from kalyan_api.schemas.follow_up import DoctorFollowUpResponse
from kalyan_api.schemas.investigations import InvestigationOrderOut
from kalyan_api.schemas.ledger import RefundOut
from kalyan_api.schemas.prescriptions import PrescriptionOut
from kalyan_api.schemas.treatment_plans import TreatmentPlanOut
from kalyan_api.schemas.vitals import VitalObservationResponse


class AllergySafetyAlertOut(BaseModel):
    """Safety-alert-only allergy projection (zero reaction, clinical_notes, or recorded_by)."""

    has_allergies: bool
    count: int = Field(ge=0)
    highest_severity: str | None = None
    alert_labels: list[str] = Field(default_factory=list)


class WorkspaceAllergyOut(BaseModel):
    """Full structured clinical allergy record (DOCTOR only under D-04)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    patient_id: int
    substance: str
    category: str
    severity: str
    reaction: str | None = None
    clinical_notes: str | None = None
    status: str
    doctor_id: int | None = None
    recorded_by_user_id: int | None = None
    recorded_by_username: str | None = None
    created_at: datetime
    updated_at: datetime
    version_id: int


class LatestVisitBrief(BaseModel):
    """Compact snapshot of the patient's most recent visit."""

    visit_id: int
    visit_code: str
    visit_date: date
    status: str
    token_numbers: list[int] = Field(default_factory=list)
    doctors: list[str] = Field(default_factory=list)
    departments: list[str] = Field(default_factory=list)
    consultation_count: int = Field(ge=0)
    completed_consultations: int = Field(ge=0)


class LatestEncounterBrief(BaseModel):
    """Compact snapshot of the patient's most recent clinical encounter (DOCTOR only)."""

    encounter_id: int
    encounter_code: str
    encounter_date: datetime
    doctor_name: str
    department_name: str | None = None
    is_finalised: bool
    diagnosis_summary: str | None = None


class PatientSummaryOut(BaseModel):
    """Role-redacted Patient Workspace KPI summary."""

    patient_id: int
    urn: str
    total_visits: int = Field(ge=0)
    active_treatment_plans: int = Field(ge=0)
    latest_visit: LatestVisitBrief | None = None

    # Allergy projections: alert for RECEPTION & DOCTOR (None for ADMIN);
    # full clinical records strictly for DOCTOR (None for RECEPTION & ADMIN).
    allergy_alert: AllergySafetyAlertOut | None = None
    active_allergies: list[WorkspaceAllergyOut] | None = None

    # Clinical KPIs: DOCTOR only (strictly None for ADMIN & RECEPTION under D-04).
    prescriptions_count: int | None = None
    active_conditions_count: int | None = None
    latest_encounter: LatestEncounterBrief | None = None

    # Financial KPIs: ADMIN & RECEPTION only (strictly None for DOCTOR per AGENTS.md #7).
    total_billed_paise: int | None = None
    total_paid_paise: int | None = None
    total_refunded_paise: int | None = None
    outstanding_paise: int | None = None


class EncounterLinkBrief(BaseModel):
    """Compact link from a visit history row to a clinical encounter (DOCTOR only)."""

    encounter_id: int
    encounter_code: str
    is_finalised: bool
    doctor_name: str


class PatientVisitHistoryItem(BaseModel):
    """One visit row in the patient's role-redacted visit history."""

    visit_id: int
    visit_code: str
    visit_date: date
    status: str
    token_numbers: list[int] = Field(default_factory=list)
    doctors: list[str] = Field(default_factory=list)
    departments: list[str] = Field(default_factory=list)
    consultation_count: int = Field(ge=0)
    completed_consultations: int = Field(ge=0)

    # DOCTOR only (None for ADMIN & RECEPTION under D-04).
    encounter_links: list[EncounterLinkBrief] | None = None

    # ADMIN & RECEPTION only (None for DOCTOR per AGENTS.md #7).
    bill_total_paise: int | None = None
    paid_paise: int | None = None
    due_paise: int | None = None
    payment_status: str | None = None


class PatientVisitHistoryResponse(BaseModel):
    """Paginated role-redacted visit history response for a patient."""

    items: list[PatientVisitHistoryItem]
    total: int = Field(ge=0)
    limit: int = Field(ge=1)
    offset: int = Field(ge=0)


class VisitWorkspacePatientStrip(BaseModel):
    """Compact patient identity header for the unified Visit Workspace."""

    patient_id: int
    urn: str
    full_name: str
    computed_age_years: int
    gender: str
    mobile: str
    is_active: bool
    is_archived: bool
    merged_into_id: int | None = None
    merged_into_urn: str | None = None
    # Populated for DOCTOR and RECEPTION; strictly None for ADMIN (D-04).
    allergy_alert: AllergySafetyAlertOut | None = None


class VisitWorkspaceVisitMeta(BaseModel):
    """Visit header metadata for the unified Visit Workspace."""

    visit_id: int
    visit_code: str
    visit_date: date
    status: str
    referral_source: str | None = None
    referrer_name: str | None = None
    token_numbers: list[int] = Field(default_factory=list)


class WorkspaceTemplateSummaryOut(BaseModel):
    """Specialty clinical template response summary (DOCTOR only, D-04)."""

    template_code: str
    template_name_en: str
    template_version_id: int
    version_number: int
    response_data: dict[str, Any] = Field(default_factory=dict)
    updated_at: datetime


class WorkspaceClinicalChargeOut(BaseModel):
    """Doctor's own consultation or clinical charge line (Q13; no payments or reception lines)."""

    id: int
    category: str
    source: str
    status: str
    description: str
    unit: str | None = None
    quantity: Decimal
    rate_paise: int
    amount_paise: int
    treatment_plan_id: int | None = None


class VisitWorkspaceConsultationOut(BaseModel):
    """One consultation slot in the Visit Workspace with role-redacted clinical bundle."""

    appointment_id: int | None = None
    token_number: int | None = None
    doctor_id: int
    doctor_name: str
    department_name: str | None = None
    consultation_status: str | None = None
    visit_kind: str | None = None
    priority_level: str | None = None

    # Clinical bundle: DOCTOR only (strictly None for ADMIN and RECEPTION under D-04).
    encounter_id: int | None = None
    encounter_code: str | None = None
    is_finalised: bool | None = None
    vitals: VitalObservationResponse | None = None
    symptoms: str | None = None
    clinical_notes: str | None = None
    diagnosis: str | None = None
    template_response_summary: WorkspaceTemplateSummaryOut | None = None
    diagnoses: list[EncounterDiagnosisOut] | None = None
    investigations: list[InvestigationOrderOut] | None = None
    prescriptions: list[PrescriptionOut] | None = None
    treatment_plans: list[TreatmentPlanOut] | None = None
    follow_up: DoctorFollowUpResponse | None = None
    addenda: list[AddendumRead] | None = None
    # Q13: own consultation fee + own doctor-authored lines only (empty for other doctors' rows).
    clinical_charges: list[WorkspaceClinicalChargeOut] | None = None


class VisitWorkspaceFinancialSummaryOut(BaseModel):
    """Visit financial summary for ADMIN & RECEPTION (strictly None for DOCTOR, AGENTS.md #7)."""

    bill_total_paise: int
    paid_paise: int
    refunded_paise: int
    due_paise: int
    payment_status: str
    payments: list[BillPaymentOut] = Field(default_factory=list)
    refunds: list[RefundOut] = Field(default_factory=list)


class VisitWorkspaceOut(BaseModel):
    """Unified role-redacted Encounter / Visit Workspace response (T4.3)."""

    patient: VisitWorkspacePatientStrip
    visit: VisitWorkspaceVisitMeta
    consultations: list[VisitWorkspaceConsultationOut] = Field(default_factory=list)
    # ADMIN & RECEPTION only; strictly None for DOCTOR per AGENTS.md #7.
    financial_summary: VisitWorkspaceFinancialSummaryOut | None = None
