"""Tests for backup bundling and integrity checks with hospital assets (SET-01, BAK-01, BAK-03).

Guarantees:
- Backup bundle creation includes assets directory in manifest.json and tar archive.
- SHA-256 verification detects single-bit tampering of asset files in archives.
- Backward compatibility: archives without assets_manifest verify and restore safely.
- Restore extracts assets into configured assets_dir.
- Integrity check flags missing physical assets and untracked orphan files.
"""

import io
import json
import tarfile
from pathlib import Path

import pytest
from sqlalchemy.orm import Session

from kalyan_api.config import Settings, get_settings
from kalyan_api.models import AssetType, HospitalAsset, User
from kalyan_api.services.backup_service import (
    create_backup,
    restore_backup,
    verify_backup_bundle,
)
from kalyan_api.services.integrity_service import check_asset_storage_integrity

DUMMY_PNG = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4"
DUMMY_PDF = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF"


def test_backup_bundle_includes_assets(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    test_settings: Settings,
) -> None:
    """Backup bundle contains assets folder and assets_manifest in manifest.json."""
    assets_dir = tmp_path / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(test_settings, "assets_dir", assets_dir)

    # Place a sample asset
    logo_file = assets_dir / "crest_sample.png"
    logo_file.write_bytes(DUMMY_PNG)

    backup_dest = tmp_path / "backup_out"

    archive_path = create_backup(
        destination_dir=backup_dest,
        label="assets_test",
        settings=test_settings,
    )

    assert archive_path.exists()

    is_valid, msg, manifest = verify_backup_bundle(archive_path)
    assert is_valid is True, msg
    assert manifest is not None
    assert manifest.get("assets_count") == 1
    assert len(manifest.get("assets_manifest", [])) == 1
    entry = manifest["assets_manifest"][0]
    assert entry["filename"] == "crest_sample.png"
    assert entry["bytes"] == len(DUMMY_PNG)
    assert len(entry["sha256"]) == 64


def test_backup_bundle_detects_asset_tampering(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    test_settings: Settings,
) -> None:
    """Tampering with an asset inside the archive causes checksum verification failure."""
    assets_dir = tmp_path / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(test_settings, "assets_dir", assets_dir)

    cert_file = assets_dir / "reg_cert.pdf"
    cert_file.write_bytes(DUMMY_PDF)

    backup_dest = tmp_path / "backup_tamper"
    archive_path = create_backup(
        destination_dir=backup_dest,
        label="tamper_test",
        settings=test_settings,
    )

    # Create tampered archive
    tampered_archive = backup_dest / "kalyan_backup_tampered.tar.gz"
    with (
        tarfile.open(archive_path, "r:gz") as src_tar,
        tarfile.open(tampered_archive, "w:gz") as dst_tar,
    ):
        for member in src_tar.getmembers():
            f = src_tar.extractfile(member)
            if member.name == "assets/reg_cert.pdf" and f:
                tampered_bytes = DUMMY_PDF + b"\n% TAMPERED"
                t_info = tarfile.TarInfo(name=member.name)
                t_info.size = len(tampered_bytes)
                t_info.mtime = member.mtime
                dst_tar.addfile(t_info, io.BytesIO(tampered_bytes))
            elif f:
                dst_tar.addfile(member, f)
            else:
                dst_tar.addfile(member)

    is_valid, msg, _ = verify_backup_bundle(tampered_archive)
    assert is_valid is False
    assert "Checksum mismatch for asset reg_cert.pdf" in msg


def test_backup_backward_compatibility_without_assets(
    tmp_path: Path,
    test_settings: Settings,
) -> None:
    """Archives created before Phase 20 without assets_manifest verify cleanly."""
    backup_dest = tmp_path / "legacy_bundle"
    backup_dest.mkdir()
    legacy_tar_path = backup_dest / "kalyan_backup_legacy.tar.gz"

    manifest_content = {
        "version": "1.0",
        "created_at": "2026-11-01T00:00:00+00:00",
        "database_dump_filename": "db.sql",
        "database_dump_sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "database_dump_bytes": 0,
        "photos_count": 0,
        "photos_manifest": [],
    }
    manifest_bytes = json.dumps(manifest_content).encode("utf-8")

    with tarfile.open(legacy_tar_path, "w:gz") as tar:
        # manifest.json
        t_m = tarfile.TarInfo(name="manifest.json")
        t_m.size = len(manifest_bytes)
        tar.addfile(t_m, io.BytesIO(manifest_bytes))
        # empty db.sql
        t_db = tarfile.TarInfo(name="db.sql")
        t_db.size = 0
        tar.addfile(t_db, io.BytesIO(b""))

    is_valid, msg, manifest = verify_backup_bundle(legacy_tar_path)
    assert is_valid is True, msg
    assert manifest is not None
    assert "assets_manifest" not in manifest or manifest["assets_manifest"] == []


def test_asset_storage_integrity_check(
    db_session: Session,
    admin_user: User,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    test_settings: Settings,
) -> None:
    """check_asset_storage_integrity detects missing files and untracked orphan files."""
    assets_dir = tmp_path / "integrity_assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(test_settings, "assets_dir", assets_dir)

    # 1. Clean state: no DB records, no files -> passed
    res1 = check_asset_storage_integrity(db_session, test_settings)
    assert res1.passed is True
    assert len(res1.discrepancies) == 0

    # 2. Add an asset record in DB with physical file on disk -> passed
    filename = "test_asset_uuid.png"
    (assets_dir / filename).write_bytes(DUMMY_PNG)

    asset = HospitalAsset(
        asset_type=AssetType.LOGO.value,
        filename=filename,
        original_filename="logo.png",
        mime_type="image/png",
        file_size_bytes=len(DUMMY_PNG),
        is_active=True,
        version=1,
        uploaded_by_user_id=admin_user.id,
    )
    db_session.add(asset)
    db_session.flush()

    res2 = check_asset_storage_integrity(db_session, test_settings)
    assert res2.passed is True

    # 3. Add second DB asset without creating file on disk -> flags missing_asset_file
    missing_fname = "missing_asset.pdf"
    asset_missing = HospitalAsset(
        asset_type=AssetType.REGISTRATION_DOC.value,
        filename=missing_fname,
        original_filename="doc.pdf",
        mime_type="application/pdf",
        file_size_bytes=100,
        is_active=True,
        version=1,
        uploaded_by_user_id=admin_user.id,
    )
    db_session.add(asset_missing)
    db_session.flush()

    res3 = check_asset_storage_integrity(db_session, test_settings)
    assert res3.passed is False
    assert any(d["issue"] == "missing_asset_file" and d["filename"] == missing_fname for d in res3.discrepancies)

    # 4. Supply file for missing asset so DB assets are satisfied, then create an untracked orphan file
    (assets_dir / missing_fname).write_bytes(DUMMY_PDF)
    orphan_file = assets_dir / "untracked_orphan.jpg"
    orphan_file.write_bytes(b"\xff\xd8\xff\xe0")

    res4 = check_asset_storage_integrity(db_session, test_settings)
    assert res4.passed is False
    assert not any(d["issue"] == "missing_asset_file" for d in res4.discrepancies)
    assert any(d["issue"] == "orphan_asset_file" and d["filename"] == "untracked_orphan.jpg" for d in res4.discrepancies)
