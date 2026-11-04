"""Tests for GET /api/system/status (Admin Panel module 12, System Health)."""

from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from kalyan_api import __version__ as PACKAGE_VERSION
from kalyan_api.config import Settings
from kalyan_api.models import User
from kalyan_api.routers import system

STATUS = "/api/system/status"

EXPECTED_KEYS = {
    "app_version",
    "environment",
    "db_revision",
    "code_head_revision",
    "revision_matches",
    "postgres_version",
    "db_size_bytes",
    "db_connections",
    "server_time_utc",
    "server_time_ist",
    "process_started_at",
    "uptime_seconds",
    "storage",
    "frontend_served",
    "checks",
}


def test_system_status_rbac(
    client: TestClient,
    login_client: Any,
    reception_user: User,
    doctor_a_user: User,
    admin_user: User,
) -> None:
    assert client.get(STATUS).status_code == 401
    assert login_client(reception_user).get(STATUS).status_code == 403
    assert login_client(doctor_a_user).get(STATUS).status_code == 403
    assert login_client(admin_user).get(STATUS).status_code == 200


def test_system_status_payload(
    login_client: Any,
    admin_user: User,
    db_session: Session,
    test_settings: Settings,
) -> None:
    res = login_client(admin_user).get(STATUS)
    assert res.status_code == 200, res.text
    body = res.json()
    assert set(body) == EXPECTED_KEYS

    assert body["app_version"] in {system.resolve_app_version(), PACKAGE_VERSION}
    assert body["environment"] == test_settings.env

    db_rev = db_session.scalar(text("SELECT version_num FROM alembic_version"))
    assert body["db_revision"] == db_rev
    assert body["code_head_revision"] == system.code_head_revision()
    assert body["revision_matches"] is (db_rev == body["code_head_revision"])

    assert body["postgres_version"]
    assert body["db_size_bytes"] > 0
    assert body["db_connections"] >= 1

    utc = datetime.fromisoformat(body["server_time_utc"])
    ist = datetime.fromisoformat(body["server_time_ist"])
    assert utc.utcoffset() is not None and utc.utcoffset().total_seconds() == 0
    assert ist.utcoffset() is not None and ist.utcoffset().total_seconds() == 19800
    assert utc == ist
    started = datetime.fromisoformat(body["process_started_at"])
    assert started <= datetime.now(UTC)
    assert body["uptime_seconds"] >= 0

    labels = [v["label"] for v in body["storage"]]
    assert labels == ["photos", "backups"]
    for volume in body["storage"]:
        assert set(volume) == {"label", "path_label", "total_bytes", "free_bytes"}
        assert isinstance(volume["total_bytes"], int)
        assert 0 <= volume["free_bytes"] <= volume["total_bytes"]
    assert body["storage"][0]["path_label"] == str(test_settings.photos_dir)
    assert isinstance(body["frontend_served"], bool)


def test_system_status_exposes_no_secrets(
    login_client: Any, admin_user: User, test_settings: Settings
) -> None:
    raw = login_client(admin_user).get(STATUS).text
    for secret in (test_settings.db_app_password, test_settings.db_owner_password):
        if secret:
            assert secret not in raw
    assert "postgresql" not in raw.lower()
    assert test_settings.db_owner_user not in raw
    assert test_settings.db_app_user not in raw
    assert "password" not in raw.lower()


def test_system_status_storage_and_frontend_flags(
    app: FastAPI,
    login_client: Any,
    admin_user: User,
    test_settings: Settings,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<html></html>", encoding="utf-8")
    custom = test_settings.model_copy(
        update={
            "frontend_dist": dist,
            "photos_dir": tmp_path / "not" / "created" / "photos",
            "backup_dir": tmp_path,
        }
    )
    monkeypatch.setattr(app.state, "settings", custom)

    body = login_client(admin_user).get(STATUS).json()
    assert body["frontend_served"] is True
    photos, backups = body["storage"]
    # Missing directory: measured on the nearest existing ancestor volume
    assert photos["path_label"] == str(custom.photos_dir)
    assert isinstance(photos["free_bytes"], int)
    assert backups["path_label"] == str(tmp_path)

    (dist / "index.html").unlink()
    assert login_client(admin_user).get(STATUS).json()["frontend_served"] is False


def test_resolve_app_version_falls_back_to_package_constant(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _missing(_name: str) -> str:
        raise system.metadata.PackageNotFoundError(_name)

    monkeypatch.setattr(system.metadata, "version", _missing)
    assert system.resolve_app_version() == PACKAGE_VERSION
