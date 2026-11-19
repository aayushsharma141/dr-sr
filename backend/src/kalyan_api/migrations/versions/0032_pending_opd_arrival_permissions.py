"""Grant the runtime role access to pending OPD arrivals.

Revision ID: 0032
Revises: 0031
Create Date: 2026-11-16
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0032"
down_revision: str | None = "0031"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute("GRANT SELECT, INSERT, UPDATE ON pending_opd_arrivals TO kalyan_app;")
        op.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kalyan_app;")


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute("REVOKE SELECT, INSERT, UPDATE ON pending_opd_arrivals FROM kalyan_app;")
