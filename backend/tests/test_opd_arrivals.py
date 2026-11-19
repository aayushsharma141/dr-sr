"""Persisted pending OPD arrivals and atomic promotion into permanent patient records."""

from sqlalchemy import func, select

from kalyan_api import clock as app_clock
from kalyan_api.models import Appointment, AuditLog, Patient, PendingOpdArrival


def _draft_payload(doctor_user, **overrides):
    body = {
        "full_name": "Nisha Kumari",
        "age_years": 32,
        "mobile": "9876500142",
        "doctor_id": doctor_user.doctor_id,
        "department_id": doctor_user.doctor.departments[0].id,
        "priority_level": "PRIORITY",
        "priority_reason": "Needs preferential attention",
    }
    body.update(overrides)
    return body


def _patient_payload(**overrides):
    body = {
        "full_name": "Nisha Kumari",
        "guardian_name": "Suresh Kumar",
        "gender": "F",
        "age_years": 32,
        "mobile": "9876500142",
        "address": "Station Road, Ara",
        "district": "Bhojpur",
        "state": "Bihar",
        "allergies": "None reported",
    }
    body.update(overrides)
    return body


def test_pending_arrival_reserves_doctor_token_without_creating_patient(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    client = login_client(reception_user)
    response = client.post("/api/opd-arrivals", json=_draft_payload(doctor_a_user))

    assert response.status_code == 201, response.text
    data = response.json()
    assert data["status"] == "TO_ARRIVE"
    assert data["token_number"] >= 1
    assert data["priority_level"] == "PRIORITY"
    assert data["priority_reason"] == "Needs preferential attention"
    assert data["appointment_date"] == app_clock.ist_today().isoformat()
    assert data["mobile"] == "9876500142"

    persisted = db_session.get(PendingOpdArrival, data["id"])
    assert persisted is not None
    assert persisted.created_by_user_id == reception_user.id
    assert persisted.patient_id is None
    assert persisted.appointment_id is None
    reloaded = client.get(f"/api/opd-arrivals?arrival_date={data['appointment_date']}")
    assert reloaded.status_code == 200, reloaded.text
    assert any(item["id"] == data["id"] for item in reloaded.json()["arrivals"])
    assert (
        db_session.scalar(
            select(func.count()).select_from(Patient).where(Patient.full_name == "Nisha Kumari")
        )
        == 0
    )


def test_duplicate_pending_arrival_for_same_mobile_and_doctor_is_refused(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    client = login_client(reception_user)
    first = client.post("/api/opd-arrivals", json=_draft_payload(doctor_a_user))
    assert first.status_code == 201, first.text

    duplicate = client.post("/api/opd-arrivals", json=_draft_payload(doctor_a_user))

    assert duplicate.status_code == 409
    assert duplicate.json()["code"] == "duplicate_opd_arrival"
    assert duplicate.json()["details"]["existing_token_number"] == first.json()["token_number"]
    assert (
        db_session.scalar(
            select(func.count())
            .select_from(PendingOpdArrival)
            .where(
                PendingOpdArrival.mobile == "9876500142",
                PendingOpdArrival.doctor_id == doctor_a_user.doctor_id,
                PendingOpdArrival.appointment_date == app_clock.ist_today(),
                PendingOpdArrival.status == "TO_ARRIVE",
            )
        )
        == 1
    )


def test_pending_arrival_priority_change_requires_reason_and_audits_staff(
    login_client, reception_user, doctor_a_user, db_session
):
    client = login_client(reception_user)
    created = client.post(
        "/api/opd-arrivals",
        json=_draft_payload(doctor_a_user, priority_level="NORMAL", priority_reason=None),
    )
    assert created.status_code == 201, created.text
    draft = created.json()

    response = client.patch(
        f"/api/opd-arrivals/{draft['id']}/priority",
        json={
            "version_id": draft["version_id"],
            "priority_level": "EMERGENCY",
            "reason": "Severe acute pain",
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["priority_level"] == "EMERGENCY"
    assert response.json()["priority_reason"] == "Severe acute pain"
    assert response.json()["version_id"] == draft["version_id"] + 1
    event = db_session.scalar(
        select(AuditLog).where(
            AuditLog.action == "OPD_ARRIVAL_PRIORITY_CHANGED",
            AuditLog.entity_id == str(draft["id"]),
        )
    )
    assert event is not None
    assert event.actor_user_id == reception_user.id
    assert event.reason == "Severe acute pain"

    missing_reason = client.patch(
        f"/api/opd-arrivals/{draft['id']}/priority",
        json={
            "version_id": response.json()["version_id"],
            "priority_level": "NORMAL",
            "reason": " ",
        },
    )
    assert missing_reason.status_code == 422


def test_registration_promotes_pending_arrival_with_same_token_and_priority(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    client = login_client(reception_user)
    created = client.post("/api/opd-arrivals", json=_draft_payload(doctor_a_user))
    assert created.status_code == 201, created.text
    draft = created.json()

    response = client.post(
        f"/api/opd-arrivals/{draft['id']}/register",
        json={"version_id": draft["version_id"], "patient": _patient_payload()},
    )

    assert response.status_code == 201, response.text
    appointment_data = response.json()
    assert appointment_data["status"] == "REGISTERED"
    assert appointment_data["patient_urn"].startswith("KH-")
    assert appointment_data["token_number"] == draft["token_number"]
    assert appointment_data["priority_level"] == "PRIORITY"
    assert appointment_data["priority_reason"] == "Needs preferential attention"
    assert appointment_data["patient_age"] == 32
    assert appointment_data["department_name"] == doctor_a_user.doctor.departments[0].name_en

    persisted_draft = db_session.get(PendingOpdArrival, draft["id"])
    appointment = db_session.get(Appointment, appointment_data["id"])
    patient = db_session.get(Patient, appointment_data["patient_id"])
    assert persisted_draft.status == "REGISTERED"
    assert persisted_draft.patient_id == patient.id
    assert persisted_draft.appointment_id == appointment.id
    assert appointment.token_number == persisted_draft.token_number
    assert appointment.status == "REGISTERED"
    assert appointment.patient_id == patient.id
    assert (
        db_session.scalar(
            select(func.count())
            .select_from(AuditLog)
            .where(
                AuditLog.action == "OPD_ARRIVAL_CREATED",
                AuditLog.entity_id == str(draft["id"]),
            )
        )
        == 1
    )

    retry = client.post(
        f"/api/opd-arrivals/{draft['id']}/register",
        json={"version_id": draft["version_id"], "patient": _patient_payload()},
    )
    assert retry.status_code == 201, retry.text
    assert retry.json()["id"] == appointment.id
    assert retry.json()["patient_id"] == patient.id
    linked_draft = client.get(f"/api/opd-arrivals/{draft['id']}")
    assert linked_draft.status_code == 200
    assert linked_draft.json()["appointment_id"] == appointment.id
    assert linked_draft.json()["patient_id"] == patient.id
    assert (
        db_session.scalar(
            select(func.count())
            .select_from(AuditLog)
            .where(
                AuditLog.action == "PATIENT_REGISTERED",
                AuditLog.entity_id == str(patient.id),
            )
        )
        == 1
    )


def test_registration_mismatch_saves_neither_patient_nor_appointment(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    client = login_client(reception_user)
    created = client.post("/api/opd-arrivals", json=_draft_payload(doctor_a_user))
    assert created.status_code == 201, created.text
    draft = created.json()

    response = client.post(
        f"/api/opd-arrivals/{draft['id']}/register",
        json={
            "version_id": draft["version_id"],
            "patient": _patient_payload(full_name="Different Name"),
        },
    )

    assert response.status_code == 422
    assert (
        db_session.scalar(
            select(func.count()).select_from(Patient).where(Patient.full_name == "Nisha Kumari")
        )
        == 0
    )
    assert (
        db_session.scalar(
            select(func.count())
            .select_from(Appointment)
            .where(
                Appointment.doctor_id == doctor_a_user.doctor_id,
                Appointment.appointment_date == app_clock.ist_today(),
                Appointment.token_number == draft["token_number"],
            )
        )
        == 0
    )
    persisted = db_session.get(PendingOpdArrival, draft["id"])
    assert persisted.status == "TO_ARRIVE"
    assert persisted.patient_id is None
    assert persisted.appointment_id is None


def test_arrival_requires_priority_reason_and_existing_permissions(
    login_client, reception_user, doctor_a_user
):
    reception = login_client(reception_user)
    no_reason = reception.post(
        "/api/opd-arrivals",
        json=_draft_payload(doctor_a_user, priority_level="EMERGENCY", priority_reason=" "),
    )
    assert no_reason.status_code == 422

    doctor = login_client(doctor_a_user)
    denied = doctor.post(
        "/api/opd-arrivals",
        json=_draft_payload(doctor_a_user, priority_level="NORMAL", priority_reason=None),
    )
    assert denied.status_code == 403


def test_cancel_arrival_cancels_with_reason_and_audit(
    login_client, reception_user, doctor_a_user, db_session
):
    reception = login_client(reception_user)
    created = reception.post("/api/opd-arrivals", json=_draft_payload(doctor_a_user))
    assert created.status_code == 201
    draft = created.json()

    # Cancel requires at least 3 character reason
    bad_reason = reception.post(
        f"/api/opd-arrivals/{draft['id']}/cancel",
        json={"version_id": draft["version_id"], "reason": "ab"},
    )
    assert bad_reason.status_code == 422

    # Valid cancel
    resp = reception.post(
        f"/api/opd-arrivals/{draft['id']}/cancel",
        json={"version_id": draft["version_id"], "reason": "Patient decided to leave"},
    )
    assert resp.status_code == 200, resp.text
    cancelled = resp.json()
    assert cancelled["status"] == "CANCELLED"
    assert cancelled["cancellation_reason"] == "Patient decided to leave"
    assert cancelled["priority_reason"] == "Needs preferential attention"

    # Listed in arrivals as CANCELLED with cancellation_reason exposed and priority_reason preserved
    today = app_clock.ist_today().isoformat()
    listed = reception.get(f"/api/opd-arrivals?arrival_date={today}")
    assert listed.status_code == 200
    assert any(
        a["id"] == draft["id"]
        and a["status"] == "CANCELLED"
        and a["cancellation_reason"] == "Patient decided to leave"
        and a["priority_reason"] == "Needs preferential attention"
        for a in listed.json()["arrivals"]
    )


def test_list_opd_arrivals_supports_doctor_filter_and_pagination(
    clock, login_client, reception_user, doctor_a_user, doctor_b_user
):
    reception = login_client(reception_user)
    a1 = reception.post(
        "/api/opd-arrivals",
        json=_draft_payload(doctor_a_user, full_name="Asha Devi", mobile="9876501001"),
    )
    a2 = reception.post(
        "/api/opd-arrivals",
        json=_draft_payload(doctor_a_user, full_name="Bina Kumari", mobile="9876501002"),
    )
    b1 = reception.post(
        "/api/opd-arrivals",
        json=_draft_payload(doctor_b_user, full_name="Chitra Devi", mobile="9876501003"),
    )
    assert a1.status_code == 201 and a2.status_code == 201 and b1.status_code == 201

    today = app_clock.ist_today().isoformat()
    filtered = reception.get(
        f"/api/opd-arrivals?arrival_date={today}&doctor_id={doctor_a_user.doctor_id}&limit=1&offset=1"
    )
    assert filtered.status_code == 200, filtered.text
    body = filtered.json()
    assert body["total"] == 2
    assert body["limit"] == 1
    assert body["offset"] == 1
    assert len(body["arrivals"]) == 1
    assert body["arrivals"][0]["id"] == a2.json()["id"]
    assert body["arrivals"][0]["doctor_id"] == doctor_a_user.doctor_id


def test_create_opd_arrival_idempotency_replay_and_mismatch(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    reception = login_client(reception_user)
    payload = _draft_payload(doctor_a_user, full_name="Meera Singh", mobile="9876502001")
    idem_key = "opd-arrival-idem-key-0001"

    first = reception.post(
        "/api/opd-arrivals",
        json=payload,
        headers={"Idempotency-Key": idem_key},
    )
    assert first.status_code == 201, first.text

    replay = reception.post(
        "/api/opd-arrivals",
        json=payload,
        headers={"Idempotency-Key": idem_key},
    )
    assert replay.status_code == 201, replay.text
    assert replay.json() == first.json()
    assert (
        db_session.scalar(
            select(func.count())
            .select_from(PendingOpdArrival)
            .where(PendingOpdArrival.mobile == "9876502001")
        )
        == 1
    )

    mismatch = reception.post(
        "/api/opd-arrivals",
        json={**payload, "full_name": "Different Patient"},
        headers={"Idempotency-Key": idem_key},
    )
    assert mismatch.status_code == 422
    assert mismatch.json()["code"] == "idempotency_key_payload_mismatch"

    bad_key = reception.post(
        "/api/opd-arrivals",
        json=_draft_payload(doctor_a_user, full_name="Other Patient", mobile="9876502002"),
        headers={"Idempotency-Key": "short"},
    )
    assert bad_key.status_code == 422
    assert bad_key.json()["code"] == "invalid_idempotency_key"


def test_doctor_opd_arrivals_scoped_and_mutations_reception_only(
    clock, login_client, reception_user, doctor_a_user, doctor_b_user
):
    reception = login_client(reception_user)
    a_resp = reception.post(
        "/api/opd-arrivals",
        json=_draft_payload(doctor_a_user, full_name="Doc A Arrival", mobile="9876503001"),
    )
    b_resp = reception.post(
        "/api/opd-arrivals",
        json=_draft_payload(doctor_b_user, full_name="Doc B Arrival", mobile="9876503002"),
    )
    assert a_resp.status_code == 201 and b_resp.status_code == 201
    a_draft = a_resp.json()
    b_draft = b_resp.json()

    today = app_clock.ist_today().isoformat()
    doc_a = login_client(doctor_a_user)
    doc_b = login_client(doctor_b_user)

    # Doctor list is strictly scoped to own arrivals
    own_list = doc_a.get(f"/api/opd-arrivals?arrival_date={today}")
    assert own_list.status_code == 200, own_list.text
    listed_ids = [item["id"] for item in own_list.json()["arrivals"]]
    assert a_draft["id"] in listed_ids
    assert b_draft["id"] not in listed_ids

    # Doctor requesting another doctor's arrivals via query param is forbidden
    cross_filter = doc_a.get(
        f"/api/opd-arrivals?arrival_date={today}&doctor_id={doctor_b_user.doctor_id}"
    )
    assert cross_filter.status_code == 403
    assert cross_filter.json()["code"] == "scope_forbidden"

    # Detail read: own arrival succeeds, another doctor's arrival is 403 scope_forbidden
    assert doc_a.get(f"/api/opd-arrivals/{a_draft['id']}").status_code == 200
    cross_read = doc_b.get(f"/api/opd-arrivals/{a_draft['id']}")
    assert cross_read.status_code == 403
    assert cross_read.json()["code"] == "scope_forbidden"

    # Priority & cancel mutations are strictly Reception-only (403 for any doctor)
    for client_actor in (doc_a, doc_b):
        prio = client_actor.patch(
            f"/api/opd-arrivals/{a_draft['id']}/priority",
            json={
                "version_id": a_draft["version_id"],
                "priority_level": "EMERGENCY",
                "reason": "Doctor attempt to reprioritize",
            },
        )
        assert prio.status_code == 403

        cancel = client_actor.post(
            f"/api/opd-arrivals/{a_draft['id']}/cancel",
            json={
                "version_id": a_draft["version_id"],
                "reason": "Doctor attempt to cancel",
            },
        )
        assert cancel.status_code == 403
