"""
Unit tests for PatientService validation, registration, search, and persistence.
"""

from pathlib import Path
import pytest

from app.db.connection import get_db_connection, init_db
from app.services.patient_service import PatientService, ValidationError


@pytest.fixture
def test_db(tmp_path):
    """Provides an isolated initialized SQLite database for testing."""
    db_file = tmp_path / "test_clinic.db"
    init_db(db_file)
    return db_file


def test_patient_registration_valid(test_db):
    """Verify that a patient with valid details registers and receives a sequential URN."""
    service = PatientService(test_db)

    patient_data = {
        "patient_name": "Ramesh Kumar",
        "age": 45,
        "sex": "Male",
        "mobile_no": "9876543210",
        "address": "Station Road, Ara, Bhojpur",
        "referred_by": "Dr. Sharma",
        "patient_condition": "Chronic Cervical Spondylosis",
    }

    patient = service.register_patient(patient_data)

    assert patient is not None
    assert patient["id"] > 0
    assert patient["serial_urn_no"].startswith("KH-")
    assert patient["patient_name"] == "Ramesh Kumar"
    assert patient["age"] == 45
    assert patient["sex"] == "Male"
    assert patient["mobile_no"] == "9876543210"
    assert patient["status"] == "ACTIVE"


def test_persistence_after_reconnect(test_db):
    """Verify that saved patient records persist cleanly across connection resets."""
    service1 = PatientService(test_db)
    patient = service1.register_patient({
        "patient_name": "Sunita Devi",
        "age": 52,
        "sex": "Female",
        "mobile_no": "9123456789",
        "patient_condition": "Osteoarthritis Knee",
    })
    saved_urn = patient["serial_urn_no"]

    # Reconnect using a fresh service instance
    service2 = PatientService(test_db)
    fetched = service2.get_patient_by_urn(saved_urn)

    assert fetched is not None
    assert fetched["patient_name"] == "Sunita Devi"
    assert fetched["age"] == 52
    assert fetched["mobile_no"] == "9123456789"


def test_invalid_inputs_rejected(test_db):
    """Verify that invalid inputs raise ValidationError with clear messaging."""
    service = PatientService(test_db)

    # Empty name
    with pytest.raises(ValidationError, match="Patient Name is required"):
        service.register_patient({
            "patient_name": "   ",
            "age": 30,
            "sex": "Male",
            "mobile_no": "9876543210",
            "patient_condition": "Back Pain",
        })

    # Age out of range
    with pytest.raises(ValidationError, match="Age must be between 0 and 125"):
        service.register_patient({
            "patient_name": "Invalid Age",
            "age": -5,
            "sex": "Male",
            "mobile_no": "9876543210",
            "patient_condition": "Back Pain",
        })

    # Invalid mobile (too short)
    with pytest.raises(ValidationError, match="10-digit phone number"):
        service.register_patient({
            "patient_name": "Short Mobile",
            "age": 30,
            "sex": "Male",
            "mobile_no": "12345",
            "patient_condition": "Back Pain",
        })

    # Missing condition
    with pytest.raises(ValidationError, match="Condition / Diagnosis is required"):
        service.register_patient({
            "patient_name": "No Condition",
            "age": 30,
            "sex": "Male",
            "mobile_no": "9876543210",
            "patient_condition": "",
        })


def test_search_by_id_name_mobile(test_db):
    """Verify multi-field search filters accurately by URN, Name, or Mobile."""
    service = PatientService(test_db)

    p1 = service.register_patient({
        "patient_name": "Amit Kumar Verma",
        "age": 28,
        "sex": "Male",
        "mobile_no": "9911223344",
        "patient_condition": "Shoulder Impingement",
    })

    p2 = service.register_patient({
        "patient_name": "Pooja Singh",
        "age": 34,
        "sex": "Female",
        "mobile_no": "9888777666",
        "patient_condition": "Lower Back Strain",
    })

    # Search by Name
    results_name = service.search_patients("Pooja")
    assert len(results_name) == 1
    assert results_name[0]["serial_urn_no"] == p2["serial_urn_no"]

    # Search by Mobile substring
    results_mobile = service.search_patients("2233")
    assert len(results_mobile) == 1
    assert results_mobile[0]["serial_urn_no"] == p1["serial_urn_no"]

    # Search by URN
    results_urn = service.search_patients(p1["serial_urn_no"])
    assert len(results_urn) == 1
    assert results_urn[0]["patient_name"] == "Amit Kumar Verma"


def test_photo_storage_and_retrieval(test_db, tmp_path):
    """Verify that patient photo is safely copied to storage directory."""
    service = PatientService(test_db)

    # Create a dummy image file
    dummy_photo = tmp_path / "sample_avatar.jpg"
    dummy_photo.write_bytes(b"\xFF\xD8\xFF\xE0\x00\x10JFIF")  # Fake JPEG header

    patient = service.register_patient(
        {
            "patient_name": "Vikram Rathore",
            "age": 40,
            "sex": "Male",
            "mobile_no": "9555444333",
            "patient_condition": "Sciatica",
        },
        photo_source_path=dummy_photo,
    )

    assert patient["photo_filename"] != ""
    assert patient["photo_filename"].endswith(".jpg")
    assert patient["photo_full_path"] is not None
    assert Path(patient["photo_full_path"]).exists()


def test_non_destructive_update(test_db):
    """Verify that updating patient details preserves creation URN and timestamps."""
    service = PatientService(test_db)

    patient = service.register_patient({
        "patient_name": "Gita Devi",
        "age": 60,
        "sex": "Female",
        "mobile_no": "9444333222",
        "address": "Old Address, Ara",
        "patient_condition": "Post-stroke Rehab",
    })
    original_id = patient["id"]
    original_urn = patient["serial_urn_no"]

    # Update address and condition
    updated = service.update_patient(
        original_id,
        {
            "patient_name": "Gita Devi",
            "age": 60,
            "sex": "Female",
            "mobile_no": "9444333222",
            "address": "New Address, Nawada, Ara",
            "patient_condition": "Post-stroke Rehab (Progressing)",
        },
    )

    assert updated["id"] == original_id
    assert updated["serial_urn_no"] == original_urn
    assert updated["address"] == "New Address, Nawada, Ara"
    assert updated["patient_condition"] == "Post-stroke Rehab (Progressing)"
