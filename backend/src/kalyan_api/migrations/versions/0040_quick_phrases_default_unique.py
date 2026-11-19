"""Enforce uniqueness on hospital default quick phrases via dual partial indexes.

Revision ID: 0040
Revises: 0039
Create Date: 2026-11-18

Prevents duplicate HOSPITAL_DEFAULT quick phrases under concurrent cold-start seeding
using two plain-column partial unique indexes (autogenerate-safe with alembic.command.check):
- ix_quick_phrases_default_dept: (department_code, section, phrase_text) where
  department_code IS NOT NULL
- ix_quick_phrases_default_global: (section, phrase_text) where department_code IS NULL
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0040"
down_revision: str | None = "0039"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Deduplicate existing HOSPITAL_DEFAULT rows before creating unique indexes
    op.execute(
        sa.text("""
        DELETE FROM clinical_quick_phrases
        WHERE scope = 'HOSPITAL_DEFAULT'
          AND id NOT IN (
              SELECT MIN(id)
              FROM clinical_quick_phrases
              WHERE scope = 'HOSPITAL_DEFAULT'
              GROUP BY department_code, section, phrase_text
          )
        """)
    )
    op.create_index(
        "ix_quick_phrases_default_dept",
        "clinical_quick_phrases",
        ["department_code", "section", "phrase_text"],
        unique=True,
        postgresql_where=sa.text("scope = 'HOSPITAL_DEFAULT' AND department_code IS NOT NULL"),
    )
    op.create_index(
        "ix_quick_phrases_default_global",
        "clinical_quick_phrases",
        ["section", "phrase_text"],
        unique=True,
        postgresql_where=sa.text("scope = 'HOSPITAL_DEFAULT' AND department_code IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_quick_phrases_default_global", table_name="clinical_quick_phrases")
    op.drop_index("ix_quick_phrases_default_dept", table_name="clinical_quick_phrases")
