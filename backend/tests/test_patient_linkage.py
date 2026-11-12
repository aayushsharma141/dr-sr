"""Patient linkage and clinical-visibility regression tests (audit BR-001, BR-002).

BR-001: an encounter or prescription must belong to the same patient as the
appointment or encounter it is linked to. The backend previously checked only
doctor ownership, so a record could be filed under the wrong patient.

BR-002: the patient timeline must not give ADMIN or RECEPTION clinical content
(encounters, prescriptions, diagnoses, VAS scores, modalities). See DECISIONS
D-04 and the timeline router.
"""

from datetime import UTC, date, datetime

import pytest
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from kalyan_api.models import (
    Appointment,
    AppointmentStatus,
    AuditLog,
    ClinicalEncounter,
    FollowUpRecommendation,
    Patient,
    Payment,
    Prescription,
    TreatmentPlan,
    TreatmentSession,
    User,
    VitalObservation,
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


def _encounter_for(client, patient: Patient, appt: Appointment) -> int:
    resp = client.post(
        "/api/encounters",
        json={
            "patient_id": patient.id,
            "appointment_id": appt.id,
            "symptoms": "Shoulder pain",
            "clinical_notes": "Synthetic note",
            "diagnosis": "Frozen shoulder",
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _plan_payload(patient_id: int, encounter_id: int) -> dict:
    return {
        "patient_id": patient_id,
        "encounter_id": encounter_id,
        "plan_name": "Shoulder rehab package",
        "condition_diagnosis": "Frozen shoulder",
        "total_sessions": 10,
        "agreed_price_paise": 300000,
    }


def test_treatment_plan_rejects_encounter_of_another_patient(
    login_client, doctor_a_user, admin_user, db_session
):
    """A plan for patient B cannot be linked to patient A's encounter (BR-001, SEC-01)."""
    patient_a = _patient(db_session, "A4")
    patient_b = _patient(db_session, "B4")
    appt_a = _appointment(db_session, patient_a, doctor_a_user.doctor_id, admin_user)
    db_session.commit()

    client = login_client(doctor_a_user)
    encounter_id = _encounter_for(client, patient_a, appt_a)

    resp = client.post("/api/treatment-plans", json=_plan_payload(patient_b.id, encounter_id))
    assert resp.status_code == 404, resp.text
    assert resp.json()["code"] == "encounter_not_found"

    db_session.expire_all()
    assert db_session.scalar(select(func.count(TreatmentPlan.id))) == 0
    assert (
        db_session.scalar(
            select(func.count(AuditLog.id)).where(AuditLog.action == "TREATMENT_PLAN_CREATED")
        )
        == 0
    )


def test_treatment_plan_accepts_matching_patient_and_encounter(
    login_client, doctor_a_user, admin_user, db_session
):
    """Control: a plan for the encounter's own patient is still created."""
    patient = _patient(db_session, "A5")
    appt = _appointment(db_session, patient, doctor_a_user.doctor_id, admin_user)
    db_session.commit()

    client = login_client(doctor_a_user)
    encounter_id = _encounter_for(client, patient, appt)

    resp = client.post("/api/treatment-plans", json=_plan_payload(patient.id, encounter_id))
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["patient_id"] == patient.id
    assert body["encounter_id"] == encounter_id


# ------------------------------------------- SEC-03: database-level enforcement
# The API checks above can be bypassed by direct SQL or a future code path, so
# PostgreSQL itself must refuse a link between rows of two different patients.


def _db_encounter(
    db_session: Session,
    patient: Patient,
    doctor_id: int,
    user: User,
    appointment_id: int | None = None,
) -> ClinicalEncounter:
    encounter = ClinicalEncounter(
        patient_id=patient.id,
        doctor_id=doctor_id,
        appointment_id=appointment_id,
        symptoms="Synthetic symptoms",
        clinical_notes="Synthetic note",
        diagnosis="Synthetic diagnosis",
        created_by_user_id=user.id,
    )
    db_session.add(encounter)
    db_session.flush()
    return encounter


def test_db_rejects_encounter_linked_to_another_patients_appointment(
    doctor_a_user, admin_user, db_session
):
    patient_a = _patient(db_session, "D1")
    patient_b = _patient(db_session, "D2")
    appt_a = _appointment(db_session, patient_a, doctor_a_user.doctor_id, admin_user)

    with pytest.raises(IntegrityError) as exc_info, db_session.begin_nested():
        _db_encounter(db_session, patient_b, doctor_a_user.doctor_id, admin_user, appt_a.id)
    assert "fk_clinical_encounters_appointment_patient" in str(exc_info.value)


def test_db_rejects_prescription_linked_to_another_patients_encounter(
    doctor_a_user, admin_user, db_session
):
    patient_a = _patient(db_session, "D3")
    patient_b = _patient(db_session, "D4")
    encounter_a = _db_encounter(db_session, patient_a, doctor_a_user.doctor_id, admin_user)

    with pytest.raises(IntegrityError) as exc_info, db_session.begin_nested():
        db_session.add(
            Prescription(
                patient_id=patient_b.id,
                doctor_id=doctor_a_user.doctor_id,
                encounter_id=encounter_a.id,
                diagnosis="Synthetic diagnosis",
            )
        )
        db_session.flush()
    assert "fk_prescriptions_encounter_patient" in str(exc_info.value)


def test_db_rejects_treatment_plan_linked_to_another_patients_encounter(
    doctor_a_user, admin_user, db_session
):
    patient_a = _patient(db_session, "D5")
    patient_b = _patient(db_session, "D6")
    encounter_a = _db_encounter(db_session, patient_a, doctor_a_user.doctor_id, admin_user)

    with pytest.raises(IntegrityError) as exc_info, db_session.begin_nested():
        db_session.add(
            TreatmentPlan(
                patient_id=patient_b.id,
                doctor_id=doctor_a_user.doctor_id,
                encounter_id=encounter_a.id,
                plan_name="Synthetic package",
                condition_diagnosis="Synthetic diagnosis",
                total_sessions=5,
                agreed_price_paise=100000,
                status="ACTIVE",
            )
        )
        db_session.flush()
    assert "fk_treatment_plans_encounter_patient" in str(exc_info.value)


def test_db_blocks_moving_a_linked_encounter_to_another_patient(
    doctor_a_user, admin_user, db_session
):
    """An existing link cannot be broken later by re-pointing the child's patient."""
    patient_a = _patient(db_session, "D7")
    patient_b = _patient(db_session, "D8")
    appt_a = _appointment(db_session, patient_a, doctor_a_user.doctor_id, admin_user)
    encounter = _db_encounter(db_session, patient_a, doctor_a_user.doctor_id, admin_user, appt_a.id)

    with pytest.raises(IntegrityError), db_session.begin_nested():
        db_session.execute(
            update(ClinicalEncounter)
            .where(ClinicalEncounter.id == encounter.id)
            .values(patient_id=patient_b.id)
        )


def test_db_accepts_same_patient_links_and_unlinked_rows(doctor_a_user, admin_user, db_session):
    """Control: matching links and rows with no link are unaffected."""
    patient = _patient(db_session, "D9")
    appt = _appointment(db_session, patient, doctor_a_user.doctor_id, admin_user)
    linked = _db_encounter(db_session, patient, doctor_a_user.doctor_id, admin_user, appt.id)
    unlinked = _db_encounter(db_session, patient, doctor_a_user.doctor_id, admin_user)
    db_session.add(
        TreatmentPlan(
            patient_id=patient.id,
            doctor_id=doctor_a_user.doctor_id,
            encounter_id=linked.id,
            plan_name="Synthetic package",
            condition_diagnosis="Synthetic diagnosis",
            total_sessions=5,
            agreed_price_paise=100000,
            status="ACTIVE",
        )
    )
    db_session.add(
        TreatmentPlan(
            patient_id=patient.id,
            doctor_id=doctor_a_user.doctor_id,
            plan_name="Unlinked package",
            condition_diagnosis="Synthetic diagnosis",
            total_sessions=5,
            agreed_price_paise=100000,
            status="ACTIVE",
        )
    )
    db_session.flush()
    assert linked.appointment_id == appt.id
    assert unlinked.appointment_id is None


def test_deleting_an_appointment_still_only_unlinks_the_encounter(
    doctor_a_user, admin_user, db_session
):
    """Delete behaviour is unchanged: the link is cleared, the note keeps its patient."""
    patient = _patient(db_session, "DA")
    appt = _appointment(db_session, patient, doctor_a_user.doctor_id, admin_user)
    encounter = _db_encounter(db_session, patient, doctor_a_user.doctor_id, admin_user, appt.id)
    encounter_id = encounter.id

    db_session.execute(delete(Appointment).where(Appointment.id == appt.id))
    db_session.expire_all()

    refreshed = db_session.get(ClinicalEncounter, encounter_id)
    assert refreshed is not None
    assert refreshed.appointment_id is None
    assert refreshed.patient_id == patient.id


# ---------------------------------------------------------------- FB-04
def test_db_rejects_payment_linked_to_another_patients_treatment_plan(
    doctor_a_user, admin_user, db_session
):
    """FB-04: Payment cannot be linked to another patient's treatment plan."""
    patient_a = _patient(db_session, "F1")
    patient_b = _patient(db_session, "F2")
    plan_a = TreatmentPlan(
        patient_id=patient_a.id,
        doctor_id=doctor_a_user.doctor_id,
        plan_name="Package A",
        condition_diagnosis="Diagnosis A",
        total_sessions=10,
        agreed_price_paise=500000,
        status="ACTIVE",
    )
    db_session.add(plan_a)
    db_session.flush()

    with pytest.raises(IntegrityError) as exc_info, db_session.begin_nested():
        db_session.add(
            Payment(
                receipt_number="RCP-FB04-001",
                patient_id=patient_b.id,
                treatment_plan_id=plan_a.id,
                amount_paise=100000,
                payment_method="CASH",
                created_by_user_id=admin_user.id,
            )
        )
        db_session.flush()
    assert "fk_payments_treatment_plan_patient" in str(exc_info.value)


def test_db_rejects_payment_linked_to_another_patients_appointment(
    doctor_a_user, admin_user, db_session
):
    """FB-04: Payment cannot be linked to another patient's appointment."""
    patient_a = _patient(db_session, "F3")
    patient_b = _patient(db_session, "F4")
    appt_a = _appointment(db_session, patient_a, doctor_a_user.doctor_id, admin_user)

    with pytest.raises(IntegrityError) as exc_info, db_session.begin_nested():
        db_session.add(
            Payment(
                receipt_number="RCP-FB04-002",
                patient_id=patient_b.id,
                appointment_id=appt_a.id,
                amount_paise=40000,
                payment_method="CASH",
                created_by_user_id=admin_user.id,
            )
        )
        db_session.flush()
    assert "fk_payments_appointment_patient" in str(exc_info.value)


def test_db_rejects_treatment_session_linked_to_another_patients_treatment_plan(
    doctor_a_user, db_session
):
    """FB-04: TreatmentSession cannot be linked to another patient's treatment plan."""
    patient_a = _patient(db_session, "F5")
    patient_b = _patient(db_session, "F6")
    plan_a = TreatmentPlan(
        patient_id=patient_a.id,
        doctor_id=doctor_a_user.doctor_id,
        plan_name="Package A",
        condition_diagnosis="Diagnosis A",
        total_sessions=10,
        agreed_price_paise=500000,
        status="ACTIVE",
    )
    db_session.add(plan_a)
    db_session.flush()

    with pytest.raises(IntegrityError) as exc_info, db_session.begin_nested():
        db_session.add(
            TreatmentSession(
                treatment_plan_id=plan_a.id,
                patient_id=patient_b.id,
                doctor_id=doctor_a_user.doctor_id,
                session_number=1,
                vas_score=5,
                clinical_notes="Session notes",
                created_by_user_id=doctor_a_user.id,
            )
        )
        db_session.flush()
    assert "fk_treatment_sessions_plan_patient" in str(exc_info.value)


def test_db_rejects_vital_observation_linked_to_another_patients_encounter(
    doctor_a_user, admin_user, db_session
):
    """FB-04: VitalObservation cannot be linked to another patient's encounter."""
    patient_a = _patient(db_session, "F7")
    patient_b = _patient(db_session, "F8")
    encounter_a = _db_encounter(db_session, patient_a, doctor_a_user.doctor_id, admin_user)

    with pytest.raises(IntegrityError) as exc_info, db_session.begin_nested():
        db_session.add(
            VitalObservation(
                encounter_id=encounter_a.id,
                patient_id=patient_b.id,
                pulse_bpm=72,
            )
        )
        db_session.flush()
    assert "fk_vital_observations_encounter_patient" in str(exc_info.value)


def test_db_rejects_follow_up_recommendation_linked_to_another_patients_encounter(
    doctor_a_user, admin_user, db_session
):
    """FB-04: FollowUpRecommendation cannot be linked to another patient's encounter."""
    patient_a = _patient(db_session, "F9")
    patient_b = _patient(db_session, "FA")
    encounter_a = _db_encounter(db_session, patient_a, doctor_a_user.doctor_id, admin_user)

    with pytest.raises(IntegrityError) as exc_info, db_session.begin_nested():
        db_session.add(
            FollowUpRecommendation(
                encounter_id=encounter_a.id,
                patient_id=patient_b.id,
                doctor_id=doctor_a_user.doctor_id,
                recommended_doctor_id=doctor_a_user.doctor_id,
                recommended_date=date(2026, 3, 15),
                status="PENDING",
            )
        )
        db_session.flush()
    assert "fk_follow_up_recommendations_encounter_patient" in str(exc_info.value)


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


# ---------------------------------------------------------------- BR-010


def _cross_doctor_audits(db_session: Session, patient_id: int) -> list[AuditLog]:
    db_session.expire_all()
    return list(
        db_session.scalars(
            select(AuditLog).where(
                AuditLog.action == "CROSS_DOCTOR_CLINICAL_READ",
                AuditLog.entity_id == str(patient_id),
            )
        ).all()
    )


def test_cross_doctor_timeline_read_is_audited(
    login_client, doctor_a_user, doctor_b_user, admin_user, db_session
):
    """Doctor B reading Doctor A's records via the timeline leaves an audit row (BR-010, DWS-04)."""
    patient = _patient(db_session, "U1")
    _seed_clinical_history(db_session, patient, doctor_a_user.doctor_id, admin_user)

    _timeline(login_client(doctor_b_user), patient.id)

    rows = _cross_doctor_audits(db_session, patient.id)
    assert len(rows) == 1, rows
    assert rows[0].actor_user_id == doctor_b_user.id
    assert rows[0].actor_role == "DOCTOR"


def test_own_doctor_timeline_read_is_not_audited(
    login_client, doctor_a_user, admin_user, db_session
):
    """Doctor A reading their own encounters writes no cross-doctor audit row (BR-010)."""
    patient = _patient(db_session, "U2")
    _seed_clinical_history(db_session, patient, doctor_a_user.doctor_id, admin_user)

    _timeline(login_client(doctor_a_user), patient.id)

    assert _cross_doctor_audits(db_session, patient.id) == []
