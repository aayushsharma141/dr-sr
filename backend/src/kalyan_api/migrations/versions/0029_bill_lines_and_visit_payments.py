"""Bill lines and visit payments (Phase 22, migration 0029).

Revision ID: 0029
Revises: 0028
Create Date: 2026-11-15

Phase 22 (Integrated OPD workflow), tasks T22-04 and T22-07.
Design reference: 22-DESIGN.md §4 (Data contracts & migrations), §5 (Status transitions),
RESEARCH.md OQ-1 (Payment linking to visits), and plan 22-04.

- bill_items:
  * status: varchar(16) NOT NULL DEFAULT 'ACTIVE', CHECK status IN ('ACTIVE', 'VOIDED')
  * void_reason: text NULL
  * voided_by_user_id: bigint NULL FK users ON DELETE RESTRICT
  * voided_at: timestamptz NULL
  * CHECK void_integrity: ACTIVE has all 3 NULL, VOIDED has all 3 set and length(trim(void_reason)) >= 3
  * unit: varchar(32) NULL
  * prescription_item_id: bigint NULL FK prescription_items.id ON DELETE SET NULL
  * treatment_plan_id: bigint NULL composite FK (treatment_plan_id, patient_id) -> treatment_plans(id, patient_id) ON DELETE RESTRICT
  * CHECK package_reference: category <> 'PACKAGE' OR (treatment_plan_id IS NOT NULL AND rate_paise = 0 AND amount_paise = 0)
  * CHECK prescription_link_medicine_only: category = 'MEDICINE' OR prescription_item_id IS NULL
  * index ix_bill_items_appointment on appointment_id
  * No version_id column (row-level locking via with_for_update is used instead)
- payments:
  * visit_id: bigint NULL
  * composite FK (visit_id, patient_id) -> visits(id, patient_id) named fk_payments_visit_patient ON DELETE RESTRICT
  * index ix_payments_visit_id
  * CHECK single_target: visit_id IS NULL OR (treatment_plan_id IS NULL AND appointment_id IS NULL)
- Downgrade: refuses if any new-style row or visit payment exists; otherwise drops in reverse order.
- Grants: no new tables, runtime grants unchanged.

Naming: env.py's naming convention adds the "ck_<table>_" prefix to every CHECK constraint
name; pass the bare name.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0029"
down_revision: str | None = "0028"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # --- bill_items: status, void tracking, details, package/rx links ---
    op.add_column(
        "bill_items",
        sa.Column(
            "status",
            sa.String(length=16),
            server_default=sa.text("'ACTIVE'"),
            nullable=False,
        ),
    )
    op.add_column("bill_items", sa.Column("void_reason", sa.Text(), nullable=True))
    op.add_column(
        "bill_items",
        sa.Column("voided_by_user_id", sa.BigInteger(), nullable=True),
    )
    op.add_column(
        "bill_items",
        sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column("bill_items", sa.Column("unit", sa.String(length=32), nullable=True))
    op.add_column(
        "bill_items",
        sa.Column("prescription_item_id", sa.BigInteger(), nullable=True),
    )
    op.add_column(
        "bill_items",
        sa.Column("treatment_plan_id", sa.BigInteger(), nullable=True),
    )

    op.create_foreign_key(
        "fk_bill_items_voided_by_user_id_users",
        "bill_items",
        "users",
        ["voided_by_user_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        "fk_bill_items_prescription_item_id_prescription_items",
        "bill_items",
        "prescription_items",
        ["prescription_item_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_bill_items_treatment_plan_patient",
        "bill_items",
        "treatment_plans",
        ["treatment_plan_id", "patient_id"],
        ["id", "patient_id"],
        ondelete="RESTRICT",
    )

    op.create_check_constraint(
        "status_valid",
        "bill_items",
        "status IN ('ACTIVE', 'VOIDED')",
    )
    op.create_check_constraint(
        "void_integrity",
        "bill_items",
        "(status = 'ACTIVE' AND void_reason IS NULL AND voided_by_user_id IS NULL AND voided_at IS NULL) "
        "OR (status = 'VOIDED' AND void_reason IS NOT NULL AND length(trim(void_reason)) >= 3 "
        "AND voided_by_user_id IS NOT NULL AND voided_at IS NOT NULL)",
    )
    op.create_check_constraint(
        "package_reference",
        "bill_items",
        "category <> 'PACKAGE' OR (treatment_plan_id IS NOT NULL AND rate_paise = 0 AND amount_paise = 0)",
    )
    op.create_check_constraint(
        "prescription_link_medicine_only",
        "bill_items",
        "category = 'MEDICINE' OR prescription_item_id IS NULL",
    )
    op.create_index("ix_bill_items_appointment", "bill_items", ["appointment_id"])

    # --- payments: visit payment link ---
    op.add_column("payments", sa.Column("visit_id", sa.BigInteger(), nullable=True))
    op.create_foreign_key(
        "fk_payments_visit_patient",
        "payments",
        "visits",
        ["visit_id", "patient_id"],
        ["id", "patient_id"],
        ondelete="RESTRICT",
    )
    op.create_index("ix_payments_visit_id", "payments", ["visit_id"])
    op.create_check_constraint(
        "single_target",
        "payments",
        "visit_id IS NULL OR (treatment_plan_id IS NULL AND appointment_id IS NULL)",
    )


def downgrade() -> None:
    bind = op.get_bind()
    used_bill_items = bind.execute(
        sa.text(
            "SELECT count(*) FROM bill_items WHERE status = 'VOIDED' "
            "OR category <> 'CONSULTATION' "
            "OR unit IS NOT NULL "
            "OR prescription_item_id IS NOT NULL "
            "OR treatment_plan_id IS NOT NULL"
        )
    ).scalar_one()
    used_payments = bind.execute(
        sa.text("SELECT count(*) FROM payments WHERE visit_id IS NOT NULL")
    ).scalar_one()
    if used_bill_items or used_payments:
        raise RuntimeError(
            f"Migration 0029 downgrade stopped: {used_bill_items} bill line(s) and "
            f"{used_payments} payment(s) hold new OPD workflow data that would be dropped. "
            "Financial records are not deleted. Nothing was changed."
        )

    # payments
    op.drop_constraint("single_target", "payments", type_="check")
    op.drop_constraint("fk_payments_visit_patient", "payments", type_="foreignkey")
    op.drop_index("ix_payments_visit_id", table_name="payments")
    op.drop_column("payments", "visit_id")

    # bill_items
    op.drop_index("ix_bill_items_appointment", table_name="bill_items")
    op.drop_constraint("prescription_link_medicine_only", "bill_items", type_="check")
    op.drop_constraint("package_reference", "bill_items", type_="check")
    op.drop_constraint("void_integrity", "bill_items", type_="check")
    op.drop_constraint("status_valid", "bill_items", type_="check")
    op.drop_constraint("fk_bill_items_treatment_plan_patient", "bill_items", type_="foreignkey")
    op.drop_constraint(
        "fk_bill_items_prescription_item_id_prescription_items", "bill_items", type_="foreignkey"
    )
    op.drop_constraint(
        "fk_bill_items_voided_by_user_id_users", "bill_items", type_="foreignkey"
    )
    op.drop_column("bill_items", "treatment_plan_id")
    op.drop_column("bill_items", "prescription_item_id")
    op.drop_column("bill_items", "unit")
    op.drop_column("bill_items", "voided_at")
    op.drop_column("bill_items", "voided_by_user_id")
    op.drop_column("bill_items", "void_reason")
    op.drop_column("bill_items", "status")
