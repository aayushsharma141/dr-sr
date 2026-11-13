"""
End-to-End Offline Rehearsal Test for Kalyan Hospital Software.
Simulates complete clinical lifecycle under strict zero-network conditions:
Auth -> Patient -> Case -> Session -> Payment -> Print -> Backup -> Restore.
"""

import socket
import pytest
from app.db.connection import get_db_connection, init_db
from app.services.audit_service import AuditService
from app.services.auth_service import AuthService
from app.services.backup_service import BackupService
from app.services.billing_service import BillingService
from app.services.document_builder import DocumentBuilder
from app.services.patient_service import PatientService
from app.services.treatment_service import TreatmentService


def test_complete_offline_clinic_lifecycle_rehearsal(tmp_path, monkeypatch):
    """
    Simulates the entire hospital reception and doctor workflow completely offline:
    1. Zero network guarantee (sockets raise error).
    2. Admin setup & Doctor creation.
    3. Patient registration with local photo.
    4. Physiotherapy treatment case & dated session entry.
    5. Integer paise fee installment & balance calculation.
    6. A4 registration card with dual signatures.
    7. Unified .kalyan_bak creation with photo.
    8. Catastrophic wipe & verified disaster recovery.
    9. Audit trail verification.
    """
    # 1. Enforce strict offline execution: any network connect raises error
    def _blocked_connect(*args, **kwargs):
        raise ConnectionRefusedError("Offline Violation: Remote network connection attempted!")

    monkeypatch.setattr(socket.socket, "connect", _blocked_connect)

    db_path = str(tmp_path / "kalyan_live.db")
    backup_dir = str(tmp_path / "backups")
    photos_dir = tmp_path / "photos"
    photos_dir.mkdir(parents=True, exist_ok=True)

    init_db(db_path)

    # 2. First-run administrator initialization
    auth = AuthService(db_path, auto_seed_demo=False)
    assert auth.has_admin_user() is False
    admin = auth.setup_initial_admin("superadmin", "TrustHospital@2026")
    assert admin["role"] == "ADMIN"
    assert auth.authenticate("superadmin", "TrustHospital@2026") is not None

    # Create Doctor account
    doctor = auth.create_user(
        username="dr_madan",
        password="SeniorDoctor@2026",
        role="DOCTOR",
        actor_name="superadmin",
    )
    assert doctor["role"] == "DOCTOR"
    assert auth.can_record_clinical_sessions("DOCTOR") is True

    # 3. Patient registration with photo
    dummy_photo = tmp_path / "patient_avatar.jpg"
    dummy_photo.write_bytes(b"\xFF\xD8\xFF\xE0RawPhotoBytes12345")

    p_service = PatientService(db_path)
    # Monkeypatch PHOTOS_DIR for isolated test
    monkeypatch.setattr("app.services.patient_service.PHOTOS_DIR", photos_dir)

    patient = p_service.register_patient(
        data={
            "patient_name": "Suresh Chandra Gupta",
            "age": 54,
            "sex": "Male",
            "mobile_no": "9835012345",
            "address": "Maharaja Hata, Ara, Bhojpur",
            "referred_by": "Dr. Sharma",
            "patient_condition": "Severe Cervical Radiculopathy",
            "doctor_id": 1,
        },
        photo_source_path=dummy_photo,
        actor_name="Receptionist",
    )
    urn = patient["serial_urn_no"]
    assert urn.startswith("KH-")
    assert patient["photo_filename"] != ""
    saved_photo = photos_dir / patient["photo_filename"]
    assert saved_photo.exists()

    # 4. Open treatment case & log therapy session
    t_service = TreatmentService(db_path)
    case = t_service.open_treatment_case(
        patient_id=patient["id"],
        title="Cervical Spine Decompression",
        no_of_sessions=10,
        total_amount_rupees=3000.00,
        actor_name="dr_madan",
    )
    assert case["total_amount_paise"] == 300000

    session = t_service.log_session(
        case_id=case["id"],
        treatment_notes="Intermittent Cervical Traction 12kg x 15min + Ultrasound therapy",
        therapist_name="Dr. Madan Mohan Dwivedi",
        modalities_used="Traction, Ultrasound",
        pain_score=8,
        actor_name="dr_madan",
    )
    assert session["session_number"] == 1
    assert session["pain_score"] == 8

    # 5. Record fee installment & verify balance
    b_service = BillingService(db_path)
    installment = b_service.record_installment(
        case_id=case["id"],
        amount_rupees=1000.00,
        payment_mode="CASH",
        reference_note="Advance 1st installment",
        recorded_by="Receptionist",
    )
    assert installment["amount_paid_paise"] == 100000
    assert installment["balance_paise"] == 200000  # Exactly 2,000 remaining
    assert installment["balance_formatted"] == "₹ 2,000.00"

    # 6. Generate A4 registration card & assert physical slip elements
    fin_summary = b_service.get_financial_summary(case["id"])
    html = DocumentBuilder.build_patient_registration_html(
        patient_data=patient,
        case_data=case,
        financial_summary=fin_summary,
        photo_path=str(saved_photo),
    )
    assert "KALYAN HOSPITAL" in html
    assert "Madan Mohan Dwivedi" in html
    assert "Chandan Kr. Dwivedi" in html
    assert "Patient / Attendant Signature" in html
    assert "Authorized Signature" in html
    assert "1. Serial / URN No." in html or "Serial" in html
    assert "12. Payment Details" in html

    # 7. Create unified .kalyan_bak backup archive (DB + Photos)
    bak_service = BackupService(
        db_path=db_path,
        backup_dir=backup_dir,
        photos_dir=str(photos_dir),
    )
    backup_file = bak_service.create_backup(bundle_photos=True)
    assert backup_file.suffix == ".kalyan_bak"

    v_info = bak_service.verify_backup_integrity(str(backup_file))
    assert v_info["valid"] is True
    assert v_info["is_bundle"] is True
    assert v_info["photo_count"] >= 1
    assert v_info["patients_count"] == 1
    assert v_info["cases_count"] == 1
    assert v_info["sessions_count"] == 1
    assert v_info["payments_count"] == 1

    # 8. Simulate catastrophic wipe (DB erased & photos deleted)
    with get_db_connection(db_path) as conn:
        conn.execute("DELETE FROM payments")
        conn.execute("DELETE FROM treatment_sessions")
        conn.execute("DELETE FROM treatment_cases")
        conn.execute("DELETE FROM patients")
        conn.commit()

    saved_photo.unlink()
    assert not saved_photo.exists()

    # Execute verified disaster restore
    restore_res = bak_service.restore_from_backup(str(backup_file))
    assert restore_res["success"] is True

    # Verify 100% recovery of DB records and photo
    with get_db_connection(db_path) as conn:
        assert conn.execute("SELECT COUNT(*) FROM patients").fetchone()[0] == 1
        assert conn.execute("SELECT COUNT(*) FROM payments").fetchone()[0] == 1
    assert saved_photo.exists()
    assert saved_photo.read_bytes() == b"\xFF\xD8\xFF\xE0RawPhotoBytes12345"

    # 9. Audit trail verification
    audit = AuditService(db_path)
    recent_logs = audit.get_recent_logs(limit=50)
    actions = [log["action"] for log in recent_logs]
    assert "ADMIN_INITIALIZED" in actions
    assert "USER_CREATED" in actions
    assert "PATIENT_REGISTERED" in actions
    assert "CASE_OPENED" in actions
    assert "SESSION_LOGGED" in actions
    assert "PAYMENT_RECORDED" in actions
    assert "BACKUP_CREATED" in actions
    assert "BACKUP_RESTORED" in actions

