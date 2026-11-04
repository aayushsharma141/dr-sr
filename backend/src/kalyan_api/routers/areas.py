"""Role-specific area overview dashboard endpoints.

Protected by granular DASHBOARD_* permissions:
- GET /api/admin/overview: DASHBOARD_ADMIN
- GET /api/reception/overview: DASHBOARD_RECEPTION
- GET /api/doctor/overview: DASHBOARD_DOCTOR
"""

from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from kalyan_api import clock
from kalyan_api.config import Settings, get_settings
from kalyan_api.core.permissions import Permission
from kalyan_api.core.policy import require
from kalyan_api.core.principal import Principal, current_principal
from kalyan_api.db.session import SessionDep
from kalyan_api.models import (
    Appointment,
    AppointmentStatus,
    AuditLog,
    Doctor,
    Patient,
    Payment,
    PaymentMethod,
    User,
)
from kalyan_api.routers.system import measure_volume
from kalyan_api.services import billing_service
from kalyan_api.services.audit_service import AuditAction, Outcome
from kalyan_api.services.backup_service import latest_backup_info

router = APIRouter(tags=["areas"])

RECENT_ADMIN_ACTIONS_LIMIT = 10


class RoleUserCounts(BaseModel):
    """Active and inactive user counts for a specific role."""

    model_config = ConfigDict(extra="forbid")

    active: int = 0
    inactive: int = 0


class DoctorTodayOut(BaseModel):
    """Today's queue snapshot for one active doctor (IST business day)."""

    model_config = ConfigDict(extra="forbid")

    doctor_id: int
    name: str
    appointments_today: int
    waiting: int
    in_consultation: int
    done: int


class CollectionsTodayOut(BaseModel):
    """Today's ledger activity, reported without applying any netting rule.

    - payments_count / gross_paise / by_method: payments CREATED today (IST), including any
      that were later reversed.
    - reversals_count / reversed_paise: payments REVERSED today (IST), whatever day they were
      originally collected.
    """

    model_config = ConfigDict(extra="forbid")

    payments_count: int
    gross_paise: int
    reversals_count: int
    reversed_paise: int
    by_method: dict[str, int]


class RecentAdminActionOut(BaseModel):
    """One audit row written by an ADMIN actor."""

    model_config = ConfigDict(extra="forbid")

    occurred_at: datetime
    actor_username: str | None
    action: str
    entity_type: str | None
    entity_id: str | None
    outcome: str


class LastBackupOut(BaseModel):
    """Newest archive in the backup directory (manifest read only, archive not re-hashed)."""

    model_config = ConfigDict(extra="forbid")

    filename: str
    created_at: datetime
    size_bytes: int
    label: str | None
    manifest_readable: bool


class LastIntegrityCheckOut(BaseModel):
    """Latest INTEGRITY_CHECK_RUN audit row."""

    model_config = ConfigDict(extra="forbid")

    occurred_at: datetime
    outcome: str
    is_healthy: bool | None


class StorageFreeOut(BaseModel):
    """Free bytes on the volumes holding photos (data) and backups; null if not measurable."""

    model_config = ConfigDict(extra="forbid")

    data_free_bytes: int | None
    backup_free_bytes: int | None


class OverviewAlertOut(BaseModel):
    """Factual condition worth an administrator's attention (no invented thresholds)."""

    model_config = ConfigDict(extra="forbid")

    code: str
    severity: str
    message: str


class AdminOverviewResponse(BaseModel):
    """Admin dashboard summary metrics and account totals."""

    model_config = ConfigDict(extra="forbid")

    area: str = "admin"
    name: str
    role: str
    user_counts: dict[str, RoleUserCounts]
    business_date: date
    registrations_today: int
    appointments_today: dict[str, int]
    doctors_today: list[DoctorTodayOut]
    collections_today: CollectionsTodayOut
    outstanding_dues_paise: int
    locked_accounts: int
    failed_logins_24h: int
    recent_admin_actions: list[RecentAdminActionOut]
    last_backup: LastBackupOut | None
    last_backup_failure_at: datetime | None
    last_integrity_check: LastIntegrityCheckOut | None
    storage: StorageFreeOut
    alerts: list[OverviewAlertOut]


def _ist_day_bounds(day: date) -> tuple[datetime, datetime]:
    """Return [start, end) timezone-aware IST bounds for a business date."""
    start = datetime.combine(day, time.min, tzinfo=clock.IST)
    return start, start + timedelta(days=1)


def _appointments_today(session: Session, today: date) -> dict[str, int]:
    counts: dict[str, int] = {s.value: 0 for s in AppointmentStatus}
    rows = session.execute(
        select(Appointment.status, func.count(Appointment.id))
        .where(Appointment.appointment_date == today)
        .group_by(Appointment.status)
    ).all()
    for status_value, cnt in rows:
        counts[str(status_value)] = int(cnt)
    return counts


def _doctors_today(session: Session, today: date) -> list[DoctorTodayOut]:
    doctors = session.execute(
        select(Doctor.id, Doctor.name_en).where(Doctor.is_active.is_(True)).order_by(Doctor.id)
    ).all()
    per_doctor: dict[int, dict[str, int]] = {}
    rows = session.execute(
        select(Appointment.doctor_id, Appointment.status, func.count(Appointment.id))
        .where(Appointment.appointment_date == today)
        .group_by(Appointment.doctor_id, Appointment.status)
    ).all()
    for doctor_id, status_value, cnt in rows:
        per_doctor.setdefault(int(doctor_id), {})[str(status_value)] = int(cnt)

    result: list[DoctorTodayOut] = []
    for doctor_id, name_en in doctors:
        status_counts = per_doctor.get(int(doctor_id), {})
        result.append(
            DoctorTodayOut(
                doctor_id=int(doctor_id),
                name=name_en,
                appointments_today=sum(status_counts.values()),
                waiting=status_counts.get(AppointmentStatus.BOOKED.value, 0)
                + status_counts.get(AppointmentStatus.ARRIVED.value, 0),
                in_consultation=status_counts.get(AppointmentStatus.IN_CONSULTATION.value, 0),
                done=status_counts.get(AppointmentStatus.DONE.value, 0),
            )
        )
    return result


def _collections_today(session: Session, start: datetime, end: datetime) -> CollectionsTodayOut:
    by_method: dict[str, int] = {m.value: 0 for m in PaymentMethod}
    payments_count = 0
    gross_paise = 0
    rows = session.execute(
        select(
            Payment.payment_method,
            func.count(Payment.id),
            func.coalesce(func.sum(Payment.amount_paise), 0),
        )
        .where(Payment.created_at >= start, Payment.created_at < end)
        .group_by(Payment.payment_method)
    ).all()
    for method, cnt, total in rows:
        by_method[str(method)] = int(total)
        payments_count += int(cnt)
        gross_paise += int(total)

    reversal_row = session.execute(
        select(func.count(Payment.id), func.coalesce(func.sum(Payment.amount_paise), 0)).where(
            Payment.is_reversed.is_(True),
            Payment.reversed_at >= start,
            Payment.reversed_at < end,
        )
    ).one()

    return CollectionsTodayOut(
        payments_count=payments_count,
        gross_paise=gross_paise,
        reversals_count=int(reversal_row[0]),
        reversed_paise=int(reversal_row[1]),
        by_method=by_method,
    )


def _latest_audit(session: Session, action: AuditAction) -> AuditLog | None:
    return session.scalars(
        select(AuditLog)
        .where(AuditLog.action == action.value)
        .order_by(AuditLog.occurred_at.desc(), AuditLog.id.desc())
        .limit(1)
    ).first()


def _build_alerts(
    last_backup: LastBackupOut | None,
    last_backup_failure_at: datetime | None,
    locked_accounts: int,
    last_integrity: LastIntegrityCheckOut | None,
) -> list[OverviewAlertOut]:
    alerts: list[OverviewAlertOut] = []
    if last_backup is None:
        alerts.append(
            OverviewAlertOut(
                code="no_backup_yet",
                severity="warning",
                message="No backup archive was found in the backup directory.",
            )
        )
    if last_backup_failure_at is not None and (
        last_backup is None or last_backup_failure_at > last_backup.created_at
    ):
        alerts.append(
            OverviewAlertOut(
                code="last_backup_failed",
                severity="error",
                message="The most recent backup attempt failed after the last successful backup.",
            )
        )
    if locked_accounts > 0:
        alerts.append(
            OverviewAlertOut(
                code="accounts_locked",
                severity="warning",
                message=f"{locked_accounts} user account(s) are currently locked out.",
            )
        )
    if last_integrity is not None and (
        last_integrity.outcome != Outcome.SUCCESS.value or last_integrity.is_healthy is False
    ):
        alerts.append(
            OverviewAlertOut(
                code="integrity_issues",
                severity="error",
                message="The last integrity check did not complete cleanly.",
            )
        )
    return alerts


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

    counts_stmt = select(User.role, User.is_active, func.count(User.id)).group_by(
        User.role, User.is_active
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

    settings: Settings = get_settings()
    today = clock.ist_today()
    day_start, day_end = _ist_day_bounds(today)
    now_utc = clock.utcnow()

    registrations_today: int = (
        session.scalar(
            select(func.count(Patient.id)).where(
                Patient.created_at >= day_start, Patient.created_at < day_end
            )
        )
        or 0
    )

    # Reuse the pending-dues ledger computation (BIL-03) instead of duplicating the math.
    outstanding_dues_paise = sum(
        due.balance_paise for due in billing_service.compute_pending_dues(session)
    )

    locked_accounts: int = (
        session.scalar(
            select(func.count(User.id)).where(
                User.locked_until.is_not(None), User.locked_until > now_utc
            )
        )
        or 0
    )
    failed_logins_24h: int = (
        session.scalar(
            select(func.count(AuditLog.id)).where(
                AuditLog.action == AuditAction.AUTH_LOGIN_FAILED.value,
                AuditLog.occurred_at >= now_utc - timedelta(hours=24),
            )
        )
        or 0
    )

    recent_rows = session.scalars(
        select(AuditLog)
        .where(AuditLog.actor_role == "ADMIN")
        .order_by(AuditLog.occurred_at.desc(), AuditLog.id.desc())
        .limit(RECENT_ADMIN_ACTIONS_LIMIT)
    ).all()
    recent_admin_actions = [
        RecentAdminActionOut(
            occurred_at=r.occurred_at,
            actor_username=r.actor_username,
            action=r.action,
            entity_type=r.entity_type,
            entity_id=r.entity_id,
            outcome=r.outcome,
        )
        for r in recent_rows
    ]

    latest = latest_backup_info(settings.backup_dir)
    last_backup = (
        LastBackupOut(
            filename=latest.filename,
            created_at=latest.created_at,
            size_bytes=latest.size_bytes,
            label=latest.label,
            manifest_readable=latest.manifest_readable,
        )
        if latest is not None
        else None
    )

    failure_row = _latest_audit(session, AuditAction.BACKUP_FAILED)
    last_backup_failure_at = failure_row.occurred_at if failure_row is not None else None

    integrity_row = _latest_audit(session, AuditAction.INTEGRITY_CHECK_RUN)
    last_integrity: LastIntegrityCheckOut | None = None
    if integrity_row is not None:
        after_data = integrity_row.after_data or {}
        healthy_value = after_data.get("is_healthy")
        last_integrity = LastIntegrityCheckOut(
            occurred_at=integrity_row.occurred_at,
            outcome=integrity_row.outcome,
            is_healthy=healthy_value if isinstance(healthy_value, bool) else None,
        )

    storage = StorageFreeOut(
        data_free_bytes=measure_volume("photos", settings.photos_dir).free_bytes,
        backup_free_bytes=measure_volume("backups", settings.backup_dir).free_bytes,
    )

    return AdminOverviewResponse(
        area="admin",
        name=caller_name,
        role=principal.role.value if hasattr(principal.role, "value") else str(principal.role),
        user_counts=counts,
        business_date=today,
        registrations_today=registrations_today,
        appointments_today=_appointments_today(session, today),
        doctors_today=_doctors_today(session, today),
        collections_today=_collections_today(session, day_start, day_end),
        outstanding_dues_paise=outstanding_dues_paise,
        locked_accounts=locked_accounts,
        failed_logins_24h=failed_logins_24h,
        recent_admin_actions=recent_admin_actions,
        last_backup=last_backup,
        last_backup_failure_at=last_backup_failure_at,
        last_integrity_check=last_integrity,
        storage=storage,
        alerts=_build_alerts(last_backup, last_backup_failure_at, locked_accounts, last_integrity),
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
