"""Allow CANCELLED status on pending_opd_arrivals.

Revision ID: 0033
Revises: 0032
Create Date: 2026-11-17
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0033"
down_revision: str | None = "0032"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Drop constraint by direct SQL or constraint name
    op.execute("ALTER TABLE pending_opd_arrivals DROP CONSTRAINT IF EXISTS ck_pending_opd_arrivals_status_valid")
    op.execute("ALTER TABLE pending_opd_arrivals DROP CONSTRAINT IF EXISTS status_valid")
    op.create_check_constraint(
        "status_valid",
        "pending_opd_arrivals",
        "status IN ('TO_ARRIVE', 'REGISTERED', 'CANCELLED')",
    )
    op.execute("ALTER TABLE pending_opd_arrivals DROP CONSTRAINT IF EXISTS ck_pending_opd_arrivals_status_links_consistent")
    op.execute("ALTER TABLE pending_opd_arrivals DROP CONSTRAINT IF EXISTS status_links_consistent")
    op.create_check_constraint(
        "status_links_consistent",
        "pending_opd_arrivals",
        "(status IN ('TO_ARRIVE', 'CANCELLED') AND patient_id IS NULL AND appointment_id IS NULL) OR "
        "(status = 'REGISTERED' AND patient_id IS NOT NULL AND appointment_id IS NOT NULL)",
    )


def downgrade() -> None:
    op.execute("ALTER TABLE pending_opd_arrivals DROP CONSTRAINT IF EXISTS ck_pending_opd_arrivals_status_valid")
    op.execute("ALTER TABLE pending_opd_arrivals DROP CONSTRAINT IF EXISTS status_valid")
    op.create_check_constraint(
        "status_valid",
        "pending_opd_arrivals",
        "status IN ('TO_ARRIVE', 'REGISTERED')",
    )
    op.execute("ALTER TABLE pending_opd_arrivals DROP CONSTRAINT IF EXISTS ck_pending_opd_arrivals_status_links_consistent")
    op.execute("ALTER TABLE pending_opd_arrivals DROP CONSTRAINT IF EXISTS status_links_consistent")
    op.create_check_constraint(
        "status_links_consistent",
        "pending_opd_arrivals",
        "(status = 'TO_ARRIVE' AND patient_id IS NULL AND appointment_id IS NULL) OR "
        "(status = 'REGISTERED' AND patient_id IS NOT NULL AND appointment_id IS NOT NULL)",
    )
