"""Appointments hardening: idempotency keys, token reset policy, and OPD arrival cancel reason.

Revision ID: 0038
Revises: 0037
Create Date: 2026-11-18

Tasks (T1):
- Create `idempotency_keys` table for atomic, 24h TTL idempotent reception mutations with
  least-privilege runtime grants (`SELECT, INSERT, UPDATE, DELETE` strictly on this ephemeral
  table; clinical/patient/financial tables remain append-only).
- Add `clinic_settings.token_reset_policy` (`'DAILY'` enforced by check constraint).
- Add nullable `pending_opd_arrivals.cancellation_reason` (Text) so cancelling an arrival does
  not overwrite `priority_reason`.
- Fail-closed `downgrade()` refusing to drop `cancellation_reason` if historical text exists.

Naming: env.py's naming convention prefixes `ck_<table>_` on every CheckConstraint name in both
create and drop calls. Pass bare names (`"token_reset_policy_valid"`).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0038"
down_revision: str | None = "0037"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. Ephemeral idempotency keys table (24h TTL)
    op.create_table(
        "idempotency_keys",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column("actor_user_id", sa.BigInteger(), nullable=False),
        sa.Column("endpoint_key", sa.String(length=128), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("request_hash", sa.String(length=64), nullable=False),
        sa.Column("response_status", sa.SmallInteger(), nullable=False),
        sa.Column(
            "response_body",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["actor_user_id"],
            ["users.id"],
            name="fk_idempotency_keys_actor_user_id_users",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "actor_user_id",
            "endpoint_key",
            "idempotency_key",
            name="uq_idempotency_keys_scope",
        ),
    )
    op.create_index(
        "ix_idempotency_keys_expires_at",
        "idempotency_keys",
        ["expires_at"],
    )

    # 2. ClinicSettings explicit daily token reset policy
    op.add_column(
        "clinic_settings",
        sa.Column(
            "token_reset_policy",
            sa.String(length=24),
            server_default=sa.text("'DAILY'"),
            nullable=False,
        ),
    )
    op.create_check_constraint(
        "token_reset_policy_valid",
        "clinic_settings",
        "token_reset_policy IN ('DAILY')",
    )

    # 3. Dedicated cancellation_reason column on pending_opd_arrivals
    op.add_column(
        "pending_opd_arrivals",
        sa.Column("cancellation_reason", sa.Text(), nullable=True),
    )

    # 4. Runtime grants for kalyan_app (DELETE granted strictly on ephemeral idempotency_keys)
    if op.get_bind().dialect.name == "postgresql":
        op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON idempotency_keys TO kalyan_app;")
        op.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kalyan_app;")


def downgrade() -> None:
    bind = op.get_bind()

    reason_rows = bind.execute(
        sa.text(
            "SELECT count(*) FROM pending_opd_arrivals WHERE cancellation_reason IS NOT NULL"
        )
    ).scalar_one()
    if reason_rows:
        raise RuntimeError(
            f"Migration 0038 downgrade stopped: {reason_rows} pending_opd_arrivals row(s) "
            "have a cancellation_reason. Historical audit text is not deleted. "
            "Nothing was changed."
        )

    if bind.dialect.name == "postgresql":
        op.execute("REVOKE SELECT, INSERT, UPDATE, DELETE ON idempotency_keys FROM kalyan_app;")

    op.drop_column("pending_opd_arrivals", "cancellation_reason")
    op.drop_constraint("token_reset_policy_valid", "clinic_settings", type_="check")
    op.drop_column("clinic_settings", "token_reset_policy")
    op.drop_index("ix_idempotency_keys_expires_at", table_name="idempotency_keys")
    op.drop_table("idempotency_keys")
