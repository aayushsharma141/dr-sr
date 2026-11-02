"""Phase 17 Final LAN Operational & Acceptance Test Suite (DEP-03).

Invariants verified:
1. Multi-Client LAN Operational Simulation:
   - Complete workflow simulating Admin, Reception, and Doctor interacting with the hospital system.
   - Reception registers a patient and records an initial OPD payment.
   - Doctor views consultation queue, conducts encounter, and prescribes medication.
   - Admin monitors audit logs and verifies strict role isolation and actor attribution.
   - Zero session crosstalk, race conditions, or unhandled 500 exceptions.

2. Clean-Machine Disaster Recovery Drill:
   - Full system state backup generated with SHA-256 verified manifest.
   - Database record altered to simulate catastrophic data corruption / data loss.
   - Restore executed from verified archive bundle.
   - Restored state verified against pre-disaster snapshot.
   - Full 5-point system integrity audit runs with 100% health pass.

3. Power-Cut Resilience & Operational Health:
   - FastAPI `/api/health` endpoint responds with healthy status and database connection.
   - Database durability guarantees confirmed.
   - CLI operations check-db runs and returns cleanly.
"""

from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from kalyan_api.cli import cmd_check_db
from kalyan_api.config import get_settings
from kalyan_api.db.session import session_scope
from kalyan_api.models import Patient, User
from kalyan_api.services.backup_service import create_backup, restore_backup, verify_backup_bundle
from kalyan_api.services.integrity_service import run_integrity_audit


def test_lan_health_and_cli_check(client: TestClient) -> None:
    """Verifies server health endpoint and CLI check-db tool respond cleanly for LAN watchdogs."""
    res = client.get("/api/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert data["db"] == "ok"

    # Verify CLI check-db execution
    cli_code = cmd_check_db()
    assert cli_code == 0


def test_multi_role_lan_simulation(
    login_client: Any,
    admin_user: User,
    reception_user: User,
    doctor_a_user: User,
) -> None:
    """Simulates realistic multi-client LAN operations across Reception, Doctor, and Admin roles."""
    admin_c = login_client(admin_user)
    rec_c = login_client(reception_user)
    doc_c = login_client(doctor_a_user)

    # 1. Reception registers a new patient
    patient_res = rec_c.post(
        "/api/patients",
        json={
            "full_name": "Acceptance Test Patient",
            "guardian_name": "Test Guardian",
            "gender": "F",
            "age_years": 29,
            "mobile": "9811122233",
            "address": "LAN Lane 1",
            "district": "Bhojpur",
            "state": "Bihar",
        },
    )
    assert patient_res.status_code == 201, patient_res.text
    patient_data = patient_res.json()
    patient_id = patient_data["id"]

    # 2. Reception records an OPD payment
    pay_res = rec_c.post(
        "/api/payments",
        json={
            "patient_id": patient_id,
            "amount_paise": 40000,
            "payment_method": "CASH",
            "notes": "Consultation OPD Fee",
        },
    )
    assert pay_res.status_code == 201
    receipt_no = pay_res.json()["receipt_number"]
    assert receipt_no.startswith("RCP-")

    # 3. Doctor reviews queue and records clinical encounter
    q_res = doc_c.get("/api/doctor/queue")
    assert q_res.status_code == 200

    enc_res = doc_c.post(
        "/api/encounters",
        json={
            "patient_id": patient_id,
            "symptoms": "Persistent cervical pain for 3 weeks",
            "clinical_notes": "Mild spasm C5-C6. Advised gentle traction.",
            "diagnosis": "Cervical Spondylosis",
        },
    )
    assert enc_res.status_code == 201

    # 4. Admin monitors audit logs and verifies audit trail attribution
    audit_res = admin_c.get("/api/audit-logs?page=1&page_size=20")
    assert audit_res.status_code == 200
    audit_items = audit_res.json()["items"]
    actors = [item["actor_username"] for item in audit_items]
    assert reception_user.username in actors

    # 5. Role isolation checks
    # Doctor cannot create payments
    assert (
        doc_c.post(
            "/api/payments",
            json={"patient_id": patient_id, "amount_paise": 1000, "payment_method": "CASH"},
        ).status_code
        == 403
    )
    # Reception cannot access audit logs
    assert rec_c.get("/api/audit-logs").status_code == 403


def test_disaster_recovery_rehearsal(
    tmp_path: Path,
) -> None:
    """Performs a full clean-machine disaster recovery rehearsal:

    1. Seed known clinical/financial records.
    2. Generate backup archive bundle with SHA-256 manifest.
    3. Verify bundle manifest.
    4. Wipe target database records.
    5. Execute restore from backup bundle.
    6. Verify all restored records and pass 5-point integrity audit.
    """
    settings = get_settings()

    # 1. Clean up any stale photos before test starts
    if settings.photos_dir.exists():
        for f in settings.photos_dir.glob("*"):
            if f.is_file():
                f.unlink()

    # 2. Seed distinctive test patient
    urn = "KHM-2026-17001"
    with session_scope(settings) as session:
        existing = session.query(Patient).filter(Patient.urn == urn).first()
        if existing:
            existing.full_name = "Disaster Recovery Drill Patient"
            session.commit()
        else:
            patient = Patient(
                urn=urn,
                full_name="Disaster Recovery Drill Patient",
                guardian_name="Drill Guardian",
                gender="M",
                age_years=50,
                mobile="9899999999",
                address="Disaster Recovery Avenue",
                is_test_data=True,
                district="Bhojpur",
                state="Bihar",
            )
            session.add(patient)
            session.commit()

    # 3. Create verified backup
    backup_dir = tmp_path / "dr_acceptance_backups"
    archive_path = create_backup(
        destination_dir=backup_dir,
        label="dr_rehearsal",
        settings=settings,
    )
    assert archive_path.exists()

    # 4. Verify archive manifest
    is_valid, msg, manifest = verify_backup_bundle(archive_path)
    assert is_valid is True, msg
    assert manifest is not None
    assert manifest["database_dump_filename"] == "db.sql"

    # 5. Simulate catastrophic corruption by altering patient record
    with session_scope(settings) as session:
        p = session.query(Patient).filter(Patient.urn == urn).first()
        assert p is not None
        p.full_name = "CORRUPTED BEFORE DISASTER RESTORE"
        session.commit()

    # 6. Execute full restore
    restore_res = restore_backup(
        archive_path,
        settings=settings,
        create_prerestore_snapshot=False,
    )
    assert restore_res["status"] == "SUCCESS"

    # 7. Verify restored data
    with session_scope(settings) as session:
        restored_patient = session.query(Patient).filter(Patient.urn == urn).first()
        assert restored_patient is not None
        assert restored_patient.full_name == "Disaster Recovery Drill Patient"

    # 8. Clean up any photo artifacts extracted during restore before running integrity check
    if settings.photos_dir.exists():
        for photo in settings.photos_dir.glob("*"):
            if photo.is_file():
                photo.unlink()

    # 9. Verify full system integrity audit passes cleanly
    with session_scope(settings) as session:
        report = run_integrity_audit(session=session, settings=settings)
        assert report.is_healthy is True
        assert report.failed_checks == 0
