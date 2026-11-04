"""Authoritative test suite verifying RBAC catalog pinning, role constraints, and invariants."""

import re

from test_route_policies import _policies, walk_routes

from kalyan_api.core.permissions import RESERVED, ROLE_PERMISSIONS, Permission, Role
from kalyan_api.main import create_app

CLINICAL_PERMISSIONS = frozenset(
    {
        Permission.ENCOUNTER_READ,
        Permission.ENCOUNTER_WRITE,
        Permission.PRESCRIPTION_READ,
        Permission.PRESCRIPTION_WRITE,
        Permission.PLAN_READ,
        Permission.PLAN_WRITE,
        Permission.SESSION_LOG_READ,
        Permission.SESSION_LOG_WRITE,
    }
)


def test_permissions_noun_verb_format() -> None:
    """Every permission string must follow strictly the 'noun:verb' pattern."""
    pattern = re.compile(r"^[a-z_]+:[a-z_]+$")
    for perm in Permission:
        assert pattern.match(perm.value), f"Permission {perm.value} does not match noun:verb"


def test_payment_create_restricted_exclusively_to_reception() -> None:
    """Reception is the only role permitted to collect and post payments."""
    for role, perms in ROLE_PERMISSIONS.items():
        if role == Role.RECEPTION:
            assert Permission.PAYMENT_CREATE in perms
        else:
            assert Permission.PAYMENT_CREATE not in perms, f"{role} must NOT have payment:create"


def test_payment_reverse_restricted_exclusively_to_admin() -> None:
    """D-06 Decision: Payment reversals are restricted exclusively to ADMIN."""
    for role, perms in ROLE_PERMISSIONS.items():
        if role == Role.ADMIN:
            assert Permission.PAYMENT_REVERSE in perms
        else:
            assert Permission.PAYMENT_REVERSE not in perms, f"{role} must NOT have payment:reverse"


def test_clinical_permissions_restricted_exclusively_to_doctor() -> None:
    """Clinical records belong exclusively to DOCTOR (D-03/D-04)."""
    admin_perms = ROLE_PERMISSIONS[Role.ADMIN]
    reception_perms = ROLE_PERMISSIONS[Role.RECEPTION]
    doctor_perms = ROLE_PERMISSIONS[Role.DOCTOR]

    for cp in CLINICAL_PERMISSIONS:
        assert cp not in admin_perms, f"ADMIN must NOT have clinical permission {cp.value}"
        assert cp not in reception_perms, f"RECEPTION must NOT have clinical permission {cp.value}"
        assert cp in doctor_perms, f"DOCTOR must possess clinical permission {cp.value}"


def test_no_orphan_permissions() -> None:
    """Every Permission is used by a route or tracked in RESERVED; no RESERVED key is in use."""
    app = create_app()
    used_permissions: set[Permission] = set()

    for _, _, dep in walk_routes(app):
        if dep is None:
            continue
        for pol in _policies(dep):
            if pol.kind == "require":
                for perm_str in pol.permissions:
                    used_permissions.add(Permission(perm_str))

    # Invariant 1: No RESERVED permission is currently bound to any route
    conflict = used_permissions & set(RESERVED.keys())
    assert not conflict, f"Permissions in RESERVED are actively used by routes: {conflict}"

    # Invariant 2: Active permissions + RESERVED permissions cover the entire Permission enum
    total_covered = used_permissions | set(RESERVED.keys())
    missing = set(Permission) - total_covered
    assert not missing, f"Permissions orphaned (not in active routes or RESERVED): {missing}"
    assert total_covered == set(Permission)


def test_golden_role_permissions_snapshot() -> None:
    """Golden snapshot test guaranteeing ROLE_PERMISSIONS remains identical to specification."""
    expected = {
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
                Permission.RECEIPT_REPRINT,
                Permission.PAYMENT_REVERSE,
                Permission.TIMELINE_READ,
                Permission.AUDIT_READ,
                Permission.BACKUP_RUN,
                Permission.BACKUP_RESTORE,
                Permission.INTEGRITY_RUN,
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
    assert ROLE_PERMISSIONS == expected
