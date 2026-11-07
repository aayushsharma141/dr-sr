"""Role definitions, granular permission enumeration, and system RBAC mapping.

Locked decisions:
- SEC-03: Roles strictly limited to ADMIN, RECEPTION, DOCTOR.
- D-03: Doctor silo; clinical records belong exclusively to DOCTOR.
- D-04: Reception default-deny for clinical encounters and notes.
- D-06: Payment reversals restricted exclusively to ADMIN.
- EG-16: Admin default: operational administration, audit, and user management; no clinical content.
"""

from enum import StrEnum


class Role(StrEnum):
    """System roles authorized across Kalyan Hospital platform."""

    ADMIN = "ADMIN"
    RECEPTION = "RECEPTION"
    DOCTOR = "DOCTOR"


class Permission(StrEnum):
    """Granular permissions following noun:verb convention."""

    # Phase 11: Foundation & User Administration
    USER_READ = "user:read"
    USER_CREATE = "user:create"
    USER_UPDATE = "user:update"
    USER_DEACTIVATE = "user:deactivate"
    USER_RESET_PASSWORD = "user:reset_password"  # noqa: S105
    USER_UNLOCK = "user:unlock"
    DASHBOARD_ADMIN = "dashboard:admin"
    DASHBOARD_RECEPTION = "dashboard:reception"
    DASHBOARD_DOCTOR = "dashboard:doctor"

    # Phase 12: Clinic Settings & Patient Registration
    SETTINGS_READ = "settings:read"
    SETTINGS_WRITE = "settings:write"
    DOCTOR_READ = "doctor:read"
    DOCTOR_MANAGE = "doctor:manage"
    FEE_READ = "fee:read"
    FEE_MANAGE = "fee:manage"
    PATIENT_READ = "patient:read"
    PATIENT_CREATE = "patient:create"
    PATIENT_UPDATE = "patient:update"
    PHOTO_READ = "photo:read"
    PHOTO_WRITE = "photo:write"

    # Phase 13: Appointments & Clinical Encounters
    APPOINTMENT_READ = "appointment:read"
    APPOINTMENT_WRITE = "appointment:write"
    ENCOUNTER_READ = "encounter:read"
    ENCOUNTER_WRITE = "encounter:write"

    # Phase 14: Prescriptions, Treatment Plans & Sessions
    PRESCRIPTION_READ = "prescription:read"
    PRESCRIPTION_WRITE = "prescription:write"
    PLAN_READ = "plan:read"
    PLAN_WRITE = "plan:write"
    SESSION_LOG_READ = "session_log:read"
    SESSION_LOG_WRITE = "session_log:write"

    # Phase 15: Billing, Receipts & Reversals (Reserved)
    PAYMENT_READ = "payment:read"
    PAYMENT_CREATE = "payment:create"
    RECEIPT_REPRINT = "receipt:reprint"
    PAYMENT_REVERSE = "payment:reverse"  # D-06: Admin only
    TIMELINE_READ = "timeline:read"

    # Phase 16: Audit Viewer, Backup/Restore & Integrity (Reserved)
    AUDIT_READ = "audit:read"
    BACKUP_RUN = "backup:run"
    BACKUP_RESTORE = "backup:restore"
    INTEGRITY_RUN = "integrity:run"

    # Admin Panel expansion: authority, security center and system health
    SESSION_READ = "session:read"
    SESSION_REVOKE = "session:revoke"
    SECURITY_READ = "security:read"
    SECURITY_WRITE = "security:write"
    BACKUP_CONFIGURE = "backup:configure"
    SYSTEM_READ = "system:read"

    # Phase 20: Admin Data Governance & Asset Management (D-20-01)
    PATIENT_CORRECT = "patient:correct"
    PATIENT_IMPORT = "patient:import"
    PATIENT_EXPORT = "patient:export"


# Authoritative role-to-permissions catalog
ROLE_PERMISSIONS: dict[Role, frozenset[Permission]] = {
    Role.ADMIN: frozenset(
        {
            Permission.USER_READ,
            Permission.USER_CREATE,
            Permission.USER_UPDATE,
            Permission.USER_DEACTIVATE,
            Permission.USER_RESET_PASSWORD,
            Permission.USER_UNLOCK,
            Permission.DASHBOARD_ADMIN,
            Permission.SETTINGS_READ,
            Permission.SETTINGS_WRITE,
            Permission.DOCTOR_READ,
            Permission.DOCTOR_MANAGE,
            Permission.FEE_READ,
            Permission.FEE_MANAGE,
            Permission.PATIENT_READ,
            Permission.APPOINTMENT_READ,
            Permission.PAYMENT_READ,
            Permission.PAYMENT_CREATE,
            Permission.RECEIPT_REPRINT,
            Permission.PAYMENT_REVERSE,
            Permission.TIMELINE_READ,
            Permission.AUDIT_READ,
            Permission.BACKUP_RUN,
            Permission.BACKUP_RESTORE,
            Permission.INTEGRITY_RUN,
            Permission.SESSION_READ,
            Permission.SESSION_REVOKE,
            Permission.SECURITY_READ,
            Permission.SECURITY_WRITE,
            Permission.BACKUP_CONFIGURE,
            Permission.SYSTEM_READ,
            Permission.PATIENT_CORRECT,
            Permission.PATIENT_IMPORT,
            Permission.PATIENT_EXPORT,
        }
    ),
    Role.RECEPTION: frozenset(
        {
            Permission.DASHBOARD_RECEPTION,
            Permission.SETTINGS_READ,
            Permission.DOCTOR_READ,
            Permission.FEE_READ,
            Permission.PATIENT_READ,
            Permission.PATIENT_CREATE,
            Permission.PATIENT_UPDATE,
            Permission.PHOTO_READ,
            Permission.PHOTO_WRITE,
            Permission.APPOINTMENT_READ,
            Permission.APPOINTMENT_WRITE,
            Permission.PAYMENT_READ,
            Permission.PAYMENT_CREATE,
            Permission.RECEIPT_REPRINT,
            Permission.TIMELINE_READ,
        }
    ),
    Role.DOCTOR: frozenset(
        {
            Permission.DASHBOARD_DOCTOR,
            Permission.SETTINGS_READ,
            Permission.DOCTOR_READ,
            Permission.FEE_READ,
            Permission.PATIENT_READ,
            Permission.APPOINTMENT_READ,
            Permission.APPOINTMENT_WRITE,
            Permission.ENCOUNTER_READ,
            Permission.ENCOUNTER_WRITE,
            Permission.PRESCRIPTION_READ,
            Permission.PRESCRIPTION_WRITE,
            Permission.PLAN_READ,
            Permission.PLAN_WRITE,
            Permission.SESSION_LOG_READ,
            Permission.SESSION_LOG_WRITE,
            Permission.TIMELINE_READ,
        }
    ),
}

# Mapping of future permissions reserved for upcoming phases
RESERVED: dict[Permission, str] = {
    Permission.PATIENT_CORRECT: "Phase 20 Plan 05: Admin demographic correction endpoint",
    Permission.PATIENT_IMPORT: "Phase 20 Plan 06: Admin import centre endpoint",
    Permission.PATIENT_EXPORT: "Phase 20 Plan 07: Admin export centre endpoint",
}
