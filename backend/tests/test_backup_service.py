"""Tests for backup engine and manifest generator (BAK-01, Plan 16-02)."""

import io
import tarfile
from pathlib import Path

from kalyan_api.config import get_settings
from kalyan_api.services.backup_service import (
    create_backup,
    verify_backup_bundle,
)


def test_create_and_verify_backup_bundle(tmp_path: Path):
    """Test full backup creation and verification against active test database."""
    settings = get_settings()

    # Ensure photos dir exists with at least one mock photo
    settings.photos_dir.mkdir(parents=True, exist_ok=True)
    mock_photo = settings.photos_dir / "test_photo_sample.jpg"
    mock_photo.write_bytes(b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00")

    dest_dir = tmp_path / "custom_backups"

    # Create backup
    archive_path = create_backup(destination_dir=dest_dir, label="testrun", settings=settings)

    assert archive_path.exists()
    assert archive_path.name.startswith("kalyan_backup_")
    assert "testrun" in archive_path.name
    assert archive_path.name.endswith(".tar.gz")

    # Verify backup
    is_valid, msg, manifest = verify_backup_bundle(archive_path)
    assert is_valid is True
    assert "cryptographically verified" in msg
    assert manifest is not None
    assert manifest["version"] == "1.0"
    assert manifest["database_dump_filename"] == "db.sql"
    assert len(manifest["database_dump_sha256"]) == 64
    assert manifest["photos_count"] >= 1
    assert any(p["filename"] == "test_photo_sample.jpg" for p in manifest["photos_manifest"])


def test_backup_detects_corruption(tmp_path: Path):
    """Test that tampering with archive contents triggers verification failure."""
    dest_dir = tmp_path / "corrupt_test"
    archive_path = create_backup(
        destination_dir=dest_dir,
        label="tamper",
        settings=get_settings(),
    )

    # Read archive, tamper with tar contents
    tampered_archive = dest_dir / "kalyan_backup_tampered.tar.gz"

    with (
        tarfile.open(archive_path, "r:gz") as src_tar,
        tarfile.open(tampered_archive, "w:gz") as dst_tar,
    ):
        for member in src_tar.getmembers():
            f = src_tar.extractfile(member)
            if member.name == "db.sql" and f:
                content = f.read()
                # Flip bytes in db.sql
                tampered_content = content + b"\n-- TAMPERED DATA\n"
                t_info = tarfile.TarInfo(name=member.name)
                t_info.size = len(tampered_content)
                t_info.mtime = member.mtime
                dst_tar.addfile(t_info, io.BytesIO(tampered_content))
            elif f:
                dst_tar.addfile(member, f)
            else:
                dst_tar.addfile(member)

    # Now verify the tampered archive
    is_valid, msg, _ = verify_backup_bundle(tampered_archive)
    assert is_valid is False
    assert "Checksum mismatch for db.sql" in msg
