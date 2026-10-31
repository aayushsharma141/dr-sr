"""Row-level access authorization and default-deny scope filters for clinical privacy.

Architectural Guarantees:
- D-03: Doctor silo: clinical records (ScopeFamily.CLINICAL) are strictly scoped
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

    CLINICAL = "CLINICAL"
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

    role_str = (
        principal.role.value if hasattr(principal.role, "value") else str(principal.role)
    )

    if family == ScopeFamily.CLINICAL:
        # D-03 & D-04: Clinical rows visible only to the owning doctor with valid doctor_id
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

    return row
