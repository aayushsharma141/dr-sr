"""PostgreSQL-backed integration tests for Appointments & OPD Check-In Hardening (T15).

Covers Wave 1-3 backend guarantees:
1. Idempotency (`Idempotency-Key`) across all 5 mutation endpoints (replay, mismatch 422,
   invalid key 422, rolled-back failure retry, actor/endpoint isolation, 24h TTL expiry,
   and concurrent PostgreSQL advisory-lock serialization).
2. Token integrity & concurrency (`PendingOpdArrival` high-water mark, permanently burned
   cancelled tokens, independent per-doctor sequences, `WAITING` reassignment, charge voiding,
   and duplicate prevention on target doctor).
3. Lifecycle policies, `check-in` `patient_id` verification, `walk-in/new-patient` (`to_arrive`)
   doctor/department guards, `PATCH /{id}/status` `COMPLETED` support, and audit completeness.
4. `ClinicSettings.token_reset_policy` (`DAILY` enforcement + audit) and `GET /reception/overview`
   (`pending_arrivals` + real assigned active `Department.name_en`).
5. `GET /appointments` `bucket_counts`, `status_bucket` filtering, deterministic `sort_by`,
   pagination, and `search` across patient fields and token formats (`5`, `#5`, `A-5`, `A-05`).
"""

import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import date, time, timedelta

import pytest
from sqlalchemy import Engine, create_engine, func, select, text
from sqlalchemy.orm import Session

from kalyan_api.config import Settings
from kalyan_api.models import (
    AllergySeverity,
    AllergyStatus,
    Appointment,
    AppointmentStatus,
    AuditLog,
    BillItem,
    BillItemStatus,
    ConsultationStatus,
    DailyTokenSequence,
    Department,
    Doctor,
    IdempotencyKey,
    LedgerDirection,
    LedgerEntry,
    LedgerEntryType,
    LedgerReferenceType,
    Patient,
    PatientAllergy,
    PendingOpdArrival,
    User,
)
from kalyan_api.services import idempotency_service, token_service
from tests.conftest import make_user

TODAY = date(2026, 11, 2)
TOMORROW = TODAY + timedelta(days=1)
YESTERDAY = TODAY - timedelta(days=1)


def _make_patient(
    db_session: Session,
    suffix: str,
    *,
    full_name: str | None = None,
    mobile: str | None = None,
) -> Patient:
    patient = Patient(
        urn=f"KH-2026-H{suffix}",
        full_name=full_name or f"Hardening Patient {suffix}",
        guardian_name="Guardian",
        gender="M",
        age_years=34,
        mobile=mobile or f"987654{suffix.zfill(4)[-4:]}",
        address="Station Road, Ara",
    )
    db_session.add(patient)
    db_session.flush()
    return patient


def _new_patient_payload(suffix: str, *, mobile: str | None = None) -> dict:
    return {
        "full_name": f"Walkin New {suffix}",
        "guardian_name": "Ramesh Kumar",
        "gender": "F",
        "age_years": 29,
        "mobile": mobile or f"987651{suffix.zfill(4)[-4:]}",
        "address": "Civil Lines, Ara",
        "district": "Bhojpur",
        "state": "Bihar",
    }


def _opd_arrival_payload(doctor_user: User, **overrides) -> dict:
    body = {
        "full_name": "Kiran Devi",
        "age_years": 31,
        "mobile": "9876520001",
        "doctor_id": doctor_user.doctor_id,
        "department_id": doctor_user.doctor.departments[0].id,
        "priority_level": "NORMAL",
        "priority_reason": None,
    }
    body.update(overrides)
    return body


def _audit_rows(db_session: Session, entity_type: str, entity_id: int | str) -> list[AuditLog]:
    return list(
        db_session.scalars(
            select(AuditLog)
            .where(
                AuditLog.entity_type == entity_type,
                AuditLog.entity_id == str(entity_id),
            )
            .order_by(AuditLog.id.asc())
        )
    )


# ----------------------------------------------------------------- 1. Idempotency


def test_idempotency_replay_and_mismatch_post_appointments(
    clock, login_client, reception_user, doctor_a_user, db_session
) -> None:
    """POST /appointments replays identical 201 body with 1 DB row and rejects payload mismatch."""
    patient = _make_patient(db_session, "0001")
    client = login_client(reception_user)
    dept_id = doctor_a_user.doctor.departments[0].id
    key = "idem-book-appt-0001"
    payload = {
        "patient_id": patient.id,
        "doctor_id": doctor_a_user.doctor_id,
        "department_id": dept_id,
        "appointment_date": TOMORROW.isoformat(),
        "source": "PHONE",
        "expected_time": "10:30:00",
        "notes": "Initial phone booking",
    }

    first = client.post("/api/appointments", json=payload, headers={"Idempotency-Key": key})
    assert first.status_code == 201, first.text

    replay = client.post("/api/appointments", json=payload, headers={"Idempotency-Key": key})
    assert replay.status_code == 201, replay.text
    assert replay.json() == first.json()

    appt_count = db_session.scalar(
        select(func.count())
        .select_from(Appointment)
        .where(Appointment.patient_id == patient.id, Appointment.appointment_date == TOMORROW)
    )
    assert appt_count == 1

    mismatch = client.post(
        "/api/appointments",
        json={**payload, "notes": "Tampered notes"},
        headers={"Idempotency-Key": key},
    )
    assert mismatch.status_code == 422
    assert mismatch.json()["code"] == "idempotency_key_payload_mismatch"


def test_idempotency_replay_walk_in_with_override_reason_and_single_bill_item(
    clock, login_client, reception_user, doctor_a_user, db_session
) -> None:
    """POST /appointments/walk-in with override_reason replays exact 201 with 1 token & 1 bill."""
    doctor_a_user.doctor.default_fee_paise = 50000
    db_session.flush()
    patient = _make_patient(db_session, "0002")
    client = login_client(reception_user)
    dept_id = doctor_a_user.doctor.departments[0].id

    # Pre-existing active booking today forces override_reason on walk-in.
    prior = client.post(
        "/api/appointments",
        json={
            "patient_id": patient.id,
            "doctor_id": doctor_a_user.doctor_id,
            "department_id": dept_id,
            "appointment_date": TODAY.isoformat(),
        },
    )
    assert prior.status_code == 201, prior.text

    key = "idem-walkin-override-0002"
    walkin_payload = {
        "patient_id": patient.id,
        "doctor_id": doctor_a_user.doctor_id,
        "department_id": dept_id,
        "referral_source": "SELF",
        "override_reason": "Second urgent review requested today",
        "notes": "Override walk-in",
    }

    first = client.post(
        "/api/appointments/walk-in", json=walkin_payload, headers={"Idempotency-Key": key}
    )
    assert first.status_code == 201, first.text
    first_body = first.json()
    assert first_body["token_number"] == 1

    replay = client.post(
        "/api/appointments/walk-in", json=walkin_payload, headers={"Idempotency-Key": key}
    )
    assert replay.status_code == 201, replay.text
    assert replay.json() == first_body

    # Exactly 1 walk-in created (2 total with the pre-existing booking) and 1 bill line.
    total_appts = db_session.scalar(
        select(func.count())
        .select_from(Appointment)
        .where(Appointment.patient_id == patient.id, Appointment.appointment_date == TODAY)
    )
    assert total_appts == 2
    bill_count = db_session.scalar(
        select(func.count())
        .select_from(BillItem)
        .where(BillItem.appointment_id == first_body["id"])
    )
    assert bill_count == 1
    seq = db_session.scalar(
        select(DailyTokenSequence).where(
            DailyTokenSequence.doctor_id == doctor_a_user.doctor_id,
            DailyTokenSequence.appointment_date == TODAY,
        )
    )
    assert seq is not None and seq.last_token == 1

    mismatch = client.post(
        "/api/appointments/walk-in",
        json={**walkin_payload, "override_reason": "Different override text"},
        headers={"Idempotency-Key": key},
    )
    assert mismatch.status_code == 422
    assert mismatch.json()["code"] == "idempotency_key_payload_mismatch"


def test_idempotency_replay_walk_in_new_patient_both_modes(
    clock, login_client, reception_user, doctor_a_user, db_session
) -> None:
    """POST /appointments/walk-in/new-patient replays 201 with 1 patient/appt/bill in both modes."""
    doctor_a_user.doctor.default_fee_paise = 45000
    db_session.flush()
    client = login_client(reception_user)
    dept_id = doctor_a_user.doctor.departments[0].id

    # Mode 1: standard immediate check-in (to_arrive=False)
    key_checkin = "idem-new-patient-checkin-01"
    payload_checkin = {
        "patient": _new_patient_payload("0003", mobile="9876510003"),
        "doctor_id": doctor_a_user.doctor_id,
        "department_id": dept_id,
        "referral_source": "SELF",
        "to_arrive": False,
    }
    first = client.post(
        "/api/appointments/walk-in/new-patient",
        json=payload_checkin,
        headers={"Idempotency-Key": key_checkin},
    )
    assert first.status_code == 201, first.text
    replay = client.post(
        "/api/appointments/walk-in/new-patient",
        json=payload_checkin,
        headers={"Idempotency-Key": key_checkin},
    )
    assert replay.status_code == 201, replay.text
    assert replay.json() == first.json()
    assert (
        db_session.scalar(
            select(func.count()).select_from(Patient).where(Patient.mobile == "9876510003")
        )
        == 1
    )
    assert (
        db_session.scalar(
            select(func.count())
            .select_from(BillItem)
            .where(BillItem.appointment_id == first.json()["id"])
        )
        == 1
    )

    mismatch = client.post(
        "/api/appointments/walk-in/new-patient",
        json={**payload_checkin, "notes": "Changed note"},
        headers={"Idempotency-Key": key_checkin},
    )
    assert mismatch.status_code == 422
    assert mismatch.json()["code"] == "idempotency_key_payload_mismatch"

    # Mode 2: to_arrive=True branch
    key_to_arrive = "idem-new-patient-to-arrive-02"
    payload_to_arrive = {
        "patient": _new_patient_payload("0004", mobile="9876510004"),
        "doctor_id": doctor_a_user.doctor_id,
        "department_id": dept_id,
        "referral_source": "SELF",
        "to_arrive": True,
    }
    first_ta = client.post(
        "/api/appointments/walk-in/new-patient",
        json=payload_to_arrive,
        headers={"Idempotency-Key": key_to_arrive},
    )
    assert first_ta.status_code == 201, first_ta.text
    assert first_ta.json()["status"] == "TO_ARRIVE"

    replay_ta = client.post(
        "/api/appointments/walk-in/new-patient",
        json=payload_to_arrive,
        headers={"Idempotency-Key": key_to_arrive},
    )
    assert replay_ta.status_code == 201, replay_ta.text
    assert replay_ta.json() == first_ta.json()
    assert (
        db_session.scalar(
            select(func.count()).select_from(Patient).where(Patient.mobile == "9876510004")
        )
        == 1
    )


def test_idempotency_replay_check_in_past_version_bump(
    clock, login_client, reception_user, doctor_a_user, db_session
) -> None:
    """POST /appointments/{id}/check-in replays exact 200 even after version_id incremented."""
    doctor_a_user.doctor.default_fee_paise = 40000
    db_session.flush()
    patient = _make_patient(db_session, "0005")
    client = login_client(reception_user)
    dept_id = doctor_a_user.doctor.departments[0].id

    booking = client.post(
        "/api/appointments",
        json={
            "patient_id": patient.id,
            "doctor_id": doctor_a_user.doctor_id,
            "department_id": dept_id,
            "appointment_date": TODAY.isoformat(),
        },
    ).json()
    assert booking["version_id"] == 1

    key = "idem-checkin-version-bump-01"
    checkin_payload = {
        "version_id": 1,
        "patient_id": patient.id,
        "referral_source": "SELF",
    }

    first = client.post(
        f"/api/appointments/{booking['id']}/check-in",
        json=checkin_payload,
        headers={"Idempotency-Key": key},
    )
    assert first.status_code == 200, first.text
    assert first.json()["version_id"] == 2

    # Replay with original version_id=1 must still replay 200 instead of 409 version_conflict.
    replay = client.post(
        f"/api/appointments/{booking['id']}/check-in",
        json=checkin_payload,
        headers={"Idempotency-Key": key},
    )
    assert replay.status_code == 200, replay.text
    assert replay.json() == first.json()

    bill_count = db_session.scalar(
        select(func.count()).select_from(BillItem).where(BillItem.appointment_id == booking["id"])
    )
    assert bill_count == 1
    refreshed = db_session.get(Appointment, booking["id"])
    assert refreshed is not None and refreshed.version_id == 2

    mismatch = client.post(
        f"/api/appointments/{booking['id']}/check-in",
        json={**checkin_payload, "referral_source": "DOCTOR", "referrer_name": "Dr. Mehta"},
        headers={"Idempotency-Key": key},
    )
    assert mismatch.status_code == 422
    assert mismatch.json()["code"] == "idempotency_key_payload_mismatch"


def test_idempotency_replay_opd_arrivals(
    clock, login_client, reception_user, doctor_a_user, db_session
) -> None:
    """POST /opd-arrivals replays identical 201 with 1 PendingOpdArrival row & rejects mismatch."""
    client = login_client(reception_user)
    key = "idem-opd-arrival-0006"
    payload = _opd_arrival_payload(doctor_a_user, mobile="9876520006")

    first = client.post("/api/opd-arrivals", json=payload, headers={"Idempotency-Key": key})
    assert first.status_code == 201, first.text

    replay = client.post("/api/opd-arrivals", json=payload, headers={"Idempotency-Key": key})
    assert replay.status_code == 201, replay.text
    assert replay.json() == first.json()
    assert (
        db_session.scalar(
            select(func.count())
            .select_from(PendingOpdArrival)
            .where(PendingOpdArrival.mobile == "9876520006")
        )
        == 1
    )

    mismatch = client.post(
        "/api/opd-arrivals",
        json={**payload, "full_name": "Someone Else"},
        headers={"Idempotency-Key": key},
    )
    assert mismatch.status_code == 422
    assert mismatch.json()["code"] == "idempotency_key_payload_mismatch"


@pytest.mark.parametrize(
    "bad_key",
    [
        "short77",
        "   short   ",
        "k" * 129,
        "idem\tkey12345",
        "        ",
    ],
)
def test_idempotency_invalid_keys_rejected(
    clock, login_client, reception_user, doctor_a_user, db_session, bad_key: str
) -> None:
    """Malformed Idempotency-Key headers (short, oversized, whitespace, control) return 422."""
    patient = _make_patient(db_session, "0007")
    client = login_client(reception_user)
    dept_id = doctor_a_user.doctor.departments[0].id

    resp_appt = client.post(
        "/api/appointments",
        json={
            "patient_id": patient.id,
            "doctor_id": doctor_a_user.doctor_id,
            "department_id": dept_id,
            "appointment_date": TOMORROW.isoformat(),
        },
        headers={"Idempotency-Key": bad_key},
    )
    assert resp_appt.status_code == 422
    assert resp_appt.json()["code"] == "invalid_idempotency_key"

    resp_arrival = client.post(
        "/api/opd-arrivals",
        json=_opd_arrival_payload(doctor_a_user, mobile="9876520007"),
        headers={"Idempotency-Key": bad_key},
    )
    assert resp_arrival.status_code == 422
    assert resp_arrival.json()["code"] == "invalid_idempotency_key"

    assert db_session.scalar(select(func.count()).select_from(IdempotencyKey)) == 0


def test_idempotency_failed_transactions_leave_zero_rows_and_allow_retry(
    clock, login_client, reception_user, doctor_a_user, db_session
) -> None:
    """Failed 404/409 mutations leave zero idempotency_keys rows so same key can succeed later."""
    patient = _make_patient(db_session, "0008")
    client = login_client(reception_user)
    dept_id = doctor_a_user.doctor.departments[0].id

    # 1. Failed 404 (invalid doctor)
    key_404 = "idem-failed-404-retry"
    failed_404 = client.post(
        "/api/appointments",
        json={
            "patient_id": patient.id,
            "doctor_id": 999999,
            "department_id": dept_id,
            "appointment_date": TODAY.isoformat(),
        },
        headers={"Idempotency-Key": key_404},
    )
    assert failed_404.status_code == 404
    assert (
        db_session.scalar(
            select(func.count())
            .select_from(IdempotencyKey)
            .where(IdempotencyKey.idempotency_key == key_404)
        )
        == 0
    )

    retried_ok = client.post(
        "/api/appointments",
        json={
            "patient_id": patient.id,
            "doctor_id": doctor_a_user.doctor_id,
            "department_id": dept_id,
            "appointment_date": TODAY.isoformat(),
        },
        headers={"Idempotency-Key": key_404},
    )
    assert retried_ok.status_code == 201, retried_ok.text

    # 2. Failed 409 (duplicate walk-in without override_reason)
    key_409 = "idem-failed-409-retry"
    failed_409 = client.post(
        "/api/appointments/walk-in",
        json={
            "patient_id": patient.id,
            "doctor_id": doctor_a_user.doctor_id,
            "department_id": dept_id,
            "referral_source": "SELF",
        },
        headers={"Idempotency-Key": key_409},
    )
    assert failed_409.status_code == 409
    assert (
        db_session.scalar(
            select(func.count())
            .select_from(IdempotencyKey)
            .where(IdempotencyKey.idempotency_key == key_409)
        )
        == 0
    )

    retried_walkin = client.post(
        "/api/appointments/walk-in",
        json={
            "patient_id": patient.id,
            "doctor_id": doctor_a_user.doctor_id,
            "department_id": dept_id,
            "referral_source": "SELF",
            "override_reason": "Patient returned for urgent review",
        },
        headers={"Idempotency-Key": key_409},
    )
    assert retried_walkin.status_code == 201, retried_walkin.text


def test_idempotency_actor_and_endpoint_isolation(
    clock, login_client, reception_user, doctor_a_user, db_session, test_settings
) -> None:
    """Different actors or different endpoints using the same Idempotency-Key never collide."""
    reception_user_2 = make_user(db_session, test_settings, "RECEPTION", "fixture_reception_2")
    p1 = _make_patient(db_session, "0009")
    p2 = _make_patient(db_session, "0010")
    p3 = _make_patient(db_session, "0011")
    dept_id = doctor_a_user.doctor.departments[0].id
    shared_key = "idem-shared-scope-key-01"

    c1 = login_client(reception_user)
    c2 = login_client(reception_user_2)

    r1 = c1.post(
        "/api/appointments",
        json={
            "patient_id": p1.id,
            "doctor_id": doctor_a_user.doctor_id,
            "department_id": dept_id,
            "appointment_date": TODAY.isoformat(),
        },
        headers={"Idempotency-Key": shared_key},
    )
    assert r1.status_code == 201, r1.text

    # Different actor, same endpoint, same key, different payload -> succeeds independently.
    r2 = c2.post(
        "/api/appointments",
        json={
            "patient_id": p2.id,
            "doctor_id": doctor_a_user.doctor_id,
            "department_id": dept_id,
            "appointment_date": TODAY.isoformat(),
        },
        headers={"Idempotency-Key": shared_key},
    )
    assert r2.status_code == 201, r2.text
    assert r2.json()["id"] != r1.json()["id"]

    # Same actor (c1), different endpoint (/walk-in), same key -> succeeds independently.
    r3 = c1.post(
        "/api/appointments/walk-in",
        json={
            "patient_id": p3.id,
            "doctor_id": doctor_a_user.doctor_id,
            "department_id": dept_id,
            "referral_source": "SELF",
        },
        headers={"Idempotency-Key": shared_key},
    )
    assert r3.status_code == 201, r3.text
    assert r3.json()["id"] not in {r1.json()["id"], r2.json()["id"]}


def test_idempotency_expired_key_cleaned_up_and_reusable(
    clock, login_client, reception_user, doctor_a_user, db_session
) -> None:
    """Expired (>24h) idempotency keys are purged and accepted as fresh requests."""
    p1 = _make_patient(db_session, "0012")
    p2 = _make_patient(db_session, "0013")
    dept_id = doctor_a_user.doctor.departments[0].id
    client = login_client(reception_user)
    key = "idem-ttl-expiry-key-01"

    first = client.post(
        "/api/appointments",
        json={
            "patient_id": p1.id,
            "doctor_id": doctor_a_user.doctor_id,
            "department_id": dept_id,
            "appointment_date": TOMORROW.isoformat(),
        },
        headers={"Idempotency-Key": key},
    )
    assert first.status_code == 201, first.text

    # Advance clock past the 24h TTL window and re-authenticate (30m idle session expires).
    clock["t"] = clock["t"] + timedelta(hours=25)
    client = login_client(reception_user)

    second = client.post(
        "/api/appointments",
        json={
            "patient_id": p2.id,
            "doctor_id": doctor_a_user.doctor_id,
            "department_id": dept_id,
            "appointment_date": (TOMORROW + timedelta(days=2)).isoformat(),
        },
        headers={"Idempotency-Key": key},
    )
    assert second.status_code == 201, second.text
    assert second.json()["id"] != first.json()["id"]

    rows = list(
        db_session.scalars(select(IdempotencyKey).where(IdempotencyKey.idempotency_key == key))
    )
    assert len(rows) == 1
    assert rows[0].response_body["id"] == second.json()["id"]


@pytest.mark.concurrency
def test_idempotency_concurrent_duplicate_requests_serialize(
    test_settings: Settings, owner_engine: Engine
) -> None:
    """Two simultaneous PostgreSQL transactions with the same key serialize without duplicates."""
    with owner_engine.connect() as conn:
        user_id = conn.execute(
            text(
                "INSERT INTO users (username, full_name, role, password_hash, is_active) "
                "VALUES ('idem_conc_user', 'Idem Conc', 'RECEPTION', 'hash', true) RETURNING id"
            )
        ).scalar_one()
        conn.commit()

    endpoint_key = "POST:/appointments/walk-in"
    idem_key = "idem-concurrent-lock-test-01"
    req_hash = idempotency_service.hash_payload({"patient_id": 42, "doctor_id": 7})
    concurrent_engine = create_engine(test_settings.app_url, pool_size=4, max_overflow=2)
    t1_locked = threading.Event()
    t2_ready = threading.Event()
    executions = {"count": 0}

    try:

        def _worker_1():
            with Session(concurrent_engine) as s:
                replay = idempotency_service.begin_idempotent_request(
                    s,
                    actor_user_id=user_id,
                    endpoint_key=endpoint_key,
                    idempotency_key=idem_key,
                    request_hash=req_hash,
                )
                assert replay is None
                t1_locked.set()
                t2_ready.wait(timeout=5)
                executions["count"] += 1
                idempotency_service.store_idempotent_response(
                    s,
                    actor_user_id=user_id,
                    endpoint_key=endpoint_key,
                    idempotency_key=idem_key,
                    request_hash=req_hash,
                    response_status=201,
                    response_body={"id": 999, "token_number": 1},
                )
                s.commit()
                return ("created", 201, {"id": 999, "token_number": 1})

        def _worker_2():
            t1_locked.wait(timeout=5)
            t2_ready.set()
            with Session(concurrent_engine) as s:
                replay = idempotency_service.begin_idempotent_request(
                    s,
                    actor_user_id=user_id,
                    endpoint_key=endpoint_key,
                    idempotency_key=idem_key,
                    request_hash=req_hash,
                )
                assert replay is not None
                s.commit()
                return ("replayed", replay.status_code, replay.body)

        with ThreadPoolExecutor(max_workers=2) as pool:
            f1 = pool.submit(_worker_1)
            f2 = pool.submit(_worker_2)
            res1 = f1.result(timeout=10)
            res2 = f2.result(timeout=10)

        assert res1 == ("created", 201, {"id": 999, "token_number": 1})
        assert res2 == ("replayed", 201, {"id": 999, "token_number": 1})
        assert executions["count"] == 1

        with owner_engine.connect() as conn:
            row_count = conn.scalar(
                text(
                    "SELECT count(*) FROM idempotency_keys "
                    "WHERE actor_user_id = :uid AND idempotency_key = :k"
                ),
                {"uid": user_id, "k": idem_key},
            )
            assert row_count == 1
    finally:
        concurrent_engine.dispose()
        with owner_engine.connect() as conn:
            conn.execute(
                text("DELETE FROM idempotency_keys WHERE actor_user_id = :uid"),
                {"uid": user_id},
            )
            conn.execute(text("DELETE FROM users WHERE id = :uid"), {"uid": user_id})
            conn.commit()


# ----------------------------------------------------------------- 2. Token Integrity & Transfer


def test_token_high_water_mark_pending_arrival_and_burned_cancelled_tokens(
    clock, login_client, reception_user, doctor_a_user, doctor_b_user, db_session
) -> None:
    """High-water mark respects PendingOpdArrival tokens; cancelled tokens stay burned."""
    dept_a = doctor_a_user.doctor.departments[0].id

    # Seed a lagging DailyTokenSequence (2) alongside an out-of-band PendingOpdArrival (token 7).
    db_session.add(
        DailyTokenSequence(
            doctor_id=doctor_a_user.doctor_id,
            appointment_date=TODAY,
            last_token=2,
        )
    )
    db_session.add(
        PendingOpdArrival(
            full_name="Out of Band Arrival",
            age_years=40,
            mobile="9876530001",
            doctor_id=doctor_a_user.doctor_id,
            department_id=dept_a,
            appointment_date=TODAY,
            token_number=7,
            status="TO_ARRIVE",
            created_by_user_id=reception_user.id,
        )
    )
    db_session.flush()

    next_a = token_service.generate_next_daily_token(db_session, doctor_a_user.doctor_id, TODAY)
    assert next_a == 8

    # Doctor B maintains a completely independent sequence starting at 1.
    next_b = token_service.generate_next_daily_token(db_session, doctor_b_user.doctor_id, TODAY)
    assert next_b == 1

    # Cancelled appointment token stays burned and is never reused.
    client = login_client(reception_user)
    p1 = _make_patient(db_session, "0020")
    p2 = _make_patient(db_session, "0021")

    w1 = client.post(
        "/api/appointments/walk-in",
        json={
            "patient_id": p1.id,
            "doctor_id": doctor_a_user.doctor_id,
            "department_id": dept_a,
            "referral_source": "SELF",
        },
    ).json()
    assert w1["token_number"] == 9

    cancel_resp = client.patch(
        f"/api/appointments/{w1['id']}/status",
        json={
            "status": "CANCELLED",
            "version_id": w1["version_id"],
            "cancellation_reason": "Patient left before turn",
        },
    )
    assert cancel_resp.status_code == 200, cancel_resp.text

    w2 = client.post(
        "/api/appointments/walk-in",
        json={
            "patient_id": p2.id,
            "doctor_id": doctor_a_user.doctor_id,
            "department_id": dept_a,
            "referral_source": "SELF",
        },
    ).json()
    assert w2["token_number"] == 10


def test_reassign_waiting_burns_token_voids_charge_and_blocks_target_duplicate(
    clock, login_client, reception_user, doctor_a_user, doctor_b_user, db_session
) -> None:
    """Reassign works for WAITING, burns source token, voids source charge, blocks duplicate."""
    doctor_a_user.doctor.default_fee_paise = 50000
    doctor_b_user.doctor.default_fee_paise = 60000
    db_session.flush()
    dept_a = doctor_a_user.doctor.departments[0].id
    client = login_client(reception_user)

    p1 = _make_patient(db_session, "0022")
    walkin = client.post(
        "/api/appointments/walk-in",
        json={
            "patient_id": p1.id,
            "doctor_id": doctor_a_user.doctor_id,
            "department_id": dept_a,
            "referral_source": "SELF",
        },
    )
    assert walkin.status_code == 201, walkin.text
    orig = walkin.json()
    assert orig["token_number"] == 1

    # Explicitly put appointment in WAITING status to verify T2 fix allowing WAITING reassignment.
    orig_row = db_session.get(Appointment, orig["id"])
    assert orig_row is not None
    orig_row.status = AppointmentStatus.WAITING.value
    db_session.flush()

    reassign_resp = client.post(
        f"/api/appointments/{orig['id']}/reassign",
        json={
            "version_id": orig_row.version_id,
            "new_doctor_id": doctor_b_user.doctor_id,
            "reason": "Doctor A called to OT",
        },
    )
    assert reassign_resp.status_code == 201, reassign_resp.text
    successor = reassign_resp.json()

    assert successor["id"] != orig["id"]
    assert successor["visit_id"] == orig["visit_id"]
    assert successor["doctor_id"] == doctor_b_user.doctor_id
    assert successor["token_number"] == 1  # Doctor B's own independent sequence
    assert successor["status"] == "ARRIVED"
    assert successor["consultation_status"] == "WAITING"

    # Original appointment stays as CANCELLED history with burned token & reason.
    db_session.expire(orig_row)
    orig_after = db_session.get(Appointment, orig["id"])
    assert orig_after is not None
    assert orig_after.status == AppointmentStatus.CANCELLED.value
    assert orig_after.consultation_status == ConsultationStatus.CANCELLED.value
    assert orig_after.token_number == 1
    assert orig_after.cancellation_reason == "Doctor A called to OT"

    # Original consultation charge is voided in append-only ledger; successor has active charge.
    orig_bill = db_session.scalar(select(BillItem).where(BillItem.appointment_id == orig["id"]))
    succ_bill = db_session.scalar(
        select(BillItem).where(BillItem.appointment_id == successor["id"])
    )
    assert orig_bill is not None and orig_bill.amount_paise == 50000
    assert (
        succ_bill is not None
        and succ_bill.status == BillItemStatus.ACTIVE.value
        and succ_bill.amount_paise == 60000
    )
    void_entry = db_session.scalar(
        select(LedgerEntry).where(
            LedgerEntry.reference_type == LedgerReferenceType.BILL_ITEM.value,
            LedgerEntry.reference_id == orig_bill.id,
            LedgerEntry.entry_type == LedgerEntryType.CHARGE_VOID.value,
        )
    )
    assert void_entry is not None
    assert void_entry.direction == LedgerDirection.CREDIT.value
    assert void_entry.amount_paise == 50000

    # Doctor A's next token is 2 (token 1 permanently burned).
    assert token_service.generate_next_daily_token(db_session, doctor_a_user.doctor_id, TODAY) == 2

    # Audit log captures reassignment details.
    audits = _audit_rows(db_session, "appointment", orig["id"])
    reassign_audit = [a for a in audits if a.action == "APPOINTMENT_REASSIGNED"]
    assert len(reassign_audit) == 1
    assert reassign_audit[0].after_data["successor_appointment_id"] == successor["id"]
    assert reassign_audit[0].after_data["to_doctor_id"] == doctor_b_user.doctor_id
    assert reassign_audit[0].after_data["to_token_number"] == 1

    # Reassigning a patient who already has an active booking with target doctor is blocked (409).
    p2 = _make_patient(db_session, "0023")
    w_a = client.post(
        "/api/appointments/walk-in",
        json={
            "patient_id": p2.id,
            "doctor_id": doctor_a_user.doctor_id,
            "department_id": dept_a,
            "referral_source": "SELF",
        },
    ).json()
    b_b = client.post(
        "/api/appointments",
        json={
            "patient_id": p2.id,
            "doctor_id": doctor_b_user.doctor_id,
            "department_id": doctor_b_user.doctor.departments[0].id,
            "appointment_date": TODAY.isoformat(),
        },
    )
    assert b_b.status_code == 201, b_b.text

    dup_reassign = client.post(
        f"/api/appointments/{w_a['id']}/reassign",
        json={
            "version_id": w_a["version_id"],
            "new_doctor_id": doctor_b_user.doctor_id,
            "reason": "Duplicate target check",
        },
    )
    assert dup_reassign.status_code == 409
    assert dup_reassign.json()["code"] == "duplicate_appointment"


# ----------------------------------------------------------------- 3. Lifecycle, Validation & Audit


def test_lifecycle_policies_cancelled_noshow_and_completed_reopen(
    clock, login_client, reception_user, doctor_a_user, db_session
) -> None:
    """Enforce Policies #1, #2, #5: CANCELLED & COMPLETED terminal; NO_SHOW same-day recovery."""
    client = login_client(reception_user)
    doc_client = login_client(doctor_a_user)
    dept_id = doctor_a_user.doctor.departments[0].id

    # Policy #1: CANCELLED appointment cannot be checked in.
    p_cancel = _make_patient(db_session, "0030")
    b_cancel = client.post(
        "/api/appointments",
        json={
            "patient_id": p_cancel.id,
            "doctor_id": doctor_a_user.doctor_id,
            "department_id": dept_id,
            "appointment_date": TODAY.isoformat(),
        },
    ).json()
    cancelled = client.patch(
        f"/api/appointments/{b_cancel['id']}/status",
        json={
            "status": "CANCELLED",
            "version_id": b_cancel["version_id"],
            "cancellation_reason": "Cancelled by patient",
        },
    ).json()
    chk_cancelled = client.post(
        f"/api/appointments/{cancelled['id']}/check-in",
        json={"version_id": cancelled["version_id"], "referral_source": "SELF"},
    )
    assert chk_cancelled.status_code == 422
    assert chk_cancelled.json()["code"] == "invalid_status_transition"

    # Policy #2a: Same-day NO_SHOW can be checked in by Reception.
    p_ns = _make_patient(db_session, "0031")
    b_ns = client.post(
        "/api/appointments",
        json={
            "patient_id": p_ns.id,
            "doctor_id": doctor_a_user.doctor_id,
            "department_id": dept_id,
            "appointment_date": TODAY.isoformat(),
        },
    ).json()
    ns = client.patch(
        f"/api/appointments/{b_ns['id']}/status",
        json={"status": "NO_SHOW", "version_id": b_ns["version_id"]},
    ).json()
    ns_chk = client.post(
        f"/api/appointments/{ns['id']}/check-in",
        json={"version_id": ns["version_id"], "referral_source": "SELF"},
    )
    assert ns_chk.status_code == 200, ns_chk.text
    assert ns_chk.json()["status"] == "ARRIVED"
    assert ns_chk.json()["token_number"] == 1

    # Policy #2b: Wrong-day NO_SHOW check-in is blocked with 422 check_in_wrong_day.
    p_ns_old = _make_patient(db_session, "0032")
    old_ns = Appointment(
        patient_id=p_ns_old.id,
        doctor_id=doctor_a_user.doctor_id,
        department_id=dept_id,
        appointment_date=YESTERDAY,
        status=AppointmentStatus.NO_SHOW.value,
        created_by_user_id=reception_user.id,
    )
    db_session.add(old_ns)
    db_session.flush()
    old_ns_chk = client.post(
        f"/api/appointments/{old_ns.id}/check-in",
        json={"version_id": old_ns.version_id, "referral_source": "SELF"},
    )
    assert old_ns_chk.status_code == 422
    assert old_ns_chk.json()["code"] == "check_in_wrong_day"

    # Policy #2c: Same-day NO_SHOW check-in blocked with 409 if patient already rebooked today.
    p_ns_dup = _make_patient(db_session, "0033")
    b_ns_1 = client.post(
        "/api/appointments",
        json={
            "patient_id": p_ns_dup.id,
            "doctor_id": doctor_a_user.doctor_id,
            "department_id": dept_id,
            "appointment_date": TODAY.isoformat(),
        },
    ).json()
    ns_1 = client.patch(
        f"/api/appointments/{b_ns_1['id']}/status",
        json={"status": "NO_SHOW", "version_id": b_ns_1["version_id"]},
    ).json()
    rebook = client.post(
        "/api/appointments",
        json={
            "patient_id": p_ns_dup.id,
            "doctor_id": doctor_a_user.doctor_id,
            "department_id": dept_id,
            "appointment_date": TODAY.isoformat(),
        },
    )
    assert rebook.status_code == 201, rebook.text
    dup_ns_chk = client.post(
        f"/api/appointments/{ns_1['id']}/check-in",
        json={"version_id": ns_1["version_id"], "referral_source": "SELF"},
    )
    assert dup_ns_chk.status_code == 409
    assert dup_ns_chk.json()["code"] == "duplicate_appointment"

    # Policy #5: Completed consultation cannot be reopened.
    in_cons = doc_client.patch(
        f"/api/appointments/{ns_chk.json()['id']}/status",
        json={"status": "IN_CONSULTATION", "version_id": ns_chk.json()["version_id"]},
    ).json()
    completed = doc_client.patch(
        f"/api/appointments/{in_cons['id']}/status",
        json={"status": "COMPLETED", "version_id": in_cons["version_id"]},
    ).json()
    reopen = doc_client.patch(
        f"/api/appointments/{completed['id']}/status",
        json={"status": "IN_CONSULTATION", "version_id": completed["version_id"]},
    )
    assert reopen.status_code == 422
    assert reopen.json()["code"] == "invalid_status_transition"


def test_check_in_patient_id_verification(
    clock, login_client, reception_user, doctor_a_user, db_session
) -> None:
    """Check-in rejects mismatched patient_id with 422 and accepts matching or omitted value."""
    p1 = _make_patient(db_session, "0034")
    p2 = _make_patient(db_session, "0035")
    dept_id = doctor_a_user.doctor.departments[0].id
    client = login_client(reception_user)

    b1 = client.post(
        "/api/appointments",
        json={
            "patient_id": p1.id,
            "doctor_id": doctor_a_user.doctor_id,
            "department_id": dept_id,
            "appointment_date": TODAY.isoformat(),
        },
    ).json()

    mismatch = client.post(
        f"/api/appointments/{b1['id']}/check-in",
        json={"version_id": b1["version_id"], "patient_id": p2.id, "referral_source": "SELF"},
    )
    assert mismatch.status_code == 422
    assert mismatch.json()["code"] == "patient_appointment_mismatch"
    assert db_session.get(Appointment, b1["id"]).status == AppointmentStatus.BOOKED.value

    match_ok = client.post(
        f"/api/appointments/{b1['id']}/check-in",
        json={"version_id": b1["version_id"], "patient_id": p1.id, "referral_source": "SELF"},
    )
    assert match_ok.status_code == 200, match_ok.text
    assert match_ok.json()["status"] == "ARRIVED"

    # Backward compatibility: patient_id omitted still succeeds.
    b2 = client.post(
        "/api/appointments",
        json={
            "patient_id": p2.id,
            "doctor_id": doctor_a_user.doctor_id,
            "department_id": dept_id,
            "appointment_date": TODAY.isoformat(),
        },
    ).json()
    omitted_ok = client.post(
        f"/api/appointments/{b2['id']}/check-in",
        json={"version_id": b2["version_id"], "referral_source": "SELF"},
    )
    assert omitted_ok.status_code == 200, omitted_ok.text


def test_walk_in_new_patient_to_arrive_rejects_invalid_doctor_dept_without_orphan_patient(
    clock, login_client, reception_user, doctor_a_user, db_session
) -> None:
    """walk-in/new-patient (to_arrive=True) validates doctor & dept before creating patient."""
    client = login_client(reception_user)
    active_dept = doctor_a_user.doctor.departments[0]

    inactive_doc = Doctor(name_en="Dr. Inactive", is_active=False)
    inactive_doc.departments.append(active_dept)
    inactive_dept = Department(name_en="Inactive Dept", is_active=False)
    unassigned_dept = Department(name_en="Unassigned Dept", is_active=True)
    db_session.add_all([inactive_doc, inactive_dept, unassigned_dept])
    db_session.flush()
    doctor_a_user.doctor.departments.append(inactive_dept)
    db_session.flush()

    cases = [
        (inactive_doc.id, active_dept.id, 404, "doctor_not_found", "9876511001"),
        (doctor_a_user.doctor_id, 999999, 422, "department_not_found", "9876511002"),
        (doctor_a_user.doctor_id, inactive_dept.id, 422, "department_inactive", "9876511003"),
        (
            doctor_a_user.doctor_id,
            unassigned_dept.id,
            422,
            "doctor_department_mismatch",
            "9876511004",
        ),
    ]

    for doc_id, dep_id, expected_status, expected_code, mobile in cases:
        resp = client.post(
            "/api/appointments/walk-in/new-patient",
            json={
                "patient": _new_patient_payload(mobile[-4:], mobile=mobile),
                "doctor_id": doc_id,
                "department_id": dep_id,
                "referral_source": "SELF",
                "to_arrive": True,
            },
        )
        assert resp.status_code == expected_status, resp.text
        assert resp.json()["code"] == expected_code
        assert (
            db_session.scalar(
                select(func.count()).select_from(Patient).where(Patient.mobile == mobile)
            )
            == 0
        )


def test_patch_status_accepts_completed_and_audits_consultation_status(
    clock, login_client, reception_user, doctor_a_user, db_session
) -> None:
    """PATCH /{id}/status accepts COMPLETED and records consultation_status in before/after."""
    patient = _make_patient(db_session, "0036")
    rec_client = login_client(reception_user)
    doc_client = login_client(doctor_a_user)
    dept_id = doctor_a_user.doctor.departments[0].id

    walkin = rec_client.post(
        "/api/appointments/walk-in",
        json={
            "patient_id": patient.id,
            "doctor_id": doctor_a_user.doctor_id,
            "department_id": dept_id,
            "referral_source": "SELF",
        },
    ).json()

    started = doc_client.patch(
        f"/api/appointments/{walkin['id']}/status",
        json={"status": "IN_CONSULTATION", "version_id": walkin["version_id"]},
    )
    assert started.status_code == 200, started.text

    finished = doc_client.patch(
        f"/api/appointments/{walkin['id']}/status",
        json={"status": "COMPLETED", "version_id": started.json()["version_id"]},
    )
    assert finished.status_code == 200, finished.text
    assert finished.json()["status"] == "COMPLETED"
    assert finished.json()["consultation_status"] == "COMPLETED"

    status_audits = [
        row
        for row in _audit_rows(db_session, "appointment", walkin["id"])
        if row.action == "APPOINTMENT_STATUS_UPDATED"
    ]
    assert len(status_audits) == 2
    assert status_audits[0].before_data["consultation_status"] == "WAITING"
    assert status_audits[0].after_data["consultation_status"] == "IN_CONSULTATION"
    assert status_audits[1].before_data["consultation_status"] == "IN_CONSULTATION"
    assert status_audits[1].after_data["consultation_status"] == "COMPLETED"


def test_walk_in_audit_records_pre_check_in_booked_before_checked_in(
    clock, login_client, reception_user, doctor_a_user, db_session
) -> None:
    """Both walk-in endpoints log BOOKED (no token) in APPOINTMENT_CREATED before CHECKED_IN."""
    patient = _make_patient(db_session, "0037")
    client = login_client(reception_user)
    dept_id = doctor_a_user.doctor.departments[0].id

    w_existing = client.post(
        "/api/appointments/walk-in",
        json={
            "patient_id": patient.id,
            "doctor_id": doctor_a_user.doctor_id,
            "department_id": dept_id,
            "referral_source": "SELF",
        },
    )
    assert w_existing.status_code == 201, w_existing.text

    w_new = client.post(
        "/api/appointments/walk-in/new-patient",
        json={
            "patient": _new_patient_payload("0038", mobile="9876510038"),
            "doctor_id": doctor_a_user.doctor_id,
            "department_id": dept_id,
            "referral_source": "SELF",
        },
    )
    assert w_new.status_code == 201, w_new.text

    for appt_body in (w_existing.json(), w_new.json()):
        audits = _audit_rows(db_session, "appointment", appt_body["id"])
        created = [a for a in audits if a.action == "APPOINTMENT_CREATED"]
        checked_in = [a for a in audits if a.action == "APPOINTMENT_CHECKED_IN"]
        assert len(created) == 1
        assert len(checked_in) == 1
        assert created[0].id < checked_in[0].id
        assert created[0].after_data["status"] == "BOOKED"
        assert created[0].after_data["token_number"] is None
        assert created[0].after_data["consultation_status"] is None
        assert checked_in[0].before_data["status"] == "BOOKED"
        assert checked_in[0].before_data["consultation_status"] is None
        assert checked_in[0].after_data["status"] == "ARRIVED"
        assert checked_in[0].after_data["consultation_status"] == "WAITING"
        assert checked_in[0].after_data["token_number"] == appt_body["token_number"]


def test_opd_arrival_priority_and_cancel_audit_completeness(
    clock, login_client, reception_user, doctor_a_user, db_session
) -> None:
    """OPD arrival priority & cancel audits record priority_reason and cancellation_reason."""
    client = login_client(reception_user)
    created = client.post(
        "/api/opd-arrivals",
        json=_opd_arrival_payload(doctor_a_user, mobile="9876520039"),
    ).json()

    prio = client.patch(
        f"/api/opd-arrivals/{created['id']}/priority",
        json={
            "version_id": created["version_id"],
            "priority_level": "PRIORITY",
            "reason": "Elderly patient",
        },
    )
    assert prio.status_code == 200, prio.text

    cancel = client.post(
        f"/api/opd-arrivals/{created['id']}/cancel",
        json={
            "version_id": prio.json()["version_id"],
            "reason": "Family rescheduled",
        },
    )
    assert cancel.status_code == 200, cancel.text
    assert cancel.json()["cancellation_reason"] == "Family rescheduled"
    assert cancel.json()["priority_reason"] == "Elderly patient"

    audits = _audit_rows(db_session, "pending_opd_arrival", created["id"])
    prio_audit = [a for a in audits if a.action == "OPD_ARRIVAL_PRIORITY_CHANGED"]
    cancel_audit = [a for a in audits if a.action == "OPD_ARRIVAL_CANCELLED"]
    assert len(prio_audit) == 1
    assert prio_audit[0].before_data["priority_reason"] is None
    assert prio_audit[0].after_data["priority_reason"] == "Elderly patient"
    assert len(cancel_audit) == 1
    assert cancel_audit[0].before_data["cancellation_reason"] is None
    assert cancel_audit[0].after_data["cancellation_reason"] == "Family rescheduled"
    assert cancel_audit[0].after_data["priority_reason"] == "Elderly patient"


# ----------------------------------------------------------------- 4. Settings & Reception Overview


def test_clinic_settings_token_reset_policy_default_accept_reject_and_audit(
    login_client, admin_user, db_session
) -> None:
    """ClinicSettings.token_reset_policy returns DAILY, accepts DAILY, rejects MONTHLY, audits."""
    client = login_client(admin_user)
    get_resp = client.get("/api/settings")
    assert get_resp.status_code == 200, get_resp.text
    current = get_resp.json()
    assert current["token_reset_policy"] == "DAILY"

    base_payload = {
        "name_en": current["name_en"],
        "name_hi": current["name_hi"],
        "address_1": current["address_1"],
        "address_2": current["address_2"],
        "phone": current["phone"],
        "email": current["email"],
        "receipt_sequence_cycle": current["receipt_sequence_cycle"],
        "consultation_validity_days": current["consultation_validity_days"],
        "version_id": current["version_id"],
    }

    bad = client.patch(
        "/api/settings",
        json={**base_payload, "token_reset_policy": "MONTHLY"},
    )
    assert bad.status_code == 422

    ok = client.patch(
        "/api/settings",
        json={**base_payload, "token_reset_policy": "DAILY"},
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["token_reset_policy"] == "DAILY"

    audits = _audit_rows(db_session, "CLINIC_SETTINGS", 1)
    assert audits
    last_audit = audits[-1]
    assert last_audit.before_data["token_reset_policy"] == "DAILY"
    assert last_audit.after_data["token_reset_policy"] == "DAILY"


def test_reception_overview_pending_arrivals_and_real_department_name(
    clock, login_client, reception_user, doctor_a_user, db_session
) -> None:
    """GET /reception/overview populates pending_arrivals and real assigned Department.name_en."""
    ortho = Department(name_en="Orthopaedics", is_active=True)
    db_session.add(ortho)
    db_session.flush()
    doctor_a_user.doctor.departments.clear()
    doctor_a_user.doctor.departments.append(ortho)
    db_session.flush()

    p1 = _make_patient(db_session, "0040")
    p2 = _make_patient(db_session, "0041")
    db_session.add_all(
        [
            Appointment(
                patient_id=p1.id,
                doctor_id=doctor_a_user.doctor_id,
                department_id=ortho.id,
                appointment_date=TODAY,
                status=AppointmentStatus.BOOKED.value,
                created_by_user_id=reception_user.id,
            ),
            Appointment(
                patient_id=p2.id,
                doctor_id=doctor_a_user.doctor_id,
                department_id=ortho.id,
                appointment_date=TODAY,
                token_number=1,
                status=AppointmentStatus.ARRIVED.value,
                consultation_status=ConsultationStatus.WAITING.value,
                created_by_user_id=reception_user.id,
            ),
            PendingOpdArrival(
                full_name="Pending One",
                age_years=25,
                mobile="9876540040",
                doctor_id=doctor_a_user.doctor_id,
                department_id=ortho.id,
                appointment_date=TODAY,
                token_number=2,
                status="TO_ARRIVE",
                created_by_user_id=reception_user.id,
            ),
            PendingOpdArrival(
                full_name="Pending Two",
                age_years=28,
                mobile="9876540041",
                doctor_id=doctor_a_user.doctor_id,
                department_id=ortho.id,
                appointment_date=TODAY,
                token_number=3,
                status="TO_ARRIVE",
                created_by_user_id=reception_user.id,
            ),
            PendingOpdArrival(
                full_name="Cancelled Pending",
                age_years=30,
                mobile="9876540042",
                doctor_id=doctor_a_user.doctor_id,
                department_id=ortho.id,
                appointment_date=TODAY,
                token_number=4,
                status="CANCELLED",
                cancellation_reason="Left early",
                created_by_user_id=reception_user.id,
            ),
        ]
    )
    db_session.flush()

    resp = login_client(reception_user).get("/api/reception/overview")
    assert resp.status_code == 200, resp.text
    doctors = resp.json()["doctors_today"]
    doc_entry = next(d for d in doctors if d["doctor_id"] == doctor_a_user.doctor_id)

    assert doc_entry["department"] == "Orthopaedics"
    assert doc_entry["pending_arrivals"] == 2
    assert doc_entry["appointments_today"] == 2
    assert doc_entry["waiting"] == 2
    assert doc_entry["arrived_waiting"] == 1


# ----------------------------------------------------------------- 5. GET /appointments Queries


def test_list_appointments_bucket_counts_filtering_pagination_and_sort(
    clock, login_client, reception_user, doctor_a_user, db_session
) -> None:
    """GET /appointments returns accurate bucket_counts, bucket filter, sort & pagination."""
    dept_id = doctor_a_user.doctor.departments[0].id
    patients = [_make_patient(db_session, f"50{i:02d}") for i in range(9)]

    def _add(
        idx: int,
        status: str,
        *,
        cons: str | None = None,
        token: int | None = None,
        exp: time | None = None,
    ) -> Appointment:
        row = Appointment(
            patient_id=patients[idx].id,
            doctor_id=doctor_a_user.doctor_id,
            department_id=dept_id,
            appointment_date=TODAY,
            token_number=token,
            expected_time=exp,
            status=status,
            consultation_status=cons,
            created_by_user_id=reception_user.id,
        )
        db_session.add(row)
        db_session.flush()
        return row

    a_booked = _add(0, AppointmentStatus.BOOKED.value, exp=time(11, 0))
    a_to_arrive = _add(1, AppointmentStatus.TO_ARRIVE.value, token=1, exp=time(9, 30))
    a_arrived = _add(
        2,
        AppointmentStatus.ARRIVED.value,
        cons=ConsultationStatus.WAITING.value,
        token=2,
        exp=time(10, 30),
    )
    a_in_cons = _add(
        3,
        AppointmentStatus.IN_CONSULTATION.value,
        cons=ConsultationStatus.IN_CONSULTATION.value,
        token=3,
        exp=time(9, 0),
    )
    a_done = _add(
        4,
        AppointmentStatus.DONE.value,
        cons=ConsultationStatus.COMPLETED.value,
        token=4,
    )
    a_completed = _add(
        5,
        AppointmentStatus.COMPLETED.value,
        cons=ConsultationStatus.COMPLETED.value,
        token=5,
    )
    a_no_show = _add(6, AppointmentStatus.NO_SHOW.value)
    a_cancelled = _add(7, AppointmentStatus.CANCELLED.value, token=6)
    a_rescheduled = _add(8, AppointmentStatus.RESCHEDULED.value)

    client = login_client(reception_user)
    base_url = (
        f"/api/appointments?appointment_date={TODAY.isoformat()}"
        f"&doctor_id={doctor_a_user.doctor_id}"
    )

    # Full bucket counts math
    all_resp = client.get(base_url)
    assert all_resp.status_code == 200, all_resp.text
    body = all_resp.json()
    counts = body["bucket_counts"]
    assert counts["to_arrive"] == 2  # excludes NO_SHOW
    assert counts["checked_in"] == 2  # excludes DONE / COMPLETED
    assert counts["active"] == counts["to_arrive"] + counts["checked_in"] == 4
    assert counts["completed"] == 2
    assert counts["no_show"] == 1
    assert counts["cancelled"] == 1
    assert counts["all"] == 9
    assert body["total"] == 9

    # status_bucket filtering returns exact mutually exclusive sets + full bucket_counts
    expected_buckets = {
        "active": {a_booked.id, a_to_arrive.id, a_arrived.id, a_in_cons.id},
        "to_arrive": {a_booked.id, a_to_arrive.id},
        "checked_in": {a_arrived.id, a_in_cons.id},
        "completed": {a_done.id, a_completed.id},
        "no_show": {a_no_show.id},
        "cancelled": {a_cancelled.id},
    }
    for bucket, expected_ids in expected_buckets.items():
        r = client.get(f"{base_url}&status_bucket={bucket}")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["total"] == len(expected_ids)
        assert data["bucket_counts"] == counts
        assert {item["id"] for item in data["appointments"]} == expected_ids

    # Deterministic sort_by=token: numbered tokens 1..6, then null-token rows by expected_time, id
    expected_token_order = [
        a_to_arrive.id,  # token 1
        a_arrived.id,  # token 2
        a_in_cons.id,  # token 3
        a_done.id,  # token 4
        a_completed.id,  # token 5
        a_cancelled.id,  # token 6
        a_booked.id,  # token None, expected_time 11:00
        a_no_show.id,  # token None, expected_time None, lower id
        a_rescheduled.id,  # token None, expected_time None, higher id
    ]
    token_sorted = client.get(f"{base_url}&sort_by=token").json()
    assert [a["id"] for a in token_sorted["appointments"]] == expected_token_order

    # Deterministic sort_by=time: expected_time asc nulls last, then token asc nulls last, then id
    expected_time_order = [
        a_in_cons.id,  # 09:00
        a_to_arrive.id,  # 09:30
        a_arrived.id,  # 10:30
        a_booked.id,  # 11:00
        a_done.id,  # None, token 4
        a_completed.id,  # None, token 5
        a_cancelled.id,  # None, token 6
        a_no_show.id,  # None, token None, lower id
        a_rescheduled.id,  # None, token None, higher id
    ]
    time_sorted = client.get(f"{base_url}&sort_by=time").json()
    assert [a["id"] for a in time_sorted["appointments"]] == expected_time_order

    # Pagination slices deterministically while preserving total and bucket_counts
    page = client.get(f"{base_url}&sort_by=time&limit=2&offset=1").json()
    assert page["limit"] == 2
    assert page["offset"] == 1
    assert page["total"] == 9
    assert page["bucket_counts"] == counts
    assert [a["id"] for a in page["appointments"]] == expected_time_order[1:3]

    # Over-limit rejected with 422
    assert client.get(f"{base_url}&limit=501").status_code == 422


def test_list_appointments_search_patient_fields_and_token_formats(
    clock, login_client, reception_user, doctor_a_user, doctor_b_user, db_session
) -> None:
    """GET /appointments search matches name, URN, 10-digit mobile, and token formats safely."""
    doctor_a_user.doctor.cabin_code = "A"
    doctor_b_user.doctor.cabin_code = "B"
    db_session.flush()

    dept_a = doctor_a_user.doctor.departments[0].id
    dept_b = doctor_b_user.doctor.departments[0].id

    p_alpha = _make_patient(
        db_session,
        "6001",
        full_name="Sunita Verma",
        mobile="9876543219",
    )
    p_beta = _make_patient(
        db_session,
        "6002",
        full_name="Raghav_100% Sharma",
        mobile="9123467890",
    )
    a5 = Appointment(
        patient_id=p_alpha.id,
        doctor_id=doctor_a_user.doctor_id,
        department_id=dept_a,
        appointment_date=TODAY,
        token_number=5,
        status=AppointmentStatus.ARRIVED.value,
        consultation_status=ConsultationStatus.WAITING.value,
        created_by_user_id=reception_user.id,
    )
    b12 = Appointment(
        patient_id=p_beta.id,
        doctor_id=doctor_b_user.doctor_id,
        department_id=dept_b,
        appointment_date=TODAY,
        token_number=12,
        status=AppointmentStatus.ARRIVED.value,
        consultation_status=ConsultationStatus.WAITING.value,
        created_by_user_id=reception_user.id,
    )
    db_session.add_all([a5, b12])
    db_session.flush()

    client = login_client(reception_user)

    def _search_ids(term: str) -> tuple[list[int], dict]:
        resp = client.get(
            "/api/appointments",
            params={"appointment_date": TODAY.isoformat(), "search": term},
        )
        assert resp.status_code == 200, f"search={term!r} failed: {resp.text}"
        data = resp.json()
        return [item["id"] for item in data["appointments"]], data["bucket_counts"]

    # Patient name, URN, and 10-digit mobile (verifies no PostgreSQL INT4 overflow)
    assert _search_ids("sunita")[0] == [a5.id]
    assert _search_ids("KH-2026-H6001")[0] == [a5.id]
    ids_mobile, counts_mobile = _search_ids("9876543219")
    assert ids_mobile == [a5.id]
    assert counts_mobile["all"] == 1
    assert counts_mobile["checked_in"] == 1

    # Token formats: "5", "#5", "05", "#05", "A-5", "A-05", "a-05", "b-12"
    for query in ("5", "#5", "05", "#05", "A-5", "A-05", "a-05"):
        assert _search_ids(query)[0] == [a5.id], f"Expected token query {query!r} to match a5"
    for query in ("12", "#12", "B-12", "b-12"):
        assert _search_ids(query)[0] == [b12.id], f"Expected token query {query!r} to match b12"

    # LIKE wildcards are escaped cleanly
    assert _search_ids("100%")[0] == [b12.id]
    assert _search_ids("Raghav_")[0] == [b12.id]


def test_doctor_queue_merges_active_structured_allergies_with_legacy(
    clock, login_client, reception_user, doctor_a_user, db_session
) -> None:
    """GET /api/doctor/queue surfaces ACTIVE PatientAllergy rows and omits RESOLVED/INACTIVE."""
    dept_a = doctor_a_user.doctor.departments[0].id

    # Patient 1: empty legacy allergies (""); ACTIVE (SEVERE, LIFE_THREATENING, MILD) + inactive
    p1 = _make_patient(db_session, "7001", full_name="Structured Only Patient")
    p1.allergies = ""
    db_session.add_all(
        [
            PatientAllergy(
                patient_id=p1.id,
                substance="Penicillin",
                severity=AllergySeverity.SEVERE.value,
                status=AllergyStatus.ACTIVE.value,
                doctor_id=doctor_a_user.doctor_id,
                recorded_by_user_id=doctor_a_user.id,
            ),
            PatientAllergy(
                patient_id=p1.id,
                substance="Latex",
                severity=AllergySeverity.LIFE_THREATENING.value,
                status=AllergyStatus.ACTIVE.value,
                doctor_id=doctor_a_user.doctor_id,
                recorded_by_user_id=doctor_a_user.id,
            ),
            PatientAllergy(
                patient_id=p1.id,
                substance="Pollen",
                severity=AllergySeverity.MILD.value,
                status=AllergyStatus.ACTIVE.value,
                doctor_id=doctor_a_user.doctor_id,
                recorded_by_user_id=doctor_a_user.id,
            ),
            PatientAllergy(
                patient_id=p1.id,
                substance="Aspirin",
                severity=AllergySeverity.SEVERE.value,
                status=AllergyStatus.RESOLVED.value,
                doctor_id=doctor_a_user.doctor_id,
                recorded_by_user_id=doctor_a_user.id,
            ),
            PatientAllergy(
                patient_id=p1.id,
                substance="Sulfa",
                severity=AllergySeverity.MODERATE.value,
                status=AllergyStatus.INACTIVE.value,
                doctor_id=doctor_a_user.doctor_id,
                recorded_by_user_id=doctor_a_user.id,
            ),
        ]
    )

    # Patient 2: meaningful legacy allergy + ACTIVE structured allergy -> both combined
    p2 = _make_patient(db_session, "7002", full_name="Combined Allergy Patient")
    p2.allergies = "NSAIDs"
    db_session.add(
        PatientAllergy(
            patient_id=p2.id,
            substance="Ibuprofen",
            severity=AllergySeverity.MODERATE.value,
            status=AllergyStatus.ACTIVE.value,
            doctor_id=doctor_a_user.doctor_id,
            recorded_by_user_id=doctor_a_user.id,
        )
    )

    # Patient 3: placeholder legacy token ("None reported") + ACTIVE structured -> drops token
    p3 = _make_patient(db_session, "7003", full_name="Placeholder Override Patient")
    p3.allergies = "None reported"
    db_session.add(
        PatientAllergy(
            patient_id=p3.id,
            substance="Amoxicillin",
            severity=AllergySeverity.MODERATE.value,
            status=AllergyStatus.ACTIVE.value,
            doctor_id=doctor_a_user.doctor_id,
            recorded_by_user_id=doctor_a_user.id,
        )
    )

    # Patient 4: empty legacy allergies + only RESOLVED/INACTIVE structured allergies -> stays empty
    p4 = _make_patient(db_session, "7004", full_name="Resolved Only Patient")
    p4.allergies = ""
    db_session.add_all(
        [
            PatientAllergy(
                patient_id=p4.id,
                substance="Old Drug",
                severity=AllergySeverity.SEVERE.value,
                status=AllergyStatus.RESOLVED.value,
                doctor_id=doctor_a_user.doctor_id,
                recorded_by_user_id=doctor_a_user.id,
            ),
            PatientAllergy(
                patient_id=p4.id,
                substance="Old Food",
                severity=AllergySeverity.MILD.value,
                status=AllergyStatus.INACTIVE.value,
                doctor_id=doctor_a_user.doctor_id,
                recorded_by_user_id=doctor_a_user.id,
            ),
        ]
    )

    # Patient 5: merged alias carries an ACTIVE severe allergy -> surfaced on master patient row
    p5_master = _make_patient(db_session, "7005", full_name="Merged Master Patient")
    p5_master.allergies = "NKDA"
    p5_alias = _make_patient(db_session, "7006", full_name="Merged Alias Patient")
    p5_alias.merged_into_id = p5_master.id
    p5_alias.is_active = False
    db_session.flush()
    db_session.add(
        PatientAllergy(
            patient_id=p5_alias.id,
            substance="Cephalosporin",
            severity=AllergySeverity.SEVERE.value,
            status=AllergyStatus.ACTIVE.value,
            doctor_id=doctor_a_user.doctor_id,
            recorded_by_user_id=doctor_a_user.id,
        )
    )

    for idx, patient in enumerate((p1, p2, p3, p4, p5_master), start=1):
        db_session.add(
            Appointment(
                patient_id=patient.id,
                doctor_id=doctor_a_user.doctor_id,
                department_id=dept_a,
                appointment_date=TODAY,
                token_number=idx,
                status=AppointmentStatus.ARRIVED.value,
                consultation_status=ConsultationStatus.WAITING.value,
                created_by_user_id=reception_user.id,
            )
        )
    db_session.flush()

    doc_client = login_client(doctor_a_user)
    resp = doc_client.get("/api/doctor/queue")
    assert resp.status_code == 200, resp.text
    waiting_by_patient = {item["patient_id"]: item for item in resp.json()["waiting"]}

    assert waiting_by_patient[p1.id]["patient_allergies"] == (
        "Penicillin (Severe), Latex (Life Threatening), Pollen"
    )
    assert "Aspirin" not in (waiting_by_patient[p1.id]["patient_allergies"] or "")
    assert "Sulfa" not in (waiting_by_patient[p1.id]["patient_allergies"] or "")
    assert waiting_by_patient[p2.id]["patient_allergies"] == "Ibuprofen, NSAIDs"
    assert waiting_by_patient[p3.id]["patient_allergies"] == "Amoxicillin"
    assert waiting_by_patient[p4.id]["patient_allergies"] == ""
    assert waiting_by_patient[p5_master.id]["patient_allergies"] == "Cephalosporin (Severe)"
