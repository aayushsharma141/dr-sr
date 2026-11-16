"""Fee adjustments: original amounts and an append-only adjustment history.

Revision ID: 0028
Revises: 0027
Create Date: 2026-11-15

Phase 22 (Integrated OPD workflow), Wave 3, second slice. Owner decisions OD-22-11 and OD-22-15:
the doctor may reduce, discount or waive the fee of own consultation with a reason; reception
may only with an explicit permission; original and revised amounts are kept, and nothing after a
payment is silently overwritten.

- bill_items.original_amount_paise: the amount as first billed. Back-filled from amount_paise, so
  existing lines start with their original amount equal to their current amount.
- bill_item_adjustments: one row per change, with the value it replaced, the reason, the actor and
  the time. The application role may only SELECT and INSERT here.
- bill_items: the application role gains UPDATE, used only to move amount_paise and rate_paise
  when an adjustment is written in the same transaction.

Naming: env.py's naming convention adds the "ck_<table>_" prefix to every CHECK constraint name;
pass the bare name.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0028"
down_revision: str | None = "0027"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("bill_items", sa.Column("original_amount_paise", sa.BigInteger(), nullable=True))
    op.execute("UPDATE bill_items SET original_amount_paise = amount_paise")
    op.alter_column("bill_items", "original_amount_paise", nullable=False)

    op.create_table(
        "bill_item_adjustments",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("bill_item_id", sa.BigInteger(), nullable=False),
        sa.Column("old_quantity", sa.Numeric(10, 2), nullable=False),
        sa.Column("new_quantity", sa.Numeric(10, 2), nullable=False),
        sa.Column("old_rate_paise", sa.BigInteger(), nullable=False),
        sa.Column("new_rate_paise", sa.BigInteger(), nullable=False),
        sa.Column("old_amount_paise", sa.BigInteger(), nullable=False),
        sa.Column("new_amount_paise", sa.BigInteger(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("actor_user_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["bill_item_id"],
            ["bill_items.id"],
            name="fk_bill_item_adjustments_bill_item",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["actor_user_id"],
            ["users.id"],
            name="fk_bill_item_adjustments_actor_user_id_users",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "kind IN ('DISCOUNT', 'WAIVER', 'CORRECTION', 'VOID')", name="kind_valid"
        ),
        sa.CheckConstraint("length(trim(reason)) >= 3", name="reason_present"),
        sa.CheckConstraint(
            "old_amount_paise >= 0 AND new_amount_paise >= 0", name="amounts_nonnegative"
        ),
    )
    op.create_index(
        "ix_bill_item_adjustments_bill_item", "bill_item_adjustments", ["bill_item_id"]
    )

    # History is append-only for the application.
    op.execute("GRANT SELECT, INSERT ON bill_item_adjustments TO kalyan_app;")
    # Amounts move only through an adjustment, written in the same transaction.
    op.execute("GRANT UPDATE ON bill_items TO kalyan_app;")
    op.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kalyan_app;")


def downgrade() -> None:
    bind = op.get_bind()
    adjustments = bind.execute(
        sa.text("SELECT count(*) FROM bill_item_adjustments")
    ).scalar_one()
    if adjustments:
        raise RuntimeError(
            f"Migration 0028 downgrade stopped: {adjustments} adjustment row(s) exist. "
            "The adjustment history is not deleted. Nothing was changed."
        )
    op.execute("REVOKE UPDATE ON bill_items FROM kalyan_app;")
    op.drop_index("ix_bill_item_adjustments_bill_item", table_name="bill_item_adjustments")
    op.drop_table("bill_item_adjustments")
    op.drop_column("bill_items", "original_amount_paise")
