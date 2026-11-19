"""Financial hardening: BigInteger paise parity, refunds, and append-only ledger.

Revision ID: 0036
Revises: 0035
Create Date: 2026-11-18

Milestone 3 (T3.1):
- Widen `payments.amount_paise` from INTEGER to BIGINT and add `uq_payments_id_patient`.
- Create `refund_sequences` and immutable `refunds` with composite same-patient FKs,
  `trg_prevent_refund_tampering`, and `trg_enforce_refund_limit` (locking parent payment
  row FOR UPDATE to prevent over-refunds and refunds on reversed payments).
- Update `fn_enforce_package_payment_limits()` to use BIGINT accumulators and net active
  `refunds` against package payments.
- Update `fn_prevent_payment_tampering()` to preserve all 0017 checks (including the 4
  print-snapshot columns) and lock `visit_id` immutable on reversal.
- Create append-only `ledger_entries` with signed-amount invariants and idempotency key
  `uq_ledger_ref_event (reference_type, reference_id, entry_type)`.
- Backfill historical `bill_items`, `bill_item_adjustments`, `treatment_plans`, legacy
  standalone payments, and `payments` + reversals before attaching
  `trg_prevent_ledger_tampering` (blocking UPDATE, DELETE, and TRUNCATE).
- Grant least-privilege runtime access to `kalyan_app` and enforce fail-closed `downgrade()`.

Naming: env.py's naming convention prefixes `ck_<table>_` on every CheckConstraint name in both
create and drop calls. Pass bare names (`"amount_positive"`, `"method_valid"`, etc.).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0036"
down_revision: str | None = "0035"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. Money type parity & composite unique key on payments
    op.alter_column(
        "payments",
        "amount_paise",
        existing_type=sa.Integer(),
        type_=sa.BigInteger(),
        existing_nullable=False,
    )
    op.create_unique_constraint("uq_payments_id_patient", "payments", ["id", "patient_id"])

    # 2. Refund sequences & immutable refunds table (D-06, Admin-only)
    op.create_table(
        "refund_sequences",
        sa.Column("cycle_key", sa.String(length=16), primary_key=True),
        sa.Column(
            "last_number",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
    )

    op.create_table(
        "refunds",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column("refund_number", sa.String(length=32), nullable=False),
        sa.Column("payment_id", sa.BigInteger(), nullable=False),
        sa.Column("patient_id", sa.BigInteger(), nullable=False),
        sa.Column("visit_id", sa.BigInteger(), nullable=True),
        sa.Column("amount_paise", sa.BigInteger(), nullable=False),
        sa.Column("refund_method", sa.String(length=16), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("refunded_by_user_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("refund_number", name="uq_refunds_refund_number"),
        sa.ForeignKeyConstraint(
            ["payment_id", "patient_id"],
            ["payments.id", "payments.patient_id"],
            name="fk_refunds_payment_patient",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["visit_id", "patient_id"],
            ["visits.id", "visits.patient_id"],
            name="fk_refunds_visit_patient",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["refunded_by_user_id"],
            ["users.id"],
            name="fk_refunds_refunded_by_user_id_users",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint("amount_paise > 0", name="amount_positive"),
        sa.CheckConstraint("refund_method IN ('CASH', 'UPI', 'CARD')", name="method_valid"),
        sa.CheckConstraint("length(trim(reason)) >= 5", name="reason_min_len"),
    )
    op.create_index("ix_refunds_payment_id", "refunds", ["payment_id"])
    op.create_index("ix_refunds_patient_id", "refunds", ["patient_id"])
    op.create_index("ix_refunds_visit_id", "refunds", ["visit_id"])

    op.execute(
        """
        CREATE OR REPLACE FUNCTION fn_prevent_refund_tampering()
        RETURNS TRIGGER AS $$
        BEGIN
            RAISE EXCEPTION
                'Refund records are permanently immutable (% is prohibited).',
                TG_OP;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_prevent_refund_tampering
        BEFORE UPDATE OR DELETE OR TRUNCATE ON refunds
        FOR EACH STATEMENT
        EXECUTE FUNCTION fn_prevent_refund_tampering();
        """
    )

    op.execute(
        """
        CREATE OR REPLACE FUNCTION fn_enforce_refund_limit()
        RETURNS TRIGGER AS $$
        DECLARE
            v_payment_amount BIGINT;
            v_is_reversed BOOLEAN;
            v_refunded_total BIGINT;
        BEGIN
            SELECT amount_paise, is_reversed
            INTO v_payment_amount, v_is_reversed
            FROM payments
            WHERE id = NEW.payment_id
            FOR UPDATE;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'Referenced payment does not exist.';
            END IF;

            IF v_is_reversed = TRUE THEN
                RAISE EXCEPTION 'Cannot refund a reversed payment.';
            END IF;

            SELECT COALESCE(SUM(amount_paise), 0)::BIGINT
            INTO v_refunded_total
            FROM refunds
            WHERE payment_id = NEW.payment_id;

            IF (v_refunded_total + NEW.amount_paise) > v_payment_amount THEN
                RAISE EXCEPTION 'Refund amount exceeds remaining refundable payment amount.';
            END IF;

            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_enforce_refund_limit
        BEFORE INSERT ON refunds
        FOR EACH ROW
        EXECUTE FUNCTION fn_enforce_refund_limit();
        """
    )

    # 3. Update payment triggers (after `refunds` exists so both functions can query it)
    op.execute(
        """
        CREATE OR REPLACE FUNCTION fn_enforce_package_payment_limits()
        RETURNS TRIGGER AS $$
        DECLARE
            pkg_price BIGINT;
            paid_total BIGINT;
            refunded_total BIGINT;
        BEGIN
            IF NEW.treatment_plan_id IS NOT NULL AND NEW.is_reversed = FALSE THEN
                SELECT agreed_price_paise INTO pkg_price
                FROM treatment_plans
                WHERE id = NEW.treatment_plan_id
                FOR UPDATE;

                IF pkg_price IS NULL THEN
                    RAISE EXCEPTION 'Referenced treatment plan does not exist.';
                END IF;

                SELECT COALESCE(SUM(amount_paise), 0)::BIGINT INTO paid_total
                FROM payments
                WHERE treatment_plan_id = NEW.treatment_plan_id
                  AND is_reversed = FALSE
                  AND id != COALESCE(NEW.id, -1);

                SELECT COALESCE(SUM(r.amount_paise), 0)::BIGINT INTO refunded_total
                FROM refunds r
                JOIN payments p ON p.id = r.payment_id
                WHERE p.treatment_plan_id = NEW.treatment_plan_id
                  AND p.is_reversed = FALSE
                  AND p.id != COALESCE(NEW.id, -1);

                IF (paid_total - refunded_total + NEW.amount_paise) > pkg_price THEN
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
                    IF EXISTS (SELECT 1 FROM refunds WHERE payment_id = OLD.id) THEN
                        RAISE EXCEPTION 'Cannot reverse a payment that already has refunds.';
                    END IF;

                    IF (
                        OLD.id IS DISTINCT FROM NEW.id OR
                        OLD.receipt_number IS DISTINCT FROM NEW.receipt_number OR
                        OLD.patient_id IS DISTINCT FROM NEW.patient_id OR
                        OLD.patient_name IS DISTINCT FROM NEW.patient_name OR
                        OLD.patient_urn IS DISTINCT FROM NEW.patient_urn OR
                        OLD.patient_mobile IS DISTINCT FROM NEW.patient_mobile OR
                        OLD.patient_address IS DISTINCT FROM NEW.patient_address OR
                        OLD.treatment_plan_id IS DISTINCT FROM NEW.treatment_plan_id OR
                        OLD.appointment_id IS DISTINCT FROM NEW.appointment_id OR
                        OLD.visit_id IS DISTINCT FROM NEW.visit_id OR
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

    # 4. Append-only ledger_entries table
    op.create_table(
        "ledger_entries",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column("patient_id", sa.BigInteger(), nullable=False),
        sa.Column("visit_id", sa.BigInteger(), nullable=True),
        sa.Column("entry_type", sa.String(length=24), nullable=False),
        sa.Column("direction", sa.String(length=8), nullable=False),
        sa.Column("amount_paise", sa.BigInteger(), nullable=False),
        sa.Column("signed_amount_paise", sa.BigInteger(), nullable=False),
        sa.Column("reference_type", sa.String(length=32), nullable=False),
        sa.Column("reference_id", sa.BigInteger(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("actor_user_id", sa.BigInteger(), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["patient_id"],
            ["patients.id"],
            name="fk_ledger_entries_patient_id_patients",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["visit_id", "patient_id"],
            ["visits.id", "visits.patient_id"],
            name="fk_ledger_entries_visit_patient",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["actor_user_id"],
            ["users.id"],
            name="fk_ledger_entries_actor_user_id_users",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "entry_type IN ("
            "'CHARGE', 'CHARGE_ADJUSTMENT', 'CHARGE_VOID', "
            "'PACKAGE_CHARGE', 'PACKAGE_ADJUSTMENT', 'LEGACY_CHARGE', "
            "'PAYMENT', 'PAYMENT_REVERSAL', 'REFUND')",
            name="entry_type_valid",
        ),
        sa.CheckConstraint("direction IN ('DEBIT', 'CREDIT')", name="direction_valid"),
        sa.CheckConstraint("amount_paise > 0", name="amount_positive"),
        sa.CheckConstraint(
            "(direction = 'DEBIT' AND signed_amount_paise = amount_paise) OR "
            "(direction = 'CREDIT' AND signed_amount_paise = -amount_paise)",
            name="signed_matches_direction",
        ),
        sa.CheckConstraint(
            "reference_type IN ("
            "'BILL_ITEM', 'BILL_ITEM_ADJUSTMENT', 'TREATMENT_PLAN', "
            "'APPOINTMENT', 'PAYMENT', 'REFUND')",
            name="reference_type_valid",
        ),
    )
    op.create_index(
        "uq_ledger_ref_event",
        "ledger_entries",
        ["reference_type", "reference_id", "entry_type"],
        unique=True,
        postgresql_where=sa.text("entry_type <> 'PACKAGE_ADJUSTMENT'"),
    )
    op.create_index(
        "ix_ledger_entries_patient_occurred",
        "ledger_entries",
        ["patient_id", sa.text("occurred_at DESC"), sa.text("id DESC")],
    )
    op.create_index("ix_ledger_entries_visit", "ledger_entries", ["visit_id"])

    # 5. Safe non-destructive historical backfill (BEFORE attaching trg_prevent_ledger_tampering)

    # 5a. Bill items -> CHARGE DEBIT (excluding 0-paise PACKAGE marker lines)
    op.execute(
        """
        INSERT INTO ledger_entries (
            patient_id, visit_id, entry_type, direction, amount_paise, signed_amount_paise,
            reference_type, reference_id, description, actor_user_id, occurred_at
        )
        SELECT
            bi.patient_id,
            bi.visit_id,
            'CHARGE',
            'DEBIT',
            CASE
                WHEN bi.original_amount_paise > 0 THEN bi.original_amount_paise
                ELSE bi.amount_paise
            END,
            CASE
                WHEN bi.original_amount_paise > 0 THEN bi.original_amount_paise
                ELSE bi.amount_paise
            END,
            'BILL_ITEM',
            bi.id,
            bi.description,
            bi.created_by_user_id,
            bi.created_at
        FROM bill_items bi
        WHERE bi.category <> 'PACKAGE'
          AND (
              bi.original_amount_paise > 0
              OR (
                  bi.amount_paise > 0
                  AND NOT EXISTS (
                      SELECT 1
                      FROM bill_item_adjustments a
                      WHERE a.bill_item_id = bi.id
                  )
              )
          )
        ON CONFLICT (reference_type, reference_id, entry_type)
        WHERE entry_type <> 'PACKAGE_ADJUSTMENT'
        DO NOTHING;
        """
    )

    # 5b. Bill item adjustments: VOID -> CHARGE_VOID CREDIT (old_amount_paise)
    op.execute(
        """
        INSERT INTO ledger_entries (
            patient_id, visit_id, entry_type, direction, amount_paise, signed_amount_paise,
            reference_type, reference_id, description, actor_user_id, occurred_at
        )
        SELECT
            bi.patient_id,
            bi.visit_id,
            'CHARGE_VOID',
            'CREDIT',
            adj.old_amount_paise,
            -adj.old_amount_paise,
            'BILL_ITEM_ADJUSTMENT',
            adj.id,
            'Void: ' || bi.description || ' (' || adj.reason || ')',
            adj.actor_user_id,
            adj.created_at
        FROM bill_item_adjustments adj
        JOIN bill_items bi ON bi.id = adj.bill_item_id
        WHERE adj.kind = 'VOID'
          AND adj.old_amount_paise > 0
        ON CONFLICT (reference_type, reference_id, entry_type)
        WHERE entry_type <> 'PACKAGE_ADJUSTMENT'
        DO NOTHING;
        """
    )

    # 5c. Bill item adjustments: DISCOUNT / WAIVER / CORRECTION -> CHARGE_ADJUSTMENT
    op.execute(
        """
        INSERT INTO ledger_entries (
            patient_id, visit_id, entry_type, direction, amount_paise, signed_amount_paise,
            reference_type, reference_id, description, actor_user_id, occurred_at
        )
        SELECT
            bi.patient_id,
            bi.visit_id,
            'CHARGE_ADJUSTMENT',
            CASE
                WHEN adj.new_amount_paise < adj.old_amount_paise THEN 'CREDIT'
                ELSE 'DEBIT'
            END,
            ABS(adj.new_amount_paise - adj.old_amount_paise),
            adj.new_amount_paise - adj.old_amount_paise,
            'BILL_ITEM_ADJUSTMENT',
            adj.id,
            adj.kind || ': ' || bi.description || ' (' || adj.reason || ')',
            adj.actor_user_id,
            adj.created_at
        FROM bill_item_adjustments adj
        JOIN bill_items bi ON bi.id = adj.bill_item_id
        WHERE adj.kind IN ('DISCOUNT', 'WAIVER', 'CORRECTION')
          AND adj.new_amount_paise <> adj.old_amount_paise
        ON CONFLICT (reference_type, reference_id, entry_type)
        WHERE entry_type <> 'PACKAGE_ADJUSTMENT'
        DO NOTHING;
        """
    )

    # 5d. Active bill items on CANCELLED appointments without a VOID adjustment -> CHARGE_VOID
    op.execute(
        """
        INSERT INTO ledger_entries (
            patient_id, visit_id, entry_type, direction, amount_paise, signed_amount_paise,
            reference_type, reference_id, description, actor_user_id, occurred_at
        )
        SELECT
            bi.patient_id,
            bi.visit_id,
            'CHARGE_VOID',
            'CREDIT',
            bi.amount_paise,
            -bi.amount_paise,
            'BILL_ITEM',
            bi.id,
            'Cancelled consultation: ' || bi.description,
            bi.created_by_user_id,
            COALESCE(a.updated_at, bi.created_at)
        FROM bill_items bi
        JOIN appointments a ON a.id = bi.appointment_id
        WHERE bi.status = 'ACTIVE'
          AND bi.category <> 'PACKAGE'
          AND bi.amount_paise > 0
          AND (a.consultation_status = 'CANCELLED' OR a.status = 'CANCELLED')
          AND NOT EXISTS (
              SELECT 1
              FROM bill_item_adjustments adj
              WHERE adj.bill_item_id = bi.id
                AND adj.kind = 'VOID'
          )
        ON CONFLICT (reference_type, reference_id, entry_type)
        WHERE entry_type <> 'PACKAGE_ADJUSTMENT'
        DO NOTHING;
        """
    )

    # 5e. Treatment plans -> PACKAGE_CHARGE DEBIT
    op.execute(
        """
        INSERT INTO ledger_entries (
            patient_id, visit_id, entry_type, direction, amount_paise, signed_amount_paise,
            reference_type, reference_id, description, actor_user_id, occurred_at
        )
        SELECT
            tp.patient_id,
            NULL,
            'PACKAGE_CHARGE',
            'DEBIT',
            tp.agreed_price_paise,
            tp.agreed_price_paise,
            'TREATMENT_PLAN',
            tp.id,
            'Treatment Package: ' || tp.plan_name,
            NULL,
            tp.created_at
        FROM treatment_plans tp
        WHERE tp.agreed_price_paise > 0
        ON CONFLICT (reference_type, reference_id, entry_type)
        WHERE entry_type <> 'PACKAGE_ADJUSTMENT'
        DO NOTHING;
        """
    )

    # 5f. Cancelled treatment plans -> PACKAGE_ADJUSTMENT CREDIT for uncollected balance
    op.execute(
        """
        INSERT INTO ledger_entries (
            patient_id, visit_id, entry_type, direction, amount_paise, signed_amount_paise,
            reference_type, reference_id, description, actor_user_id, occurred_at
        )
        SELECT
            tp.patient_id,
            NULL,
            'PACKAGE_ADJUSTMENT',
            'CREDIT',
            (tp.agreed_price_paise - COALESCE(paid.total_paid, 0))::BIGINT,
            -(tp.agreed_price_paise - COALESCE(paid.total_paid, 0))::BIGINT,
            'TREATMENT_PLAN',
            tp.id,
            'Package Cancelled: ' || tp.plan_name ||
                COALESCE(' (' || tp.cancellation_reason || ')', ''),
            NULL,
            tp.updated_at
        FROM treatment_plans tp
        LEFT JOIN (
            SELECT treatment_plan_id, SUM(amount_paise)::BIGINT AS total_paid
            FROM payments
            WHERE treatment_plan_id IS NOT NULL
              AND is_reversed = FALSE
            GROUP BY treatment_plan_id
        ) paid ON paid.treatment_plan_id = tp.id
        WHERE tp.status = 'CANCELLED'
          AND tp.agreed_price_paise > 0
          AND (tp.agreed_price_paise - COALESCE(paid.total_paid, 0)) > 0
          AND NOT EXISTS (
              SELECT 1
              FROM ledger_entries le
              WHERE le.reference_type = 'TREATMENT_PLAN'
                AND le.reference_id = tp.id
                AND le.entry_type = 'PACKAGE_ADJUSTMENT'
          );
        """
    )

    # 5g. Legacy standalone appointment payments -> LEGACY_CHARGE DEBIT (if no bill_item exists)
    op.execute(
        """
        INSERT INTO ledger_entries (
            patient_id, visit_id, entry_type, direction, amount_paise, signed_amount_paise,
            reference_type, reference_id, description, actor_user_id, occurred_at
        )
        SELECT
            p.patient_id,
            NULL,
            'LEGACY_CHARGE',
            'DEBIT',
            SUM(p.amount_paise)::BIGINT,
            SUM(p.amount_paise)::BIGINT,
            'APPOINTMENT',
            p.appointment_id,
            'Legacy consultation charge (pre-visit billing)',
            NULL,
            MIN(p.created_at)
        FROM payments p
        WHERE p.visit_id IS NULL
          AND p.treatment_plan_id IS NULL
          AND p.appointment_id IS NOT NULL
          AND p.is_reversed = FALSE
          AND NOT EXISTS (
              SELECT 1
              FROM bill_items bi
              WHERE bi.appointment_id = p.appointment_id
          )
        GROUP BY p.patient_id, p.appointment_id
        HAVING SUM(p.amount_paise) > 0
        ON CONFLICT (reference_type, reference_id, entry_type)
        WHERE entry_type <> 'PACKAGE_ADJUSTMENT'
        DO NOTHING;
        """
    )

    # 5h. Payments -> PAYMENT CREDIT at created_at
    op.execute(
        """
        INSERT INTO ledger_entries (
            patient_id, visit_id, entry_type, direction, amount_paise, signed_amount_paise,
            reference_type, reference_id, description, actor_user_id, occurred_at
        )
        SELECT
            p.patient_id,
            COALESCE(p.visit_id, a.visit_id),
            'PAYMENT',
            'CREDIT',
            p.amount_paise,
            -p.amount_paise,
            'PAYMENT',
            p.id,
            'Payment ' || p.receipt_number || ' (' || p.payment_method || ')',
            p.created_by_user_id,
            p.created_at
        FROM payments p
        LEFT JOIN appointments a
          ON a.id = p.appointment_id
         AND a.patient_id = p.patient_id
        ON CONFLICT (reference_type, reference_id, entry_type)
        WHERE entry_type <> 'PACKAGE_ADJUSTMENT'
        DO NOTHING;
        """
    )

    # 5i. Reversed payments -> PAYMENT_REVERSAL DEBIT at reversed_at
    op.execute(
        """
        INSERT INTO ledger_entries (
            patient_id, visit_id, entry_type, direction, amount_paise, signed_amount_paise,
            reference_type, reference_id, description, actor_user_id, occurred_at
        )
        SELECT
            p.patient_id,
            COALESCE(p.visit_id, a.visit_id),
            'PAYMENT_REVERSAL',
            'DEBIT',
            p.amount_paise,
            p.amount_paise,
            'PAYMENT',
            p.id,
            'Payment Reversal ' || p.receipt_number ||
                COALESCE(' (' || p.reversal_reason || ')', ''),
            p.reversed_by_user_id,
            COALESCE(p.reversed_at, p.created_at)
        FROM payments p
        LEFT JOIN appointments a
          ON a.id = p.appointment_id
         AND a.patient_id = p.patient_id
        WHERE p.is_reversed = TRUE
        ON CONFLICT (reference_type, reference_id, entry_type)
        WHERE entry_type <> 'PACKAGE_ADJUSTMENT'
        DO NOTHING;
        """
    )

    # 6. Attach immutable trigger blocking UPDATE, DELETE, and TRUNCATE on ledger_entries
    op.execute(
        """
        CREATE OR REPLACE FUNCTION fn_prevent_ledger_tampering()
        RETURNS TRIGGER AS $$
        BEGIN
            RAISE EXCEPTION
                'Ledger entries are permanently immutable (% is prohibited).',
                TG_OP;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_prevent_ledger_tampering
        BEFORE UPDATE OR DELETE OR TRUNCATE ON ledger_entries
        FOR EACH STATEMENT
        EXECUTE FUNCTION fn_prevent_ledger_tampering();
        """
    )

    # 7. Least-privilege runtime grants for kalyan_app (no UPDATE/DELETE on append-only tables)
    op.execute("GRANT SELECT, INSERT ON ledger_entries, refunds TO kalyan_app;")
    op.execute("GRANT SELECT, INSERT, UPDATE ON refund_sequences TO kalyan_app;")
    op.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kalyan_app;")


def downgrade() -> None:
    bind = op.get_bind()

    refund_rows = bind.execute(sa.text("SELECT count(*) FROM refunds")).scalar_one()
    if refund_rows:
        raise RuntimeError(
            f"Migration 0036 downgrade stopped: {refund_rows} refund row(s) exist. "
            "Financial refund records are not deleted. Nothing was changed."
        )

    ledger_rows = bind.execute(sa.text("SELECT count(*) FROM ledger_entries")).scalar_one()
    if ledger_rows:
        raise RuntimeError(
            f"Migration 0036 downgrade stopped: {ledger_rows} ledger_entries row(s) exist. "
            "Financial ledger records are not deleted. Nothing was changed."
        )

    large_payments = bind.execute(
        sa.text("SELECT count(*) FROM payments WHERE amount_paise > 2147483647")
    ).scalar_one()
    if large_payments:
        raise RuntimeError(
            f"Migration 0036 downgrade stopped: {large_payments} payment row(s) exceed "
            "32-bit INTEGER range. Nothing was changed."
        )

    op.execute("REVOKE SELECT, INSERT, UPDATE ON refund_sequences FROM kalyan_app;")
    op.execute("REVOKE SELECT, INSERT ON ledger_entries, refunds FROM kalyan_app;")

    op.execute("DROP TRIGGER IF EXISTS trg_prevent_ledger_tampering ON ledger_entries;")
    op.execute("DROP FUNCTION IF EXISTS fn_prevent_ledger_tampering();")

    op.drop_index("ix_ledger_entries_visit", table_name="ledger_entries")
    op.drop_index("ix_ledger_entries_patient_occurred", table_name="ledger_entries")
    op.drop_index("uq_ledger_ref_event", table_name="ledger_entries")
    op.drop_table("ledger_entries")

    # Restore 0017 payment tamper protection and 0005 package limit trigger before dropping refunds
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
                        OLD.patient_name IS DISTINCT FROM NEW.patient_name OR
                        OLD.patient_urn IS DISTINCT FROM NEW.patient_urn OR
                        OLD.patient_mobile IS DISTINCT FROM NEW.patient_mobile OR
                        OLD.patient_address IS DISTINCT FROM NEW.patient_address OR
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

    op.execute("DROP TRIGGER IF EXISTS trg_enforce_refund_limit ON refunds;")
    op.execute("DROP FUNCTION IF EXISTS fn_enforce_refund_limit();")
    op.execute("DROP TRIGGER IF EXISTS trg_prevent_refund_tampering ON refunds;")
    op.execute("DROP FUNCTION IF EXISTS fn_prevent_refund_tampering();")

    op.drop_index("ix_refunds_visit_id", table_name="refunds")
    op.drop_index("ix_refunds_patient_id", table_name="refunds")
    op.drop_index("ix_refunds_payment_id", table_name="refunds")
    op.drop_table("refunds")
    op.drop_table("refund_sequences")

    op.drop_constraint("uq_payments_id_patient", "payments", type_="unique")
    op.alter_column(
        "payments",
        "amount_paise",
        existing_type=sa.BigInteger(),
        type_=sa.Integer(),
        existing_nullable=False,
    )
