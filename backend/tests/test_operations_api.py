"""Tests for operations REST API (BAK-01, BAK-02, BAK-03, Plan 16-05 + Admin Panel hardening).

Covers:
- RBAC on every operations route (401 anonymous, 403 Reception/Doctor).
- Real end-to-end backup -> list -> verify -> restore lifecycle with the hardened contract.
- archive_filename confinement (path traversal closed) on restore and verify -> 422.
- destination_dir validation (absolute + existing directory) -> 422.
- Restore confirmation phrase, reason, and mandatory pre-restore snapshot validation -> 422.
- Failure auditing in a separate transaction for backup and restore failures.
"""

import hashlib
import io
import json
import tarfile
from collections.abc import Generator, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any, cast

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, select, text
from sqlalchemy.orm import Session, sessionmaker

from kalyan_api.config import Settings
from kalyan_api.models import AuditLog, User
from kalyan_api.routers import operations
from kalyan_api.services.audit_service import AuditAction, AuditContext
from kalyan_api.services.backup_service import RestoreError

VALID_RESTORE = {"confirmation_phrase": "RESTORE", "reason": "Disaster recovery drill for audit"}


def make_archive(
    directory: Path,
    name: str = "kalyan_backup_20260101_000000_unit.tar.gz",
    db_bytes: bytes = b"-- dump\nSELECT 1;\n",
    created_at: str = "2026-01-01T00:00:00+00:00",
    tamper: bool = False,
) -> Path:
    """Build a small, structurally valid backup archive (optionally with a tampered db.sql)."""
    directory.mkdir(parents=True, exist_ok=True)
    manifest = {
        "version": "1.0",
        "created_at": created_at,
        "database_dump_filename": "db.sql",
        "database_dump_sha256": hashlib.sha256(db_bytes).hexdigest(),
        "database_dump_bytes": len(db_bytes),
        "photos_count": 0,
        "photos_manifest": [],
        "label": "unit",
    }
    stored_db = db_bytes + b"-- TAMPERED\n" if tamper else db_bytes
    path = directory / name
    with tarfile.open(path, "w:gz") as tar:
        for arcname, payload in (
            ("manifest.json", json.dumps(manifest).encode("utf-8")),
            ("db.sql", stored_db),
        ):
            info = tarfile.TarInfo(name=arcname)
            info.size = len(payload)
            tar.addfile(info, io.BytesIO(payload))
    return path


class CapturingSession:
    """Duck-typed stand-in for the isolated failure-audit session."""

    def __init__(self) -> None:
        self.added: list[AuditLog] = []
        self.committed = False

    def add(self, obj: AuditLog) -> None:
        self.added.append(obj)

    def flush(self) -> None:
        return None


@pytest.fixture
def isolated_audits(monkeypatch: pytest.MonkeyPatch) -> list[CapturingSession]:
    """Replace the isolated failure-audit transaction with a capturing fake."""
    sessions: list[CapturingSession] = []

    @contextmanager
    def _fake() -> Iterator[CapturingSession]:
        fake = CapturingSession()
        sessions.append(fake)
        yield fake
        fake.committed = True

    monkeypatch.setattr(operations, "_isolated_audit_session", _fake)
    return sessions


REAL_RELEASE_REQUEST_TRANSACTION = operations._release_request_transaction


@pytest.fixture(autouse=True)
def _keep_request_savepoint(monkeypatch: pytest.MonkeyPatch) -> None:
    """The test session wraps each request in a savepoint, which a mid-request commit would end."""
    monkeypatch.setattr(operations, "_release_request_transaction", lambda _session: None)


@pytest.fixture
def ops_settings(
    monkeypatch: pytest.MonkeyPatch, test_settings: Settings, tmp_path: Path
) -> Settings:
    """Settings whose backup/photos dirs live in tmp_path, injected into the operations router."""
    settings = test_settings.model_copy(
        update={
            "backup_dir": tmp_path / "backups",
            "photos_dir": tmp_path / "photos",
            "db_owner_password": "OwnerSecretPw-123",
        }
    )
    settings.backup_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(operations, "get_settings", lambda: settings)
    return settings


def test_operations_api_role_restrictions(
    client: TestClient,
    login_client: Any,
    admin_user: User,
    reception_user: User,
    doctor_a_user: User,
) -> None:
    """Operations endpoints must only be accessible by ADMIN."""
    restore_body = {"archive_filename": "foo", **VALID_RESTORE}
    verify_url = "/api/operations/backups/foo.tar.gz/verify"

    # 1. Unauthenticated -> 401
    assert client.get("/api/operations/backups").status_code == 401
    assert client.get("/api/operations/integrity").status_code == 401
    assert client.post("/api/operations/backups", json={}).status_code == 401
    assert client.post("/api/operations/restore", json=restore_body).status_code == 401
    assert client.post(verify_url).status_code == 401

    # 2. Reception -> 403, 3. Doctor -> 403
    for user in (reception_user, doctor_a_user):
        c = login_client(user)
        assert c.get("/api/operations/backups").status_code == 403
        assert c.get("/api/operations/integrity").status_code == 403
        assert c.post("/api/operations/backups", json={}).status_code == 403
        assert c.post("/api/operations/restore", json=restore_body).status_code == 403
        assert c.post(verify_url).status_code == 403


def test_operations_admin_lifecycle(
    login_client: Any,
    admin_user: User,
    db_session: Session,
) -> None:
    """Admin can check integrity, back up, list, verify and restore (real pg_dump/psql)."""
    admin_c = login_client(admin_user)

    # 1. Check integrity (5 ERROR-level checks + 1 WARNING-level URN gap check)
    integ_res = admin_c.get("/api/operations/integrity")
    assert integ_res.status_code == 200
    integ_data = integ_res.json()
    assert "is_healthy" in integ_data
    assert integ_data["total_checks"] == 6
    assert "warning_checks" in integ_data
    gap_check = next(c for c in integ_data["checks"] if c["name"] == "Patient URN Sequence Gaps")
    assert gap_check["severity"] == "WARNING"

    # 2. Trigger backup
    backup_res = admin_c.post("/api/operations/backups", json={"label": "api_test"})
    assert backup_res.status_code == 201, backup_res.text
    backup_data = backup_res.json()
    assert backup_data["filename"].startswith("kalyan_backup_")
    assert backup_data["is_valid"] is True

    # 3. List backups
    list_res = admin_c.get("/api/operations/backups")
    assert list_res.status_code == 200
    list_data = list_res.json()
    assert list_data["total_count"] >= 1
    assert any(b["filename"] == backup_data["filename"] for b in list_data["backups"])

    # 4. Verify the fresh archive
    verify_res = admin_c.post(f"/api/operations/backups/{backup_data['filename']}/verify")
    assert verify_res.status_code == 200
    assert verify_res.json() == {
        "filename": backup_data["filename"],
        "valid": True,
        "details": "Backup bundle is cryptographically verified and intact",
    }

    # 5. Restore using the freshly created backup (pre-restore snapshot is mandatory)
    restore_res = admin_c.post(
        "/api/operations/restore",
        json={"archive_filename": backup_data["filename"], **VALID_RESTORE},
    )
    assert restore_res.status_code == 200, restore_res.text
    restore_data = restore_res.json()
    assert restore_data["status"] == "SUCCESS"
    assert restore_data["database_restored"] is True
    assert restore_data["prerestore_snapshot"] is not None
    assert Path(restore_data["prerestore_snapshot"]).exists()

    restored_row = db_session.scalars(
        select(AuditLog).where(
            AuditLog.action == AuditAction.BACKUP_RESTORED.value,
            AuditLog.entity_id == backup_data["filename"],
        )
    ).one()
    assert restored_row.reason == VALID_RESTORE["reason"]
    assert restored_row.after_data["prerestore_snapshot"] == restore_data["prerestore_snapshot"]


BAD_FILENAMES = [
    "../kalyan_backup_x.tar.gz",
    "..\\kalyan_backup_x.tar.gz",
    "..",
    "sub/kalyan_backup_x.tar.gz",
    "C:\\Windows\\win.ini",
    "C:kalyan_backup_x.tar.gz",
    "/etc/passwd",
    " kalyan_backup_x.tar.gz",
    "kalyan_backup_does_not_exist.tar.gz",
]


@pytest.mark.parametrize("bad_name", BAD_FILENAMES)
def test_restore_rejects_unconfined_archive_filename(
    bad_name: str,
    login_client: Any,
    admin_user: User,
    ops_settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Path traversal / absolute / missing names are rejected before any restore work."""

    def _must_not_run(**_kwargs: Any) -> dict[str, Any]:
        raise AssertionError("restore_backup must not be called for an invalid filename")

    monkeypatch.setattr(operations, "restore_backup", _must_not_run)
    # A real file outside the backup dir that a traversal would otherwise reach
    make_archive(ops_settings.backup_dir.parent, name="kalyan_backup_x.tar.gz")

    res = login_client(admin_user).post(
        "/api/operations/restore", json={"archive_filename": bad_name, **VALID_RESTORE}
    )
    assert res.status_code == 422, res.text
    assert res.json()["code"] == "invalid_archive_filename"


@pytest.mark.parametrize(
    "bad_name",
    [
        "%2E%2E",
        "..%5Ckalyan_backup_x.tar.gz",
        "C%3A%5CWindows%5Cwin.ini",
        "kalyan_backup_nope.tar.gz",
    ],
)
def test_verify_rejects_unconfined_archive_filename(
    bad_name: str,
    login_client: Any,
    admin_user: User,
    ops_settings: Settings,
) -> None:
    make_archive(ops_settings.backup_dir.parent, name="kalyan_backup_x.tar.gz")
    res = login_client(admin_user).post(f"/api/operations/backups/{bad_name}/verify")
    assert res.status_code == 422, res.text
    assert res.json()["code"] == "invalid_archive_filename"


def test_verify_reports_valid_and_tampered_archives(
    login_client: Any,
    admin_user: User,
    ops_settings: Settings,
) -> None:
    good = make_archive(ops_settings.backup_dir, name="kalyan_backup_20260101_000000_good.tar.gz")
    bad = make_archive(
        ops_settings.backup_dir, name="kalyan_backup_20260101_000001_bad.tar.gz", tamper=True
    )
    admin_c = login_client(admin_user)

    good_res = admin_c.post(f"/api/operations/backups/{good.name}/verify")
    assert good_res.status_code == 200
    assert good_res.json()["valid"] is True

    bad_res = admin_c.post(f"/api/operations/backups/{bad.name}/verify")
    assert bad_res.status_code == 200
    body = bad_res.json()
    assert body == {
        "filename": bad.name,
        "valid": False,
        "details": body["details"],
    }
    assert "Checksum mismatch for db.sql" in body["details"]


@pytest.mark.parametrize(
    ("override", "missing_field"),
    [
        ({"confirmation_phrase": "restore"}, None),
        ({"confirmation_phrase": "RESTORE "}, None),
        ({"reason": "too short"}, None),
        ({"reason": "         x         "}, None),
        ({"create_prerestore_snapshot": False}, None),
        ({"unexpected": True}, None),
        ({}, "confirmation_phrase"),
        ({}, "reason"),
    ],
)
def test_restore_request_validation(
    override: dict[str, Any],
    missing_field: str | None,
    login_client: Any,
    admin_user: User,
    ops_settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Confirmation phrase, reason length and mandatory snapshot are enforced server-side."""

    def _must_not_run(**_kwargs: Any) -> dict[str, Any]:
        raise AssertionError("restore_backup must not be called for an invalid request")

    monkeypatch.setattr(operations, "restore_backup", _must_not_run)
    archive = make_archive(ops_settings.backup_dir)
    body: dict[str, Any] = {"archive_filename": archive.name, **VALID_RESTORE, **override}
    if missing_field:
        body.pop(missing_field)

    res = login_client(admin_user).post("/api/operations/restore", json=body)
    assert res.status_code == 422, res.text
    assert res.json()["code"] == "validation_error"


def test_restore_success_records_reason_and_always_snapshots(
    login_client: Any,
    admin_user: User,
    ops_settings: Settings,
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    archive = make_archive(ops_settings.backup_dir)
    calls: list[dict[str, Any]] = []

    def _fake_restore(**kwargs: Any) -> dict[str, Any]:
        calls.append(kwargs)
        return {
            "status": "SUCCESS",
            "archive_restored": str(kwargs["archive_path"]),
            "prerestore_snapshot": str(ops_settings.backup_dir / "snap.tar.gz"),
            "database_restored": True,
            "photos_restored_count": 0,
            "manifest": {"created_at": "2026-01-01T00:00:00+00:00", "label": "unit"},
        }

    monkeypatch.setattr(operations, "restore_backup", _fake_restore)

    res = login_client(admin_user).post(
        "/api/operations/restore",
        json={
            "archive_filename": archive.name,
            **VALID_RESTORE,
            "create_prerestore_snapshot": True,
        },
    )
    assert res.status_code == 200, res.text
    assert calls[0]["create_prerestore_snapshot"] is True
    assert Path(calls[0]["archive_path"]) == archive.resolve()

    row = db_session.scalars(
        select(AuditLog).where(
            AuditLog.action == AuditAction.BACKUP_RESTORED.value,
            AuditLog.actor_user_id == admin_user.id,
        )
    ).one()
    assert row.reason == VALID_RESTORE["reason"]
    assert row.entity_id == archive.name
    assert row.after_data["archive_label"] == "unit"
    assert row.after_data["database_restored"] is True


@pytest.mark.parametrize(
    "destination",
    ["relative/dir", "does-not-exist", "Z:\\definitely\\missing\\dir", "   \x00 "],
)
def test_backup_rejects_invalid_destination_dir(
    destination: str,
    login_client: Any,
    admin_user: User,
    ops_settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _must_not_run(**_kwargs: Any) -> Path:
        raise AssertionError("create_backup must not be called for an invalid destination")

    monkeypatch.setattr(operations, "create_backup", _must_not_run)
    res = login_client(admin_user).post(
        "/api/operations/backups", json={"destination_dir": destination}
    )
    assert res.status_code == 422, res.text
    assert res.json()["code"] == "invalid_destination_dir"


def test_backup_rejects_destination_that_is_a_file(
    login_client: Any,
    admin_user: User,
    ops_settings: Settings,
    tmp_path: Path,
) -> None:
    a_file = tmp_path / "not_a_dir.txt"
    a_file.write_text("x", encoding="utf-8")
    res = login_client(admin_user).post(
        "/api/operations/backups", json={"destination_dir": str(a_file)}
    )
    assert res.status_code == 422
    assert res.json()["code"] == "invalid_destination_dir"


@pytest.mark.parametrize("label", ["../../escape", "a/b", "with space", "x" * 51])
def test_backup_rejects_unsafe_label(
    label: str, login_client: Any, admin_user: User, ops_settings: Settings
) -> None:
    res = login_client(admin_user).post("/api/operations/backups", json={"label": label})
    assert res.status_code == 422
    assert res.json()["code"] == "validation_error"


def test_backup_to_valid_absolute_destination_is_audited(
    login_client: Any,
    admin_user: User,
    ops_settings: Settings,
    db_session: Session,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    secondary = tmp_path / "secondary_drive"
    secondary.mkdir()
    monkeypatch.setattr(ops_settings, "backup_destinations", [secondary])
    seen: dict[str, Any] = {}

    def _fake_create(**kwargs: Any) -> Path:
        seen.update(kwargs)
        return make_archive(Path(kwargs["destination_dir"]))

    monkeypatch.setattr(operations, "create_backup", _fake_create)
    res = login_client(admin_user).post(
        "/api/operations/backups", json={"label": "nightly-2", "destination_dir": str(secondary)}
    )
    assert res.status_code == 201, res.text
    assert Path(seen["destination_dir"]) == secondary.resolve()
    assert res.json()["is_valid"] is True

    row = db_session.scalars(
        select(AuditLog).where(
            AuditLog.action == AuditAction.BACKUP_CREATED.value,
            AuditLog.actor_user_id == admin_user.id,
        )
    ).one()
    assert row.after_data["destination_dir"] == str(secondary)
    assert row.after_data["label"] == "nightly-2"


def test_backup_failure_audited_in_separate_transaction(
    login_client: Any,
    admin_user: User,
    ops_settings: Settings,
    db_session: Session,
    isolated_audits: list[CapturingSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A failing backup writes BACKUP_FAILED via the isolated session, without secrets."""

    def _boom(**_kwargs: Any) -> Path:
        raise RuntimeError(
            "Database dump failed: auth failed for kalyan_owner (pw=OwnerSecretPw-123)"
        )

    monkeypatch.setattr(operations, "create_backup", _boom)
    res = login_client(admin_user).post("/api/operations/backups", json={"label": "fail"})

    assert res.status_code == 500
    body = res.json()
    assert body["code"] == "backup_failed"
    assert "OwnerSecretPw-123" not in res.text
    assert "auth failed" not in res.text

    assert len(isolated_audits) == 1
    fake = isolated_audits[0]
    assert fake.committed is True
    assert len(fake.added) == 1
    entry = fake.added[0]
    assert entry.action == AuditAction.BACKUP_FAILED.value
    assert entry.outcome == "FAILURE"
    assert entry.actor_user_id == admin_user.id
    assert entry.after_data is not None
    assert entry.after_data["error"] == "RuntimeError"
    assert "OwnerSecretPw-123" not in json.dumps(entry.after_data)
    assert entry.after_data["label"] == "fail"

    # The request transaction rolled back: nothing about this attempt landed in it.
    leaked = db_session.scalars(
        select(AuditLog).where(
            AuditLog.actor_user_id == admin_user.id,
            AuditLog.action.in_(
                [AuditAction.BACKUP_CREATED.value, AuditAction.BACKUP_FAILED.value]
            ),
        )
    ).all()
    assert leaked == []


def test_release_request_transaction_commits_the_session() -> None:
    calls: list[str] = []

    class _Session:
        def commit(self) -> None:
            calls.append("commit")

    REAL_RELEASE_REQUEST_TRANSACTION(cast(Session, _Session()))
    assert calls == ["commit"]


def test_restore_ends_request_transaction_before_psql_runs(
    login_client: Any,
    admin_user: User,
    ops_settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    archive = make_archive(ops_settings.backup_dir)
    order: list[str] = []

    def _fake_restore(**kwargs: Any) -> dict[str, Any]:
        order.append("restore")
        return {
            "status": "SUCCESS",
            "archive_restored": str(kwargs["archive_path"]),
            "prerestore_snapshot": None,
            "database_restored": True,
            "photos_restored_count": 0,
            "manifest": {},
        }

    monkeypatch.setattr(
        operations, "_release_request_transaction", lambda _session: order.append("release")
    )
    monkeypatch.setattr(operations, "restore_backup", _fake_restore)

    res = login_client(admin_user).post(
        "/api/operations/restore", json={"archive_filename": archive.name, **VALID_RESTORE}
    )
    assert res.status_code == 200, res.text
    assert order == ["release", "restore"]


def test_restore_success_audit_survives_actor_missing_from_older_backup(
    login_client: Any,
    admin_user: User,
    ops_settings: Settings,
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    archive = make_archive(ops_settings.backup_dir)

    def _fake_restore(**kwargs: Any) -> dict[str, Any]:
        return {
            "status": "SUCCESS",
            "archive_restored": str(kwargs["archive_path"]),
            "prerestore_snapshot": str(ops_settings.backup_dir / "snap.tar.gz"),
            "database_restored": True,
            "photos_restored_count": 0,
            "manifest": {"created_at": "2026-01-01T00:00:00+00:00", "label": "unit"},
        }

    def _ctx_of_vanished_admin(_request: Any, principal: Any) -> AuditContext:
        return AuditContext(
            actor_user_id=987654321, actor_username=principal.username, actor_role="ADMIN"
        )

    monkeypatch.setattr(operations, "restore_backup", _fake_restore)
    monkeypatch.setattr(operations, "build_audit_context", _ctx_of_vanished_admin)

    res = login_client(admin_user).post(
        "/api/operations/restore", json={"archive_filename": archive.name, **VALID_RESTORE}
    )
    assert res.status_code == 200, res.text

    row = db_session.scalars(
        select(AuditLog).where(
            AuditLog.action == AuditAction.BACKUP_RESTORED.value,
            AuditLog.entity_id == archive.name,
        )
    ).one()
    assert row.actor_user_id is None
    assert row.actor_username == admin_user.username


def test_restore_execution_failure_audited_with_reason(
    login_client: Any,
    admin_user: User,
    ops_settings: Settings,
    isolated_audits: list[CapturingSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    archive = make_archive(ops_settings.backup_dir)

    def _boom(**_kwargs: Any) -> dict[str, Any]:
        raise RestoreError('psql: CONTEXT: COPY patients, line 7: "Sita Devi 9876543210"')

    monkeypatch.setattr(operations, "restore_backup", _boom)
    res = login_client(admin_user).post(
        "/api/operations/restore", json={"archive_filename": archive.name, **VALID_RESTORE}
    )
    assert res.status_code == 500
    assert res.json()["code"] == "restore_failed"
    assert "Sita Devi" not in res.text

    entry = isolated_audits[0].added[0]
    assert isolated_audits[0].committed is True
    assert entry.action == AuditAction.BACKUP_RESTORE_FAILED.value
    assert entry.outcome == "FAILURE"
    assert entry.entity_id == archive.name
    assert entry.reason == VALID_RESTORE["reason"]
    assert entry.after_data is not None
    assert entry.after_data["stage"] == "restore"
    assert entry.after_data["error"] == "RestoreError"
    assert "Sita Devi" not in json.dumps(entry.after_data)


def test_restore_of_corrupted_archive_is_400_and_audited(
    login_client: Any,
    admin_user: User,
    ops_settings: Settings,
    isolated_audits: list[CapturingSession],
) -> None:
    """Uses the REAL restore_backup: verification fails before any snapshot or DB change."""
    corrupt = ops_settings.backup_dir / "kalyan_backup_20260101_000000_corrupt.tar.gz"
    corrupt.write_bytes(b"NOT_A_VALID_TAR_ARCHIVE_DATA")

    res = login_client(admin_user).post(
        "/api/operations/restore", json={"archive_filename": corrupt.name, **VALID_RESTORE}
    )
    assert res.status_code == 400, res.text
    assert res.json()["code"] == "backup_corrupted"
    # No pre-restore snapshot was taken for a rejected archive
    assert list(ops_settings.backup_dir.glob("*prerestore*")) == []

    entry = isolated_audits[0].added[0]
    assert entry.action == AuditAction.BACKUP_RESTORE_FAILED.value
    assert entry.after_data is not None
    assert entry.after_data["stage"] == "verify"


def test_failure_audit_write_error_does_not_mask_original_error(
    login_client: Any,
    admin_user: User,
    ops_settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    @contextmanager
    def _broken() -> Iterator[Session]:
        raise RuntimeError("audit database unavailable")
        yield  # pragma: no cover

    def _boom(**_kwargs: Any) -> Path:
        raise RuntimeError("disk full")

    monkeypatch.setattr(operations, "_isolated_audit_session", _broken)
    monkeypatch.setattr(operations, "create_backup", _boom)
    res = login_client(admin_user).post("/api/operations/backups", json={})
    assert res.status_code == 500
    assert res.json()["code"] == "backup_failed"
    assert "disk full" not in res.text


def test_backup_refuses_directory_outside_approved_locations(
    login_client: Any,
    admin_user: User,
    ops_settings: Settings,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    served = tmp_path / "frontend_dist"
    served.mkdir()

    def _must_not_run(**_kwargs: Any) -> Path:
        raise AssertionError("create_backup must not run for an unapproved destination")

    monkeypatch.setattr(operations, "create_backup", _must_not_run)
    res = login_client(admin_user).post(
        "/api/operations/backups", json={"destination_dir": str(served)}
    )
    assert res.status_code == 422
    assert res.json()["code"] == "invalid_destination_dir"


@pytest.fixture
def outer_connection_factory(
    app_engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> Generator[Any, None, None]:
    """Bind the router's SessionLocal to a connection whose outer transaction is discarded."""
    connection = app_engine.connect()
    outer = connection.begin()
    factory = sessionmaker(
        bind=connection,
        join_transaction_mode="create_savepoint",
        autoflush=False,
        expire_on_commit=False,
    )
    monkeypatch.setattr(operations, "SessionLocal", factory)
    try:
        yield connection
    finally:
        outer.rollback()
        connection.close()


def test_isolated_audit_session_commits_independently(outer_connection_factory: Any) -> None:
    """The real helper opens its own session from SessionLocal and commits the FAILURE row."""
    ctx = AuditContext.system("isolated-audit-test")
    operations._record_failure_isolated(
        ctx,
        AuditAction.BACKUP_FAILED,
        entity_id=None,
        after={"error": "RuntimeError: unit"},
    )
    row = outer_connection_factory.execute(
        text(
            "SELECT action, outcome, after_data FROM audit_logs "
            "WHERE actor_username = 'isolated-audit-test'"
        )
    ).one()
    assert row.action == "BACKUP_FAILED"
    assert row.outcome == "FAILURE"
    assert row.after_data == {"error": "RuntimeError: unit"}
