"""Bill line item and visit bill schemas (Phase 22, Wave 5 & 6; OD-22-13..15, OD-22-17, MED-03..06, MED-12)."""

from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, computed_field, field_validator, model_validator


class BillLineCreate(BaseModel):
    """Payload for reception adding a bill line (medicine or additional particular)."""

    model_config = ConfigDict(extra="forbid")

    category: Literal["MEDICINE", "ADDITIONAL"]
    description: str
    unit: str | None = None
    quantity: Decimal = Field(..., gt=0, le=Decimal("99999999.99"), max_digits=10, decimal_places=2)
    rate_paise: int = Field(..., ge=0)
    prescription_item_id: int | None = None

    @field_validator("description")
    @classmethod
    def _validate_description(cls, v: str) -> str:
        s = v.strip()
        if not s:
            raise ValueError("Description cannot be blank")
        if len(s) > 200:
            raise ValueError("Description cannot exceed 200 characters")
        return s

    @field_validator("unit")
    @classmethod
    def _validate_unit(cls, v: str | None) -> str | None:
        if v is None:
            return None
        s = v.strip()
        if not s:
            return None
        if len(s) > 32:
            raise ValueError("Unit cannot exceed 32 characters")
        return s


class BillLineVoidRequest(BaseModel):
    """Payload for voiding a non-consultation bill line (OD-G, BILL-06)."""

    model_config = ConfigDict(extra="forbid")

    reason: str

    @field_validator("reason")
    @classmethod
    def _validate_reason(cls, v: str) -> str:
        s = v.strip()
        if len(s) < 3:
            raise ValueError("Reason must be at least 3 characters")
        if len(s) > 500:
            raise ValueError("Reason cannot exceed 500 characters")
        return s


class BillLineCorrectRequest(BaseModel):
    """Payload for correcting quantity and/or rate on a non-consultation line (MED-11)."""

    model_config = ConfigDict(extra="forbid")

    quantity: Decimal | None = Field(
        None, gt=0, le=Decimal("99999999.99"), max_digits=10, decimal_places=2
    )
    rate_paise: int | None = Field(None, ge=0)
    reason: str

    @field_validator("reason")
    @classmethod
    def _validate_reason(cls, v: str) -> str:
        s = v.strip()
        if len(s) < 3:
            raise ValueError("Reason must be at least 3 characters")
        if len(s) > 500:
            raise ValueError("Reason cannot exceed 500 characters")
        return s

    @model_validator(mode="after")
    def _validate_at_least_one_field(self) -> "BillLineCorrectRequest":
        if self.quantity is None and self.rate_paise is None:
            raise ValueError("At least one of quantity or rate_paise must be provided")
        return self


class PrescribedMedicineOut(BaseModel):
    """Prescription medicine reference projected for reception billing (OD-B, B2, D-04).

    Strictly limited to prescription_item_id, medicine_name, and form.
    Clinical details (dosage, frequency, duration, route, instructions) and quantity are excluded.
    """

    model_config = ConfigDict(from_attributes=True, extra="forbid")

    prescription_item_id: int
    medicine_name: str
    form: str | None = None


class BillLineHistoryOut(BaseModel):
    """Adjustment history row for a bill line item (OD-22-15, FEE-09 read path)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    bill_item_id: int
    kind: str
    old_quantity: Decimal | None = None
    new_quantity: Decimal | None = None
    old_rate_paise: int | None = None
    new_rate_paise: int | None = None
    old_amount_paise: int
    new_amount_paise: int
    reason: str
    actor_user_id: int
    actor_username: str | None = None
    created_at: datetime

    @computed_field
    @property
    def old(self) -> int:
        return self.old_amount_paise

    @computed_field
    @property
    def new(self) -> int:
        return self.new_amount_paise

    @computed_field
    @property
    def actor(self) -> str | None:
        return self.actor_username


class BillLineOut(BaseModel):
    """Bill line item presentation model (MED-04, MED-05, OD-22-14, OD-22-15)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    visit_id: int
    appointment_id: int | None = None
    category: str
    source: str
    description: str
    unit: str | None = None
    quantity: Decimal
    rate_paise: int
    amount_paise: int
    original_amount_paise: int
    status: str
    prescription_item_id: int | None = None
    counts_toward_total: bool = False
    created_by_user_id: int
    created_by_username: str | None = None
    created_at: datetime
    history: list[BillLineHistoryOut] = Field(default_factory=list)
    void_reason: str | None = None
    voided_by_user_id: int | None = None
    voided_by_username: str | None = None
    voided_at: datetime | None = None

    @computed_field
    @property
    def staff(self) -> str | None:
        return self.voided_by_username or self.created_by_username

    @computed_field
    @property
    def voided_by(self) -> str | None:
        return self.voided_by_username


class BillSectionOut(BaseModel):
    """Grouped bill section for OD-22-14 bill view."""

    category: str
    subtotal_paise: int
    lines: list[BillLineOut] = Field(default_factory=list)


class BillPaymentOut(BaseModel):
    """Payment record on a visit or its appointments."""

    id: int
    visit_id: int | None = None
    appointment_id: int | None = None
    receipt_number: str
    amount_paise: int
    payment_method: str
    is_reversed: bool
    created_at: datetime
    created_by_username: str | None = None


class PreviousDueOut(BaseModel):
    """Outstanding balance of a previous closed visit of the same patient (OD-22-17)."""

    visit_id: int
    visit_date: date
    doctor_names: list[str] = Field(default_factory=list)
    balance_paise: int

    @computed_field
    @property
    def balance(self) -> int:
        return self.balance_paise

    @computed_field
    @property
    def due_paise(self) -> int:
        return self.balance_paise


class PackageInfoOut(BaseModel):
    """Information-only treatment package summary (LED-03..07, OD-C, D-04)."""

    treatment_plan_id: int
    plan_name: str
    status: str
    total_sessions: int
    completed_sessions: int
    remaining_sessions: int
    agreed_price_paise: int
    paid_paise: int
    balance_paise: int


class VisitBillOut(BaseModel):
    """Comprehensive bill view for Billing & Checkout panel (UI-SPEC S4, OD-22-14)."""

    visit_id: int
    patient_id: int
    patient_urn: str | None = None
    patient_name: str | None = None
    status: str
    visit_date: date
    closed_at: datetime | None = None
    close_reason: str | None = None
    locked: bool
    sections: list[BillSectionOut]
    bill_total_paise: int
    paid_paise: int
    due_paise: int
    payments: list[BillPaymentOut] = Field(default_factory=list)
    voided_lines: list[BillLineOut] = Field(default_factory=list)
    previous_dues: list[PreviousDueOut] = Field(default_factory=list)
    previous_dues_total_paise: int = 0
    packages: list[PackageInfoOut] = Field(default_factory=list)


class DoctorLineCreate(BaseModel):
    """Payload for doctor adding a procedure or package reference charge to own consultation."""

    model_config = ConfigDict(extra="forbid")

    category: Literal["PROCEDURE", "PACKAGE"]
    description: str | None = None
    unit: str | None = None
    quantity: Decimal | None = Field(
        None, gt=0, le=Decimal("99999999.99"), max_digits=10, decimal_places=2
    )
    rate_paise: int | None = Field(None, ge=0)
    treatment_plan_id: int | None = None

    @field_validator("description")
    @classmethod
    def _validate_description(cls, v: str | None) -> str | None:
        if v is None:
            return None
        s = v.strip()
        if not s:
            raise ValueError("Description cannot be blank")
        if len(s) > 200:
            raise ValueError("Description cannot exceed 200 characters")
        return s

    @field_validator("unit")
    @classmethod
    def _validate_unit(cls, v: str | None) -> str | None:
        if v is None:
            return None
        s = v.strip()
        if not s:
            return None
        if len(s) > 32:
            raise ValueError("Unit cannot exceed 32 characters")
        return s

    @model_validator(mode="after")
    def _validate_category_fields(self) -> "DoctorLineCreate":
        if self.category == "PROCEDURE":
            if not self.description:
                raise ValueError("Description is required for PROCEDURE lines")
            if self.quantity is None:
                raise ValueError("Quantity is required for PROCEDURE lines")
            if self.rate_paise is None:
                raise ValueError("Rate is required for PROCEDURE lines")
            if self.treatment_plan_id is not None:
                raise ValueError("Treatment plan id is not allowed for PROCEDURE lines")
        elif self.category == "PACKAGE":
            if self.treatment_plan_id is None:
                raise ValueError("Treatment plan id is required for PACKAGE lines")
            if self.rate_paise is not None and self.rate_paise != 0:
                raise ValueError("Package lines take no rate")
        return self


class DoctorChargesOut(BaseModel):
    """Doctor's own read view of charges on own consultation (Q13, UI-SPEC S6).

    Strictly NO visit total, NO payments, NO reception lines or other doctors' lines.
    """

    model_config = ConfigDict(from_attributes=True, extra="forbid")

    consultation_line: BillLineOut | None = None
    doctor_lines: list[BillLineOut] = Field(default_factory=list)

