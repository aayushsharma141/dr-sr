"""Admin department catalogue and doctor-specialty membership endpoints."""

import re

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from kalyan_api import clock
from kalyan_api.core.errors import ApiError, require_version
from kalyan_api.core.permissions import Permission
from kalyan_api.core.policy import require
from kalyan_api.core.principal import Principal, build_audit_context, current_principal
from kalyan_api.db.session import SessionDep
from kalyan_api.models import Department, Doctor
from kalyan_api.schemas.departments import (
    DepartmentCreate,
    DepartmentOut,
    DepartmentUpdate,
    DoctorDepartmentAssignment,
)
from kalyan_api.services import audit_service
from kalyan_api.services.audit_service import AuditAction

router = APIRouter(tags=["departments"])


def _unique_code(session: Session, name_en: str) -> str:
    """Machine code for a new department, e.g. "General Medicine" -> "GENERAL_MEDICINE".

    The code picks the specialty template, so it never changes after creation, even if the
    display name is edited later.
    """
    base = re.sub(r"[^A-Z0-9]+", "_", name_en.strip().upper()).strip("_")[:56] or "DEPARTMENT"
    code, n = base, 2
    while session.scalar(select(Department.id).where(Department.code == code)) is not None:
        code, n = f"{base}_{n}", n + 1
    return code


@router.get(
    "/departments",
    response_model=list[DepartmentOut],
    dependencies=[Depends(require(Permission.DOCTOR_READ))],
)
def list_departments(session: SessionDep) -> list[DepartmentOut]:
    rows = session.scalars(
        select(Department).where(Department.is_active.is_(True)).order_by(Department.name_en)
    ).all()
    return [DepartmentOut.model_validate(row) for row in rows]


@router.post(
    "/departments",
    status_code=201,
    response_model=DepartmentOut,
    dependencies=[Depends(require(Permission.DOCTOR_MANAGE))],
)
def create_department(
    payload: DepartmentCreate,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> DepartmentOut:
    row = Department(
        code=_unique_code(session, payload.name_en),
        name_en=payload.name_en.strip(),
        name_hi=payload.name_hi,
        description=payload.description,
    )
    session.add(row)
    session.flush()
    audit_service.record(
        session,
        build_audit_context(request, principal),
        action=AuditAction.DEPARTMENT_CREATED,
        entity_type="DEPARTMENT",
        entity_id=row.id,
        after={"name_en": row.name_en, "name_hi": row.name_hi},
    )
    return DepartmentOut.model_validate(row)


@router.patch(
    "/departments/{department_id}",
    response_model=DepartmentOut,
    dependencies=[Depends(require(Permission.DOCTOR_MANAGE))],
)
def update_department(
    department_id: int,
    payload: DepartmentUpdate,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> DepartmentOut:
    row = session.scalar(select(Department).where(Department.id == department_id).with_for_update())
    if row is None:
        raise ApiError(
            status_code=404, code="department_not_found", message="Department not found."
        )
    require_version(row, payload.version_id, "department")
    before = {
        "name_en": row.name_en,
        "name_hi": row.name_hi,
        "description": row.description,
        "is_active": row.is_active,
    }
    row.name_en, row.name_hi, row.description, row.is_active = (
        payload.name_en.strip(),
        payload.name_hi,
        payload.description,
        payload.is_active,
    )
    session.flush()
    after = {
        "name_en": row.name_en,
        "name_hi": row.name_hi,
        "description": row.description,
        "is_active": row.is_active,
    }
    audit_service.record(
        session,
        build_audit_context(request, principal),
        action=AuditAction.DEPARTMENT_UPDATED,
        entity_type="DEPARTMENT",
        entity_id=row.id,
        before=before,
        after=after,
    )
    return DepartmentOut.model_validate(row)


@router.get(
    "/departments/{department_id}/doctors",
    response_model=list[dict],
    dependencies=[Depends(require(Permission.DOCTOR_READ))],
)
def list_department_doctors(department_id: int, session: SessionDep) -> list[dict]:
    department = session.get(Department, department_id)
    if department is None or not department.is_active:
        raise ApiError(
            status_code=404, code="department_not_found", message="Department not found."
        )
    doctors = session.scalars(
        select(Doctor)
        .join(Doctor.departments)
        .where(
            Department.id == department_id,
            Department.is_active.is_(True),
            Doctor.is_active.is_(True),
        )
        .order_by(Doctor.name_en)
    ).all()
    return [
        {
            "id": d.id,
            "name_en": d.name_en,
            "name_hi": d.name_hi,
            "qualification": d.qualification,
            "default_fee_paise": d.default_fee_paise,
        }
        for d in doctors
    ]


@router.get(
    "/doctors/{doctor_id}/departments",
    response_model=list[DepartmentOut],
    dependencies=[Depends(require(Permission.DOCTOR_READ))],
)
def list_doctor_departments(doctor_id: int, session: SessionDep) -> list[DepartmentOut]:
    doctor = session.get(Doctor, doctor_id)
    if doctor is None:
        raise ApiError(status_code=404, code="doctor_not_found", message="Doctor not found.")
    return [
        DepartmentOut.model_validate(row)
        for row in sorted(doctor.departments, key=lambda item: item.name_en)
    ]


@router.put(
    "/doctors/{doctor_id}/departments",
    response_model=list[DepartmentOut],
    dependencies=[Depends(require(Permission.DOCTOR_MANAGE))],
)
def assign_doctor_departments(
    doctor_id: int,
    payload: DoctorDepartmentAssignment,
    request: Request,
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> list[DepartmentOut]:
    doctor = session.scalar(select(Doctor).where(Doctor.id == doctor_id).with_for_update())
    if doctor is None:
        raise ApiError(status_code=404, code="doctor_not_found", message="Doctor not found.")
    require_version(doctor, payload.version_id, "doctor")
    ids = sorted(set(payload.department_ids))
    if len(ids) != len(payload.department_ids):
        raise ApiError(
            status_code=422, code="duplicate_department", message="Department IDs must be unique."
        )
    before_ids = sorted(d.id for d in doctor.departments)
    departments = session.scalars(select(Department).where(Department.id.in_(ids))).all()
    # A department deactivated later must not block saving the doctor's other memberships, so
    # an existing membership may stay. Only new memberships have to be active.
    usable = [d for d in departments if d.is_active or d.id in before_ids]
    if len(usable) != len(ids):
        raise ApiError(
            status_code=422,
            code="invalid_department",
            message="All assigned departments must exist and be active.",
        )
    if ids != before_ids:
        doctor.departments = departments
        # Changing only the join table leaves version_id alone, so a stale save would pass
        # require_version. Touching a column makes the ORM update the row and bump the version.
        doctor.updated_at = clock.utcnow()
    session.flush()
    audit_service.record(
        session,
        build_audit_context(request, principal),
        action=AuditAction.DOCTOR_DEPARTMENTS_UPDATED,
        entity_type="DOCTOR",
        entity_id=doctor.id,
        before={"department_ids": before_ids},
        after={"department_ids": ids},
    )
    return [DepartmentOut.model_validate(d) for d in departments]
