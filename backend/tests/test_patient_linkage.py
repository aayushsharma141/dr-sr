"""Patient linkage and clinical-visibility regression tests (audit BR-001, BR-002).

BR-001: an encounter or prescription must belong to the same patient as the
appointment or encounter it is linked to. The backend previously checked only
doctor ownership, so a record could be filed under the wrong patient.

BR-002: the patient timeline must not give ADMIN or RECEPTION clinical content
(encounters, prescriptions, diagnoses, VAS scores, modalities). See DECISIONS
D-04 and the timeline router.
"""

from datetime import UTC, date, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from kalyan_api.models import (
    Appointment,
    AppointmentStatus,
    ClinicalEncounter,
    Patient,
    Prescription,
    TreatmentPlan,
    TreatmentSession,
    User,
)


def _patient(db_session: Session, suffix: str) -> Patient:
    patient = Patient(
        urn=f"KH-2026-B1{suffix}",
        full_name=f"Linkage Patient {suffix}",
        guardian_name="Guardian",
        gender="F",
        age_years=34,
        mobile="9000000001",
        address="Ara, Bihar",
        district="Bhojpur",
        state="Bihar",
        is_active=True,
    )
    db_session.add(patient)
    db_session.flush()
    return patient


def _appointment(db_session: Session, patient: Patient, doctor_id: int, user: User) -> Appointment:
    appt = Appointment(
        patient_id=patient.id,
        doctor_id=doctor_id,
        appointment_date=date(2026, 11, 20),
        token_number=1,
        status=AppointmentStatus.BOOKED.value,
        created_by_user_id=user.id,
    )
    db_session.add(appt)
    db_session.flush()
    return appt


# ---------------------------------------------------------------- BR-001


def test_encounter_rejects_appointment_of_another_patient(
    login_client, doctor_a_user, admin_user, db_session
):
    """Saving a note on patient B under patient A's appointment is refused (BR-001)."""
    patient_a = _patient(db_session, "A1")
    patient_b = _patient(db_session, "B1")
    appt_a = _appointment(db_session, patient_a, doctor_a_user.doctor_id, admin_user)
    db_session.commit()

    client = login_client(doctor_a_user)
    resp = client.post(
        "/api/encounters",
        json={
            "patient_id": patient_b.id,
            "appointment_id": appt_a.id,
            "symptoms": "Knee pain",
            "clinical_notes": "Mismatched patient",
            "diagnosis": "Should not be saved",
        },
    )
    assert resp.status_code == 404, resp.text
    assert resp.json()["code"] == "appointment_not_found"

    db_session.expire_all()
    assert db_session.scalar(select(func.count(ClinicalEncounter.id))) == 0
    refreshed = db_session.get(Appointment, appt_a.id)
    assert refreshed.status == AppointmentStatus.BOOKED.value


def test_encounter_accepts_matching_patient_and_appointment(
    login_client, doctor_a_user, admin_user, db_session
):
    """Control: the same patient and appointment still create the encounter."""
    patient = _patient(db_session, "A2")
    appt = _appointment(db_session, patient, doctor_a_user.doctor_id, admin_user)
    db_session.commit()

    client = login_client(doctor_a_user)
    resp = client.post(
        "/api/encounters",
        json={
            "patient_id": patient.id,
            "appointment_id": appt.id,
            "symptoms": "Knee pain",
            "clinical_notes": "Matching patient",
            "diagnosis": "Osteoarthritis",
        },
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["patient_id"] == patient.id


def test_prescription_rejects_encounter_of_another_patient(
    login_client, doctor_a_user, admin_user, db_session
):
    """A prescription cannot be issued for patient B against patient A's encounter (BR-001)."""
    patient_a = _patient(db_session, "A3")
    patient_b = _patient(db_session, "B3")
    appt_a = _appointment(db_session, patient_a, doctor_a_user.doctor_id, admin_user)
    db_session.commit()

    client = login_client(doctor_a_user)
    enc_resp = client.post(
        "/api/encounters",
        json={
            "patient_id": patient_a.id,
            "appointment_id": appt_a.id,
            "symptoms": "Back pain",
            "clinical_notes": "Patient A",
            "diagnosis": "Lumbar strain",
        },
    )
    assert enc_resp.status_code == 201, enc_resp.text
    encounter_id = enc_resp.json()["id"]

    resp = client.post(
        "/api/prescriptions",
        json={
            "patient_id": patient_b.id,
            "encounter_id": encounter_id,
            "diagnosis": "Mismatched",
            "items": [
                {
                    "item_order": 1,
                    "medicine_name": "Tab Paracetamol",
                    "dosage": "650 mg",
                    "frequency": "1-0-1",
                    "duration_days": 3,
                    "instructions": "After food",
                }
            ],
        },
    )
    assert resp.status_code == 404, resp.text
    assert resp.json()["code"] == "encounter_not_found"

    db_session.expire_all()
    assert (
        db_session.scalar(
            select(func.count(Prescription.id)).where(Prescription.patient_id == patient_b.id)
        )
        == 0
    )


# ---------------------------------------------------------------- BR-002


def _seed_clinical_history(db_session: Session, patient: Patient, doctor_id: int, user: User):
    encounter = ClinicalEncounter(
        patient_id=patient.id,
        doctor_id=doctor_id,
        encounter_date=datetime(2026, 3, 1, 10, 30, tzinfo=UTC),
        symptoms="Severe lower back pain",
        clinical_notes="Disc stiffness",
        diagnosis="Lumbar radiculopathy",
        is_finalised=True,
        created_by_user_id=user.id,
    )
    db_session.add(encounter)
    plan = TreatmentPlan(
        patient_id=patient.id,
        doctor_id=doctor_id,
        plan_name="Rehab package",
        condition_diagnosis="Frozen shoulder",
        total_sessions=6,
        completed_sessions=1,
        agreed_price_paise=300000,
        status="ACTIVE",
    )
    db_session.add(plan)
    db_session.flush()
    db_session.add(
        TreatmentSession(
            treatment_plan_id=plan.id,
            patient_id=patient.id,
            doctor_id=doctor_id,
            session_number=1,
            session_date=date(2026, 3, 3),
            vas_score=7,
            modalities="IFT + Hot Pack",
            clinical_notes="Pain reduced after session",
            is_finalised=True,
            created_by_user_id=user.id,
        )
    )
    db_session.commit()


def _timeline(client, patient_id: int) -> list[dict]:
    resp = client.get(f"/api/patients/{patient_id}/timeline")
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_admin_timeline_hides_encounters_and_prescriptions(
    login_client, admin_user, doctor_a_user, db_session
):
    """ADMIN timeline has no encounter or prescription content (BR-002, D-04)."""
    patient = _patient(db_session, "T1")
    _seed_clinical_history(db_session, patient, doctor_a_user.doctor_id, admin_user)

    events = _timeline(login_client(admin_user), patient.id)
    types = {e["event_type"] for e in events}
    assert "ENCOUNTER" not in types
    assert "PRESCRIPTION" not in types
    blob = " ".join(str(e) for e in events)
    assert "Lumbar radiculopathy" not in blob
    assert "Disc stiffness" not in blob


def test_reception_timeline_hides_clinical_fields_of_sessions_and_plans(
    login_client, reception_user, doctor_a_user, admin_user, db_session
):
    """RECEPTION sees session attendance but not VAS, modalities, notes or diagnosis (BR-002)."""
    patient = _patient(db_session, "T2")
    _seed_clinical_history(db_session, patient, doctor_a_user.doctor_id, admin_user)

    events = _timeline(login_client(reception_user), patient.id)
    sessions = [e for e in events if e["event_type"] == "TREATMENT_SESSION"]
    plans = [e for e in events if e["event_type"] == "TREATMENT_PLAN"]
    assert sessions, "reception should still see that a session happened"
    assert plans, "reception should still see the package"

    for event in sessions:
        assert "VAS" not in event["summary"], event
        assert "IFT" not in event["summary"], event
        assert "vas_score" not in event["metadata"] or event["metadata"]["vas_score"] is None
    for event in plans:
        assert "Frozen shoulder" not in event["summary"], event
        assert "Diagnosis" not in event["summary"], event
    assert "Pain reduced" not in " ".join(str(e) for e in events)


def test_doctor_timeline_keeps_clinical_content(
    login_client, doctor_a_user, admin_user, db_session
):
    """Control: the treating doctor still sees encounters, VAS and diagnosis."""
    patient = _patient(db_session, "T3")
    _seed_clinical_history(db_session, patient, doctor_a_user.doctor_id, admin_user)

    events = _timeline(login_client(doctor_a_user), patient.id)
    types = {e["event_type"] for e in events}
    assert "ENCOUNTER" in types
    sessions = [e for e in events if e["event_type"] == "TREATMENT_SESSION"]
    assert any("VAS: 7/10" in e["summary"] for e in sessions)
