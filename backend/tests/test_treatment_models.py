"""Unit tests for Phase 14 models, constraints, and database triggers.

Requirements:
- RX-01: Structured prescription schema and item order.
- TRT-01: Treatment plans/packages with sessions, diagnosis, agreed price.
- TRT-02: Chronological treatment sessions with VAS scoring (0-10).
- TRT-03: Finalised session immutability trigger and addenda support.
"""

from datetime import date

import pytest
from sqlalchemy.exc import DBAPIError, IntegrityError

from kalyan_api.models import (
    Patient,
    Prescription,
    PrescriptionItem,
    TreatmentPlan,
    TreatmentPlanStatus,
    TreatmentSession,
    TreatmentSessionAddendum,
)


def _create_test_patient(db_session, suffix="01") -> Patient:
    patient = Patient(
        urn=f"KH-2026-88{suffix}",
        full_name=f"Treatment Test Patient {suffix}",
        guardian_name="Guardian",
        gender="F",
        age_years=40,
        mobile=f"98765488{suffix}",
        address="123 Hospital Road",
        district="Bhojpur",
        state="Bihar",
    )
    db_session.add(patient)
    db_session.flush()
    return patient


def test_treatment_models_persistence(db_session, doctor_a_user):
    """Verify TreatmentPlan, TreatmentSession, Addendum, Prescription, PrescriptionItem models."""
    doctor_id = doctor_a_user.doctor_id
    assert doctor_id is not None
    patient = _create_test_patient(db_session, "01")

    # 1. Create TreatmentPlan
    plan = TreatmentPlan(
        patient_id=patient.id,
        doctor_id=doctor_id,
        plan_name="Cervical Spondylosis 10-Session Rehab",
        condition_diagnosis="Cervical Radiculopathy C5-C6",
        referred_by="Dr. S. Roy",
        total_sessions=10,
        agreed_price_paise=500000,
        status=TreatmentPlanStatus.ACTIVE.value,
    )
    db_session.add(plan)
    db_session.flush()
    assert plan.id is not None
    assert plan.completed_sessions == 0
    assert plan.status == "ACTIVE"

    # 2. Create Prescription
    rx = Prescription(
        patient_id=patient.id,
        doctor_id=doctor_id,
        diagnosis="Cervical Radiculopathy",
        dietary_advice="Avoid excess sodium and processed food",
        general_advice="Maintain ergonomic neck posture, use cervical pillow",
        follow_up_date=date(2026, 11, 15),
    )
    db_session.add(rx)
    db_session.flush()
    assert rx.id is not None

    # 3. Create PrescriptionItem
    item1 = PrescriptionItem(
        prescription_id=rx.id,
        item_order=1,
        medicine_name="Tab Pregabalin",
        dosage="75mg",
        frequency="1-0-1",
        duration_days=14,
        instructions="Take after food at bedtime",
    )
    db_session.add(item1)
    db_session.flush()
    assert item1.id is not None
    assert len(rx.items) == 1

    # 4. Create TreatmentSession
    session1 = TreatmentSession(
        treatment_plan_id=plan.id,
        patient_id=patient.id,
        doctor_id=doctor_id,
        session_number=1,
        session_date=date(2026, 11, 1),
        vas_score=8,
        modalities=["IFT", "Cervical Traction", "Hot Pack"],
        clinical_notes="Session 1 completed. Patient reports severe radiating neck pain.",
        is_finalised=True,
        created_by_user_id=doctor_a_user.id,
    )
    db_session.add(session1)
    db_session.flush()
    assert session1.id is not None

    # Check that progress sync trigger updated completed_sessions
    db_session.refresh(plan)
    assert plan.completed_sessions == 1
    assert plan.status == "ACTIVE"

    # 5. Create TreatmentSessionAddendum
    addendum = TreatmentSessionAddendum(
        session_id=session1.id,
        author_user_id=doctor_a_user.id,
        note="Patient tolerated traction well. Home isometric exercises explained.",
    )
    db_session.add(addendum)
    db_session.flush()
    assert addendum.id is not None
    assert addendum.session_id == session1.id


def test_treatment_plan_constraints(db_session, doctor_a_user):
    """Verify check constraints on TreatmentPlan."""
    doctor_id = doctor_a_user.doctor_id
    patient = _create_test_patient(db_session, "02")

    # Invalid total_sessions < 1
    with pytest.raises(DBAPIError):
        with db_session.begin_nested():
            invalid_plan = TreatmentPlan(
                patient_id=patient.id,
                doctor_id=doctor_id,
                plan_name="Invalid Plan",
                condition_diagnosis="Low back pain",
                total_sessions=0,
                agreed_price_paise=100000,
            )
            db_session.add(invalid_plan)
            db_session.flush()

    # Invalid negative price
    with pytest.raises(DBAPIError):
        with db_session.begin_nested():
            invalid_plan = TreatmentPlan(
                patient_id=patient.id,
                doctor_id=doctor_id,
                plan_name="Invalid Plan",
                condition_diagnosis="Low back pain",
                total_sessions=5,
                agreed_price_paise=-100,
            )
            db_session.add(invalid_plan)
            db_session.flush()

    # Cancelled status without cancellation_reason
    with pytest.raises(DBAPIError):
        with db_session.begin_nested():
            invalid_plan = TreatmentPlan(
                patient_id=patient.id,
                doctor_id=doctor_id,
                plan_name="Cancelled Plan",
                condition_diagnosis="Low back pain",
                total_sessions=5,
                agreed_price_paise=100000,
                status="CANCELLED",
                cancellation_reason=None,
            )
            db_session.add(invalid_plan)
            db_session.flush()


def test_treatment_session_constraints(db_session, doctor_a_user):
    """Verify check constraints and uniqueness on TreatmentSession."""
    doctor_id = doctor_a_user.doctor_id
    patient = _create_test_patient(db_session, "03")

    plan = TreatmentPlan(
        patient_id=patient.id,
        doctor_id=doctor_id,
        plan_name="Lumbar Package",
        condition_diagnosis="Lumbar Disc Herniation",
        total_sessions=5,
        agreed_price_paise=250000,
    )
    db_session.add(plan)
    db_session.flush()

    # Invalid VAS score > 10
    with pytest.raises(DBAPIError):
        with db_session.begin_nested():
            sess = TreatmentSession(
                treatment_plan_id=plan.id,
                patient_id=patient.id,
                doctor_id=doctor_id,
                session_number=1,
                vas_score=11,  # Invalid
                clinical_notes="Valid note",
                created_by_user_id=doctor_a_user.id,
            )
            db_session.add(sess)
            db_session.flush()

    # Invalid VAS score < 0
    with pytest.raises(DBAPIError):
        with db_session.begin_nested():
            sess = TreatmentSession(
                treatment_plan_id=plan.id,
                patient_id=patient.id,
                doctor_id=doctor_id,
                session_number=1,
                vas_score=-1,  # Invalid
                clinical_notes="Valid note",
                created_by_user_id=doctor_a_user.id,
            )
            db_session.add(sess)
            db_session.flush()

    # Unique constraint on (treatment_plan_id, session_number)
    sess1 = TreatmentSession(
        treatment_plan_id=plan.id,
        patient_id=patient.id,
        doctor_id=doctor_id,
        session_number=1,
        vas_score=5,
        clinical_notes="Session 1",
        created_by_user_id=doctor_a_user.id,
    )
    db_session.add(sess1)
    db_session.flush()

    with pytest.raises(IntegrityError):
        with db_session.begin_nested():
            sess1_dup = TreatmentSession(
                treatment_plan_id=plan.id,
                patient_id=patient.id,
                doctor_id=doctor_id,
                session_number=1,  # Duplicate session_number for this plan
                vas_score=4,
                clinical_notes="Duplicate Session 1",
                created_by_user_id=doctor_a_user.id,
            )
            db_session.add(sess1_dup)
            db_session.flush()


def test_finalised_treatment_session_immutability_trigger(db_session, doctor_a_user):
    """Verify PostgreSQL trigger prevents tampering with finalised treatment sessions (TRT-03)."""
    doctor_id = doctor_a_user.doctor_id
    patient = _create_test_patient(db_session, "04")

    plan = TreatmentPlan(
        patient_id=patient.id,
        doctor_id=doctor_id,
        plan_name="Frozen Shoulder Package",
        condition_diagnosis="Adhesive Capsulitis",
        total_sessions=10,
        agreed_price_paise=500000,
    )
    db_session.add(plan)
    db_session.flush()

    sess = TreatmentSession(
        treatment_plan_id=plan.id,
        patient_id=patient.id,
        doctor_id=doctor_id,
        session_number=1,
        vas_score=7,
        clinical_notes="Shoulder mobilization performed.",
        is_finalised=True,
        created_by_user_id=doctor_a_user.id,
    )
    db_session.add(sess)
    db_session.flush()

    # Modifying clinical notes on finalised session must fail
    with pytest.raises(DBAPIError) as exc_info:
        with db_session.begin_nested():
            sess.clinical_notes = "Tampered shoulder note"
            db_session.flush()
    assert "Finalised treatment session cannot be modified" in str(exc_info.value)

    # Modifying VAS score on finalised session must fail
    with pytest.raises(DBAPIError) as exc_info_vas:
        with db_session.begin_nested():
            sess.vas_score = 3
            db_session.flush()
    assert "Finalised treatment session cannot be modified" in str(exc_info_vas.value)

    # Deleting finalised session must fail
    with pytest.raises(DBAPIError) as exc_info_del:
        with db_session.begin_nested():
            db_session.delete(sess)
            db_session.flush()
    assert "Finalised treatment session cannot be deleted" in str(exc_info_del.value)


def test_progress_sync_auto_completes_plan(db_session, doctor_a_user):
    """Verify trigger syncs session count and marks plan COMPLETED when all sessions logged."""
    doctor_id = doctor_a_user.doctor_id
    patient = _create_test_patient(db_session, "05")

    plan = TreatmentPlan(
        patient_id=patient.id,
        doctor_id=doctor_id,
        plan_name="Short 2-Session Package",
        condition_diagnosis="Acute Sprain",
        total_sessions=2,
        agreed_price_paise=120000,
    )
    db_session.add(plan)
    db_session.flush()
    assert plan.completed_sessions == 0
    assert plan.status == "ACTIVE"

    # Log session 1
    s1 = TreatmentSession(
        treatment_plan_id=plan.id,
        patient_id=patient.id,
        doctor_id=doctor_id,
        session_number=1,
        vas_score=6,
        clinical_notes="Session 1 note",
        created_by_user_id=doctor_a_user.id,
    )
    db_session.add(s1)
    db_session.flush()

    db_session.refresh(plan)
    assert plan.completed_sessions == 1
    assert plan.status == "ACTIVE"

    # Log session 2 (reaches total_sessions=2)
    s2 = TreatmentSession(
        treatment_plan_id=plan.id,
        patient_id=patient.id,
        doctor_id=doctor_id,
        session_number=2,
        vas_score=2,
        clinical_notes="Session 2 note",
        created_by_user_id=doctor_a_user.id,
    )
    db_session.add(s2)
    db_session.flush()

    db_session.refresh(plan)
    assert plan.completed_sessions == 2
    assert plan.status == "COMPLETED"
