"""Database rules for reception visits (RF-10, migration 0025).

Owner decisions of 2026-11-13: a visit is opened at check-in and closed by reception at
checkout; a patient has at most one open visit; a visit link must belong to the same patient
(as SEC-03); the token is issued at check-in, so a booking may have no token yet. These tests
exercise PostgreSQL directly, so the rules hold even for code paths that skip the API.
"""

import importlib.util
import uuid
from datetime import UTC, date, datetime, time
from pathlib import Path
from types import ModuleType

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from conftest import make_user
from sqlalchemy import delete, func, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError, ProgrammingError
from sqlalchemy.orm import Session

import kalyan_api
from kalyan_api.config import Settings
from kalyan_api.models import (
    Appointment,
    AppointmentSource,
    AppointmentStatus,
    Base,
    ConsultationStatus,
    Patient,
    User,
    Visit,
    VisitStatus,
)

VISIT_DATE = date(2026, 11, 20)
MIGRATION_0025 = (
    Path(kalyan_api.__file__).parent / "migrations" / "versions" / "0025_reception_visits.py"
)


def _patient(session: Session, suffix: str) -> Patient:
    patient = Patient(
        urn=f"KH-2026-R1{suffix}",
        full_name=f"Visit Patient {suffix}",
        guardian_name="Guardian",
        gender="M",
        age_years=40,
        mobile="9000000002",
        address="Ara, Bihar",
        district="Bhojpur",
        state="Bihar",
        is_active=True,
    )
    session.add(patient)
    session.flush()
    return patient


def _visit(
    session: Session,
    patient: Patient,
    user: User,
    status: str = VisitStatus.OPEN.value,
    **fields: object,
) -> Visit:
    visit = Visit(
        patient_id=patient.id,
        visit_date=VISIT_DATE,
        status=status,
        opened_by_user_id=user.id,
        **fields,
    )
    session.add(visit)
    session.flush()
    return visit


def _booking(
    session: Session, patient: Patient, doctor_id: int, user: User, **fields: object
) -> Appointment:
    appt = Appointment(
        patient_id=patient.id,
        doctor_id=doctor_id,
        appointment_date=VISIT_DATE,
        status=AppointmentStatus.BOOKED.value,
        created_by_user_id=user.id,
        **fields,
    )
    session.add(appt)
    session.flush()
    return appt


def _load_migration_0025() -> ModuleType:
    spec = importlib.util.spec_from_file_location("migration_0025_reception_visits", MIGRATION_0025)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# ------------------------------------------------------------------ visits


def test_db_allows_only_one_open_visit_per_patient(reception_user, db_session):
    patient = _patient(db_session, "V1")
    _visit(db_session, patient, reception_user)

    with pytest.raises(IntegrityError) as exc_info, db_session.begin_nested():
        _visit(db_session, patient, reception_user)
    assert "ix_visits_one_open_per_patient" in str(exc_info.value)


def test_db_allows_a_new_open_visit_once_the_previous_one_is_closed(reception_user, db_session):
    patient = _patient(db_session, "V2")
    first = _visit(db_session, patient, reception_user)
    first.status = VisitStatus.CLOSED.value
    first.closed_at = datetime.now(UTC)
    first.closed_by_user_id = reception_user.id
    db_session.flush()

    second = _visit(db_session, patient, reception_user)

    assert second.id != first.id
    count = db_session.scalar(
        select(func.count()).select_from(Visit).where(Visit.patient_id == patient.id)
    )
    assert count == 2


def test_db_rejects_closed_visit_without_closing_user_and_time(reception_user, db_session):
    patient = _patient(db_session, "V3")

    with pytest.raises(IntegrityError) as exc_info, db_session.begin_nested():
        _visit(db_session, patient, reception_user, status=VisitStatus.CLOSED.value)
    assert "ck_visits_closed_fields_present" in str(exc_info.value)


def test_db_rejects_cancelled_visit_without_reason(reception_user, db_session):
    patient = _patient(db_session, "V4")

    with pytest.raises(IntegrityError) as exc_info, db_session.begin_nested():
        _visit(
            db_session,
            patient,
            reception_user,
            status=VisitStatus.CANCELLED.value,
            cancelled_at=datetime.now(UTC),
            cancelled_by_user_id=reception_user.id,
        )
    assert "ck_visits_cancelled_fields_present" in str(exc_info.value)


def test_db_rejects_unknown_visit_status(reception_user, db_session):
    patient = _patient(db_session, "V5")

    with pytest.raises(IntegrityError) as exc_info, db_session.begin_nested():
        _visit(db_session, patient, reception_user, status="DONE")
    assert "ck_visits_status_valid" in str(exc_info.value)


def test_app_role_cannot_delete_visits(reception_user, db_session):
    patient = _patient(db_session, "V6")
    visit = _visit(db_session, patient, reception_user)

    with pytest.raises(ProgrammingError) as exc_info, db_session.begin_nested():
        db_session.execute(delete(Visit).where(Visit.id == visit.id))
    assert "permission denied" in str(exc_info.value)


# ------------------------------------------------------------ appointments


def test_db_rejects_appointment_linked_to_another_patients_visit(
    doctor_a_user, reception_user, db_session
):
    patient_a = _patient(db_session, "V7")
    patient_b = _patient(db_session, "V8")
    visit_a = _visit(db_session, patient_a, reception_user)

    with pytest.raises(IntegrityError) as exc_info, db_session.begin_nested():
        _booking(
            db_session, patient_b, doctor_a_user.doctor_id, reception_user, visit_id=visit_a.id
        )
    assert "fk_appointments_visit_patient" in str(exc_info.value)


def test_db_accepts_tokenless_phone_bookings_and_same_patient_visit_link(
    doctor_a_user, reception_user, db_session
):
    patient = _patient(db_session, "V9")
    other_patient = _patient(db_session, "VA")
    # Two bookings for the same doctor and date, neither with a token yet.
    first = _booking(
        db_session,
        patient,
        doctor_a_user.doctor_id,
        reception_user,
        source=AppointmentSource.PHONE.value,
        expected_time=time(10, 30),
    )
    second = _booking(
        db_session,
        other_patient,
        doctor_a_user.doctor_id,
        reception_user,
        source=AppointmentSource.PHONE.value,
    )
    assert first.token_number is None
    assert second.token_number is None

    visit = _visit(db_session, patient, reception_user)
    first.visit_id = visit.id
    first.consultation_status = ConsultationStatus.WAITING.value
    db_session.flush()
    db_session.refresh(first)

    assert first.visit_id == visit.id
    assert first.expected_time == time(10, 30)
    assert first.consultation_status == ConsultationStatus.WAITING.value


@pytest.mark.parametrize(
    ("column", "value", "constraint"),
    [
        ("source", "EMAIL", "ck_appointments_source_valid"),
        ("consultation_status", "DONE", "ck_appointments_consultation_status_valid"),
    ],
)
def test_db_rejects_unknown_source_and_consultation_status(
    column, value, constraint, doctor_a_user, reception_user, db_session
):
    patient = _patient(db_session, "VB")

    with pytest.raises(IntegrityError) as exc_info, db_session.begin_nested():
        _booking(db_session, patient, doctor_a_user.doctor_id, reception_user, **{column: value})
    assert constraint in str(exc_info.value)


# --------------------------------------------------------------- migration


def test_downgrade_0025_refuses_while_visits_exist(owner_engine: Engine, test_settings: Settings):
    """The downgrade must stop before any change when visit rows exist (nothing is deleted)."""
    migration = _load_migration_0025()
    connection = owner_engine.connect()
    transaction = connection.begin()
    session = Session(bind=connection, join_transaction_mode="create_savepoint")
    try:
        user = make_user(
            session, test_settings, role="RECEPTION", username=f"rf10_{uuid.uuid4().hex[:8]}"
        )
        patient = _patient(session, "VC")
        _visit(session, patient, user)

        context = MigrationContext.configure(connection, opts={"target_metadata": Base.metadata})
        with Operations.context(context), pytest.raises(RuntimeError, match="visit row"):
            migration.downgrade()

        assert connection.scalar(text("SELECT to_regclass('public.visits') IS NOT NULL"))
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == "0025"
    finally:
        session.close()
        transaction.rollback()
        connection.close()
