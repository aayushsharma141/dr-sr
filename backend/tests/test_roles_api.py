"""Read-only role and permission catalogue endpoint tests (Admin module 02)."""

from collections.abc import Callable

from fastapi.testclient import TestClient

from kalyan_api.core.permissions import ROLE_PERMISSIONS, Permission, Role
from kalyan_api.models import User

PATH = "/api/roles/permissions"


def test_admin_reads_catalogue_derived_from_role_permissions(
    login_client: Callable[..., TestClient], admin_user: User
) -> None:
    """Roles, every permission and grants mirror ROLE_PERMISSIONS exactly."""
    res = login_client(admin_user).get(PATH)
    assert res.status_code == 200
    body = res.json()
    assert set(body.keys()) == {"roles", "permissions", "grants"}

    assert [r["role"] for r in body["roles"]] == [r.value for r in Role]
    labels = {r["role"]: r["label"] for r in body["roles"]}
    assert labels["ADMIN"] == "Administrator"
    assert all(label.strip() for label in labels.values())

    keys = [p["key"] for p in body["permissions"]]
    assert keys == [p.value for p in Permission]
    assert len(keys) == len(set(keys))
    for entry in body["permissions"]:
        assert set(entry.keys()) == {"key", "group", "label"}
        assert entry["group"].strip()
        assert entry["label"].strip()
        assert entry["label"] != entry["key"]

    assert set(body["grants"].keys()) == {r.value for r in Role}
    for role in Role:
        expected = sorted(p.value for p in ROLE_PERMISSIONS[role])
        assert body["grants"][role.value] == expected
        assert set(body["grants"][role.value]) <= set(keys)


def test_permission_groups_derived_from_noun(
    login_client: Callable[..., TestClient], admin_user: User
) -> None:
    """Groups follow the permission noun (users, clinical, billing, security)."""
    body = login_client(admin_user).get(PATH).json()
    groups = {p["key"]: p["group"] for p in body["permissions"]}
    assert groups[Permission.USER_READ.value] == "Users"
    assert groups[Permission.USER_RESET_PASSWORD.value] == "Users"
    assert groups[Permission.ENCOUNTER_WRITE.value] == "Clinical"
    assert groups[Permission.PRESCRIPTION_READ.value] == "Clinical"
    assert groups[Permission.PAYMENT_REVERSE.value] == "Billing"
    assert groups[Permission.RECEIPT_REPRINT.value] == "Billing"
    assert groups[Permission.SESSION_REVOKE.value] == "Security"
    assert groups[Permission.SECURITY_READ.value] == "Security"


def test_non_admin_roles_forbidden_and_anonymous_unauthenticated(
    client: TestClient,
    login_client: Callable[..., TestClient],
    reception_user: User,
    doctor_a_user: User,
) -> None:
    """RECEPTION and DOCTOR get 403; anonymous callers get 401."""
    assert client.get(PATH).status_code == 401
    rec = login_client(reception_user).get(PATH)
    assert rec.status_code == 403
    assert rec.json()["code"] == "forbidden"
    assert login_client(doctor_a_user).get(PATH).status_code == 403


def test_catalogue_is_not_editable(
    login_client: Callable[..., TestClient], admin_user: User
) -> None:
    """No write verbs exist on the catalogue."""
    admin_c = login_client(admin_user)
    for method in ("post", "put", "patch", "delete"):
        res = admin_c.request(method.upper(), PATH, json={})
        assert res.status_code == 405, method


def test_admin_grants_include_phase20_data_governance_permissions(
    login_client: Callable[..., TestClient], admin_user: User
) -> None:
    """D-20-01: Admin role includes patient:correct, patient:import, patient:export; lacks
    patient:update."""
    body = login_client(admin_user).get(PATH).json()
    admin_grants = set(body["grants"]["ADMIN"])
    assert Permission.PATIENT_CORRECT.value in admin_grants
    assert Permission.PATIENT_IMPORT.value in admin_grants
    assert Permission.PATIENT_EXPORT.value in admin_grants
    assert Permission.PATIENT_UPDATE.value not in admin_grants
    reception_grants = set(body["grants"]["RECEPTION"])
    assert Permission.PATIENT_CORRECT.value not in reception_grants
    assert Permission.PATIENT_IMPORT.value not in reception_grants
    assert Permission.PATIENT_EXPORT.value not in reception_grants
    doctor_grants = set(body["grants"]["DOCTOR"])
    assert Permission.PATIENT_CORRECT.value not in doctor_grants
    assert Permission.PATIENT_IMPORT.value not in doctor_grants
    assert Permission.PATIENT_EXPORT.value not in doctor_grants
