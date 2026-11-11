"""Specialty clinical templates and print templates registry endpoints (DWS-05, D-19-10..13,
D-20-04)."""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from kalyan_api.core.errors import ApiError
from kalyan_api.core.permissions import Permission
from kalyan_api.core.policy import require
from kalyan_api.core.principal import Principal, build_audit_context, current_principal
from kalyan_api.db.session import SessionDep
from kalyan_api.models import (
    ClinicalTemplate,
    ClinicalTemplateVersion,
    ClinicSettings,
    Department,
    PrintDocumentType,
    PrintTemplate,
)
from kalyan_api.schemas.templates import (
    OPHTHALMOLOGY_V1_SCHEMA,
    PHYSIOTHERAPY_V1_SCHEMA,
    ClinicalTemplateRead,
    ClinicalTemplateVersionRead,
    PrintTemplateRead,
    PrintTemplateUpdate,
)
from kalyan_api.services import audit_service
from kalyan_api.services.audit_service import AuditAction

router = APIRouter(
    prefix="/templates",
    tags=["templates"],
    dependencies=[Depends(require(Permission.ENCOUNTER_READ))],
)


def ensure_specialty_templates_seeded(session: Session) -> None:
    """Idempotently seed default specialty templates if not already present."""
    # 1. Physiotherapy
    physio_dept = session.scalar(select(Department).where(Department.code == "PHYSIOTHERAPY"))
    if physio_dept:
        physio_tmpl = session.scalar(
            select(ClinicalTemplate).where(ClinicalTemplate.code == "PHYSIOTHERAPY")
        )
        if not physio_tmpl:
            physio_tmpl = ClinicalTemplate(
                department_id=physio_dept.id,
                code="PHYSIOTHERAPY",
                name_en="Physiotherapy",
                name_hi="फिजियोथेरेपी",
                is_active=True,
            )
            session.add(physio_tmpl)
            session.flush()
            version = ClinicalTemplateVersion(
                template_id=physio_tmpl.id,
                version_number=1,
                schema_json=PHYSIOTHERAPY_V1_SCHEMA,
                is_active=True,
                approved_by="SYSTEM",
            )
            session.add(version)
            session.flush()

    # 2. Ophthalmology
    ophth_dept = session.scalar(select(Department).where(Department.code == "OPHTHALMOLOGY"))
    if ophth_dept:
        ophth_tmpl = session.scalar(
            select(ClinicalTemplate).where(ClinicalTemplate.code == "OPHTHALMOLOGY")
        )
        if not ophth_tmpl:
            ophth_tmpl = ClinicalTemplate(
                department_id=ophth_dept.id,
                code="OPHTHALMOLOGY",
                name_en="Ophthalmology",
                name_hi="नेत्र रोग",
                is_active=True,
            )
            session.add(ophth_tmpl)
            session.flush()
            version = ClinicalTemplateVersion(
                template_id=ophth_tmpl.id,
                version_number=1,
                schema_json=OPHTHALMOLOGY_V1_SCHEMA,
                is_active=True,
                approved_by="SYSTEM",
            )
            session.add(version)
            session.flush()


def _to_template_read(tmpl: ClinicalTemplate) -> ClinicalTemplateRead:
    active_version = None
    for v in tmpl.versions:
        if v.is_active:
            if active_version is None or v.version_number > active_version.version_number:
                active_version = v

    active_v_read = None
    if active_version:
        active_v_read = ClinicalTemplateVersionRead.model_validate(active_version)

    return ClinicalTemplateRead(
        id=tmpl.id,
        department_id=tmpl.department_id,
        code=tmpl.code,
        name_en=tmpl.name_en,
        name_hi=tmpl.name_hi,
        is_active=tmpl.is_active,
        created_at=tmpl.created_at,
        active_version=active_v_read,
    )


@router.get("/active", response_model=list[ClinicalTemplateRead])
def list_active_templates(
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> list[ClinicalTemplateRead]:
    """List active specialty clinical templates with active schemas."""
    ensure_specialty_templates_seeded(session)
    templates = session.scalars(
        select(ClinicalTemplate).where(ClinicalTemplate.is_active.is_(True))
    ).all()
    return [_to_template_read(t) for t in templates]


@router.get("/by-department/{department_id}", response_model=ClinicalTemplateRead)
def get_template_by_department(
    department_id: int,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> ClinicalTemplateRead:
    """Retrieve active specialty clinical template and schema for department."""
    ensure_specialty_templates_seeded(session)
    tmpl = session.scalar(
        select(ClinicalTemplate).where(
            ClinicalTemplate.department_id == department_id,
            ClinicalTemplate.is_active.is_(True),
        )
    )
    if not tmpl:
        raise ApiError(
            status_code=404,
            code="template_not_found",
            message="No active clinical template found for department.",
        )
    return _to_template_read(tmpl)


@router.get("/versions/{version_id}", response_model=ClinicalTemplateVersionRead)
def get_template_version(
    version_id: int,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> ClinicalTemplateVersionRead:
    """Retrieve specific clinical template version schema."""
    version = session.get(ClinicalTemplateVersion, version_id)
    if not version:
        raise ApiError(
            status_code=404,
            code="template_version_not_found",
            message="Clinical template version not found.",
        )
    return ClinicalTemplateVersionRead.model_validate(version)


# ---------------------------------------------------------------------------
# Per-Document Bilingual Print Template Management (SET-01, BIL-04, D-20-04)
# ---------------------------------------------------------------------------

admin_router = APIRouter(prefix="/admin/templates", tags=["admin-templates"])

_TEMPLATE_AUDIT_FIELDS: tuple[str, ...] = (
    "document_type",
    "header_en",
    "header_hi",
    "footer_en",
    "footer_hi",
    "version",
)

DOC_TYPE_ORDER = [
    PrintDocumentType.PRESCRIPTION.value,
    PrintDocumentType.RECEIPT.value,
    PrintDocumentType.REGISTRATION_CARD.value,
    PrintDocumentType.CONSULTATION_SUMMARY.value,
]


def ensure_print_templates_seeded(session: Session, user_id: int | None = None) -> None:
    """Ensure all four print template document types exist in the database."""
    settings = session.scalar(select(ClinicSettings).where(ClinicSettings.id == 1))
    header_en = getattr(settings, "print_header_en", None) if settings else None
    header_hi = getattr(settings, "print_header_hi", None) if settings else None
    footer_en = getattr(settings, "print_footer_en", None) if settings else None
    footer_hi = getattr(settings, "print_footer_hi", None) if settings else None

    existing = session.scalars(select(PrintTemplate.document_type)).all()
    existing_set = set(existing)

    for doc_type in DOC_TYPE_ORDER:
        if doc_type not in existing_set:
            tmpl = PrintTemplate(
                document_type=doc_type,
                header_en=header_en,
                header_hi=header_hi,
                footer_en=footer_en,
                footer_hi=footer_hi,
                version=1,
                updated_by_user_id=user_id,
            )
            session.add(tmpl)
    session.flush()


@admin_router.get(
    "",
    dependencies=[Depends(require(Permission.SETTINGS_WRITE))],
    response_model=list[PrintTemplateRead],
)
def list_print_templates(
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> list[PrintTemplateRead]:
    """Retrieve all document print templates."""
    ensure_print_templates_seeded(session, principal.user_id)
    templates = session.scalars(select(PrintTemplate)).all()
    type_idx = {t: i for i, t in enumerate(DOC_TYPE_ORDER)}
    sorted_templates = sorted(templates, key=lambda t: type_idx.get(t.document_type, 99))
    return [PrintTemplateRead.model_validate(t) for t in sorted_templates]


@admin_router.get(
    "/{doc_type}",
    dependencies=[Depends(require(Permission.SETTINGS_WRITE))],
    response_model=PrintTemplateRead,
)
def get_print_template(
    doc_type: str,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> PrintTemplateRead:
    """Retrieve print template configuration for a document type."""
    ensure_print_templates_seeded(session, principal.user_id)
    template = session.scalar(select(PrintTemplate).where(PrintTemplate.document_type == doc_type))
    if not template:
        raise ApiError(
            status_code=404,
            code="template_not_found",
            message=f"Print template '{doc_type}' not found.",
        )
    return PrintTemplateRead.model_validate(template)


@admin_router.patch(
    "/{doc_type}",
    dependencies=[Depends(require(Permission.SETTINGS_WRITE))],
    response_model=PrintTemplateRead,
)
def update_print_template(
    doc_type: str,
    payload: PrintTemplateUpdate,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> PrintTemplateRead:
    """Update print template header/footer text with optimistic concurrency check."""
    ensure_print_templates_seeded(session, principal.user_id)
    template = session.scalar(select(PrintTemplate).where(PrintTemplate.document_type == doc_type))
    if not template:
        raise ApiError(
            status_code=404,
            code="template_not_found",
            message=f"Print template '{doc_type}' not found.",
        )

    if template.version != payload.version:
        raise ApiError(
            status_code=409,
            code="version_conflict",
            message="Record was modified by another user",
            entity="print_template",
            id=doc_type,
        )

    before_state = audit_service.snapshot(template, _TEMPLATE_AUDIT_FIELDS)

    # Sanitize and update fields
    template.header_en = payload.header_en.strip() if payload.header_en is not None else None
    template.header_hi = payload.header_hi.strip() if payload.header_hi is not None else None
    template.footer_en = payload.footer_en.strip() if payload.footer_en is not None else None
    template.footer_hi = payload.footer_hi.strip() if payload.footer_hi is not None else None
    template.updated_by_user_id = principal.user_id
    template.updated_at = datetime.now(UTC)

    session.flush()

    after_state = audit_service.snapshot(template, _TEMPLATE_AUDIT_FIELDS)

    ctx = build_audit_context(request, principal)
    audit_service.record(
        session,
        ctx,
        AuditAction.PRINT_TEMPLATE_UPDATED,
        "PRINT_TEMPLATE",
        template.document_type,
        before=before_state,
        after=after_state,
    )

    return PrintTemplateRead.model_validate(template)
