"""Persistent clinical quick phrases table (hospital defaults + personal doctor phrases).

Revision ID: 0039
Revises: 0038
Create Date: 2026-11-18

Task T3.1:
- Create `clinical_quick_phrases` for hospital default and doctor-owned personal quick phrases
  scoped by department and encounter section (`COMPLAINTS`, `EXAMINATION`, `DIAGNOSIS`, `ADVICE`).
- Enforce scope/doctor consistency and non-blank phrase length via CHECK constraints.
- Grant runtime privileges (`SELECT, INSERT, UPDATE, DELETE`) to `kalyan_app` on PostgreSQL.
- Zero row inserts in migration (application-level idempotent seeder populates hospital defaults
  so empty-DB migration tests stay clean).

Naming: env.py's naming convention prefixes `ck_<table>_` on every CheckConstraint name in both
create and drop calls. Pass bare names (`"scope_valid"`, `"section_valid"`, etc.).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0039"
down_revision: str | None = "0038"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "clinical_quick_phrases",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column("scope", sa.String(length=24), nullable=False),
        sa.Column("doctor_id", sa.BigInteger(), nullable=True),
        sa.Column("department_id", sa.BigInteger(), nullable=True),
        sa.Column("department_code", sa.String(length=32), nullable=True),
        sa.Column("section", sa.String(length=24), nullable=False),
        sa.Column("phrase_text", sa.String(length=240), nullable=False),
        sa.Column(
            "sort_order",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column(
            "is_active",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["doctor_id"],
            ["doctors.id"],
            name="fk_clinical_quick_phrases_doctor_id_doctors",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["department_id"],
            ["departments.id"],
            name="fk_clinical_quick_phrases_department_id_departments",
            ondelete="SET NULL",
        ),
        sa.CheckConstraint(
            "scope IN ('PERSONAL', 'HOSPITAL_DEFAULT')",
            name="scope_valid",
        ),
        sa.CheckConstraint(
            "section IN ('COMPLAINTS', 'EXAMINATION', 'DIAGNOSIS', 'ADVICE')",
            name="section_valid",
        ),
        sa.CheckConstraint(
            "(scope = 'PERSONAL' AND doctor_id IS NOT NULL) "
            "OR (scope = 'HOSPITAL_DEFAULT' AND doctor_id IS NULL)",
            name="scope_doctor_consistency",
        ),
        sa.CheckConstraint(
            "length(trim(phrase_text)) >= 2",
            name="phrase_text_nonblank",
        ),
    )

    op.create_index(
        "ix_clinical_quick_phrases_personal",
        "clinical_quick_phrases",
        ["scope", "doctor_id", "section", "is_active"],
    )
    op.create_index(
        "ix_clinical_quick_phrases_default",
        "clinical_quick_phrases",
        ["scope", "department_code", "section", "is_active"],
    )

    if op.get_bind().dialect.name == "postgresql":
        op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON clinical_quick_phrases TO kalyan_app;")
        op.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kalyan_app;")


def downgrade() -> None:
    bind = op.get_bind()

    personal_rows = bind.execute(
        sa.text("SELECT count(*) FROM clinical_quick_phrases WHERE scope = 'PERSONAL'")
    ).scalar_one()
    if personal_rows:
        raise RuntimeError(
            f"Migration 0039 downgrade stopped: {personal_rows} personal quick phrase row(s) "
            "exist. Doctor quick phrases are not deleted automatically. Nothing was changed."
        )

    if bind.dialect.name == "postgresql":
        op.execute(
            "REVOKE SELECT, INSERT, UPDATE, DELETE ON clinical_quick_phrases FROM kalyan_app;"
        )

    op.drop_index("ix_clinical_quick_phrases_default", table_name="clinical_quick_phrases")
    op.drop_index("ix_clinical_quick_phrases_personal", table_name="clinical_quick_phrases")
    op.drop_table("clinical_quick_phrases")
