"""Tests for restore engine and pre-restore snapshots (BAK-02, Plan 16-03)."""

from pathlib import Path

import pytest
from sqlalchemy import Engine, text

from kalyan_api.config import Settings, get_settings
from kalyan_api.db.session import session_scope
from kalyan_api.models import Patient
from kalyan_api.services import backup_service
from kalyan_api.services.backup_service import (
    BackupCorruptedError,
    RestoreError,
    create_backup,
    dump_database,
    restore_backup,
    restore_database_sql,
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
            session.delete(existing)
            session.commit()
        if True:
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


@pytest.mark.parametrize("ambient_pgoptions", [None, "-c application_name=kalyan_operator"])
def test_blocked_schema_reset_fails_and_keeps_the_database(
    ambient_pgoptions: str | None,
    test_settings: Settings,
    owner_engine: Engine,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    """A lock held elsewhere must end the restore with an error and change nothing."""
    if ambient_pgoptions is None:
        monkeypatch.delenv("PGOPTIONS", raising=False)
    else:
        monkeypatch.setenv("PGOPTIONS", ambient_pgoptions)
    monkeypatch.setattr(backup_service, "RESTORE_LOCK_TIMEOUT_MS", 1000)
    dump_file = tmp_path / "db.sql"
    dump_database(dump_file, test_settings)
    table_oid = text("SELECT 'users'::regclass::oid")

    with owner_engine.connect() as holder:
        oid_before = holder.scalar(table_oid)
        # Drops the lock if the timeout stops working, so that fails the test without a hang.
        holder.execute(text("SET LOCAL idle_in_transaction_session_timeout = '10s'"))
        holder.execute(text("LOCK TABLE users IN ACCESS SHARE MODE"))
        with pytest.raises(RestoreError, match="schema reset failed"):
            restore_database_sql(dump_file, test_settings)
        holder.rollback()

    with owner_engine.connect() as conn:
        assert conn.scalar(table_oid) == oid_before
