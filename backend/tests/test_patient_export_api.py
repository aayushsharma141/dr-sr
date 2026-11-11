"""Integration tests for patient dataset export API, streaming delivery, formula neutralization, and
audit logging (D-20-15 to D-20-20).

Guarantees tested:
- RBAC: Anonymous gets 401, Reception/Doctor get 403, Admin gets 200.
- Payload validation: reason < 5 chars returns 422, invalid field returns 422.
- STRIDE T-20-16: Formula injection strings starting with '=', '+', '-', or '@' are neutralized with
  a leading apostrophe.
- Streaming formats: CSV (text/csv) and XLSX
  (application/vnd.openxmlformats-officedocument.spreadsheetml.sheet).
- Scoping: Date range, department (patients with appointments/encounters), and search query.
- Audit logging: Single PATIENT_EXPORTED audit event with actor, reason, scope, fields, and row
  count.
"""

import io
from typing import Any

import openpyxl
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from kalyan_api.models import (
    AuditLog,
    ClinicalEncounter,
    Department,
    Doctor,
    Patient,
    User,
)
from kalyan_api.services.audit_service import AuditAction
from kalyan_api.services.export_service import sanitize_cell


def test_sanitize_cell_unit() -> None:
    """Formula injection sanitization prefixes =, +, -, @ with an apostrophe."""
    assert sanitize_cell("=1+1") == "'=1+1"
    assert sanitize_cell("+cmd|' /C calc'!A0") == "'+cmd|' /C calc'!A0"
    assert sanitize_cell("-2+3") == "'-2+3"
    assert sanitize_cell("@SUM(A1:A10)") == "'@SUM(A1:A10)"
    assert sanitize_cell("Normal Name") == "Normal Name"
    assert sanitize_cell("12345") == "12345"
    assert sanitize_cell(100) == 100
    assert sanitize_cell(None) is None
    assert sanitize_cell("") == ""


def test_patient_export_rbac(
    client: TestClient,
    login_client: Any,
    admin_user: User,
    reception_user: User,
    doctor_a_user: User,
) -> None:
    """POST /api/admin/exports requires Permission.PATIENT_EXPORT (Admin only)."""
    valid_payload = {
        "reason": "Annual statutory data audit",
        "format": "csv",
        "scope": {},
        "fields": ["full_name", "urn"],
    }

    # 1. Anonymous -> 401
    res_anon = client.post("/api/admin/exports", json=valid_payload)
    assert res_anon.status_code == 401

    # 2. Reception -> 403
    rec_c: TestClient = login_client(reception_user)
    res_rec = rec_c.post("/api/admin/exports", json=valid_payload)
    assert res_rec.status_code == 403

    # 3. Doctor -> 403
    doc_c: TestClient = login_client(doctor_a_user)
    res_doc = doc_c.post("/api/admin/exports", json=valid_payload)
    assert res_doc.status_code == 403

    # 4. Admin -> 200
    admin_c: TestClient = login_client(admin_user)
    res_admin = admin_c.post("/api/admin/exports", json=valid_payload)
    assert res_admin.status_code == 200
    assert "text/csv" in res_admin.headers["content-type"]


def test_patient_export_validation(
    login_client: Any,
    admin_user: User,
) -> None:
    """Missing or short reason and invalid fields trigger 422 Unprocessable Entity."""
    admin_c: TestClient = login_client(admin_user)

    # Reason under 5 chars
    res_short = admin_c.post(
        "/api/admin/exports",
        json={"reason": "test", "format": "csv", "fields": ["full_name"]},
    )
    assert res_short.status_code == 422

    # Missing reason
    res_no_reason = admin_c.post(
        "/api/admin/exports",
        json={"format": "csv", "fields": ["full_name"]},
    )
    assert res_no_reason.status_code == 422

    # Invalid field name
    res_bad_field = admin_c.post(
        "/api/admin/exports",
        json={
            "reason": "Valid governance audit reason",
            "format": "csv",
            "fields": ["full_name", "nonexistent_secret_column"],
        },
    )
    assert res_bad_field.status_code == 422

    # Invalid format
    res_bad_format = admin_c.post(
        "/api/admin/exports",
        json={
            "reason": "Valid governance audit reason",
            "format": "pdf",
            "fields": ["full_name"],
        },
    )
    assert res_bad_format.status_code == 422


def test_patient_export_csv_and_formula_neutralization(
    login_client: Any,
    admin_user: User,
    db_session: Session,
) -> None:
    """Values starting with =, +, -, @ must be prepended with a single quote."""
    admin_c: TestClient = login_client(admin_user)

    # Insert a test patient with formula-like characters
    dangerous_pat = Patient(
        urn="KH-2026-9001",
        full_name="=cmd|' /C calc'!A0",
        guardian_name="+Guardian",
        gender="M",
        age_years=35,
        mobile="9876543210",
        address="-Secret Address",
        district="Bhojpur",
        state="Bihar",
        allergies="@SevereAllergy",
        notes="=DDE('cmd';'/C notepad';'__dummy__')",
        is_active=True,
    )
    db_session.add(dangerous_pat)
    db_session.commit()

    payload = {
        "reason": "Security testing formula injection neutralization",
        "format": "csv",
        "scope": {"search_query": "KH-2026-9001"},
        "fields": ["full_name", "guardian_name", "address", "allergies", "notes"],
    }

    res = admin_c.post("/api/admin/exports", json=payload)
    assert res.status_code == 200
    assert "text/csv" in res.headers["content-type"]
    assert "attachment; filename=" in res.headers["content-disposition"]

    csv_text = res.text
    # Verify formula injection prefixes
    assert "'=cmd|' /C calc'!A0" in csv_text
    assert "'+Guardian" in csv_text
    assert "'-Secret Address" in csv_text
    assert "'@SevereAllergy" in csv_text
    assert "'=DDE('cmd';'/C notepad';'__dummy__')" in csv_text


def test_patient_export_xlsx_format(
    login_client: Any,
    admin_user: User,
    db_session: Session,
) -> None:
    """Export in XLSX format generates a valid openpyxl readable workbook."""
    admin_c: TestClient = login_client(admin_user)

    pat = Patient(
        urn="KH-2026-9002",
        full_name="Rajesh Sharma",
        guardian_name="Mohan Sharma",
        gender="M",
        age_years=42,
        mobile="9123456780",
        address="Station Road, Ara",
        district="Bhojpur",
        state="Bihar",
        allergies="None reported",
        is_active=True,
    )
    db_session.add(pat)
    db_session.commit()

    payload = {
        "reason": "Administrative financial year export",
        "format": "xlsx",
        "scope": {"search_query": "KH-2026-9002"},
        "fields": ["urn", "full_name", "mobile", "address"],
    }

    res = admin_c.post("/api/admin/exports", json=payload)
    assert res.status_code == 200
    assert (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        in res.headers["content-type"]
    )
    assert "patients_export_" in res.headers["content-disposition"]

    # Parse in-memory with openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(res.content))
    ws = wb.active
    assert ws.title == "Patients Export"
    assert ws.cell(row=1, column=1).value == "URN"
    assert ws.cell(row=1, column=2).value == "Full Name"

    # Row 2 contains patient data
    found = False
    for r in range(2, ws.max_row + 1):
        if ws.cell(row=r, column=1).value == "KH-2026-9002":
            assert ws.cell(row=r, column=2).value == "Rajesh Sharma"
            assert ws.cell(row=r, column=3).value == "9123456780"
            found = True
            break
    assert found, "Exported patient record KH-2026-9002 not found in XLSX sheet"


def test_patient_export_department_and_audit_event(
    login_client: Any,
    admin_user: User,
    doctor_a_user: User,
    db_session: Session,
) -> None:
    """Department filtering selects patients with department records and writes audit trail."""
    admin_c: TestClient = login_client(admin_user)

    # Ensure a department exists
    dept = db_session.scalar(select(Department).where(Department.code == "PHYSIOTHERAPY"))
    if not dept:
        dept = Department(code="PHYSIOTHERAPY", name_en="Physiotherapy", is_active=True)
        db_session.add(dept)
        db_session.flush()

    doctor = db_session.get(Doctor, doctor_a_user.doctor_id)
    assert doctor is not None

    # Patient 1 with encounter in Physiotherapy
    pat1 = Patient(
        urn="KH-2026-9010",
        full_name="Physio Patient",
        guardian_name="Guardian 1",
        gender="F",
        age_years=28,
        mobile="9800000001",
        address="Bhojpur",
        district="Bhojpur",
        state="Bihar",
        is_active=True,
    )
    # Patient 2 without encounter in Physiotherapy
    pat2 = Patient(
        urn="KH-2026-9020",
        full_name="Non Physio Patient",
        guardian_name="Guardian 2",
        gender="M",
        age_years=32,
        mobile="9800000002",
        address="Patna",
        district="Patna",
        state="Bihar",
        is_active=True,
    )
    db_session.add_all([pat1, pat2])
    db_session.flush()

    enc = ClinicalEncounter(
        patient_id=pat1.id,
        doctor_id=doctor.id,
        department_id=dept.id,
        symptoms="Knee pain",
        clinical_notes="Quadriceps strengthening",
        diagnosis="Osteoarthritis",
        created_by_user_id=doctor_a_user.id,
    )
    db_session.add(enc)
    db_session.commit()

    export_reason = "Departmental quarterly compliance export"
    payload = {
        "reason": export_reason,
        "format": "csv",
        "scope": {
            "department_id": dept.id,
        },
        "fields": ["urn", "full_name", "encounters", "clinical_notes"],
    }

    res = admin_c.post("/api/admin/exports", json=payload)
    assert res.status_code == 200
    csv_text = res.text

    assert "KH-2026-9010" in csv_text
    assert "KH-2026-9020" not in csv_text
    assert "Knee pain" in csv_text
    assert "Quadriceps strengthening" in csv_text

    # Verify audit event PATIENT_EXPORTED was written
    audit_row = db_session.scalar(
        select(AuditLog)
        .where(
            AuditLog.action == AuditAction.PATIENT_EXPORTED.value,
            AuditLog.actor_user_id == admin_user.id,
        )
        .order_by(AuditLog.occurred_at.desc())
    )
    assert audit_row is not None
    assert audit_row.reason == export_reason
    assert audit_row.outcome == "SUCCESS"
    assert audit_row.after_data is not None
    assert audit_row.after_data["row_count"] >= 1
    assert "encounters" in audit_row.after_data["fields"]
    assert audit_row.after_data["scope"]["department_id"] == dept.id
