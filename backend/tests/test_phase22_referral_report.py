"""Tests for Phase 22 Plan 17 (Admin referral report API, T22-11).

Guarantees:
- Admin can count visits by referral source and referrer for a date range (OD-I, OD-22-21).
- Cancelled visits are excluded (OD-I).
- Visits with no recorded source (pre-Phase 22 legacy) are counted as 'NOT_RECORDED' (never inferred).
- Referrer names are grouped exactly as stored; name appears only for sources that require one
  (DOCTOR, PERSONAL, ORGANIZATION).
- Filter by source (including NOT_RECORDED) and case-insensitive substring on referrer.
- Ordered by visit_count desc, then source asc, then referrer_name asc.
- Authorisation: Admin 200, Reception 403, Doctor 403, Anonymous 401.
"""

from datetime import UTC, date, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from kalyan_api.models import Patient, Visit, VisitStatus


def _create_patient(db_session: Session, suffix: str) -> Patient:
    patient = Patient(
        urn=f"KH-2026-REP{suffix}",
        full_name=f"Patient Report {suffix}",
        guardian_name="Guardian",
        gender="M",
        age_years=35,
        mobile="9876543210",
        address="Ara",
    )
    db_session.add(patient)
    db_session.flush()
    return patient


def _create_visit(
    db_session: Session,
    patient_id: int,
    opened_by_user_id: int,
    visit_date: date,
    source: str | None = None,
    referrer_name: str | None = None,
    status: str = VisitStatus.CLOSED.value,
) -> Visit:
    v = Visit(
        patient_id=patient_id,
        visit_date=visit_date,
        status=status,
        opened_by_user_id=opened_by_user_id,
        referral_source=source,
        referrer_name=referrer_name,
    )
    if status == VisitStatus.CLOSED.value:
        v.closed_at = datetime.now(UTC)
        v.closed_by_user_id = opened_by_user_id
        v.close_reason = "Normal checkout"
    elif status == VisitStatus.CANCELLED.value:
        v.cancelled_at = datetime.now(UTC)
        v.cancelled_by_user_id = opened_by_user_id
        v.cancel_reason = "Patient withdrew"
    db_session.add(v)
    db_session.flush()
    return v


def test_referral_report_counts_grouping_and_exclusions(
    app,
    db_session: Session,
    admin_user,
    login_client,
) -> None:
    client = login_client(admin_user)
    patient = _create_patient(db_session, "001")
    target_date = date(2026, 11, 15)

    # In range:
    # 3 SELF
    for _ in range(3):
        _create_visit(db_session, patient.id, admin_user.id, target_date, source="SELF")

    # 2 DOCTOR "Dr. Sharma"
    for _ in range(2):
        _create_visit(
            db_session,
            patient.id,
            admin_user.id,
            target_date,
            source="DOCTOR",
            referrer_name="Dr. Sharma",
        )

    # 1 DOCTOR "Dr Sharma" (different spelling, not merged)
    _create_visit(
        db_session,
        patient.id,
        admin_user.id,
        target_date,
        source="DOCTOR",
        referrer_name="Dr Sharma",
    )

    # 1 ORGANIZATION "Rotary Club"
    _create_visit(
        db_session,
        patient.id,
        admin_user.id,
        target_date,
        source="ORGANIZATION",
        referrer_name="Rotary Club",
    )

    # 1 OTHER
    _create_visit(db_session, patient.id, admin_user.id, target_date, source="OTHER")

    # 1 CANCELLED DOCTOR "Dr. Sharma" (must be excluded)
    _create_visit(
        db_session,
        patient.id,
        admin_user.id,
        target_date,
        source="DOCTOR",
        referrer_name="Dr. Sharma",
        status=VisitStatus.CANCELLED.value,
    )

    # 1 legacy visit with NULL source (must count as NOT_RECORDED)
    _create_visit(
        db_session,
        patient.id,
        admin_user.id,
        target_date,
        source=None,
        referrer_name=None,
    )

    # 1 visit outside range (must not be counted)
    _create_visit(
        db_session,
        patient.id,
        admin_user.id,
        date(2026, 10, 31),
        source="SELF",
    )

    resp = client.get(
        "/api/reports/referrals",
        params={"date_from": "2026-11-01", "date_to": "2026-11-30"},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert data["date_from"] == "2026-11-01"
    assert data["date_to"] == "2026-11-30"
    assert data["total_visits"] == 9

    rows = data["rows"]
    assert len(rows) == 6

    # Ordered by visit_count desc, then source asc, then referrer_name asc:
    # 1. SELF (count 3, referrer_name None)
    assert rows[0] == {"source": "SELF", "referrer_name": None, "visit_count": 3}
    # 2. DOCTOR "Dr. Sharma" (count 2)
    assert rows[1] == {"source": "DOCTOR", "referrer_name": "Dr. Sharma", "visit_count": 2}

    # Next are the 4 rows with count 1:
    # DOCTOR "Dr Sharma", NOT_RECORDED, ORGANIZATION "Rotary Club", OTHER
    # Alphabetical by source:
    # "DOCTOR" < "NOT_RECORDED" < "ORGANIZATION" < "OTHER"
    assert rows[2] == {"source": "DOCTOR", "referrer_name": "Dr Sharma", "visit_count": 1}
    assert rows[3] == {"source": "NOT_RECORDED", "referrer_name": None, "visit_count": 1}
    assert rows[4] == {
        "source": "ORGANIZATION",
        "referrer_name": "Rotary Club",
        "visit_count": 1,
    }
    assert rows[5] == {"source": "OTHER", "referrer_name": None, "visit_count": 1}


def test_referral_report_source_filter(
    app,
    db_session: Session,
    admin_user,
    login_client,
) -> None:
    client = login_client(admin_user)
    patient = _create_patient(db_session, "002")
    target_date = date(2026, 11, 10)

    _create_visit(db_session, patient.id, admin_user.id, target_date, source="SELF")
    _create_visit(
        db_session,
        patient.id,
        admin_user.id,
        target_date,
        source="DOCTOR",
        referrer_name="Dr. Verma",
    )
    _create_visit(
        db_session,
        patient.id,
        admin_user.id,
        target_date,
        source="DOCTOR",
        referrer_name="Dr. Gupta",
    )
    _create_visit(db_session, patient.id, admin_user.id, target_date, source=None)

    # Filter source=DOCTOR
    resp = client.get(
        "/api/reports/referrals",
        params={
            "date_from": "2026-11-01",
            "date_to": "2026-11-30",
            "source": "DOCTOR",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_visits"] == 2
    assert all(r["source"] == "DOCTOR" for r in data["rows"])

    # Filter case-insensitive: source=doctor
    resp_lower = client.get(
        "/api/reports/referrals",
        params={
            "date_from": "2026-11-01",
            "date_to": "2026-11-30",
            "source": "doctor",
        },
    )
    assert resp_lower.status_code == 200
    assert resp_lower.json()["total_visits"] == 2

    # Filter source=NOT_RECORDED
    resp_nr = client.get(
        "/api/reports/referrals",
        params={
            "date_from": "2026-11-01",
            "date_to": "2026-11-30",
            "source": "NOT_RECORDED",
        },
    )
    assert resp_nr.status_code == 200
    data_nr = resp_nr.json()
    assert data_nr["total_visits"] == 1
    assert data_nr["rows"] == [
        {"source": "NOT_RECORDED", "referrer_name": None, "visit_count": 1}
    ]


def test_referral_report_referrer_substring_filter(
    app,
    db_session: Session,
    admin_user,
    login_client,
) -> None:
    client = login_client(admin_user)
    patient = _create_patient(db_session, "003")
    target_date = date(2026, 11, 12)

    _create_visit(
        db_session,
        patient.id,
        admin_user.id,
        target_date,
        source="DOCTOR",
        referrer_name="Dr. Sharma Clinic",
    )
    _create_visit(
        db_session,
        patient.id,
        admin_user.id,
        target_date,
        source="DOCTOR",
        referrer_name="Dr Sharma",
    )
    _create_visit(
        db_session,
        patient.id,
        admin_user.id,
        target_date,
        source="PERSONAL",
        referrer_name="Sharma Ji Friend",
    )
    _create_visit(
        db_session,
        patient.id,
        admin_user.id,
        target_date,
        source="ORGANIZATION",
        referrer_name="Red Cross Society",
    )

    # Substring filter on referrer (case-insensitive: "sharma")
    resp = client.get(
        "/api/reports/referrals",
        params={
            "date_from": "2026-11-01",
            "date_to": "2026-11-30",
            "referrer": "sharma",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_visits"] == 3
    names = {r["referrer_name"] for r in data["rows"]}
    assert names == {"Dr. Sharma Clinic", "Dr Sharma", "Sharma Ji Friend"}

    # Combined filter: source=DOCTOR and referrer=sharma
    resp_comb = client.get(
        "/api/reports/referrals",
        params={
            "date_from": "2026-11-01",
            "date_to": "2026-11-30",
            "source": "DOCTOR",
            "referrer": "sharma",
        },
    )
    assert resp_comb.status_code == 200
    data_comb = resp_comb.json()
    assert data_comb["total_visits"] == 2
    names_comb = {r["referrer_name"] for r in data_comb["rows"]}
    assert names_comb == {"Dr. Sharma Clinic", "Dr Sharma"}

    # No match
    resp_none = client.get(
        "/api/reports/referrals",
        params={
            "date_from": "2026-11-01",
            "date_to": "2026-11-30",
            "referrer": "NonexistentReferrer",
        },
    )
    assert resp_none.status_code == 200
    data_none = resp_none.json()
    assert data_none["total_visits"] == 0
    assert data_none["rows"] == []


def test_referral_report_date_validation(
    app,
    admin_user,
    login_client,
) -> None:
    client = login_client(admin_user)

    # date_from > date_to -> 422
    resp_inverted = client.get(
        "/api/reports/referrals",
        params={"date_from": "2026-11-30", "date_to": "2026-11-01"},
    )
    assert resp_inverted.status_code == 422
    assert "date_from must not be after date_to" in resp_inverted.text

    # Missing date_from
    resp_no_from = client.get(
        "/api/reports/referrals",
        params={"date_to": "2026-11-30"},
    )
    assert resp_no_from.status_code == 422

    # Missing date_to
    resp_no_to = client.get(
        "/api/reports/referrals",
        params={"date_from": "2026-11-01"},
    )
    assert resp_no_to.status_code == 422


def test_referral_report_rbac_authorisation(
    app,
    admin_user,
    reception_user,
    doctor_a_user,
    login_client,
) -> None:
    admin_client = login_client(admin_user)
    reception_client = login_client(reception_user)
    doctor_client = login_client(doctor_a_user)
    anon_client = TestClient(
        app,
        base_url="http://testserver",
        headers={"Origin": "http://testserver"},
    )

    params = {"date_from": "2026-11-01", "date_to": "2026-11-30"}

    # Admin: 200
    resp_admin = admin_client.get("/api/reports/referrals", params=params)
    assert resp_admin.status_code == 200

    # Reception: 403
    resp_reception = reception_client.get("/api/reports/referrals", params=params)
    assert resp_reception.status_code == 403

    # Doctor: 403
    resp_doctor = doctor_client.get("/api/reports/referrals", params=params)
    assert resp_doctor.status_code == 403

    # Anonymous: 401
    resp_anon = anon_client.get("/api/reports/referrals", params=params)
    assert resp_anon.status_code == 401
