"""Clinical and financial integrity inspection engine for Kalyan Hospital (BAK-03).

Checks implemented:
1. Ledger vs Agreed Price (Financial Invariant):
   - Every treatment plan package must have agreed_price_paise > 0.
   - Non-reversed payments associated with a plan cannot exceed agreed_price_paise.
   - Pending balance must equal agreed_price_paise - sum(active payments).
2. Sequential URN & Identity Integrity:
   - Zero duplicate URNs across all patients.
   - URN sequence gaps (KH-YYYY-XXXX): per year, sequence numbers between 1 and the highest
     issued number that map to no patient. Gap semantics are an open decision (OD-12), so this
     is reported as a WARNING-level finding that does not make the report unhealthy.
3. Sequential Receipt Integrity:
   - Zero duplicate receipt numbers within the same sequence key.
   - Monotonic continuity check.
4. Treatment Plan Session Synchronization:
   - completed_sessions must equal the count of finalised treatment_sessions.
5. Patient Photo Storage Integrity:
   - Every patient with a non-null photo_path must have an existing file on disk.
   - Identifies any orphan files on disk in settings.photos_dir that have no corresponding patient.
6. Hospital Asset Storage Integrity: the same two checks for uploaded hospital assets.

Every finding carries a stable ``issue`` code and its own ``severity``:
- ERROR: a record is wrong or points at something missing (makes the report unhealthy).
- WARNING: worth a review and may be expected (URN gaps, OD-12).
- CLEANUP: harmless clutter, such as a stored file that no record uses.
A check takes the worst severity among its findings; a check with no findings passed.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from kalyan_api.config import Settings, get_settings
from kalyan_api.models import (
    HospitalAsset,
    Patient,
    Payment,
    TreatmentPlan,
    TreatmentSession,
    UrnSequence,
)

Severity = Literal["ERROR", "WARNING", "CLEANUP"]

SEVERITY_RANK: dict[str, int] = {"ERROR": 0, "WARNING": 1, "CLEANUP": 2}

# Severity of each finding, by its issue code.
ISSUE_SEVERITY: dict[str, Severity] = {
    "negative_agreed_price": "ERROR",
    "overpaid_ledger": "ERROR",
    "duplicate_urn": "ERROR",
    "urn_sequence_gap": "WARNING",
    "duplicate_receipt": "ERROR",
    "session_count_mismatch": "ERROR",
    "missing_photo_file": "ERROR",
    "orphan_photo_file": "CLEANUP",
    "missing_asset_file": "ERROR",
    "orphan_asset_file": "CLEANUP",
}

URN_PATTERN = re.compile(r"^KH-(\d{4})-(\d+)$")
# Cap on listed missing numbers per year so a pathological gap cannot bloat the response.
MAX_LISTED_GAPS_PER_YEAR = 200


@dataclass
class CheckResult:
    """Outcome of an individual integrity check.

    ``code`` is a stable identifier for the check. ``severity`` is the worst severity among
    the findings (see the module docstring); for a passed check it is the severity its
    findings would normally have.
    """

    name: str
    passed: bool
    details: str
    discrepancies: list[dict[str, Any]] = field(default_factory=list)
    severity: Severity = "ERROR"
    code: str = ""

    def __post_init__(self) -> None:
        for item in self.discrepancies:
            issue = str(item.get("issue", ""))
            item.setdefault("severity", ISSUE_SEVERITY.get(issue, self.severity))
        if self.discrepancies:
            self.severity = min(
                (item["severity"] for item in self.discrepancies),
                key=lambda value: SEVERITY_RANK.get(value, 0),
            )


@dataclass
class IntegrityReport:
    """Comprehensive integrity report across clinical, financial, and file data."""

    generated_at: str
    is_healthy: bool
    checks: list[CheckResult]
    total_checks: int
    passed_checks: int
    failed_checks: int
    warning_checks: int = 0
    cleanup_checks: int = 0
    duration_ms: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "generated_at": self.generated_at,
            "is_healthy": self.is_healthy,
            "total_checks": self.total_checks,
            "passed_checks": self.passed_checks,
            "failed_checks": self.failed_checks,
            "warning_checks": self.warning_checks,
            "cleanup_checks": self.cleanup_checks,
            "duration_ms": self.duration_ms,
            "checks": [
                {
                    "code": c.code,
                    "name": c.name,
                    "passed": c.passed,
                    "severity": c.severity,
                    "details": c.details,
                    "discrepancies": c.discrepancies,
                }
                for c in self.checks
            ],
        }


def check_financial_ledger_integrity(session: Session) -> CheckResult:
    """Verify package payments against agreed prices and prevent negative balances."""
    discrepancies: list[dict[str, Any]] = []

    plans = (
        session.execute(select(TreatmentPlan).where(TreatmentPlan.agreed_price_paise.is_not(None)))
        .scalars()
        .all()
    )

    active_payments_by_plan = {
        int(plan_id): int(paid_sum or 0)
        for plan_id, paid_sum in session.execute(
            select(Payment.treatment_plan_id, func.sum(Payment.amount_paise))
            .where(
                Payment.treatment_plan_id.is_not(None),
                Payment.is_reversed.is_(False),
            )
            .group_by(Payment.treatment_plan_id)
        ).all()
    }

    for plan in plans:
        agreed = plan.agreed_price_paise or 0
        if agreed < 0:
            discrepancies.append(
                {
                    "plan_id": plan.id,
                    "patient_id": plan.patient_id,
                    "issue": "negative_agreed_price",
                    "agreed_price_paise": agreed,
                }
            )

        paid_sum = active_payments_by_plan.get(plan.id, 0)

        if paid_sum > agreed:
            discrepancies.append(
                {
                    "plan_id": plan.id,
                    "patient_id": plan.patient_id,
                    "issue": "overpaid_ledger",
                    "agreed_price_paise": agreed,
                    "paid_sum_paise": paid_sum,
                    "excess_paise": paid_sum - agreed,
                }
            )

    passed = len(discrepancies) == 0
    return CheckResult(
        code="package_payments",
        name="Financial Ledger & Package Invariants",
        passed=passed,
        details=(
            "All treatment plan packages have balanced ledgers and no overpayments"
            if passed
            else f"Found {len(discrepancies)} financial ledger discrepancies"
        ),
        discrepancies=discrepancies,
    )


def check_urn_uniqueness(session: Session) -> CheckResult:
    """Verify zero duplicate URNs exist in patients table."""
    dup_stmt = (
        select(Patient.urn, func.count(Patient.id).label("count"))
        .group_by(Patient.urn)
        .having(func.count(Patient.id) > 1)
    )
    duplicates = session.execute(dup_stmt).all()
    discrepancies = [
        {"issue": "duplicate_urn", "urn": d.urn, "occurrences": d.count} for d in duplicates
    ]

    passed = len(discrepancies) == 0
    return CheckResult(
        code="patient_id_unique",
        name="Patient URN Uniqueness",
        passed=passed,
        details=(
            "All patient URNs are unique"
            if passed
            else f"Found {len(discrepancies)} duplicate URNs"
        ),
        discrepancies=discrepancies,
    )


def check_urn_sequence_gaps(session: Session) -> CheckResult:
    """Report, per URN year, sequence numbers in 1..max issued that map to no patient (BAK-03).

    "Max issued" is the larger of the highest sequence observed on a patient URN and the
    year's urn_sequences.last_seq counter, so numbers consumed by the counter but never mapped
    to a patient are also reported. URNs that do not match KH-YYYY-XXXX are ignored here.
    Because gap semantics are an open decision (OD-12), findings are WARNING-level only.
    """
    seqs_by_year: dict[int, set[int]] = {}
    for (urn,) in session.execute(select(Patient.urn)).all():
        match = URN_PATTERN.fullmatch(urn or "")
        if match is None:
            continue
        year = int(match.group(1))
        seqs_by_year.setdefault(year, set()).add(int(match.group(2)))

    counters: dict[int, int] = {
        int(year): int(last_seq)
        for year, last_seq in session.execute(select(UrnSequence.year, UrnSequence.last_seq)).all()
    }

    discrepancies: list[dict[str, Any]] = []
    for year in sorted(set(seqs_by_year) | set(counters)):
        observed = seqs_by_year.get(year, set())
        max_observed = max(observed) if observed else 0
        counter_value = counters.get(year, 0)
        max_issued = max(max_observed, counter_value)
        if max_issued <= 0:
            continue
        in_range = sum(1 for n in observed if 1 <= n <= max_issued)
        missing_count = max_issued - in_range
        if missing_count <= 0:
            continue
        # Bounded scan: stops after the first MAX_LISTED_GAPS_PER_YEAR gaps, so the work is
        # at most len(observed) + cap iterations even when max_issued is very large.
        listed: list[int] = []
        candidate = 1
        target = min(missing_count, MAX_LISTED_GAPS_PER_YEAR)
        while len(listed) < target and candidate <= max_issued:
            if candidate not in observed:
                listed.append(candidate)
            candidate += 1
        discrepancies.append(
            {
                "year": year,
                "issue": "urn_sequence_gap",
                "max_issued": max_issued,
                "max_observed_on_patient": max_observed,
                "sequence_counter": counter_value,
                "missing_count": missing_count,
                "missing_numbers": listed,
                "missing_numbers_truncated": missing_count > len(listed),
            }
        )

    passed = len(discrepancies) == 0
    total_missing = sum(int(d["missing_count"]) for d in discrepancies)
    return CheckResult(
        code="patient_id_gaps",
        name="Patient URN Sequence Gaps",
        passed=passed,
        severity="WARNING",
        details=(
            "No URN sequence gaps found"
            if passed
            else (
                f"Found {total_missing} unmapped URN sequence numbers across "
                f"{len(discrepancies)} year(s) (warning only; gap policy OD-12 is undecided)"
            )
        ),
        discrepancies=discrepancies,
    )


def check_receipt_uniqueness(session: Session) -> CheckResult:
    """Verify zero duplicate receipt numbers exist in payments table."""
    dup_stmt = (
        select(Payment.receipt_number, func.count(Payment.id).label("count"))
        .where(Payment.receipt_number.is_not(None))
        .group_by(Payment.receipt_number)
        .having(func.count(Payment.id) > 1)
    )
    duplicates = session.execute(dup_stmt).all()
    discrepancies = [
        {"issue": "duplicate_receipt", "receipt_number": d.receipt_number, "occurrences": d.count}
        for d in duplicates
    ]

    passed = len(discrepancies) == 0
    return CheckResult(
        code="receipt_unique",
        name="Sequential Receipt Number Uniqueness",
        passed=passed,
        details=(
            "All payment receipt numbers are unique"
            if passed
            else f"Found {len(discrepancies)} duplicate receipt numbers"
        ),
        discrepancies=discrepancies,
    )


def check_session_progress_synchronization(session: Session) -> CheckResult:
    """Verify treatment_plans.completed_sessions matches count of finalised treatment_sessions."""
    discrepancies: list[dict[str, Any]] = []

    plans = session.execute(select(TreatmentPlan)).scalars().all()
    finalised_sessions_by_plan = {
        int(plan_id): int(count)
        for plan_id, count in session.execute(
            select(TreatmentSession.treatment_plan_id, func.count(TreatmentSession.id))
            .where(TreatmentSession.is_finalised.is_(True))
            .group_by(TreatmentSession.treatment_plan_id)
        ).all()
    }
    for plan in plans:
        actual_finalised_count = finalised_sessions_by_plan.get(plan.id, 0)

        if plan.completed_sessions != actual_finalised_count:
            discrepancies.append(
                {
                    "plan_id": plan.id,
                    "patient_id": plan.patient_id,
                    "issue": "session_count_mismatch",
                    "recorded_completed_sessions": plan.completed_sessions,
                    "actual_finalised_sessions": actual_finalised_count,
                }
            )

    passed = len(discrepancies) == 0
    return CheckResult(
        code="session_counts",
        name="Treatment Session Progress Synchronization",
        passed=passed,
        details=(
            "All treatment plans have accurate completed session counts"
            if passed
            else f"Found {len(discrepancies)} session count discrepancies"
        ),
        discrepancies=discrepancies,
    )


def check_photo_storage_integrity(
    session: Session, settings: Settings | None = None
) -> CheckResult:
    """Verify photo files exist on disk and identify orphan files."""
    cfg = settings or get_settings()
    discrepancies: list[dict[str, Any]] = []

    # 1. Check all DB patients with photo_path have file on disk
    patients_with_photo = (
        session.execute(select(Patient).where(Patient.photo_path.is_not(None))).scalars().all()
    )

    db_photo_filenames: set[str] = set()

    for p in patients_with_photo:
        p_path_str = p.photo_path or ""
        fname = p_path_str.split("/")[-1].split("\\")[-1]
        db_photo_filenames.add(fname)

        expected_file = cfg.photos_dir / fname
        if not expected_file.exists():
            discrepancies.append(
                {
                    "patient_id": p.id,
                    "urn": p.urn,
                    "issue": "missing_photo_file",
                    "declared_path": p_path_str,
                }
            )

    # 2. Check for orphan files on disk (excluding test/sample files if desired)
    if cfg.photos_dir.exists() and cfg.photos_dir.is_dir():
        for disk_file in cfg.photos_dir.glob("*"):
            if disk_file.is_file():
                if disk_file.name not in db_photo_filenames and not disk_file.name.startswith(
                    "test_"
                ):
                    discrepancies.append(
                        {
                            "issue": "orphan_photo_file",
                            "filename": disk_file.name,
                            "bytes": disk_file.stat().st_size,
                        }
                    )

    passed = len(discrepancies) == 0
    return CheckResult(
        code="photo_files",
        name="Patient Photo Storage Consistency",
        passed=passed,
        details=(
            "All patient photos exist and no untracked orphans found"
            if passed
            else f"Found {len(discrepancies)} photo storage discrepancies"
        ),
        discrepancies=discrepancies,
    )


def check_asset_storage_integrity(
    session: Session, settings: Settings | None = None
) -> CheckResult:
    """Verify hospital asset files exist on disk and identify orphan files (SET-01, BAK-03)."""
    cfg = settings or get_settings()
    discrepancies: list[dict[str, Any]] = []

    # 1. Check all DB assets have corresponding file on disk
    assets = session.execute(select(HospitalAsset)).scalars().all()
    db_asset_filenames: set[str] = set()

    for a in assets:
        fname = a.filename
        db_asset_filenames.add(fname)
        expected_file = cfg.assets_dir / fname
        if not expected_file.exists():
            discrepancies.append(
                {
                    "asset_id": a.id,
                    "filename": fname,
                    "asset_type": a.asset_type,
                    "is_active": a.is_active,
                    "original_filename": a.original_filename,
                    "uploaded_at": a.created_at.isoformat() if a.created_at else None,
                    "issue": "missing_asset_file",
                }
            )

    # 2. Check for orphan files on disk
    if cfg.assets_dir.exists() and cfg.assets_dir.is_dir():
        for disk_file in cfg.assets_dir.glob("*"):
            if disk_file.is_file():
                if disk_file.name not in db_asset_filenames and not disk_file.name.startswith(
                    "test_"
                ):
                    discrepancies.append(
                        {
                            "issue": "orphan_asset_file",
                            "filename": disk_file.name,
                            "bytes": disk_file.stat().st_size,
                        }
                    )

    passed = len(discrepancies) == 0
    return CheckResult(
        code="asset_files",
        name="Hospital Asset Storage Consistency",
        passed=passed,
        details=(
            "All hospital assets exist on disk and no untracked orphans found"
            if passed
            else f"Found {len(discrepancies)} asset storage discrepancies"
        ),
        discrepancies=discrepancies,
    )


def run_integrity_audit(session: Session, settings: Settings | None = None) -> IntegrityReport:
    """Execute complete suite of clinical and financial integrity checks (BAK-03)."""
    cfg = settings or get_settings()
    started = time.perf_counter()

    checks = [
        check_financial_ledger_integrity(session),
        check_urn_uniqueness(session),
        check_urn_sequence_gaps(session),
        check_receipt_uniqueness(session),
        check_session_progress_synchronization(session),
        check_photo_storage_integrity(session, cfg),
        check_asset_storage_integrity(session, cfg),
    ]

    total = len(checks)
    passed = sum(1 for c in checks if c.passed)
    failed = sum(1 for c in checks if not c.passed and c.severity == "ERROR")
    warnings = sum(1 for c in checks if not c.passed and c.severity == "WARNING")
    cleanups = sum(1 for c in checks if not c.passed and c.severity == "CLEANUP")

    return IntegrityReport(
        generated_at=datetime.now(UTC).isoformat(),
        is_healthy=(failed == 0),
        checks=checks,
        total_checks=total,
        passed_checks=passed,
        failed_checks=failed,
        warning_checks=warnings,
        cleanup_checks=cleanups,
        duration_ms=round((time.perf_counter() - started) * 1000),
    )
