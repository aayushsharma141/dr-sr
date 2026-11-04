"""Tests for clinical and financial integrity check engine (BAK-03, Plan 16-04)."""

from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from kalyan_api.config import get_settings
from kalyan_api.db.session import session_scope
from kalyan_api.models import Patient, UrnSequence
from kalyan_api.services.integrity_service import (
    MAX_LISTED_GAPS_PER_YEAR,
    CheckResult,
    check_photo_storage_integrity,
    check_urn_sequence_gaps,
    run_integrity_audit,
)


@pytest.mark.real_restore
def test_integrity_audit_clean_database(db_session):
    """In a standard clean test database, all integrity checks should pass."""
    settings = get_settings()
    # Clean any residual orphan test files
    if settings.photos_dir.exists():
        for f in settings.photos_dir.glob("*"):
            if f.is_file() and not f.name.startswith("test_"):
                f.unlink()
    with session_scope(settings) as session:
        report = run_integrity_audit(session, settings)
        # 5 ERROR-level checks + 1 WARNING-level URN gap check
        assert report.total_checks == 6
        assert report.is_healthy is True
        assert report.failed_checks == 0
        assert all(c.passed for c in report.checks if c.severity == "ERROR")


@pytest.mark.real_restore
def test_integrity_audit_detects_orphan_and_missing_photos(tmp_path: Path, owner_engine):
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

    # Cleanup runs as the migration owner: the runtime role may not delete patients (by design)
    with Session(owner_engine) as owner_session:
        owner_session.execute(text("DELETE FROM patients WHERE urn = 'KHM-2026-88888'"))
        owner_session.commit()

    if orphan_file.exists():
        orphan_file.unlink()


def _patient(urn: str) -> Patient:
    return Patient(
        urn=urn,
        full_name="Gap Check Patient",
        guardian_name="Guardian",
        gender="F",
        age_years=30,
        mobile="9876500000",
        address="Street 9",
        district="Kangra",
        state="Himachal Pradesh",
    )


def _gap_entry(result: CheckResult, year: int) -> dict[str, Any] | None:
    return next((d for d in result.discrepancies if d["year"] == year), None)


def test_urn_gap_check_reports_missing_numbers_per_year(db_session: Session) -> None:
    """Gaps between 1 and max issued are listed per year as a WARNING (OD-12 undecided)."""
    for urn in ("KH-2091-0001", "KH-2091-0003", "KH-2091-0004", "KH-2092-0001", "KHM-2091-9"):
        db_session.add(_patient(urn))
    db_session.flush()

    result = check_urn_sequence_gaps(db_session)
    assert result.passed is False
    assert result.severity == "WARNING"

    y2091 = _gap_entry(result, 2091)
    assert y2091 is not None
    assert y2091["issue"] == "urn_sequence_gap"
    assert y2091["missing_numbers"] == [2]
    assert y2091["missing_count"] == 1
    assert y2091["max_issued"] == 4
    assert y2091["missing_numbers_truncated"] is False
    # A contiguous year produces no finding; non KH-YYYY-XXXX URNs are ignored.
    assert _gap_entry(result, 2092) is None


def test_urn_gap_check_counts_numbers_consumed_by_counter(db_session: Session) -> None:
    """Numbers allocated by urn_sequences but never mapped to a patient are gaps too."""
    db_session.add(_patient("KH-2093-0001"))
    db_session.add(UrnSequence(year=2093, last_seq=3))
    db_session.flush()

    entry = _gap_entry(check_urn_sequence_gaps(db_session), 2093)
    assert entry is not None
    assert entry["sequence_counter"] == 3
    assert entry["max_observed_on_patient"] == 1
    assert entry["max_issued"] == 3
    assert entry["missing_numbers"] == [2, 3]


def test_urn_gap_check_bounds_listed_numbers(db_session: Session) -> None:
    """A pathological high sequence number is summarised, not enumerated."""
    db_session.add(_patient("KH-2094-99999999"))
    db_session.flush()

    entry = _gap_entry(check_urn_sequence_gaps(db_session), 2094)
    assert entry is not None
    assert entry["missing_count"] == 99999998
    assert len(entry["missing_numbers"]) == MAX_LISTED_GAPS_PER_YEAR
    assert entry["missing_numbers"][:3] == [1, 2, 3]
    assert entry["missing_numbers_truncated"] is True


def test_urn_gaps_are_warnings_and_do_not_make_report_unhealthy(
    db_session: Session, tmp_path: Path
) -> None:
    db_session.add(_patient("KH-2095-0002"))
    db_session.flush()
    settings = get_settings().model_copy(update={"photos_dir": tmp_path / "photos"})

    report = run_integrity_audit(db_session, settings)
    gap = next(c for c in report.checks if c.name == "Patient URN Sequence Gaps")
    assert gap.passed is False
    assert gap.severity == "WARNING"
    assert report.warning_checks >= 1
    expected_failed = sum(1 for c in report.checks if not c.passed and c.severity == "ERROR")
    assert report.failed_checks == expected_failed
    assert report.is_healthy is (expected_failed == 0)
    assert report.passed_checks + report.failed_checks + report.warning_checks == (
        report.total_checks
    )
    serialised = report.to_dict()
    assert serialised["warning_checks"] == report.warning_checks
    assert {c["severity"] for c in serialised["checks"]} <= {"ERROR", "WARNING"}
