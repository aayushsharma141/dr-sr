"""Checkout at the desk (RF-23): charges, receipts for today and dues of closed visits.

Owner decisions of 2026-11-13: money is collected at exit only, after the consultation; reception
sees today's receipts only while the full ledger stays admin-only; a visit may close with a
balance if a reason is recorded, and that balance then stays listed as a due; a payment against it
later does not reopen the visit.
"""

import itertools
from datetime import UTC, date, datetime, timedelta

import pytest

from kalyan_api.models import (
    Appointment,
    ConsultationStatus,
    Patient,
    Payment,
    Visit,
    VisitStatus,
)

TODAY = date(2026, 11, 2)
FEE = 30000
# Every consultation gets its own token, as the database requires one per doctor, date and token.
_TOKENS = itertools.count(1)


def _patient(db_session, suffix: str) -> Patient:
    patient = Patient(
        urn=f"KH-2026-M1{suffix}",
        full_name=f"Checkout Patient {suffix}",
        guardian_name="Guardian",
        gender="M",
        age_years=47,
        mobile="9876543701",
        address="Ara",
    )
    db_session.add(patient)
    db_session.flush()
    return patient


def _visit(db_session, patient, user, status=VisitStatus.OPEN.value, **fields) -> Visit:
    visit = Visit(
        patient_id=patient.id,
        visit_date=TODAY,
        status=status,
        opened_by_user_id=user.id,
        **fields,
    )
    db_session.add(visit)
    db_session.flush()
    return visit


def _consultation(db_session, visit, patient, doctor_user, user, status: str) -> Appointment:
    appt = Appointment(
        patient_id=patient.id,
        doctor_id=doctor_user.doctor_id,
        appointment_date=TODAY,
        token_number=next(_TOKENS),
        status="ARRIVED",
        consultation_status=status,
        visit_id=visit.id,
        created_by_user_id=user.id,
    )
    db_session.add(appt)
    db_session.flush()
    return appt


def _fee(doctor_user, paise: int = FEE) -> None:
    doctor_user.doctor.default_fee_paise = paise


def _pay(client, patient, appointment, amount=FEE):
    return client.post(
        "/api/payments",
        json={
            "patient_id": patient.id,
            "appointment_id": appointment.id,
            "amount_paise": amount,
            "payment_method": "CASH",
        },
    )


COMPLETED = ConsultationStatus.COMPLETED.value
WAITING = ConsultationStatus.WAITING.value
IN_CONSULTATION = ConsultationStatus.IN_CONSULTATION.value
CANCELLED = ConsultationStatus.CANCELLED.value


# ------------------------------------------------------------------ charge lines


def test_visit_detail_shows_each_consultation_with_its_fee_payments_and_balance(
    login_client, reception_user, doctor_a_user, doctor_b_user, db_session
):
    _fee(doctor_a_user)
    _fee(doctor_b_user, 50000)
    patient = _patient(db_session, "A")
    visit = _visit(db_session, patient, reception_user)
    done = _consultation(db_session, visit, patient, doctor_a_user, reception_user, COMPLETED)
    _consultation(db_session, visit, patient, doctor_b_user, reception_user, WAITING)
    client = login_client(reception_user)
    assert _pay(client, patient, done, 10000).status_code == 201

    detail = client.get(f"/api/visits/{visit.id}").json()

    by_doctor = {c["doctor_id"]: c for c in detail["consultations"]}
    first = by_doctor[doctor_a_user.doctor_id]
    assert (first["fee_paise"], first["paid_paise"], first["balance_paise"]) == (
        30000,
        10000,
        20000,
    )
    assert first["collectable"] is True
    # A consultation still waiting owes nothing yet, whatever the doctor's fee is.
    second = by_doctor[doctor_b_user.doctor_id]
    assert (second["fee_paise"], second["paid_paise"], second["balance_paise"]) == (50000, 0, 0)
    assert second["collectable"] is False
    assert detail["outstanding_paise"] == 20000
    assert detail["total_paid_paise"] == 10000
    assert [
        (p["appointment_id"], p["amount_paise"], p["is_reversed"]) for p in detail["payments"]
    ] == [(done.id, 10000, False)]
    assert detail["payments"][0]["receipt_number"]


def test_a_reversed_payment_stays_listed_but_does_not_count_as_paid(
    login_client, reception_user, admin_user, doctor_a_user, db_session
):
    _fee(doctor_a_user)
    patient = _patient(db_session, "B")
    visit = _visit(db_session, patient, reception_user)
    done = _consultation(db_session, visit, patient, doctor_a_user, reception_user, COMPLETED)
    client = login_client(reception_user)
    payment = _pay(client, patient, done).json()
    login_client(admin_user).post(
        f"/api/payments/{payment['id']}/reverse", json={"reversal_reason": "Entered in error"}
    )

    detail = client.get(f"/api/visits/{visit.id}").json()

    assert detail["total_paid_paise"] == 0
    assert detail["outstanding_paise"] == FEE
    assert [p["is_reversed"] for p in detail["payments"]] == [True]


# -------------------------------------------------------- collecting after the consultation


@pytest.mark.parametrize(
    ("status", "code"),
    [
        (WAITING, "consultation_in_progress"),
        (IN_CONSULTATION, "consultation_in_progress"),
        (CANCELLED, "consultation_cancelled"),
    ],
)
def test_no_payment_is_taken_before_the_doctor_completes_the_consultation(
    login_client, reception_user, doctor_a_user, db_session, status, code
):
    _fee(doctor_a_user)
    patient = _patient(db_session, f"C{status[:2]}")
    visit = _visit(db_session, patient, reception_user)
    appt = _consultation(db_session, visit, patient, doctor_a_user, reception_user, status)

    response = _pay(login_client(reception_user), patient, appt)

    assert response.status_code == 422
    assert response.json()["code"] == code
    assert db_session.query(Payment).filter(Payment.appointment_id == appt.id).count() == 0


def test_a_payment_is_taken_once_the_consultation_is_completed(
    login_client, reception_user, doctor_a_user, db_session
):
    _fee(doctor_a_user)
    patient = _patient(db_session, "D")
    visit = _visit(db_session, patient, reception_user)
    appt = _consultation(db_session, visit, patient, doctor_a_user, reception_user, COMPLETED)

    response = _pay(login_client(reception_user), patient, appt)

    assert response.status_code == 201, response.text
    assert response.json()["appointment_id"] == appt.id


# ------------------------------------------------------------ ready for checkout


def test_ready_for_checkout_lists_open_visits_with_every_consultation_finished(
    login_client, reception_user, doctor_a_user, doctor_b_user, db_session
):
    _fee(doctor_a_user)
    _fee(doctor_b_user, 50000)
    client = login_client(reception_user)

    ready = _patient(db_session, "E1")
    ready_visit = _visit(db_session, ready, reception_user)
    _consultation(db_session, ready_visit, ready, doctor_a_user, reception_user, COMPLETED)

    still_waiting = _patient(db_session, "E2")
    waiting_visit = _visit(db_session, still_waiting, reception_user)
    _consultation(db_session, waiting_visit, still_waiting, doctor_a_user, reception_user, WAITING)

    half_done = _patient(db_session, "E3")
    half_visit = _visit(db_session, half_done, reception_user)
    _consultation(db_session, half_visit, half_done, doctor_a_user, reception_user, COMPLETED)
    _consultation(db_session, half_visit, half_done, doctor_b_user, reception_user, IN_CONSULTATION)

    nobody_seen = _patient(db_session, "E4")
    cancelled_visit = _visit(db_session, nobody_seen, reception_user)
    _consultation(
        db_session, cancelled_visit, nobody_seen, doctor_a_user, reception_user, CANCELLED
    )

    closed = _patient(db_session, "E5")
    closed_visit = _visit(
        db_session,
        closed,
        reception_user,
        status=VisitStatus.CLOSED.value,
        closed_at=datetime.now(UTC),
        closed_by_user_id=reception_user.id,
    )
    _consultation(db_session, closed_visit, closed, doctor_a_user, reception_user, COMPLETED)

    listing = client.get("/api/visits", params={"ready_for_checkout": "true"}).json()

    assert [v["id"] for v in listing["visits"]] == [ready_visit.id]
    row = listing["visits"][0]
    assert row["doctors"] == [doctor_a_user.doctor.name_en]
    assert (row["completed_consultations"], row["active_consultations"]) == (1, 0)
    assert row["outstanding_paise"] == FEE
    assert listing["total"] == 1


def test_the_visit_list_summarises_who_was_seen_and_what_is_due(
    login_client, reception_user, doctor_a_user, doctor_b_user, db_session
):
    _fee(doctor_a_user)
    _fee(doctor_b_user, 50000)
    patient = _patient(db_session, "F")
    visit = _visit(db_session, patient, reception_user)
    _consultation(db_session, visit, patient, doctor_a_user, reception_user, COMPLETED)
    _consultation(db_session, visit, patient, doctor_b_user, reception_user, WAITING)

    row = (
        login_client(reception_user)
        .get("/api/visits", params={"patient_id": patient.id})
        .json()["visits"][0]
    )

    assert set(row["doctors"]) == {doctor_a_user.doctor.name_en, doctor_b_user.doctor.name_en}
    assert (row["completed_consultations"], row["active_consultations"]) == (1, 1)
    assert row["outstanding_paise"] == FEE


# -------------------------------------------------------------------- visit dues


def test_a_visit_closed_with_a_balance_stays_listed_until_it_is_paid(
    login_client, reception_user, doctor_a_user, db_session
):
    _fee(doctor_a_user)
    patient = _patient(db_session, "G")
    visit = _visit(db_session, patient, reception_user)
    appt = _consultation(db_session, visit, patient, doctor_a_user, reception_user, COMPLETED)
    client = login_client(reception_user)
    assert client.get("/api/billing/visit-dues").json() == []  # open: still at checkout

    closed = client.post(
        f"/api/visits/{visit.id}/close",
        json={"version_id": visit.version_id, "reason": "Pays with the next instalment"},
    )
    assert closed.status_code == 200, closed.text

    dues = client.get("/api/billing/visit-dues").json()
    assert dues == [
        {
            "visit_id": visit.id,
            "appointment_id": appt.id,
            "patient_id": patient.id,
            "patient_urn": patient.urn,
            "patient_name": patient.full_name,
            "doctor_name_en": doctor_a_user.doctor.name_en,
            "visit_date": TODAY.isoformat(),
            "fee_paise": FEE,
            "paid_paise": 0,
            "balance_paise": FEE,
            "close_reason": "Pays with the next instalment",
        }
    ]

    # A part payment reduces it, and paying the rest clears it, without reopening the visit.
    assert _pay(client, patient, appt, 10000).status_code == 201
    assert client.get("/api/billing/visit-dues").json()[0]["balance_paise"] == 20000
    assert _pay(client, patient, appt, 20000).status_code == 201
    assert client.get("/api/billing/visit-dues").json() == []
    db_session.expire_all()
    assert db_session.get(Visit, visit.id).status == VisitStatus.CLOSED.value


def test_a_visit_closed_in_full_has_no_due(login_client, reception_user, doctor_a_user, db_session):
    _fee(doctor_a_user)
    patient = _patient(db_session, "H")
    visit = _visit(db_session, patient, reception_user)
    appt = _consultation(db_session, visit, patient, doctor_a_user, reception_user, COMPLETED)
    client = login_client(reception_user)
    assert _pay(client, patient, appt).status_code == 201
    assert (
        client.post(
            f"/api/visits/{visit.id}/close", json={"version_id": visit.version_id}
        ).status_code
        == 200
    )

    assert client.get("/api/billing/visit-dues").json() == []


# ---------------------------------------------------------------- today's receipts


def test_reception_sees_todays_receipts_only_newest_first(
    login_client, reception_user, admin_user, doctor_a_user, db_session
):
    _fee(doctor_a_user)
    patient = _patient(db_session, "J")
    visit = _visit(db_session, patient, reception_user)
    appt = _consultation(db_session, visit, patient, doctor_a_user, reception_user, COMPLETED)
    client = login_client(reception_user)
    first = _pay(client, patient, appt, 10000).json()
    second = _pay(client, patient, appt, 20000).json()
    # A receipt from two days ago exists in the ledger but is not part of today's.
    db_session.add(
        Payment(
            receipt_number="OLD-2026-0001",
            patient_id=patient.id,
            amount_paise=5000,
            payment_method="CASH",
            created_by_user_id=reception_user.id,
            created_at=datetime.now(UTC) - timedelta(days=2),
        )
    )
    db_session.flush()

    receipts = client.get("/api/billing/receipts/today")

    assert receipts.status_code == 200, receipts.text
    assert [r["id"] for r in receipts.json()] == [second["id"], first["id"]]
    assert "OLD-2026-0001" not in [r["receipt_number"] for r in receipts.json()]
    # The same day's list is open to the administrator too.
    assert login_client(admin_user).get("/api/billing/receipts/today").status_code == 200


def test_reception_cannot_search_the_full_ledger(login_client, reception_user):
    assert login_client(reception_user).get("/api/billing/ledger").status_code == 403
