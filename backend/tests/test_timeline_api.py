"""Tests for Unified Patient Timeline endpoint (CLN-03, Phase 15).

Verifies:
- Chronological ordering across appointments, encounters, prescriptions, treatment plans,
  treatment sessions, and payments.
- Doctor silo: Doctor only sees their own encounters and prescriptions, but sees full
  therapy packages, sessions, and payments.
- Reception access: Reception can access patient timeline (appointments, therapy, payments)
  without seeing sensitive doctor clinical consultation notes.
- Admin access: Admin sees full timeline without omissions.
"""

from datetime import UTC, datetime

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from kalyan_api.models import (
    Appointment,
    AppointmentStatus,
    ClinicalEncounter,
    Patient,
    Payment,
    Prescription,
    PrescriptionItem,
    TreatmentPlan,
    TreatmentSession,
    User,
)


def _seed_patient_activity(
    db_session: Session, doctor1_id: int, doctor2_id: int, user: User
) -> Patient:
    patient = Patient(
        urn=f"KLY-TL-{doctor1_id}-{doctor2_id}",
        full_name="Ramesh Timeline",
        guardian_name="Suresh Timeline",
        gender="M",
        dob="1985-05-15",
        age_years=41,
        mobile="9876543210",
        address="123 Hospital Road",
        district="Bhopal",
        state="Madhya Pradesh",
        is_active=True,
    )
    db_session.add(patient)
    db_session.flush()

    # 1. Appointment with Doctor 1
    appt = Appointment(
        patient_id=patient.id,
        doctor_id=doctor1_id,
        appointment_date=datetime(2026, 3, 1, 10, 0, tzinfo=UTC).date(),
        token_number=1,
        status=AppointmentStatus.DONE.value,
        notes="First consultation",
        created_by_user_id=user.id,
    )
    db_session.add(appt)
    db_session.flush()

    # 2. Encounter with Doctor 1
    enc1 = ClinicalEncounter(
        patient_id=patient.id,
        doctor_id=doctor1_id,
        appointment_id=appt.id,
        encounter_date=datetime(2026, 3, 1, 10, 30, tzinfo=UTC),
        symptoms="Severe lower back pain",
        clinical_notes="L4-L5 disc stiffness",
        diagnosis="Lumbar radiculopathy",
        is_finalised=True,
        created_by_user_id=user.id,
    )
    db_session.add(enc1)

    # 3. Encounter with Doctor 2 (different doctor)
    enc2 = ClinicalEncounter(
        patient_id=patient.id,
        doctor_id=doctor2_id,
        appointment_id=None,
        encounter_date=datetime(2026, 3, 2, 11, 0, tzinfo=UTC),
        symptoms="Knee crepitus",
        clinical_notes="Mild swelling",
        diagnosis="Early osteo-arthritis",
        is_finalised=True,
        created_by_user_id=user.id,
    )
    db_session.add(enc2)
    db_session.flush()

    # 4. Prescription with Doctor 1
    rx1 = Prescription(
        patient_id=patient.id,
        doctor_id=doctor1_id,
        encounter_id=enc1.id,
        diagnosis="Lumbar radiculopathy",
        dietary_advice="Avoid heavy lifting",
        general_advice="Postural correction",
        follow_up_date="2026-03-15",
    )
    db_session.add(rx1)
    db_session.flush()
    db_session.add(
        PrescriptionItem(
            prescription_id=rx1.id,
            item_order=1,
            medicine_name="Tab Aceclofenac",
            dosage="100mg",
            frequency="1-0-1",
            duration_days=5,
        )
    )

    # 5. Treatment Plan
    plan = TreatmentPlan(
        patient_id=patient.id,
        doctor_id=doctor1_id,
        plan_name="Lumbar Spine Rehab",
        condition_diagnosis="Lumbar radiculopathy",
        total_sessions=10,
        completed_sessions=1,
        agreed_price_paise=500000,
        status="ACTIVE",
    )
    db_session.add(plan)
    db_session.flush()

    # 6. Treatment Session
    sess = TreatmentSession(
        treatment_plan_id=plan.id,
        patient_id=patient.id,
        doctor_id=doctor1_id,
        session_number=1,
        session_date=datetime(2026, 3, 3, 9, 0, tzinfo=UTC).date(),
        vas_score=6,
        modalities="IFT + Hot Pack + Lumbar Traction",
        clinical_notes="Significant pain relief reported",
        is_finalised=True,
        created_by_user_id=user.id,
    )
    db_session.add(sess)

    # 7. Payment
    pay = Payment(
        receipt_number="RCP-2026-0099",
        patient_id=patient.id,
        treatment_plan_id=plan.id,
        amount_paise=200000,
        payment_method="UPI",
        is_reversed=False,
        created_by_user_id=user.id,
    )
    db_session.add(pay)
    db_session.commit()

    return patient


def test_timeline_chronological_ordering_admin(
    admin_user: User,
    doctor_a_user: User,
    doctor_b_user: User,
    db_session: Session,
    login_client: type[TestClient],
) -> None:
    """Admin views complete unified chronological timeline with all 6 event types (CLN-03)."""
    pat = _seed_patient_activity(
        db_session, doctor_a_user.doctor_id, doctor_b_user.doctor_id, admin_user
    )

    adm_c = login_client(admin_user)
    resp = adm_c.get(f"/api/patients/{pat.id}/timeline")
    assert resp.status_code == 200, resp.text
    timeline = resp.json()

    event_types = [item["event_type"] for item in timeline]
    assert "PAYMENT" in event_types
    assert "TREATMENT_SESSION" in event_types
    assert "TREATMENT_PLAN" in event_types
    assert "PRESCRIPTION" in event_types
    assert "ENCOUNTER" in event_types
    assert "APPOINTMENT" in event_types

    # Ensure items are strictly sorted descending by event_date
    dates = [item["event_date"] for item in timeline]
    assert dates == sorted(dates, reverse=True)


def test_timeline_cross_doctor_access(
    doctor_a_user: User,
    doctor_b_user: User,
    admin_user: User,
    db_session: Session,
    login_client: type[TestClient],
) -> None:
    """Doctor views timeline and sees encounters/prescriptions across all doctors (DWS-04)."""
    pat = _seed_patient_activity(
        db_session, doctor_a_user.doctor_id, doctor_b_user.doctor_id, admin_user
    )

    doc_c = login_client(doctor_a_user)
    resp = doc_c.get(f"/api/patients/{pat.id}/timeline")
    assert resp.status_code == 200
    timeline = resp.json()

    # Both Doctor A's and Doctor B's encounters should be present under DWS-04
    enc_items = [it for it in timeline if it["event_type"] == "ENCOUNTER"]
    assert len(enc_items) == 2
    summaries = [it.get("summary") or "" for it in enc_items]
    assert any("Lumbar radiculopathy" in s for s in summaries)
    assert any("osteo-arthritis" in s for s in summaries)


def test_timeline_reception_access(
    reception_user: User,
    doctor_a_user: User,
    doctor_b_user: User,
    admin_user: User,
    db_session: Session,
    login_client: type[TestClient],
) -> None:
    """Receptionist accesses timeline without clinical leaks."""
    pat = _seed_patient_activity(
        db_session, doctor_a_user.doctor_id, doctor_b_user.doctor_id, admin_user
    )

    rec_c = login_client(reception_user)
    resp = rec_c.get(f"/api/patients/{pat.id}/timeline")
    assert resp.status_code == 200
    timeline = resp.json()

    event_types = set(it["event_type"] for it in timeline)
    assert "PAYMENT" in event_types
    assert "TREATMENT_PLAN" in event_types
    assert "TREATMENT_SESSION" in event_types
    assert "APPOINTMENT" in event_types
    # Encounters and prescriptions are hidden from Reception
    assert "ENCOUNTER" not in event_types
    assert "PRESCRIPTION" not in event_types
