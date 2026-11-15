"""Check-in fields: visit type, priority classification, referral, priority history.

Revision ID: 0026
Revises: 0025
Create Date: 2026-11-15

Phase 22 (Integrated OPD workflow), task T22-01. Owner decisions of 2026-11-15
(.planning/phases/22-integrated-opd-workflow/22-DESIGN.md):

- OD-22-05: each consultation records its visit type, NEW or FOLLOW_UP. It never sets the fee.
- OD-22-06/07/09: each consultation carries a classification NORMAL / PRIORITY / EMERGENCY.
  PRIORITY and EMERGENCY need a reason. EMERGENCY records when the doctor was alerted and when
  the doctor acknowledged it. Token numbers are untouched; queue position is computed.
- OD-22-16: Referred By is recorded per visit (source + name), never on the patient.
- Every classification change and acknowledgement is kept in consultation_priority_events.
  The application role may only SELECT and INSERT there, so history cannot be rewritten.

Legacy rows: existing consultations become NORMAL with no visit type; existing visits keep an
empty referral. Nothing about the past is invented. The downgrade refuses to drop data.

Naming: env.py's naming convention adds the "ck_<table>_" prefix to every CHECK constraint
name; pass the bare name.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0026"
down_revision: str | None = "0025"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # --- appointments: visit type and classification ---------------------------------------
    op.add_column("appointments", sa.Column("visit_kind", sa.String(length=16), nullable=True))
    op.add_column(
        "appointments",
        sa.Column(
            "priority_level",
            sa.String(length=16),
            server_default=sa.text("'NORMAL'"),
            nullable=False,
        ),
    )
    op.add_column("appointments", sa.Column("priority_reason", sa.Text(), nullable=True))
    op.add_column(
        "appointments",
        sa.Column("priority_updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "appointments",
        sa.Column("priority_updated_by_user_id", sa.BigInteger(), nullable=True),
    )
    op.add_column(
        "appointments",
        sa.Column("emergency_alerted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "appointments",
        sa.Column("alert_acknowledged_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "appointments",
        sa.Column("alert_acknowledged_by_user_id", sa.BigInteger(), nullable=True),
    )
    op.create_foreign_key(
        "fk_appointments_priority_updated_by_user_id_users",
        "appointments",
        "users",
        ["priority_updated_by_user_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        "fk_appointments_alert_acknowledged_by_user_id_users",
        "appointments",
        "users",
        ["alert_acknowledged_by_user_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_check_constraint(
        "visit_kind_valid",
        "appointments",
        "visit_kind IS NULL OR visit_kind IN ('NEW', 'FOLLOW_UP')",
    )
    op.create_check_constraint(
        "priority_level_valid",
        "appointments",
        "priority_level IN ('NORMAL', 'PRIORITY', 'EMERGENCY')",
    )
    op.create_check_constraint(
        "priority_reason_present",
        "appointments",
        "priority_level = 'NORMAL'"
        " OR (priority_reason IS NOT NULL AND length(trim(priority_reason)) >= 3)",
    )

    # --- visits: referral -------------------------------------------------------------------
    op.add_column("visits", sa.Column("referral_source", sa.String(length=16), nullable=True))
    op.add_column("visits", sa.Column("referrer_name", sa.String(length=120), nullable=True))
    op.add_column(
        "visits",
        sa.Column("referral_recorded_by_user_id", sa.BigInteger(), nullable=True),
    )
    op.add_column(
        "visits",
        sa.Column("referral_recorded_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_visits_referral_recorded_by_user_id_users",
        "visits",
        "users",
        ["referral_recorded_by_user_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_check_constraint(
        "referral_source_valid",
        "visits",
        "referral_source IS NULL OR referral_source IN"
        " ('SELF', 'DOCTOR', 'PERSONAL', 'ORGANIZATION', 'OTHER')",
    )
    op.create_check_constraint(
        "referrer_name_present",
        "visits",
        "referral_source IS NULL OR referral_source NOT IN ('DOCTOR', 'PERSONAL', 'ORGANIZATION')"
        " OR (referrer_name IS NOT NULL AND length(trim(referrer_name)) >= 2)",
    )

    # --- append-only classification history ----------------------------------------------------
    op.create_table(
        "consultation_priority_events",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("appointment_id", sa.BigInteger(), nullable=False),
        sa.Column("visit_id", sa.BigInteger(), nullable=True),
        sa.Column("patient_id", sa.BigInteger(), nullable=False),
        sa.Column("doctor_id", sa.BigInteger(), nullable=False),
        sa.Column("event", sa.String(length=16), nullable=False),
        sa.Column("from_level", sa.String(length=16), nullable=True),
        sa.Column("to_level", sa.String(length=16), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("actor_user_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["appointment_id", "patient_id"],
            ["appointments.id", "appointments.patient_id"],
            name="fk_consultation_priority_events_appointment_patient",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["visit_id"],
            ["visits.id"],
            name="fk_consultation_priority_events_visit_id_visits",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["doctor_id"],
            ["doctors.id"],
            name="fk_consultation_priority_events_doctor_id_doctors",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["actor_user_id"],
            ["users.id"],
            name="fk_consultation_priority_events_actor_user_id_users",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint("event IN ('CLASSIFIED', 'ACKNOWLEDGED')", name="event_valid"),
        sa.CheckConstraint(
            "to_level IN ('NORMAL', 'PRIORITY', 'EMERGENCY')"
            " AND (from_level IS NULL OR from_level IN ('NORMAL', 'PRIORITY', 'EMERGENCY'))",
            name="levels_valid",
        ),
    )
    op.create_index(
        "ix_consultation_priority_events_appointment",
        "consultation_priority_events",
        ["appointment_id", "created_at"],
    )

    # History is append-only for the application: no UPDATE, no DELETE.
    op.execute("GRANT SELECT, INSERT ON consultation_priority_events TO kalyan_app;")
    op.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kalyan_app;")


def downgrade() -> None:
    bind = op.get_bind()

    events = bind.execute(sa.text("SELECT count(*) FROM consultation_priority_events")).scalar_one()
    if events:
        raise RuntimeError(
            f"Migration 0026 downgrade stopped: {events} classification history row(s) exist. "
            "History is not deleted. Nothing was changed."
        )
    used = bind.execute(
        sa.text(
            "SELECT count(*) FROM appointments WHERE visit_kind IS NOT NULL"
            " OR priority_level <> 'NORMAL' OR priority_reason IS NOT NULL"
            " OR emergency_alerted_at IS NOT NULL"
        )
    ).scalar_one()
    referrals = bind.execute(
        sa.text("SELECT count(*) FROM visits WHERE referral_source IS NOT NULL")
    ).scalar_one()
    if used or referrals:
        raise RuntimeError(
            f"Migration 0026 downgrade stopped: {used} consultation(s) and {referrals} visit(s) "
            "hold visit type, classification or referral data that would be dropped. "
            "Nothing was changed."
        )

    op.drop_index(
        "ix_consultation_priority_events_appointment", table_name="consultation_priority_events"
    )
    op.drop_table("consultation_priority_events")

    op.drop_constraint("referrer_name_present", "visits", type_="check")
    op.drop_constraint("referral_source_valid", "visits", type_="check")
    op.drop_constraint("fk_visits_referral_recorded_by_user_id_users", "visits", type_="foreignkey")
    op.drop_column("visits", "referral_recorded_at")
    op.drop_column("visits", "referral_recorded_by_user_id")
    op.drop_column("visits", "referrer_name")
    op.drop_column("visits", "referral_source")

    op.drop_constraint("priority_reason_present", "appointments", type_="check")
    op.drop_constraint("priority_level_valid", "appointments", type_="check")
    op.drop_constraint("visit_kind_valid", "appointments", type_="check")
    op.drop_constraint(
        "fk_appointments_alert_acknowledged_by_user_id_users", "appointments", type_="foreignkey"
    )
    op.drop_constraint(
        "fk_appointments_priority_updated_by_user_id_users", "appointments", type_="foreignkey"
    )
    op.drop_column("appointments", "alert_acknowledged_by_user_id")
    op.drop_column("appointments", "alert_acknowledged_at")
    op.drop_column("appointments", "emergency_alerted_at")
    op.drop_column("appointments", "priority_updated_by_user_id")
    op.drop_column("appointments", "priority_updated_at")
    op.drop_column("appointments", "priority_reason")
    op.drop_column("appointments", "priority_level")
    op.drop_column("appointments", "visit_kind")
