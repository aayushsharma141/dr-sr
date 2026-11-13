"""Vitals observations and server-calculated BMI engine endpoints (DWS-06, T-19-05)."""

from decimal import Decimal

from fastapi import APIRouter, Depends
from sqlalchemy import select

from kalyan_api import clock
from kalyan_api.core.errors import ApiError
from kalyan_api.core.permissions import Permission
from kalyan_api.core.policy import require
from kalyan_api.core.principal import Principal, current_principal
from kalyan_api.core.scope import ScopeFamily, get_scoped_or_404
from kalyan_api.db.session import SessionDep
from kalyan_api.models import ClinicalEncounter, VitalObservation
from kalyan_api.schemas.vitals import VitalObservationInput, VitalObservationResponse

router = APIRouter(prefix="/encounters", tags=["vitals"])


def calculate_bmi(height_cm: Decimal | None, weight_kg: Decimal | None) -> Decimal | None:
    """Calculate authoritative server-side BMI rounded to 1 decimal place.

    Formula: weight (kg) / [height (m)]^2
    """
    if height_cm is None or weight_kg is None:
        return None

    h_m = float(height_cm) / 100.0
    w_kg = float(weight_kg)
    if h_m <= 0:
        return None

    bmi_calc = round(w_kg / (h_m**2), 1)
    if bmi_calc < 5 or bmi_calc > 100:
        raise ApiError(
            status_code=422,
            code="invalid_bmi",
            message=f"Calculated BMI ({bmi_calc}) is outside physiological bounds (5-100).",
        )
    return Decimal(str(bmi_calc))


@router.get(
    "/{encounter_id}/vitals",
    response_model=VitalObservationResponse,
    dependencies=[Depends(require(Permission.ENCOUNTER_READ))],
)
def get_encounter_vitals(
    encounter_id: int,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> VitalObservationResponse:
    """Retrieve recorded vitals and biometrics for encounter."""
    get_scoped_or_404(
        session,
        ClinicalEncounter,
        encounter_id,
        principal,
        family=ScopeFamily.CLINICAL_READ,
        doctor_id_col=ClinicalEncounter.doctor_id,
    )

    vital = session.scalar(
        select(VitalObservation).where(VitalObservation.encounter_id == encounter_id)
    )
    if not vital:
        raise ApiError(
            status_code=404,
            code="vitals_not_found",
            message="No vitals recorded for this encounter.",
        )
    return VitalObservationResponse.model_validate(vital)


@router.put(
    "/{encounter_id}/vitals",
    response_model=VitalObservationResponse,
    dependencies=[Depends(require(Permission.ENCOUNTER_WRITE))],
)
def upsert_encounter_vitals(
    encounter_id: int,
    payload: VitalObservationInput,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> VitalObservationResponse:
    """Upsert vitals observations and automatically calculate authoritative BMI (DWS-06)."""
    enc = get_scoped_or_404(
        session,
        ClinicalEncounter,
        encounter_id,
        principal,
        family=ScopeFamily.CLINICAL_WRITE,
        doctor_id_col=ClinicalEncounter.doctor_id,
    )

    if enc.is_finalised:
        raise ApiError(
            status_code=400,
            code="encounter_finalised",
            message="Cannot modify vitals for a finalised clinical encounter.",
        )

    bmi_val = calculate_bmi(payload.height_cm, payload.weight_kg)

    vital = session.scalar(
        select(VitalObservation).where(VitalObservation.encounter_id == encounter_id)
    )
    if vital:
        vital.patient_id = enc.patient_id
        vital.height_cm = payload.height_cm
        vital.weight_kg = payload.weight_kg
        vital.bmi = bmi_val
        vital.systolic_bp = payload.systolic_bp
        vital.diastolic_bp = payload.diastolic_bp
        vital.pulse_bpm = payload.pulse_bpm
        vital.temperature_f = payload.temperature_f
        vital.respiratory_rate = payload.respiratory_rate
        vital.spo2_percent = payload.spo2_percent
        vital.updated_at = clock.utcnow()
        session.flush()
        session.refresh(vital)
    else:
        vital = VitalObservation(
            encounter_id=encounter_id,
            patient_id=enc.patient_id,
            height_cm=payload.height_cm,
            weight_kg=payload.weight_kg,
            bmi=bmi_val,
            systolic_bp=payload.systolic_bp,
            diastolic_bp=payload.diastolic_bp,
            pulse_bpm=payload.pulse_bpm,
            temperature_f=payload.temperature_f,
            respiratory_rate=payload.respiratory_rate,
            spo2_percent=payload.spo2_percent,
        )
        session.add(vital)
        session.flush()
        session.refresh(vital)

    return VitalObservationResponse.model_validate(vital)
