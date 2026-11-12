"""Enforce composite same-patient foreign keys on payments, treatment sessions, vitals, and follow-ups.

Revision ID: 0023
Revises: 0022
Create Date: 2026-11-12

FB-04 / SEC-03: enforce same-patient linkage in the database for:
- payments.treatment_plan_id -> treatment_plans(id, patient_id)
- payments.appointment_id -> appointments(id, patient_id)
- treatment_sessions.treatment_plan_id -> treatment_plans(id, patient_id)
- vital_observations.encounter_id -> clinical_encounters(id, patient_id)
- follow_up_recommendations.encounter_id -> clinical_encounters(id, patient_id)
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0023"
down_revision: str | None = "0022"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

LINKS: tuple[tuple[str, str, str, str, str], ...] = (
    (
        "fk_payments_treatment_plan_patient",
        "payments",
        "treatment_plan_id",
        "treatment_plans",
        "SET NULL (treatment_plan_id)",
    ),
    (
        "fk_payments_appointment_patient",
        "payments",
        "appointment_id",
        "appointments",
        "SET NULL (appointment_id)",
    ),
    (
        "fk_treatment_sessions_plan_patient",
        "treatment_sessions",
        "treatment_plan_id",
        "treatment_plans",
        "RESTRICT",
    ),
    (
        "fk_vital_observations_encounter_patient",
        "vital_observations",
        "encounter_id",
        "clinical_encounters",
        "CASCADE",
    ),
    (
        "fk_follow_up_recommendations_encounter_patient",
        "follow_up_recommendations",
        "encounter_id",
        "clinical_encounters",
        "CASCADE",
    ),
)


def upgrade() -> None:
    bind = op.get_bind()

    # Pre-check: no mismatched rows
    for _name, child, column, parent, _ondelete in LINKS:
        mismatched = bind.execute(
            sa.text(
                f"SELECT count(*) FROM {child} c JOIN {parent} p ON p.id = c.{column} "
                "WHERE c.patient_id <> p.patient_id"
            )
        ).scalar_one()
        if mismatched:
            raise RuntimeError(
                f"Migration 0023 stopped: {mismatched} row(s) in {child} are linked through "
                f"{column} to a row in {parent} that belongs to a different patient."
            )

    # 1. Unique constraint on parent table treatment_plans
    op.create_unique_constraint(
        "uq_treatment_plans_id_patient", "treatment_plans", ["id", "patient_id"]
    )

    # 2. Composite foreign keys
    for name, child, column, parent, ondel in LINKS:
        op.create_foreign_key(
            name,
            child,
            parent,
            [column, "patient_id"],
            ["id", "patient_id"],
            ondelete=ondel,
        )


def downgrade() -> None:
    for name, child, _column, _parent, _ondel in reversed(LINKS):
        op.drop_constraint(name, child, type_="foreignkey")
    op.drop_constraint("uq_treatment_plans_id_patient", "treatment_plans", type_="unique")
