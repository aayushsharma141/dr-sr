"""Tests for backup engine and manifest generator (BAK-01, Plan 16-02)."""

import io
import tarfile
from pathlib import Path

import pytest

from kalyan_api.config import get_settings
from kalyan_api.services.backup_service import (
    InvalidArchiveFilenameError,
    InvalidBackupLabelError,
    InvalidDestinationDirError,
    create_backup,
    latest_backup_info,
    read_manifest,
    resolve_archive_in_dir,
    validate_destination_dir,
    validate_label,
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


def _write_archive(path: Path, db_bytes: bytes, manifest_sha: str | None = None) -> Path:
    import hashlib
    import json

    manifest = {
        "version": "1.0",
        "created_at": "2026-03-04T05:06:07+00:00",
        "database_dump_filename": "db.sql",
        "database_dump_sha256": manifest_sha or hashlib.sha256(db_bytes).hexdigest(),
        "database_dump_bytes": len(db_bytes),
        "photos_count": 0,
        "photos_manifest": [],
        "label": "unit",
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(path, "w:gz") as tar:
        for name, payload in (
            ("manifest.json", json.dumps(manifest).encode("utf-8")),
            ("db.sql", db_bytes),
        ):
            info = tarfile.TarInfo(name=name)
            info.size = len(payload)
            tar.addfile(info, io.BytesIO(payload))
    return path


@pytest.mark.parametrize(
    "name",
    [
        "",
        "..",
        "../kalyan_backup_x.tar.gz",
        "..\\kalyan_backup_x.tar.gz",
        "a/b.tar.gz",
        "a\\b.tar.gz",
        "C:\\x.tar.gz",
        "C:x.tar.gz",
        "/abs.tar.gz",
        "\\\\server\\share\\x.tar.gz",
        "x\x00.tar.gz",
        " padded.tar.gz",
        "kalyan..backup.tar.gz",
    ],
)
def test_resolve_archive_rejects_non_bare_names(tmp_path: Path, name: str):
    (tmp_path / "backups").mkdir()
    with pytest.raises(InvalidArchiveFilenameError):
        resolve_archive_in_dir(tmp_path / "backups", name)


def test_resolve_archive_requires_existing_regular_file(tmp_path: Path):
    backup_dir = tmp_path / "backups"
    (backup_dir / "kalyan_backup_dir.tar.gz").mkdir(parents=True)
    with pytest.raises(InvalidArchiveFilenameError):
        resolve_archive_in_dir(backup_dir, "kalyan_backup_missing.tar.gz")
    with pytest.raises(InvalidArchiveFilenameError):
        resolve_archive_in_dir(backup_dir, "kalyan_backup_dir.tar.gz")

    archive = _write_archive(backup_dir / "kalyan_backup_ok.tar.gz", b"SELECT 1;")
    assert resolve_archive_in_dir(backup_dir, "kalyan_backup_ok.tar.gz") == archive.resolve()


def test_validate_destination_dir(tmp_path: Path):
    approved = tmp_path / "approved"
    nested = approved / "nightly"
    nested.mkdir(parents=True)
    outside = tmp_path / "outside"
    outside.mkdir()
    assert validate_destination_dir(str(approved), [approved]) == approved.resolve()
    assert validate_destination_dir(str(nested), [approved]) == nested.resolve()
    a_file = approved / "f.txt"
    a_file.write_text("x", encoding="utf-8")
    for bad in [
        "",
        "   ",
        "relative/dir",
        str(approved / "missing"),
        str(a_file),
        str(outside),
        str(approved / ".." / "outside"),
        "\\\\fileserver\\share",
        "//fileserver/share",
    ]:
        with pytest.raises(InvalidDestinationDirError):
            validate_destination_dir(bad, [approved])


def test_validate_label():
    assert validate_label(None) is None
    assert validate_label("   ") is None
    assert validate_label(" nightly-01_a ") == "nightly-01_a"
    for bad in ["../x", "a b", "a/b", "x" * 51, "naïve"]:
        with pytest.raises(InvalidBackupLabelError):
            validate_label(bad)


def test_create_backup_rejects_unsafe_label_before_dumping(tmp_path: Path):
    with pytest.raises(InvalidBackupLabelError):
        create_backup(destination_dir=tmp_path, label="../../escape", settings=get_settings())
    assert list(tmp_path.iterdir()) == []


def test_read_manifest_does_not_rehash(tmp_path: Path):
    """read_manifest returns the manifest even when the payload checksum is wrong."""
    archive = _write_archive(tmp_path / "kalyan_backup_t.tar.gz", b"SELECT 1;", "0" * 64)
    manifest = read_manifest(archive)
    assert manifest is not None
    assert manifest["label"] == "unit"
    assert verify_backup_bundle(archive)[0] is False

    junk = tmp_path / "kalyan_backup_junk.tar.gz"
    junk.write_bytes(b"not a tarball")
    assert read_manifest(junk) is None


def test_latest_backup_info_picks_newest_archive(tmp_path: Path):
    import os

    backup_dir = tmp_path / "backups"
    assert latest_backup_info(backup_dir) is None
    backup_dir.mkdir()
    assert latest_backup_info(backup_dir) is None

    older = _write_archive(backup_dir / "kalyan_backup_20260101_000000_a.tar.gz", b"A")
    newer = _write_archive(backup_dir / "kalyan_backup_20260102_000000_b.tar.gz", b"B")
    os.utime(older, (1_700_000_000, 1_700_000_000))
    os.utime(newer, (1_800_000_000, 1_800_000_000))
    (backup_dir / "unrelated.tar.gz").write_bytes(b"ignored")

    info = latest_backup_info(backup_dir)
    assert info is not None
    assert info.filename == newer.name
    assert info.size_bytes == newer.stat().st_size
    assert info.manifest_readable is True
    assert info.label == "unit"
    assert info.created_at.isoformat() == "2026-03-04T05:06:07+00:00"

    broken = backup_dir / "kalyan_backup_20260103_000000_c.tar.gz"
    broken.write_bytes(b"truncated")
    os.utime(broken, (1_900_000_000, 1_900_000_000))
    info2 = latest_backup_info(backup_dir)
    assert info2 is not None
    assert info2.filename == broken.name
    assert info2.manifest_readable is False
    assert info2.label is None
