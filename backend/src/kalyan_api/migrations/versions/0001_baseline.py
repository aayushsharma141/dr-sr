"""Baseline schema, tables, append-only triggers, and least-privilege role grants.

Revision ID: 0001
Revises: None
Create Date: 2026-10-31

Requirements:
- AUD-01: Append-only audit logs with DB triggers blocking UPDATE, DELETE, TRUNCATE.
- SEC-03: Role limited to ADMIN, RECEPTION, DOCTOR; doctor_id NOT NULL iff role is DOCTOR.
- SEC-05: Zero seed credentials or default users.
- SEC-07: Singleton system_setup row constraint (id = 1) and append-only trigger.
- D-08: version_id on mutable tables.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import INET, JSONB, UUID

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. Table: doctors (stub entity)
    op.create_table(
        "doctors",
        sa.Column(
            "id", sa.BigInteger(), sa.Identity(always=False), nullable=False, primary_key=True
        ),
        sa.Column("name_en", sa.String(length=120), nullable=False),
        sa.Column(
            "is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False
        ),
        sa.Column(
            "version_id", sa.Integer(), server_default=sa.text("1"), nullable=False
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_doctors"),
    )

    # 2. Table: users
    op.create_table(
        "users",
        sa.Column(
            "id", sa.BigInteger(), sa.Identity(always=False), nullable=False, primary_key=True
        ),
        sa.Column("username", sa.String(length=64), nullable=False),
        sa.Column("full_name", sa.String(length=120), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("doctor_id", sa.BigInteger(), nullable=True),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column(
            "must_change_password",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        sa.Column(
            "is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False
        ),
        sa.Column(
            "failed_login_count",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("password_changed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "version_id", sa.Integer(), server_default=sa.text("1"), nullable=False
        ),
        sa.PrimaryKeyConstraint("id", name="pk_users"),
        sa.ForeignKeyConstraint(
            ["doctor_id"],
            ["doctors.id"],
            name="fk_users_doctor_id_doctors",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name="fk_users_created_by_users",
            ondelete="SET NULL",
        ),
        sa.UniqueConstraint("username", name="uq_users_username"),
        sa.UniqueConstraint("doctor_id", name="uq_users_doctor_id"),
        sa.CheckConstraint(
            "role IN ('ADMIN', 'RECEPTION', 'DOCTOR')",
            name="ck_users_role_valid",
        ),
        sa.CheckConstraint(
            "((role = 'DOCTOR') = (doctor_id IS NOT NULL))",
            name="ck_users_doctor_role_requires_id",
        ),
    )

    # 3. Table: sessions
    op.create_table(
        "sessions",
        sa.Column(
            "id", sa.BigInteger(), sa.Identity(always=False), nullable=False, primary_key=True
        ),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("csrf_token", sa.String(length=64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("ip", INET(), nullable=True),
        sa.Column("user_agent", sa.String(length=255), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_sessions"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_sessions_user_id_users",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("token_hash", name="uq_sessions_token_hash"),
    )

    # 4. Table: login_throttle
    op.create_table(
        "login_throttle",
        sa.Column("ip", INET(), nullable=False),
        sa.Column("window_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "attempt_count", sa.Integer(), server_default=sa.text("1"), nullable=False
        ),
        sa.PrimaryKeyConstraint("ip", name="pk_login_throttle"),
    )

    # 5. Table: system_setup (SEC-07 authoritative singleton record)
    op.create_table(
        "system_setup",
        sa.Column("id", sa.SmallInteger(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("admin_user_id", sa.BigInteger(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_system_setup"),
        sa.ForeignKeyConstraint(
            ["admin_user_id"],
            ["users.id"],
            name="fk_system_setup_admin_user_id_users",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint("id = 1", name="ck_system_setup_single_row"),
    )

    # 6. Table: audit_logs (AUD-01 append-only audit trail)
    op.create_table(
        "audit_logs",
        sa.Column(
            "id", sa.BigInteger(), sa.Identity(always=False), nullable=False, primary_key=True
        ),
        sa.Column(
            "occurred_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("actor_user_id", sa.BigInteger(), nullable=True),
        sa.Column("actor_username", sa.String(length=64), nullable=True),
        sa.Column("actor_role", sa.String(length=16), nullable=True),
        sa.Column("action", sa.String(length=48), nullable=False),
        sa.Column("outcome", sa.String(length=16), nullable=False),
        sa.Column("entity_type", sa.String(length=32), nullable=True),
        sa.Column("entity_id", sa.Text(), nullable=True),
        sa.Column("before_data", JSONB(), nullable=True),
        sa.Column("after_data", JSONB(), nullable=True),
        sa.Column("reason", sa.String(length=500), nullable=True),
        sa.Column("request_id", UUID(as_uuid=True), nullable=True),
        sa.Column("ip", INET(), nullable=True),
        sa.Column("user_agent", sa.String(length=255), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_audit_logs"),
        sa.ForeignKeyConstraint(
            ["actor_user_id"],
            ["users.id"],
            name="fk_audit_logs_actor_user_id_users",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "outcome IN ('SUCCESS', 'FAILURE', 'DENIED')",
            name="ck_audit_logs_outcome_valid",
        ),
    )

    # Indexes on audit_logs
    op.create_index("ix_audit_logs_occurred_at", "audit_logs", ["occurred_at"])
    op.create_index("ix_audit_logs_action", "audit_logs", ["action"])
    op.create_index("ix_audit_logs_entity", "audit_logs", ["entity_type", "entity_id"])
    op.create_index("ix_audit_logs_actor_time", "audit_logs", ["actor_user_id", "occurred_at"])

    # 7. Append-Only Trigger Function (blocking mutation on audit_logs and system_setup)
    op.execute("""
CREATE OR REPLACE FUNCTION audit_logs_block_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% blocked)', TG_TABLE_NAME, TG_OP;
END;
$$;
    """)

    # Triggers on audit_logs
    op.execute("""
CREATE TRIGGER trg_audit_logs_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_mutation();
    """)
    op.execute("""
CREATE TRIGGER trg_audit_logs_no_truncate
  BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_block_mutation();
    """)

    # Triggers on system_setup
    op.execute("""
CREATE TRIGGER trg_system_setup_no_update_delete
  BEFORE UPDATE OR DELETE ON system_setup
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_mutation();
    """)
    op.execute("""
CREATE TRIGGER trg_system_setup_no_truncate
  BEFORE TRUNCATE ON system_setup
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_block_mutation();
    """)

    # 8. Least-Privilege Grants to kalyan_app
    op.execute("GRANT USAGE ON SCHEMA public TO kalyan_app;")
    op.execute("GRANT SELECT, INSERT ON audit_logs TO kalyan_app;")
    op.execute("GRANT SELECT, INSERT ON system_setup TO kalyan_app;")
    op.execute("GRANT SELECT, INSERT, UPDATE ON users TO kalyan_app;")
    op.execute("GRANT SELECT, INSERT, UPDATE ON doctors TO kalyan_app;")
    op.execute("GRANT SELECT, INSERT, UPDATE ON login_throttle TO kalyan_app;")
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON sessions TO kalyan_app;")
    op.execute("GRANT SELECT ON alembic_version TO kalyan_app;")
    op.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kalyan_app;")


def downgrade() -> None:
    # Revoke role grants
    op.execute("REVOKE USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public FROM kalyan_app;")
    op.execute("REVOKE SELECT ON alembic_version FROM kalyan_app;")
    op.execute("REVOKE SELECT, INSERT, UPDATE, DELETE ON sessions FROM kalyan_app;")
    op.execute("REVOKE SELECT, INSERT, UPDATE ON login_throttle FROM kalyan_app;")
    op.execute("REVOKE SELECT, INSERT, UPDATE ON doctors FROM kalyan_app;")
    op.execute("REVOKE SELECT, INSERT, UPDATE ON users FROM kalyan_app;")
    op.execute("REVOKE SELECT, INSERT ON system_setup FROM kalyan_app;")
    op.execute("REVOKE SELECT, INSERT ON audit_logs FROM kalyan_app;")
    op.execute("REVOKE USAGE ON SCHEMA public FROM kalyan_app;")

    # Drop triggers
    op.execute("DROP TRIGGER IF EXISTS trg_system_setup_no_truncate ON system_setup;")
    op.execute("DROP TRIGGER IF EXISTS trg_system_setup_no_update_delete ON system_setup;")
    op.execute("DROP TRIGGER IF EXISTS trg_audit_logs_no_truncate ON audit_logs;")
    op.execute("DROP TRIGGER IF EXISTS trg_audit_logs_no_update_delete ON audit_logs;")
    op.execute("DROP FUNCTION IF EXISTS audit_logs_block_mutation();")

    # Drop tables in dependency order
    op.drop_table("audit_logs")
    op.drop_table("system_setup")
    op.drop_table("login_throttle")
    op.drop_table("sessions")
    op.drop_table("users")
    op.drop_table("doctors")
