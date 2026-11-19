"""Patient master extensions, structured allergies, visit/encounter codes, and encounter visit link.

Revision ID: 0034
Revises: 0033
Create Date: 2026-11-18

Milestone 1 (T1.1):
- Extend `patients` with 6 optional demographic/history columns + blood_group CHECK constraint.
- Create `patient_allergies` with non-destructive one-time seed from non-default
  `patients.allergies`.
- Create `visit_sequences` & `encounter_sequences` and add `visits.visit_code` (`VIS-YY-NNNNNN`)
  and `clinical_encounters.encounter_code` (`ENC-YY-NNNNNN`) with deterministic backfill and
  BEFORE INSERT auto-allocation fallback triggers.
- Add nullable `clinical_encounters.visit_id`, backfill strictly where
  `appointments.visit_id IS NOT NULL` (never fabricating visits for pre-0025 rows), add PG15+
  composite FK `fk_clinical_encounters_visit_patient` (`ON DELETE SET NULL (visit_id)`), and lock
  `encounter_code` and `visit_id` inside `fn_prevent_finalised_encounter_tampering()`.
- Normalize `appointments.status` casing/whitespace and enforce bare CHECK `"status_valid"`.
- Grant least-privilege runtime access to `kalyan_app` and enforce fail-closed `downgrade()`.

Naming: env.py's naming convention prefixes `ck_<table>_` on every CheckConstraint name in both
create and drop calls. Pass bare names (`"blood_group_valid"`, `"status_valid"`, etc.).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0034"
down_revision: str | None = "0033"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

APPOINTMENT_STATUS_VALUES: tuple[str, ...] = (
    "BOOKED",
    "ARRIVED",
    "IN_CONSULTATION",
    "DONE",
    "CANCELLED",
    "NO_SHOW",
    "RESCHEDULED",
    "TO_ARRIVE",
    "REGISTERED",
    "CHECKED_IN",
    "WAITING",
    "COMPLETED",
)


def upgrade() -> None:
    bind = op.get_bind()

    # ON DELETE SET NULL (visit_id) requires PostgreSQL 15 or newer.
    version_num = int(bind.execute(sa.text("SHOW server_version_num")).scalar_one())
    if version_num < 150000:
        raise RuntimeError(
            "Migration 0034 needs PostgreSQL 15 or newer "
            f"(server_version_num={version_num}). No change was made."
        )

    # 1. Extend patients with 6 optional demographic/history columns
    op.add_column("patients", sa.Column("alternate_mobile", sa.String(length=15), nullable=True))
    op.add_column("patients", sa.Column("email", sa.String(length=120), nullable=True))
    op.add_column("patients", sa.Column("blood_group", sa.String(length=8), nullable=True))
    op.add_column("patients", sa.Column("pin_code", sa.String(length=10), nullable=True))
    op.add_column(
        "patients", sa.Column("guardian_relationship", sa.String(length=40), nullable=True)
    )
    op.add_column("patients", sa.Column("medical_history_notes", sa.Text(), nullable=True))
    op.create_check_constraint(
        "blood_group_valid",
        "patients",
        "blood_group IS NULL OR blood_group IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')",
    )

    # 2. Create patient_allergies + non-destructive one-time seed from patients.allergies
    op.create_table(
        "patient_allergies",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column("patient_id", sa.BigInteger(), nullable=False),
        sa.Column("substance", sa.String(length=160), nullable=False),
        sa.Column(
            "category",
            sa.String(length=24),
            server_default=sa.text("'DRUG'"),
            nullable=False,
        ),
        sa.Column(
            "severity",
            sa.String(length=24),
            server_default=sa.text("'MODERATE'"),
            nullable=False,
        ),
        sa.Column("reaction", sa.Text(), nullable=True),
        sa.Column("clinical_notes", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.String(length=16),
            server_default=sa.text("'ACTIVE'"),
            nullable=False,
        ),
        sa.Column("doctor_id", sa.BigInteger(), nullable=True),
        sa.Column("recorded_by_user_id", sa.BigInteger(), nullable=True),
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
            name="fk_patient_allergies_patient_id_patients",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["doctor_id"],
            ["doctors.id"],
            name="fk_patient_allergies_doctor_id_doctors",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["recorded_by_user_id"],
            ["users.id"],
            name="fk_patient_allergies_recorded_by_user_id_users",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "category IN ('DRUG', 'FOOD', 'ENVIRONMENTAL', 'OTHER')",
            name="category_valid",
        ),
        sa.CheckConstraint(
            "severity IN ('MILD', 'MODERATE', 'SEVERE', 'LIFE_THREATENING')",
            name="severity_valid",
        ),
        sa.CheckConstraint(
            "status IN ('ACTIVE', 'INACTIVE', 'RESOLVED')",
            name="status_valid",
        ),
    )
    op.create_index(
        "ix_patient_allergies_patient_status",
        "patient_allergies",
        ["patient_id", "status"],
    )

    op.execute(
        """
        INSERT INTO patient_allergies (
            patient_id,
            substance,
            category,
            severity,
            clinical_notes,
            status
        )
        SELECT
            p.id,
            LEFT(btrim(p.allergies), 160),
            'OTHER',
            'MODERATE',
            CASE WHEN length(btrim(p.allergies)) > 160 THEN btrim(p.allergies) ELSE NULL END,
            'ACTIVE'
        FROM patients p
        WHERE p.allergies IS NOT NULL
          AND lower(btrim(p.allergies)) NOT IN (
              '', 'none', 'none reported', 'nil', 'nkda', 'n/a', 'no known allergies'
          );
        """
    )

    # 3. Sequence tables + visits.visit_code + clinical_encounters.encounter_code & visit_id
    op.create_table(
        "visit_sequences",
        sa.Column("year", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("last_number", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )
    op.create_table(
        "encounter_sequences",
        sa.Column("year", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("last_number", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )

    # 3a. visits.visit_code
    op.add_column("visits", sa.Column("visit_code", sa.String(length=16), nullable=True))
    op.execute(
        """
        WITH ranked AS (
            SELECT
                id,
                EXTRACT(YEAR FROM visit_date)::INTEGER AS yr,
                ROW_NUMBER() OVER (
                    PARTITION BY EXTRACT(YEAR FROM visit_date)::INTEGER
                    ORDER BY id
                ) AS seq_num
            FROM visits
        )
        UPDATE visits v
        SET visit_code = 'VIS-' || lpad((r.yr % 100)::TEXT, 2, '0') || '-' ||
            lpad(r.seq_num::TEXT, GREATEST(6, length(r.seq_num::TEXT)), '0')
        FROM ranked r
        WHERE v.id = r.id;
        """
    )
    op.execute(
        """
        INSERT INTO visit_sequences (year, last_number)
        SELECT
            EXTRACT(YEAR FROM visit_date)::INTEGER AS yr,
            COUNT(*)::INTEGER AS max_num
        FROM visits
        GROUP BY EXTRACT(YEAR FROM visit_date)::INTEGER
        ON CONFLICT (year) DO UPDATE
        SET last_number = GREATEST(visit_sequences.last_number, EXCLUDED.last_number);
        """
    )
    op.alter_column(
        "visits",
        "visit_code",
        existing_type=sa.String(length=16),
        nullable=False,
    )
    op.create_unique_constraint("uq_visits_visit_code", "visits", ["visit_code"])

    op.execute(
        """
        CREATE OR REPLACE FUNCTION fn_visits_default_visit_code()
        RETURNS TRIGGER AS $$
        DECLARE
            v_year INTEGER;
            v_seq INTEGER;
        BEGIN
            IF NEW.visit_code IS NULL OR btrim(NEW.visit_code) = '' THEN
                v_year := EXTRACT(YEAR FROM COALESCE(NEW.visit_date, CURRENT_DATE))::INTEGER;
                INSERT INTO visit_sequences (year, last_number)
                VALUES (v_year, 1)
                ON CONFLICT (year) DO UPDATE
                    SET last_number = visit_sequences.last_number + 1
                RETURNING last_number INTO v_seq;
                NEW.visit_code := 'VIS-' || lpad((v_year % 100)::TEXT, 2, '0') || '-' ||
                    lpad(v_seq::TEXT, GREATEST(6, length(v_seq::TEXT)), '0');
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_visits_default_visit_code
        BEFORE INSERT ON visits
        FOR EACH ROW
        EXECUTE FUNCTION fn_visits_default_visit_code();
        """
    )

    # 3b. clinical_encounters.encounter_code & visit_id
    op.add_column(
        "clinical_encounters", sa.Column("encounter_code", sa.String(length=16), nullable=True)
    )
    op.add_column("clinical_encounters", sa.Column("visit_id", sa.BigInteger(), nullable=True))

    # Disable finalised-encounter tamper trigger strictly inside this owner migration transaction
    op.execute(
        "ALTER TABLE clinical_encounters DISABLE TRIGGER trg_prevent_finalised_encounter_tampering;"
    )
    op.execute(
        """
        WITH ranked AS (
            SELECT
                id,
                EXTRACT(YEAR FROM (encounter_date AT TIME ZONE 'Asia/Kolkata'))::INTEGER AS yr,
                ROW_NUMBER() OVER (
                    PARTITION BY EXTRACT(
                        YEAR FROM (encounter_date AT TIME ZONE 'Asia/Kolkata')
                    )::INTEGER
                    ORDER BY id
                ) AS seq_num
            FROM clinical_encounters
        )
        UPDATE clinical_encounters ce
        SET encounter_code = 'ENC-' || lpad((r.yr % 100)::TEXT, 2, '0') || '-' ||
            lpad(r.seq_num::TEXT, GREATEST(6, length(r.seq_num::TEXT)), '0')
        FROM ranked r
        WHERE ce.id = r.id;
        """
    )
    op.execute(
        """
        INSERT INTO encounter_sequences (year, last_number)
        SELECT
            EXTRACT(YEAR FROM (encounter_date AT TIME ZONE 'Asia/Kolkata'))::INTEGER AS yr,
            COUNT(*)::INTEGER AS max_num
        FROM clinical_encounters
        GROUP BY EXTRACT(YEAR FROM (encounter_date AT TIME ZONE 'Asia/Kolkata'))::INTEGER
        ON CONFLICT (year) DO UPDATE
        SET last_number = GREATEST(encounter_sequences.last_number, EXCLUDED.last_number);
        """
    )
    # Backfill visit_id strictly from linked appointments that already have a visit_id
    op.execute(
        """
        UPDATE clinical_encounters ce
        SET visit_id = a.visit_id
        FROM appointments a
        WHERE ce.appointment_id IS NOT NULL
          AND a.id = ce.appointment_id
          AND a.patient_id = ce.patient_id
          AND a.visit_id IS NOT NULL;
        """
    )
    # Lock encounter_code and visit_id immutable once is_finalised = TRUE
    op.execute(
        """
        CREATE OR REPLACE FUNCTION fn_prevent_finalised_encounter_tampering()
        RETURNS TRIGGER AS $$
        DECLARE
            encounter_finalised BOOLEAN;
            target_encounter_id BIGINT;
        BEGIN
            IF TG_TABLE_NAME = 'clinical_encounters' THEN
                IF TG_OP = 'UPDATE' THEN
                    IF OLD.is_finalised = TRUE THEN
                        IF (
                            OLD.symptoms IS DISTINCT FROM NEW.symptoms OR
                            OLD.clinical_notes IS DISTINCT FROM NEW.clinical_notes OR
                            OLD.diagnosis IS DISTINCT FROM NEW.diagnosis OR
                            OLD.patient_id IS DISTINCT FROM NEW.patient_id OR
                            OLD.doctor_id IS DISTINCT FROM NEW.doctor_id OR
                            OLD.department_id IS DISTINCT FROM NEW.department_id OR
                            OLD.appointment_id IS DISTINCT FROM NEW.appointment_id OR
                            OLD.encounter_code IS DISTINCT FROM NEW.encounter_code OR
                            OLD.visit_id IS DISTINCT FROM NEW.visit_id
                        ) THEN
                            RAISE EXCEPTION
                                'Finalised encounter cannot be modified. Append addendum instead.';
                        END IF;
                    END IF;
                    RETURN NEW;
                ELSIF TG_OP = 'DELETE' THEN
                    IF OLD.is_finalised = TRUE THEN
                        RAISE EXCEPTION 'Finalised clinical encounter cannot be deleted.';
                    END IF;
                    RETURN OLD;
                END IF;
                RETURN NEW;
            ELSE
                -- TG_TABLE_NAME IN ('clinical_template_responses', 'vital_observations')
                IF TG_OP = 'DELETE' THEN
                    target_encounter_id := OLD.encounter_id;
                ELSE
                    target_encounter_id := NEW.encounter_id;
                END IF;

                SELECT is_finalised INTO encounter_finalised
                FROM clinical_encounters
                WHERE id = target_encounter_id;

                IF encounter_finalised = TRUE THEN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Cannot delete % for a finalised clinical encounter.',
                            TG_TABLE_NAME;
                    ELSE
                        RAISE EXCEPTION 'Cannot modify % for a finalised clinical encounter.',
                            TG_TABLE_NAME;
                    END IF;
                END IF;

                IF TG_OP = 'DELETE' THEN
                    RETURN OLD;
                END IF;
                RETURN NEW;
            END IF;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        "ALTER TABLE clinical_encounters ENABLE TRIGGER trg_prevent_finalised_encounter_tampering;"
    )

    op.alter_column(
        "clinical_encounters",
        "encounter_code",
        existing_type=sa.String(length=16),
        nullable=False,
    )
    op.create_unique_constraint(
        "uq_clinical_encounters_encounter_code",
        "clinical_encounters",
        ["encounter_code"],
    )
    op.execute(
        """
        ALTER TABLE clinical_encounters
            ADD CONSTRAINT fk_clinical_encounters_visit_patient
            FOREIGN KEY (visit_id, patient_id)
            REFERENCES visits (id, patient_id)
            ON DELETE SET NULL (visit_id);
        """
    )
    op.create_index("ix_clinical_encounters_visit_id", "clinical_encounters", ["visit_id"])

    op.execute(
        """
        CREATE OR REPLACE FUNCTION fn_encounters_default_encounter_code()
        RETURNS TRIGGER AS $$
        DECLARE
            v_year INTEGER;
            v_seq INTEGER;
        BEGIN
            IF NEW.encounter_code IS NULL OR btrim(NEW.encounter_code) = '' THEN
                v_year := EXTRACT(
                    YEAR FROM (COALESCE(NEW.encounter_date, now()) AT TIME ZONE 'Asia/Kolkata')
                )::INTEGER;
                INSERT INTO encounter_sequences (year, last_number)
                VALUES (v_year, 1)
                ON CONFLICT (year) DO UPDATE
                    SET last_number = encounter_sequences.last_number + 1
                RETURNING last_number INTO v_seq;
                NEW.encounter_code := 'ENC-' || lpad((v_year % 100)::TEXT, 2, '0') || '-' ||
                    lpad(v_seq::TEXT, GREATEST(6, length(v_seq::TEXT)), '0');
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_encounters_default_encounter_code
        BEFORE INSERT ON clinical_encounters
        FOR EACH ROW
        EXECUTE FUNCTION fn_encounters_default_encounter_code();
        """
    )

    # 4. Normalize appointments.status and enforce bare CHECK "status_valid"
    status_list_sql = ", ".join(f"'{status}'" for status in APPOINTMENT_STATUS_VALUES)
    op.execute(
        """
        UPDATE appointments
        SET status = upper(btrim(status))
        WHERE status IS DISTINCT FROM upper(btrim(status));
        """
    )
    unexpected_statuses = (
        bind.execute(
            sa.text(
                f"SELECT DISTINCT status FROM appointments "  # noqa: S608
                f"WHERE status IS NULL OR status NOT IN ({status_list_sql}) "
                "ORDER BY status"
            )
        )
        .scalars()
        .all()
    )
    if unexpected_statuses:
        raise RuntimeError(
            "Migration 0034 stopped: unexpected appointments.status value(s) found "
            f"{unexpected_statuses!r}. Review or normalize these rows before applying "
            "ck_appointments_status_valid. Nothing was committed."
        )
    op.create_check_constraint(
        "status_valid",
        "appointments",
        f"status IN ({status_list_sql})",
    )

    # 5. Least-privilege runtime grants for kalyan_app
    op.execute(
        "GRANT SELECT, INSERT, UPDATE ON patient_allergies, visit_sequences, "
        "encounter_sequences TO kalyan_app;"
    )
    op.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kalyan_app;")


def downgrade() -> None:
    bind = op.get_bind()

    allergy_rows = bind.execute(sa.text("SELECT count(*) FROM patient_allergies")).scalar_one()
    if allergy_rows:
        raise RuntimeError(
            f"Migration 0034 downgrade stopped: {allergy_rows} patient_allergies row(s) exist. "
            "Clinical allergy records are not deleted. Nothing was changed."
        )

    extended_patient_rows = bind.execute(
        sa.text(
            "SELECT count(*) FROM patients WHERE alternate_mobile IS NOT NULL"
            " OR email IS NOT NULL OR blood_group IS NOT NULL"
            " OR pin_code IS NOT NULL OR guardian_relationship IS NOT NULL"
            " OR medical_history_notes IS NOT NULL"
        )
    ).scalar_one()
    if extended_patient_rows:
        raise RuntimeError(
            f"Migration 0034 downgrade stopped: {extended_patient_rows} patient row(s) hold "
            "extended demographic/medical-history data that would be dropped. Nothing was changed."
        )

    visit_rows = bind.execute(sa.text("SELECT count(*) FROM visits")).scalar_one()
    visit_seq_rows = bind.execute(sa.text("SELECT count(*) FROM visit_sequences")).scalar_one()
    if visit_rows or visit_seq_rows:
        raise RuntimeError(
            f"Migration 0034 downgrade stopped: {visit_rows} visit row(s) and {visit_seq_rows} "
            "visit_sequences row(s) hold visit_code references that would be lost. "
            "Nothing was changed."
        )

    encounter_rows = bind.execute(sa.text("SELECT count(*) FROM clinical_encounters")).scalar_one()
    encounter_seq_rows = bind.execute(
        sa.text("SELECT count(*) FROM encounter_sequences")
    ).scalar_one()
    if encounter_rows or encounter_seq_rows:
        raise RuntimeError(
            f"Migration 0034 downgrade stopped: {encounter_rows} clinical_encounters row(s) and "
            f"{encounter_seq_rows} encounter_sequences row(s) hold encounter_code/visit_id "
            "references that would be lost. Nothing was changed."
        )

    op.execute(
        "REVOKE SELECT, INSERT, UPDATE ON patient_allergies, visit_sequences, "
        "encounter_sequences FROM kalyan_app;"
    )

    op.drop_constraint("status_valid", "appointments", type_="check")

    op.execute(
        "DROP TRIGGER IF EXISTS trg_encounters_default_encounter_code ON clinical_encounters;"
    )
    op.execute("DROP FUNCTION IF EXISTS fn_encounters_default_encounter_code();")
    op.execute("DROP TRIGGER IF EXISTS trg_visits_default_visit_code ON visits;")
    op.execute("DROP FUNCTION IF EXISTS fn_visits_default_visit_code();")

    # Restore fn_prevent_finalised_encounter_tampering() to 0012 definition before dropping columns
    op.execute(
        """
        CREATE OR REPLACE FUNCTION fn_prevent_finalised_encounter_tampering()
        RETURNS TRIGGER AS $$
        DECLARE
            encounter_finalised BOOLEAN;
            target_encounter_id BIGINT;
        BEGIN
            IF TG_TABLE_NAME = 'clinical_encounters' THEN
                IF TG_OP = 'UPDATE' THEN
                    IF OLD.is_finalised = TRUE THEN
                        IF (
                            OLD.symptoms IS DISTINCT FROM NEW.symptoms OR
                            OLD.clinical_notes IS DISTINCT FROM NEW.clinical_notes OR
                            OLD.diagnosis IS DISTINCT FROM NEW.diagnosis OR
                            OLD.patient_id IS DISTINCT FROM NEW.patient_id OR
                            OLD.doctor_id IS DISTINCT FROM NEW.doctor_id OR
                            OLD.department_id IS DISTINCT FROM NEW.department_id OR
                            OLD.appointment_id IS DISTINCT FROM NEW.appointment_id
                        ) THEN
                            RAISE EXCEPTION
                                'Finalised encounter cannot be modified. Append addendum instead.';
                        END IF;
                    END IF;
                    RETURN NEW;
                ELSIF TG_OP = 'DELETE' THEN
                    IF OLD.is_finalised = TRUE THEN
                        RAISE EXCEPTION 'Finalised clinical encounter cannot be deleted.';
                    END IF;
                    RETURN OLD;
                END IF;
                RETURN NEW;
            ELSE
                -- TG_TABLE_NAME IN ('clinical_template_responses', 'vital_observations')
                IF TG_OP = 'DELETE' THEN
                    target_encounter_id := OLD.encounter_id;
                ELSE
                    target_encounter_id := NEW.encounter_id;
                END IF;

                SELECT is_finalised INTO encounter_finalised
                FROM clinical_encounters
                WHERE id = target_encounter_id;

                IF encounter_finalised = TRUE THEN
                    IF TG_OP = 'DELETE' THEN
                        RAISE EXCEPTION 'Cannot delete % for a finalised clinical encounter.',
                            TG_TABLE_NAME;
                    ELSE
                        RAISE EXCEPTION 'Cannot modify % for a finalised clinical encounter.',
                            TG_TABLE_NAME;
                    END IF;
                END IF;

                IF TG_OP = 'DELETE' THEN
                    RETURN OLD;
                END IF;
                RETURN NEW;
            END IF;
        END;
        $$ LANGUAGE plpgsql;
        """
    )

    op.drop_index("ix_clinical_encounters_visit_id", table_name="clinical_encounters")
    op.drop_constraint(
        "fk_clinical_encounters_visit_patient",
        "clinical_encounters",
        type_="foreignkey",
    )
    op.drop_constraint(
        "uq_clinical_encounters_encounter_code",
        "clinical_encounters",
        type_="unique",
    )
    op.drop_column("clinical_encounters", "visit_id")
    op.drop_column("clinical_encounters", "encounter_code")

    op.drop_constraint("uq_visits_visit_code", "visits", type_="unique")
    op.drop_column("visits", "visit_code")

    op.drop_table("encounter_sequences")
    op.drop_table("visit_sequences")

    op.drop_index("ix_patient_allergies_patient_status", table_name="patient_allergies")
    op.drop_table("patient_allergies")

    op.drop_constraint("blood_group_valid", "patients", type_="check")
    op.drop_column("patients", "medical_history_notes")
    op.drop_column("patients", "guardian_relationship")
    op.drop_column("patients", "pin_code")
    op.drop_column("patients", "blood_group")
    op.drop_column("patients", "email")
    op.drop_column("patients", "alternate_mobile")
