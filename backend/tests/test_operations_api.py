"""Tests for operations REST API (BAK-01, BAK-02, BAK-03, Plan 16-05)."""

from typing import Any

from fastapi.testclient import TestClient

from kalyan_api.models import User


def test_operations_api_role_restrictions(
    client: TestClient,
    login_client: Any,
    admin_user: User,
    reception_user: User,
    doctor_a_user: User,
) -> None:
    """Operations endpoints must only be accessible by ADMIN."""
    # 1. Unauthenticated -> 401
    assert client.get("/api/operations/backups").status_code == 401
    assert client.get("/api/operations/integrity").status_code == 401
    assert client.post("/api/operations/backups", json={}).status_code == 401
    assert (
        client.post(
            "/api/operations/restore",
            json={
                "archive_filename": "foo",
                "confirmation_phrase": "RESTORE",
                "reason": "Authorised recovery test",
            },
        ).status_code
        == 401
    )

    # 2. Reception -> 403
    rec_c = login_client(reception_user)
    assert rec_c.get("/api/operations/backups").status_code == 403
    assert rec_c.get("/api/operations/integrity").status_code == 403
    assert rec_c.post("/api/operations/backups", json={}).status_code == 403
    assert (
        rec_c.post(
            "/api/operations/restore",
            json={
                "archive_filename": "foo",
                "confirmation_phrase": "RESTORE",
                "reason": "Authorised recovery test",
            },
        ).status_code
        == 403
    )

    # 3. Doctor -> 403
    doc_c = login_client(doctor_a_user)
    assert doc_c.get("/api/operations/backups").status_code == 403
    assert doc_c.get("/api/operations/integrity").status_code == 403
    assert doc_c.post("/api/operations/backups", json={}).status_code == 403
    assert (
        doc_c.post(
            "/api/operations/restore",
            json={
                "archive_filename": "foo",
                "confirmation_phrase": "RESTORE",
                "reason": "Authorised recovery test",
            },
        ).status_code
        == 403
    )


def test_operations_admin_lifecycle(
    login_client: Any,
    admin_user: User,
    monkeypatch: Any,
) -> None:
    """Admin can list backups, trigger a backup, check integrity, and restore."""
    admin_c = login_client(admin_user)

    # 1. Run the integrity check; the stored run is what the page reads afterwards.
    run_res = admin_c.post("/api/operations/integrity/run")
    assert run_res.status_code == 201
    run_data = run_res.json()
    assert "is_healthy" in run_data
    assert run_data["total_checks"] == 7
    assert run_data["run_by_username"] == admin_user.username
    assert {c["code"] for c in run_data["checks"]} == {
        "package_payments",
        "patient_id_unique",
        "patient_id_gaps",
        "receipt_unique",
        "session_counts",
        "photo_files",
        "asset_files",
    }
    latest = admin_c.get("/api/operations/integrity")
    assert latest.status_code == 200
    assert latest.json()["id"] == run_data["id"]
    history = admin_c.get("/api/operations/integrity/history").json()["runs"]
    assert history[0]["id"] == run_data["id"]

    # 2. Trigger backup
    backup_res = admin_c.post("/api/operations/backups", json={"label": "api_test"})
    assert backup_res.status_code == 201
    backup_data = backup_res.json()
    assert backup_data["filename"].startswith("kalyan_backup_")
    assert backup_data["is_valid"] is True

    # 3. List backups
    list_res = admin_c.get("/api/operations/backups")
    assert list_res.status_code == 200
    list_data = list_res.json()
    assert list_data["total_count"] >= 1
    assert any(b["filename"] == backup_data["filename"] for b in list_data["backups"])

    # 4. Invalid confirmation phrase must be rejected before restore starts
    invalid_restore = admin_c.post(
        "/api/operations/restore",
        json={
            "archive_filename": backup_data["filename"],
            "create_prerestore_snapshot": True,
            "confirmation_phrase": "INVALID_CONFIRMATION",
            "reason": "Testing invalid restore confirmation phrase",
        },
    )
    assert invalid_restore.status_code == 422

    # 5. Restore using freshly created backup (mock subprocess restore to keep test DB intact).
    # The real release commits the request session, which this suite's begin_nested() override
    # cannot survive, so it is stubbed. The order matters: if the request transaction is still
    # open when restore runs, its locks block psql's DROP SCHEMA and the restore hangs.
    calls: list[str] = []

    def fake_restore_backup(**kwargs: Any) -> dict[str, Any]:
        calls.append("restore")
        return {
            "status": "SUCCESS",
            "archive_restored": backup_data["filename"],
            "database_restored": True,
            "photos_restored_count": 0,
            "prerestore_snapshot": "kalyan_snapshot_prerestore_test.tar.gz",
            "manifest": {"created_at": "2026-11-04T12:00:00Z", "label": "test"},
        }

    monkeypatch.setattr(
        "kalyan_api.routers.operations._release_request_transaction",
        lambda session: calls.append("release"),
    )
    monkeypatch.setattr("kalyan_api.routers.operations.restore_backup", fake_restore_backup)
    restore_res = admin_c.post(
        "/api/operations/restore",
        json={
            "archive_filename": backup_data["filename"],
            "create_prerestore_snapshot": True,
            "confirmation_phrase": "RESTORE",
            "reason": "Restore test archive after verified API backup lifecycle",
        },
    )
    assert restore_res.status_code == 200
    restore_data = restore_res.json()
    assert restore_data["status"] == "SUCCESS"
    assert restore_data["database_restored"] is True
    assert calls == ["release", "restore"]


def test_reading_the_integrity_page_runs_nothing(
    login_client: Any, admin_user: User, db_session: Any
) -> None:
    """GET only reads the stored run; it never runs the checks or writes an audit entry."""
    from sqlalchemy import func, select

    from kalyan_api.models import AuditLog, IntegrityRun

    admin_c = login_client(admin_user)

    def counts() -> tuple[int, int]:
        runs = db_session.scalar(select(func.count(IntegrityRun.id))) or 0
        audits = (
            db_session.scalar(
                select(func.count(AuditLog.id)).where(AuditLog.action == "INTEGRITY_CHECK_RUN")
            )
            or 0
        )
        return runs, audits

    before = counts()
    for _ in range(3):
        assert admin_c.get("/api/operations/integrity").status_code == 200
    assert counts() == before

    assert admin_c.post("/api/operations/integrity/run").status_code == 201
    assert counts() == (before[0] + 1, before[1] + 1)
