"""Clinical records completeness: conditions, structured diagnoses, investigations, Rx versioning.

Revision ID: 0035
Revises: 0034
Create Date: 2026-11-18

Milestone 2 (T2.1):
- Create `patient_conditions` (longitudinal problem list with doctor_id scope).
- Create `encounter_diagnoses` with composite FK to `clinical_encounters(id, patient_id)`,
  PG15+ composite FK `(patient_condition_id, patient_id) -> patient_conditions(id, patient_id)`
  (`ON DELETE SET NULL (patient_condition_id)`), and finalised-encounter tamper trigger.
- Create `investigation_orders` and `investigation_results` with composite same-patient FKs.
- Add prescription versioning columns (`revision_number`, `supersedes_prescription_id`,
  `amendment_reason`), extend `prescriptions.status` CHECK with `SUPERSEDED`, and add
  immutability triggers on `prescriptions` and `prescription_items`.
- Grant least-privilege runtime access to `kalyan_app` and enforce fail-closed `downgrade()`.

Naming: env.py's naming convention prefixes `ck_<table>_` on every CheckConstraint name in both
create and drop calls. Pass bare names (`"status_valid"`, `"type_valid"`, etc.).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0035"
down_revision: str | None = "0034"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()

    # ON DELETE SET NULL (patient_condition_id) requires PostgreSQL 15 or newer.
    version_num = int(bind.execute(sa.text("SHOW server_version_num")).scalar_one())
    if version_num < 150000:
        raise RuntimeError(
            "Migration 0035 needs PostgreSQL 15 or newer "
            f"(server_version_num={version_num}). No change was made."
        )

    # 1. Longitudinal problem list: patient_conditions
    op.create_table(
        "patient_conditions",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column("patient_id", sa.BigInteger(), nullable=False),
        sa.Column("doctor_id", sa.BigInteger(), nullable=False),
        sa.Column("condition_name", sa.String(length=200), nullable=False),
        sa.Column("icd10_code", sa.String(length=16), nullable=True),
        sa.Column(
            "status",
            sa.String(length=16),
            server_default=sa.text("'ACTIVE'"),
            nullable=False,
        ),
        sa.Column("onset_date", sa.Date(), nullable=True),
        sa.Column("resolved_date", sa.Date(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "version_id",
            sa.Integer(),
            server_default=sa.text("1"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["patient_id"],
            ["patients.id"],
            name="fk_patient_conditions_patient_id_patients",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["doctor_id"],
            ["doctors.id"],
            name="fk_patient_conditions_doctor_id_doctors",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("id", "patient_id", name="uq_patient_conditions_id_patient"),
        sa.CheckConstraint(
            "status IN ('ACTIVE', 'RESOLVED', 'INACTIVE')",
            name="status_valid",
        ),
    )
    op.create_index(
        "ix_patient_conditions_patient_status",
        "patient_conditions",
        ["patient_id", "status"],
    )

    # 2. Structured per-encounter diagnoses: encounter_diagnoses
    op.create_table(
        "encounter_diagnoses",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column("encounter_id", sa.BigInteger(), nullable=False),
        sa.Column("patient_id", sa.BigInteger(), nullable=False),
        sa.Column("doctor_id", sa.BigInteger(), nullable=False),
        sa.Column("diagnosis_name", sa.String(length=200), nullable=False),
        sa.Column("icd10_code", sa.String(length=16), nullable=True),
        sa.Column(
            "diagnosis_type",
            sa.String(length=16),
            server_default=sa.text("'PRIMARY'"),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.String(length=16),
            server_default=sa.text("'ACTIVE'"),
            nullable=False,
        ),
        sa.Column("onset_date", sa.Date(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("patient_condition_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["encounter_id", "patient_id"],
            ["clinical_encounters.id", "clinical_encounters.patient_id"],
            name="fk_encounter_diagnoses_encounter_patient",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["doctor_id"],
            ["doctors.id"],
            name="fk_encounter_diagnoses_doctor_id_doctors",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "diagnosis_type IN ('PRIMARY', 'SECONDARY', 'PROVISIONAL')",
            name="type_valid",
        ),
        sa.CheckConstraint(
            "status IN ('ACTIVE', 'RESOLVED', 'INACTIVE')",
            name="status_valid",
        ),
    )
    op.execute(
        """
        ALTER TABLE encounter_diagnoses
            ADD CONSTRAINT fk_encounter_diagnoses_condition_patient
            FOREIGN KEY (patient_condition_id, patient_id)
            REFERENCES patient_conditions (id, patient_id)
            ON DELETE SET NULL (patient_condition_id);
        """
    )
    op.create_index("ix_encounter_diagnoses_encounter_id", "encounter_diagnoses", ["encounter_id"])
    op.create_index("ix_encounter_diagnoses_patient_id", "encounter_diagnoses", ["patient_id"])
    op.create_index(
        "ix_encounter_diagnoses_condition_id",
        "encounter_diagnoses",
        ["patient_condition_id"],
    )

    op.execute(
        """
        CREATE OR REPLACE FUNCTION fn_prevent_finalised_encounter_diagnosis_tampering()
        RETURNS TRIGGER AS $$
        DECLARE
            old_finalised BOOLEAN;
            new_finalised BOOLEAN;
        BEGIN
            IF TG_OP = 'DELETE' THEN
                SELECT is_finalised INTO old_finalised
                FROM clinical_encounters
                WHERE id = OLD.encounter_id;

                IF old_finalised = TRUE THEN
                    RAISE EXCEPTION
                        'Cannot delete encounter_diagnoses for a finalised clinical encounter.';
                END IF;
                RETURN OLD;
            ELSIF TG_OP = 'UPDATE' THEN
                SELECT is_finalised INTO old_finalised
                FROM clinical_encounters
                WHERE id = OLD.encounter_id;

                IF old_finalised = TRUE THEN
                    RAISE EXCEPTION
                        'Cannot modify encounter_diagnoses for a finalised clinical encounter.';
                END IF;

                IF NEW.encounter_id IS DISTINCT FROM OLD.encounter_id THEN
                    SELECT is_finalised INTO new_finalised
                    FROM clinical_encounters
                    WHERE id = NEW.encounter_id;

                    IF new_finalised = TRUE THEN
                        RAISE EXCEPTION
                            'Cannot modify encounter_diagnoses for a finalised clinical encounter.';
                    END IF;
                END IF;
                RETURN NEW;
            ELSE
                SELECT is_finalised INTO new_finalised
                FROM clinical_encounters
                WHERE id = NEW.encounter_id;

                IF new_finalised = TRUE THEN
                    RAISE EXCEPTION
                        'Cannot insert encounter_diagnoses for a finalised clinical encounter.';
                END IF;
                RETURN NEW;
            END IF;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_prevent_finalised_encounter_diagnosis_tampering
        BEFORE INSERT OR UPDATE OR DELETE ON encounter_diagnoses
        FOR EACH ROW
        EXECUTE FUNCTION fn_prevent_finalised_encounter_diagnosis_tampering();
        """
    )

    # 3. Investigation orders & results
    op.create_table(
        "investigation_orders",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column("encounter_id", sa.BigInteger(), nullable=False),
        sa.Column("patient_id", sa.BigInteger(), nullable=False),
        sa.Column("doctor_id", sa.BigInteger(), nullable=False),
        sa.Column("category", sa.String(length=24), nullable=False),
        sa.Column("test_name", sa.String(length=200), nullable=False),
        sa.Column("instructions", sa.Text(), nullable=True),
        sa.Column(
            "priority",
            sa.String(length=16),
            server_default=sa.text("'ROUTINE'"),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.String(length=24),
            server_default=sa.text("'ORDERED'"),
            nullable=False,
        ),
        sa.Column("cancelled_reason", sa.Text(), nullable=True),
        sa.Column(
            "ordered_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "version_id",
            sa.Integer(),
            server_default=sa.text("1"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["encounter_id", "patient_id"],
            ["clinical_encounters.id", "clinical_encounters.patient_id"],
            name="fk_investigation_orders_encounter_patient",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["doctor_id"],
            ["doctors.id"],
            name="fk_investigation_orders_doctor_id_doctors",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("id", "patient_id", name="uq_investigation_orders_id_patient"),
        sa.CheckConstraint(
            "category IN ('LAB', 'IMAGING', 'PATHOLOGY', 'DIAGNOSTIC', 'OTHER')",
            name="category_valid",
        ),
        sa.CheckConstraint(
            "priority IN ('ROUTINE', 'URGENT')",
            name="priority_valid",
        ),
        sa.CheckConstraint(
            "status IN ('ORDERED', 'SAMPLE_COLLECTED', 'COMPLETED', 'CANCELLED')",
            name="status_valid",
        ),
        sa.CheckConstraint(
            "(status = 'CANCELLED' AND length(trim(coalesce(cancelled_reason, ''))) >= 3) "
            "OR status <> 'CANCELLED'",
            name="cancel_reason_required",
        ),
    )
    op.create_index(
        "ix_investigation_orders_encounter_id",
        "investigation_orders",
        ["encounter_id"],
    )
    op.create_index(
        "ix_investigation_orders_patient_status",
        "investigation_orders",
        ["patient_id", "status"],
    )

    op.create_table(
        "investigation_results",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column("order_id", sa.BigInteger(), nullable=False),
        sa.Column("patient_id", sa.BigInteger(), nullable=False),
        sa.Column("summary_text", sa.Text(), nullable=False),
        sa.Column("result_value", sa.String(length=120), nullable=True),
        sa.Column("unit", sa.String(length=40), nullable=True),
        sa.Column("reference_range", sa.String(length=120), nullable=True),
        sa.Column(
            "is_abnormal",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column(
            "reported_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("recorded_by_user_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["order_id", "patient_id"],
            ["investigation_orders.id", "investigation_orders.patient_id"],
            name="fk_investigation_results_order_patient",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["recorded_by_user_id"],
            ["users.id"],
            name="fk_investigation_results_recorded_by_user_id_users",
            ondelete="RESTRICT",
        ),
    )
    op.create_index(
        "ix_investigation_results_order_id",
        "investigation_results",
        ["order_id"],
    )
    op.create_index(
        "ix_investigation_results_patient_id",
        "investigation_results",
        ["patient_id"],
    )

    # 4. Prescription versioning & medico-legal tamper protection
    op.add_column(
        "prescriptions",
        sa.Column(
            "revision_number",
            sa.Integer(),
            server_default=sa.text("1"),
            nullable=False,
        ),
    )
    op.add_column(
        "prescriptions",
        sa.Column("supersedes_prescription_id", sa.BigInteger(), nullable=True),
    )
    op.add_column(
        "prescriptions",
        sa.Column("amendment_reason", sa.Text(), nullable=True),
    )
    op.create_check_constraint(
        "revision_positive",
        "prescriptions",
        "revision_number >= 1",
    )
    op.create_foreign_key(
        "fk_prescriptions_supersedes_prescription_id_prescriptions",
        "prescriptions",
        "prescriptions",
        ["supersedes_prescription_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index(
        "uq_prescriptions_supersedes",
        "prescriptions",
        ["supersedes_prescription_id"],
        unique=True,
        postgresql_where=sa.text("supersedes_prescription_id IS NOT NULL"),
    )

    # Drop legacy status CHECK safely (0013 double-prefixed name or bare name)
    op.execute("ALTER TABLE prescriptions DROP CONSTRAINT IF EXISTS ck_prescriptions_status;")
    op.execute(
        "ALTER TABLE prescriptions "
        "DROP CONSTRAINT IF EXISTS ck_prescriptions_ck_prescriptions_status;"
    )
    op.create_check_constraint(
        "status",
        "prescriptions",
        "status IN ('DRAFT', 'AUTHORISED', 'SUPERSEDED', 'CANCELLED')",
    )

    op.execute(
        """
        CREATE OR REPLACE FUNCTION fn_prevent_authorised_prescription_tampering()
        RETURNS TRIGGER AS $$
        BEGIN
            IF TG_OP = 'DELETE' THEN
                IF OLD.status IN ('AUTHORISED', 'SUPERSEDED', 'CANCELLED') THEN
                    RAISE EXCEPTION
                        'Prescription with status % cannot be deleted.',
                        OLD.status;
                END IF;
                RETURN OLD;
            ELSIF TG_OP = 'UPDATE' THEN
                IF OLD.status IN ('SUPERSEDED', 'CANCELLED') THEN
                    RAISE EXCEPTION
                        'Prescription with status % is permanently immutable.',
                        OLD.status;
                END IF;

                IF OLD.status = 'AUTHORISED' THEN
                    IF NEW.status NOT IN ('CANCELLED', 'SUPERSEDED') THEN
                        RAISE EXCEPTION
                            'Authorised prescription cannot be modified. Amend or cancel instead.';
                    END IF;

                    IF (
                        OLD.id IS DISTINCT FROM NEW.id OR
                        OLD.patient_id IS DISTINCT FROM NEW.patient_id OR
                        OLD.patient_name IS DISTINCT FROM NEW.patient_name OR
                        OLD.patient_urn IS DISTINCT FROM NEW.patient_urn OR
                        OLD.patient_mobile IS DISTINCT FROM NEW.patient_mobile OR
                        OLD.patient_address IS DISTINCT FROM NEW.patient_address OR
                        OLD.doctor_id IS DISTINCT FROM NEW.doctor_id OR
                        OLD.encounter_id IS DISTINCT FROM NEW.encounter_id OR
                        OLD.diagnosis IS DISTINCT FROM NEW.diagnosis OR
                        OLD.dietary_advice IS DISTINCT FROM NEW.dietary_advice OR
                        OLD.general_advice IS DISTINCT FROM NEW.general_advice OR
                        OLD.follow_up_date IS DISTINCT FROM NEW.follow_up_date OR
                        OLD.authorised_at IS DISTINCT FROM NEW.authorised_at OR
                        OLD.revision_number IS DISTINCT FROM NEW.revision_number OR
                        OLD.supersedes_prescription_id
                            IS DISTINCT FROM NEW.supersedes_prescription_id OR
                        OLD.amendment_reason IS DISTINCT FROM NEW.amendment_reason OR
                        OLD.created_at IS DISTINCT FROM NEW.created_at
                    ) THEN
                        RAISE EXCEPTION
                            'Core fields of an authorised prescription cannot be modified.';
                    END IF;

                    IF NEW.status = 'SUPERSEDED' AND (
                        OLD.cancelled_at IS DISTINCT FROM NEW.cancelled_at OR
                        OLD.cancelled_by_user_id IS DISTINCT FROM NEW.cancelled_by_user_id OR
                        OLD.cancellation_reason IS DISTINCT FROM NEW.cancellation_reason
                    ) THEN
                        RAISE EXCEPTION
                            'Only status, updated_at, and version_id may change when superseding '
                            'a prescription.';
                    END IF;
                END IF;
                RETURN NEW;
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_prevent_authorised_prescription_tampering
        BEFORE UPDATE OR DELETE ON prescriptions
        FOR EACH ROW
        EXECUTE FUNCTION fn_prevent_authorised_prescription_tampering();
        """
    )

    op.execute(
        """
        CREATE OR REPLACE FUNCTION fn_prevent_authorised_prescription_item_tampering()
        RETURNS TRIGGER AS $$
        DECLARE
            old_status VARCHAR(16);
            new_status VARCHAR(16);
        BEGIN
            IF TG_OP = 'DELETE' THEN
                SELECT status INTO old_status
                FROM prescriptions
                WHERE id = OLD.prescription_id;

                -- NULL occurs only during ON DELETE CASCADE of an already-removed DRAFT parent.
                IF old_status IS NOT NULL AND old_status <> 'DRAFT' THEN
                    RAISE EXCEPTION
                        'Cannot delete prescription items for a % prescription.',
                        old_status;
                END IF;
                RETURN OLD;
            ELSIF TG_OP = 'UPDATE' THEN
                SELECT status INTO old_status
                FROM prescriptions
                WHERE id = OLD.prescription_id;

                IF old_status IS DISTINCT FROM 'DRAFT' THEN
                    RAISE EXCEPTION
                        'Cannot modify prescription items for a % prescription.',
                        COALESCE(old_status, 'missing');
                END IF;

                IF NEW.prescription_id IS DISTINCT FROM OLD.prescription_id THEN
                    SELECT status INTO new_status
                    FROM prescriptions
                    WHERE id = NEW.prescription_id;

                    IF new_status IS DISTINCT FROM 'DRAFT' THEN
                        RAISE EXCEPTION
                            'Cannot move prescription items to a % prescription.',
                            COALESCE(new_status, 'missing');
                    END IF;
                END IF;
                RETURN NEW;
            ELSE
                SELECT status INTO new_status
                FROM prescriptions
                WHERE id = NEW.prescription_id;

                IF new_status IS DISTINCT FROM 'DRAFT' THEN
                    RAISE EXCEPTION
                        'Cannot insert prescription items for a % prescription.',
                        COALESCE(new_status, 'missing');
                END IF;
                RETURN NEW;
            END IF;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_prevent_authorised_prescription_item_tampering
        BEFORE INSERT OR UPDATE OR DELETE ON prescription_items
        FOR EACH ROW
        EXECUTE FUNCTION fn_prevent_authorised_prescription_item_tampering();
        """
    )

    # 5. Least-privilege runtime grants for kalyan_app
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON encounter_diagnoses TO kalyan_app;")
    op.execute(
        "GRANT SELECT, INSERT, UPDATE ON patient_conditions, investigation_orders TO kalyan_app;"
    )
    op.execute("GRANT SELECT, INSERT ON investigation_results TO kalyan_app;")
    op.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kalyan_app;")


def downgrade() -> None:
    bind = op.get_bind()

    condition_rows = bind.execute(sa.text("SELECT count(*) FROM patient_conditions")).scalar_one()
    if condition_rows:
        raise RuntimeError(
            f"Migration 0035 downgrade stopped: {condition_rows} patient_conditions row(s) exist. "
            "Clinical condition records are not deleted. Nothing was changed."
        )

    diagnosis_rows = bind.execute(sa.text("SELECT count(*) FROM encounter_diagnoses")).scalar_one()
    if diagnosis_rows:
        raise RuntimeError(
            f"Migration 0035 downgrade stopped: {diagnosis_rows} encounter_diagnoses row(s) exist. "
            "Clinical diagnosis records are not deleted. Nothing was changed."
        )

    order_rows = bind.execute(sa.text("SELECT count(*) FROM investigation_orders")).scalar_one()
    if order_rows:
        raise RuntimeError(
            f"Migration 0035 downgrade stopped: {order_rows} investigation_orders row(s) exist. "
            "Clinical investigation order records are not deleted. Nothing was changed."
        )

    result_rows = bind.execute(sa.text("SELECT count(*) FROM investigation_results")).scalar_one()
    if result_rows:
        raise RuntimeError(
            f"Migration 0035 downgrade stopped: {result_rows} investigation_results row(s) exist. "
            "Clinical investigation result records are not deleted. Nothing was changed."
        )

    amended_rx_rows = bind.execute(
        sa.text(
            "SELECT count(*) FROM prescriptions "
            "WHERE status = 'SUPERSEDED' OR revision_number > 1 "
            "OR supersedes_prescription_id IS NOT NULL OR amendment_reason IS NOT NULL"
        )
    ).scalar_one()
    if amended_rx_rows:
        raise RuntimeError(
            f"Migration 0035 downgrade stopped: {amended_rx_rows} prescription row(s) hold "
            "versioning/amendment metadata that would be lost. Nothing was changed."
        )

    op.execute("REVOKE SELECT, INSERT ON investigation_results FROM kalyan_app;")
    op.execute(
        "REVOKE SELECT, INSERT, UPDATE ON patient_conditions, investigation_orders FROM kalyan_app;"
    )
    op.execute("REVOKE SELECT, INSERT, UPDATE, DELETE ON encounter_diagnoses FROM kalyan_app;")

    op.execute(
        "DROP TRIGGER IF EXISTS trg_prevent_authorised_prescription_item_tampering "
        "ON prescription_items;"
    )
    op.execute("DROP FUNCTION IF EXISTS fn_prevent_authorised_prescription_item_tampering();")
    op.execute(
        "DROP TRIGGER IF EXISTS trg_prevent_authorised_prescription_tampering ON prescriptions;"
    )
    op.execute("DROP FUNCTION IF EXISTS fn_prevent_authorised_prescription_tampering();")

    op.execute("ALTER TABLE prescriptions DROP CONSTRAINT IF EXISTS ck_prescriptions_status;")
    op.execute(
        "ALTER TABLE prescriptions "
        "DROP CONSTRAINT IF EXISTS ck_prescriptions_ck_prescriptions_status;"
    )
    op.create_check_constraint(
        "ck_prescriptions_status",
        "prescriptions",
        "status IN ('DRAFT', 'AUTHORISED', 'CANCELLED')",
    )

    op.drop_index("uq_prescriptions_supersedes", table_name="prescriptions")
    op.drop_constraint(
        "fk_prescriptions_supersedes_prescription_id_prescriptions",
        "prescriptions",
        type_="foreignkey",
    )
    op.drop_constraint("revision_positive", "prescriptions", type_="check")
    op.drop_column("prescriptions", "amendment_reason")
    op.drop_column("prescriptions", "supersedes_prescription_id")
    op.drop_column("prescriptions", "revision_number")

    op.drop_index("ix_investigation_results_patient_id", table_name="investigation_results")
    op.drop_index("ix_investigation_results_order_id", table_name="investigation_results")
    op.drop_table("investigation_results")

    op.drop_index("ix_investigation_orders_patient_status", table_name="investigation_orders")
    op.drop_index("ix_investigation_orders_encounter_id", table_name="investigation_orders")
    op.drop_table("investigation_orders")

    op.execute(
        "DROP TRIGGER IF EXISTS trg_prevent_finalised_encounter_diagnosis_tampering "
        "ON encounter_diagnoses;"
    )
    op.execute("DROP FUNCTION IF EXISTS fn_prevent_finalised_encounter_diagnosis_tampering();")

    op.drop_index("ix_encounter_diagnoses_condition_id", table_name="encounter_diagnoses")
    op.drop_index("ix_encounter_diagnoses_patient_id", table_name="encounter_diagnoses")
    op.drop_index("ix_encounter_diagnoses_encounter_id", table_name="encounter_diagnoses")
    op.drop_table("encounter_diagnoses")

    op.drop_index("ix_patient_conditions_patient_status", table_name="patient_conditions")
    op.drop_table("patient_conditions")
