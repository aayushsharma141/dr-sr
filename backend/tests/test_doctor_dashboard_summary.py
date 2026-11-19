"""Comprehensive tests for GET /api/doctor/dashboard/summary.

Verifies:
1. Doctor Scoping: Doctor A only sees Doctor A's metrics; Doctor B only sees Doctor B's metrics.
2. Doctor Without ID Guard: A doctor user with doctor_id=None receives 403 Forbidden.
3. Status Predicate Alignment: Statuses strictly adhere to appointments.py:1256-1275.
4. Mathematical Reconciliation & No Double Counting:
   Encounter linked to active IN_CONSULTATION appointment is not double-counted in pending drafts.
   Total = completed + in_progress + pending.
5. RBAC & Authorization: Anonymous gets 401; Reception and Admin get 403; Doctor gets 200.
"""

import uuid
from datetime import datetime
from typing import Any

import pytest
from sqlalchemy.orm import Session

from kalyan_api import clock
from kalyan_api.core.permissions import Role
from kalyan_api.models import (
    Appointment,
    AppointmentStatus,
    ClinicalEncounter,
    ConsultationStatus,
    Patient,
    PriorityLevel,
    User,
)


def _make_patient(session: Session, name_suffix: str = "") -> Patient:
    patient = Patient(
        urn=f"KH-2026-T-{uuid.uuid4().hex[:6].upper()}",
        full_name=f"Test Patient {name_suffix}".strip(),
        guardian_name="Guardian",
        gender="M",
        age_years=35,
        mobile="9876543210",
        address="Bhojpur, Bihar",
    )
    session.add(patient)
    session.flush()
    return patient


def _make_appointment(
    session: Session,
    patient_id: int,
    doctor_id: int,
    status: AppointmentStatus,
    consultation_status: ConsultationStatus | None = None,
    created_by_user_id: int = 1,
) -> Appointment:
    now = datetime.now(clock.IST)
    appt = Appointment(
        patient_id=patient_id,
        doctor_id=doctor_id,
        appointment_date=clock.ist_today(),
        status=status.value,
        consultation_status=consultation_status.value if consultation_status else None,
        status_updated_at=now,
        priority_level=PriorityLevel.NORMAL.value,
        created_by_user_id=created_by_user_id,
    )
    session.add(appt)
    session.flush()
    return appt


def _make_encounter(
    session: Session,
    patient_id: int,
    doctor_id: int,
    is_finalised: bool = False,
    appointment_id: int | None = None,
    created_by_user_id: int = 1,
) -> ClinicalEncounter:
    now = datetime.now(clock.IST)
    encounter = ClinicalEncounter(
        encounter_code=f"ENC-{uuid.uuid4().hex[:8].upper()}",
        patient_id=patient_id,
        doctor_id=doctor_id,
        appointment_id=appointment_id,
        encounter_date=clock.ist_today(),
        is_finalised=is_finalised,
        finalised_at=now if is_finalised else None,
        created_by_user_id=created_by_user_id,
    )
    session.add(encounter)
    session.flush()
    return encounter


def test_doctor_dashboard_summary_scoping(
    login_client: Any,
    doctor_a_user: User,
    doctor_b_user: User,
    db_session: Session,
) -> None:
    """Doctor A and Doctor B see isolated, accurate workload counts."""
    p1 = _make_patient(db_session, "P1")
    p2 = _make_patient(db_session, "P2")
    p3 = _make_patient(db_session, "P3")
    p4 = _make_patient(db_session, "P4")
    p5 = _make_patient(db_session, "P5")

    # Doctor A appointments:
    # 1 waiting
    _make_appointment(
        db_session,
        p1.id,
        doctor_a_user.doctor_id,
        AppointmentStatus.WAITING,
        ConsultationStatus.WAITING,
        created_by_user_id=doctor_a_user.id,
    )
    # 1 in consultation
    _make_appointment(
        db_session,
        p2.id,
        doctor_a_user.doctor_id,
        AppointmentStatus.IN_CONSULTATION,
        ConsultationStatus.IN_CONSULTATION,
        created_by_user_id=doctor_a_user.id,
    )
    # 1 scheduled (booked)
    _make_appointment(
        db_session,
        p3.id,
        doctor_a_user.doctor_id,
        AppointmentStatus.BOOKED,
        created_by_user_id=doctor_a_user.id,
    )
    # 1 completed
    _make_appointment(
        db_session,
        p4.id,
        doctor_a_user.doctor_id,
        AppointmentStatus.COMPLETED,
        ConsultationStatus.COMPLETED,
        created_by_user_id=doctor_a_user.id,
    )
    # 1 unfinalised encounter not tied to the in-consultation appointment
    _make_encounter(
        db_session,
        p5.id,
        doctor_a_user.doctor_id,
        is_finalised=False,
        created_by_user_id=doctor_a_user.id,
    )

    # Doctor B appointments:
    # 2 waiting
    _make_appointment(
        db_session,
        p1.id,
        doctor_b_user.doctor_id,
        AppointmentStatus.ARRIVED,
        ConsultationStatus.WAITING,
        created_by_user_id=doctor_b_user.id,
    )
    _make_appointment(
        db_session,
        p2.id,
        doctor_b_user.doctor_id,
        AppointmentStatus.CHECKED_IN,
        ConsultationStatus.WAITING,
        created_by_user_id=doctor_b_user.id,
    )

    db_session.commit()

    client_a = login_client(doctor_a_user)
    resp_a = client_a.get("/api/doctor/dashboard/summary")
    assert resp_a.status_code == 200
    data_a = resp_a.json()

    assert data_a["doctor_id"] == doctor_a_user.doctor_id
    assert data_a["waiting_count"] == 1
    assert data_a["in_consultation_count"] == 1
    assert data_a["scheduled_count"] == 1
    assert data_a["completed_count"] == 1
    assert data_a["pending_drafts_count"] == 1

    glance_a = data_a["today_glance"]
    assert glance_a["completed"] == 1
    assert glance_a["in_progress"] == 1
    assert glance_a["pending"] == 1
    assert glance_a["total"] == 3
    reconciled = glance_a["completed"] + glance_a["in_progress"] + glance_a["pending"]
    assert glance_a["total"] == reconciled

    # Verify Doctor B sees only Doctor B's workload
    client_b = login_client(doctor_b_user)
    resp_b = client_b.get("/api/doctor/dashboard/summary")
    assert resp_b.status_code == 200
    data_b = resp_b.json()

    assert data_b["doctor_id"] == doctor_b_user.doctor_id
    assert data_b["waiting_count"] == 2
    assert data_b["in_consultation_count"] == 0
    assert data_b["scheduled_count"] == 0
    assert data_b["completed_count"] == 0
    assert data_b["pending_drafts_count"] == 0

    glance_b = data_b["today_glance"]
    assert glance_b["total"] == 0


def test_doctor_without_doctor_id_guard(
    db_session: Session,
) -> None:
    """A principal with role DOCTOR but doctor_id=None must receive 403 Forbidden."""
    from kalyan_api.core.errors import ApiError
    from kalyan_api.core.principal import Principal
    from kalyan_api.routers.areas import get_doctor_dashboard_summary

    fake_principal = Principal(
        user_id=9999,
        username="dr_noid",
        role=Role.DOCTOR,
        doctor_id=None,
        permissions=frozenset(),
        session_id=1,
        must_change_password=False,
    )
    with pytest.raises(ApiError) as exc_info:
        get_doctor_dashboard_summary(session=db_session, principal=fake_principal)
    assert exc_info.value.status_code == 403
    assert exc_info.value.code == "doctor_only"


def test_donut_glance_eliminates_double_counting(
    login_client: Any,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """An active encounter linked to an appointment in consultation must NOT be double-counted."""
    patient = _make_patient(db_session, "InConsult")

    appt = _make_appointment(
        db_session,
        patient.id,
        doctor_a_user.doctor_id,
        AppointmentStatus.IN_CONSULTATION,
        ConsultationStatus.IN_CONSULTATION,
        created_by_user_id=doctor_a_user.id,
    )

    # Draft encounter linked to this active appointment
    _make_encounter(
        db_session,
        patient.id,
        doctor_a_user.doctor_id,
        is_finalised=False,
        appointment_id=appt.id,
        created_by_user_id=doctor_a_user.id,
    )
    db_session.commit()

    client_a = login_client(doctor_a_user)
    resp = client_a.get("/api/doctor/dashboard/summary")
    assert resp.status_code == 200
    data = resp.json()

    assert data["in_consultation_count"] == 1
    # Draft tied to active consultation is excluded to prevent double counting
    assert data["pending_drafts_count"] == 0

    glance = data["today_glance"]
    assert glance["in_progress"] == 1
    assert glance["pending"] == 0
    assert glance["completed"] == 0
    assert glance["total"] == 1


def test_rbac_and_auth_matrix(
    client: Any,
    login_client: Any,
    doctor_a_user: User,
    reception_user: User,
    admin_user: User,
) -> None:
    """Anonymous -> 401; Reception -> 403; Admin -> 403; Doctor -> 200."""
    # 1. Anonymous
    client.headers.pop("Authorization", None)
    resp_anon = client.get("/api/doctor/dashboard/summary")
    assert resp_anon.status_code == 401

    # 2. Reception
    client_rec = login_client(reception_user)
    resp_rec = client_rec.get("/api/doctor/dashboard/summary")
    assert resp_rec.status_code == 403

    # 3. Admin
    client_admin = login_client(admin_user)
    resp_admin = client_admin.get("/api/doctor/dashboard/summary")
    assert resp_admin.status_code == 403

    # 4. Doctor
    client_doc = login_client(doctor_a_user)
    resp_doc = client_doc.get("/api/doctor/dashboard/summary")
    assert resp_doc.status_code == 200
