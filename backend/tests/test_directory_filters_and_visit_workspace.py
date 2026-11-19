"""Comprehensive tests for M4 Patient Directory Filters/Stats, Unified Visit Workspace &
Investigation Result Document Links (T4.3 / T4.4).

Covers:
- Directory server-side filters (status=active|archived|all, gender, district, has_due_balance,
  sort_by=recent|name|urn) with exact parity between GET /api/patients and GET /api/patients/count
- Fail-closed AGENTS.md #7 guard: DOCTOR receives 403 on has_due_balance on list & count,
  and outstanding_paise is strictly None for DOCTOR while populated for ADMIN & RECEPTION
- Downward merged-child consolidation for visit_count, last_visit_date, and due balance
- Unified GET /api/patients/{patient_id}/visits/{visit_id}/workspace:
  - DOCTOR: full clinical bundle (vitals, notes, template summary, structured diagnoses,
    investigations + linked document_id/document_title, prescriptions, treatment plans, follow-up,
    addenda), Q13 own-doctor-only clinical_charges, DWS-04 CROSS_DOCTOR_CLINICAL_READ audit,
    allergy_alert populated, and financial_summary strictly None
  - RECEPTION: financial_summary (bill_total, paid, refunded, due, payments, refunds),
    allergy_alert populated, and all 15 clinical fields strictly None (D-04)
  - ADMIN: financial_summary populated, allergy_alert strictly None, all clinical fields None
  - Archived/merged patient read support and 404 on unrelated visit
- POST /api/investigations/{order_id}/results document_id validation (201, 404, 422 wrong patient,
  422 archived document)
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from kalyan_api import clock
from kalyan_api.config import Settings
from kalyan_api.models import (
    Appointment,
    AuditLog,
    BillItem,
    BillItemCategory,
    BillItemSource,
    BillItemStatus,
    ClinicalAddendum,
    ClinicalEncounter,
    ClinicalTemplate,
    ClinicalTemplateResponse,
    ClinicalTemplateVersion,
    Department,
    EncounterDiagnosis,
    FollowUpRecommendation,
    InvestigationOrder,
    Patient,
    PatientAllergy,
    PatientDocument,
    Payment,
    Prescription,
    PrescriptionItem,
    Refund,
    TreatmentPlan,
    User,
    Visit,
    VitalObservation,
)
from kalyan_api.services.audit_service import AuditAction

PDF_BYTES = b"%PDF-1.4\n%workspace investigation report\n%%EOF\n"

CLINICAL_CONSULTATION_FIELDS = (
    "encounter_id",
    "encounter_code",
    "is_finalised",
    "vitals",
    "symptoms",
    "clinical_notes",
    "diagnosis",
    "template_response_summary",
    "diagnoses",
    "investigations",
    "prescriptions",
    "treatment_plans",
    "follow_up",
    "addenda",
    "clinical_charges",
)


def _create_patient(
    db_session: Session,
    *,
    urn: str,
    full_name: str,
    gender: str = "M",
    district: str = "Bhojpur",
    mobile: str = "9876543210",
    is_archived: bool = False,
    created_at: datetime | None = None,
) -> Patient:
    pat = Patient(
        urn=urn,
        full_name=full_name,
        guardian_name="Guardian",
        gender=gender,
        age_years=34,
        mobile=mobile,
        address="Main Road",
        district=district,
        state="Bihar",
        is_archived=is_archived,
        archived_at=datetime.now(UTC) if is_archived else None,
        archive_reason="Archived in test" if is_archived else None,
    )
    if created_at is not None:
        pat.created_at = created_at
    db_session.add(pat)
    db_session.flush()
    return pat


def test_directory_filters_sorting_stats_merged_dues_and_doctor_guard(
    db_session: Session,
    login_client: Any,
    admin_user: User,
    reception_user: User,
    doctor_a_user: User,
) -> None:
    """Verify server-side filters, list/count parity, merged-child dues, and DOCTOR 403 guard."""
    base_ts = datetime(2026, 11, 1, 9, 0, tzinfo=UTC)
    tag = uuid.uuid4().hex[:4].upper()

    # 1. Active Male in Bhojpur with direct unpaid visit charge (50000 paise due)
    p_due_direct = _create_patient(
        db_session,
        urn=f"KH-26-D-{tag}-001",
        full_name=f"Bala {tag}",
        gender="M",
        district="Bhojpur",
        created_at=base_ts,
    )
    v_direct = Visit(
        patient_id=p_due_direct.id,
        visit_date=date(2026, 11, 1),
        status="OPEN",
        opened_by_user_id=reception_user.id,
    )
    db_session.add(v_direct)
    db_session.flush()
    db_session.add(
        BillItem(
            visit_id=v_direct.id,
            patient_id=p_due_direct.id,
            category=BillItemCategory.MEDICINE.value,
            source=BillItemSource.RECEPTION.value,
            status=BillItemStatus.ACTIVE.value,
            description="Unpaid Medicine",
            quantity=Decimal("1"),
            rate_paise=50000,
            original_amount_paise=50000,
            amount_paise=50000,
            created_by_user_id=reception_user.id,
        )
    )

    # 2. Active Female in Patna with zero due balance (fully paid visit)
    p_paid = _create_patient(
        db_session,
        urn=f"KH-26-D-{tag}-002",
        full_name=f"Asha {tag}",
        gender="F",
        district="Patna",
        created_at=base_ts + timedelta(hours=1),
    )
    v_paid = Visit(
        patient_id=p_paid.id,
        visit_date=date(2026, 11, 2),
        status="OPEN",
        opened_by_user_id=reception_user.id,
    )
    db_session.add(v_paid)
    db_session.flush()
    db_session.add(
        BillItem(
            visit_id=v_paid.id,
            patient_id=p_paid.id,
            category=BillItemCategory.MEDICINE.value,
            source=BillItemSource.RECEPTION.value,
            status=BillItemStatus.ACTIVE.value,
            description="Paid Medicine",
            quantity=Decimal("1"),
            rate_paise=20000,
            original_amount_paise=20000,
            amount_paise=20000,
            created_by_user_id=reception_user.id,
        )
    )
    db_session.add(
        Payment(
            receipt_number=f"RCP-DIR-{uuid.uuid4().hex[:6].upper()}",
            patient_id=p_paid.id,
            visit_id=v_paid.id,
            amount_paise=20000,
            payment_method="CASH",
            is_reversed=False,
            created_by_user_id=reception_user.id,
        )
    )

    # 3. Active Master patient whose ONLY visit & due balance live on a merged secondary child
    p_master = _create_patient(
        db_session,
        urn=f"KH-26-D-{tag}-003",
        full_name=f"Charu {tag}",
        gender="F",
        district="Bhojpur",
        created_at=base_ts + timedelta(hours=2),
    )
    p_child = _create_patient(
        db_session,
        urn=f"KH-26-D-{tag}-004",
        full_name=f"Charu Alias {tag}",
        gender="F",
        district="Bhojpur",
        created_at=base_ts + timedelta(hours=3),
    )
    v_child = Visit(
        patient_id=p_child.id,
        visit_date=date(2026, 11, 3),
        status="OPEN",
        opened_by_user_id=reception_user.id,
    )
    db_session.add(v_child)
    db_session.flush()
    db_session.add(
        BillItem(
            visit_id=v_child.id,
            patient_id=p_child.id,
            category=BillItemCategory.PROCEDURE.value,
            source=BillItemSource.RECEPTION.value,
            status=BillItemStatus.ACTIVE.value,
            description="Child Unpaid Procedure",
            quantity=Decimal("1"),
            rate_paise=35000,
            original_amount_paise=35000,
            amount_paise=35000,
            created_by_user_id=reception_user.id,
        )
    )
    p_child.merged_into_id = p_master.id
    p_child.merged_at = datetime.now(UTC)
    p_child.merge_reason = "Duplicate merged into master"
    p_child.is_active = False

    # 4. Archived patient
    p_archived = _create_patient(
        db_session,
        urn=f"KH-26-D-{tag}-005",
        full_name=f"Deepak {tag}",
        gender="M",
        district="Patna",
        is_archived=True,
        created_at=base_ts + timedelta(hours=4),
    )
    db_session.flush()

    rec_c = login_client(reception_user)
    admin_c = login_client(admin_user)
    doc_c = login_client(doctor_a_user)

    def _assert_list_count_parity(client: Any, query: str) -> list[dict[str, Any]]:
        list_res = client.get(f"/api/patients?q={tag}&{query}")
        count_res = client.get(f"/api/patients/count?q={tag}&{query}")
        assert list_res.status_code == 200, list_res.text
        assert count_res.status_code == 200, count_res.text
        items = list_res.json()
        assert count_res.json()["total"] == len(items)
        return items

    # Status filters
    active_items = _assert_list_count_parity(rec_c, "status=active")
    assert {i["id"] for i in active_items} == {p_due_direct.id, p_paid.id, p_master.id}

    archived_items = _assert_list_count_parity(rec_c, "status=archived")
    assert [i["id"] for i in archived_items] == [p_archived.id]

    all_items = _assert_list_count_parity(rec_c, "status=all")
    assert {i["id"] for i in all_items} == {
        p_due_direct.id,
        p_paid.id,
        p_master.id,
        p_child.id,
        p_archived.id,
    }

    # Gender & case-insensitive district substring filters
    female_patna = _assert_list_count_parity(rec_c, "status=active&gender=F&district=pat")
    assert [i["id"] for i in female_patna] == [p_paid.id]

    male_active = _assert_list_count_parity(rec_c, "status=active&gender=M")
    assert [i["id"] for i in male_active] == [p_due_direct.id]

    # has_due_balance=true includes direct due AND master with merged-child due
    due_true = _assert_list_count_parity(rec_c, "status=active&has_due_balance=true")
    assert {i["id"] for i in due_true} == {p_due_direct.id, p_master.id}
    by_id = {i["id"]: i for i in due_true}
    assert by_id[p_due_direct.id]["outstanding_paise"] == 50000
    assert by_id[p_due_direct.id]["visit_count"] == 1
    assert by_id[p_due_direct.id]["last_visit_date"] == "2026-11-01"
    assert by_id[p_master.id]["outstanding_paise"] == 35000
    assert by_id[p_master.id]["visit_count"] == 1
    assert by_id[p_master.id]["last_visit_date"] == "2026-11-03"

    # Admin also gets identical due filter + outstanding_paise
    admin_due_false = _assert_list_count_parity(admin_c, "status=active&has_due_balance=false")
    assert [i["id"] for i in admin_due_false] == [p_paid.id]
    assert admin_due_false[0]["outstanding_paise"] == 0

    # Sort orders: recent (created_at DESC), name (ASC), urn (ASC)
    sort_recent = rec_c.get(f"/api/patients?q={tag}&status=active&sort_by=recent").json()
    assert [i["id"] for i in sort_recent] == [p_master.id, p_paid.id, p_due_direct.id]

    sort_name = rec_c.get(f"/api/patients?q={tag}&status=active&sort_by=name").json()
    assert [i["id"] for i in sort_name] == [p_paid.id, p_due_direct.id, p_master.id]

    sort_urn = rec_c.get(f"/api/patients?q={tag}&status=active&sort_by=urn").json()
    assert [i["id"] for i in sort_urn] == [p_due_direct.id, p_paid.id, p_master.id]

    # Fail-closed AGENTS.md #7 guard for DOCTOR
    for val in ("true", "false"):
        assert doc_c.get(f"/api/patients?has_due_balance={val}").status_code == 403
        assert doc_c.get(f"/api/patients/count?has_due_balance={val}").status_code == 403

    # DOCTOR directory response has visit stats but outstanding_paise is strictly None
    doc_items = _assert_list_count_parity(doc_c, "status=active")
    assert len(doc_items) == 3
    for item in doc_items:
        assert item["outstanding_paise"] is None
        assert item["visit_count"] == 1


def test_visit_workspace_role_redaction_q13_dws04_and_investigation_document_link(
    db_session: Session,
    test_settings: Settings,
    login_client: Any,
    admin_user: User,
    reception_user: User,
    doctor_a_user: User,
    doctor_b_user: User,
) -> None:
    """Verify full clinical bundle, Q13 charges, DWS-04 audit, D-04 redaction, and doc links."""
    patient = _create_patient(
        db_session,
        urn=f"KH-26-WS-{uuid.uuid4().hex[:5].upper()}",
        full_name="Workspace Patient",
        gender="F",
        district="Bhojpur",
    )
    other_patient = _create_patient(
        db_session,
        urn=f"KH-26-WS-{uuid.uuid4().hex[:5].upper()}",
        full_name="Other Patient",
    )

    # Seed active allergy (shown to DOCTOR & RECEPTION as alert, strictly None for ADMIN)
    db_session.add(
        PatientAllergy(
            patient_id=patient.id,
            substance="Penicillin",
            category="DRUG",
            severity="SEVERE",
            reaction="Anaphylaxis",
            clinical_notes="Avoid all beta-lactams",
            status="ACTIVE",
            doctor_id=doctor_a_user.doctor_id,
            recorded_by_user_id=doctor_a_user.id,
        )
    )

    dept = db_session.scalar(select(Department).where(Department.is_active.is_(True)))
    if dept is None:
        dept = Department(name_en="General Medicine", code="GM-WS", is_active=True)
        db_session.add(dept)
        db_session.flush()

    visit = Visit(
        patient_id=patient.id,
        visit_date=clock.ist_today(),
        status="OPEN",
        referral_source="DOCTOR",
        referrer_name="Dr. Referrer",
        opened_by_user_id=reception_user.id,
    )
    db_session.add(visit)
    db_session.flush()

    appt_a = Appointment(
        patient_id=patient.id,
        doctor_id=doctor_a_user.doctor_id,
        department_id=dept.id,
        visit_id=visit.id,
        appointment_date=clock.ist_today(),
        token_number=1,
        status="ARRIVED",
        consultation_status="COMPLETED",
        visit_kind="NEW",
        priority_level="NORMAL",
        created_by_user_id=reception_user.id,
    )
    appt_b = Appointment(
        patient_id=patient.id,
        doctor_id=doctor_b_user.doctor_id,
        department_id=dept.id,
        visit_id=visit.id,
        appointment_date=clock.ist_today(),
        token_number=2,
        status="ARRIVED",
        consultation_status="COMPLETED",
        visit_kind="NEW",
        priority_level="PRIORITY",
        priority_reason="Senior citizen priority",
        created_by_user_id=reception_user.id,
    )
    db_session.add_all([appt_a, appt_b])
    db_session.flush()

    # Doctor A encounter (draft while attaching vitals/template/diagnoses/orders, then finalised)
    enc_a = ClinicalEncounter(
        patient_id=patient.id,
        visit_id=visit.id,
        appointment_id=appt_a.id,
        doctor_id=doctor_a_user.doctor_id,
        department_id=dept.id,
        symptoms="Persistent lower back pain",
        clinical_notes="SLR positive at 45 deg",
        diagnosis="Lumbar disc herniation",
        is_finalised=False,
        created_by_user_id=doctor_a_user.id,
    )
    enc_b = ClinicalEncounter(
        patient_id=patient.id,
        visit_id=visit.id,
        appointment_id=appt_b.id,
        doctor_id=doctor_b_user.doctor_id,
        department_id=dept.id,
        symptoms="Secondary opinion",
        clinical_notes="Recommend physiotherapy",
        diagnosis="Mechanical LBP",
        is_finalised=False,
        created_by_user_id=doctor_b_user.id,
    )
    db_session.add_all([enc_a, enc_b])
    db_session.flush()

    # Vitals
    db_session.add(
        VitalObservation(
            encounter_id=enc_a.id,
            patient_id=patient.id,
            height_cm=165.0,
            weight_kg=64.0,
            systolic_bp=118,
            diastolic_bp=76,
        )
    )

    # Specialty template response
    tmpl = ClinicalTemplate(
        department_id=dept.id,
        code=f"WS_TMPL_{uuid.uuid4().hex[:4].upper()}",
        name_en="Workspace Ortho Template",
    )
    db_session.add(tmpl)
    db_session.flush()
    tmpl_ver = ClinicalTemplateVersion(
        template_id=tmpl.id,
        version_number=1,
        schema_json={"fields": []},
        approved_by="admin",
    )
    db_session.add(tmpl_ver)
    db_session.flush()
    db_session.add(
        ClinicalTemplateResponse(
            encounter_id=enc_a.id,
            template_version_id=tmpl_ver.id,
            response_data={"pain_scale": 7},
        )
    )

    # Structured diagnosis
    db_session.add(
        EncounterDiagnosis(
            encounter_id=enc_a.id,
            patient_id=patient.id,
            doctor_id=doctor_a_user.doctor_id,
            diagnosis_name="Lumbar Radiculopathy",
            icd10_code="M54.16",
            diagnosis_type="PRIMARY",
            status="ACTIVE",
        )
    )

    # Prescription with item (insert as DRAFT, attach item, then authorise)
    rx = Prescription(
        patient_id=patient.id,
        doctor_id=doctor_a_user.doctor_id,
        encounter_id=enc_a.id,
        diagnosis="Lumbar Radiculopathy",
        status="DRAFT",
    )
    db_session.add(rx)
    db_session.flush()
    db_session.add(
        PrescriptionItem(
            prescription_id=rx.id,
            item_order=1,
            medicine_name="Tab Gabapentin 300mg",
            dosage="1 tab",
            frequency="HS",
            duration_days=14,
        )
    )
    db_session.flush()
    rx.status = "AUTHORISED"
    rx.authorised_at = datetime.now(UTC)
    db_session.flush()

    # Treatment plan, follow-up, addendum
    db_session.add(
        TreatmentPlan(
            patient_id=patient.id,
            doctor_id=doctor_a_user.doctor_id,
            encounter_id=enc_a.id,
            plan_name="Lumbar Physio 10 Sessions",
            condition_diagnosis="Lumbar Radiculopathy",
            total_sessions=10,
            agreed_price_paise=400000,
        )
    )
    db_session.add(
        FollowUpRecommendation(
            encounter_id=enc_a.id,
            patient_id=patient.id,
            doctor_id=doctor_a_user.doctor_id,
            recommended_doctor_id=doctor_a_user.doctor_id,
            recommended_date=clock.ist_today() + timedelta(days=7),
            clinical_reason="Review MRI & pain response",
            status="PENDING",
        )
    )
    db_session.flush()

    # Finalise encounter A, then attach post-finalisation addendum
    enc_a.is_finalised = True
    enc_a.finalised_at = datetime.now(UTC)
    db_session.flush()
    db_session.add(
        ClinicalAddendum(
            encounter_id=enc_a.id,
            doctor_id=doctor_a_user.doctor_id,
            addendum_text="Patient advised core stabilization exercises.",
            created_by_user_id=doctor_a_user.id,
        )
    )

    # Investigation order + result linked via API to an uploaded clinical PDF document
    inv_order = InvestigationOrder(
        encounter_id=enc_a.id,
        patient_id=patient.id,
        doctor_id=doctor_a_user.doctor_id,
        category="IMAGING",
        test_name="MRI Lumbar Spine",
        priority="URGENT",
        status="ORDERED",
    )
    db_session.add(inv_order)
    db_session.flush()

    doc_a_c = login_client(doctor_a_user)
    doc_b_c = login_client(doctor_b_user)
    rec_c = login_client(reception_user)
    admin_c = login_client(admin_user)

    # Upload valid clinical PDF for investigation result link
    doc_up = doc_a_c.post(
        f"/api/patients/{patient.id}/documents",
        files={"file": ("mri_lumbar.pdf", PDF_BYTES, "application/pdf")},
        data={
            "title": "MRI Lumbar Spine Report",
            "category": "IMAGING",
            "visit_id": str(visit.id),
            "encounter_id": str(enc_a.id),
        },
    )
    assert doc_up.status_code == 201, doc_up.text
    linked_doc_id = doc_up.json()["id"]

    # Also test invalid document_id links on POST /api/investigations/{order_id}/results
    # 1. Non-existent document -> 404
    missing_doc_res = doc_a_c.post(
        f"/api/investigations/{inv_order.id}/results",
        json={"summary_text": "Missing doc", "document_id": 999999999},
    )
    assert missing_doc_res.status_code == 404

    # 2. Other patient's document -> 422
    other_doc = PatientDocument(
        patient_id=other_patient.id,
        title="Other Patient Report",
        category="IMAGING",
        is_clinical=True,
        original_filename="other.pdf",
        stored_filename=f"{uuid.uuid4().hex}.pdf",
        mime_type="application/pdf",
        file_size_bytes=len(PDF_BYTES),
        sha256_hex=hashlib.sha256(PDF_BYTES).hexdigest(),
        uploaded_by_user_id=doctor_a_user.id,
        doctor_id=doctor_a_user.doctor_id,
        is_archived=False,
    )
    (test_settings.documents_dir / other_doc.stored_filename).write_bytes(PDF_BYTES)
    db_session.add(other_doc)

    # 3. Archived document -> 422
    archived_doc = PatientDocument(
        patient_id=patient.id,
        title="Archived Report",
        category="IMAGING",
        is_clinical=True,
        original_filename="arch.pdf",
        stored_filename=f"{uuid.uuid4().hex}.pdf",
        mime_type="application/pdf",
        file_size_bytes=len(PDF_BYTES),
        sha256_hex=hashlib.sha256(PDF_BYTES).hexdigest(),
        uploaded_by_user_id=doctor_a_user.id,
        doctor_id=doctor_a_user.doctor_id,
        is_archived=True,
        archived_at=datetime.now(UTC),
        archived_by_user_id=doctor_a_user.id,
    )
    (test_settings.documents_dir / archived_doc.stored_filename).write_bytes(PDF_BYTES)
    db_session.add(archived_doc)
    db_session.flush()

    assert (
        doc_a_c.post(
            f"/api/investigations/{inv_order.id}/results",
            json={"summary_text": "Wrong patient", "document_id": other_doc.id},
        ).status_code
        == 422
    )
    assert (
        doc_a_c.post(
            f"/api/investigations/{inv_order.id}/results",
            json={"summary_text": "Archived doc", "document_id": archived_doc.id},
        ).status_code
        == 422
    )

    # Valid investigation result with linked document_id -> 201
    res_create = doc_a_c.post(
        f"/api/investigations/{inv_order.id}/results",
        json={
            "summary_text": "L4-L5 posterolateral disc bulge",
            "is_abnormal": True,
            "document_id": linked_doc_id,
        },
    )
    assert res_create.status_code == 201, res_create.text
    assert res_create.json()["document_id"] == linked_doc_id
    assert res_create.json()["document_title"] == "MRI Lumbar Spine Report"

    # Billing lines: Doctor A consult + Doctor A procedure + Doctor B consult + Reception line
    db_session.add_all(
        [
            BillItem(
                visit_id=visit.id,
                patient_id=patient.id,
                appointment_id=appt_a.id,
                category=BillItemCategory.CONSULTATION.value,
                source=BillItemSource.SYSTEM.value,
                status=BillItemStatus.ACTIVE.value,
                description="Doctor A Consultation",
                quantity=Decimal("1"),
                rate_paise=50000,
                original_amount_paise=50000,
                amount_paise=50000,
                created_by_user_id=reception_user.id,
            ),
            BillItem(
                visit_id=visit.id,
                patient_id=patient.id,
                appointment_id=appt_a.id,
                category=BillItemCategory.PROCEDURE.value,
                source=BillItemSource.DOCTOR.value,
                status=BillItemStatus.ACTIVE.value,
                description="Doctor A Dry Needling",
                quantity=Decimal("1"),
                rate_paise=25000,
                original_amount_paise=25000,
                amount_paise=25000,
                created_by_user_id=doctor_a_user.id,
            ),
            BillItem(
                visit_id=visit.id,
                patient_id=patient.id,
                appointment_id=appt_b.id,
                category=BillItemCategory.CONSULTATION.value,
                source=BillItemSource.SYSTEM.value,
                status=BillItemStatus.ACTIVE.value,
                description="Doctor B Consultation",
                quantity=Decimal("1"),
                rate_paise=40000,
                original_amount_paise=40000,
                amount_paise=40000,
                created_by_user_id=reception_user.id,
            ),
            BillItem(
                visit_id=visit.id,
                patient_id=patient.id,
                appointment_id=None,
                category=BillItemCategory.MEDICINE.value,
                source=BillItemSource.RECEPTION.value,
                status=BillItemStatus.ACTIVE.value,
                description="Reception Brace",
                quantity=Decimal("1"),
                rate_paise=30000,
                original_amount_paise=30000,
                amount_paise=30000,
                created_by_user_id=reception_user.id,
            ),
        ]
    )
    payment = Payment(
        receipt_number=f"RCP-WS-{uuid.uuid4().hex[:6].upper()}",
        patient_id=patient.id,
        visit_id=visit.id,
        amount_paise=100000,
        payment_method="CASH",
        is_reversed=False,
        created_by_user_id=reception_user.id,
    )
    db_session.add(payment)
    db_session.flush()
    db_session.add(
        Refund(
            refund_number=f"RFN-WS-{uuid.uuid4().hex[:6].upper()}",
            payment_id=payment.id,
            patient_id=patient.id,
            visit_id=visit.id,
            amount_paise=10000,
            refund_method="CASH",
            reason="Partial fee waiver",
            refunded_by_user_id=admin_user.id,
        )
    )
    db_session.flush()

    ws_url = f"/api/patients/{patient.id}/visits/{visit.id}/workspace"

    # --- 1. DOCTOR A view ---
    cross_before = len(
        db_session.scalars(
            select(AuditLog).where(
                AuditLog.action == AuditAction.CROSS_DOCTOR_CLINICAL_READ.value
            )
        ).all()
    )
    doc_a_resp = doc_a_c.get(ws_url)
    assert doc_a_resp.status_code == 200, doc_a_resp.text
    ws_a = doc_a_resp.json()

    assert ws_a["financial_summary"] is None
    assert ws_a["patient"]["allergy_alert"]["has_allergies"] is True
    assert ws_a["patient"]["allergy_alert"]["highest_severity"] == "SEVERE"
    assert ws_a["visit"]["visit_id"] == visit.id
    assert ws_a["visit"]["referral_source"] == "DOCTOR"
    assert ws_a["visit"]["token_numbers"] == [1, 2]

    by_appt_a = {c["appointment_id"]: c for c in ws_a["consultations"]}
    c_a = by_appt_a[appt_a.id]
    c_b = by_appt_a[appt_b.id]

    assert c_a["encounter_id"] == enc_a.id
    assert c_a["is_finalised"] is True
    assert c_a["vitals"]["systolic_bp"] == 118
    assert c_a["symptoms"] == "Persistent lower back pain"
    assert c_a["template_response_summary"]["response_data"] == {"pain_scale": 7}
    assert len(c_a["diagnoses"]) == 1
    assert c_a["diagnoses"][0]["icd10_code"] == "M54.16"
    assert len(c_a["investigations"]) == 1
    assert c_a["investigations"][0]["results"][0]["document_id"] == linked_doc_id
    assert c_a["investigations"][0]["results"][0]["document_title"] == "MRI Lumbar Spine Report"
    assert len(c_a["prescriptions"]) == 1
    assert c_a["prescriptions"][0]["items"][0]["medicine_name"] == "Tab Gabapentin 300mg"
    assert len(c_a["treatment_plans"]) == 1
    assert c_a["follow_up"]["status"] == "PENDING"
    assert len(c_a["addenda"]) == 1

    # Q13 charge boundary: Doctor A sees ONLY own charges, NOT reception medicine or Doctor B fee
    assert {ch["description"] for ch in c_a["clinical_charges"]} == {
        "Doctor A Consultation",
        "Doctor A Dry Needling",
    }
    assert c_b["encounter_id"] == enc_b.id
    assert c_b["clinical_charges"] == []

    # DWS-04 audit logged because Doctor A read Doctor B's encounter in the workspace
    cross_after_a = db_session.scalars(
        select(AuditLog).where(AuditLog.action == AuditAction.CROSS_DOCTOR_CLINICAL_READ.value)
    ).all()
    assert len(cross_after_a) > cross_before
    assert any(
        a.after_data.get("source") == "visit_workspace_encounters"
        and a.after_data.get("actor_doctor_id") == doctor_a_user.doctor_id
        for a in cross_after_a
    )

    # --- 2. DOCTOR B view (symmetric Q13 check) ---
    doc_b_resp = doc_b_c.get(ws_url)
    assert doc_b_resp.status_code == 200
    ws_b = doc_b_resp.json()
    assert ws_b["financial_summary"] is None
    by_appt_b = {c["appointment_id"]: c for c in ws_b["consultations"]}
    assert by_appt_b[appt_a.id]["clinical_charges"] == []
    assert [ch["description"] for ch in by_appt_b[appt_b.id]["clinical_charges"]] == [
        "Doctor B Consultation"
    ]

    # --- 3. RECEPTION view (full financial, allergy safety alert, ZERO clinical fields) ---
    rec_resp = rec_c.get(ws_url)
    assert rec_resp.status_code == 200, rec_resp.text
    ws_rec = rec_resp.json()

    assert ws_rec["patient"]["allergy_alert"]["has_allergies"] is True
    assert ws_rec["patient"]["allergy_alert"]["highest_severity"] == "SEVERE"
    fin = ws_rec["financial_summary"]
    assert fin is not None
    # Billed = 145000; gross paid = 100000, refunded = 10000 => net paid = 90000, due = 55000
    assert fin["bill_total_paise"] == 145000
    assert fin["paid_paise"] == 90000
    assert fin["refunded_paise"] == 10000
    assert fin["due_paise"] == 55000
    assert len(fin["payments"]) == 1
    assert len(fin["refunds"]) == 1
    assert len(ws_rec["consultations"]) == 2
    for consult in ws_rec["consultations"]:
        for field in CLINICAL_CONSULTATION_FIELDS:
            assert consult[field] is None, f"RECEPTION leaked clinical field '{field}'"

    # --- 4. ADMIN view (full financial, allergy_alert=None, ZERO clinical fields) ---
    admin_resp = admin_c.get(ws_url)
    assert admin_resp.status_code == 200, admin_resp.text
    ws_adm = admin_resp.json()
    assert ws_adm["patient"]["allergy_alert"] is None
    assert ws_adm["financial_summary"]["bill_total_paise"] == 145000
    assert ws_adm["financial_summary"]["due_paise"] == 55000
    for consult in ws_adm["consultations"]:
        for field in CLINICAL_CONSULTATION_FIELDS:
            assert consult[field] is None, f"ADMIN leaked clinical field '{field}'"

    # --- 5. Unrelated patient gets 404 ---
    wrong_pat = rec_c.get(f"/api/patients/{other_patient.id}/visits/{visit.id}/workspace")
    assert wrong_pat.status_code == 404
