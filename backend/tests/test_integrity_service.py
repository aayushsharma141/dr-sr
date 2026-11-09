"""Tests for clinical and financial integrity check engine (BAK-03, Plan 16-04)."""

from pathlib import Path

from kalyan_api.config import get_settings
from kalyan_api.models import Patient
from kalyan_api.services.integrity_service import (
    check_photo_storage_integrity,
    run_integrity_audit,
)


def test_integrity_audit_clean_database(db_session):
    """In a standard clean test database, all integrity checks should pass."""
    settings = get_settings()
    # Clean any residual orphan test files
    if settings.photos_dir.exists():
        for f in settings.photos_dir.glob("*"):
            if f.is_file() and not f.name.startswith("test_"):
                f.unlink()
    if settings.assets_dir.exists():
        for f in settings.assets_dir.glob("*"):
            if f.is_file() and not f.name.startswith("test_"):
                f.unlink()
    report = run_integrity_audit(db_session, settings)
    assert report.total_checks == 7
    assert report.is_healthy is True
    assert report.failed_checks == 0
    assert all(c.passed for c in report.checks)


def test_integrity_audit_detects_orphan_and_missing_photos(db_session, tmp_path: Path):
    """Test photo storage check detects missing files and untracked orphans."""
    settings = get_settings()

    # 1. Create an orphan photo file on disk (not starting with test_)
    settings.photos_dir.mkdir(parents=True, exist_ok=True)
    orphan_file = settings.photos_dir / "untracked_orphan_img.jpg"
    orphan_file.write_bytes(b"ORPHAN_IMAGE_DATA")

    try:
        p = Patient(
            urn="KHM-2026-88888",
            full_name="Photo Missing Patient",
            guardian_name="Guardian",
            gender="M",
            age_years=25,
            mobile="9876543211",
            address="Street 1",
            district="Kangra",
            state="Himachal Pradesh",
            photo_path="/api/patients/photos/non_existent_file.jpg",
        )
        db_session.add(p)
        db_session.flush()

        # Run check
        res = check_photo_storage_integrity(db_session, settings)
        assert res.passed is False
        issues = [d["issue"] for d in res.discrepancies]
        assert "missing_photo_file" in issues
        assert "orphan_photo_file" in issues
    finally:
        if orphan_file.exists():
            orphan_file.unlink()


def test_each_finding_has_its_own_severity(db_session, tmp_path: Path):
    """A missing linked file is an ERROR; an unlinked file on disk is only CLEANUP."""
    settings = get_settings().model_copy(update={"photos_dir": tmp_path})
    (tmp_path / "unlinked_leftover.jpg").write_bytes(b"x" * 12)

    only_orphan = check_photo_storage_integrity(db_session, settings)
    assert only_orphan.code == "photo_files"
    assert only_orphan.passed is False
    assert [d["severity"] for d in only_orphan.discrepancies] == ["CLEANUP"]
    assert only_orphan.severity == "CLEANUP"

    db_session.add(
        Patient(
            urn="KHM-2026-88889",
            full_name="Missing Photo Patient",
            guardian_name="Guardian",
            gender="F",
            age_years=40,
            mobile="9876543212",
            address="Street 2",
            district="Kangra",
            state="Himachal Pradesh",
            photo_path="/api/patients/photos/gone.jpg",
        )
    )
    db_session.flush()

    mixed = check_photo_storage_integrity(db_session, settings)
    by_issue = {d["issue"]: d["severity"] for d in mixed.discrepancies}
    assert by_issue == {"orphan_photo_file": "CLEANUP", "missing_photo_file": "ERROR"}
    assert mixed.severity == "ERROR"


def test_cleanup_only_findings_leave_the_report_healthy(db_session, tmp_path: Path):
    """Clutter is counted separately and does not make the report unhealthy."""
    photos = tmp_path / "photos"
    assets = tmp_path / "assets"
    photos.mkdir()
    assets.mkdir()
    (photos / "stray.jpg").write_bytes(b"x")
    settings = get_settings().model_copy(update={"photos_dir": photos, "assets_dir": assets})

    report = run_integrity_audit(db_session, settings)
    assert report.cleanup_checks == 1
    assert report.failed_checks == 0
    assert report.is_healthy is True
    assert (
        report.passed_checks
        + report.failed_checks
        + report.warning_checks
        + (report.cleanup_checks)
        == report.total_checks
    )
