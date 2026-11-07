"""Role-by-endpoint RBAC authorization matrix, completeness gate, and data leak tests.

Guarantees:
- Every non-public endpoint passes access checks according to default-deny RBAC policy.
- Completeness gate ensures no newly registered route ships without a verified matrix row.
- Recursive body scanner verifies no secrets or unauthorized tokens leak in 2xx responses.
- Doctor dashboard isolation verifies doctor A and doctor B only observe their own identities.
"""

import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from conftest import make_user
from fastapi import Depends, FastAPI
from sqlalchemy import select
from sqlalchemy.orm import Session
from support.matrix import (
    IDENTITIES,
    MATRIX,
    MatrixRow,
    build_isolated_client,
    check_matrix_completeness,
)

from kalyan_api.config import Settings
from kalyan_api.core.permissions import Permission
from kalyan_api.core.policy import require
from kalyan_api.models import (
    Appointment,
    AuthSession,
    BackupSettings,
    ClinicalEncounter,
    ClinicSettings,
    ConsultationFee,
    Doctor,
    Patient,
    Payment,
    Prescription,
    SecuritySettings,
    SystemSetup,
    TreatmentPlan,
    TreatmentSession,
    User,
)

FORBIDDEN_SECRET_KEYS: tuple[str, ...] = (
    "password_hash",
    "current_password",
    "new_password",
    "token",
)

MATRIX_CASES: list[tuple[MatrixRow, str]] = [
    (row, identity) for row in MATRIX for identity in IDENTITIES
]


def _scan_for_forbidden_keys(payload: Any, path: str) -> None:
    """Recursively ensure responses do not echo sensitive credentials or improper tokens."""
    forbidden = set(FORBIDDEN_SECRET_KEYS)
    if path not in ("/api/auth/login", "/api/auth/change-password", "/api/auth/me"):
        forbidden.add("csrf_token")

    if isinstance(payload, dict):
        for k, v in payload.items():
            assert k not in forbidden, f"Forbidden key '{k}' exposed in response from {path}"
            _scan_for_forbidden_keys(v, path)
    elif isinstance(payload, list):
        for item in payload:
            _scan_for_forbidden_keys(item, path)


def test_matrix_case_count_equals_rows_times_identities() -> None:
    """Assert total matrix test cases equal rows multiplied by 5 test identities."""
    assert len(MATRIX_CASES) == len(MATRIX) * len(IDENTITIES)
    assert len(MATRIX_CASES) == len(MATRIX) * 5


def test_matrix_completeness_gate(app: FastAPI) -> None:
    """Every registered non-public endpoint in the application must exist in the matrix."""
    uncovered = check_matrix_completeness(app, MATRIX)
    assert not uncovered, f"Endpoints missing from RBAC matrix: {uncovered}"


def test_matrix_completeness_negative_control() -> None:
    """Completeness gate must flag an unlisted protected endpoint on a throwaway application."""
    dummy_app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @dummy_app.get(
        "/api/unlisted-protected",
        dependencies=[Depends(require(Permission.USER_READ))],
    )
    def unlisted_route() -> dict[str, str]:
        return {"status": "ok"}

    uncovered = check_matrix_completeness(dummy_app, MATRIX)
    assert "GET /api/unlisted-protected" in uncovered


@pytest.mark.parametrize(
    "row,identity",
    MATRIX_CASES,
    ids=[f"{r.method}_{r.path}_{i}" for r, i in MATRIX_CASES],
)
def test_rbac_matrix_cell(
    app: FastAPI,
    db_session: Session,
    test_settings: Settings,
    login_client: Any,
    row: MatrixRow,
    identity: str,
) -> None:
    """Execute RBAC authorization test cell with an isolated client and verify response status."""
    client, current_user = build_isolated_client(
        app, db_session, test_settings, login_client, identity, make_user
    )

    target_entity: Any = None
    resolved_path = row.path

    if row.path.startswith("/api/setup"):
        # Setup matrix preconditions: system_setup completed row exists
        existing_setup = db_session.scalar(select(SystemSetup).where(SystemSetup.id == 1))
        if not existing_setup:
            setup_admin = make_user(
                db_session, test_settings, "ADMIN", f"mat_adm_{uuid.uuid4().hex[:6]}"
            )
            db_session.add(
                SystemSetup(
                    id=1,
                    completed_at=datetime.now(UTC),
                    admin_user_id=setup_admin.id,
                )
            )
            db_session.flush()

    elif row.path == "/api/settings":
        target_entity = db_session.scalar(select(ClinicSettings).where(ClinicSettings.id == 1))

    elif row.path == "/api/operations/backup-settings":
        target_entity = db_session.scalar(select(BackupSettings).where(BackupSettings.id == 1))

    elif row.path == "/api/security/policy":
        target_entity = db_session.scalar(select(SecuritySettings).where(SecuritySettings.id == 1))

    elif "{session_id}" in row.path:
        from datetime import timedelta

        other_user = make_user(
            db_session, test_settings, "RECEPTION", f"sess_tgt_{uuid.uuid4().hex[:6]}"
        )
        sess = AuthSession(
            user_id=other_user.id,
            token_hash=f"token_hash_{uuid.uuid4().hex}",
            csrf_token=f"csrf_{uuid.uuid4().hex}",
            created_at=datetime.now(UTC),
            last_seen_at=datetime.now(UTC),
        )
        db_session.add(sess)
        db_session.flush()
        resolved_path = row.path.replace("{session_id}", str(sess.id))

    elif "{filename}" in row.path:
        from kalyan_api.services.backup_service import create_backup

        test_settings.backup_dir.mkdir(parents=True, exist_ok=True)
        archive = create_backup(
            destination_dir=test_settings.backup_dir, label="matrix_verify", settings=test_settings
        )
        resolved_path = row.path.replace("{filename}", archive.name)

    elif row.path == "/api/patients/check-duplicate":
        resolved_path = "/api/patients/check-duplicate?name=Test&mobile=9876543210"

    elif "/api/doctors/{id}" in row.path:
        doc = Doctor(name_en=f"Dr. Target {uuid.uuid4().hex[:6]}", default_fee_paise=30000)
        db_session.add(doc)
        db_session.flush()
        target_entity = doc
        resolved_path = row.path.replace("{id}", str(doc.id))

    elif "/api/fees/{id}" in row.path:
        fee = ConsultationFee(name=f"Fee Target {uuid.uuid4().hex[:6]}", fee_paise=20000)
        db_session.add(fee)
        db_session.flush()
        target_entity = fee
        resolved_path = row.path.replace("{id}", str(fee.id))

    elif "/api/patients/{id}" in row.path:
        pat = Patient(
            urn=f"KH-2026-{uuid.uuid4().hex[:4]}",
            full_name="Matrix Patient",
            guardian_name="Guardian",
            gender="M",
            age_years=30,
            mobile="9876543210",
            address="Ara",
            district="Bhojpur",
            state="Bihar",
            allergies="None reported",
        )
        if "photo" in row.path:
            test_settings.photos_dir.mkdir(parents=True, exist_ok=True)
            photo_name = f"{uuid.uuid4().hex}.jpg"
            (test_settings.photos_dir / photo_name).write_bytes(b"\xff\xd8\xff\xe0testjpeg")
            pat.photo_path = photo_name

        db_session.add(pat)
        db_session.flush()
        target_entity = pat
        resolved_path = row.path.replace("{id}", str(pat.id))

    elif "/api/appointments" in row.path:
        # Resolve doctor_a to own the appointment
        doc_a_user = db_session.scalar(select(User).where(User.username.like("mat_doc_a%")))
        doc_a_id = doc_a_user.doctor_id if doc_a_user else None
        if not doc_a_id:
            doc = Doctor(name_en=f"Dr. Appt {uuid.uuid4().hex[:6]}", default_fee_paise=30000)
            db_session.add(doc)
            db_session.flush()
            doc_a_id = doc.id

        pat = Patient(
            urn=f"KH-2026-{uuid.uuid4().hex[:4]}",
            full_name="Matrix Patient",
            guardian_name="Guardian",
            gender="M",
            age_years=30,
            mobile="9876543210",
            address="Ara",
            district="Bhojpur",
            state="Bihar",
        )
        db_session.add(pat)
        db_session.flush()
        if "{id}" in row.path:
            admin_u = make_user(db_session, test_settings, "ADMIN", f"adm_{uuid.uuid4().hex[:6]}")
            appt = Appointment(
                patient_id=pat.id,
                doctor_id=doc_a_id,
                appointment_date=datetime.now(UTC).date(),
                token_number=1,
                status="BOOKED",
                created_by_user_id=admin_u.id,
            )
            db_session.add(appt)
            db_session.flush()
            target_entity = appt
            resolved_path = row.path.replace("{id}", str(appt.id))
        else:
            target_entity = type("TargetAppt", (), {"patient_id": pat.id, "doctor_id": doc_a_id})()

    elif "/api/patients/{patient_id}/" in row.path:
        pat = Patient(
            urn=f"KH-2026-{uuid.uuid4().hex[:4]}",
            full_name="Matrix Patient",
            guardian_name="Guardian",
            gender="M",
            age_years=30,
            mobile="9876543210",
            address="Ara",
            district="Bhojpur",
            state="Bihar",
        )
        db_session.add(pat)
        db_session.flush()
        target_entity = pat
        resolved_path = row.path.replace("{patient_id}", str(pat.id))

    elif "/api/prescriptions" in row.path:
        doc_a_user = db_session.scalar(select(User).where(User.username.like("mat_doc_a%")))
        doc_a_id = doc_a_user.doctor_id if doc_a_user else None
        if not doc_a_id:
            doc = Doctor(name_en=f"Dr. Rx {uuid.uuid4().hex[:6]}")
            db_session.add(doc)
            db_session.flush()
            doc_a_id = doc.id

        pat = Patient(
            urn=f"KH-2026-{uuid.uuid4().hex[:4]}",
            full_name="Matrix Patient",
            guardian_name="Guardian",
            gender="M",
            age_years=30,
            mobile="9876543210",
            address="Ara",
            district="Bhojpur",
            state="Bihar",
        )
        db_session.add(pat)
        db_session.flush()

        if "{id}" in row.path:
            rx = Prescription(
                patient_id=pat.id,
                doctor_id=doc_a_id,
                diagnosis="Matrix Diagnosis",
                status="DRAFT",
            )
            db_session.add(rx)
            db_session.flush()
            from kalyan_api.models import PrescriptionItem

            item = PrescriptionItem(
                prescription_id=rx.id,
                item_order=1,
                medicine_name="Paracetamol 500mg",
                dosage="1 tablet",
                frequency="TDS",
                duration_days=5,
            )
            db_session.add(item)
            db_session.flush()
            target_entity = rx
            resolved_path = row.path.replace("{id}", str(rx.id))
        else:
            target_entity = type("TargetRx", (), {"patient_id": pat.id})()

    elif "/api/treatment-plans" in row.path:
        doc_a_user = db_session.scalar(select(User).where(User.username.like("mat_doc_a%")))
        doc_a_id = doc_a_user.doctor_id if doc_a_user else None
        if not doc_a_id:
            doc = Doctor(name_en=f"Dr. TP {uuid.uuid4().hex[:6]}")
            db_session.add(doc)
            db_session.flush()
            doc_a_id = doc.id

        pat = Patient(
            urn=f"KH-2026-{uuid.uuid4().hex[:4]}",
            full_name="Matrix Patient",
            guardian_name="Guardian",
            gender="M",
            age_years=30,
            mobile="9876543210",
            address="Ara",
            district="Bhojpur",
            state="Bihar",
        )
        db_session.add(pat)
        db_session.flush()

        plan = TreatmentPlan(
            patient_id=pat.id,
            doctor_id=doc_a_id,
            plan_name="Matrix Plan",
            condition_diagnosis="Low back pain",
            total_sessions=10,
            agreed_price_paise=500000,
        )
        db_session.add(plan)
        db_session.flush()
        target_entity = plan
        if "{id}" in row.path:
            resolved_path = row.path.replace("{id}", str(plan.id))
        elif "{plan_id}" in row.path:
            resolved_path = row.path.replace("{plan_id}", str(plan.id))
        else:
            target_entity = type(
                "TargetPlan", (), {"patient_id": pat.id, "version_id": plan.version_id}
            )()

    elif "/api/treatment-sessions" in row.path:
        doc_a_user = db_session.scalar(select(User).where(User.username.like("mat_doc_a%")))
        doc_a_id = doc_a_user.doctor_id if doc_a_user else None
        if not doc_a_id:
            doc = Doctor(name_en=f"Dr. TS {uuid.uuid4().hex[:6]}")
            db_session.add(doc)
            db_session.flush()
            doc_a_id = doc.id

        pat = Patient(
            urn=f"KH-2026-{uuid.uuid4().hex[:4]}",
            full_name="Matrix Patient",
            guardian_name="Guardian",
            gender="M",
            age_years=30,
            mobile="9876543210",
            address="Ara",
            district="Bhojpur",
            state="Bihar",
        )
        db_session.add(pat)
        db_session.flush()

        plan = TreatmentPlan(
            patient_id=pat.id,
            doctor_id=doc_a_id,
            plan_name="Matrix Plan",
            condition_diagnosis="Low back pain",
            total_sessions=10,
            agreed_price_paise=500000,
        )
        db_session.add(plan)
        db_session.flush()

        admin_u = make_user(db_session, test_settings, "ADMIN", f"adm_{uuid.uuid4().hex[:6]}")
        sess = TreatmentSession(
            treatment_plan_id=plan.id,
            patient_id=pat.id,
            doctor_id=doc_a_id,
            session_number=1,
            vas_score=7,
            clinical_notes="Matrix session notes",
            is_finalised=True,
            created_by_user_id=admin_u.id,
        )
        db_session.add(sess)
        db_session.flush()
        target_entity = sess
        if "{id}" in row.path:
            resolved_path = row.path.replace("{id}", str(sess.id))

    elif "/api/payments" in row.path:
        pat = Patient(
            urn=f"KH-2026-{uuid.uuid4().hex[:4]}",
            full_name="Matrix Patient",
            guardian_name="Guardian",
            gender="M",
            age_years=30,
            mobile="9876543210",
            address="Ara",
            district="Bhojpur",
            state="Bihar",
        )
        db_session.add(pat)
        db_session.flush()

        admin_u = make_user(db_session, test_settings, "ADMIN", f"adm_{uuid.uuid4().hex[:6]}")
        payment = Payment(
            receipt_number=f"RCP-2026-{uuid.uuid4().hex[:6].upper()}",
            patient_id=pat.id,
            amount_paise=50000,
            payment_method="CASH",
            is_reversed=False,
            created_by_user_id=admin_u.id,
        )
        db_session.add(payment)
        db_session.flush()

        target_entity = payment
        if "{id}" in row.path:
            resolved_path = row.path.replace("{id}", str(payment.id))
        else:
            target_entity = type("TargetPayment", (), {"patient_id": pat.id})()

    elif "/api/encounters" in row.path:
        # Encounters are owned by doctor_a to test cross-doctor silo (doctor_b receives 404)
        doc_a_user = db_session.scalar(select(User).where(User.username.like("mat_doc_a%")))
        doc_a_id = doc_a_user.doctor_id if doc_a_user else None
        if not doc_a_id:
            doc = Doctor(name_en=f"Dr. Enc {uuid.uuid4().hex[:6]}")
            db_session.add(doc)
            db_session.flush()
            doc_a_id = doc.id

        pat = Patient(
            urn=f"KH-2026-{uuid.uuid4().hex[:4]}",
            full_name="Matrix Patient",
            guardian_name="Guardian",
            gender="M",
            age_years=30,
            mobile="9876543210",
            address="Ara",
            district="Bhojpur",
            state="Bihar",
        )
        db_session.add(pat)
        db_session.flush()

        if "{id}" in row.path or "{encounter_id}" in row.path:
            admin_u = make_user(db_session, test_settings, "ADMIN", f"adm_{uuid.uuid4().hex[:6]}")
            is_fin = "addenda" in row.path
            enc = ClinicalEncounter(
                patient_id=pat.id,
                doctor_id=doc_a_id,
                symptoms="Back pain",
                clinical_notes="Notes",
                diagnosis="Diagnosis",
                is_finalised=is_fin,
                finalised_at=datetime.now(UTC) if is_fin else None,
                created_by_user_id=admin_u.id,
            )
            db_session.add(enc)
            db_session.flush()

            if "template-response" in row.path:
                from kalyan_api.models import ClinicalTemplate, ClinicalTemplateResponse, ClinicalTemplateVersion, Department
                dept = db_session.scalar(select(Department).where(Department.code == "GENERAL"))
                if not dept:
                    dept = Department(code="GENERAL", name_en="General Medicine")
                    db_session.add(dept)
                    db_session.flush()
                tmpl = db_session.scalar(select(ClinicalTemplate).where(ClinicalTemplate.code == "PHYSIO"))
                if not tmpl:
                    tmpl = ClinicalTemplate(department_id=dept.id, code="PHYSIO", name_en="Physio Template")
                    db_session.add(tmpl)
                    db_session.flush()
                ver = db_session.scalar(select(ClinicalTemplateVersion).where(ClinicalTemplateVersion.template_id == tmpl.id))
                if not ver:
                    ver = ClinicalTemplateVersion(
                        template_id=tmpl.id,
                        version_number=1,
                        schema_json={"fields": []},
                        approved_by="admin",
                    )
                    db_session.add(ver)
                    db_session.flush()
                if row.method == "GET":
                    resp_obj = ClinicalTemplateResponse(encounter_id=enc.id, template_version_id=ver.id, response_data={"findings": "Normal"})
                    db_session.add(resp_obj)
                    db_session.flush()
                enc.template_version_id = ver.id

            if "vitals" in row.path:
                from kalyan_api.models import VitalObservation
                if row.method == "GET":
                    v = VitalObservation(encounter_id=enc.id, patient_id=pat.id, height_cm=170.0, weight_kg=70.0)
                    db_session.add(v)
                    db_session.flush()

            if "follow-up" in row.path and row.method == "GET":
                from kalyan_api.models import FollowUpRecommendation
                rec = FollowUpRecommendation(
                    encounter_id=enc.id,
                    patient_id=pat.id,
                    doctor_id=doc_a_id,
                    recommended_doctor_id=doc_a_id,
                    recommended_date=datetime.now(UTC).date(),
                    clinical_reason="Check progress",
                    status="PENDING",
                )
                db_session.add(rec)
                db_session.flush()

            target_entity = enc
            resolved_path = row.path.replace("{id}", str(enc.id)).replace("{encounter_id}", str(enc.id))
        else:
            target_entity = type("TargetEnc", (), {"patient_id": pat.id, "appointment_id": None})()

    elif "/api/follow-ups" in row.path:
        doc_a_user = db_session.scalar(select(User).where(User.username.like("mat_doc_a%")))
        doc_a_id = doc_a_user.doctor_id if doc_a_user else None
        if not doc_a_id:
            doc = Doctor(name_en=f"Dr. FUp {uuid.uuid4().hex[:6]}")
            db_session.add(doc)
            db_session.flush()
            doc_a_id = doc.id

        pat = Patient(
            urn=f"KH-2026-{uuid.uuid4().hex[:4]}",
            full_name="Matrix Patient",
            guardian_name="Guardian",
            gender="M",
            age_years=30,
            mobile="9876543210",
            address="Ara",
            district="Bhojpur",
            state="Bihar",
        )
        db_session.add(pat)
        db_session.flush()

        admin_u = make_user(db_session, test_settings, "ADMIN", f"adm_{uuid.uuid4().hex[:6]}")
        enc = ClinicalEncounter(
            patient_id=pat.id,
            doctor_id=doc_a_id,
            symptoms="Back pain",
            clinical_notes="Notes",
            diagnosis="Diagnosis",
            created_by_user_id=admin_u.id,
        )
        db_session.add(enc)
        db_session.flush()

        from kalyan_api.models import FollowUpRecommendation
        rec = FollowUpRecommendation(
            encounter_id=enc.id,
            patient_id=pat.id,
            doctor_id=doc_a_id,
            recommended_doctor_id=doc_a_id,
            recommended_date=datetime.now(UTC).date(),
            clinical_reason="Routine checkup",
            status="PENDING",
        )
        db_session.add(rec)
        db_session.flush()
        target_entity = rec
        resolved_path = row.path.replace("{id}", str(rec.id))

    elif "/api/templates" in row.path:
        from kalyan_api.models import ClinicalTemplate, ClinicalTemplateVersion
        from kalyan_api.routers.templates import ensure_specialty_templates_seeded
        ensure_specialty_templates_seeded(db_session)
        tmpl = db_session.scalar(select(ClinicalTemplate).where(ClinicalTemplate.code == "PHYSIOTHERAPY"))
        version = db_session.scalar(select(ClinicalTemplateVersion).where(ClinicalTemplateVersion.template_id == tmpl.id))
        resolved_path = (
            row.path
            .replace("{department_id}", str(tmpl.department_id))
            .replace("{version_id}", str(version.id))
        )
        target_entity = None

    elif "/api/admin/patients" in row.path:
        pat = Patient(
            urn=f"KH-2026-{uuid.uuid4().hex[:4]}",
            full_name="Matrix Admin Patient",
            guardian_name="Guardian",
            gender="M",
            age_years=30,
            mobile="9876543210",
            address="Ara",
            district="Bhojpur",
            state="Bihar",
        )
        db_session.add(pat)
        db_session.flush()
        target_entity = pat
        if "{id}" in row.path:
            resolved_path = row.path.replace("{id}", str(pat.id))
        elif "search" in row.path:
            resolved_path = "/api/admin/patients/search?q=Matrix"

    elif "{asset_id}" in row.path:
        from kalyan_api.models import HospitalAsset

        admin_u = make_user(db_session, test_settings, "ADMIN", f"adm_{uuid.uuid4().hex[:6]}")
        test_settings.assets_dir.mkdir(parents=True, exist_ok=True)
        asset_fname = f"asset_{uuid.uuid4().hex[:6]}.png"
        (test_settings.assets_dir / asset_fname).write_bytes(
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4"
        )
        asset = HospitalAsset(
            asset_type="LOGO",
            filename=asset_fname,
            original_filename="logo.png",
            mime_type="image/png",
            file_size_bytes=33,
            is_active=True,
            version=1,
            uploaded_by_user_id=admin_u.id,
        )
        db_session.add(asset)
        db_session.flush()
        target_entity = asset
        resolved_path = row.path.replace("{asset_id}", str(asset.id))

    elif "{batch_id}" in row.path:
        from kalyan_api.models import PatientImportBatch

        admin_u = make_user(db_session, test_settings, "ADMIN", f"adm_{uuid.uuid4().hex[:6]}")
        batch = PatientImportBatch(
            batch_id=str(uuid.uuid4()),
            filename="matrix_import.csv",
            total_rows=1,
            status="STAGED",
            created_by_user_id=admin_u.id,
        )
        db_session.add(batch)
        db_session.flush()
        target_entity = batch
        resolved_path = row.path.replace("{batch_id}", batch.batch_id)

    elif "{doc_type}" in row.path:
        from kalyan_api.models import PrintTemplate
        from kalyan_api.routers.templates import ensure_print_templates_seeded

        admin_u = make_user(db_session, test_settings, "ADMIN", f"adm_{uuid.uuid4().hex[:6]}")
        ensure_print_templates_seeded(db_session, admin_u.id)
        tmpl = db_session.scalar(
            select(PrintTemplate).where(PrintTemplate.document_type == "prescription")
        )
        target_entity = tmpl
        resolved_path = row.path.replace("{doc_type}", "prescription")

    elif "{id}" in row.path:
        is_active = "reactivate" not in row.path
        target_user = make_user(
            db_session,
            test_settings,
            "RECEPTION",
            f"mat_tgt_{uuid.uuid4().hex[:6]}",
            is_active=is_active,
        )
        if "unlock" in row.path:
            from datetime import timedelta

            target_user.locked_until = datetime.now(UTC) + timedelta(minutes=15)
            target_user.failed_login_count = 5
            db_session.flush()

        target_entity = target_user
        resolved_path = row.path.replace("{id}", str(target_user.id))

    body = row.body_factory(target_entity) if row.body_factory else None
    if "photo" in row.path and row.method == "POST":
        resp = client.request(
            row.method,
            resolved_path,
            files={"file": ("test.jpg", b"\xff\xd8\xff\xe0testjpeg", "image/jpeg")},
        )
    elif row.path == "/api/admin/assets" and row.method == "POST":
        test_settings.assets_dir.mkdir(parents=True, exist_ok=True)
        resp = client.request(
            row.method,
            resolved_path,
            files={
                "file": (
                    "test.png",
                    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4",
                    "image/png",
                )
            },
            data={"asset_type": "LOGO"},
        )
    elif row.path == "/api/admin/imports/inspect" and row.method == "POST":
        resp = client.request(
            row.method,
            resolved_path,
            files={"file": ("test.csv", b"full_name,mobile\nA,9876543210\n", "text/csv")},
        )
    elif row.path == "/api/admin/imports" and row.method == "POST":
        resp = client.request(
            row.method,
            resolved_path,
            files={"file": ("test.csv", b"full_name,mobile\nA,9876543210\n", "text/csv")},
            data={"column_mapping": "{}"},
        )
    else:
        resp = client.request(row.method, resolved_path, json=body)

    expected_status = row.expected[identity]
    assert resp.status_code == expected_status, (
        f"{identity} {row.method} {row.path} returned {resp.status_code}, "
        f"expected {expected_status}: {resp.text}"
    )

    # Verify no secrets leak in any successful response
    if resp.is_success and resp.content:
        content_type = resp.headers.get("content-type", "")
        if "application/json" in content_type:
            _scan_for_forbidden_keys(resp.json(), row.path)


def test_doctor_overview_isolation(
    app: FastAPI,
    db_session: Session,
    test_settings: Settings,
    login_client: Any,
) -> None:
    """Doctor A and Doctor B overview responses must only include their own doctor ID and name."""
    client_a, user_a = build_isolated_client(
        app, db_session, test_settings, login_client, "doctor_a", make_user
    )
    client_b, user_b = build_isolated_client(
        app, db_session, test_settings, login_client, "doctor_b", make_user
    )

    assert user_a is not None and user_b is not None
    assert user_a.doctor_id != user_b.doctor_id

    res_a = client_a.get("/api/doctor/overview")
    assert res_a.status_code == 200
    data_a = res_a.json()
    assert data_a["doctor_id"] == user_a.doctor_id
    assert user_a.doctor is not None
    assert data_a["doctor_name_en"] == user_a.doctor.name_en
    assert data_a["doctor_id"] != user_b.doctor_id

    res_b = client_b.get("/api/doctor/overview")
    assert res_b.status_code == 200
    data_b = res_b.json()
    assert data_b["doctor_id"] == user_b.doctor_id
    assert user_b.doctor is not None
    assert data_b["doctor_name_en"] == user_b.doctor.name_en
    assert data_b["doctor_id"] != user_a.doctor_id
