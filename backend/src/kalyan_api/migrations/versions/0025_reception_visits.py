"""Reception visits: visit record, check-in link and phone-appointment fields.

Revision ID: 0025
Revises: 0024
Create Date: 2026-11-14

RF-10 (schema only; no behaviour change yet). Owner decisions of 2026-11-13:

- A visit is opened at check-in and closed by reception at checkout ("Patient Out").
  A patient has at most one OPEN visit at a time (partial unique index).
- Appointments gain a source (PHONE or WALK_IN), an optional expected time, a link to the
  visit they were checked into, a link to the appointment they were rescheduled from, and a
  consultation status. The token is issued at check-in, so token_number becomes nullable.
- Same-patient rule (as SEC-03): a visit link is a composite foreign key
  (visit_id, patient_id) -> visits (id, patient_id).
- Legacy appointments get NO visit. Nothing about past visits is invented: their consultation
  status is derived from the existing appointment status, and their source stays empty.
- Nothing is deleted. The downgrade refuses to run if visit rows exist or if a column it
  would drop still holds data.

Naming: env.py's naming convention adds the "ck_<table>_" prefix to every CHECK constraint
name, in create and drop calls alike. Pass the bare name (for example "status_valid"); passing
"ck_visits_status_valid" yields a doubled name. Foreign-key and unique names are used as written.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0025"
down_revision: str | None = "0024"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "visits",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("patient_id", sa.BigInteger(), nullable=False),
        sa.Column("visit_date", sa.Date(), nullable=False),
        sa.Column(
            "status",
            sa.String(length=16),
            server_default=sa.text("'OPEN'"),
            nullable=False,
        ),
        sa.Column("opened_by_user_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "opened_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("closed_by_user_id", sa.BigInteger(), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("close_reason", sa.Text(), nullable=True),
        sa.Column("cancelled_by_user_id", sa.BigInteger(), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancel_reason", sa.Text(), nullable=True),
        sa.Column("version_id", sa.Integer(), nullable=False),
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
            ["patient_id"],
            ["patients.id"],
            name="fk_visits_patient_id_patients",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["opened_by_user_id"],
            ["users.id"],
            name="fk_visits_opened_by_user_id_users",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["closed_by_user_id"],
            ["users.id"],
            name="fk_visits_closed_by_user_id_users",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["cancelled_by_user_id"],
            ["users.id"],
            name="fk_visits_cancelled_by_user_id_users",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "status IN ('OPEN', 'CLOSED', 'CANCELLED')",
            name="status_valid",
        ),
        sa.CheckConstraint(
            "status <> 'CLOSED' OR (closed_at IS NOT NULL AND closed_by_user_id IS NOT NULL)",
            name="closed_fields_present",
        ),
        sa.CheckConstraint(
            "status <> 'CANCELLED' OR (cancelled_at IS NOT NULL"
            " AND cancelled_by_user_id IS NOT NULL AND cancel_reason IS NOT NULL)",
            name="cancelled_fields_present",
        ),
        sa.UniqueConstraint("id", "patient_id", name="uq_visits_id_patient"),
    )
    op.create_index(
        "ix_visits_one_open_per_patient",
        "visits",
        ["patient_id"],
        unique=True,
        postgresql_where=sa.text("status = 'OPEN'"),
    )
    op.create_index("ix_visits_patient_date", "visits", ["patient_id", "visit_date"])

    op.add_column("appointments", sa.Column("visit_id", sa.BigInteger(), nullable=True))
    op.add_column("appointments", sa.Column("source", sa.String(length=16), nullable=True))
    op.add_column("appointments", sa.Column("expected_time", sa.Time(), nullable=True))
    op.add_column(
        "appointments",
        sa.Column("rescheduled_from_id", sa.BigInteger(), nullable=True),
    )
    op.add_column(
        "appointments",
        sa.Column("consultation_status", sa.String(length=16), nullable=True),
    )
    op.alter_column(
        "appointments",
        "token_number",
        existing_type=sa.Integer(),
        nullable=True,
    )

    op.create_foreign_key(
        "fk_appointments_visit_id_visits",
        "appointments",
        "visits",
        ["visit_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        "fk_appointments_visit_patient",
        "appointments",
        "visits",
        ["visit_id", "patient_id"],
        ["id", "patient_id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        "fk_appointments_rescheduled_from_id_appointments",
        "appointments",
        "appointments",
        ["rescheduled_from_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index("ix_appointments_visit_id", "appointments", ["visit_id"])
    op.create_check_constraint(
        "source_valid",
        "appointments",
        "source IS NULL OR source IN ('PHONE', 'WALK_IN')",
    )
    op.create_check_constraint(
        "consultation_status_valid",
        "appointments",
        "consultation_status IS NULL OR consultation_status IN"
        " ('WAITING', 'IN_CONSULTATION', 'COMPLETED', 'CANCELLED')",
    )

    # Derive the consultation status of legacy rows from their existing appointment status.
    # Rows that were never checked in (BOOKED, CANCELLED, NO_SHOW) keep it empty.
    op.execute(
        """
UPDATE appointments
SET consultation_status = CASE status
    WHEN 'ARRIVED' THEN 'WAITING'
    WHEN 'IN_CONSULTATION' THEN 'IN_CONSULTATION'
    WHEN 'DONE' THEN 'COMPLETED'
END
WHERE status IN ('ARRIVED', 'IN_CONSULTATION', 'DONE');
"""
    )

    op.execute("GRANT SELECT, INSERT, UPDATE ON visits TO kalyan_app;")
    op.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kalyan_app;")


def downgrade() -> None:
    bind = op.get_bind()

    visit_rows = bind.execute(sa.text("SELECT count(*) FROM visits")).scalar_one()
    if visit_rows:
        raise RuntimeError(
            f"Migration 0025 downgrade stopped: {visit_rows} visit row(s) exist. "
            "Visits are historical records and are not deleted. Nothing was changed."
        )

    linked = bind.execute(
        sa.text(
            "SELECT count(*) FROM appointments WHERE visit_id IS NOT NULL"
            " OR source IS NOT NULL OR expected_time IS NOT NULL"
            " OR rescheduled_from_id IS NOT NULL"
        )
    ).scalar_one()
    if linked:
        raise RuntimeError(
            f"Migration 0025 downgrade stopped: {linked} appointment(s) hold visit, source, "
            "expected time or reschedule data that would be dropped. Nothing was changed."
        )

    null_tokens = bind.execute(
        sa.text("SELECT count(*) FROM appointments WHERE token_number IS NULL")
    ).scalar_one()
    if null_tokens:
        raise RuntimeError(
            f"Migration 0025 downgrade stopped: {null_tokens} appointment(s) have no token, "
            "so token_number cannot become NOT NULL again. Nothing was changed."
        )

    op.drop_index("ix_appointments_visit_id", table_name="appointments")
    op.drop_constraint("consultation_status_valid", "appointments", type_="check")
    op.drop_constraint("source_valid", "appointments", type_="check")
    op.drop_constraint(
        "fk_appointments_rescheduled_from_id_appointments", "appointments", type_="foreignkey"
    )
    op.drop_constraint("fk_appointments_visit_patient", "appointments", type_="foreignkey")
    op.drop_constraint("fk_appointments_visit_id_visits", "appointments", type_="foreignkey")
    op.alter_column(
        "appointments",
        "token_number",
        existing_type=sa.Integer(),
        nullable=False,
    )
    op.drop_column("appointments", "consultation_status")
    op.drop_column("appointments", "rescheduled_from_id")
    op.drop_column("appointments", "expected_time")
    op.drop_column("appointments", "source")
    op.drop_column("appointments", "visit_id")

    op.drop_index("ix_visits_patient_date", table_name="visits")
    op.drop_index("ix_visits_one_open_per_patient", table_name="visits")
    op.drop_table("visits")
