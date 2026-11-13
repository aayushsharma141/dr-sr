"""Enforce in the database that linked clinical rows belong to the same patient.

Revision ID: 0022
Revises: 0021
Create Date: 2026-11-11

BR-001 / SEC-03: the API rejects an encounter, prescription or treatment plan linked to
another patient's appointment or encounter. This migration makes PostgreSQL refuse the same
thing, so direct SQL or a future code path cannot create it either.

Each link gets a composite foreign key (link column, patient_id) -> parent (id, patient_id).
The existing single-column foreign keys stay. On parent delete only the link column is set
to NULL, exactly as before; patient_id is never cleared and no row is deleted or re-parented.

The upgrade stops with an error if mismatched rows already exist. It corrects nothing:
run backend/scripts/audit_patient_links.py to list them and have them reviewed first.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0022"
down_revision: str | None = "0021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# (constraint name, child table, link column, parent table)
LINKS: tuple[tuple[str, str, str, str], ...] = (
    (
        "fk_clinical_encounters_appointment_patient",
        "clinical_encounters",
        "appointment_id",
        "appointments",
    ),
    (
        "fk_prescriptions_encounter_patient",
        "prescriptions",
        "encounter_id",
        "clinical_encounters",
    ),
    (
        "fk_treatment_plans_encounter_patient",
        "treatment_plans",
        "encounter_id",
        "clinical_encounters",
    ),
)

PARENT_KEYS: tuple[tuple[str, str], ...] = (
    ("uq_appointments_id_patient", "appointments"),
    ("uq_clinical_encounters_id_patient", "clinical_encounters"),
)


def upgrade() -> None:
    bind = op.get_bind()

    # ON DELETE SET NULL (column) needs PostgreSQL 15 or newer.
    version_num = int(bind.execute(sa.text("SHOW server_version_num")).scalar_one())
    if version_num < 150000:
        raise RuntimeError(
            "Migration 0022 needs PostgreSQL 15 or newer "
            f"(server_version_num={version_num}). No change was made."
        )

    for _name, child, column, parent in LINKS:
        mismatched = bind.execute(
            sa.text(
                f"SELECT count(*) FROM {child} c JOIN {parent} p ON p.id = c.{column} "  # noqa: S608
                "WHERE c.patient_id <> p.patient_id"
            )
        ).scalar_one()
        if mismatched:
            raise RuntimeError(
                f"Migration 0022 stopped: {mismatched} row(s) in {child} are linked through "
                f"{column} to a row in {parent} that belongs to a different patient. "
                "Nothing was changed. "
                "Run backend/scripts/audit_patient_links.py and have the rows reviewed."
            )

    for name, table in PARENT_KEYS:
        op.create_unique_constraint(name, table, ["id", "patient_id"])

    for name, child, column, parent in LINKS:
        op.create_foreign_key(
            name,
            child,
            parent,
            [column, "patient_id"],
            ["id", "patient_id"],
            ondelete=f"SET NULL ({column})",
        )


def downgrade() -> None:
    for name, child, _column, _parent in reversed(LINKS):
        op.drop_constraint(name, child, type_="foreignkey")
    for name, table in reversed(PARENT_KEYS):
        op.drop_constraint(name, table, type_="unique")
