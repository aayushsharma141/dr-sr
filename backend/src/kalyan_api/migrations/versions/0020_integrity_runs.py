"""Stored data integrity check runs.

Revision ID: 0020
Revises: 0019
Create Date: 2026-11-08

Opening the Data Integrity page used to run every check and write an audit entry on each
visit. Runs are now stored: the page reads the latest one, and only "Run Check Now" adds a
row. The rows also give the page its history of past results.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0020"
down_revision: str | None = "0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"
    json_col_type = postgresql.JSONB(astext_type=sa.Text()) if is_postgres else sa.JSON()

    op.create_table(
        "integrity_runs",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "run_by_user_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("run_by_username", sa.String(length=64), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=False),
        sa.Column("is_healthy", sa.Boolean(), nullable=False),
        sa.Column("total_checks", sa.Integer(), nullable=False),
        sa.Column("passed_checks", sa.Integer(), nullable=False),
        sa.Column("failed_checks", sa.Integer(), nullable=False),
        sa.Column("warning_checks", sa.Integer(), nullable=False),
        sa.Column("cleanup_checks", sa.Integer(), nullable=False),
        sa.Column("checks", json_col_type, nullable=False),
    )
    op.create_index("ix_integrity_runs_generated_at", "integrity_runs", ["generated_at"])

    if is_postgres:
        # Append-only from the application's side: no UPDATE or DELETE.
        op.execute("GRANT SELECT, INSERT ON integrity_runs TO kalyan_app;")
        op.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kalyan_app;")


def downgrade() -> None:
    op.drop_index("ix_integrity_runs_generated_at", table_name="integrity_runs")
    op.drop_table("integrity_runs")
