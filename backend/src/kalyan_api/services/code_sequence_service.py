"""Atomic visit/encounter code sequence allocation and patient alias/write-guard helpers.

Guarantees:
- Visit codes follow VIS-YY-NNNNNN, scoped per calendar year via visit_sequences.
- Encounter codes follow ENC-YY-NNNNNN, scoped per calendar year via encounter_sequences.
- Allocation bootstraps the year row via INSERT ... ON CONFLICT DO NOTHING, then acquires
  a row-level lock with SELECT ... FOR UPDATE before incrementing last_number.
- Downward alias consolidation returns [patient_id, *merged_ids] matching timeline/visits.
- Write guard rejects missing patients (404) and inactive/archived/merged patients (409).
"""

from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from kalyan_api import clock
from kalyan_api.core.errors import ApiError
from kalyan_api.models import EncounterSequence, Patient, VisitSequence


def _year_for_date(value: date) -> int:
    """Resolve calendar year; timezone-aware datetimes are evaluated in IST."""
    if isinstance(value, datetime) and value.tzinfo is not None:
        return value.astimezone(clock.IST).year
    return value.year


def _allocate_sequence_number(
    session: Session,
    model: type[VisitSequence] | type[EncounterSequence],
    year: int,
) -> int:
    """Bootstrap year row if absent and atomically increment last_number under FOR UPDATE."""
    session.execute(
        pg_insert(model)
        .values(year=year, last_number=0)
        .on_conflict_do_nothing(index_elements=[model.year])
    )
    row = session.execute(select(model).where(model.year == year).with_for_update()).scalar_one()
    row.last_number += 1
    session.flush()
    return row.last_number


def allocate_visit_code(session: Session, visit_date: date) -> str:
    """Atomically allocate the next VIS-YY-NNNNNN code for the visit date's calendar year."""
    year = _year_for_date(visit_date)
    seq = _allocate_sequence_number(session, VisitSequence, year)
    return f"VIS-{year % 100:02d}-{seq:06d}"


def allocate_encounter_code(session: Session, encounter_date: date) -> str:
    """Atomically allocate the next ENC-YY-NNNNNN code for the encounter date's calendar year."""
    year = _year_for_date(encounter_date)
    seq = _allocate_sequence_number(session, EncounterSequence, year)
    return f"ENC-{year % 100:02d}-{seq:06d}"


def effective_patient_ids(session: Session, patient_id: int) -> list[int]:
    """Return [patient_id, *merged_ids] for downward merged-alias record consolidation."""
    merged_ids = session.scalars(
        select(Patient.id).where(Patient.merged_into_id == patient_id)
    ).all()
    return [patient_id, *merged_ids]


def require_active_unmerged_patient(session: Session, patient_id: int) -> Patient:
    """Return an active, non-archived, unmerged patient or raise 404 / 409."""
    patient = session.get(Patient, patient_id)
    if patient is None:
        raise ApiError(
            status_code=404,
            code="patient_not_found",
            message="Patient not found.",
        )
    if not patient.is_active or patient.is_archived or patient.merged_into_id is not None:
        raise ApiError(
            status_code=409,
            code="patient_inactive_or_merged",
            message="Cannot modify records for an inactive, archived, or merged patient.",
        )
    return patient
