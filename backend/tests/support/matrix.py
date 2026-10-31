"""RBAC role-by-endpoint matrix definition, runner, and completeness checker.

Guarantees:
- Every non-public route is defined in MATRIX with expected HTTP status for each role.
- Completeness checker ensures no newly registered route ships without an RBAC matrix row.
- Runner isolates each cell by provisioning dedicated users to avoid test pollution.
"""

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from test_route_policies import _policies, walk_routes

from kalyan_api.config import Settings
from kalyan_api.models import User

IDENTITIES = ("anonymous", "admin", "reception", "doctor_a", "doctor_b")


@dataclass(frozen=True)
class MatrixRow:
    """RBAC matrix specification row."""

    method: str
    path: str
    body_factory: Callable[[], dict[str, Any] | None] | None
    expected: dict[str, int]


def _change_password_payload(_target: User | None = None) -> dict[str, Any]:
    return {
        "current_password": "ValidTestPassword123!",
        "new_password": "NewSecretPassword123!",
    }


def _create_user_payload(_target: User | None = None) -> dict[str, Any]:
    uid = uuid.uuid4().hex[:6]
    return {
        "username": f"new_usr_{uid}",
        "full_name": f"New User {uid}",
        "role": "RECEPTION",
    }


def _patch_user_payload(target: User | None = None) -> dict[str, Any]:
    ver = target.version_id if target else 1
    return {
        "full_name": "Updated Staff Name",
        "version_id": ver,
    }


def _action_user_payload(target: User | None = None) -> dict[str, Any]:
    ver = target.version_id if target else 1
    return {
        "version_id": ver,
    }


def _setup_admin_payload(_target: User | None = None) -> dict[str, Any]:
    return {
        "setup_code": "ANYCODE123",
        "username": "matrix_admin",
        "full_name": "Matrix Admin",
        "password": "ValidAdminPassword123!",
    }


def _patch_settings_payload(target: Any = None) -> dict[str, Any]:
    ver = target.version_id if target and hasattr(target, "version_id") else 1
    return {
        "name_en": "Kalyan Hospital Matrix",
        "name_hi": "कल्याण हॉस्पिटल",
        "address_1": "Hospital Road, Ara",
        "phone": "+91 6182 000000",
        "receipt_sequence_cycle": "FINANCIAL_YEAR",
        "consultation_validity_days": 7,
        "version_id": ver,
    }


def _create_doctor_payload(_target: Any = None) -> dict[str, Any]:
    uid = uuid.uuid4().hex[:6]
    return {
        "name_en": f"Dr. Matrix {uid}",
        "qualification": "MBBS",
        "default_fee_paise": 30000,
    }


def _patch_doctor_payload(target: Any = None) -> dict[str, Any]:
    ver = target.version_id if target and hasattr(target, "version_id") else 1
    return {
        "name_en": "Dr. Matrix Updated",
        "default_fee_paise": 35000,
        "is_active": True,
        "version_id": ver,
    }


def _create_fee_payload(_target: Any = None) -> dict[str, Any]:
    uid = uuid.uuid4().hex[:6]
    return {
        "name": f"Fee Matrix {uid}",
        "fee_paise": 25000,
    }


def _patch_fee_payload(_target: Any = None) -> dict[str, Any]:
    return {
        "name": "Fee Matrix Updated",
        "fee_paise": 30000,
        "is_active": True,
    }


MATRIX: list[MatrixRow] = [
    MatrixRow(
        method="GET",
        path="/api/auth/me",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 200,
            "doctor_a": 200,
            "doctor_b": 200,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/auth/logout",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 204,
            "reception": 204,
            "doctor_a": 204,
            "doctor_b": 204,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/auth/change-password",
        body_factory=_change_password_payload,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 200,
            "doctor_a": 200,
            "doctor_b": 200,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/admin/overview",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/reception/overview",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 200,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/doctor/overview",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 403,
            "reception": 403,
            "doctor_a": 200,
            "doctor_b": 200,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/users",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/users",
        body_factory=_create_user_payload,
        expected={
            "anonymous": 401,
            "admin": 201,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/users/{id}",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="PATCH",
        path="/api/users/{id}",
        body_factory=_patch_user_payload,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/users/{id}/deactivate",
        body_factory=_action_user_payload,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/users/{id}/reactivate",
        body_factory=_action_user_payload,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/users/{id}/reset-password",
        body_factory=_action_user_payload,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/users/{id}/unlock",
        body_factory=_action_user_payload,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/setup/status",
        body_factory=None,
        expected={
            "anonymous": 410,
            "admin": 410,
            "reception": 410,
            "doctor_a": 410,
            "doctor_b": 410,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/setup/admin",
        body_factory=_setup_admin_payload,
        expected={
            "anonymous": 410,
            "admin": 410,
            "reception": 410,
            "doctor_a": 410,
            "doctor_b": 410,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/settings",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 200,
            "doctor_a": 200,
            "doctor_b": 200,
        },
    ),
    MatrixRow(
        method="PATCH",
        path="/api/settings",
        body_factory=_patch_settings_payload,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/doctors",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 200,
            "doctor_a": 200,
            "doctor_b": 200,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/doctors",
        body_factory=_create_doctor_payload,
        expected={
            "anonymous": 401,
            "admin": 201,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="PATCH",
        path="/api/doctors/{id}",
        body_factory=_patch_doctor_payload,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="GET",
        path="/api/fees",
        body_factory=None,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 200,
            "doctor_a": 200,
            "doctor_b": 200,
        },
    ),
    MatrixRow(
        method="POST",
        path="/api/fees",
        body_factory=_create_fee_payload,
        expected={
            "anonymous": 401,
            "admin": 201,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
    MatrixRow(
        method="PATCH",
        path="/api/fees/{id}",
        body_factory=_patch_fee_payload,
        expected={
            "anonymous": 401,
            "admin": 200,
            "reception": 403,
            "doctor_a": 403,
            "doctor_b": 403,
        },
    ),
]


def check_matrix_completeness(app: FastAPI, matrix: list[MatrixRow]) -> list[str]:
    """Return all non-public (method, path) endpoints lacking an entry in matrix."""
    matrix_pairs = {(r.method, r.path) for r in matrix}
    uncovered: list[str] = []

    for method, path, dep in walk_routes(app):
        if dep is None:
            continue
        pols = list(_policies(dep))
        if pols and pols[0].kind != "public":
            if (method, path) not in matrix_pairs:
                uncovered.append(f"{method} {path}")

    return uncovered


def build_isolated_client(
    app: FastAPI,
    db_session: Session,
    settings: Settings,
    login_client: Callable[[User], TestClient],
    identity: str,
    make_user_fn: Callable[..., User],
) -> tuple[TestClient, User | None]:
    """Provision a fresh user and client for the target role to prevent state leakage."""
    if identity == "anonymous":
        anon_client = TestClient(
            app,
            base_url="http://testserver",
            headers={"Origin": "http://testserver"},
        )
        return anon_client, None

    uid = uuid.uuid4().hex[:8]
    if identity == "admin":
        user = make_user_fn(
            db_session,
            settings,
            role="ADMIN",
            username=f"mat_admin_{uid}",
        )
    elif identity == "reception":
        user = make_user_fn(
            db_session,
            settings,
            role="RECEPTION",
            username=f"mat_rec_{uid}",
        )
    elif identity == "doctor_a":
        user = make_user_fn(
            db_session,
            settings,
            role="DOCTOR",
            username=f"mat_doc_a_{uid}",
            doctor_name=f"Dr. Anil {uid}",
        )
    elif identity == "doctor_b":
        user = make_user_fn(
            db_session,
            settings,
            role="DOCTOR",
            username=f"mat_doc_b_{uid}",
            doctor_name=f"Dr. Bharati {uid}",
        )
    else:
        raise ValueError(f"Unknown test identity: {identity}")

    auth_client = login_client(user)
    return auth_client, user
