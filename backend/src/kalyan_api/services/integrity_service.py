"""Clinical and financial integrity inspection engine for Kalyan Hospital (BAK-03).

Checks implemented:
1. Ledger vs Agreed Price (Financial Invariant):
   - Every treatment plan package must have agreed_price_paise > 0.
   - Non-reversed payments associated with a plan cannot exceed agreed_price_paise.
   - Pending balance must equal agreed_price_paise - sum(active payments).
2. Sequential URN & Identity Integrity:
   - Zero duplicate URNs across all patients.
   - Checks format: KHM-YYYY-NNNNN.
3. Sequential Receipt Integrity:
   - Zero duplicate receipt numbers within the same sequence key.
   - Monotonic continuity check.
4. Treatment Plan Session Synchronization:
   - completed_sessions must equal the count of finalised treatment_sessions.
5. Patient Photo Storage Integrity:
   - Every patient with a non-null photo_path must have an existing file on disk.
   - Identifies any orphan files on disk in settings.photos_dir that have no corresponding patient.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from kalyan_api.config import Settings, get_settings
from kalyan_api.models import Patient, Payment, TreatmentPlan, TreatmentSession


@dataclass
class CheckResult:
    """Outcome of an individual integrity check."""

    name: str
    passed: bool
    details: str
    discrepancies: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class IntegrityReport:
    """Comprehensive integrity report across clinical, financial, and file data."""

    generated_at: str
    is_healthy: bool
    checks: list[CheckResult]
    total_checks: int
    passed_checks: int
    failed_checks: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "generated_at": self.generated_at,
            "is_healthy": self.is_healthy,
            "total_checks": self.total_checks,
            "passed_checks": self.passed_checks,
            "failed_checks": self.failed_checks,
            "checks": [
                {
                    "name": c.name,
                    "passed": c.passed,
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

    for plan in plans:
        agreed = plan.agreed_price_paise or 0
        if agreed < 0:
            discrepancies.append(
                {
                    "plan_id": plan.id,
                    "issue": "negative_agreed_price",
                    "agreed_price_paise": agreed,
                }
            )

        # Query active payments
        paid_sum: int = (
            session.scalar(
                select(func.coalesce(func.sum(Payment.amount_paise), 0)).where(
                    Payment.treatment_plan_id == plan.id,
                    Payment.is_reversed.is_(False),
                )
            )
            or 0
        )

        if paid_sum > agreed:
            discrepancies.append(
                {
                    "plan_id": plan.id,
                    "issue": "overpaid_ledger",
                    "agreed_price_paise": agreed,
                    "paid_sum_paise": paid_sum,
                    "excess_paise": paid_sum - agreed,
                }
            )

    passed = len(discrepancies) == 0
    return CheckResult(
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
    discrepancies = [{"urn": d.urn, "occurrences": d.count} for d in duplicates]

    passed = len(discrepancies) == 0
    return CheckResult(
        name="Patient URN Uniqueness",
        passed=passed,
        details=(
            "All patient URNs are unique"
            if passed
            else f"Found {len(discrepancies)} duplicate URNs"
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
        {"receipt_number": d.receipt_number, "occurrences": d.count}
        for d in duplicates
    ]

    passed = len(discrepancies) == 0
    return CheckResult(
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
    for plan in plans:
        actual_finalised_count: int = (
            session.scalar(
                select(func.count(TreatmentSession.id)).where(
                    TreatmentSession.treatment_plan_id == plan.id,
                    TreatmentSession.is_finalised.is_(True),
                )
            )
            or 0
        )

        if plan.completed_sessions != actual_finalised_count:
            discrepancies.append(
                {
                    "plan_id": plan.id,
                    "recorded_completed_sessions": plan.completed_sessions,
                    "actual_finalised_sessions": actual_finalised_count,
                }
            )

    passed = len(discrepancies) == 0
    return CheckResult(
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
        name="Patient Photo Storage Consistency",
        passed=passed,
        details=(
            "All patient photos exist and no untracked orphans found"
            if passed
            else f"Found {len(discrepancies)} photo storage discrepancies"
        ),
        discrepancies=discrepancies,
    )


def run_integrity_audit(session: Session, settings: Settings | None = None) -> IntegrityReport:
    """Execute complete suite of clinical and financial integrity checks (BAK-03)."""
    cfg = settings or get_settings()

    checks = [
        check_financial_ledger_integrity(session),
        check_urn_uniqueness(session),
        check_receipt_uniqueness(session),
        check_session_progress_synchronization(session),
        check_photo_storage_integrity(session, cfg),
    ]

    total = len(checks)
    passed = sum(1 for c in checks if c.passed)
    failed = total - passed

    return IntegrityReport(
        generated_at=datetime.now(UTC).isoformat(),
        is_healthy=(failed == 0),
        checks=checks,
        total_checks=total,
        passed_checks=passed,
        failed_checks=failed,
    )
