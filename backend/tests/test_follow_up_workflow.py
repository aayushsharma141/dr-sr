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
    # No token until the patient is checked in (RF-12).
    assert appt.token_number is None
    assert appt.status == "BOOKED"

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


# ---------------------------------------------------------------------------
# Phase 4 RBAC & workflow hardening (C7 + T4.2 finalise-then-follow-up order)
# ---------------------------------------------------------------------------


def test_doctor_cannot_book_follow_up_recommendation(
    login_client, doctor_a_user, doctor_b_user, db_session
):
    """Only reception may book appointments from follow-up recommendations (403 reception_only)."""
    patient, _encounter, rec_id = _pending_recommendation(
        login_client, doctor_a_user, db_session, "21"
    )

    doc_a_resp = login_client(doctor_a_user).post(f"/api/follow-ups/{rec_id}/book", json={})
    assert doc_a_resp.status_code == 403, doc_a_resp.text
    assert doc_a_resp.json()["code"] == "reception_only"

    doc_b_resp = login_client(doctor_b_user).post(f"/api/follow-ups/{rec_id}/book", json={})
    assert doc_b_resp.status_code == 403, doc_b_resp.text
    assert doc_b_resp.json()["code"] == "reception_only"

    _assert_not_booked(db_session, rec_id, patient.id)


def test_reception_follow_ups_scoping_for_doctors_reception_and_admin(
    login_client, admin_user, reception_user, doctor_a_user, doctor_b_user, db_session
):
    """Doctors only see recommendations where they are authoring or recommended doctor;
    Reception and Admin see all recommendations with clinical_reason strictly omitted."""
    pat_a = _create_test_patient(db_session, "22")
    pat_b = _create_test_patient(db_session, "23")
    pat_ref = _create_test_patient(db_session, "24")

    enc_a = _create_test_encounter(db_session, pat_a.id, doctor_a_user.doctor_id, doctor_a_user.id)
    enc_b = _create_test_encounter(db_session, pat_b.id, doctor_b_user.doctor_id, doctor_b_user.id)
    enc_ref = _create_test_encounter(
        db_session, pat_ref.id, doctor_a_user.doctor_id, doctor_a_user.id
    )

    doc_a = login_client(doctor_a_user)
    doc_b = login_client(doctor_b_user)
    rec_client = login_client(reception_user)
    admin_client = login_client(admin_user)

    target_date = (ist_today() + timedelta(days=7)).isoformat()
    secret_a = "PRIVATE-A: Reassess rotator cuff tear MRI"
    secret_b = "PRIVATE-B: Reassess optic disc cupping"

    rec_a_id = doc_a.post(
        f"/api/encounters/{enc_a.id}/follow-up",
        json={"recommended_date": target_date, "clinical_reason": secret_a},
    ).json()["id"]
    rec_b_id = doc_b.post(
        f"/api/encounters/{enc_b.id}/follow-up",
        json={"recommended_date": target_date, "clinical_reason": secret_b},
    ).json()["id"]
    rec_ref_id = doc_a.post(
        f"/api/encounters/{enc_ref.id}/follow-up",
        json={
            "recommended_date": target_date,
            "recommended_doctor_id": doctor_b_user.doctor_id,
            "clinical_reason": "Cross-specialty referral to Doctor B",
        },
    ).json()["id"]

    # Doctor A sees own recommendation and cross-referral authored by A, NOT Doctor B's own
    doc_a_resp = doc_a.get("/api/reception/follow-ups")
    assert doc_a_resp.status_code == 200, doc_a_resp.text
    doc_a_ids = {row["id"] for row in doc_a_resp.json()}
    assert rec_a_id in doc_a_ids
    assert rec_ref_id in doc_a_ids
    assert rec_b_id not in doc_a_ids
    assert all("clinical_reason" not in row for row in doc_a_resp.json())

    # Doctor B sees own recommendation and cross-referral addressed to B, NOT Doctor A's own
    doc_b_resp = doc_b.get("/api/reception/follow-ups")
    assert doc_b_resp.status_code == 200, doc_b_resp.text
    doc_b_ids = {row["id"] for row in doc_b_resp.json()}
    assert rec_b_id in doc_b_ids
    assert rec_ref_id in doc_b_ids
    assert rec_a_id not in doc_b_ids
    assert all("clinical_reason" not in row for row in doc_b_resp.json())

    # Reception sees all recommendations with clinical_reason strictly omitted
    rec_resp = rec_client.get("/api/reception/follow-ups")
    assert rec_resp.status_code == 200, rec_resp.text
    rec_ids = {row["id"] for row in rec_resp.json()}
    assert {rec_a_id, rec_b_id, rec_ref_id}.issubset(rec_ids)
    assert all("clinical_reason" not in row for row in rec_resp.json())
    assert secret_a not in rec_resp.text
    assert secret_b not in rec_resp.text

    # Admin also sees all recommendations with clinical_reason strictly omitted
    adm_resp = admin_client.get("/api/reception/follow-ups")
    assert adm_resp.status_code == 200, adm_resp.text
    adm_ids = {row["id"] for row in adm_resp.json()}
    assert {rec_a_id, rec_b_id, rec_ref_id}.issubset(adm_ids)
    assert all("clinical_reason" not in row for row in adm_resp.json())
    assert secret_a not in adm_resp.text
    assert secret_b not in adm_resp.text


def test_doctor_close_follow_up_scoping_and_cross_doctor_404(
    login_client, doctor_a_user, doctor_b_user, db_session
):
    """Doctors can close own/recommended PENDING follow-ups; cross-doctor close returns 404."""
    _pat_a, _enc_a, rec_a_id = _pending_recommendation(
        login_client, doctor_a_user, db_session, "25"
    )

    doc_a = login_client(doctor_a_user)
    doc_b = login_client(doctor_b_user)

    # Doctor B cannot close Doctor A's recommendation -> 404 anti-enumeration
    cross_close = doc_b.post(
        f"/api/follow-ups/{rec_a_id}/close",
        json={"reason": "Attempted cross-doctor closure"},
    )
    assert cross_close.status_code == 404, cross_close.text
    assert cross_close.json()["code"] == "follow_up_not_found"

    db_session.expire_all()
    assert db_session.get(FollowUpRecommendation, rec_a_id).status == "PENDING"

    # Doctor A can close own PENDING recommendation -> 200 CLOSED
    own_close = doc_a.post(
        f"/api/follow-ups/{rec_a_id}/close",
        json={"reason": "Symptoms resolved during phone review"},
    )
    assert own_close.status_code == 200, own_close.text
    assert own_close.json()["status"] == "CLOSED"

    # Recommended doctor (Doctor B) can also close a referral addressed to them -> 200 CLOSED
    pat_ref = _create_test_patient(db_session, "26")
    enc_ref = _create_test_encounter(
        db_session, pat_ref.id, doctor_a_user.doctor_id, doctor_a_user.id
    )
    ref_create = doc_a.post(
        f"/api/encounters/{enc_ref.id}/follow-up",
        json={
            "recommended_date": (ist_today() + timedelta(days=5)).isoformat(),
            "recommended_doctor_id": doctor_b_user.doctor_id,
            "clinical_reason": "Ophthalmology evaluation",
        },
    )
    assert ref_create.status_code == 201, ref_create.text
    ref_id = ref_create.json()["id"]

    rec_doc_close = doc_b.post(
        f"/api/follow-ups/{ref_id}/close",
        json={"reason": "Patient already evaluated in separate clinic visit"},
    )
    assert rec_doc_close.status_code == 200, rec_doc_close.text
    assert rec_doc_close.json()["status"] == "CLOSED"


def test_create_follow_up_on_finalised_encounter_succeeds(
    login_client, doctor_a_user, db_session
):
    """Creating a follow-up recommendation after encounter finalisation succeeds (201)."""
    patient = _create_test_patient(db_session, "27")
    encounter = _create_test_encounter(
        db_session, patient.id, doctor_a_user.doctor_id, doctor_a_user.id
    )
    doc_a = login_client(doctor_a_user)

    finalise_resp = doc_a.post(
        f"/api/encounters/{encounter.id}/finalise",
        json={
            "version_id": encounter.version_id,
            "symptoms": "Bilateral knee pain, crepitus",
            "diagnosis": "Knee Osteoarthritis Grade 2",
        },
    )
    assert finalise_resp.status_code == 200, finalise_resp.text
    assert finalise_resp.json()["is_finalised"] is True

    target_date = (ist_today() + timedelta(days=14)).isoformat()
    fu_resp = doc_a.post(
        f"/api/encounters/{encounter.id}/follow-up",
        json={
            "recommended_date": target_date,
            "clinical_reason": "Post-finalisation physiotherapy reassessment",
        },
    )
    assert fu_resp.status_code == 201, fu_resp.text
    fu_data = fu_resp.json()
    assert fu_data["encounter_id"] == encounter.id
    assert fu_data["status"] == "PENDING"
    assert fu_data["recommended_date"] == target_date
