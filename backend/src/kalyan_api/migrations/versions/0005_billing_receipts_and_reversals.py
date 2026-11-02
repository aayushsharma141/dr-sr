"""Billing, sequential receipts, and payment reversals schema.

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-02

Requirements:
- BIL-01: Consultation fees and package instalment payments ledger (CASH, UPI, CARD).
- BIL-02: Money stored as integer paise; overpayments and negative amounts rejected.
- BIL-03: Dynamic balance computation; tamper-proof payment rows.
- BIL-04: Atomic gap-free sequential receipts (RCP-YYYY-XXXX).
- BIL-05: Admin-authorized payment reversals with mandatory reason.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. Table: receipt_sequences (BIL-04)
    op.create_table(
        "receipt_sequences",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("cycle_key", sa.String(32), unique=True, nullable=False),
        sa.Column("last_number", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )

    # 2. Table: payments (BIL-01, BIL-02, BIL-03, BIL-05)
    op.create_table(
        "payments",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("receipt_number", sa.String(32), unique=True, nullable=False),
        sa.Column(
            "patient_id",
            sa.BigInteger(),
            sa.ForeignKey("patients.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "treatment_plan_id",
            sa.BigInteger(),
            sa.ForeignKey("treatment_plans.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column(
            "appointment_id",
            sa.BigInteger(),
            sa.ForeignKey("appointments.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("amount_paise", sa.Integer(), nullable=False),
        sa.Column("payment_method", sa.String(16), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("is_reversed", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("reversal_reason", sa.Text(), nullable=True),
        sa.Column(
            "reversed_by_user_id",
            sa.BigInteger(),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column("reversed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_by_user_id",
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
        sa.CheckConstraint("amount_paise > 0", name="ck_payments_amount_positive"),
        sa.CheckConstraint(
            "payment_method IN ('CASH', 'UPI', 'CARD')",
            name="ck_payments_payment_method",
        ),
        sa.CheckConstraint(
            "(is_reversed = FALSE AND reversal_reason IS NULL AND "
            "reversed_by_user_id IS NULL AND reversed_at IS NULL) "
            "OR (is_reversed = TRUE AND reversal_reason IS NOT NULL AND "
            "length(trim(reversal_reason)) >= 5 AND "
            "reversed_by_user_id IS NOT NULL AND reversed_at IS NOT NULL)",
            name="ck_payments_reversal_integrity",
        ),
    )
    op.create_index("ix_payments_receipt_number", "payments", ["receipt_number"])
    op.create_index("ix_payments_patient_id", "payments", ["patient_id"])
    op.create_index("ix_payments_treatment_plan_id", "payments", ["treatment_plan_id"])
    op.create_index("ix_payments_appointment_id", "payments", ["appointment_id"])
    op.create_index("ix_payments_is_reversed", "payments", ["is_reversed"])

    # 3. Immutability Trigger for posted payments (BIL-05)
    op.execute(
        """
        CREATE OR REPLACE FUNCTION fn_prevent_payment_tampering()
        RETURNS TRIGGER AS $$
        BEGIN
            IF TG_OP = 'DELETE' THEN
                RAISE EXCEPTION 'Posted payments cannot be deleted. Use admin reversal.';
            ELSIF TG_OP = 'UPDATE' THEN
                IF OLD.is_reversed = TRUE THEN
                    RAISE EXCEPTION 'Reversed payments are permanently immutable.';
                END IF;

                IF NEW.is_reversed = TRUE AND OLD.is_reversed = FALSE THEN
                    IF (
                        OLD.id IS DISTINCT FROM NEW.id OR
                        OLD.receipt_number IS DISTINCT FROM NEW.receipt_number OR
                        OLD.patient_id IS DISTINCT FROM NEW.patient_id OR
                        OLD.treatment_plan_id IS DISTINCT FROM NEW.treatment_plan_id OR
                        OLD.appointment_id IS DISTINCT FROM NEW.appointment_id OR
                        OLD.amount_paise IS DISTINCT FROM NEW.amount_paise OR
                        OLD.payment_method IS DISTINCT FROM NEW.payment_method OR
                        OLD.notes IS DISTINCT FROM NEW.notes OR
                        OLD.created_by_user_id IS DISTINCT FROM NEW.created_by_user_id OR
                        OLD.created_at IS DISTINCT FROM NEW.created_at
                    ) THEN
                        RAISE EXCEPTION 'Only reversal metadata can be updated on reversal.';
                    END IF;
                    RETURN NEW;
                ELSE
                    RAISE EXCEPTION 'Posted payment details cannot be modified.';
                END IF;
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_prevent_payment_tampering
        BEFORE UPDATE OR DELETE ON payments
        FOR EACH ROW
        EXECUTE FUNCTION fn_prevent_payment_tampering();
        """
    )

    # 4. Package Overpayment Limit Trigger (BIL-02)
    op.execute(
        """
        CREATE OR REPLACE FUNCTION fn_enforce_package_payment_limits()
        RETURNS TRIGGER AS $$
        DECLARE
            pkg_price INTEGER;
            paid_total INTEGER;
        BEGIN
            IF NEW.treatment_plan_id IS NOT NULL AND NEW.is_reversed = FALSE THEN
                SELECT agreed_price_paise INTO pkg_price
                FROM treatment_plans
                WHERE id = NEW.treatment_plan_id
                FOR UPDATE;

                IF pkg_price IS NULL THEN
                    RAISE EXCEPTION 'Referenced treatment plan does not exist.';
                END IF;

                SELECT COALESCE(SUM(amount_paise), 0) INTO paid_total
                FROM payments
                WHERE treatment_plan_id = NEW.treatment_plan_id
                  AND is_reversed = FALSE
                  AND id != COALESCE(NEW.id, -1);

                IF (paid_total + NEW.amount_paise) > pkg_price THEN
                    RAISE EXCEPTION 'Payment exceeds agreed treatment package price.';
                END IF;
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_enforce_package_payment_limits
        BEFORE INSERT OR UPDATE ON payments
        FOR EACH ROW
        EXECUTE FUNCTION fn_enforce_package_payment_limits();
        """
    )

    # 5. Least-privilege Grants for runtime role kalyan_app
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON receipt_sequences TO kalyan_app;")
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON payments TO kalyan_app;")
    op.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kalyan_app;")


def downgrade() -> None:
    op.execute("REVOKE SELECT, INSERT, UPDATE, DELETE ON payments FROM kalyan_app;")
    op.execute("REVOKE SELECT, INSERT, UPDATE, DELETE ON receipt_sequences FROM kalyan_app;")
    op.execute("DROP TRIGGER IF EXISTS trg_enforce_package_payment_limits ON payments")
    op.execute("DROP FUNCTION IF EXISTS fn_enforce_package_payment_limits()")
    op.execute("DROP TRIGGER IF EXISTS trg_prevent_payment_tampering ON payments")
    op.execute("DROP FUNCTION IF EXISTS fn_prevent_payment_tampering()")
    op.drop_table("payments")
    op.drop_table("receipt_sequences")
