"""A real backup and restore through POST /api/operations/restore (BAK-02).

test_operations_api.py stubs restore_backup, because the suite's begin_nested() session override
cannot survive the commit trigger_restore makes. That leaves it blind to the failure that matters
most here: if the request still holds its read locks when psql runs DROP SCHEMA, the restore
blocks on its own request. This test runs the endpoint on the real get_session dependency.

kalyan_owner has no CREATEDB, so a throwaway database would need a superuser. The test works on
the test database instead, dumps it first and puts it back afterwards.
"""

from collections.abc import Generator
from pathlib import Path

import pytest
from conftest import TEST_PASSWORD, make_user
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from kalyan_api.config import Settings
from kalyan_api.main import create_app
from kalyan_api.models import AuditLog, Patient
from kalyan_api.services.backup_service import dump_database, restore_database_sql

# Far below pytest's 60 seconds: a blocked DROP SCHEMA then fails as a clean 500 rather than
# stalling until pytest-timeout, which on Windows ends the whole run. It overrides the longer
# default in backup_service, and holds even if that default is ever lost.
BLOCKED_RESTORE_PGOPTIONS = "-c lock_timeout=5000"

ADMIN_USERNAME = "real_restore_admin"
PHOTO_BYTES = b"\xff\xd8\xff\xe0real-restore-sample"
RESTORE_REASON = "Prove a real restore completes through the endpoint"
URN_ADDED_AFTER_BACKUP = "KHM-2026-99998"


@pytest.fixture
def restore_settings(
    test_settings: Settings,
    migrated_db: dict[str, int],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> Generator[Settings, None, None]:
    """Temporary folders and a bounded lock wait, with the test database put back afterwards."""
    assert test_settings.db_name.endswith("_test")
    settings = test_settings.model_copy(
        update={
            "photos_dir": tmp_path / "photos",
            "backup_dir": tmp_path / "backups",
            "setup_code_path": tmp_path / "setup-code.txt",
        }
    )
    settings.photos_dir.mkdir()
    monkeypatch.setenv("PGOPTIONS", BLOCKED_RESTORE_PGOPTIONS)
    monkeypatch.setattr("kalyan_api.routers.operations.get_settings", lambda: settings)

    baseline = tmp_path / "baseline.sql"
    dump_database(baseline, settings)
    yield settings
    restore_database_sql(baseline, settings)


@pytest.fixture
def real_app(restore_settings: Settings) -> FastAPI:
    """The application with no dependency overrides, so get_session really commits."""
    return create_app(settings=restore_settings)


def test_restore_endpoint_restores_a_real_backup(
    real_app: FastAPI,
    restore_settings: Settings,
    app_engine: Engine,
) -> None:
    """A restore must finish, roll data back, and leave the admin's session working."""
    with Session(app_engine) as db:
        admin_id = make_user(db, restore_settings, "ADMIN", ADMIN_USERNAME).id
        db.commit()

    photo = restore_settings.photos_dir / "real_restore_sample.jpg"
    photo.write_bytes(PHOTO_BYTES)

    with TestClient(
        real_app,
        base_url="http://testserver",
        headers={"Origin": "http://testserver"},
    ) as client:
        login = client.post(
            "/api/auth/login",
            json={"username": ADMIN_USERNAME, "password": TEST_PASSWORD},
        )
        assert login.status_code == 200, login.text
        client.headers["X-CSRF-Token"] = login.json()["csrf_token"]

        backup = client.post("/api/operations/backups", json={"label": "real_restore"})
        assert backup.status_code == 201, backup.text
        assert backup.json()["is_valid"] is True
        archive = backup.json()["filename"]

        # Change the data after the backup, so the assertions below prove a restore took place.
        photo.unlink()
        with Session(app_engine) as db:
            db.add(
                Patient(
                    urn=URN_ADDED_AFTER_BACKUP,
                    full_name="Added After Backup",
                    guardian_name="Guardian Singh",
                    mobile="9876543210",
                    gender="O",
                    age_years=40,
                    address="Should Not Survive",
                    district="Kangra",
                    state="Himachal Pradesh",
                )
            )
            db.commit()

        restore = client.post(
            "/api/operations/restore",
            json={
                "archive_filename": archive,
                "confirmation_phrase": "RESTORE",
                "reason": RESTORE_REASON,
            },
        )
        assert restore.status_code == 200, restore.text
        body = restore.json()
        assert body["status"] == "SUCCESS"
        assert body["database_restored"] is True
        assert body["photos_restored_count"] == 1
        assert Path(body["prerestore_snapshot"]).is_file()

        # The session row came back with the database, so the same cookie must still work.
        me = client.get("/api/auth/me")
        assert me.status_code == 200, me.text
        assert me.json()["username"] == ADMIN_USERNAME

    assert photo.read_bytes() == PHOTO_BYTES
    with Session(app_engine) as db:
        added = db.scalar(select(Patient).where(Patient.urn == URN_ADDED_AFTER_BACKUP))
        # Scoped to this archive: the audit row commits on its own session, so other tests that
        # stub restore_backup leave their rows in the test database.
        restored_audit = db.scalars(
            select(AuditLog).where(
                AuditLog.action == "BACKUP_RESTORED",
                AuditLog.entity_id == archive,
            )
        ).all()
    assert added is None
    assert len(restored_audit) == 1
    assert restored_audit[0].entity_id == archive
    assert restored_audit[0].actor_user_id == admin_id
    assert restored_audit[0].reason == RESTORE_REASON
