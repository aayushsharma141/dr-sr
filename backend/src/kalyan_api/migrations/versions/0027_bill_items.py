"""Bill lines and the consultation fee snapshot (K-63, FEE-07).

Revision ID: 0027
Revises: 0026
Create Date: 2026-11-15

Phase 22 (Integrated OPD workflow), task T22-07, first slice. Owner decision OD-22-10: the
doctor's fee is saved as the consultation's bill line when the patient is checked in, and a later
change to the doctor's default fee never alters an existing bill.

- Creates `bill_items`: the visit's charge lines, integer paise, append-only for the application
  role (SELECT and INSERT only).
- Back-fill: every consultation already linked to a visit gets one SYSTEM CONSULTATION line at its
  doctor's default fee as it stands when this migration runs. The amount due therefore does not
  change on the day the migration is applied; only future fee edits stop affecting it.
- Nothing is deleted or updated. The downgrade refuses to drop bill lines (they are financial
  records), so a rollback needs a deliberate decision by the owner.

Naming: env.py's naming convention adds the "ck_<table>_" prefix to every CHECK constraint name;
pass the bare name.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0027"
down_revision: str | None = "0026"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "bill_items",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("visit_id", sa.BigInteger(), nullable=False),
        sa.Column("patient_id", sa.BigInteger(), nullable=False),
        sa.Column("appointment_id", sa.BigInteger(), nullable=True),
        sa.Column("category", sa.String(length=16), nullable=False),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("quantity", sa.Numeric(10, 2), nullable=False, server_default=sa.text("1")),
        sa.Column("rate_paise", sa.BigInteger(), nullable=False),
        sa.Column("amount_paise", sa.BigInteger(), nullable=False),
        sa.Column("created_by_user_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["visit_id", "patient_id"],
            ["visits.id", "visits.patient_id"],
            name="fk_bill_items_visit_patient",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["appointment_id", "patient_id"],
            ["appointments.id", "appointments.patient_id"],
            name="fk_bill_items_appointment_patient",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["users.id"],
            name="fk_bill_items_created_by_user_id_users",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "category IN ('CONSULTATION', 'PROCEDURE', 'PACKAGE', 'MEDICINE', 'ADDITIONAL')",
            name="category_valid",
        ),
        sa.CheckConstraint("source IN ('DOCTOR', 'RECEPTION', 'SYSTEM')", name="source_valid"),
        sa.CheckConstraint("quantity > 0", name="quantity_positive"),
        sa.CheckConstraint(
            "rate_paise >= 0 AND amount_paise >= 0", name="amounts_nonnegative"
        ),
        sa.CheckConstraint(
            "category <> 'CONSULTATION' OR appointment_id IS NOT NULL",
            name="consultation_has_appointment",
        ),
    )
    op.create_index("ix_bill_items_visit", "bill_items", ["visit_id"])
    op.create_index(
        "uq_bill_items_consultation_appointment",
        "bill_items",
        ["appointment_id"],
        unique=True,
        postgresql_where=sa.text("category = 'CONSULTATION'"),
    )

    # Back-fill: one SYSTEM consultation line per visit-linked appointment, at the fee as it
    # stands now. Visible balances are unchanged by this migration.
    op.execute(
        """
        INSERT INTO bill_items (
            visit_id, patient_id, appointment_id, category, source, description,
            quantity, rate_paise, amount_paise, created_by_user_id
        )
        SELECT a.visit_id, a.patient_id, a.id, 'CONSULTATION', 'SYSTEM',
               'Consultation fee (snapshot at migration 0027)',
               1, d.default_fee_paise, d.default_fee_paise, a.created_by_user_id
        FROM appointments a
        JOIN doctors d ON d.id = a.doctor_id
        WHERE a.visit_id IS NOT NULL
        """
    )

    # Append-only for the application: no UPDATE, no DELETE.
    op.execute("GRANT SELECT, INSERT ON bill_items TO kalyan_app;")
    op.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kalyan_app;")


def downgrade() -> None:
    bind = op.get_bind()
    lines = bind.execute(sa.text("SELECT count(*) FROM bill_items")).scalar_one()
    if lines:
        raise RuntimeError(
            f"Migration 0027 downgrade stopped: {lines} bill line(s) exist. "
            "Bill lines are financial records and are not deleted. Nothing was changed."
        )
    op.drop_index("uq_bill_items_consultation_appointment", table_name="bill_items")
    op.drop_index("ix_bill_items_visit", table_name="bill_items")
    op.drop_table("bill_items")
