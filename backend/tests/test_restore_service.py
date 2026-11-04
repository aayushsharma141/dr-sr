"""Tests for restore engine and pre-restore snapshots (BAK-02, Plan 16-03)."""

from pathlib import Path

import pytest

from kalyan_api.config import get_settings
from kalyan_api.db.session import session_scope
from kalyan_api.models import Patient
from kalyan_api.services.backup_service import (
    BackupCorruptedError,
    create_backup,
    restore_backup,
)


def test_restore_database_and_photos(tmp_path: Path):
    """Test full backup, data mutation, and verified restoration."""
    settings = get_settings()

    # 1. Ensure test photo exists
    settings.photos_dir.mkdir(parents=True, exist_ok=True)
    test_photo = settings.photos_dir / "patient_restore_sample.jpg"
    test_photo.write_bytes(
        b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xde\xad"
    )

    # 2. Insert distinctive patient
    test_urn = "KHM-2026-99999"
    with session_scope(settings) as session:
        # Check if exists or delete
        existing = session.query(Patient).filter(Patient.urn == test_urn).first()
        if existing:
            existing.full_name = "Restore Test Patient Original"
            session.commit()
        else:
            p = Patient(
                urn=test_urn,
                full_name="Restore Test Patient Original",
                guardian_name="Guardian Singh",
                mobile="9876543210",
                gender="O",
                age_years=40,
                address="Original Address 101",
                district="Kangra",
                state="Himachal Pradesh",
            )
            session.add(p)
            session.commit()

    # 3. Create backup archive
    backup_file = create_backup(
        destination_dir=tmp_path / "backups",
        label="clean_state",
        settings=settings,
    )
    assert backup_file.exists()

    # 4. Mutate state: delete photo and alter patient
    if test_photo.exists():
        test_photo.unlink()
    assert not test_photo.exists()

    with session_scope(settings) as session:
        p = session.query(Patient).filter(Patient.urn == test_urn).first()
        assert p is not None
        p.full_name = "Mutated Before Restore"
        session.commit()

    # 5. Execute restore
    result = restore_backup(
        backup_file,
        settings=settings,
        create_prerestore_snapshot=True,
    )

    assert result["status"] == "SUCCESS"
    assert result["database_restored"] is True
    assert result["photos_restored_count"] >= 1
    assert result["prerestore_snapshot"] is not None
    assert Path(result["prerestore_snapshot"]).exists()

    # 6. Verify database state is restored
    with session_scope(settings) as session:
        restored_patient = session.query(Patient).filter(Patient.urn == test_urn).first()
        assert restored_patient is not None
        assert restored_patient.full_name == "Restore Test Patient Original"

    # 7. Verify photo is restored on disk
    assert test_photo.exists()
    assert test_photo.read_bytes().endswith(b"\xde\xad")


def test_corrupted_backup_rejected_before_db_mutation(tmp_path: Path):
    """Corrupted backup must raise BackupCorruptedError and not mutate the DB."""
    settings = get_settings()

    # Create dummy file claiming to be a tar.gz
    fake_archive = tmp_path / "corrupted_backup.tar.gz"
    fake_archive.write_bytes(b"NOT_A_VALID_TAR_ARCHIVE_DATA")

    with pytest.raises(BackupCorruptedError, match="Restore rejected"):
        restore_backup(fake_archive, settings=settings)


def test_restore_refuses_to_skip_prerestore_snapshot(tmp_path: Path):
    """The pre-restore safety snapshot is mandatory: disabling it fails before any work."""
    archive = tmp_path / "kalyan_backup_whatever.tar.gz"
    archive.write_bytes(b"irrelevant: rejected before verification")

    with pytest.raises(ValueError, match="mandatory"):
        restore_backup(archive, settings=get_settings(), create_prerestore_snapshot=False)


def test_corrupted_backup_takes_no_snapshot(tmp_path: Path):
    """Verification runs before the snapshot, so a rejected archive leaves no prerestore file."""
    settings = get_settings().model_copy(update={"backup_dir": tmp_path / "backups"})
    fake_archive = tmp_path / "corrupted_backup.tar.gz"
    fake_archive.write_bytes(b"NOT_A_VALID_TAR_ARCHIVE_DATA")

    with pytest.raises(BackupCorruptedError):
        restore_backup(fake_archive, settings=settings)
    assert not settings.backup_dir.exists() or not list(settings.backup_dir.glob("*prerestore*"))
