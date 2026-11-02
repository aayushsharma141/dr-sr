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
        client.post("/api/operations/restore", json={"archive_filename": "foo"}).status_code == 401
    )

    # 2. Reception -> 403
    rec_c = login_client(reception_user)
    assert rec_c.get("/api/operations/backups").status_code == 403
    assert rec_c.get("/api/operations/integrity").status_code == 403
    assert rec_c.post("/api/operations/backups", json={}).status_code == 403
    assert (
        rec_c.post("/api/operations/restore", json={"archive_filename": "foo"}).status_code == 403
    )

    # 3. Doctor -> 403
    doc_c = login_client(doctor_a_user)
    assert doc_c.get("/api/operations/backups").status_code == 403
    assert doc_c.get("/api/operations/integrity").status_code == 403
    assert doc_c.post("/api/operations/backups", json={}).status_code == 403
    assert (
        doc_c.post("/api/operations/restore", json={"archive_filename": "foo"}).status_code == 403
    )


def test_operations_admin_lifecycle(
    login_client: Any,
    admin_user: User,
) -> None:
    """Admin can list backups, trigger a backup, check integrity, and restore."""
    admin_c = login_client(admin_user)

    # 1. Check integrity
    integ_res = admin_c.get("/api/operations/integrity")
    assert integ_res.status_code == 200
    integ_data = integ_res.json()
    assert "is_healthy" in integ_data
    assert integ_data["total_checks"] == 5

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

    # 4. Restore using the freshly created backup
    restore_res = admin_c.post(
        "/api/operations/restore",
        json={"archive_filename": backup_data["filename"], "create_prerestore_snapshot": False},
    )
    assert restore_res.status_code == 200
    restore_data = restore_res.json()
    assert restore_data["status"] == "SUCCESS"
    assert restore_data["database_restored"] is True
