"""Tests for follow-up recommendations workflow and reception privacy separation (DWS-08, D-19-18,
D-19-19, D-19-20, D-19-21)."""

from datetime import timedelta

from kalyan_api.clock import ist_today
from kalyan_api.models import (
    Appointment,
    ClinicalEncounter,
    Department,
    Doctor,
    FollowUpRecommendation,
    Patient,
)


def _create_test_patient(db_session, suffix="40") -> Patient:
    patient = Patient(
        urn=f"KH-2026-99{suffix}",
        full_name=f"Follow-Up Patient {suffix}",
        guardian_name="Guardian Name",
        gender="M",
        age_years=42,
        mobile=f"98765499{suffix}",
        address="Gaya, Bihar",
        district="Gaya",
        state="Bihar",
    )
    db_session.add(patient)
    db_session.flush()
    return patient


def _create_test_encounter(
    db_session,
    patient_id: int,
    doctor_id: int,
    user_id: int,
    diagnosis="Knee Osteoarthritis Grade 2",
) -> ClinicalEncounter:
    encounter = ClinicalEncounter(
        patient_id=patient_id,
        doctor_id=doctor_id,
        created_by_user_id=user_id,
        symptoms="Bilateral knee pain, crepitus",
        clinical_notes="Mild swelling, reduced flexion",
        diagnosis=diagnosis,
        is_finalised=False,
    )
    db_session.add(encounter)
    db_session.flush()
    return encounter


def test_doctor_creates_and_retrieves_follow_up(
    login_client, doctor_a_user, doctor_b_user, db_session
):
    """Doctor records follow-up recommendation with clinical reason and retrieves it."""
    patient = _create_test_patient(db_session, "01")
    encounter = _create_test_encounter(
        db_session, patient.id, doctor_a_user.doctor_id, doctor_a_user.id
    )
    doc_a_client = login_client(doctor_a_user)

    target_date = (ist_today() + timedelta(days=14)).isoformat()
    payload = {
        "recommended_date": target_date,
        # recommended_doctor_id omitted: defaults to current doctor per D-19-20
        "clinical_reason": (
            "Evaluate response to quadriceps strengthening and hyaluronic acid trial."
        ),
    }

    create_resp = doc_a_client.post(f"/api/encounters/{encounter.id}/follow-up", json=payload)
    assert create_resp.status_code == 201, create_resp.text
    data = create_resp.json()
    assert data["encounter_id"] == encounter.id
    assert data["patient_id"] == patient.id
    assert data["doctor_id"] == doctor_a_user.doctor_id
    assert data["recommended_doctor_id"] == doctor_a_user.doctor_id
    assert data["recommended_date"] == target_date
    assert (
        data["clinical_reason"]
        == "Evaluate response to quadriceps strengthening and hyaluronic acid trial."
    )
    assert data["status"] == "PENDING"
    assert data["booked_appointment_id"] is None

    # Doctor retrieves recommendation
    get_resp = doc_a_client.get(f"/api/encounters/{encounter.id}/follow-up")
    assert get_resp.status_code == 200
    get_data = get_resp.json()
    assert (
        get_data["clinical_reason"]
        == "Evaluate response to quadriceps strengthening and hyaluronic acid trial."
    )

    # Duplicate creation on same encounter is rejected (409)
    dup_resp = doc_a_client.post(f"/api/encounters/{encounter.id}/follow-up", json=payload)
    assert dup_resp.status_code == 409
    assert dup_resp.json()["code"] == "follow_up_exists"


def test_reception_cannot_view_clinical_reason(
    login_client, doctor_a_user, reception_user, db_session
):
    """Reception querying follow-up recommendations receives projected data with ZERO clinical
    reason (D-19-19, R-3, T-19-07)."""
    patient = _create_test_patient(db_session, "02")
    encounter = _create_test_encounter(
        db_session, patient.id, doctor_a_user.doctor_id, doctor_a_user.id
    )
    doc_client = login_client(doctor_a_user)

    target_date = (ist_today() + timedelta(days=7)).isoformat()
    sensitive_clinical_reason = (
        "CONFIDENTIAL: Suspected neurodegenerative gait ataxia, re-evaluate cerebellar signs."
    )
    doc_client.post(
        f"/api/encounters/{encounter.id}/follow-up",
        json={
            "recommended_date": target_date,
            "clinical_reason": sensitive_clinical_reason,
        },
    )

    # Receptionist calls /api/reception/follow-ups
    rec_client = login_client(reception_user)
    rec_resp = rec_client.get("/api/reception/follow-ups")
    assert rec_resp.status_code == 200, rec_resp.text
    items = rec_resp.json()
    assert len(items) >= 1

    matching = [it for it in items if it["encounter_id"] == encounter.id]
    assert len(matching) == 1
    match = matching[0]

    # Verification: required reception fields are present
    assert match["patient_name"] == patient.full_name
    assert match["patient_urn"] == patient.urn
    assert match["recommended_date"] == target_date
    assert match["status"] == "PENDING"

    # CRITICAL PRIVACY ASSERTION: clinical_reason is NEVER in reception payload
    assert "clinical_reason" not in match
    # Full response body must not contain the sensitive clinical text anywhere
    assert sensitive_clinical_reason not in rec_resp.text


def test_booking_recommendation_converts_to_appointment(
    login_client, doctor_a_user, reception_user, db_session
):
    """Receptionist or Doctor books an appointment from a pending recommendation (D-19-18)."""
    patient = _create_test_patient(db_session, "03")
    encounter = _create_test_encounter(
        db_session, patient.id, doctor_a_user.doctor_id, doctor_a_user.id
    )
    doc_client = login_client(doctor_a_user)

    target_date = (ist_today() + timedelta(days=10)).isoformat()
    create_resp = doc_client.post(
        f"/api/encounters/{encounter.id}/follow-up",
        json={
            "recommended_date": target_date,
            "clinical_reason": "Post-injection review",
        },
    )
    rec_id = create_resp.json()["id"]

    # Receptionist books appointment from recommendation
    rec_client = login_client(reception_user)
    book_resp = rec_client.post(
        f"/api/follow-ups/{rec_id}/book",
        json={"notes": "Booked morning slot via phone call"},
    )
    assert book_resp.status_code == 200, book_resp.text
    booked_data = book_resp.json()
    assert booked_data["status"] == "BOOKED"
    assert booked_data["booked_appointment_id"] is not None

    appt_id = booked_data["booked_appointment_id"]
    appt = db_session.get(Appointment, appt_id)
    assert appt is not None
    assert appt.patient_id == patient.id
    assert appt.doctor_id == doctor_a_user.doctor_id
    assert appt.appointment_date.isoformat() == target_date
    assert appt.token_number >= 1

    # Attempting to book already-booked recommendation returns 409
    dup_book = rec_client.post(f"/api/follow-ups/{rec_id}/book", json={})
    assert dup_book.status_code == 409
    assert dup_book.json()["code"] == "invalid_status"


def test_closing_recommendation_requires_reason(
    login_client, doctor_a_user, reception_user, db_session
):
    """Recommendation can be closed with recorded reason and never expires automatically
    (D-19-21)."""
    patient = _create_test_patient(db_session, "04")
    encounter = _create_test_encounter(
        db_session, patient.id, doctor_a_user.doctor_id, doctor_a_user.id
    )
    doc_client = login_client(doctor_a_user)

    past_date = (ist_today() - timedelta(days=5)).isoformat()
    create_resp = doc_client.post(
        f"/api/encounters/{encounter.id}/follow-up",
        json={
            "recommended_date": past_date,
            "clinical_reason": "Follow up for routine suture removal",
        },
    )
    rec_id = create_resp.json()["id"]

    # Unbooked past recommendation remains PENDING / overdue (never auto-expired per D-19-21)
    rec_client = login_client(reception_user)
    overdue_resp = rec_client.get("/api/reception/follow-ups?overdue=true")
    assert overdue_resp.status_code == 200
    overdue_ids = [it["id"] for it in overdue_resp.json()]
    assert rec_id in overdue_ids

    # Closing with short reason (<3 chars) is rejected (422)
    short_close = rec_client.post(f"/api/follow-ups/{rec_id}/close", json={"reason": "no"})
    assert short_close.status_code == 422

    # Closing with valid reason succeeds
    close_resp = rec_client.post(
        f"/api/follow-ups/{rec_id}/close",
        json={"reason": "Patient called to state sutures were removed at local dispensary."},
    )
    assert close_resp.status_code == 200, close_resp.text
    closed_data = close_resp.json()
    assert closed_data["status"] == "CLOSED"

    # Closed recommendation cannot be booked
    book_attempt = rec_client.post(f"/api/follow-ups/{rec_id}/book", json={})
    assert book_attempt.status_code == 409
    assert book_attempt.json()["code"] == "invalid_status"


# ---------------------------------------------------------------------------
# BR-012: follow-up booking must apply the same doctor, department and patient
# rules as ordinary booking (ADR-23, ADR-24, ADR-25).
# ---------------------------------------------------------------------------


def _pending_recommendation(login_client, doctor_user, db_session, suffix: str):
    patient = _create_test_patient(db_session, suffix)
    encounter = _create_test_encounter(
        db_session, patient.id, doctor_user.doctor_id, doctor_user.id
    )
    resp = login_client(doctor_user).post(
        f"/api/encounters/{encounter.id}/follow-up",
        json={
            "recommended_date": (ist_today() + timedelta(days=7)).isoformat(),
            "clinical_reason": "Review progress",
        },
    )
    assert resp.status_code == 201, resp.text
    return patient, encounter, resp.json()["id"]


def _assert_not_booked(db_session, rec_id: int, patient_id: int) -> None:
    db_session.expire_all()
    rec = db_session.get(FollowUpRecommendation, rec_id)
    assert rec.status == "PENDING"
    assert rec.booked_appointment_id is None
    assert db_session.query(Appointment).filter_by(patient_id=patient_id).count() == 0


def test_follow_up_booking_records_the_doctors_department(
    login_client, doctor_a_user, reception_user, db_session
):
    _patient, _encounter, rec_id = _pending_recommendation(
        login_client, doctor_a_user, db_session, "11"
    )
    doctor = db_session.get(Doctor, doctor_a_user.doctor_id)
    expected_department_id = doctor.departments[0].id

    resp = login_client(reception_user).post(f"/api/follow-ups/{rec_id}/book", json={})
    assert resp.status_code == 200, resp.text

    appt = db_session.get(Appointment, resp.json()["booked_appointment_id"])
    assert appt.department_id == expected_department_id


def test_follow_up_booking_rejects_inactive_doctor(
    login_client, doctor_a_user, reception_user, db_session
):
    patient, _encounter, rec_id = _pending_recommendation(
        login_client, doctor_a_user, db_session, "12"
    )
    db_session.get(Doctor, doctor_a_user.doctor_id).is_active = False
    db_session.flush()

    resp = login_client(reception_user).post(f"/api/follow-ups/{rec_id}/book", json={})
    assert resp.status_code == 404, resp.text
    assert resp.json()["code"] == "doctor_not_found"
    _assert_not_booked(db_session, rec_id, patient.id)


def test_follow_up_booking_rejects_inactive_department(
    login_client, doctor_a_user, reception_user, db_session
):
    patient, _encounter, rec_id = _pending_recommendation(
        login_client, doctor_a_user, db_session, "13"
    )
    for dept in db_session.get(Doctor, doctor_a_user.doctor_id).departments:
        dept.is_active = False
    db_session.flush()

    resp = login_client(reception_user).post(f"/api/follow-ups/{rec_id}/book", json={})
    assert resp.status_code == 422, resp.text
    assert resp.json()["code"] == "department_inactive"
    _assert_not_booked(db_session, rec_id, patient.id)


def test_follow_up_booking_rejects_inactive_patient(
    login_client, doctor_a_user, reception_user, db_session
):
    patient, _encounter, rec_id = _pending_recommendation(
        login_client, doctor_a_user, db_session, "14"
    )
    patient.is_active = False
    db_session.flush()

    resp = login_client(reception_user).post(f"/api/follow-ups/{rec_id}/book", json={})
    assert resp.status_code == 404, resp.text
    assert resp.json()["code"] == "patient_not_found"
    _assert_not_booked(db_session, rec_id, patient.id)


def test_follow_up_booking_needs_department_when_doctor_has_several(
    login_client, doctor_a_user, reception_user, db_session
):
    patient, _encounter, rec_id = _pending_recommendation(
        login_client, doctor_a_user, db_session, "15"
    )
    doctor = db_session.get(Doctor, doctor_a_user.doctor_id)
    eye = Department(code="TEST_FOLLOWUP_EYE", name_en="Test Follow-up Eye", is_active=True)
    other = Department(code="TEST_FOLLOWUP_OTHER", name_en="Test Follow-up Other", is_active=True)
    db_session.add_all([eye, other])
    doctor.departments.append(eye)
    db_session.flush()
    rec_client = login_client(reception_user)

    # Two active departments and none on the encounter: the caller must choose.
    ambiguous = rec_client.post(f"/api/follow-ups/{rec_id}/book", json={})
    assert ambiguous.status_code == 422, ambiguous.text
    assert ambiguous.json()["code"] == "department_required"
    _assert_not_booked(db_session, rec_id, patient.id)

    # A department the doctor does not belong to is refused.
    mismatch = rec_client.post(f"/api/follow-ups/{rec_id}/book", json={"department_id": other.id})
    assert mismatch.status_code == 422, mismatch.text
    assert mismatch.json()["code"] == "doctor_department_mismatch"
    _assert_not_booked(db_session, rec_id, patient.id)

    # Naming one of the doctor's departments books into it.
    ok = rec_client.post(f"/api/follow-ups/{rec_id}/book", json={"department_id": eye.id})
    assert ok.status_code == 200, ok.text
    appt = db_session.get(Appointment, ok.json()["booked_appointment_id"])
    assert appt.department_id == eye.id


def test_follow_up_booking_prefers_the_encounter_department(
    login_client, doctor_a_user, reception_user, db_session
):
    patient = _create_test_patient(db_session, "16")
    doctor = db_session.get(Doctor, doctor_a_user.doctor_id)
    eye = Department(code="TEST_FOLLOWUP_EYE2", name_en="Test Follow-up Eye 2", is_active=True)
    db_session.add(eye)
    doctor.departments.append(eye)
    db_session.flush()
    encounter = _create_test_encounter(db_session, patient.id, doctor.id, doctor_a_user.id)
    encounter.department_id = eye.id
    db_session.flush()
    create = login_client(doctor_a_user).post(
        f"/api/encounters/{encounter.id}/follow-up",
        json={"recommended_date": (ist_today() + timedelta(days=7)).isoformat()},
    )
    assert create.status_code == 201, create.text

    resp = login_client(reception_user).post(f"/api/follow-ups/{create.json()['id']}/book", json={})
    assert resp.status_code == 200, resp.text
    appt = db_session.get(Appointment, resp.json()["booked_appointment_id"])
    assert appt.department_id == eye.id
