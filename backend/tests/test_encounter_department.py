"""A consultation's department (specialty) follows the appointment, never a default (D-19-03)."""

from kalyan_api.models import Department, Doctor, Patient


def _patient(db_session, urn: str, mobile: str) -> Patient:
    patient = Patient(
        urn=urn,
        full_name="Specialty Patient",
        guardian_name="Guardian",
        gender="F",
        age_years=61,
        mobile=mobile,
        address="Ara",
    )
    db_session.add(patient)
    db_session.flush()
    return patient


def _eye_department(db_session) -> Department:
    dept = Department(code="TEST_EYE_SPECIALTY", name_en="Test Eye Specialty")
    db_session.add(dept)
    db_session.flush()
    return dept


def test_encounter_takes_the_department_booked_on_the_appointment(
    login_client, reception_user, doctor_a_user, db_session
):
    eye = _eye_department(db_session)
    doctor = db_session.get(Doctor, doctor_a_user.doctor_id)
    doctor.departments.append(eye)
    db_session.flush()
    patient = _patient(db_session, "KH-2026-7701", "9876547701")

    booked = login_client(reception_user).post(
        "/api/appointments",
        json={
            "patient_id": patient.id,
            "doctor_id": doctor.id,
            "department_id": eye.id,
            "appointment_date": "2026-11-08",
        },
    )
    assert booked.status_code == 201, booked.text

    created = login_client(doctor_a_user).post(
        "/api/encounters",
        json={
            "patient_id": patient.id,
            "appointment_id": booked.json()["id"],
            "symptoms": "Blurred distance vision",
            "clinical_notes": "",
            "diagnosis": "",
        },
    )
    assert created.status_code == 201, created.text
    assert created.json()["department_id"] == eye.id


def test_encounter_without_appointment_uses_the_doctors_only_department(
    login_client, doctor_a_user, db_session
):
    doctor = db_session.get(Doctor, doctor_a_user.doctor_id)
    eye = _eye_department(db_session)
    doctor.departments[:] = [eye]
    db_session.flush()
    patient = _patient(db_session, "KH-2026-7702", "9876547702")

    created = login_client(doctor_a_user).post(
        "/api/encounters",
        json={
            "patient_id": patient.id,
            "symptoms": "Eye strain",
            "clinical_notes": "",
            "diagnosis": "",
        },
    )
    assert created.status_code == 201, created.text
    assert created.json()["department_id"] == eye.id


def test_encounter_without_appointment_stays_unset_for_a_doctor_in_several_departments(
    login_client, doctor_a_user, db_session
):
    doctor = db_session.get(Doctor, doctor_a_user.doctor_id)
    eye = _eye_department(db_session)
    if eye not in doctor.departments:
        doctor.departments.append(eye)
    db_session.flush()
    assert len(doctor.departments) >= 2
    patient = _patient(db_session, "KH-2026-7703", "9876547703")

    created = login_client(doctor_a_user).post(
        "/api/encounters",
        json={"patient_id": patient.id, "symptoms": "Pain", "clinical_notes": "", "diagnosis": ""},
    )
    assert created.status_code == 201, created.text
    assert created.json()["department_id"] is None
