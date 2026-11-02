"""Tests for clinical and financial integrity check engine (BAK-03, Plan 16-04)."""

from pathlib import Path

from kalyan_api.config import get_settings
from kalyan_api.db.session import session_scope
from kalyan_api.models import Patient
from kalyan_api.services.integrity_service import (
    check_photo_storage_integrity,
    run_integrity_audit,
)


def test_integrity_audit_clean_database():
    """In a standard clean test database, all integrity checks should pass."""
    settings = get_settings()
    with session_scope(settings) as session:
        report = run_integrity_audit(session, settings)
        assert report.total_checks == 5
        assert report.is_healthy is True
        assert report.failed_checks == 0
        assert all(c.passed for c in report.checks)


def test_integrity_audit_detects_orphan_and_missing_photos(tmp_path: Path):
    """Test photo storage check detects missing files and untracked orphans."""
    settings = get_settings()

    # 1. Create an orphan photo file on disk (not starting with test_)
    settings.photos_dir.mkdir(parents=True, exist_ok=True)
    orphan_file = settings.photos_dir / "untracked_orphan_img.jpg"
    orphan_file.write_bytes(b"ORPHAN_IMAGE_DATA")

    with session_scope(settings) as session:
        # 2. Create patient with missing photo path
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
        session.add(p)
        session.commit()

        # Run check
        res = check_photo_storage_integrity(session, settings)
        assert res.passed is False
        issues = [d["issue"] for d in res.discrepancies]
        assert "missing_photo_file" in issues
        assert "orphan_photo_file" in issues

        # Cleanup
        session.delete(p)
        session.commit()

    if orphan_file.exists():
        orphan_file.unlink()
