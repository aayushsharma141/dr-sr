"""Tests for Phase 23 Patient Consolidation (Timeline, Visits, Dues, and Check-in Guards)."""

from datetime import date
from decimal import Decimal
import pytest
from sqlalchemy import select

from kalyan_api import clock
from kalyan_api.models import (
    Appointment,
    AppointmentSource,
    AppointmentStatus,
    BillItem,
    BillItemCategory,
    BillItemSource,
    ClinicalEncounter,
    Department,
    Doctor,
    Patient,
    Payment,
    PaymentMethod,
    Visit,
    VisitStatus,
)
from kalyan_api.services import billing_service


def _create_test_patient(
    db_session,
    urn: str,
    name: str,
    mobile: str = "9876543210",
) -> Patient:
    patient = Patient(
        urn=urn,
        full_name=name,
        guardian_name="Guardian Name",
        gender="M",
        age_years=30,
        mobile=mobile,
        address="Test Address, Ara",
        district="Bhojpur",
        state="Bihar",
        is_active=True,
    )
    db_session.add(patient)
    db_session.flush()
    return patient


def test_timeline_and_visits_consolidation(login_client, admin_user, reception_user, db_session):
    client = login_client(admin_user)

    # 1. Setup Doctor & Department
    dept = Department(name_en="General Medicine", code="GM-01", is_active=True)
    db_session.add(dept)
    db_session.flush()

    doctor = Doctor(
        name_en="Dr. Sharma",
        cabin_code="A",
        default_fee_paise=30000,
        is_active=True,
    )
    doctor.departments.append(dept)
    db_session.add(doctor)
    db_session.flush()

    # 2. Setup Master (p1) and Secondary (p2) patients
    p1 = _create_test_patient(db_session, "URN-CONS-01", "Ravi Kumar", mobile="9800011122")
    p2 = _create_test_patient(db_session, "URN-CONS-02", "Ravi Kumar", mobile="9800011122")

    # 3. Create historical visit, appointment, and payment on p2
    v2 = Visit(
        patient_id=p2.id,
        visit_date=date(2026, 1, 10),
        status=VisitStatus.CLOSED.value,
        opened_by_user_id=reception_user.id,
        closed_by_user_id=reception_user.id,
        closed_at=clock.utcnow(),
    )
    db_session.add(v2)
    db_session.flush()

    appt2 = Appointment(
        patient_id=p2.id,
        doctor_id=doctor.id,
        department_id=dept.id,
        appointment_date=date(2026, 1, 10),
        token_number=1,
        status=AppointmentStatus.DONE.value,
        consultation_status="COMPLETED",
        visit_id=v2.id,
        created_by_user_id=reception_user.id,
    )
    db_session.add(appt2)
    db_session.flush()

    line2 = BillItem(
        visit_id=v2.id,
        patient_id=p2.id,
        appointment_id=appt2.id,
        category=BillItemCategory.CONSULTATION.value,
        source=BillItemSource.SYSTEM.value,
        description="Consultation fee",
        quantity=Decimal("1"),
        rate_paise=30000,
        original_amount_paise=30000,
        amount_paise=30000,
        created_by_user_id=reception_user.id,
    )
    db_session.add(line2)

    pay2 = Payment(
        receipt_number="RCP-CONS-002",
        patient_id=p2.id,
        appointment_id=None,
        visit_id=v2.id,
        amount_paise=30000,
        payment_method=PaymentMethod.CASH.value,
        is_reversed=False,
        created_by_user_id=reception_user.id,
    )
    db_session.add(pay2)

    # Also add a visit and payment on p1
    v1 = Visit(
        patient_id=p1.id,
        visit_date=date(2026, 2, 1),
        status=VisitStatus.CLOSED.value,
        opened_by_user_id=reception_user.id,
        closed_by_user_id=reception_user.id,
        closed_at=clock.utcnow(),
    )
    db_session.add(v1)
    db_session.flush()

    appt1 = Appointment(
        patient_id=p1.id,
        doctor_id=doctor.id,
        department_id=dept.id,
        appointment_date=date(2026, 2, 1),
        token_number=2,
        status=AppointmentStatus.DONE.value,
        consultation_status="COMPLETED",
        visit_id=v1.id,
        created_by_user_id=reception_user.id,
    )
    db_session.add(appt1)
    db_session.flush()

    line1 = BillItem(
        visit_id=v1.id,
        patient_id=p1.id,
        appointment_id=appt1.id,
        category=BillItemCategory.CONSULTATION.value,
        source=BillItemSource.SYSTEM.value,
        description="Consultation fee",
        quantity=Decimal("1"),
        rate_paise=30000,
        original_amount_paise=30000,
        amount_paise=30000,
        created_by_user_id=reception_user.id,
    )
    db_session.add(line1)

    db_session.commit()

    # 4. Perform alias-pointer merge: p2 -> p1
    merge_resp = client.post(
        "/api/admin/patients/merge",
        json={
            "master_patient_id": p1.id,
            "secondary_patient_id": p2.id,
            "reason": "Duplicate registration consolidated",
        },
    )
    assert merge_resp.status_code == 200, merge_resp.text

    # 5. Verify Timeline on Master (p1) includes both p1 and p2 items
    t_resp = client.get(f"/api/patients/{p1.id}/timeline")
    assert t_resp.status_code == 200, t_resp.text
    timeline = t_resp.json()
    item_ids = [item["id"] for item in timeline]
    assert f"APPOINTMENT-{appt1.id}" in item_ids
    assert f"APPOINTMENT-{appt2.id}" in item_ids
    assert f"PAYMENT-{pay2.id}" in item_ids

    # 6. Verify Visits list with patient_id=p1.id returns visits from p1 and p2
    v_resp = client.get(f"/api/visits?patient_id={p1.id}")
    assert v_resp.status_code == 200, v_resp.text
    visit_ids = [item["id"] for item in v_resp.json()["visits"]]
    assert v1.id in visit_ids
    assert v2.id in visit_ids


def test_patient_detail_merged_urn(login_client, admin_user, db_session):
    client = login_client(admin_user)

    p1 = _create_test_patient(db_session, "URN-URN-01", "Sunita Devi", mobile="9811199988")
    p2 = _create_test_patient(db_session, "URN-URN-02", "Sunita Devi", mobile="9811199988")
    db_session.commit()

    # Merge p2 into p1
    client.post(
        "/api/admin/patients/merge",
        json={
            "master_patient_id": p1.id,
            "secondary_patient_id": p2.id,
            "reason": "Administrative merge",
        },
    )

    # GET /patients/{id} on p2 must return merged_into_id and merged_into_urn
    resp = client.get(f"/api/patients/{p2.id}")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["is_active"] is False
    assert data["merged_into_id"] == p1.id
    assert data["merged_into_urn"] == p1.urn

    # Search patients matching mobile must populate merged_into_urn
    search_resp = client.get(f"/api/patients?q=9811199988")
    assert search_resp.status_code == 200, search_resp.text
    s_items = search_resp.json()
    p2_result = next((item for item in s_items if item["id"] == p2.id), None)
    assert p2_result is not None
    assert p2_result["merged_into_urn"] == p1.urn


def test_checkin_and_booking_blocked_for_merged_patient(
    login_client, reception_user, admin_user, db_session
):
    reception_client = login_client(reception_user)
    admin_client = login_client(admin_user)

    dept = Department(name_en="General Medicine", code="GM-02", is_active=True)
    db_session.add(dept)
    db_session.flush()

    doctor = Doctor(name_en="Dr. Verma", cabin_code="B", is_active=True)
    doctor.departments.append(dept)
    db_session.add(doctor)
    db_session.flush()

    p1 = _create_test_patient(db_session, "URN-BLK-01", "Amit Patel", mobile="9877766655")
    p2 = _create_test_patient(db_session, "URN-BLK-02", "Amit Patel", mobile="9877766655")
    db_session.commit()

    # Merge p2 into p1
    admin_client.post(
        "/api/admin/patients/merge",
        json={
            "master_patient_id": p1.id,
            "secondary_patient_id": p2.id,
            "reason": "Consolidated record",
        },
    )

    # 1. Attempt advance booking on merged p2 -> MUST FAIL 400 patient_inactive_or_merged
    resp_book = reception_client.post(
        "/api/appointments",
        json={
            "patient_id": p2.id,
            "doctor_id": doctor.id,
            "department_id": dept.id,
            "appointment_date": str(date.today()),
        },
    )
    assert resp_book.status_code == 400
    assert resp_book.json()["code"] == "patient_inactive_or_merged"

    # 2. Attempt walk-in check-in on merged p2 -> MUST FAIL 400 patient_inactive_or_merged
    resp_walkin = reception_client.post(
        "/api/appointments/walk-in",
        json={
            "patient_id": p2.id,
            "doctor_id": doctor.id,
            "department_id": dept.id,
            "referral_source": "SELF",
        },
    )
    assert resp_walkin.status_code == 400
    assert resp_walkin.json()["code"] == "patient_inactive_or_merged"


def test_previous_dues_consolidation_from_merged_patient(
    login_client, admin_user, reception_user, db_session
):
    client = login_client(admin_user)

    dept = Department(name_en="Orthopedics", code="ORTHO-01", is_active=True)
    db_session.add(dept)
    db_session.flush()

    doctor = Doctor(name_en="Dr. Dues", cabin_code="C", is_active=True)
    doctor.departments.append(dept)
    db_session.add(doctor)
    db_session.flush()

    p1 = _create_test_patient(db_session, "URN-DUE-01", "Karan Johar", mobile="9866655544")
    p2 = _create_test_patient(db_session, "URN-DUE-02", "Karan Johar", mobile="9866655544")

    # Create visit on p2 with unpaid consultation dues (rate 50000, paid 0)
    v2 = Visit(
        patient_id=p2.id,
        visit_date=date(2026, 1, 5),
        status=VisitStatus.CLOSED.value,
        opened_by_user_id=reception_user.id,
        closed_by_user_id=reception_user.id,
        closed_at=clock.utcnow(),
    )
    db_session.add(v2)
    db_session.flush()

    appt2 = Appointment(
        patient_id=p2.id,
        doctor_id=doctor.id,
        department_id=dept.id,
        appointment_date=date(2026, 1, 5),
        token_number=1,
        status=AppointmentStatus.DONE.value,
        consultation_status="COMPLETED",
        visit_id=v2.id,
        created_by_user_id=reception_user.id,
    )
    db_session.add(appt2)
    db_session.flush()

    line2 = BillItem(
        visit_id=v2.id,
        patient_id=p2.id,
        appointment_id=appt2.id,
        category=BillItemCategory.CONSULTATION.value,
        source=BillItemSource.SYSTEM.value,
        description="Consultation fee",
        quantity=Decimal("1"),
        rate_paise=50000,
        original_amount_paise=50000,
        amount_paise=50000,
        created_by_user_id=reception_user.id,
    )
    db_session.add(line2)
    db_session.commit()

    # Before merge: p1 has 0 previous dues
    dues_before = billing_service.patient_previous_dues(db_session, p1.id)
    assert len(dues_before) == 0

    # Merge p2 into p1
    client.post(
        "/api/admin/patients/merge",
        json={
            "master_patient_id": p1.id,
            "secondary_patient_id": p2.id,
            "reason": "Dues consolidation test",
        },
    )

    # After merge: p1's previous dues include p2's unpaid visit!
    dues_after = billing_service.patient_previous_dues(db_session, p1.id)
    assert len(dues_after) == 1
    assert dues_after[0].visit_id == v2.id
    assert dues_after[0].due_paise == 50000

