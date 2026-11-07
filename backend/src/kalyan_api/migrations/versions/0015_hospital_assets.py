"""Hospital assets schema.

Revision ID: 0015
Revises: 0014
Create Date: 2026-11-08

Requirements:
- SET-01: Hospital identity and logo asset management.
- D-20-01: Asset management guarded by settings:write.
- STRIDE T-20-06: Historical asset versions immutable.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. Table: hospital_assets
    op.create_table(
        "hospital_assets",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column("asset_type", sa.String(length=32), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("mime_type", sa.String(length=64), nullable=False),
        sa.Column("file_size_bytes", sa.BigInteger(), nullable=False),
        sa.Column(
            "is_active",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        sa.Column(
            "version",
            sa.Integer(),
            server_default=sa.text("1"),
            nullable=False,
        ),
        sa.Column(
            "uploaded_by_user_id",
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
        sa.UniqueConstraint("filename", name="uq_hospital_assets_filename"),
        sa.CheckConstraint(
            "asset_type IN ('LOGO', 'PHOTO', 'REGISTRATION_DOC')",
            name="ck_hospital_assets_asset_type",
        ),
    )
    op.create_index(
        "ix_hospital_assets_asset_type_active",
        "hospital_assets",
        ["asset_type", "is_active"],
    )
    op.create_index(
        "ix_hospital_assets_uploaded_by",
        "hospital_assets",
        ["uploaded_by_user_id"],
    )

    # 2. Permissions for kalyan_app
    op.execute("GRANT SELECT, INSERT, UPDATE ON hospital_assets TO kalyan_app;")
    op.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kalyan_app;")


def downgrade() -> None:
    op.execute("REVOKE SELECT, INSERT, UPDATE ON hospital_assets FROM kalyan_app;")
    op.drop_index("ix_hospital_assets_uploaded_by", table_name="hospital_assets")
    op.drop_index("ix_hospital_assets_asset_type_active", table_name="hospital_assets")
    op.drop_table("hospital_assets")
