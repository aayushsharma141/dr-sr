"""Patient import staging tables and batch lifecycle tracking.

Revision ID: 0018
Revises: 0017
Create Date: 2026-11-08

Requirements:
- D-20-08: Staging pipeline for CSV and XLSX imports.
- D-20-09: Gap-free URN allocation strictly during commit.
- D-20-10: Isolated validation allowing valid rows to proceed while invalid rows are held.
- D-20-11: Atomic commit of valid and resolved rows.
- D-20-12: Pre-commit safety backup gate.
- D-20-13: Duplicate candidate detection and explicit resolution without patient overwrites.
- D-20-14: Audit batch logging and tracking.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0018"
down_revision: str | None = "0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"
    json_col_type = postgresql.JSONB(astext_type=sa.Text()) if is_postgres else sa.JSON()

    # 1. Create table patient_import_batches
    op.create_table(
        "patient_import_batches",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column("batch_id", sa.String(length=64), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("total_rows", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("valid_rows", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("duplicate_rows", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("invalid_rows", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("committed_rows", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column(
            "status",
            sa.String(length=32),
            nullable=False,
            server_default=sa.text("'STAGED'"),
        ),
        sa.Column("column_mapping", json_col_type, nullable=True),
        sa.Column("safety_backup_file", sa.String(length=255), nullable=True),
        sa.Column(
            "created_by_user_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("committed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_patient_import_batches_batch_id",
        "patient_import_batches",
        ["batch_id"],
        unique=True,
    )
    op.create_index(
        "ix_patient_import_batches_created_by_user_id",
        "patient_import_batches",
        ["created_by_user_id"],
    )

    # 2. Create table patient_import_rows
    op.create_table(
        "patient_import_rows",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column(
            "batch_id",
            sa.String(length=64),
            sa.ForeignKey("patient_import_batches.batch_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("row_index", sa.Integer(), nullable=False),
        sa.Column("raw_data", json_col_type, nullable=False),
        sa.Column("mapped_data", json_col_type, nullable=True),
        sa.Column(
            "validation_status",
            sa.String(length=32),
            nullable=False,
            server_default=sa.text("'PENDING'"),
        ),
        sa.Column("validation_errors", json_col_type, nullable=True),
        sa.Column(
            "duplicate_patient_id",
            sa.BigInteger(),
            sa.ForeignKey("patients.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("duplicate_resolution", sa.String(length=32), nullable=True),
        sa.Column("allocated_urn", sa.String(length=32), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_patient_import_rows_batch_id", "patient_import_rows", ["batch_id"])
    op.create_index(
        "ix_patient_import_rows_duplicate_patient_id",
        "patient_import_rows",
        ["duplicate_patient_id"],
    )

    # 3. Grant runtime table privileges to kalyan_app on PostgreSQL
    if is_postgres:
        op.execute(
            "GRANT SELECT, INSERT, UPDATE, DELETE ON patient_import_batches, patient_import_rows TO kalyan_app;"
        )
        op.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kalyan_app;")


def downgrade() -> None:
    op.drop_table("patient_import_rows")
    op.drop_table("patient_import_batches")

