"""Regression tests for Admin Workspace Phase 2 Backend Defects (M1, M2, M4, M11, M13, M14).

Each test reproduces a verified defect from the Admin Workspace audit:
- M1: Non-super Admin resetting Super Admin password & temporary password authorising deletion.
- M2: Security Center policy overrides ignored by /api/auth/login and /api/auth/change-password.
- M4: Backup/restore omitting settings.documents_dir and dropping delete_unreferenced_user grants.
- M11: GET /api/operations/backups synchronously running full SHA-256 verification on all archives.
- M13: Import batch re-validation crashing on int age_years, committing STAGED, resolving COMMITTED.
- M14: Workstation heartbeat trusting spoofable X-Forwarded-For, null client crash, and
       contradictory authenticated_only vs current_principal policy.
"""

from __future__ import annotations

import io
import json
import tarfile
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from kalyan_api.config import Settings
from kalyan_api.core.permissions import Role
from kalyan_api.core.principal import Principal
from kalyan_api.models import AuditLog, Patient, User, Workstation
from kalyan_api.schemas.workstations import WorkstationHeartbeatIn
from kalyan_api.services import workstation_service
from kalyan_api.services.backup_service import (
    create_backup,
    restore_backup,
    runtime_grant_sql,
    verify_backup_bundle,
)
from tests.conftest import TEST_PASSWORD, make_user

SUPER_PASSWORD = "SuperAdminSecret789!"
DUMMY_PDF = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF"


# --------------------------------------------------------------------------------------
# M1: Super-admin password reset & temporary password deletion guard
# --------------------------------------------------------------------------------------


def test_m1_non_super_admin_cannot_reset_super_admin_password(
    db_session: Session,
    login_client: Any,
    test_settings: Settings,
) -> None:
    """A regular ADMIN must not be able to reset a Super Admin's password via the admin API."""
    actor = make_user(db_session, test_settings, "ADMIN", "m1_regular_admin")
    super_admin = make_user(
        db_session,
        test_settings,
        "ADMIN",
        "m1_super_admin",
        password=SUPER_PASSWORD,
        is_super_admin=True,
    )
    original_hash = super_admin.password_hash

    super_client = login_client(super_admin, password=SUPER_PASSWORD)
    actor_client = login_client(actor)

    res = actor_client.post(
        f"/api/users/{super_admin.id}/reset-password",
        json={"version_id": super_admin.version_id, "reason": "attempted reset"},
    )
    assert res.status_code == 409, res.text
    assert res.json()["code"] == "super_admin_protected"
    assert "temporary_password" not in res.json()

    db_session.expire_all()
    refreshed = db_session.get(User, super_admin.id)
    assert refreshed is not None
    assert refreshed.password_hash == original_hash
    assert refreshed.must_change_password is False
    # Super admin's existing session must remain valid
    assert super_client.get("/api/admin/overview").status_code == 200


def test_m1_temporary_super_admin_password_cannot_authorise_user_delete(
    db_session: Session,
    login_client: Any,
    test_settings: Settings,
) -> None:
    """A super admin account with must_change_password=True cannot authorise user deletion."""
    actor = make_user(db_session, test_settings, "ADMIN", "m1_del_actor")
    # Ensure no other active non-pending super admin exists in this transaction
    from sqlalchemy import text

    db_session.execute(text("UPDATE users SET is_super_admin = false"))
    db_session.flush()

    pending_super = make_user(
        db_session,
        test_settings,
        "ADMIN",
        "m1_pending_super",
        password=SUPER_PASSWORD,
        is_super_admin=True,
        must_change=True,
    )
    target = make_user(
        db_session,
        test_settings,
        "RECEPTION",
        "m1_del_target",
        is_active=False,
    )
    db_session.flush()

    actor_client = login_client(actor)
    res = actor_client.post(
        f"/api/users/{target.id}/delete",
        json={
            "version_id": target.version_id,
            "super_admin_password": SUPER_PASSWORD,
            "reason": "should be rejected when super admin password is temporary",
        },
    )
    assert res.status_code == 409, res.text
    assert res.json()["code"] == "no_super_admin"
    assert pending_super.must_change_password is True
    db_session.expire_all()
    assert db_session.get(User, target.id) is not None


# --------------------------------------------------------------------------------------
# M2: Security Center policy overrides enforced on /auth/login & /auth/change-password
# --------------------------------------------------------------------------------------


def test_m2_security_policy_overrides_enforced_on_login_and_change_password(
    app: FastAPI,
    db_session: Session,
    login_client: Any,
    admin_user: User,
    test_settings: Settings,
) -> None:
    """Tightened password_min_length and lockout_threshold in SecuritySettings must be enforced."""
    admin_client = login_client(admin_user)
    current = admin_client.get("/api/security/policy").json()

    patch_res = admin_client.patch(
        "/api/security/policy",
        json={
            "version_id": current["version_id"],
            "session_idle_minutes": current["session_idle_minutes"],
            "session_absolute_hours": current["session_absolute_hours"],
            "lockout_threshold": 3,
            "lockout_minutes": max(current["lockout_minutes"], 30),
            "password_min_length": 14,
            "reason": "Tighten clinic security policy for M2 regression test",
        },
    )
    assert patch_res.status_code == 200, patch_res.text
    assert patch_res.json()["password_min_length"] == 14
    assert patch_res.json()["lockout_threshold"] == 3

    # 1. /api/auth/change-password must reject a 10-char password when min_length is 14
    staff = make_user(db_session, test_settings, "RECEPTION", "m2_pw_staff")
    staff_client = login_client(staff)
    short_pw_res = staff_client.post(
        "/api/auth/change-password",
        json={
            "current_password": TEST_PASSWORD,
            # 10 chars: passes env baseline (8) but fails tightened override (14)
            "new_password": "TenChar!99",
        },
    )
    assert short_pw_res.status_code == 422, short_pw_res.text
    assert short_pw_res.json()["code"] == "password_policy"
    assert "14" in short_pw_res.json()["message"]

    # 2. /api/auth/login must lock account after 3 failed attempts (not env default 5)
    victim = make_user(db_session, test_settings, "RECEPTION", "m2_lock_victim")
    anon_client = TestClient(
        app,
        base_url="http://testserver",
        headers={"Origin": "http://testserver"},
    )
    for _ in range(3):
        fail_res = anon_client.post(
            "/api/auth/login",
            json={"username": victim.username, "password": "WrongPassword999!"},
        )
        assert fail_res.status_code == 401

    db_session.expire_all()
    locked_victim = db_session.get(User, victim.id)
    assert locked_victim is not None
    assert locked_victim.failed_login_count == 3
    assert locked_victim.locked_until is not None

    # Correct password must now be refused while locked
    blocked_res = anon_client.post(
        "/api/auth/login",
        json={"username": victim.username, "password": TEST_PASSWORD},
    )
    assert blocked_res.status_code == 401
    lock_audit = db_session.scalar(
        select(func.count(AuditLog.id)).where(
            AuditLog.action == "AUTH_ACCOUNT_LOCKED",
            AuditLog.entity_id == str(victim.id),
        )
    )
    assert lock_audit == 1


# --------------------------------------------------------------------------------------
# M4: Backup/restore includes documents_dir & restores delete_unreferenced_user grants
# --------------------------------------------------------------------------------------


def test_m4_backup_verify_and_restore_includes_patient_documents(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    test_settings: Settings,
) -> None:
    """create_backup, verify_backup_bundle, and restore_backup must cover settings.documents_dir."""
    docs_dir = tmp_path / "m4_documents"
    docs_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(test_settings, "documents_dir", docs_dir)

    doc_file = docs_dir / "patient_lab_report.pdf"
    doc_file.write_bytes(DUMMY_PDF)

    backup_dest = tmp_path / "m4_backups"
    archive_path = create_backup(
        destination_dir=backup_dest,
        label="docs_test",
        settings=test_settings,
    )

    is_valid, msg, manifest = verify_backup_bundle(archive_path)
    assert is_valid is True, msg
    assert manifest is not None
    assert manifest.get("documents_count") == 1
    docs_manifest = manifest.get("documents_manifest", [])
    assert len(docs_manifest) == 1
    assert docs_manifest[0]["filename"] == "patient_lab_report.pdf"
    assert docs_manifest[0]["bytes"] == len(DUMMY_PDF)
    assert len(docs_manifest[0]["sha256"]) == 64

    # Tampering a document inside the archive must fail SHA-256 verification
    tampered_archive = backup_dest / "kalyan_backup_tampered_doc.tar.gz"
    with (
        tarfile.open(archive_path, "r:gz") as src_tar,
        tarfile.open(tampered_archive, "w:gz") as dst_tar,
    ):
        for member in src_tar.getmembers():
            f = src_tar.extractfile(member)
            if member.name == "documents/patient_lab_report.pdf" and f:
                tampered_bytes = DUMMY_PDF + b"\n% TAMPERED"
                t_info = tarfile.TarInfo(name=member.name)
                t_info.size = len(tampered_bytes)
                t_info.mtime = member.mtime
                dst_tar.addfile(t_info, io.BytesIO(tampered_bytes))
            elif f:
                dst_tar.addfile(member, f)
            else:
                dst_tar.addfile(member)

    tampered_valid, tampered_msg, _ = verify_backup_bundle(tampered_archive)
    assert tampered_valid is False
    assert "Checksum mismatch for document patient_lab_report.pdf" in tampered_msg

    # Delete original document from disk and verify restore_backup restores it
    doc_file.unlink()
    assert not doc_file.exists()

    monkeypatch.setattr(test_settings, "backup_dir", backup_dest)
    with patch("kalyan_api.services.backup_service.restore_database_sql"):
        summary = restore_backup(archive_path, settings=test_settings)

    assert doc_file.exists()
    assert doc_file.read_bytes() == DUMMY_PDF
    assert summary["documents_restored_count"] == 1


def test_m4_runtime_grant_sql_restores_delete_unreferenced_user_privileges() -> None:
    """runtime_grant_sql must restore guarded privileges on delete_unreferenced_user."""
    sql = runtime_grant_sql("kalyan_app")
    assert "to_regprocedure('public.delete_unreferenced_user(bigint)') IS NOT NULL" in sql
    assert "REVOKE ALL ON FUNCTION public.delete_unreferenced_user(bigint) FROM PUBLIC;" in sql
    expected_grant = (
        'GRANT EXECUTE ON FUNCTION public.delete_unreferenced_user(bigint) TO "kalyan_app";'
    )
    assert expected_grant in sql


# --------------------------------------------------------------------------------------
# M11: GET /api/operations/backups uses fast head-only read_manifest, not full verify
# --------------------------------------------------------------------------------------


def test_m11_list_backups_reads_manifest_without_full_verification(
    login_client: Any,
    admin_user: User,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Listing backups must NOT call verify_backup_bundle (full decompression + SHA-256 hashing)."""
    admin_client = login_client(admin_user)
    created = admin_client.post("/api/operations/backups", json={"label": "m11_fast_list"})
    assert created.status_code == 201, created.text
    filename = created.json()["filename"]

    def _forbid_full_verify(*args: Any, **kwargs: Any) -> Any:
        raise AssertionError("GET /api/operations/backups must not call verify_backup_bundle()")

    monkeypatch.setattr("kalyan_api.routers.operations.verify_backup_bundle", _forbid_full_verify)

    res = admin_client.get("/api/operations/backups")
    assert res.status_code == 200, res.text
    items = res.json()["backups"]
    entry = next((b for b in items if b["filename"] == filename), None)
    assert entry is not None
    assert entry["is_valid"] is True
    assert entry["label"] == "m11_fast_list"
    assert isinstance(entry["manifest"], dict)


# --------------------------------------------------------------------------------------
# M13: Import re-validation on int age_years + STAGED commit & COMMITTED resolve guards
# --------------------------------------------------------------------------------------


def test_m13_import_revalidate_and_batch_state_guards(
    login_client: Any,
    admin_user: User,
    db_session: Session,
) -> None:
    """Re-validating works on int age; STAGED cannot commit; COMMITTED cannot resolve."""
    admin_client = login_client(admin_user)

    existing = Patient(
        urn="KH-26-P-11-91301",
        full_name="Meera Devi",
        guardian_name="Suresh Prasad",
        gender="F",
        age_years=31,
        mobile="9876513001",
        address="Station Road Ara",
        district="Bhojpur",
        state="Bihar",
    )
    db_session.add(existing)
    db_session.flush()

    csv_content = (
        b"full_name,guardian_name,gender,age_years,mobile,address\n"
        b"Rohan Kumar,Mohan Kumar,M,30,9876513002,Main Road Ara\n"
        b"Baby Infant,Mohan Kumar,F,0,9876513003,Main Road Ara\n"
        b"Meera Devi,Suresh Prasad,F,31,9876513001,Station Road Ara\n"
    )
    mapping = {
        k: k for k in ["full_name", "guardian_name", "gender", "age_years", "mobile", "address"]
    }
    stage_res = admin_client.post(
        "/api/admin/imports",
        files={"file": ("m13.csv", csv_content, "text/csv")},
        data={"column_mapping": json.dumps(mapping)},
    )
    assert stage_res.status_code == 201, stage_res.text
    batch_id = stage_res.json()["batch_id"]

    # 1. Committing while STAGED must fail closed with 409 without triggering a backup
    with patch("kalyan_api.services.backup_service.create_backup") as mock_backup:
        mock_backup.return_value = Path("kalyan_backup_m13_staged.tar.gz")
        staged_commit = admin_client.post(f"/api/admin/imports/{batch_id}/commit")
        assert staged_commit.status_code == 409, staged_commit.text
        assert staged_commit.json()["code"] == "batch_not_validated"
        mock_backup.assert_not_called()

    # 2. Re-validating must not crash on int age_years (including infant age 0)
    val1 = admin_client.post(f"/api/admin/imports/{batch_id}/validate")
    assert val1.status_code == 200, val1.text
    assert val1.json()["valid_rows"] == 2
    assert val1.json()["duplicate_rows"] == 1

    val2 = admin_client.post(f"/api/admin/imports/{batch_id}/validate")
    assert val2.status_code == 200, val2.text
    assert val2.json()["valid_rows"] == 2
    assert val2.json()["duplicate_rows"] == 1
    assert val2.json()["invalid_rows"] == 0

    dup_row_id = admin_client.get(f"/api/admin/imports/{batch_id}/duplicates").json()["duplicates"][
        0
    ]["row_id"]

    # 3. Commit validated batch
    with patch("kalyan_api.services.backup_service.create_backup") as mock_backup:
        mock_backup.return_value = Path("kalyan_backup_m13.tar.gz")
        commit_res = admin_client.post(f"/api/admin/imports/{batch_id}/commit")
        assert commit_res.status_code == 200, commit_res.text
        assert commit_res.json()["committed_rows"] == 2

    # 4. Resolving duplicates after COMMITTED must be rejected with 409
    late_resolve = admin_client.post(
        f"/api/admin/imports/{batch_id}/resolve",
        json={"resolutions": [{"row_id": dup_row_id, "resolution": "IMPORT_AS_NEW"}]},
    )
    assert late_resolve.status_code == 409, late_resolve.text
    assert late_resolve.json()["code"] == "batch_already_committed"


# --------------------------------------------------------------------------------------
# M14: Workstation heartbeat IP spoofing, null/long IP, upsert, and pending-password auth
# --------------------------------------------------------------------------------------


def test_m14_workstation_heartbeat_ignores_xff_handles_null_client_and_pending_password(
    login_client: Any,
    db_session: Session,
    reception_user: User,
    test_settings: Settings,
) -> None:
    """Heartbeat uses peer IP (never XFF), survives client=None, and allows pending pwd."""
    rec_client = login_client(reception_user)

    # 1. Spoofed X-Forwarded-For must be ignored
    spoof_res = rec_client.post(
        "/api/system/heartbeat",
        json={"hostname": "M14-DESK-01", "terminal_name": "Reception 1", "app_version": "1.0.0"},
        headers={"X-Forwarded-For": "10.99.99.99"},
    )
    assert spoof_res.status_code == 200, spoof_res.text
    assert spoof_res.json()["ip_address"] == "127.0.0.1"

    # 2. Oversized (>64 char) X-Forwarded-For must NOT cause 500 StringDataRightTruncation
    long_xff = "10.0.0." + "1" * 100
    long_res = rec_client.post(
        "/api/system/heartbeat",
        json={
            "hostname": "M14-DESK-01",
            "terminal_name": "Reception 1 Updated",
            "app_version": "1.0.1",
        },
        headers={"X-Forwarded-For": long_xff},
    )
    assert long_res.status_code == 200, long_res.text
    assert long_res.json()["ip_address"] == "127.0.0.1"
    assert long_res.json()["terminal_name"] == "Reception 1 Updated"

    # Upsert must keep exactly 1 row for M14-DESK-01
    row_count = db_session.scalar(
        select(func.count(Workstation.id)).where(Workstation.hostname == "M14-DESK-01")
    )
    assert row_count == 1

    # 3. Direct call with request.client=None falls back to non-null IP
    fake_request = SimpleNamespace(client=None, headers={"x-forwarded-for": "192.168.9.9"})
    principal = Principal(
        user_id=reception_user.id,
        username=reception_user.username,
        role=Role.RECEPTION,
        doctor_id=None,
        permissions=frozenset(),
        session_id=1,
        must_change_password=False,
    )
    ws_out = workstation_service.record_heartbeat(
        db_session,
        principal,
        fake_request,  # type: ignore[arg-type]
        WorkstationHeartbeatIn(hostname="M14-DESK-NULL-CLIENT"),
    )
    assert ws_out.ip_address == "0.0.0.0"  # noqa: S104

    # 4. Pending-password user is allowed on /api/system/heartbeat (authenticated_only)
    pending_user = make_user(
        db_session,
        test_settings,
        "RECEPTION",
        "m14_pending_user",
        must_change=True,
    )
    pending_client = login_client(pending_user)
    pending_res = pending_client.post(
        "/api/system/heartbeat",
        json={"hostname": "M14-DESK-PENDING", "terminal_name": "Pending Desk"},
    )
    assert pending_res.status_code == 200, pending_res.text
    assert pending_res.json()["last_username"] == pending_user.username
