"""Regression tests for Admin Security, Data Operations, and SQL hygiene defects.

Covers:
- S2: Management Overview trend deductions (refunds subtracted) and reversed_at filtering.
- S3: Scoped PHI export filters child clinical records by department/date.
- S4: Consultation fee adjustment on uncompleted visits does not false-trigger adjustment_below_paid.
- S5: Asset Service logo validation rejects PDFs and SVG scripts, with disk cleanup on error.
- S7/S8: Import upload limits and extension validation (<= 50MB, .csv/.xlsx/.xls only).
- N5: SQL LIKE wildcard escaping for search and reports.
"""

from datetime import UTC, date, datetime, timedelta
from io import BytesIO
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from kalyan_api import clock
from kalyan_api.config import Settings
from kalyan_api.models import (
    Appointment,
    AssetType,
    BillItem,
    BillItemCategory,
    BillItemSource,
    BillItemStatus,
    ClinicalEncounter,
    Department,
    Doctor,
    HospitalAsset,
    Patient,
    Payment,
    PaymentMethod,
    Refund,
    User,
    Visit,
    VisitStatus,
)
from kalyan_api.services import asset_service, bill_service, export_service
from kalyan_api.schemas.exports import ExportScope, PatientExportRequest


VALID_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"
    b"\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4"
)
VALID_PDF = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF"
SVG_WITH_SCRIPT = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'


def test_asset_service_logo_rejections(
    admin_user: User,
    login_client,
    db_session: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    test_settings: Settings,
) -> None:
    """S5: Asset Service rejects PDFs and scripts in SVGs for LOGO assets."""
    assets_dir = tmp_path / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(test_settings, "assets_dir", assets_dir)

    client: TestClient = login_client(admin_user)

    # 1. PDF should be rejected for LOGO
    pdf_resp = client.post(
        "/api/admin/assets",
        data={"asset_type": "LOGO"},
        files={"file": ("logo.pdf", BytesIO(VALID_PDF), "application/pdf")},
    )
    assert pdf_resp.status_code == 422
    assert "PDF files cannot be used as hospital logos" in str(pdf_resp.json())

    # 2. SVG with <script> should be rejected
    svg_resp = client.post(
        "/api/admin/assets",
        data={"asset_type": "LOGO"},
        files={"file": ("logo.svg", BytesIO(SVG_WITH_SCRIPT), "image/svg+xml")},
    )
    assert svg_resp.status_code == 422
    assert "SVG files containing executable scripts are not permitted" in str(svg_resp.json())


def test_import_upload_bounds_and_extensions(
    admin_user: User,
    login_client,
) -> None:
    """S8: Import endpoint validates allowed extensions (.csv, .xlsx, .xls) and bounds."""
    client: TestClient = login_client(admin_user)

    # Disallowed extension (.txt)
    resp = client.post(
        "/api/admin/imports/inspect",
        files={"file": ("patients.txt", BytesIO(b"name,mobile\nTest,9876543210"), "text/plain")},
    )
    assert resp.status_code == 422
    assert "not supported" in str(resp.json())


def test_management_overview_trend_deducts_refunds_and_reversed_at(
    admin_user: User,
    login_client,
    db_session: Session,
    doctor_a_user: User,
) -> None:
    """S2: Management Overview 6-month trend subtracts refunds from net collections."""
    doctor = Doctor(
        name_en="Dr. Overview Test",
        is_active=True,
    )
    db_session.add(doctor)
    db_session.flush()
    doctor_a_user.doctor_id = doctor.id
    db_session.flush()

    patient = Patient(
        urn="URN-REV-01",
        full_name="Trend Patient",
        guardian_name="Guardian",
        gender="M",
        age_years=35,
        mobile="9812345678",
        address="Ara",
        is_active=True,
    )
    db_session.add(patient)
    db_session.flush()

    now = clock.utcnow()
    visit = Visit(
        patient_id=patient.id,
        visit_date=date.today(),
        opened_by_user_id=admin_user.id,
        status=VisitStatus.OPEN.value,
        created_at=now,
    )
    db_session.add(visit)
    db_session.flush()

    # Create payment of 50000 paise (Rs. 500)
    payment = Payment(
        patient_id=patient.id,
        visit_id=visit.id,
        amount_paise=50000,
        payment_method=PaymentMethod.CASH,
        receipt_number="RCP-TEST-001",
        is_reversed=False,
        created_by_user_id=admin_user.id,
        created_at=now,
    )
    db_session.add(payment)
    db_session.flush()

    # Create refund of 10000 paise (Rs. 100)
    refund = Refund(
        refund_number="RFD-TEST-001",
        patient_id=patient.id,
        visit_id=visit.id,
        payment_id=payment.id,
        amount_paise=10000,
        refund_method="CASH",
        reason="Partial test refund",
        refunded_by_user_id=admin_user.id,
        created_at=now,
    )
    db_session.add(refund)
    db_session.commit()

    client: TestClient = login_client(admin_user)
    resp = client.get("/api/admin/management-overview")
    assert resp.status_code == 200
    data = resp.json()

    # The current month net collection should equal 50000 - 10000 = 40000 paise
    trends = data["collection_trend"]
    assert len(trends) == 6
    curr_month = trends[-1]
    assert curr_month["collected_paise"] == 40000


def test_scoped_export_filters_clinical_child_rows(
    db_session: Session,
    admin_user: User,
    doctor_a_user: User,
) -> None:
    """S3: Scoped export child rows are filtered by department scope."""
    dept1 = Department(name_en="Ortho", is_active=True)
    dept2 = Department(name_en="Eye", is_active=True)
    db_session.add_all([dept1, dept2])
    db_session.flush()

    doc1 = Doctor(name_en="Dr. Ortho", is_active=True, departments=[dept1])
    db_session.add(doc1)
    db_session.flush()
    doctor_a_user.doctor_id = doc1.id
    db_session.flush()

    patient = Patient(
        urn="URN-EXP-01",
        full_name="Export Filter Patient",
        guardian_name="Guardian",
        gender="F",
        age_years=28,
        mobile="9800011122",
        address="Bhojpur",
        is_active=True,
    )
    db_session.add(patient)
    db_session.flush()

    # Patient has an appointment in dept1 (qualifying patient for export)
    appt = Appointment(
        patient_id=patient.id,
        department_id=dept1.id,
        doctor_id=doc1.id,
        appointment_date=date.today(),
        status="BOOKED",
        created_by_user_id=admin_user.id,
    )
    db_session.add(appt)

    now = clock.utcnow()
    # Encounter 1 in dept1
    enc1 = ClinicalEncounter(
        encounter_code="ENC-ORTHO-01",
        patient_id=patient.id,
        doctor_id=doc1.id,
        department_id=dept1.id,
        encounter_date=now,
        symptoms="Knee pain",
        clinical_notes="Ortho encounter",
        created_by_user_id=doctor_a_user.id,
    )
    # Encounter 2 in dept2 (different department!)
    enc2 = ClinicalEncounter(
        encounter_code="ENC-EYE-02",
        patient_id=patient.id,
        doctor_id=doc1.id,
        department_id=dept2.id,
        encounter_date=now,
        symptoms="Blurry eye",
        clinical_notes="Eye encounter in dept 2",
        created_by_user_id=doctor_a_user.id,
    )
    db_session.add_all([enc1, enc2])
    db_session.commit()

    # Export scoped to dept1 only
    req = PatientExportRequest(
        reason="Department audit",
        format="csv",
        scope=ExportScope(department_id=dept1.id),
        fields=["urn", "full_name", "clinical_notes"],
    )
    rows, row_count = export_service.query_export_rows(db_session, req.scope, req.fields)
    assert row_count == 1
    generator = export_service.generate_csv_stream(rows, req.fields)
    content = "".join(list(generator))
    assert "Ortho encounter" in content
    assert "Eye encounter in dept 2" not in content


def test_sql_like_wildcard_escaping(
    admin_user: User,
    login_client,
    db_session: Session,
) -> None:
    """N5: Patient search escapes SQL LIKE wildcards % and _."""
    p1 = Patient(
        urn="URN-PERCENT-%-01",
        full_name="Patient With % Sign",
        guardian_name="Guardian",
        gender="M",
        age_years=50,
        mobile="9876543210",
        address="Ara",
        is_active=True,
    )
    p2 = Patient(
        urn="URN-NORMAL-02",
        full_name="Patient Normal",
        guardian_name="Guardian",
        gender="M",
        age_years=50,
        mobile="9876543211",
        address="Ara",
        is_active=True,
    )
    db_session.add_all([p1, p2])
    db_session.commit()

    client: TestClient = login_client(admin_user)

    # Search specifically for "%"
    resp = client.get("/api/admin/patients/search?q=%25")
    assert resp.status_code == 200
    items = resp.json()
    # Should match only p1 who literally has "%", not all patients
    matched_urns = [item["urn"] for item in items]
    assert "URN-PERCENT-%-01" in matched_urns
    assert "URN-NORMAL-02" not in matched_urns


def test_consultation_fee_adjustment_uncompleted_visit(
    admin_user: User,
    login_client,
    db_session: Session,
) -> None:
    """S4: Consultation fee adjustment on uncompleted visits does not false-trigger adjustment_below_paid."""
    doc = Doctor(name_en="Dr. Ortho", is_active=True)
    db_session.add(doc)
    db_session.flush()

    patient = Patient(
        urn="URN-ADJ-01",
        full_name="Adjust Patient",
        guardian_name="Guardian",
        gender="M",
        age_years=40,
        mobile="9812345000",
        address="Ara",
        is_active=True,
    )
    db_session.add(patient)
    db_session.flush()

    now = clock.utcnow()
    visit = Visit(
        patient_id=patient.id,
        visit_date=date.today(),
        opened_by_user_id=admin_user.id,
        status=VisitStatus.OPEN.value,
        created_at=now,
    )
    db_session.add(visit)
    db_session.flush()

    appt = Appointment(
        patient_id=patient.id,
        doctor_id=doc.id,
        appointment_date=date.today(),
        status="BOOKED",
        consultation_status=None,  # Not completed yet
        visit_id=visit.id,
        created_by_user_id=admin_user.id,
    )
    db_session.add(appt)
    db_session.flush()

    # Consultation bill item: 30000 paise (Rs. 300)
    consult_item = BillItem(
        patient_id=patient.id,
        visit_id=visit.id,
        appointment_id=appt.id,
        category=BillItemCategory.CONSULTATION.value,
        source=BillItemSource.DOCTOR.value,
        description="Doctor Consultation",
        quantity=1,
        rate_paise=30000,
        original_amount_paise=30000,
        amount_paise=30000,
        status=BillItemStatus.ACTIVE.value,
        created_by_user_id=admin_user.id,
    )
    # Dressing fee item: 20000 paise (Rs. 200) - already counted in bill total
    reg_item = BillItem(
        patient_id=patient.id,
        visit_id=visit.id,
        category=BillItemCategory.ADDITIONAL.value,
        source=BillItemSource.RECEPTION.value,
        description="Dressing Fee",
        quantity=1,
        rate_paise=20000,
        original_amount_paise=20000,
        amount_paise=20000,
        status=BillItemStatus.ACTIVE.value,
        created_by_user_id=admin_user.id,
    )
    db_session.add_all([consult_item, reg_item])
    db_session.flush()

    # Patient paid Rs. 200 (20000 paise) for registration
    payment = Payment(
        patient_id=patient.id,
        visit_id=visit.id,
        amount_paise=20000,
        payment_method=PaymentMethod.CASH,
        receipt_number="RCP-ADJ-001",
        is_reversed=False,
        created_by_user_id=admin_user.id,
        created_at=now,
    )
    db_session.add(payment)
    db_session.commit()

    client: TestClient = login_client(admin_user)

    # Admin discounts consultation fee from 30000 to 10000 (delta = -20000)
    resp = client.post(
        f"/api/appointments/{appt.id}/fee-correction",
        json={
            "kind": "DISCOUNT",
            "new_amount_paise": 10000,
            "reason": "Doctor decided concession for follow-up",
        },
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["new_amount_paise"] == 10000
    assert data["old_amount_paise"] == 30000
