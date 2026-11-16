"""RBAC tests for Phase 23 permissions."""

import pytest
from kalyan_api.core.permissions import ROLE_PERMISSIONS, Permission, Role


def test_phase23_permissions_exist():
    """Verify Phase 23 permissions exist in the Permission enum."""
    assert hasattr(Permission, "PATIENT_MERGE")
    assert hasattr(Permission, "PATIENT_ARCHIVE")
    assert hasattr(Permission, "WORKSTATION_READ")
    assert Permission.PATIENT_MERGE.value == "patient:merge"
    assert Permission.PATIENT_ARCHIVE.value == "patient:archive"
    assert Permission.WORKSTATION_READ.value == "workstation:read"


def test_phase23_permissions_role_matrix():
    """Verify only Role.ADMIN possesses Phase 23 permissions; RECEPTION and DOCTOR do not."""
    admin_perms = ROLE_PERMISSIONS[Role.ADMIN]
    assert Permission.PATIENT_MERGE in admin_perms
    assert Permission.PATIENT_ARCHIVE in admin_perms
    assert Permission.WORKSTATION_READ in admin_perms

    reception_perms = ROLE_PERMISSIONS[Role.RECEPTION]
    assert Permission.PATIENT_MERGE not in reception_perms
    assert Permission.PATIENT_ARCHIVE not in reception_perms
    assert Permission.WORKSTATION_READ not in reception_perms

    doctor_perms = ROLE_PERMISSIONS[Role.DOCTOR]
    assert Permission.PATIENT_MERGE not in doctor_perms
    assert Permission.PATIENT_ARCHIVE not in doctor_perms
    assert Permission.WORKSTATION_READ not in doctor_perms
