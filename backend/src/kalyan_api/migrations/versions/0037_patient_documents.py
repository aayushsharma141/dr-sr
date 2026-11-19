"""Patient documents table and investigation_results.document_id link.

Revision ID: 0037
Revises: 0036
Create Date: 2026-11-18

Milestone 4 (T4.1):
- Create `patient_documents` for local-disk clinical and administrative patient documents with:
  - PG15+ composite same-patient FKs to `visits(id, patient_id)` (`ON DELETE SET NULL (visit_id)`)
    and `clinical_encounters(id, patient_id)` (`ON DELETE SET NULL (encounter_id)`).
  - DB-enforced D-04 classification guard (`clinical_category`) ensuring clinical categories
    (`LAB_REPORT`, `IMAGING`, `PRESCRIPTION_SCAN`, `DISCHARGE_SUMMARY`) always have
    `is_clinical = TRUE`.
  - Allowed category, MIME type, and 10 MB file size CHECK constraints.
  - `doctor_id` column supporting native DWS-04 cross-doctor audit and CLINICAL_WRITE ownership.
  - Active patient documents index `ix_patient_documents_patient_active`.
- Add nullable `investigation_results.document_id` FK (`ON DELETE SET NULL`) + index.
- Grant least-privilege runtime access (`SELECT, INSERT, UPDATE`) to `kalyan_app` and enforce
  fail-closed `downgrade()`.

Naming: env.py's naming convention prefixes `ck_<table>_` on every CheckConstraint name in both
create and drop calls. Pass bare names (`"category_valid"`, `"clinical_category"`, etc.).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0037"
down_revision: str | None = "0036"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()

    # ON DELETE SET NULL (visit_id / encounter_id) requires PostgreSQL 15 or newer.
    version_num = int(bind.execute(sa.text("SHOW server_version_num")).scalar_one())
    if version_num < 150000:
        raise RuntimeError(
            "Migration 0037 needs PostgreSQL 15 or newer "
            f"(server_version_num={version_num}). No change was made."
        )

    # 1. Patient documents table
    op.create_table(
        "patient_documents",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column("patient_id", sa.BigInteger(), nullable=False),
        sa.Column("visit_id", sa.BigInteger(), nullable=True),
        sa.Column("encounter_id", sa.BigInteger(), nullable=True),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("category", sa.String(length=32), nullable=False),
        sa.Column("is_clinical", sa.Boolean(), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("stored_filename", sa.String(length=128), nullable=False),
        sa.Column("mime_type", sa.String(length=100), nullable=False),
        sa.Column("file_size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("sha256_hex", sa.CHAR(length=64), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("uploaded_by_user_id", sa.BigInteger(), nullable=False),
        sa.Column("doctor_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "is_archived",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("archived_by_user_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("stored_filename", name="uq_patient_documents_stored_filename"),
        sa.ForeignKeyConstraint(
            ["patient_id"],
            ["patients.id"],
            name="fk_patient_documents_patient_id_patients",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["uploaded_by_user_id"],
            ["users.id"],
            name="fk_patient_documents_uploaded_by_user_id_users",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["doctor_id"],
            ["doctors.id"],
            name="fk_patient_documents_doctor_id_doctors",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["archived_by_user_id"],
            ["users.id"],
            name="fk_patient_documents_archived_by_user_id_users",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "category IN ("
            "'LAB_REPORT', 'IMAGING', 'PRESCRIPTION_SCAN', 'REFERRAL', "
            "'ID_PROOF', 'INSURANCE', 'DISCHARGE_SUMMARY', 'OTHER')",
            name="category_valid",
        ),
        sa.CheckConstraint(
            "category NOT IN ('LAB_REPORT', 'IMAGING', 'PRESCRIPTION_SCAN', 'DISCHARGE_SUMMARY') "
            "OR is_clinical = TRUE",
            name="clinical_category",
        ),
        sa.CheckConstraint(
            "mime_type IN ('application/pdf', 'image/jpeg', 'image/png')",
            name="mime_type_valid",
        ),
        sa.CheckConstraint(
            "file_size_bytes > 0 AND file_size_bytes <= 10485760",
            name="file_size_valid",
        ),
    )

    op.execute(
        """
        ALTER TABLE patient_documents
            ADD CONSTRAINT fk_patient_documents_visit_patient
            FOREIGN KEY (visit_id, patient_id)
            REFERENCES visits (id, patient_id)
            ON DELETE SET NULL (visit_id);
        """
    )
    op.execute(
        """
        ALTER TABLE patient_documents
            ADD CONSTRAINT fk_patient_documents_encounter_patient
            FOREIGN KEY (encounter_id, patient_id)
            REFERENCES clinical_encounters (id, patient_id)
            ON DELETE SET NULL (encounter_id);
        """
    )

    op.create_index(
        "ix_patient_documents_patient_active",
        "patient_documents",
        ["patient_id", "is_archived", sa.text("created_at DESC")],
    )

    # 2. Link investigation_results.document_id -> patient_documents.id
    op.add_column(
        "investigation_results",
        sa.Column("document_id", sa.BigInteger(), nullable=True),
    )
    op.create_foreign_key(
        "fk_investigation_results_document_id_patient_documents",
        "investigation_results",
        "patient_documents",
        ["document_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_investigation_results_document_id",
        "investigation_results",
        ["document_id"],
    )

    # 3. Least-privilege runtime grants for kalyan_app (soft-archive only, no DELETE)
    op.execute("GRANT SELECT, INSERT, UPDATE ON patient_documents TO kalyan_app;")
    op.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kalyan_app;")


def downgrade() -> None:
    bind = op.get_bind()

    doc_rows = bind.execute(sa.text("SELECT count(*) FROM patient_documents")).scalar_one()
    if doc_rows:
        raise RuntimeError(
            f"Migration 0037 downgrade stopped: {doc_rows} patient_documents row(s) exist. "
            "Patient document records are not deleted. Nothing was changed."
        )

    op.execute("REVOKE SELECT, INSERT, UPDATE ON patient_documents FROM kalyan_app;")

    op.drop_index("ix_investigation_results_document_id", table_name="investigation_results")
    op.drop_constraint(
        "fk_investigation_results_document_id_patient_documents",
        "investigation_results",
        type_="foreignkey",
    )
    op.drop_column("investigation_results", "document_id")

    op.drop_index("ix_patient_documents_patient_active", table_name="patient_documents")
    op.drop_table("patient_documents")
