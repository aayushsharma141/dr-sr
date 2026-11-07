"""Print templates schema and seed data.

Revision ID: 0016
Revises: 0015
Create Date: 2026-11-08

Requirements:
- SET-01: Bilingual print template management per document type.
- BIL-04: Support for receipt, prescription, registration card, and consultation summary templates.
- D-20-04: Dedicated template registry replacing single clinic settings fields.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. Table: print_templates
    op.create_table(
        "print_templates",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column("document_type", sa.String(length=32), nullable=False),
        sa.Column("header_en", sa.Text(), nullable=True),
        sa.Column("header_hi", sa.Text(), nullable=True),
        sa.Column("footer_en", sa.Text(), nullable=True),
        sa.Column("footer_hi", sa.Text(), nullable=True),
        sa.Column(
            "version",
            sa.Integer(),
            server_default=sa.text("1"),
            nullable=False,
        ),
        sa.Column(
            "updated_by_user_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("document_type", name="uq_print_templates_document_type"),
        sa.CheckConstraint(
            "document_type IN ('prescription', 'receipt', 'registration_card', 'consultation_summary')",
            name="ck_print_templates_document_type",
        ),
    )
    op.create_index(
        "ix_print_templates_updated_by",
        "print_templates",
        ["updated_by_user_id"],
    )

    # 2. Seed initial templates from clinic_settings
    op.execute("""
    INSERT INTO print_templates (
        document_type, header_en, header_hi, footer_en, footer_hi, version, updated_by_user_id
    )
    SELECT
        doc.document_type,
        cs.print_header_en,
        cs.print_header_hi,
        cs.print_footer_en,
        cs.print_footer_hi,
        1,
        (SELECT id FROM users WHERE role = 'ADMIN' ORDER BY id ASC LIMIT 1)
    FROM (
        VALUES
            ('prescription'),
            ('receipt'),
            ('registration_card'),
            ('consultation_summary')
    ) AS doc(document_type)
    LEFT JOIN (
        SELECT print_header_en, print_header_hi, print_footer_en, print_footer_hi
        FROM clinic_settings
        WHERE id = 1
    ) AS cs ON TRUE
    ON CONFLICT (document_type) DO NOTHING;
    """)

    # 3. Permissions for kalyan_app
    op.execute("GRANT SELECT, INSERT, UPDATE ON print_templates TO kalyan_app;")
    op.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kalyan_app;")


def downgrade() -> None:
    op.execute("REVOKE SELECT, INSERT, UPDATE ON print_templates FROM kalyan_app;")
    op.drop_index("ix_print_templates_updated_by", table_name="print_templates")
    op.drop_table("print_templates")
