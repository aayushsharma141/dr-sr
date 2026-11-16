"""Read-only comparison of legacy vs new visit balance formula.

Legacy formula copied from billing_service.py at stash commit d5592098f7db8484fdf2c939f144e51d30261fc5.
T-22-15 mitigation: never prints patient names, mobiles, or URNs. Only visit IDs and paise amounts.
T-22-16 mitigation: requires explicit --database, sets SET TRANSACTION READ ONLY.
"""

from __future__ import annotations

import argparse
import os
import sys
from collections.abc import Iterable
from pathlib import Path
from typing import Any

# Ensure backend/src and repo root are on path
REPO_ROOT = Path(__file__).resolve().parent.parent
BACKEND_SRC = REPO_ROOT / "backend" / "src"
SCRIPTS_DIR = REPO_ROOT / "scripts"
for p in (REPO_ROOT, BACKEND_SRC, SCRIPTS_DIR):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from kalyan_api.models import (
    Appointment,
    BillItem,
    BillItemCategory,
    ConsultationStatus,
    Doctor,
    Payment,
    Visit,
)
from kalyan_api.services import billing_service


def legacy_visit_due_paise(session: Session, visit_ids: Iterable[int]) -> dict[int, int]:
    """The legacy per-consultation balance computation from billing_service.py at stash commit d5592098f7db8484fdf2c939f144e51d30261fc5.

    Sum over COMPLETED consultations of max(0, line fee or doctor default fee minus non-reversed payments with that appointment_id).
    """
    ids = list(visit_ids)
    dues: dict[int, int] = {v_id: 0 for v_id in ids}
    if not ids:
        return dues

    rows = session.execute(
        select(
            Appointment.id,
            Appointment.visit_id,
            Appointment.consultation_status,
            Doctor.default_fee_paise,
        )
        .join(Doctor, Doctor.id == Appointment.doctor_id)
        .where(Appointment.visit_id.in_(ids))
        .order_by(Appointment.id)
    ).all()

    appointment_ids = [row[0] for row in rows]
    line_fee_by_appointment: dict[int, int] = {}
    if appointment_ids:
        line_fee_by_appointment = {
            appointment_id: int(amount)
            for appointment_id, amount in session.execute(
                select(BillItem.appointment_id, BillItem.amount_paise).where(
                    BillItem.appointment_id.in_(appointment_ids),
                    BillItem.category == BillItemCategory.CONSULTATION.value,
                )
            )
        }
    paid_by_appointment: dict[int, int] = {}
    if appointment_ids:
        paid_by_appointment = {
            appointment_id: int(total)
            for appointment_id, total in session.execute(
                select(Payment.appointment_id, func.coalesce(func.sum(Payment.amount_paise), 0))
                .where(
                    Payment.appointment_id.in_(appointment_ids),
                    Payment.is_reversed.is_(False),
                )
                .group_by(Payment.appointment_id)
            )
        }

    for appointment_id, visit_id, status, doctor_default_fee in rows:
        fee_paise = line_fee_by_appointment.get(appointment_id, doctor_default_fee)
        completed = status == ConsultationStatus.COMPLETED.value
        paid_paise = paid_by_appointment.get(appointment_id, 0)
        bal = max(0, fee_paise - paid_paise) if completed and fee_paise > 0 else 0
        dues[visit_id] += bal

    return dues


def compare_visit_balances(
    session: Session, visit_ids: list[int] | None = None
) -> list[dict[str, Any]]:
    """Compare legacy vs new formula for given visit_ids (or all visits in session).

    Returns list of mismatch records: [{'visit_id': int, 'legacy_due_paise': int, 'new_due_paise': int}].
    """
    if not hasattr(billing_service, "visit_totals"):
        raise NotImplementedError("billing_service.visit_totals arrives in Task 3")

    if visit_ids is None:
        visit_ids = list(session.scalars(select(Visit.id).order_by(Visit.id)))

    if not visit_ids:
        return []

    legacy_dues = legacy_visit_due_paise(session, visit_ids)
    new_totals = billing_service.visit_totals(session, visit_ids)

    mismatches: list[dict[str, Any]] = []
    for v_id in visit_ids:
        leg = legacy_dues.get(v_id, 0)
        new = new_totals[v_id].due_paise
        if leg != new:
            mismatches.append(
                {
                    "visit_id": v_id,
                    "legacy_due_paise": leg,
                    "new_due_paise": new,
                }
            )
    return mismatches


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Read-only comparison of legacy vs new visit balance formula."
    )
    parser.add_argument(
        "--database",
        required=True,
        help="Database name to compare (e.g. kalyan_test). Refuses to run without this argument.",
    )
    args = parser.parse_args()

    db_name = args.database.strip()
    if not db_name:
        print("Error: --database cannot be empty.", file=sys.stderr)
        return 2

    # Set KALYAN_DB_NAME before importing/initializing settings
    os.environ["KALYAN_DB_NAME"] = db_name
    os.environ.setdefault("KALYAN_ENV", "test")

    from kalyan_api.config import get_settings
    from kalyan_api.db.session import build_engine

    get_settings.cache_clear()
    settings = get_settings()

    engine = build_engine(settings, owner=False)
    try:
        with engine.connect() as conn:
            conn.execute(text("SET TRANSACTION READ ONLY"))
            with Session(bind=conn) as session:
                visit_ids = list(session.scalars(select(Visit.id).order_by(Visit.id)))
                total_visits = len(visit_ids)
                mismatches = compare_visit_balances(session, visit_ids)

                print(f"Database: {db_name}")
                print(f"Total visits compared: {total_visits}")
                if mismatches:
                    print(f"MISMATCHES DETECTED: {len(mismatches)}")
                    for m in mismatches:
                        print(
                            f"  Visit ID {m['visit_id']}: legacy={m['legacy_due_paise']} paise, "
                            f"new={m['new_due_paise']} paise"
                        )
                    return 1
                else:
                    print("All visit balances match between legacy and new formulas.")
                    return 0
    finally:
        engine.dispose()


if __name__ == "__main__":
    sys.exit(main())
