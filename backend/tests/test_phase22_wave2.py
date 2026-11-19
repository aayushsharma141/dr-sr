"""Phase 22 Wave 2: emergency acknowledgement, doctor-to-doctor reassignment, queue order.

Owner decisions of 2026-11-15 (.planning/phases/22-integrated-opd-workflow/22-DESIGN.md):
OD-22-07 suggested order: EMERGENCY by classification time, then PRIORITY, then NORMAL, each by
token; OD-22-09 an emergency alert stays until the assigned doctor acknowledges it; design §5
reassignment cancels the waiting consultation and creates a new WAITING one for the new doctor on
the same visit with a new token; OD-22-16 Referred By defaults to Self on the status path.

The clock fixture freezes utcnow at 2026-11-02 04:30 UTC, which is 10:00 IST on 2 Nov 2026.
"""

from sqlalchemy import select

from kalyan_api.models import (
    Appointment,
    AuditLog,
    ConsultationPriorityEvent,
    Department,
    Patient,
    Visit,
)
from kalyan_api.services.audit_service import AuditAction


def _patient(db_session, suffix: str) -> Patient:
    patient = Patient(
        urn=f"KH-2026-W2{suffix}",
        full_name=f"Wave Two {suffix}",
        guardian_name="Guardian",
        gender="F",
        age_years=50,
        mobile="9876500033",
        address="Ara",
    )
    db_session.add(patient)
    db_session.flush()
    return patient


def _share_department(db_session, doctor_a_user, doctor_b_user):
    """Both doctors see doctor A's first department (the fixtures already share one).

    Kept as an explicit precondition: these tests cover same-department reassignment.
    """
    dept = doctor_a_user.doctor.departments[0]
    if dept not in doctor_b_user.doctor.departments:
        doctor_b_user.doctor.departments.append(dept)
        db_session.flush()
    return dept


def _book_and_check_in(
    reception, patient, doctor_user, dept, *, priority: str = "NORMAL", reason: str | None = None
) -> dict:
    """A walk-in is booked and checked in at once: WAITING with a token (RF-12)."""
    body = {
        "patient_id": patient.id,
        "doctor_id": doctor_user.doctor_id,
        "department_id": dept.id,
        "referral_source": "SELF",
        "priority_level": priority,
    }
    if reason is not None:
        body["priority_reason"] = reason
    walked = reception.post("/api/appointments/walk-in", json=body)
    assert walked.status_code == 201, walked.text
    return walked.json()


# ------------------------------------------------------------------ ARRIVED default referral


def test_status_path_arrival_opens_visit_with_default_self_referral(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    dept = doctor_a_user.doctor.departments[0]
    patient = _patient(db_session, "A1")
    reception = login_client(reception_user)
    booked_resp = reception.post(
        "/api/appointments",
        json={
            "patient_id": patient.id,
            "doctor_id": doctor_a_user.doctor_id,
            "department_id": dept.id,
            "appointment_date": "2026-11-02",
            "notes": "Phone booking",
        },
    )
    assert booked_resp.status_code == 201, booked_resp.text
    booked = booked_resp.json()
    assert booked["status"] == "BOOKED"

    arrived = reception.patch(
        f"/api/appointments/{booked['id']}/status",
        json={"status": "ARRIVED", "version_id": booked["version_id"]},
    )

    assert arrived.status_code == 200, arrived.text
    visit = db_session.get(Visit, arrived.json()["visit_id"])
    assert visit.referral_source == "SELF"


# ------------------------------------------------------------------ emergency acknowledgement


def test_owner_doctor_acknowledges_emergency_alert_once(
    clock, login_client, reception_user, doctor_a_user, doctor_b_user, db_session
):
    dept = _share_department(db_session, doctor_a_user, doctor_b_user)
    patient = _patient(db_session, "E1")
    reception = login_client(reception_user)
    checked = _book_and_check_in(
        reception, patient, doctor_a_user, dept, priority="EMERGENCY", reason="Chest pain"
    )
    assert checked["emergency_alerted_at"] is not None
    assert checked["alert_acknowledged_at"] is None

    doctor_a = login_client(doctor_a_user)
    ack = doctor_a.post(
        f"/api/appointments/{checked['id']}/acknowledge-alert",
        json={"version_id": checked["version_id"]},
    )

    assert ack.status_code == 200, ack.text
    assert ack.json()["alert_acknowledged_at"] is not None
    appt = db_session.get(Appointment, checked["id"])
    assert appt.alert_acknowledged_by_user_id == doctor_a_user.id
    events = list(
        db_session.scalars(
            select(ConsultationPriorityEvent).where(
                ConsultationPriorityEvent.appointment_id == checked["id"],
                ConsultationPriorityEvent.event == "ACKNOWLEDGED",
            )
        )
    )
    assert len(events) == 1
    audit = db_session.scalars(
        select(AuditLog).where(
            AuditLog.action == AuditAction.APPOINTMENT_ALERT_ACKNOWLEDGED.value,
            AuditLog.entity_id == str(checked["id"]),
        )
    ).all()
    assert len(audit) == 1

    again = doctor_a.post(
        f"/api/appointments/{checked['id']}/acknowledge-alert",
        json={"version_id": ack.json()["version_id"]},
    )
    assert again.status_code == 409
    assert again.json()["code"] == "alert_already_acknowledged"


def test_other_doctor_and_reception_cannot_acknowledge_alert(
    clock, login_client, reception_user, doctor_a_user, doctor_b_user, db_session
):
    dept = _share_department(db_session, doctor_a_user, doctor_b_user)
    patient = _patient(db_session, "E2")
    reception = login_client(reception_user)
    checked = _book_and_check_in(
        reception, patient, doctor_a_user, dept, priority="EMERGENCY", reason="Fall"
    )
    body = {"version_id": checked["version_id"]}

    assert (
        login_client(doctor_b_user)
        .post(f"/api/appointments/{checked['id']}/acknowledge-alert", json=body)
        .status_code
        == 404
    )
    assert (
        reception.post(f"/api/appointments/{checked['id']}/acknowledge-alert", json=body).status_code
        == 403
    )
    appt = db_session.get(Appointment, checked["id"])
    assert appt.alert_acknowledged_at is None


# ------------------------------------------------------------------ reassignment


def test_reassign_moves_waiting_patient_to_new_doctor_on_same_visit(
    clock, login_client, reception_user, doctor_a_user, doctor_b_user, db_session
):
    dept = _share_department(db_session, doctor_a_user, doctor_b_user)
    patient = _patient(db_session, "R1")
    reception = login_client(reception_user)
    checked = _book_and_check_in(reception, patient, doctor_a_user, dept)

    response = reception.post(
        f"/api/appointments/{checked['id']}/reassign",
        json={
            "version_id": checked["version_id"],
            "new_doctor_id": doctor_b_user.doctor_id,
            "reason": "Eye complaint, sent to Dr. Bharati",
        },
    )

    assert response.status_code == 201, response.text
    successor = response.json()
    assert successor["doctor_id"] == doctor_b_user.doctor_id
    assert successor["visit_id"] == checked["visit_id"]
    assert successor["consultation_status"] == "WAITING"
    assert successor["token_number"] == 1  # token from Dr. B's own sequence

    old = db_session.get(Appointment, checked["id"])
    assert old.status == "CANCELLED"
    assert old.consultation_status == "CANCELLED"
    assert old.cancellation_reason == "Eye complaint, sent to Dr. Bharati"
    assert old.token_number == checked["token_number"]  # history kept, token not reused

    visit = db_session.get(Visit, checked["visit_id"])
    assert visit.status == "OPEN"
    assert visit.referral_source == "SELF"

    audit = db_session.scalars(
        select(AuditLog).where(
            AuditLog.action == AuditAction.APPOINTMENT_REASSIGNED.value,
            AuditLog.entity_id == str(checked["id"]),
        )
    ).all()
    assert len(audit) == 1


def test_reassign_carries_emergency_and_alerts_new_doctor(
    clock, login_client, reception_user, doctor_a_user, doctor_b_user, db_session
):
    dept = _share_department(db_session, doctor_a_user, doctor_b_user)
    patient = _patient(db_session, "R2")
    reception = login_client(reception_user)
    checked = _book_and_check_in(
        reception, patient, doctor_a_user, dept, priority="EMERGENCY", reason="Severe pain"
    )

    response = reception.post(
        f"/api/appointments/{checked['id']}/reassign",
        json={
            "version_id": checked["version_id"],
            "new_doctor_id": doctor_b_user.doctor_id,
            "reason": "Specialist needed",
        },
    )

    assert response.status_code == 201, response.text
    successor = response.json()
    assert successor["priority_level"] == "EMERGENCY"
    assert successor["emergency_alerted_at"] is not None
    assert successor["alert_acknowledged_at"] is None


def test_reassign_refused_for_non_waiting_same_doctor_and_missing_reason(
    clock, login_client, reception_user, doctor_a_user, doctor_b_user, db_session
):
    dept = _share_department(db_session, doctor_a_user, doctor_b_user)
    patient = _patient(db_session, "R3")
    reception = login_client(reception_user)
    checked = _book_and_check_in(reception, patient, doctor_a_user, dept)
    url = f"/api/appointments/{checked['id']}/reassign"

    same = reception.post(
        url,
        json={
            "version_id": checked["version_id"],
            "new_doctor_id": doctor_a_user.doctor_id,
            "reason": "Same doctor",
        },
    )
    assert same.status_code == 422
    assert same.json()["code"] == "reassign_same_doctor"

    no_reason = reception.post(
        url,
        json={
            "version_id": checked["version_id"],
            "new_doctor_id": doctor_b_user.doctor_id,
            "reason": "  ",
        },
    )
    assert no_reason.status_code == 422

    # Refused reassignments change nothing: the patient is still waiting with Dr. A, and no
    # second consultation was created.
    still = db_session.get(Appointment, checked["id"])
    assert still.status == "ARRIVED"
    assert still.consultation_status == "WAITING"
    assert len(db_session.scalars(select(Appointment).where(Appointment.patient_id == patient.id)).all()) == 1


# ------------------------------------------------------------------ cross-department reassignment
# Owner decision Q19 (2026-11-15): any consulting doctor may receive the patient. The current
# department is kept when the new doctor belongs to it; otherwise reception picks one of the new
# doctor's departments.


def _move_doctor_to_own_department(db_session, doctor_user, name: str) -> Department:
    """Give the doctor a department of their own, so it differs from the patient's."""
    dept = Department(name_en=name, is_active=True)
    db_session.add(dept)
    db_session.flush()
    doctor_user.doctor.departments = [dept]
    db_session.flush()
    return dept


def test_reassign_to_other_department_needs_a_department_choice(
    clock, login_client, reception_user, doctor_a_user, doctor_b_user, db_session
):
    physio = doctor_a_user.doctor.departments[0]
    _move_doctor_to_own_department(db_session, doctor_b_user, "Ophthalmology W2")
    patient = _patient(db_session, "X1")
    reception = login_client(reception_user)
    checked = _book_and_check_in(reception, patient, doctor_a_user, physio)

    response = reception.post(
        f"/api/appointments/{checked['id']}/reassign",
        json={
            "version_id": checked["version_id"],
            "new_doctor_id": doctor_b_user.doctor_id,
            "reason": "Eye complaint",
        },
    )

    assert response.status_code == 422, response.text
    assert response.json()["code"] == "department_required"
    still = db_session.get(Appointment, checked["id"])
    assert still.consultation_status == "WAITING"


def test_reassign_to_other_department_with_chosen_department(
    clock, login_client, reception_user, doctor_a_user, doctor_b_user, db_session
):
    physio = doctor_a_user.doctor.departments[0]
    eye = _move_doctor_to_own_department(db_session, doctor_b_user, "Ophthalmology W2b")
    patient = _patient(db_session, "X2")
    reception = login_client(reception_user)
    checked = _book_and_check_in(reception, patient, doctor_a_user, physio)

    response = reception.post(
        f"/api/appointments/{checked['id']}/reassign",
        json={
            "version_id": checked["version_id"],
            "new_doctor_id": doctor_b_user.doctor_id,
            "new_department_id": eye.id,
            "reason": "Eye complaint",
        },
    )

    assert response.status_code == 201, response.text
    successor = response.json()
    assert successor["doctor_id"] == doctor_b_user.doctor_id
    assert successor["department_id"] == eye.id
    assert successor["visit_id"] == checked["visit_id"]
    audit = db_session.scalars(
        select(AuditLog).where(
            AuditLog.action == AuditAction.APPOINTMENT_REASSIGNED.value,
            AuditLog.entity_id == str(checked["id"]),
        )
    ).one()
    assert audit.after_data["to_department_id"] == eye.id


def test_reassign_refuses_a_department_the_new_doctor_is_not_in(
    clock, login_client, reception_user, doctor_a_user, doctor_b_user, db_session
):
    physio = doctor_a_user.doctor.departments[0]
    _move_doctor_to_own_department(db_session, doctor_b_user, "Ophthalmology W2c")
    patient = _patient(db_session, "X3")
    reception = login_client(reception_user)
    checked = _book_and_check_in(reception, patient, doctor_a_user, physio)

    response = reception.post(
        f"/api/appointments/{checked['id']}/reassign",
        json={
            "version_id": checked["version_id"],
            "new_doctor_id": doctor_b_user.doctor_id,
            "new_department_id": physio.id,
            "reason": "Wrong department picked",
        },
    )

    assert response.status_code == 422, response.text
    assert response.json()["code"] == "doctor_department_mismatch"


# ------------------------------------------------------------------ suggested queue order


def test_doctor_queue_suggests_emergency_then_priority_then_normal(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    dept = doctor_a_user.doctor.departments[0]
    reception = login_client(reception_user)
    normal = _book_and_check_in(reception, _patient(db_session, "Q1"), doctor_a_user, dept)
    priority = _book_and_check_in(
        reception,
        _patient(db_session, "Q2"),
        doctor_a_user,
        dept,
        priority="PRIORITY",
        reason="Elderly",
    )
    emergency = _book_and_check_in(
        reception,
        _patient(db_session, "Q3"),
        doctor_a_user,
        dept,
        priority="EMERGENCY",
        reason="Breathless",
    )

    queue = login_client(doctor_a_user).get("/api/appointments/queue/today").json()
    waiting_ids = [item["id"] for item in queue["waiting"]]

    assert waiting_ids == [emergency["id"], priority["id"], normal["id"]]
    # Tokens never change with classification (OD-22-07).
    assert [normal["token_number"], priority["token_number"], emergency["token_number"]] == [1, 2, 3]
