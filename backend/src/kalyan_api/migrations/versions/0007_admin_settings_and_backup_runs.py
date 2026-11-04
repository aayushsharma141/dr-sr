"""Administrator security policy, backup schedule settings and backup run history.

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-04

Behaviour is unchanged by this migration: security overrides start NULL (environment values
apply), the backup schedule starts disabled, and retention starts unset.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "clinic_settings",
        sa.Column(
            "trust_name_en",
            sa.String(120),
            server_default="Sri Vashishtha Kalyan Trust",
            nullable=False,
        ),
    )
    op.add_column("clinic_settings", sa.Column("trust_name_hi", sa.String(120), nullable=True))
    # The same text the application header already showed, so nothing visibly changes.
    op.execute("UPDATE clinic_settings SET trust_name_hi = 'श्री वशिष्ठ कल्याण ट्रस्ट';")
    op.add_column(
        "clinic_settings",
        sa.Column(
            "location_line", sa.String(120), server_default="Ara, Bhojpur, Bihar", nullable=False
        ),
    )

    op.create_table(
        "security_settings",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("session_idle_minutes", sa.Integer(), nullable=True),
        sa.Column("session_absolute_hours", sa.Integer(), nullable=True),
        sa.Column("lockout_threshold", sa.Integer(), nullable=True),
        sa.Column("lockout_minutes", sa.Integer(), nullable=True),
        sa.Column("password_min_length", sa.Integer(), nullable=True),
        sa.Column("version_id", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("id = 1", name="security_settings_singleton"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.execute("INSERT INTO security_settings (id) VALUES (1);")

    op.create_table(
        "backup_settings",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("schedule_enabled", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("frequency", sa.String(16), server_default="DAILY", nullable=False),
        sa.Column("run_at", sa.Time(), server_default="02:00:00", nullable=False),
        sa.Column("weekly_day", sa.Integer(), nullable=True),
        sa.Column("destination_dir", sa.Text(), nullable=True),
        sa.Column("retention_count", sa.Integer(), nullable=True),
        sa.Column("version_id", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("id = 1", name="backup_settings_singleton"),
        sa.CheckConstraint(
            "frequency IN ('DAILY', 'WEEKLY')", name="backup_settings_frequency_valid"
        ),
        sa.CheckConstraint(
            "weekly_day IS NULL OR weekly_day BETWEEN 0 AND 6",
            name="backup_settings_weekly_day_valid",
        ),
        sa.CheckConstraint(
            "frequency <> 'WEEKLY' OR weekly_day IS NOT NULL",
            name="backup_settings_weekly_day_required",
        ),
        sa.CheckConstraint(
            "retention_count IS NULL OR retention_count >= 1",
            name="backup_settings_retention_positive",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.execute("INSERT INTO backup_settings (id) VALUES (1);")

    op.create_table(
        "backup_runs",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
        sa.Column("trigger", sa.String(16), nullable=False),
        sa.Column("outcome", sa.String(16), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("filename", sa.Text(), nullable=True),
        sa.Column("size_bytes", sa.BigInteger(), nullable=True),
        sa.Column("copied_to", sa.Text(), nullable=True),
        sa.Column("pruned_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("error_type", sa.String(120), nullable=True),
        sa.CheckConstraint("trigger IN ('MANUAL', 'SCHEDULED')", name="backup_runs_trigger_valid"),
        sa.CheckConstraint(
            "outcome IN ('RUNNING', 'SUCCESS', 'FAILURE')", name="backup_runs_outcome_valid"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_backup_runs_started_at", "backup_runs", ["started_at"])

    # Least privilege: the singletons are never inserted or deleted at runtime.
    op.execute("GRANT SELECT, UPDATE ON security_settings TO kalyan_app;")
    op.execute("GRANT SELECT, UPDATE ON backup_settings TO kalyan_app;")
    op.execute("GRANT SELECT, INSERT, UPDATE ON backup_runs TO kalyan_app;")
    op.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kalyan_app;")


def downgrade() -> None:
    op.execute("REVOKE ALL ON backup_runs FROM kalyan_app;")
    op.execute("REVOKE ALL ON backup_settings FROM kalyan_app;")
    op.execute("REVOKE ALL ON security_settings FROM kalyan_app;")
    op.drop_index("ix_backup_runs_started_at", table_name="backup_runs")
    op.drop_table("backup_runs")
    op.drop_table("backup_settings")
    op.drop_table("security_settings")
    op.drop_column("clinic_settings", "location_line")
    op.drop_column("clinic_settings", "trust_name_hi")
    op.drop_column("clinic_settings", "trust_name_en")
