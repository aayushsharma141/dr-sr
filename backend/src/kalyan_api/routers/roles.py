"""Read-only fixed role catalogue endpoints (Admin Panel module 02).

Guarantees:
- The view is derived solely from core.permissions.ROLE_PERMISSIONS; nothing is stored and
  nothing is editable (SEC-03 fixes the three roles; per-user permissions are out of scope).
- Every Permission enum member is listed, including permissions granted to no role.
- Display labels are descriptive only; enforcement remains server-side via require().
"""

from fastapi import APIRouter, Depends

from kalyan_api.core.permissions import ROLE_PERMISSIONS, Permission, Role
from kalyan_api.core.policy import require
from kalyan_api.schemas.roles import PermissionInfo, RoleInfo, RolePermissionsOut

router = APIRouter(prefix="/roles", tags=["roles"])

ROLE_LABELS: dict[Role, str] = {
    Role.ADMIN: "Administrator",
    Role.RECEPTION: "Reception",
    Role.DOCTOR: "Doctor",
}

# Display group for each permission noun (the part before the colon).
NOUN_GROUPS: dict[str, str] = {
    "user": "Users",
    "session": "Security",
    "security": "Security",
    "dashboard": "Dashboards",
    "settings": "Clinic settings",
    "doctor": "Doctors & fees",
    "fee": "Doctors & fees",
    "patient": "Patients",
    "photo": "Patients",
    "timeline": "Patients",
    "appointment": "Appointments",
    "encounter": "Clinical",
    "prescription": "Clinical",
    "plan": "Treatment",
    "session_log": "Treatment",
    "payment": "Billing",
    "receipt": "Billing",
    "audit": "Audit",
    "backup": "Backup & restore",
    "integrity": "System",
    "system": "System",
}

PERMISSION_LABELS: dict[Permission, str] = {
    Permission.USER_READ: "View user accounts",
    Permission.USER_CREATE: "Create user accounts",
    Permission.USER_UPDATE: "Edit user accounts",
    Permission.USER_DEACTIVATE: "Deactivate and reactivate user accounts",
    Permission.USER_RESET_PASSWORD: "Reset user passwords",
    Permission.USER_UNLOCK: "Unlock locked user accounts",
    Permission.DASHBOARD_ADMIN: "Open the administrator dashboard",
    Permission.DASHBOARD_RECEPTION: "Open the reception dashboard",
    Permission.DASHBOARD_DOCTOR: "Open the doctor dashboard",
    Permission.SETTINGS_READ: "View clinic settings",
    Permission.SETTINGS_WRITE: "Change clinic settings",
    Permission.DOCTOR_READ: "View doctors",
    Permission.DOCTOR_MANAGE: "Manage doctor profiles",
    Permission.FEE_READ: "View fee schedule",
    Permission.FEE_MANAGE: "Manage fee schedule",
    Permission.PATIENT_READ: "View patients",
    Permission.PATIENT_CREATE: "Register patients",
    Permission.PATIENT_UPDATE: "Edit patient details",
    Permission.PHOTO_READ: "View patient photos",
    Permission.PHOTO_WRITE: "Upload patient photos",
    Permission.APPOINTMENT_READ: "View appointments",
    Permission.APPOINTMENT_WRITE: "Book and update appointments",
    Permission.ENCOUNTER_READ: "View clinical encounters",
    Permission.ENCOUNTER_WRITE: "Write clinical encounters",
    Permission.PRESCRIPTION_READ: "View prescriptions",
    Permission.PRESCRIPTION_WRITE: "Write prescriptions",
    Permission.PLAN_READ: "View treatment plans",
    Permission.PLAN_WRITE: "Create and update treatment plans",
    Permission.SESSION_LOG_READ: "View physiotherapy session records",
    Permission.SESSION_LOG_WRITE: "Record physiotherapy sessions",
    Permission.PAYMENT_READ: "View payments and dues",
    Permission.PAYMENT_CREATE: "Record payments",
    Permission.RECEIPT_REPRINT: "Reprint receipts",
    Permission.PAYMENT_REVERSE: "Reverse payments",
    Permission.TIMELINE_READ: "View patient timeline",
    Permission.AUDIT_READ: "View the audit log",
    Permission.BACKUP_RUN: "Run backups",
    Permission.BACKUP_RESTORE: "Restore from backup",
    Permission.INTEGRITY_RUN: "Run integrity checks",
    Permission.SESSION_READ: "View active login sessions",
    Permission.SESSION_REVOKE: "Sign out login sessions",
    Permission.SECURITY_READ: "View security policy",
    Permission.SECURITY_WRITE: "Tighten security policy",
    Permission.BACKUP_CONFIGURE: "Configure backup schedule and retention",
    Permission.SYSTEM_READ: "View system health",
}


def _split_key(permission: Permission) -> tuple[str, str]:
    """Split a noun:verb permission key into its noun and verb parts."""
    noun, _, verb = permission.value.partition(":")
    return noun, verb


def permission_group(permission: Permission) -> str:
    """Display group derived from the permission noun, title-cased when unmapped."""
    noun, _ = _split_key(permission)
    return NOUN_GROUPS.get(noun, noun.replace("_", " ").capitalize())


def permission_label(permission: Permission) -> str:
    """Plain-English label, derived from verb and noun when no explicit label exists."""
    explicit = PERMISSION_LABELS.get(permission)
    if explicit is not None:
        return explicit
    noun, verb = _split_key(permission)
    return f"{verb.replace('_', ' ').capitalize()} {noun.replace('_', ' ')}"


@router.get(
    "/permissions",
    response_model=RolePermissionsOut,
    dependencies=[Depends(require(Permission.USER_READ))],
)
def get_role_permissions() -> RolePermissionsOut:
    """Return the fixed roles, every permission, and which permissions each role holds."""
    roles = [RoleInfo(role=r.value, label=ROLE_LABELS.get(r, r.value.title())) for r in Role]
    permissions = [
        PermissionInfo(key=p.value, group=permission_group(p), label=permission_label(p))
        for p in Permission
    ]
    grants = {r.value: sorted(p.value for p in ROLE_PERMISSIONS.get(r, frozenset())) for r in Role}
    return RolePermissionsOut(roles=roles, permissions=permissions, grants=grants)
