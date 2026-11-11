"""Patient print snapshots, legacy URN, and payment tamper protection update.

Revision ID: 0017
Revises: 0016
Create Date: 2026-11-08

Requirements:
- AUD-01: Permanent audit and demographic snapshot isolation.
- BIL-04: Historical document reprint retains issued details.
- D-20-05: Patient name, URN, mobile, and address printed on issued documents.
- D-20-06: Issued documents store patient demographic snapshots at issue.
- D-20-07: Migration backfills snapshot values from current patients under trigger bypass.
- D-20-09: Legacy hospital numbers kept in legacy_urn column with index.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0017"
down_revision: str | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. Add legacy_urn to patients
    op.add_column("patients", sa.Column("legacy_urn", sa.String(length=64), nullable=True))
    op.create_index("ix_patients_legacy_urn", "patients", ["legacy_urn"])

    # 2. Add print snapshot columns to payments
    op.add_column("payments", sa.Column("patient_name", sa.String(length=120), nullable=True))
    op.add_column("payments", sa.Column("patient_urn", sa.String(length=32), nullable=True))
    op.add_column("payments", sa.Column("patient_mobile", sa.String(length=15), nullable=True))
    op.add_column("payments", sa.Column("patient_address", sa.Text(), nullable=True))

    # 3. Add print snapshot columns to prescriptions
    op.add_column("prescriptions", sa.Column("patient_name", sa.String(length=120), nullable=True))
    op.add_column("prescriptions", sa.Column("patient_urn", sa.String(length=32), nullable=True))
    op.add_column("prescriptions", sa.Column("patient_mobile", sa.String(length=15), nullable=True))
    op.add_column("prescriptions", sa.Column("patient_address", sa.Text(), nullable=True))

    # 4. Add print snapshot columns to clinical_encounters
    op.add_column(
        "clinical_encounters", sa.Column("patient_name", sa.String(length=120), nullable=True)
    )
    op.add_column(
        "clinical_encounters", sa.Column("patient_urn", sa.String(length=32), nullable=True)
    )
    op.add_column(
        "clinical_encounters", sa.Column("patient_mobile", sa.String(length=15), nullable=True)
    )
    op.add_column("clinical_encounters", sa.Column("patient_address", sa.Text(), nullable=True))

    # 5. Backfill procedure with trigger protection update
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"

    if is_postgres:
        op.execute("ALTER TABLE payments DISABLE TRIGGER trg_prevent_payment_tampering;")
        op.execute("""
            UPDATE payments p
            SET patient_name = pt.full_name,
                patient_urn = pt.urn,
                patient_mobile = pt.mobile,
                patient_address = pt.address
            FROM patients pt
            WHERE p.patient_id = pt.id;
        """)
        op.execute("""
            UPDATE prescriptions pr
            SET patient_name = pt.full_name,
                patient_urn = pt.urn,
                patient_mobile = pt.mobile,
                patient_address = pt.address
            FROM patients pt
            WHERE pr.patient_id = pt.id;
        """)
        op.execute("""
            UPDATE clinical_encounters ce
            SET patient_name = pt.full_name,
                patient_urn = pt.urn,
                patient_mobile = pt.mobile,
                patient_address = pt.address
            FROM patients pt
            WHERE ce.patient_id = pt.id;
        """)
        op.execute("""
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
        """)
        op.execute("ALTER TABLE payments ENABLE TRIGGER trg_prevent_payment_tampering;")
    else:
        op.execute("""
            UPDATE payments
            SET patient_name = (SELECT full_name FROM patients
                WHERE patients.id = payments.patient_id),
                patient_urn = (SELECT urn FROM patients WHERE patients.id = payments.patient_id),
                patient_mobile = (SELECT mobile FROM patients
                    WHERE patients.id = payments.patient_id),
                patient_address = (SELECT address FROM patients
                    WHERE patients.id = payments.patient_id);
        """)
        op.execute("""
            UPDATE prescriptions
            SET patient_name = (SELECT full_name FROM patients
                WHERE patients.id = prescriptions.patient_id),
                patient_urn = (SELECT urn FROM patients
                    WHERE patients.id = prescriptions.patient_id),
                patient_mobile = (SELECT mobile FROM patients
                    WHERE patients.id = prescriptions.patient_id),
                patient_address = (SELECT address FROM patients
                    WHERE patients.id = prescriptions.patient_id);
        """)
        op.execute("""
            UPDATE clinical_encounters
            SET patient_name = (SELECT full_name FROM patients
                WHERE patients.id = clinical_encounters.patient_id),
                patient_urn = (SELECT urn FROM patients
                    WHERE patients.id = clinical_encounters.patient_id),
                patient_mobile = (SELECT mobile FROM patients
                    WHERE patients.id = clinical_encounters.patient_id),
                patient_address = (SELECT address FROM patients
                    WHERE patients.id = clinical_encounters.patient_id);
        """)


def downgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"

    if is_postgres:
        op.execute("""
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
        """)

    op.drop_column("clinical_encounters", "patient_address")
    op.drop_column("clinical_encounters", "patient_mobile")
    op.drop_column("clinical_encounters", "patient_urn")
    op.drop_column("clinical_encounters", "patient_name")

    op.drop_column("prescriptions", "patient_address")
    op.drop_column("prescriptions", "patient_mobile")
    op.drop_column("prescriptions", "patient_urn")
    op.drop_column("prescriptions", "patient_name")

    op.drop_column("payments", "patient_address")
    op.drop_column("payments", "patient_mobile")
    op.drop_column("payments", "patient_urn")
    op.drop_column("payments", "patient_name")

    op.drop_index("ix_patients_legacy_urn", table_name="patients")
    op.drop_column("patients", "legacy_urn")
