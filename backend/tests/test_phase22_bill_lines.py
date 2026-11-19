"""Phase 22 Bill Lines Tests (OD-22-13, OD-22-14, MED-03..06, MED-08, MED-12, BILL-18).

Tests:
1. Pure line_amount_paise calculation (OD-E whole paise round half up).
2. BillLineCreate and BillLineOut schema validations.
3. POST /api/visits/{id}/bill-items end-to-end:
   - Reception adding MEDICINE and ADDITIONAL lines (MED-04, MED-05, MED-08).
   - Row persistence, source RECEPTION, status ACTIVE, created_by user (MED-04, MED-05).
   - Balance and payment flow (visit totals update, 22-06 payment guard accepts).
   - Prescription items do not create bill lines; only reception adds (MED-03, MED-06).
   - Closed visit rejection 422 visit_closed, missing visit 404 visit_not_found (BILL-18).
   - Audit action BILL_ITEM_ADDED recorded with after data.
   - RBAC: Reception 201, Doctor 403, Admin 403, Anonymous 401.
"""

from datetime import date, datetime, timezone
from decimal import Decimal
import itertools
from typing import Any
import uuid

from fastapi.testclient import TestClient
import pytest
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from kalyan_api.models import (
    Appointment,
    AuditLog,
    BillItem,
    BillItemCategory,
    BillItemSource,
    ConsultationStatus,
    Patient,
    User,
    Visit,
    VisitStatus,
)
from kalyan_api.schemas.bill import BillLineCreate, BillLineOut
from kalyan_api.services.audit_service import AuditAction
from kalyan_api.services.bill_service import line_amount_paise

TODAY = date(2026, 11, 2)
_TOKENS = itertools.count(200)


def test_line_amount_paise_exact_and_rounding():
    # MED-05: 2 x Rs 50 (5000 paise) = Rs 100 (10000 paise)
    assert line_amount_paise(Decimal("2"), 5000) == 10000

    # 1.5 x 33 = 49.5 paise -> rounds half up to 50
    assert line_amount_paise(Decimal("1.5"), 33) == 50

    # 0.5 x 1 = 0.5 -> 1
    assert line_amount_paise(Decimal("0.5"), 1) == 1

    # 0.01 x 1 = 0.01 -> 0
    assert line_amount_paise(Decimal("0.01"), 1) == 0

    # Rate 0
    assert line_amount_paise(Decimal("3"), 0) == 0

    # Another half up: 2.5 x 5 = 12.5 -> 13
    assert line_amount_paise(Decimal("2.5"), 5) == 13


def test_bill_line_create_valid():
    med = BillLineCreate(
        category="MEDICINE",
        description="  Paracetamol 500 mg  ",
        unit="  strip  ",
        quantity=Decimal("2"),
        rate_paise=5000,
    )
    assert med.category == "MEDICINE"
    assert med.description == "Paracetamol 500 mg"
    assert med.unit == "strip"
    assert med.quantity == Decimal("2")
    assert med.rate_paise == 5000

    add = BillLineCreate(
        category="ADDITIONAL",
        description="Dressing charge",
        unit="   ",
        quantity=Decimal("1.50"),
        rate_paise=0,
    )
    assert add.category == "ADDITIONAL"
    assert add.description == "Dressing charge"
    assert add.unit is None
    assert add.rate_paise == 0


def test_bill_line_create_refusals():
    # Category not in (MEDICINE, ADDITIONAL)
    for cat in ["CONSULTATION", "PROCEDURE", "PACKAGE", "OTHER", ""]:
        with pytest.raises(ValidationError):
            BillLineCreate(
                category=cat,  # type: ignore[arg-type]
                description="Item",
                quantity=Decimal("1"),
                rate_paise=100,
            )

    # Blank or whitespace description
    for desc in ["", "   ", "\t\n"]:
        with pytest.raises(ValidationError):
            BillLineCreate(
                category="MEDICINE",
                description=desc,
                quantity=Decimal("1"),
                rate_paise=100,
            )

    # Description > 200 characters
    with pytest.raises(ValidationError):
        BillLineCreate(
            category="MEDICINE",
            description="A" * 201,
            quantity=Decimal("1"),
            rate_paise=100,
        )

    # Unit > 32 characters
    with pytest.raises(ValidationError):
        BillLineCreate(
            category="MEDICINE",
            description="Valid",
            unit="U" * 33,
            quantity=Decimal("1"),
            rate_paise=100,
        )

    # Quantity zero or negative
    with pytest.raises(ValidationError):
        BillLineCreate(
            category="MEDICINE",
            description="Valid",
            quantity=Decimal("0"),
            rate_paise=100,
        )
    with pytest.raises(ValidationError):
        BillLineCreate(
            category="MEDICINE",
            description="Valid",
            quantity=Decimal("-1"),
            rate_paise=100,
        )

    # Quantity with more than 2 decimal places
    with pytest.raises(ValidationError):
        BillLineCreate(
            category="MEDICINE",
            description="Valid",
            quantity=Decimal("1.255"),
            rate_paise=100,
        )

    # Quantity above 99999999.99
    with pytest.raises(ValidationError):
        BillLineCreate(
            category="MEDICINE",
            description="Valid",
            quantity=Decimal("100000000"),
            rate_paise=100,
        )

    # Rate negative
    with pytest.raises(ValidationError):
        BillLineCreate(
            category="MEDICINE",
            description="Valid",
            quantity=Decimal("1"),
            rate_paise=-1,
        )

    # Unknown extra field forbidden
    with pytest.raises(ValidationError):
        BillLineCreate(
            category="MEDICINE",
            description="Valid",
            quantity=Decimal("1"),
            rate_paise=100,
            extra_field="disallowed",  # type: ignore[call-arg]
        )


def _patient(db_session: Session, suffix: str) -> Patient:
    patient = Patient(
        urn=f"KH-2026-BL{suffix}",
        full_name=f"Bill Line Patient {suffix}",
        guardian_name="Guardian",
        gender="M",
        age_years=40,
        mobile="9876543111",
        address="Ara",
    )
    db_session.add(patient)
    db_session.flush()
    return patient


def _visit(
    db_session: Session,
    patient: Patient,
    user: User,
    status: str = VisitStatus.OPEN.value,
    **fields: Any,
) -> Visit:
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


def _consultation(
    db_session: Session,
    visit: Visit,
    patient: Patient,
    doctor_user: User,
    user: User,
    status: str = ConsultationStatus.COMPLETED.value,
    fee_paise: int = 50000,
) -> Appointment:
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
    line = BillItem(
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
        created_by_user_id=user.id,
    )
    db_session.add(line)
    db_session.flush()
    return appt


def test_reception_add_medicine_and_additional_lines(
    login_client: Any,
    reception_user: User,
    db_session: Session,
) -> None:
    """Reception adds medicine and additional lines (MED-04, MED-05, MED-08)."""
    client = login_client(reception_user)
    patient = _patient(db_session, "01")
    visit = _visit(db_session, patient, reception_user)

    # Add MEDICINE: 2 x Rs 50 = Rs 100 (10000 paise)
    res_med = client.post(
        f"/api/visits/{visit.id}/bill-items",
        json={
            "category": "MEDICINE",
            "description": "Paracetamol 500",
            "unit": "strip",
            "quantity": "2",
            "rate_paise": 5000,
        },
    )
    assert res_med.status_code == 201, res_med.text
    data_med = res_med.json()
    assert data_med["id"] is not None
    assert data_med["visit_id"] == visit.id
    assert data_med["appointment_id"] is None
    assert data_med["category"] == "MEDICINE"
    assert data_med["source"] == "RECEPTION"
    assert data_med["description"] == "Paracetamol 500"
    assert data_med["unit"] == "strip"
    assert Decimal(str(data_med["quantity"])) == Decimal("2")
    assert data_med["rate_paise"] == 5000
    assert data_med["amount_paise"] == 10000
    assert data_med["original_amount_paise"] == 10000
    assert data_med["status"] == "ACTIVE"
    assert data_med["created_by_user_id"] == reception_user.id
    assert data_med["created_by_username"] == reception_user.username

    # Verify persistence in DB
    db_item = db_session.get(BillItem, data_med["id"])
    assert db_item is not None
    assert db_item.category == "MEDICINE"
    assert db_item.source == "RECEPTION"
    assert db_item.status == "ACTIVE"
    assert db_item.amount_paise == 10000
    assert db_item.original_amount_paise == 10000
    assert db_item.created_by_user_id == reception_user.id

    # Add ADDITIONAL line (MED-08): Dressing, rate 1500
    res_add = client.post(
        f"/api/visits/{visit.id}/bill-items",
        json={
            "category": "ADDITIONAL",
            "description": "Dressing",
            "unit": None,
            "quantity": "1",
            "rate_paise": 1500,
        },
    )
    assert res_add.status_code == 201, res_add.text
    data_add = res_add.json()
    assert data_add["category"] == "ADDITIONAL"
    assert data_add["description"] == "Dressing"
    assert data_add["unit"] is None
    assert data_add["amount_paise"] == 1500


def test_visit_balance_and_payment_sees_new_lines(
    login_client: Any,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Visit dues include new lines, and full payment clears the balance (22-06 guard)."""
    client = login_client(reception_user)
    patient = _patient(db_session, "02")
    visit = _visit(db_session, patient, reception_user)
    _consultation(db_session, visit, patient, doctor_a_user, reception_user, fee_paise=50000)

    # Initial consultation fee: Rs 500 (50000 paise)
    res_init = client.get(f"/api/visits/{visit.id}")
    assert res_init.status_code == 200
    assert res_init.json()["outstanding_paise"] == 50000

    # Add medicine: 2 x Rs 50 = Rs 100 (10000 paise)
    res_add = client.post(
        f"/api/visits/{visit.id}/bill-items",
        json={
            "category": "MEDICINE",
            "description": "Paracetamol 500",
            "quantity": "2",
            "rate_paise": 5000,
        },
    )
    assert res_add.status_code == 201

    # Check visit outstanding is now 60,000 paise (50,000 + 10,000)
    res_after = client.get(f"/api/visits/{visit.id}")
    assert res_after.status_code == 200
    assert res_after.json()["outstanding_paise"] == 60000

    # Pay full 60,000 paise
    pay_res = client.post(
        "/api/payments",
        json={
            "patient_id": patient.id,
            "visit_id": visit.id,
            "amount_paise": 60000,
            "payment_method": "CASH",
        },
    )
    assert pay_res.status_code == 201, pay_res.text

    # Dues are now zero
    res_paid = client.get(f"/api/visits/{visit.id}")
    assert res_paid.json()["outstanding_paise"] == 0
    assert res_paid.json()["total_paid_paise"] == 60000


def test_prescription_does_not_add_bill_line_until_reception_bills(
    login_client: Any,
    reception_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Prescribing never adds a charge; only what reception enters is billed (MED-03, MED-06)."""
    doc_client = login_client(doctor_a_user)
    rec_client = login_client(reception_user)

    patient = _patient(db_session, "03")
    visit = _visit(db_session, patient, reception_user)
    _consultation(db_session, visit, patient, doctor_a_user, reception_user, fee_paise=50000)

    # Doctor prescribes 3 medicines and authorises the prescription
    rx_res = doc_client.post(
        "/api/prescriptions",
        json={
            "patient_id": patient.id,
            "diagnosis": "OPD Consultation",
            "status": "DRAFT",
            "items": [
                {"item_order": 1, "medicine_name": "Med 1", "dosage": "1", "frequency": "1-0-1", "duration_days": 5},
                {"item_order": 2, "medicine_name": "Med 2", "dosage": "1", "frequency": "1-0-1", "duration_days": 5},
                {"item_order": 3, "medicine_name": "Med 3", "dosage": "1", "frequency": "1-0-1", "duration_days": 5},
            ],
        },
    )
    assert rx_res.status_code == 201
    rx_id = rx_res.json()["id"]

    auth_res = doc_client.post(f"/api/prescriptions/{rx_id}/authorise")
    assert auth_res.status_code == 200

    # Verify visit has NO medicine bill lines (MED-03)
    med_lines = db_session.scalars(
        select(BillItem).where(
            BillItem.visit_id == visit.id,
            BillItem.category == "MEDICINE",
        )
    ).all()
    assert len(med_lines) == 0

    # Reception adds exactly one of the three medicines to the bill (MED-06)
    rec_res = rec_client.post(
        f"/api/visits/{visit.id}/bill-items",
        json={
            "category": "MEDICINE",
            "description": "Med 1",
            "quantity": "1",
            "rate_paise": 3000,
        },
    )
    assert rec_res.status_code == 201

    # Bill now has exactly 1 MEDICINE line and total reflects only it
    med_lines_after = db_session.scalars(
        select(BillItem).where(
            BillItem.visit_id == visit.id,
            BillItem.category == "MEDICINE",
        )
    ).all()
    assert len(med_lines_after) == 1
    assert med_lines_after[0].description == "Med 1"
    assert med_lines_after[0].amount_paise == 3000

    v_res = rec_client.get(f"/api/visits/{visit.id}")
    assert v_res.json()["outstanding_paise"] == 53000  # 50,000 consultation + 3,000 medicine


def test_closed_and_missing_visit_refusals(
    login_client: Any,
    reception_user: User,
    db_session: Session,
) -> None:
    """Closed visit returns 422 visit_closed; missing visit returns 404 visit_not_found (BILL-18)."""
    client = login_client(reception_user)
    patient = _patient(db_session, "04")
    closed_visit = _visit(
        db_session,
        patient,
        reception_user,
        status=VisitStatus.CLOSED.value,
        closed_by_user_id=reception_user.id,
        closed_at=datetime.now(timezone.utc),
    )

    res_closed = client.post(
        f"/api/visits/{closed_visit.id}/bill-items",
        json={
            "category": "MEDICINE",
            "description": "Paracetamol 500",
            "quantity": "1",
            "rate_paise": 2000,
        },
    )
    assert res_closed.status_code == 422, res_closed.text
    assert res_closed.json()["code"] == "visit_closed"

    res_missing = client.post(
        "/api/visits/99999999/bill-items",
        json={
            "category": "MEDICINE",
            "description": "Paracetamol 500",
            "quantity": "1",
            "rate_paise": 2000,
        },
    )
    assert res_missing.status_code == 404, res_missing.text
    assert res_missing.json()["code"] == "visit_not_found"


def test_audit_log_recorded_on_bill_item_add(
    login_client: Any,
    reception_user: User,
    db_session: Session,
) -> None:
    """An audit row BILL_ITEM_ADDED with entity bill_item, visit id, category, amount is written."""
    client = login_client(reception_user)
    patient = _patient(db_session, "05")
    visit = _visit(db_session, patient, reception_user)

    res = client.post(
        f"/api/visits/{visit.id}/bill-items",
        json={
            "category": "MEDICINE",
            "description": "Amoxicillin 500",
            "quantity": "2",
            "rate_paise": 4000,
        },
    )
    assert res.status_code == 201
    item_id = res.json()["id"]

    audit_row = db_session.execute(
        select(AuditLog).where(
            AuditLog.action == AuditAction.BILL_ITEM_ADDED.value,
            AuditLog.entity_id == str(item_id),
        )
    ).scalar_one_or_none()

    assert audit_row is not None
    assert audit_row.actor_user_id == reception_user.id
    assert audit_row.entity_type == "bill_item"
    assert audit_row.after_data["visit_id"] == visit.id
    assert audit_row.after_data["category"] == "MEDICINE"
    assert audit_row.after_data["description"] == "Amoxicillin 500"
    assert audit_row.after_data["quantity"] == "2"
    assert audit_row.after_data["amount_paise"] == 8000


def test_rbac_bill_item_endpoints(
    client: TestClient,
    login_client: Any,
    reception_user: User,
    admin_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Reception: 201; Admin: 403; Doctor: 403; Anonymous: 401."""
    patient = _patient(db_session, "06")
    visit = _visit(db_session, patient, reception_user)

    payload = {
        "category": "MEDICINE",
        "description": "RBAC Test Med",
        "quantity": "1",
        "rate_paise": 1000,
    }

    # Anonymous -> 401
    res_anon = client.post(f"/api/visits/{visit.id}/bill-items", json=payload)
    assert res_anon.status_code == 401

    # Admin -> 403
    admin_client = login_client(admin_user)
    res_admin = admin_client.post(f"/api/visits/{visit.id}/bill-items", json=payload)
    assert res_admin.status_code == 403

    # Doctor -> 403
    doc_client = login_client(doctor_a_user)
    res_doc = doc_client.post(f"/api/visits/{visit.id}/bill-items", json=payload)
    assert res_doc.status_code == 403

    # Reception -> 201
    rec_client = login_client(reception_user)
    res_rec = rec_client.post(f"/api/visits/{visit.id}/bill-items", json=payload)
    assert res_rec.status_code == 201
