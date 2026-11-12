"""Read-only audit: linked clinical rows that belong to different patients (SEC-02, BR-001).

Reports rows where a record and the record it links to have different patient_id values.
Writes nothing: the transaction is opened READ ONLY and rolled back. Prints row ids only,
never names or clinical text.

Run from backend/:
    PYTHONPATH=src .venv/Scripts/python.exe scripts/audit_patient_links.py

Exit code 0 = no mismatches, 1 = mismatches found, 2 = could not run.
"""

import sys

from sqlalchemy import text

from kalyan_api.config import get_settings
from kalyan_api.db.session import build_engine

# (label, child table, link column, parent table). The first three are the links named in
# the Foundational Bug Report; the rest are the other patient-scoped links, checked for
# the SEC-03 constraint design.
CHECKS: list[tuple[str, str, str, str]] = [
    ("encounter -> appointment", "clinical_encounters", "appointment_id", "appointments"),
    ("prescription -> encounter", "prescriptions", "encounter_id", "clinical_encounters"),
    ("treatment plan -> encounter", "treatment_plans", "encounter_id", "clinical_encounters"),
    ("treatment session -> plan", "treatment_sessions", "treatment_plan_id", "treatment_plans"),
    ("payment -> treatment plan", "payments", "treatment_plan_id", "treatment_plans"),
    ("payment -> appointment", "payments", "appointment_id", "appointments"),
    ("vitals -> encounter", "vital_observations", "encounter_id", "clinical_encounters"),
    ("follow-up -> encounter", "follow_up_recommendations", "encounter_id", "clinical_encounters"),
]


def main() -> int:
    settings = get_settings()
    engine = build_engine(settings, owner=False)
    found = 0
    try:
        with engine.connect() as conn:
            conn.execute(text("SET TRANSACTION READ ONLY"))
            db_name = conn.execute(text("SELECT current_database()")).scalar_one()
            print(f"Database: {db_name} (read-only audit)")
            for label, child, column, parent in CHECKS:
                linked = conn.execute(
                    text(f"SELECT count(*) FROM {child} WHERE {column} IS NOT NULL")  # noqa: S608
                ).scalar_one()
                rows = conn.execute(
                    text(
                        f"SELECT c.id, c.{column}, c.patient_id, p.patient_id "  # noqa: S608
                        f"FROM {child} c JOIN {parent} p ON p.id = c.{column} "
                        f"WHERE c.patient_id <> p.patient_id ORDER BY c.id"
                    )
                ).all()
                found += len(rows)
                print(f"{label}: {linked} linked rows, {len(rows)} mismatched")
                for row_id, link_id, child_patient, parent_patient in rows:
                    print(
                        f"    {child}.id={row_id} patient_id={child_patient} -> "
                        f"{parent}.id={link_id} patient_id={parent_patient}"
                    )
            conn.rollback()
    except Exception as exc:  # report and stop; never guess a result
        print(f"Audit could not run: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2
    finally:
        engine.dispose()

    print(f"Total mismatched rows: {found}")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
