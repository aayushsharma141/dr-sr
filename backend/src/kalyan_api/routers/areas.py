"""Role-specific area overview dashboard endpoints.

Protected by granular DASHBOARD_* permissions:
- GET /api/admin/overview: DASHBOARD_ADMIN
- GET /api/reception/overview: DASHBOARD_RECEPTION
- GET /api/doctor/overview: DASHBOARD_DOCTOR
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select

from kalyan_api.core.permissions import Permission
from kalyan_api.core.policy import require
from kalyan_api.core.principal import Principal, current_principal
from kalyan_api.db.session import SessionDep
from kalyan_api.models import Doctor, User

router = APIRouter(tags=["areas"])


class RoleUserCounts(BaseModel):
    """Active and inactive user counts for a specific role."""

    model_config = ConfigDict(extra="forbid")

    active: int = 0
    inactive: int = 0


class AdminOverviewResponse(BaseModel):
    """Admin dashboard summary metrics and account totals."""

    model_config = ConfigDict(extra="forbid")

    area: str = "admin"
    name: str
    role: str
    user_counts: dict[str, RoleUserCounts]


class ReceptionOverviewResponse(BaseModel):
    """Reception dashboard summary."""

    model_config = ConfigDict(extra="forbid")

    area: str = "reception"
    name: str
    role: str


class DoctorOverviewResponse(BaseModel):
    """Doctor dashboard summary including doctor ID and profile name."""

    model_config = ConfigDict(extra="forbid")

    area: str = "doctor"
    name: str
    role: str
    doctor_id: int
    doctor_name_en: str


@router.get(
    "/admin/overview",
    response_model=AdminOverviewResponse,
    dependencies=[Depends(require(Permission.DASHBOARD_ADMIN))],
)
def get_admin_overview(
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> AdminOverviewResponse:
    """Return administrative overview metrics and user counts across all roles."""
    user = session.scalar(select(User).where(User.id == principal.user_id))
    caller_name = user.full_name if user else principal.username

    counts_stmt = (
        select(User.role, User.is_active, func.count(User.id))
        .group_by(User.role, User.is_active)
    )
    rows = session.execute(counts_stmt).all()

    counts: dict[str, RoleUserCounts] = {
        "ADMIN": RoleUserCounts(),
        "RECEPTION": RoleUserCounts(),
        "DOCTOR": RoleUserCounts(),
    }
    for role, is_active, cnt in rows:
        if role not in counts:
            counts[role] = RoleUserCounts()
        if is_active:
            counts[role].active += cnt
        else:
            counts[role].inactive += cnt

    return AdminOverviewResponse(
        area="admin",
        name=caller_name,
        role=principal.role.value if hasattr(principal.role, "value") else str(principal.role),
        user_counts=counts,
    )


@router.get(
    "/reception/overview",
    response_model=ReceptionOverviewResponse,
    dependencies=[Depends(require(Permission.DASHBOARD_RECEPTION))],
)
def get_reception_overview(
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> ReceptionOverviewResponse:
    """Return reception overview profile."""
    user = session.scalar(select(User).where(User.id == principal.user_id))
    caller_name = user.full_name if user else principal.username

    return ReceptionOverviewResponse(
        area="reception",
        name=caller_name,
        role=principal.role.value if hasattr(principal.role, "value") else str(principal.role),
    )


@router.get(
    "/doctor/overview",
    response_model=DoctorOverviewResponse,
    dependencies=[Depends(require(Permission.DASHBOARD_DOCTOR))],
)
def get_doctor_overview(
    session: SessionDep,
    principal: Principal = Depends(current_principal),
) -> DoctorOverviewResponse:
    """Return doctor overview with doctor_id and linked doctor profile."""
    user = session.scalar(select(User).where(User.id == principal.user_id))
    caller_name = user.full_name if user else principal.username

    doctor_id = principal.doctor_id or 0
    doctor_name = ""
    if principal.doctor_id:
        doc = session.get(Doctor, principal.doctor_id)
        if doc:
            doctor_name = doc.name_en

    return DoctorOverviewResponse(
        area="doctor",
        name=caller_name,
        role=principal.role.value if hasattr(principal.role, "value") else str(principal.role),
        doctor_id=doctor_id,
        doctor_name_en=doctor_name,
    )
