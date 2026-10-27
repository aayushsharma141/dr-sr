"""
Unit tests for TreatmentService and TreatmentRepository.
Kalyan Hospital Management System.
"""

import pytest
from app.db.connection import init_db
from app.services.patient_service import PatientService
from app.services.treatment_service import TreatmentService


@pytest.fixture
def test_db(tmp_path):
    """Provides an isolated initialized SQLite database for tests."""
    db_file = tmp_path / "test_kalyan.db"
    init_db(str(db_file))
    return str(db_file)


@pytest.fixture
def sample_patient(test_db):
    """Registers a fictional sample patient for treatment tests."""
    patient_service = PatientService(test_db)
    return patient_service.register_patient({
        "patient_name": "Ramesh Kumar Sharma",
        "age": 45,
        "sex": "Male",
        "mobile_no": "9876543210",
        "address": "Nawada, Ara",
        "patient_condition": "Chronic Lower Back Pain",
    })


def test_create_treatment_case(test_db, sample_patient):
    """Verifies opening a treatment case with target sessions and agreed fee."""
    treatment_service = TreatmentService(test_db)
    case = treatment_service.open_treatment_case(
        patient_id=sample_patient["id"],
        title="Lumbar Spondylosis Rehabilitation",
        no_of_sessions=10,
        total_amount_rupees=3500.0,
        notes="Referred by Dr. Madan Mohan Dwivedi",
    )

    assert case["id"] is not None
    assert case["patient_id"] == sample_patient["id"]
    assert case["title"] == "Lumbar Spondylosis Rehabilitation"
    assert case["no_of_sessions"] == 10
    assert case["total_amount_paise"] == 350000
    assert case["status"] == "IN_PROGRESS"


def test_log_chronological_sessions(test_db, sample_patient):
    """Verifies that sessions are numbered sequentially and retrieved chronologically."""
    treatment_service = TreatmentService(test_db)
    case = treatment_service.open_treatment_case(
        patient_id=sample_patient["id"],
        title="Cervical Traction Plan",
        no_of_sessions=5,
        total_amount_rupees=2000,
    )

    s1 = treatment_service.log_session(
        case_id=case["id"],
        treatment_notes="Day 1: Initial assessment and gentle cervical traction.",
        therapist_name="Dr. Chandan Kr. Dwivedi",
        modalities_used="Traction, IFT",
        pain_score=8,
    )
    s2 = treatment_service.log_session(
        case_id=case["id"],
        treatment_notes="Day 2: Increased traction weight to 5kg.",
        therapist_name="Dr. Chandan Kr. Dwivedi",
        modalities_used="Traction, Hot Pack",
        pain_score=6,
    )
    s3 = treatment_service.log_session(
        case_id=case["id"],
        treatment_notes="Day 3: Patient reports pain reduction.",
        therapist_name="Dr. Chandan Kr. Dwivedi",
        modalities_used="Traction, Hot Pack, Exercise",
        pain_score=4,
    )

    assert s1["session_number"] == 1
    assert s2["session_number"] == 2
    assert s3["session_number"] == 3

    history = treatment_service.get_case_with_history(case["id"])
    assert history["completed_sessions"] == 3
    assert history["target_sessions"] == 5
    assert history["progress_pct"] == 60
    assert len(history["sessions"]) == 3
    assert history["sessions"][0]["session_number"] == 1
    assert history["sessions"][2]["session_number"] == 3


def test_pain_score_validation(test_db, sample_patient):
    """Verifies pain score bounds (0-10) and rejection of out-of-range values."""
    treatment_service = TreatmentService(test_db)
    case = treatment_service.open_treatment_case(
        patient_id=sample_patient["id"],
        title="Pain Score Bounds Test",
        no_of_sessions=3,
        total_amount_rupees=1000,
    )

    # Valid pain score 0 (no pain)
    s0 = treatment_service.log_session(
        case_id=case["id"],
        treatment_notes="Patient pain-free.",
        pain_score=0,
    )
    assert s0["pain_score"] == 0

    # Valid pain score 10 (severe)
    s10 = treatment_service.log_session(
        case_id=case["id"],
        treatment_notes="Severe acute flare-up.",
        pain_score=10,
    )
    assert s10["pain_score"] == 10

    # Invalid negative pain score
    with pytest.raises(ValueError, match="between 0 and 10"):
        treatment_service.log_session(
            case_id=case["id"],
            treatment_notes="Invalid pain.",
            pain_score=-1,
        )

    # Invalid pain score > 10
    with pytest.raises(ValueError, match="between 0 and 10"):
        treatment_service.log_session(
            case_id=case["id"],
            treatment_notes="Invalid pain high.",
            pain_score=11,
        )


def test_empty_clinical_notes_rejected(test_db, sample_patient):
    """Verifies that empty clinical treatment notes are rejected."""
    treatment_service = TreatmentService(test_db)
    case = treatment_service.open_treatment_case(
        patient_id=sample_patient["id"],
        title="Notes Validation Case",
        no_of_sessions=2,
    )

    with pytest.raises(ValueError, match="cannot be empty"):
        treatment_service.log_session(
            case_id=case["id"],
            treatment_notes="   ",
        )


def test_multiple_cases_per_patient(test_db, sample_patient):
    """Verifies that opening multiple cases for a patient keeps sessions isolated."""
    treatment_service = TreatmentService(test_db)
    c1 = treatment_service.open_treatment_case(
        patient_id=sample_patient["id"],
        title="Case 1: Knee Osteoarthritis",
        no_of_sessions=5,
    )
    c2 = treatment_service.open_treatment_case(
        patient_id=sample_patient["id"],
        title="Case 2: Frozen Shoulder",
        no_of_sessions=8,
    )

    treatment_service.log_session(case_id=c1["id"], treatment_notes="Knee ultrasound")
    treatment_service.log_session(case_id=c2["id"], treatment_notes="Shoulder mobilization 1")
    treatment_service.log_session(case_id=c2["id"], treatment_notes="Shoulder mobilization 2")

    c1_hist = treatment_service.get_case_with_history(c1["id"])
    c2_hist = treatment_service.get_case_with_history(c2["id"])

    assert c1_hist["completed_sessions"] == 1
    assert c2_hist["completed_sessions"] == 2
