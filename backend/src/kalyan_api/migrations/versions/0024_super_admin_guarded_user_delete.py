"""Super admin flag and guarded user deletion.

Revision ID: 0024
Revises: 0023
Create Date: 2026-11-13

Replaces the blanket "users are never deleted" rule with a narrow, database-enforced exception:

- users.is_super_admin marks the account whose password authorises user deletion. Only an
  ADMIN can be a super admin (CHECK). The administrator created at initial setup is
  backfilled as the super admin.
- delete_unreferenced_user(id) is the ONLY way the application role can remove a user row.
  kalyan_app still has no table-level DELETE on users. The function refuses super admins and
  accounts that created other accounts, and the RESTRICT foreign keys on audit, payment,
  encounter, prescription, session, backup and upload records make it fail for any account
  with recorded activity. Historical records are therefore never orphaned or erased.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0024"
down_revision: str | None = "0023"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("is_super_admin", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.create_check_constraint(
        "ck_users_super_admin_is_admin",
        "users",
        "(NOT is_super_admin) OR role = 'ADMIN'",
    )
    op.execute(
        """
UPDATE users SET is_super_admin = true
WHERE id = (SELECT admin_user_id FROM system_setup WHERE id = 1)
  AND role = 'ADMIN';
"""
    )
    op.execute(
        """
CREATE FUNCTION delete_unreferenced_user(p_user_id bigint) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_super boolean;
BEGIN
  SELECT is_super_admin INTO v_super FROM users WHERE id = p_user_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF v_super THEN
    RAISE EXCEPTION 'super admin accounts cannot be deleted' USING ERRCODE = '23503';
  END IF;
  IF EXISTS (SELECT 1 FROM users WHERE created_by = p_user_id) THEN
    RAISE EXCEPTION 'account created other accounts and cannot be deleted'
      USING ERRCODE = '23503';
  END IF;
  DELETE FROM users WHERE id = p_user_id;
  RETURN true;
END;
$$;
"""
    )
    op.execute("REVOKE ALL ON FUNCTION delete_unreferenced_user(bigint) FROM PUBLIC;")
    op.execute("GRANT EXECUTE ON FUNCTION delete_unreferenced_user(bigint) TO kalyan_app;")


def downgrade() -> None:
    op.execute("DROP FUNCTION IF EXISTS delete_unreferenced_user(bigint);")
    op.drop_constraint("ck_users_super_admin_is_admin", "users", type_="check")
    op.drop_column("users", "is_super_admin")
