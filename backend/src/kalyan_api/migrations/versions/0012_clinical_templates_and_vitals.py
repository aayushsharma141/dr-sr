"""Clinical templates, versions, responses, departments, and vitals schema.

Revision ID: 0012
Revises: 0011
Create Date: 2026-11-06

Requirements:
- DWS-04: Department reference on encounters for multi-specialty consultations.
- DWS-05: Dynamic specialty templates engine with versioned schemas and immutability.
- DWS-06: Vitals and biometrics capture engine with physiological constraints and BMI.
- CLN-02: Tamper trigger preventing updates/deletes to responses and vitals of finalised encounters.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. Table: departments
    op.create_table(
        "departments",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column("code", sa.String(length=64), nullable=False, unique=True),
        sa.Column("name_en", sa.String(length=128), nullable=False),
        sa.Column("name_hi", sa.String(length=128), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )

    # Seed departments
    departments_table = sa.table(
        "departments",
        sa.column("code", sa.String),
        sa.column("name_en", sa.String),
        sa.column("name_hi", sa.String),
        sa.column("is_active", sa.Boolean),
    )
    op.bulk_insert(
        departments_table,
        [
            {
                "code": "PHYSIOTHERAPY",
                "name_en": "Physiotherapy",
                "name_hi": "फिजियोथेरेपी",
                "is_active": True,
            },
            {
                "code": "OPHTHALMOLOGY",
                "name_en": "Ophthalmology",
                "name_hi": "नेत्र रोग",
                "is_active": True,
            },
        ],
    )

    # Link clinical_encounters.department_id to departments.id
    op.create_foreign_key(
        "fk_clinical_encounters_department_id_departments",
        "clinical_encounters",
        "departments",
        ["department_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # 2. Table: clinical_templates
    op.create_table(
        "clinical_templates",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column(
            "department_id",
            sa.BigInteger(),
            sa.ForeignKey("departments.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("code", sa.String(length=64), nullable=False, unique=True),
        sa.Column("name_en", sa.String(length=128), nullable=False),
        sa.Column("name_hi", sa.String(length=128), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )

    # 3. Table: clinical_template_versions
    op.create_table(
        "clinical_template_versions",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column(
            "template_id",
            sa.BigInteger(),
            sa.ForeignKey("clinical_templates.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("schema_json", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("approved_by", sa.String(length=128), nullable=False),
        sa.Column(
            "approved_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("template_id", "version_number", name="uq_template_version"),
    )

    # 4. Table: clinical_template_responses
    op.create_table(
        "clinical_template_responses",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column(
            "encounter_id",
            sa.BigInteger(),
            sa.ForeignKey("clinical_encounters.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "template_version_id",
            sa.BigInteger(),
            sa.ForeignKey("clinical_template_versions.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "response_data",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
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
        sa.UniqueConstraint("encounter_id", name="uq_template_responses_encounter"),
    )

    # 5. Table: vital_observations
    op.create_table(
        "vital_observations",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column(
            "encounter_id",
            sa.BigInteger(),
            sa.ForeignKey("clinical_encounters.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "patient_id",
            sa.BigInteger(),
            sa.ForeignKey("patients.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("height_cm", sa.Numeric(precision=5, scale=2), nullable=True),
        sa.Column("weight_kg", sa.Numeric(precision=5, scale=2), nullable=True),
        sa.Column("bmi", sa.Numeric(precision=4, scale=1), nullable=True),
        sa.Column("systolic_bp", sa.Integer(), nullable=True),
        sa.Column("diastolic_bp", sa.Integer(), nullable=True),
        sa.Column("pulse_bpm", sa.Integer(), nullable=True),
        sa.Column("temperature_f", sa.Numeric(precision=4, scale=1), nullable=True),
        sa.Column("respiratory_rate", sa.Integer(), nullable=True),
        sa.Column("spo2_percent", sa.Integer(), nullable=True),
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
        sa.UniqueConstraint("encounter_id", name="uq_vital_observations_encounter"),
        sa.CheckConstraint(
            "height_cm IS NULL OR (height_cm > 20 AND height_cm < 280)",
            name="ck_vital_observations_height_cm",
        ),
        sa.CheckConstraint(
            "weight_kg IS NULL OR (weight_kg > 1 AND weight_kg < 400)",
            name="ck_vital_observations_weight_kg",
        ),
        sa.CheckConstraint(
            "bmi IS NULL OR (bmi >= 5 AND bmi <= 100)",
            name="ck_vital_observations_bmi",
        ),
        sa.CheckConstraint(
            "systolic_bp IS NULL OR (systolic_bp >= 40 AND systolic_bp <= 300)",
            name="ck_vital_observations_systolic_bp",
        ),
        sa.CheckConstraint(
            "diastolic_bp IS NULL OR (diastolic_bp >= 20 AND diastolic_bp <= 200)",
            name="ck_vital_observations_diastolic_bp",
        ),
        sa.CheckConstraint(
            "pulse_bpm IS NULL OR (pulse_bpm >= 30 AND pulse_bpm <= 260)",
            name="ck_vital_observations_pulse_bpm",
        ),
        sa.CheckConstraint(
            "temperature_f IS NULL OR (temperature_f >= 85 AND temperature_f <= 110)",
            name="ck_vital_observations_temperature_f",
        ),
        sa.CheckConstraint(
            "respiratory_rate IS NULL OR (respiratory_rate >= 5 AND respiratory_rate <= 80)",
            name="ck_vital_observations_respiratory_rate",
        ),
        sa.CheckConstraint(
            "spo2_percent IS NULL OR (spo2_percent >= 40 AND spo2_percent <= 100)",
            name="ck_vital_observations_spo2_percent",
        ),
    )

    # 6. Database trigger preventing tampering with finalised encounter responses and vitals
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
                        RAISE EXCEPTION 'Cannot delete % for a finalised clinical encounter.', TG_TABLE_NAME;
                    ELSE
                        RAISE EXCEPTION 'Cannot modify % for a finalised clinical encounter.', TG_TABLE_NAME;
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
        """
        CREATE TRIGGER trg_prevent_finalised_encounter_template_response_tampering
        BEFORE INSERT OR UPDATE OR DELETE ON clinical_template_responses
        FOR EACH ROW
        EXECUTE FUNCTION fn_prevent_finalised_encounter_tampering();
        """
    )

    op.execute(
        """
        CREATE TRIGGER trg_prevent_finalised_encounter_vitals_tampering
        BEFORE INSERT OR UPDATE OR DELETE ON vital_observations
        FOR EACH ROW
        EXECUTE FUNCTION fn_prevent_finalised_encounter_tampering();
        """
    )

    # 7. Role permissions for kalyan_app
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON departments TO kalyan_app;")
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON clinical_templates TO kalyan_app;")
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON clinical_template_versions TO kalyan_app;")
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON clinical_template_responses TO kalyan_app;")
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON vital_observations TO kalyan_app;")
    op.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kalyan_app;")


def downgrade() -> None:
    op.execute("REVOKE SELECT, INSERT, UPDATE, DELETE ON vital_observations FROM kalyan_app;")
    op.execute("REVOKE SELECT, INSERT, UPDATE, DELETE ON clinical_template_responses FROM kalyan_app;")
    op.execute("REVOKE SELECT, INSERT, UPDATE, DELETE ON clinical_template_versions FROM kalyan_app;")
    op.execute("REVOKE SELECT, INSERT, UPDATE, DELETE ON clinical_templates FROM kalyan_app;")
    op.execute("REVOKE SELECT, INSERT, UPDATE, DELETE ON departments FROM kalyan_app;")

    op.execute("DROP TRIGGER IF EXISTS trg_prevent_finalised_encounter_vitals_tampering ON vital_observations;")
    op.execute("DROP TRIGGER IF EXISTS trg_prevent_finalised_encounter_template_response_tampering ON clinical_template_responses;")

    op.execute(
        """
        CREATE OR REPLACE FUNCTION fn_prevent_finalised_encounter_tampering()
        RETURNS TRIGGER AS $$
        BEGIN
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
        END;
        $$ LANGUAGE plpgsql;
        """
    )

    op.drop_table("vital_observations")
    op.drop_table("clinical_template_responses")
    op.drop_table("clinical_template_versions")
    op.drop_table("clinical_templates")
    op.drop_constraint("fk_clinical_encounters_department_id_departments", "clinical_encounters", type_="foreignkey")
    op.drop_table("departments")
