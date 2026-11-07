"""Tests for CLI operations subcommands (BAK-01, BAK-02, BAK-03, Plan 16-05)."""

from pathlib import Path

from kalyan_api.cli import (
    cmd_backup_create,
    cmd_backup_restore,
    cmd_backup_verify,
    cmd_integrity_check,
)


def test_cli_operations_workflow(tmp_path: Path, db_session):
    """Test full CLI lifecycle: create backup, verify it, run integrity check, and restore."""
    from kalyan_api.config import get_settings

    settings = get_settings()
    if settings.photos_dir.exists():
        for f in settings.photos_dir.glob("*"):
            if f.is_file() and not f.name.startswith("test_"):
                f.unlink()
    if settings.assets_dir.exists():
        for f in settings.assets_dir.glob("*"):
            if f.is_file() and not f.name.startswith("test_"):
                f.unlink()

    dest_dir = tmp_path / "cli_backups"

    # 1. Integrity check
    ret = cmd_integrity_check()
    assert ret == 0

    # 2. Backup create
    ret = cmd_backup_create(destination=str(dest_dir), label="cli_unit_test")
    assert ret == 0

    # Locate created bundle
    bundles = list(dest_dir.glob("kalyan_backup_*cli_unit_test.tar.gz"))
    assert len(bundles) == 1
    bundle_path = bundles[0]

    # 3. Backup verify
    ret = cmd_backup_verify(str(bundle_path))
    assert ret == 0

    # 4. Backup restore
    ret = cmd_backup_restore(str(bundle_path))
    assert ret == 0
