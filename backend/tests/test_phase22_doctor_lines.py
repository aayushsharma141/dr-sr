"""Phase 22 Plan 12: Doctor charges API and doctor read view.

Requirements:
- T22-08, T22-10, BILL-03
- B3 (owner decision 2026-11-16): doctor can add own charges to COMPLETED consultation while visit is OPEN;
  charges lock when visit closes (Patient Out 422 visit_closed); CANCELLED consultation takes no charges.
- OD-C: PACKAGE reference line names patient treatment plan, carries no amount, visit total unchanged.
- Q13: doctor reads own consultation fee with adjustment history and own charges on that consultation;
  no visit total, no payments, no reception lines or other doctors' lines.
- Owner decision (iv) option-a: doctors do not void or correct lines; no doctor void route exists.
"""

from decimal import Decimal
import uuid
import pytest
from pydantic import ValidationError
from sqlalchemy import select

from kalyan_api.models import (
    Appointment,
    AuditLog,
    BillItem,
    BillItemAdjustment,
    BillItemCategory,
    BillItemSource,
    BillItemStatus,
    ConsultationStatus,
    Patient,
    TreatmentPlan,
    User,
    Visit,
    VisitStatus,
)
from kalyan_api.schemas.bill import DoctorChargesOut, DoctorLineCreate
from kalyan_api.services.audit_service import AuditAction


def _patient(db_session, suffix: str) -> Patient:
    patient = Patient(
        urn=f"KH-2026-DOC{suffix}-{uuid.uuid4().hex[:4]}",
        full_name=f"Doctor Line Patient {suffix}",
        guardian_name="Guardian",
        gender="M",
        age_years=45,
        mobile="9876543210",
        address="Ara",
    )
    db_session.add(patient)
    db_session.flush()
    return patient


def _consultation(reception, db_session, doctor_user, suffix: str, fee: int = 40000):
    doctor_user.doctor.default_fee_paise = fee
    db_session.flush()
    dept = doctor_user.doctor.departments[0]
    pat = _patient(db_session, suffix)
    response = reception.post(
        "/api/appointments/walk-in",
        json={
            "patient_id": pat.id,
            "doctor_id": doctor_user.doctor_id,
            "department_id": dept.id,
            "referral_source": "SELF",
        },
    )
    assert response.status_code == 201, response.text
    walked = response.json()
    appt = db_session.get(Appointment, walked["id"])
    appt.consultation_status = "IN_CONSULTATION"
    db_session.flush()
    return walked, pat


# ==============================================================================
# Task 1: Doctor Line Create Schema & Procedure Charges
# ==============================================================================


def test_doctor_line_create_schema_validation():
    # Valid PROCEDURE line
    proc = DoctorLineCreate(
        category="PROCEDURE",
        description="  Ultrasound therapy  ",
        unit="  session  ",
        quantity=Decimal("1"),
        rate_paise=30000,
    )
    assert proc.category == "PROCEDURE"
    assert proc.description == "Ultrasound therapy"
    assert proc.unit == "session"
    assert proc.quantity == Decimal("1")
    assert proc.rate_paise == 30000
    assert proc.treatment_plan_id is None

    # PROCEDURE requires description
    with pytest.raises(ValidationError):
        DoctorLineCreate(category="PROCEDURE", description="", quantity=Decimal("1"), rate_paise=30000)

    # PROCEDURE requires quantity > 0
    with pytest.raises(ValidationError):
        DoctorLineCreate(
            category="PROCEDURE", description="Dressing", quantity=Decimal("0"), rate_paise=30000
        )
    with pytest.raises(ValidationError):
        DoctorLineCreate(
            category="PROCEDURE", description="Dressing", quantity=Decimal("-1"), rate_paise=30000
        )

    # PROCEDURE requires rate_paise >= 0
    with pytest.raises(ValidationError):
        DoctorLineCreate(
            category="PROCEDURE", description="Dressing", quantity=Decimal("1"), rate_paise=-100
        )

    # PROCEDURE does not allow treatment_plan_id
    with pytest.raises(ValidationError):
        DoctorLineCreate(
            category="PROCEDURE",
            description="Dressing",
            quantity=Decimal("1"),
            rate_paise=30000,
            treatment_plan_id=1,
        )

    # Valid PACKAGE line
    pkg = DoctorLineCreate(category="PACKAGE", treatment_plan_id=42)
    assert pkg.category == "PACKAGE"
    assert pkg.treatment_plan_id == 42

    # PACKAGE requires treatment_plan_id
    with pytest.raises(ValidationError):
        DoctorLineCreate(category="PACKAGE")

    # PACKAGE takes no rate
    with pytest.raises(ValidationError):
        DoctorLineCreate(category="PACKAGE", treatment_plan_id=42, rate_paise=5000)

    # Forbidden categories (MEDICINE, ADDITIONAL, CONSULTATION, etc.)
    for invalid_cat in ["MEDICINE", "ADDITIONAL", "CONSULTATION", "OTHER"]:
        with pytest.raises(ValidationError):
            DoctorLineCreate(
                category=invalid_cat,  # type: ignore[arg-type]
                description="Test",
                quantity=Decimal("1"),
                rate_paise=1000,
            )

    # Extra fields forbidden
    with pytest.raises(ValidationError):
        DoctorLineCreate(
            category="PROCEDURE",
            description="Test",
            quantity=Decimal("1"),
            rate_paise=1000,
            extra_field="disallowed",  # type: ignore[call-arg]
        )


def test_doctor_adds_procedure_charge_end_to_end(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    reception = login_client(reception_user)
    doctor_a = login_client(doctor_a_user)
    walked, pat = _consultation(reception, db_session, doctor_a_user, "P1", fee=40000)
    appt_id = walked["id"]
    visit_id = walked["visit_id"]

    # 1. Doctor A adds PROCEDURE "Ultrasound therapy" 1 x 30000 on own IN_CONSULTATION consultation
    resp = doctor_a.post(
        f"/api/appointments/{appt_id}/bill-items",
        json={
            "category": "PROCEDURE",
            "description": "Ultrasound therapy",
            "unit": "session",
            "quantity": 1,
            "rate_paise": 30000,
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["category"] == "PROCEDURE"
    assert body["source"] == "DOCTOR"
    assert body["appointment_id"] == appt_id
    assert body["description"] == "Ultrasound therapy"
    assert body["unit"] == "session"
    assert Decimal(body["quantity"]) == Decimal("1")
    assert body["rate_paise"] == 30000
    assert body["amount_paise"] == 30000
    assert body["original_amount_paise"] == 30000
    assert body["status"] == "ACTIVE"

    # Database row verified
    line = db_session.get(BillItem, body["id"])
    assert line is not None
    assert line.category == BillItemCategory.PROCEDURE.value
    assert line.source == BillItemSource.DOCTOR.value
    assert line.appointment_id == appt_id
    assert line.visit_id == visit_id
    assert line.amount_paise == 30000

    # 2. Rule (i) payable timing: while IN_CONSULTATION, the procedure does not count toward total
    bill_resp = reception.get(f"/api/visits/{visit_id}/bill")
    assert bill_resp.status_code == 200
    bill = bill_resp.json()
    # Consultation fee (40000) not counted yet + procedure (30000) not counted yet = 0
    assert bill["bill_total_paise"] == 0
    # Line in bill view has counts_toward_total=False
    proc_lines = [l for sec in bill["sections"] if sec["category"] == "PROCEDURE" for l in sec["lines"]]
    assert len(proc_lines) == 1
    assert proc_lines[0]["counts_toward_total"] is False

    # 3. Consultation is COMPLETED -> both consultation fee and procedure become counted (BILL-03)
    appt = db_session.get(Appointment, appt_id)
    appt.consultation_status = "COMPLETED"
    db_session.flush()

    bill_resp2 = reception.get(f"/api/visits/{visit_id}/bill")
    assert bill_resp2.status_code == 200
    bill2 = bill_resp2.json()
    assert bill2["bill_total_paise"] == 70000  # 40000 consult + 30000 procedure (BILL-03)
    proc_lines2 = [l for sec in bill2["sections"] if sec["category"] == "PROCEDURE" for l in sec["lines"]]
    assert len(proc_lines2) == 1
    assert proc_lines2[0]["counts_toward_total"] is True
    assert proc_lines2[0]["source"] == "DOCTOR"
    assert proc_lines2[0]["amount_paise"] == 30000

    # 4. Audit row BILL_ITEM_ADDED recorded
    audit = db_session.scalar(
        select(AuditLog)
        .where(
            AuditLog.entity_type == "bill_item",
            AuditLog.entity_id == str(line.id),
            AuditLog.action == AuditAction.BILL_ITEM_ADDED,
        )
    )
    assert audit is not None
    assert audit.after_data["appointment_id"] == appt_id
    assert audit.after_data["category"] == "PROCEDURE"
    assert audit.after_data["amount_paise"] == 30000


def test_b3_completed_consultation_accepts_charge(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    """B3: Doctor completes consultation, visit stays OPEN, doctor adds dressing charge; accepted (201)."""
    reception = login_client(reception_user)
    doctor_a = login_client(doctor_a_user)
    walked, pat = _consultation(reception, db_session, doctor_a_user, "B3_COMPL", fee=50000)
    appt_id = walked["id"]
    visit_id = walked["visit_id"]

    # Consultation is marked COMPLETED
    appt = db_session.get(Appointment, appt_id)
    appt.consultation_status = "COMPLETED"
    db_session.flush()

    # Doctor adds dressing charge on the COMPLETED consultation
    resp = doctor_a.post(
        f"/api/appointments/{appt_id}/bill-items",
        json={
            "category": "PROCEDURE",
            "description": "Dressing",
            "quantity": 1,
            "rate_paise": 10000,
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["source"] == "DOCTOR"
    assert body["amount_paise"] == 10000

    # Visit total rises to 60000 (50000 + 10000)
    bill_resp = reception.get(f"/api/visits/{visit_id}/bill")
    assert bill_resp.status_code == 200
    assert bill_resp.json()["bill_total_paise"] == 60000


def test_b3_closed_visit_refuses_charge(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    """B3: Once Patient Out has closed the visit, doctor charge additions return 422 visit_closed."""
    reception = login_client(reception_user)
    doctor_a = login_client(doctor_a_user)
    walked, pat = _consultation(reception, db_session, doctor_a_user, "B3_CLOSE", fee=50000)
    appt_id = walked["id"]
    visit_id = walked["visit_id"]

    appt = db_session.get(Appointment, appt_id)
    appt.consultation_status = "COMPLETED"
    db_session.flush()

    # Patient Out closes the visit
    visit = db_session.get(Visit, visit_id)
    close_resp = reception.post(
        f"/api/visits/{visit_id}/close",
        json={"reason": "Patient discharged with balance due", "version_id": visit.version_id},
    )
    assert close_resp.status_code == 200, close_resp.text
    visit = db_session.get(Visit, visit_id)
    assert visit.status == VisitStatus.CLOSED.value

    # Doctor attempt to add charge on closed visit returns 422 visit_closed
    initial_count = db_session.scalar(select(BillItem).where(BillItem.appointment_id == appt_id))
    resp = doctor_a.post(
        f"/api/appointments/{appt_id}/bill-items",
        json={
            "category": "PROCEDURE",
            "description": "Post-discharge dressing",
            "quantity": 1,
            "rate_paise": 10000,
        },
    )
    assert resp.status_code == 422
    assert resp.json()["code"] == "visit_closed"

    # Count of bill items unchanged
    final_items = db_session.scalars(select(BillItem).where(BillItem.appointment_id == appt_id)).all()
    assert len(final_items) == 1  # only the initial consultation line


def test_doctor_b_on_doctor_a_consultation_returns_404(
    clock, login_client, reception_user, doctor_a_user, doctor_b_user, db_session
):
    """Doctor B cannot access or add charges to Doctor A's appointment (404 appointment_not_found)."""
    reception = login_client(reception_user)
    doctor_b = login_client(doctor_b_user)
    walked, pat = _consultation(reception, db_session, doctor_a_user, "SCOPE", fee=50000)
    appt_id = walked["id"]

    resp = doctor_b.post(
        f"/api/appointments/{appt_id}/bill-items",
        json={
            "category": "PROCEDURE",
            "description": "Snoop procedure",
            "quantity": 1,
            "rate_paise": 10000,
        },
    )
    assert resp.status_code == 404
    assert resp.json()["code"] == "appointment_not_found"


def test_cancelled_consultation_refuses_charges(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    """B3: Cancelled consultation refuses charges (422 consultation_cancelled)."""
    reception = login_client(reception_user)
    doctor_a = login_client(doctor_a_user)
    walked, pat = _consultation(reception, db_session, doctor_a_user, "CANCEL", fee=50000)
    appt_id = walked["id"]

    appt = db_session.get(Appointment, appt_id)
    appt.consultation_status = ConsultationStatus.CANCELLED.value
    db_session.flush()

    resp = doctor_a.post(
        f"/api/appointments/{appt_id}/bill-items",
        json={
            "category": "PROCEDURE",
            "description": "Cancelled proc",
            "quantity": 1,
            "rate_paise": 10000,
        },
    )
    assert resp.status_code == 422
    assert resp.json()["code"] == "consultation_cancelled"


def test_rbac_on_doctor_charges_endpoints(
    clock, login_client, client, reception_user, doctor_a_user, admin_user, db_session
):
    """POST and GET /appointments/{id}/bill-items RBAC: anon 401, admin 403, reception 403, doc_a allowed."""
    reception = login_client(reception_user)
    admin = login_client(admin_user)
    walked, pat = _consultation(reception, db_session, doctor_a_user, "RBAC", fee=50000)
    appt_id = walked["id"]

    payload = {
        "category": "PROCEDURE",
        "description": "Test proc",
        "quantity": 1,
        "rate_paise": 10000,
    }

    # Anonymous
    assert client.post(f"/api/appointments/{appt_id}/bill-items", json=payload).status_code == 401
    assert client.get(f"/api/appointments/{appt_id}/bill-items").status_code == 401

    # Admin (no BILL_CLINICAL)
    assert admin.post(f"/api/appointments/{appt_id}/bill-items", json=payload).status_code == 403
    assert admin.get(f"/api/appointments/{appt_id}/bill-items").status_code == 403

    # Reception (no BILL_CLINICAL)
    assert reception.post(f"/api/appointments/{appt_id}/bill-items", json=payload).status_code == 403
    assert reception.get(f"/api/appointments/{appt_id}/bill-items").status_code == 403


# ==============================================================================
# Task 2: Package Reference Line & Doctor Read View (Q13)
# ==============================================================================


def test_doctor_adds_package_reference_line(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    """OD-C: PACKAGE line carries no amount; description=plan.plan_name, visit total unchanged."""
    reception = login_client(reception_user)
    doctor_a = login_client(doctor_a_user)
    walked, pat = _consultation(reception, db_session, doctor_a_user, "PKG1", fee=50000)
    appt_id = walked["id"]
    visit_id = walked["visit_id"]

    # Mark completed so consultation fee counts
    appt = db_session.get(Appointment, appt_id)
    appt.consultation_status = "COMPLETED"

    # Create treatment plan for this patient
    plan = TreatmentPlan(
        patient_id=pat.id,
        doctor_id=doctor_a_user.doctor_id,
        plan_name="Cervical Spondylosis 10-Session",
        condition_diagnosis="C5-C6 Radiculopathy",
        total_sessions=10,
        agreed_price_paise=500000,
    )
    db_session.add(plan)
    db_session.flush()

    # Doctor adds PACKAGE reference line
    resp = doctor_a.post(
        f"/api/appointments/{appt_id}/bill-items",
        json={
            "category": "PACKAGE",
            "treatment_plan_id": plan.id,
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["category"] == "PACKAGE"
    assert body["source"] == "DOCTOR"
    assert body["appointment_id"] == appt_id
    assert body["description"] == "Cervical Spondylosis 10-Session"
    assert body["rate_paise"] == 0
    assert body["amount_paise"] == 0
    assert body["original_amount_paise"] == 0

    # Visit total remains 50000 (package money stays on the plan, OD-C)
    bill_resp = reception.get(f"/api/visits/{visit_id}/bill")
    assert bill_resp.status_code == 200
    bill = bill_resp.json()
    assert bill["bill_total_paise"] == 50000
    pkg_sec = next((s for s in bill["sections"] if s["category"] == "PACKAGE"), None)
    assert pkg_sec is not None
    assert pkg_sec["subtotal_paise"] == 0
    assert len(pkg_sec["lines"]) == 1
    assert pkg_sec["lines"][0]["description"] == "Cervical Spondylosis 10-Session"


def test_package_reference_wrong_patient_plan_404(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    """Cannot attach a treatment plan of another patient (404 plan_not_found)."""
    reception = login_client(reception_user)
    doctor_a = login_client(doctor_a_user)
    walked, pat = _consultation(reception, db_session, doctor_a_user, "PKG_WRONG", fee=50000)
    appt_id = walked["id"]

    other_pat = _patient(db_session, "OTHER")
    other_plan = TreatmentPlan(
        patient_id=other_pat.id,
        doctor_id=doctor_a_user.doctor_id,
        plan_name="Other Plan",
        condition_diagnosis="Other condition",
        total_sessions=5,
        agreed_price_paise=200000,
    )
    db_session.add(other_plan)
    db_session.flush()

    # Attempt with other patient's plan
    resp = doctor_a.post(
        f"/api/appointments/{appt_id}/bill-items",
        json={"category": "PACKAGE", "treatment_plan_id": other_plan.id},
    )
    assert resp.status_code == 404
    assert resp.json()["code"] == "plan_not_found"

    # Nonexistent plan
    resp2 = doctor_a.post(
        f"/api/appointments/{appt_id}/bill-items",
        json={"category": "PACKAGE", "treatment_plan_id": 999999},
    )
    assert resp2.status_code == 404
    assert resp2.json()["code"] == "plan_not_found"


def test_doctor_read_view_isolation_q13(
    clock, login_client, reception_user, doctor_a_user, doctor_b_user, admin_user, db_session
):
    """Q13: Doctor reads only own consultation fee (with adjustment history) and own charges.

    Strictly NO visit total, NO payments, NO reception lines.
    """
    reception = login_client(reception_user)
    doctor_a = login_client(doctor_a_user)
    doctor_b = login_client(doctor_b_user)
    admin = login_client(admin_user)

    walked, pat = _consultation(reception, db_session, doctor_a_user, "Q13", fee=50000)
    appt_id = walked["id"]
    visit_id = walked["visit_id"]

    # Mark consultation COMPLETED so fee counts toward visit total
    appt = db_session.get(Appointment, appt_id)
    appt.consultation_status = "COMPLETED"
    db_session.flush()

    # 1. Doctor discounts own fee to 35000
    disc_resp = doctor_a.post(
        f"/api/appointments/{appt_id}/fee-adjustment",
        json={"kind": "DISCOUNT", "new_amount_paise": 35000, "reason": "Patient discount"},
    )
    assert disc_resp.status_code == 201, disc_resp.text

    # 2. Doctor adds a procedure line (25000)
    proc_resp = doctor_a.post(
        f"/api/appointments/{appt_id}/bill-items",
        json={
            "category": "PROCEDURE",
            "description": "IFT Therapy",
            "quantity": 1,
            "rate_paise": 25000,
        },
    )
    assert proc_resp.status_code == 201

    # 3. Reception adds a medicine line on the same visit
    med_resp = reception.post(
        f"/api/visits/{visit_id}/bill-items",
        json={
            "category": "MEDICINE",
            "description": "Paracetamol 500mg",
            "quantity": 2,
            "rate_paise": 5000,
        },
    )
    assert med_resp.status_code == 201

    # 4. Collect partial payment
    pay_resp = reception.post(
        "/api/payments",
        json={
            "visit_id": visit_id,
            "patient_id": pat.id,
            "amount_paise": 30000,
            "payment_method": "CASH",
        },
    )
    assert pay_resp.status_code == 201

    # 5. Doctor A calls GET /api/appointments/{appt_id}/bill-items
    get_resp = doctor_a.get(f"/api/appointments/{appt_id}/bill-items")
    assert get_resp.status_code == 200, get_resp.text
    data = get_resp.json()

    # Validate against schema
    validated = DoctorChargesOut(**data)
    assert validated.consultation_line is not None
    assert validated.consultation_line.amount_paise == 35000
    assert validated.consultation_line.original_amount_paise == 50000
    assert len(validated.consultation_line.history) == 1
    assert validated.consultation_line.history[0].kind == "DISCOUNT"
    assert validated.consultation_line.history[0].reason == "Patient discount"

    assert len(validated.doctor_lines) == 1
    assert validated.doctor_lines[0].description == "IFT Therapy"
    assert validated.doctor_lines[0].amount_paise == 25000
    assert validated.doctor_lines[0].source == "DOCTOR"

    # STRICT Q13 isolation checks: ensure forbidden keys are ABSENT
    forbidden_keys = [
        "visit_total_paise",
        "bill_total_paise",
        "paid_paise",
        "due_paise",
        "payments",
        "reception_lines",
        "sections",
        "previous_dues",
    ]
    for key in forbidden_keys:
        assert key not in data, f"Forbidden key '{key}' leaked to doctor read view!"

    # Ensure medicine line is NOT in doctor_lines
    doc_line_descs = [l["description"] for l in data["doctor_lines"]]
    assert "Paracetamol 500mg" not in doc_line_descs

    # Doctor B receives 404
    assert doctor_b.get(f"/api/appointments/{appt_id}/bill-items").status_code == 404

    # Reception receives 403
    assert reception.get(f"/api/appointments/{appt_id}/bill-items").status_code == 403

    # Admin receives 403
    assert admin.get(f"/api/appointments/{appt_id}/bill-items").status_code == 403


def test_doctor_void_does_not_exist(
    clock, login_client, reception_user, doctor_a_user, db_session
):
    """Owner decision (iv) option-a: doctors cannot void or correct charges.

    No doctor void route exists.
    """
    reception = login_client(reception_user)
    doctor_a = login_client(doctor_a_user)
    walked, pat = _consultation(reception, db_session, doctor_a_user, "NOVOID", fee=50000)
    appt_id = walked["id"]

    # Add a procedure charge
    proc_resp = doctor_a.post(
        f"/api/appointments/{appt_id}/bill-items",
        json={
            "category": "PROCEDURE",
            "description": "Shortwave diathermy",
            "quantity": 1,
            "rate_paise": 20000,
        },
    )
    assert proc_resp.status_code == 201
    line_id = proc_resp.json()["id"]

    # Verify no doctor void route exists on any likely endpoint
    resp1 = doctor_a.post(f"/api/bill-items/{line_id}/doctor-void", json={"reason": "Test void"})
    assert resp1.status_code in (404, 405)

    resp2 = doctor_a.post(
        f"/api/appointments/{appt_id}/bill-items/{line_id}/void", json={"reason": "Test void"}
    )
    assert resp2.status_code in (404, 405)
