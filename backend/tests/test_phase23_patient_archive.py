"""Tests for Phase 23 Filtered Bulk Archival and Hard Financial Dues Guard."""

from datetime import date, timedelta
from decimal import Decimal
import pytest
from sqlalchemy import select

from kalyan_api import clock
from kalyan_api.models import (
    Appointment,
    AppointmentStatus,
    BillItem,
    BillItemCategory,
    BillItemSource,
    Department,
    Doctor,
    Patient,
    Payment,
    PaymentMethod,
    Visit,
    VisitStatus,
)


def _create_old_patient(
    db_session,
    urn: str,
    name: str,
    mobile: str = "9812345678",
    years_ago: int = 4,
    district: str = "Bhojpur",
) -> Patient:
    old_date = clock.utcnow() - timedelta(days=years_ago * 365)
    patient = Patient(
        urn=urn,
        full_name=name,
        guardian_name="Guardian",
        gender="M",
        age_years=40,
        mobile=mobile,
        address="Rural Area, Ara",
        district=district,
        state="Bihar",
        is_active=True,
        is_archived=False,
        created_at=old_date,
    )
    db_session.add(patient)
    db_session.flush()
    return patient


def test_archival_candidate_detection(login_client, admin_user, db_session):
    client = login_client(admin_user)

    # 1. Patient created 4 years ago, no visits -> candidate
    p_old = _create_old_patient(db_session, "URN-ARCH-01", "Rameshwar Singh", mobile="9811100011", years_ago=4)
    # 2. Patient created recently -> not candidate
    p_new = _create_old_patient(db_session, "URN-ARCH-02", "Deepak Verma", mobile="9811100022", years_ago=0)
    db_session.commit()

    resp = client.get("/api/admin/patients/archival-candidates?inactivity_years=3")
    assert resp.status_code == 200, resp.text
    candidates = resp.json()
    candidate_ids = [c["patient"]["id"] for c in candidates]
    assert p_old.id in candidate_ids
    assert p_new.id not in candidate_ids


def test_financial_dues_guard_blocks_archival(login_client, admin_user, reception_user, db_session):
    client = login_client(admin_user)

    dept = Department(name_en="General Medicine", code="GM-03", is_active=True)
    db_session.add(dept)
    db_session.flush()

    doctor = Doctor(name_en="Dr. DuesGuard", cabin_code="D", is_active=True)
    doctor.departments.append(dept)
    db_session.add(doctor)
    db_session.flush()

    p_due = _create_old_patient(db_session, "URN-ARCH-DUE", "Shyam Lal", mobile="9811100033", years_ago=4)

    # Create closed visit with unpaid 500.00 Rs consultation
    v = Visit(
        patient_id=p_due.id,
        visit_date=date(2022, 1, 1),
        status=VisitStatus.CLOSED.value,
        opened_by_user_id=reception_user.id,
        closed_by_user_id=reception_user.id,
        closed_at=clock.utcnow() - timedelta(days=4 * 365),
    )
    db_session.add(v)
    db_session.flush()

    appt = Appointment(
        patient_id=p_due.id,
        doctor_id=doctor.id,
        department_id=dept.id,
        appointment_date=date(2022, 1, 1),
        token_number=1,
        status=AppointmentStatus.DONE.value,
        consultation_status="COMPLETED",
        visit_id=v.id,
        created_by_user_id=reception_user.id,
    )
    db_session.add(appt)
    db_session.flush()

    line = BillItem(
        visit_id=v.id,
        patient_id=p_due.id,
        appointment_id=appt.id,
        category=BillItemCategory.CONSULTATION.value,
        source=BillItemSource.SYSTEM.value,
        description="Consultation fee",
        quantity=Decimal("1"),
        rate_paise=50000,
        original_amount_paise=50000,
        amount_paise=50000,
        created_by_user_id=reception_user.id,
    )
    db_session.add(line)
    db_session.commit()

    # 1. Candidate endpoint must mark can_archive=False with dues warning
    resp_cand = client.get("/api/admin/patients/archival-candidates?inactivity_years=3")
    assert resp_cand.status_code == 200, resp_cand.text
    cand = next((c for c in resp_cand.json() if c["patient"]["id"] == p_due.id), None)
    assert cand is not None
    assert cand["can_archive"] is False
    assert cand["total_dues_paise"] == 50000
    assert "outstanding dues" in cand["blocking_reason"].lower()

    # 2. Bulk archive attempt MUST fail closed with HTTP 400 patient_has_outstanding_dues
    resp_arch = client.post(
        "/api/admin/patients/bulk-archive",
        json={"patient_ids": [p_due.id], "reason": "Attempting to archive patient with dues"},
    )
    assert resp_arch.status_code == 400
    err = resp_arch.json()
    assert err["code"] == "patient_has_outstanding_dues"
    assert "outstanding dues" in err["message"].lower()

    # Settle dues via payment
    pay = Payment(
        receipt_number="RCP-ARCH-SETTLE",
        patient_id=p_due.id,
        appointment_id=None,
        visit_id=v.id,
        amount_paise=50000,
        payment_method=PaymentMethod.CASH.value,
        is_reversed=False,
        created_by_user_id=reception_user.id,
    )
    db_session.add(pay)
    db_session.commit()

    # Archival should now succeed
    resp_ok = client.post(
        "/api/admin/patients/bulk-archive",
        json={"patient_ids": [p_due.id], "reason": "Archival after debt settlement"},
    )
    assert resp_ok.status_code == 200, resp_ok.text
    db_session.refresh(p_due)
    assert p_due.is_archived is True
    assert p_due.archive_reason == "Archival after debt settlement"


def test_open_visit_blocks_archival(login_client, admin_user, reception_user, db_session):
    client = login_client(admin_user)

    p_open = _create_old_patient(db_session, "URN-ARCH-OPEN", "Gopal Das", mobile="9811100044", years_ago=4)
    v_open = Visit(
        patient_id=p_open.id,
        visit_date=date.today(),
        status=VisitStatus.OPEN.value,
        opened_by_user_id=reception_user.id,
    )
    db_session.add(v_open)
    db_session.commit()

    resp_arch = client.post(
        "/api/admin/patients/bulk-archive",
        json={"patient_ids": [p_open.id], "reason": "Attempting archive with open visit"},
    )
    assert resp_arch.status_code == 400
    assert resp_arch.json()["code"] == "open_visit_conflict"


def test_unarchive_restores_patient(login_client, admin_user, db_session):
    client = login_client(admin_user)

    p = _create_old_patient(db_session, "URN-ARCH-UN", "Manoj Tiwari", mobile="9811100055", years_ago=5)
    db_session.commit()

    # Archive
    client.post(
        "/api/admin/patients/bulk-archive",
        json={"patient_ids": [p.id], "reason": "Inactive record cleanup"},
    )
    db_session.refresh(p)
    assert p.is_archived is True

    # Unarchive
    resp = client.post(
        f"/api/admin/patients/{p.id}/unarchive",
        json={"reason": "Patient returned for fresh consultation"},
    )
    assert resp.status_code == 200, resp.text
    db_session.refresh(p)
    assert p.is_archived is False
    assert p.archive_reason is None


def test_rbac_reception_cannot_archive(login_client, reception_user, db_session):
    client = login_client(reception_user)

    resp_get = client.get("/api/admin/patients/archival-candidates")
    assert resp_get.status_code == 403

    resp_post = client.post(
        "/api/admin/patients/bulk-archive",
        json={"patient_ids": [1], "reason": "Reception test"},
    )
    assert resp_post.status_code == 403
