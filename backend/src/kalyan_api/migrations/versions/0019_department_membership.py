"""Doctor department membership and appointment department (PR #17, D-19-03).

Revision ID: 0019
Revises: 0018
Create Date: 2026-11-08

PR #17 (feature/reception-all-specialties) added these as revisions 0008 and 0009, each
creating its own `departments` table. This branch already created `departments` in 0012
(with `code`, seeded PHYSIOTHERAPY and OPHTHALMOLOGY). This revision brings PR #17's schema
onto that existing table instead of creating a second one:

- departments: adds description, version_id, updated_at, a unique English name and a
  non-blank name check.
- doctor_departments: which departments (specialties) each doctor works in.
- appointments.department_id: the department chosen at booking. The consultation template
  comes from it (D-19-03).

Backfill, only where the answer is unambiguous:
- A doctor whose qualification names one specialty is placed in it ("Ophthalm"/"eye" ->
  OPHTHALMOLOGY; "physio"/"BPT"/"MPT" -> PHYSIOTHERAPY). Anyone else is left for the
  administrator to assign on the Departments page.
- Existing appointments take their doctor's department when the doctor has exactly one.
- Unfinalised consultations with no department take their appointment's department.
  Finalised ones are protected by the tamper trigger and are left as they are; the API
  reports their department from the specialty form saved with them.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0019"
down_revision: str | None = "0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. Extend the existing departments table with PR #17's columns.
    op.add_column("departments", sa.Column("description", sa.String(500), nullable=True))
    op.add_column(
        "departments",
        sa.Column("version_id", sa.Integer(), server_default="1", nullable=False),
    )
    op.add_column(
        "departments",
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_unique_constraint("uq_departments_name_en", "departments", ["name_en"])
    op.create_check_constraint(
        "ck_departments_departments_name_nonblank",
        "departments",
        "length(trim(name_en)) >= 2",
    )

    # 2. Doctor membership.
    op.create_table(
        "doctor_departments",
        sa.Column(
            "doctor_id",
            sa.BigInteger(),
            sa.ForeignKey("doctors.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "department_id",
            sa.BigInteger(),
            sa.ForeignKey("departments.id", ondelete="RESTRICT"),
            primary_key=True,
        ),
    )

    # 3. Department chosen at booking.
    op.add_column("appointments", sa.Column("department_id", sa.BigInteger(), nullable=True))
    op.create_foreign_key(
        "fk_appointments_department_id_departments",
        "appointments",
        "departments",
        ["department_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index("ix_appointments_department_id", "appointments", ["department_id"])

    op.execute(
        "GRANT SELECT, INSERT, UPDATE, DELETE ON departments, doctor_departments TO kalyan_app;"
    )
    op.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kalyan_app;")

    # 4. Backfill where unambiguous.
    op.execute(
        """
        INSERT INTO doctor_departments (doctor_id, department_id)
        SELECT d.id, dep.id
        FROM doctors d
        JOIN departments dep ON dep.code = CASE
            WHEN d.qualification ~* '(ophthalm|\\meye\\M)'
             AND d.qualification !~* '(physio|\\mBPT\\M|\\mMPT\\M)' THEN 'OPHTHALMOLOGY'
            WHEN d.qualification ~* '(physio|\\mBPT\\M|\\mMPT\\M)'
             AND d.qualification !~* '(ophthalm|\\meye\\M)' THEN 'PHYSIOTHERAPY'
        END
        ON CONFLICT DO NOTHING;
        """
    )
    op.execute(
        """
        UPDATE appointments a
        SET department_id = only_dep.department_id
        FROM (
            SELECT doctor_id, MIN(department_id) AS department_id
            FROM doctor_departments
            GROUP BY doctor_id
            HAVING COUNT(*) = 1
        ) AS only_dep
        WHERE a.doctor_id = only_dep.doctor_id AND a.department_id IS NULL;
        """
    )
    op.execute(
        """
        UPDATE clinical_encounters e
        SET department_id = a.department_id
        FROM appointments a
        WHERE e.appointment_id = a.id
          AND e.department_id IS NULL
          AND a.department_id IS NOT NULL
          AND e.is_finalised = false;
        """
    )


def downgrade() -> None:
    op.drop_index("ix_appointments_department_id", table_name="appointments")
    op.drop_constraint(
        "fk_appointments_department_id_departments", "appointments", type_="foreignkey"
    )
    op.drop_column("appointments", "department_id")
    op.execute("REVOKE SELECT, INSERT, UPDATE, DELETE ON doctor_departments FROM kalyan_app;")
    op.drop_table("doctor_departments")
    op.drop_constraint(
        "ck_departments_departments_name_nonblank", "departments", type_="check"
    )
    op.drop_constraint("uq_departments_name_en", "departments", type_="unique")
    op.drop_column("departments", "updated_at")
    op.drop_column("departments", "version_id")
    op.drop_column("departments", "description")
