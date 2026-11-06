"""Specialty clinical templates registry endpoints (DWS-05, D-19-10..13)."""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from kalyan_api.core.errors import ApiError
from kalyan_api.core.permissions import Permission
from kalyan_api.core.policy import require
from kalyan_api.core.principal import Principal, current_principal
from kalyan_api.db.session import SessionDep
from kalyan_api.models import ClinicalTemplate, ClinicalTemplateVersion, Department
from kalyan_api.schemas.templates import (
    OPHTHALMOLOGY_V1_SCHEMA,
    PHYSIOTHERAPY_V1_SCHEMA,
    ClinicalTemplateRead,
    ClinicalTemplateVersionRead,
)

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
