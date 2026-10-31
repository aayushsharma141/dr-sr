"""Integrity and constraint unit tests for Phase 12 models and tables."""

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from kalyan_api.models import ClinicSettings, ConsultationFee, Doctor, Patient, UrnSequence


def test_clinic_settings_singleton_and_defaults(db_session: Session) -> None:
    """clinic_settings has default row 1 and rejects any attempt to insert a second row."""
    settings = db_session.scalar(select(ClinicSettings).where(ClinicSettings.id == 1))
    assert settings is not None
    assert settings.name_en == "Kalyan Hospital"
    assert settings.name_hi == "कल्याण हॉस्पिटल"
    assert settings.receipt_sequence_cycle in ("FINANCIAL_YEAR", "CALENDAR_YEAR")

    # Attempt to insert a second row with id = 2 (must fail ck_clinic_settings_singleton)
    duplicate = ClinicSettings(
        id=2,
        name_en="Second Clinic",
        name_hi="दूसरा क्लीनिक",
        address_1="Nowhere",
        phone="123456",
        receipt_sequence_cycle="FINANCIAL_YEAR",
    )
    db_session.add(duplicate)
    with pytest.raises(IntegrityError, match="ck_clinic_settings_singleton"):
        db_session.flush()
    db_session.rollback()


def test_clinic_settings_cycle_check(db_session: Session) -> None:
    """clinic_settings rejects invalid receipt_sequence_cycle."""
    settings = db_session.scalar(select(ClinicSettings).where(ClinicSettings.id == 1))
    assert settings is not None
    settings.receipt_sequence_cycle = "BIANNUAL"  # Invalid
    with pytest.raises(IntegrityError, match="ck_clinic_settings_receipt_cycle_valid"):
        db_session.flush()
    db_session.rollback()


def test_doctor_enhancements(db_session: Session) -> None:
    """Doctor model supports Hindi name, qualification, registration number, and fee."""
    doc = Doctor(
        name_en="Dr. Anil Sharma",
        name_hi="डॉ. अनिल शर्मा",
        qualification="MBBS, MD (Medicine)",
        registration_number="BMR-45892",
        default_fee_paise=50000,
    )
    db_session.add(doc)
    db_session.flush()
    assert doc.id is not None
    assert doc.name_hi == "डॉ. अनिल शर्मा"
    assert doc.default_fee_paise == 50000


def test_consultation_fee_non_negative(db_session: Session) -> None:
    """consultation_fees rejects negative fee_paise."""
    fee = ConsultationFee(
        name="Invalid Negative Fee",
        fee_paise=-100,
    )
    db_session.add(fee)
    with pytest.raises(IntegrityError, match="ck_consultation_fees_fee_non_negative"):
        db_session.flush()
    db_session.rollback()


def test_urn_sequence_storage(db_session: Session) -> None:
    """urn_sequences stores year and sequential counter."""
    seq = UrnSequence(year=2026, last_seq=42)
    db_session.add(seq)
    db_session.flush()

    retrieved = db_session.scalar(select(UrnSequence).where(UrnSequence.year == 2026))
    assert retrieved is not None
    assert retrieved.last_seq == 42


def test_patient_constraints(db_session: Session) -> None:
    """patient model validates 12 canonical fields, gender, age, and uniqueness."""
    p1 = Patient(
        urn="KH-2026-0001",
        full_name="Rajesh Kumar",
        guardian_name="Mohan Kumar",
        gender="M",
        age_years=35,
        mobile="9876543210",
        address="Station Road, Ara",
        district="Bhojpur",
        state="Bihar",
        allergies="None reported",
    )
    db_session.add(p1)
    db_session.flush()
    assert p1.id is not None
    assert p1.version_id == 1

    # Invalid gender check
    p_bad_gender = Patient(
        urn="KH-2026-0002",
        full_name="Invalid Gender",
        guardian_name="Guardian",
        gender="Z",  # Invalid
        age_years=25,
        mobile="9876543211",
        address="Address",
    )
    db_session.add(p_bad_gender)
    with pytest.raises(IntegrityError, match="ck_patients_gender_valid"):
        db_session.flush()
    db_session.rollback()

    # Invalid age check (negative)
    p_bad_age = Patient(
        urn="KH-2026-0003",
        full_name="Invalid Age",
        guardian_name="Guardian",
        gender="F",
        age_years=-5,  # Invalid
        mobile="9876543212",
        address="Address",
    )
    db_session.add(p_bad_age)
    with pytest.raises(IntegrityError, match="ck_patients_age_valid"):
        db_session.flush()
    db_session.rollback()

    # Duplicate URN uniqueness check
    p_orig = Patient(
        urn="KH-2026-0004",
        full_name="First Patient",
        guardian_name="Guardian",
        gender="F",
        age_years=30,
        mobile="9876543214",
        address="Address",
    )
    db_session.add(p_orig)
    db_session.flush()

    p_dup_urn = Patient(
        urn="KH-2026-0004",  # Duplicate URN
        full_name="Duplicate Patient",
        guardian_name="Guardian",
        gender="M",
        age_years=40,
        mobile="9876543215",
        address="Address",
    )
    db_session.add(p_dup_urn)
    with pytest.raises(IntegrityError, match="uq_patients_urn"):
        db_session.flush()
    db_session.rollback()
