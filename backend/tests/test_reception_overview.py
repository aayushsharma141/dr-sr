"""Tests for the Reception Dashboard overview endpoint (GET /api/reception/overview)."""

from datetime import timedelta
from decimal import Decimal
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from kalyan_api import clock
from kalyan_api.models import (
    Appointment,
    BillItem,
    BillItemCategory,
    BillItemSource,
    ConsultationStatus,
    Patient,
    PriorityLevel,
    User,
    Visit,
    VisitStatus,
)

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
    assert (
        after["appointments_today"]["ARRIVED"] - before["appointments_today"].get("ARRIVED", 0) == 1
    )


def test_reception_overview_includes_closed_visit_dues_and_alert(
    login_client: Any,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Closed visits with unpaid balances are reflected in outstanding_dues_paise and pending_dues alert."""
    rec_c = login_client(reception_user)
    before = rec_c.get(OVERVIEW).json()

    today = clock.ist_today()
    patient = _patient(db_session, "02")
    visit = Visit(
        patient_id=patient.id,
        visit_date=today,
        status=VisitStatus.CLOSED.value,
        closed_by_user_id=reception_user.id,
        closed_at=clock.utcnow(),
        close_reason="Will pay tomorrow",
        opened_by_user_id=reception_user.id,
    )
    db_session.add(visit)
    db_session.flush()

    appt = Appointment(
        patient_id=patient.id,
        doctor_id=doctor_a_user.doctor_id,
        appointment_date=today,
        token_number=801,
        status="ARRIVED",
        consultation_status=ConsultationStatus.COMPLETED.value,
        visit_id=visit.id,
        created_by_user_id=reception_user.id,
    )
    db_session.add(appt)
    db_session.flush()

    fee_paise = 35000
    db_session.add(
        BillItem(
            visit_id=visit.id,
            patient_id=patient.id,
            appointment_id=appt.id,
            category=BillItemCategory.CONSULTATION.value,
            source=BillItemSource.SYSTEM.value,
            description="Consultation fee",
            quantity=Decimal("1"),
            rate_paise=fee_paise,
            original_amount_paise=fee_paise,
            amount_paise=fee_paise,
            created_by_user_id=reception_user.id,
        )
    )
    db_session.flush()

    after = rec_c.get(OVERVIEW).json()
    assert after["outstanding_dues_paise"] - before["outstanding_dues_paise"] == fee_paise
    dues_alerts = [a for a in after["alerts"] if a["code"] == "pending_dues"]
    assert len(dues_alerts) == 1


def test_reception_overview_doctors_today_next_token_respects_od_22_07_priority(
    login_client: Any,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """doctors_today.next_token follows OD-22-07 order (EMERGENCY -> PRIORITY -> NORMAL) and ignores non-waiting."""
    rec_c = login_client(reception_user)
    today = clock.ist_today()
    now = clock.utcnow()

    p_in_consult = _patient(db_session, "10")
    p_normal = _patient(db_session, "11")
    p_priority = _patient(db_session, "12")
    p_emergency_later = _patient(db_session, "13")
    p_emergency_earlier = _patient(db_session, "14")

    # Token 1 is already IN_CONSULTATION (even though status is ARRIVED) — must be ignored.
    db_session.add_all(
        [
            Appointment(
                patient_id=p_in_consult.id,
                doctor_id=doctor_a_user.doctor_id,
                appointment_date=today,
                token_number=1,
                status="ARRIVED",
                consultation_status=ConsultationStatus.IN_CONSULTATION.value,
                priority_level=PriorityLevel.EMERGENCY.value,
                priority_reason="Acute chest pain",
                priority_updated_at=now - timedelta(minutes=20),
                created_by_user_id=reception_user.id,
            ),
            Appointment(
                patient_id=p_normal.id,
                doctor_id=doctor_a_user.doctor_id,
                appointment_date=today,
                token_number=2,
                status="ARRIVED",
                consultation_status=ConsultationStatus.WAITING.value,
                priority_level=PriorityLevel.NORMAL.value,
                created_by_user_id=reception_user.id,
            ),
            Appointment(
                patient_id=p_priority.id,
                doctor_id=doctor_a_user.doctor_id,
                appointment_date=today,
                token_number=3,
                status="ARRIVED",
                consultation_status=ConsultationStatus.WAITING.value,
                priority_level=PriorityLevel.PRIORITY.value,
                priority_reason="Senior citizen",
                priority_updated_at=now - timedelta(minutes=15),
                created_by_user_id=reception_user.id,
            ),
            Appointment(
                patient_id=p_emergency_later.id,
                doctor_id=doctor_a_user.doctor_id,
                appointment_date=today,
                token_number=4,
                status="ARRIVED",
                consultation_status=ConsultationStatus.WAITING.value,
                priority_level=PriorityLevel.EMERGENCY.value,
                priority_reason="High fever",
                priority_updated_at=now - timedelta(minutes=5),
                created_by_user_id=reception_user.id,
            ),
            Appointment(
                patient_id=p_emergency_earlier.id,
                doctor_id=doctor_a_user.doctor_id,
                appointment_date=today,
                token_number=5,
                status="ARRIVED",
                consultation_status=ConsultationStatus.WAITING.value,
                priority_level=PriorityLevel.EMERGENCY.value,
                priority_reason="Severe trauma",
                priority_updated_at=now - timedelta(minutes=10),
                created_by_user_id=reception_user.id,
            ),
        ]
    )
    db_session.flush()

    overview = rec_c.get(OVERVIEW).json()
    doc_row = next(d for d in overview["doctors_today"] if d["doctor_id"] == doctor_a_user.doctor_id)
    # Earlier-classified EMERGENCY (token 5) beats later-classified EMERGENCY (token 4), PRIORITY (3), NORMAL (2)
    assert doc_row["next_token"] == 5
