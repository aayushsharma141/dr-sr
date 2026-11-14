"""Row-level access authorization and default-deny scope filters for clinical privacy.

Architectural Guarantees:
- DWS-04: Cross-doctor clinical reads: any authenticated doctor can read clinical records
  (ScopeFamily.CLINICAL_READ), triggering audited CROSS_DOCTOR_CLINICAL_READ entries.
- D-03: Doctor silo: clinical mutations (ScopeFamily.CLINICAL_WRITE) are strictly scoped
  to the owning doctor (doctor_id_col == principal.doctor_id).
- D-04: Reception default-deny for clinical encounters and notes.
- Informational leaks prevented: get_scoped_or_404 returns 404 not_found
  indistinguishable from a missing ID (never forbidden/denial code).
- Default-deny architecture: unknown roles, None principals, and NULL doctor_id
  clinical rows evaluate strictly to false().
- Doctor ID reassignment is Admin-only and audited (EG-18).
- Later list/search/count and update/finalise paths must build on row_scope
  and load via get_scoped_or_404.
"""

from enum import StrEnum
from typing import Any

from sqlalchemy import ColumnElement, Table, false, select, true
from sqlalchemy.orm import Session

from kalyan_api.core.errors import ApiError
from kalyan_api.core.permissions import Role
from kalyan_api.core.principal import Principal

# Registry of models participating in row-level scope authorization
SCOPED_MODELS: list[Any] = []


class ScopeFamily(StrEnum):
    """Scope domain families governing row-level access."""

    CLINICAL_READ = "CLINICAL_READ"
    CLINICAL_WRITE = "CLINICAL_WRITE"
    CLINICAL = "CLINICAL_WRITE"  # Alias for backward compatibility
    DEMOGRAPHIC = "DEMOGRAPHIC"
    FINANCIAL = "FINANCIAL"


def row_scope(
    principal: Principal | None,
    family: ScopeFamily,
    doctor_id_col: Any,
) -> ColumnElement[bool]:
    """Build default-deny SQLAlchemy WHERE expression governing row access."""
    if principal is None:
        return false()

    role_str = principal.role.value if hasattr(principal.role, "value") else str(principal.role)

    if family == ScopeFamily.CLINICAL_READ or str(family) == "CLINICAL_READ":
        # DWS-04: Any authenticated doctor can read clinical rows across all doctors
        if role_str == Role.DOCTOR.value and principal.doctor_id is not None:
            return true()
        return false()

    if family in (ScopeFamily.CLINICAL_WRITE, ScopeFamily.CLINICAL) or str(family) in (
        "CLINICAL_WRITE",
        "CLINICAL",
    ):
        # D-03 & D-04: Clinical mutations scoped strictly to the owning doctor
        if role_str == Role.DOCTOR.value and principal.doctor_id is not None:
            return doctor_id_col == principal.doctor_id
        return false()

    if family == ScopeFamily.DEMOGRAPHIC:
        # Demographic: Reception and Admin have broad access; Doctor sees own
        if role_str in (Role.ADMIN.value, Role.RECEPTION.value):
            return true()
        if role_str == Role.DOCTOR.value and principal.doctor_id is not None:
            return doctor_id_col == principal.doctor_id
        return false()

    if family == ScopeFamily.FINANCIAL:
        # Financial: Reception and Admin have access; Doctor default-deny
        if role_str in (Role.ADMIN.value, Role.RECEPTION.value):
            return true()
        return false()

    return false()


def get_scoped_or_404(
    session: Session,
    target: Any,
    obj_id: Any,
    principal: Principal,
    family: ScopeFamily,
    doctor_id_col: Any,
    id_col: Any = None,
) -> Any:
    """Load object by ID and scope filter; raise 404 not_found on scope mismatch or missing ID."""
    if id_col is None:
        if isinstance(target, Table):
            id_col = target.c.id
        else:
            id_col = target.id

    scope_filter = row_scope(principal, family, doctor_id_col)
    stmt = select(target).where(id_col == obj_id, scope_filter)

    if isinstance(target, Table):
        row = session.execute(stmt).first()
    else:
        row = session.execute(stmt).scalar_one_or_none()

    if row is None:
        raise ApiError(
            status_code=404,
            code="not_found",
            message="Resource not found",
        )

    # Cross-doctor clinical read audit logging
    role_str = principal.role.value if hasattr(principal.role, "value") else str(principal.role)
    if (
        (family == ScopeFamily.CLINICAL_READ or str(family) == "CLINICAL_READ")
        and role_str == Role.DOCTOR.value
        and principal.doctor_id is not None
    ):
        row_doc_id = getattr(row, "doctor_id", None)
        if row_doc_id is not None and row_doc_id != principal.doctor_id:
            from kalyan_api.services import audit_service
            from kalyan_api.services.audit_service import AuditAction

            entity_type = (
                target.__name__
                if hasattr(target, "__name__")
                else getattr(target, "name", str(target))
            )
            audit_service.record_audit_event(
                session,
                actor_user_id=principal.user_id,
                action=AuditAction.CROSS_DOCTOR_CLINICAL_READ,
                entity_type=entity_type,
                entity_id=obj_id,
                details={
                    "actor_doctor_id": principal.doctor_id,
                    "record_doctor_id": row_doc_id,
                    "patient_id": getattr(row, "patient_id", None),
                },
                actor_username=principal.username,
                actor_role=role_str,
            )

    return row


def other_doctors_record_ids(principal: Principal | None, rows: Any) -> list[int]:
    """IDs of rows owned by a different doctor than the calling doctor (empty for other roles)."""
    if principal is None or principal.doctor_id is None:
        return []
    role_str = principal.role.value if hasattr(principal.role, "value") else str(principal.role)
    if role_str != Role.DOCTOR.value:
        return []
    return [
        row.id for row in rows if row.doctor_id is not None and row.doctor_id != principal.doctor_id
    ]


def audit_cross_doctor_list_read(
    session: Session,
    principal: Principal,
    patient_id: int,
    source: str,
    rows: Any,
) -> None:
    """Audit a doctor's list read that returned other doctors' clinical rows (BR-010, DWS-04).

    get_scoped_or_404 audits single-record reads; a list query bypasses it, so list endpoints
    call this once per request. Nothing is written when every row belongs to the caller.
    """
    ids = other_doctors_record_ids(principal, rows)
    if not ids:
        return

    from kalyan_api.services import audit_service
    from kalyan_api.services.audit_service import AuditAction

    audit_service.record_audit_event(
        session,
        actor_user_id=principal.user_id,
        action=AuditAction.CROSS_DOCTOR_CLINICAL_READ,
        entity_type="Patient",
        entity_id=patient_id,
        details={
            "source": source,
            "actor_doctor_id": principal.doctor_id,
            "patient_id": patient_id,
            "record_ids": ids,
        },
        actor_username=principal.username,
        actor_role=Role.DOCTOR.value,
    )
