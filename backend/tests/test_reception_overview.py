"""Tests for the Reception Dashboard overview endpoint (GET /api/reception/overview)."""

from datetime import timedelta
from typing import Any
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from kalyan_api import clock
from kalyan_api.models import Appointment, Patient, User

OVERVIEW = "/api/reception/overview"


def _patient(session: Session, suffix: str) -> Patient:
    p = Patient(
        urn=f"KH-2096-REC{suffix}",
        full_name=f"Patient {suffix}",
        guardian_name="Guardian",
        gender="M",
        age_years=30,
        mobile=f"987654{suffix}",
        address="Test Colony",
    )
    session.add(p)
    session.flush()
    return p


def test_reception_overview_rbac(
    client: TestClient,
    login_client: Any,
    reception_user: User,
    doctor_a_user: User,
    admin_user: User,
) -> None:
    # 1. Anonymous forbidden
    assert client.get(OVERVIEW).status_code == 401
    # 2. Doctor role lacks DASHBOARD_RECEPTION
    assert login_client(doctor_a_user).get(OVERVIEW).status_code == 403
    # 3. Reception role has DASHBOARD_RECEPTION
    assert login_client(reception_user).get(OVERVIEW).status_code == 200
    # 4. Admin role is isolated to admin dashboard (lacks DASHBOARD_RECEPTION)
    assert login_client(admin_user).get(OVERVIEW).status_code == 403


def test_reception_overview_shape_and_metrics(
    login_client: Any,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    rec_c = login_client(reception_user)
    before = rec_c.get(OVERVIEW).json()

    assert before["area"] == "reception"
    assert before["role"] == "RECEPTION"
    assert before["business_date"] == clock.ist_today().isoformat()
    assert "registrations_today" in before
    assert "appointments_today" in before
    assert "doctors_today" in before
    assert "collections_today" in before
    assert "outstanding_dues_paise" in before
    assert "hourly_collections" in before
    assert "alerts" in before

    today = clock.ist_today()
    p = _patient(db_session, "01")
    db_session.add(
        Appointment(
            patient_id=p.id,
            doctor_id=doctor_a_user.doctor_id,
            appointment_date=today,
            token_number=777,
            status="ARRIVED",
            created_by_user_id=reception_user.id,
        )
    )
    db_session.flush()

    after = rec_c.get(OVERVIEW).json()
    assert after["registrations_today"] - before["registrations_today"] == 1
    assert after["appointments_today"]["ARRIVED"] - before["appointments_today"].get("ARRIVED", 0) == 1
