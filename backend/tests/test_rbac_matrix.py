"""Role-by-endpoint RBAC authorization matrix, completeness gate, and data leak tests.

Guarantees:
- Every non-public endpoint passes access checks according to default-deny RBAC policy.
- Completeness gate ensures no newly registered route ships without a verified matrix row.
- Recursive body scanner verifies no secrets or unauthorized tokens leak in 2xx responses.
- Doctor dashboard isolation verifies doctor A and doctor B only observe their own identities.
"""

import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from conftest import make_user
from fastapi import Depends, FastAPI
from sqlalchemy import select
from sqlalchemy.orm import Session
from support.matrix import (
    IDENTITIES,
    MATRIX,
    MatrixRow,
    build_isolated_client,
    check_matrix_completeness,
)

from kalyan_api.config import Settings
from kalyan_api.core.permissions import Permission
from kalyan_api.core.policy import require
from kalyan_api.models import ClinicSettings, ConsultationFee, Doctor, SystemSetup

FORBIDDEN_SECRET_KEYS: tuple[str, ...] = (
    "password_hash",
    "current_password",
    "new_password",
    "token",
)

MATRIX_CASES: list[tuple[MatrixRow, str]] = [
    (row, identity) for row in MATRIX for identity in IDENTITIES
]


def _scan_for_forbidden_keys(payload: Any, path: str) -> None:
    """Recursively ensure responses do not echo sensitive credentials or improper tokens."""
    forbidden = set(FORBIDDEN_SECRET_KEYS)
    if path not in ("/api/auth/login", "/api/auth/change-password", "/api/auth/me"):
        forbidden.add("csrf_token")

    if isinstance(payload, dict):
        for k, v in payload.items():
            assert k not in forbidden, f"Forbidden key '{k}' exposed in response from {path}"
            _scan_for_forbidden_keys(v, path)
    elif isinstance(payload, list):
        for item in payload:
            _scan_for_forbidden_keys(item, path)


def test_matrix_case_count_equals_rows_times_identities() -> None:
    """Assert total matrix test cases equal rows multiplied by 5 test identities."""
    assert len(MATRIX_CASES) == len(MATRIX) * len(IDENTITIES)
    assert len(MATRIX_CASES) == len(MATRIX) * 5


def test_matrix_completeness_gate(app: FastAPI) -> None:
    """Every registered non-public endpoint in the application must exist in the matrix."""
    uncovered = check_matrix_completeness(app, MATRIX)
    assert not uncovered, f"Endpoints missing from RBAC matrix: {uncovered}"


def test_matrix_completeness_negative_control() -> None:
    """Completeness gate must flag an unlisted protected endpoint on a throwaway application."""
    dummy_app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @dummy_app.get(
        "/api/unlisted-protected",
        dependencies=[Depends(require(Permission.USER_READ))],
    )
    def unlisted_route() -> dict[str, str]:
        return {"status": "ok"}

    uncovered = check_matrix_completeness(dummy_app, MATRIX)
    assert "GET /api/unlisted-protected" in uncovered


@pytest.mark.parametrize(
    "row,identity",
    MATRIX_CASES,
    ids=[f"{r.method}_{r.path}_{i}" for r, i in MATRIX_CASES],
)
def test_rbac_matrix_cell(
    app: FastAPI,
    db_session: Session,
    test_settings: Settings,
    login_client: Any,
    row: MatrixRow,
    identity: str,
) -> None:
    """Execute RBAC authorization test cell with an isolated client and verify response status."""
    client, _ = build_isolated_client(
        app, db_session, test_settings, login_client, identity, make_user
    )

    target_entity: Any = None
    resolved_path = row.path

    if row.path.startswith("/api/setup"):
        # Setup matrix preconditions: system_setup completed row exists
        existing_setup = db_session.scalar(
            select(SystemSetup).where(SystemSetup.id == 1)
        )
        if not existing_setup:
            setup_admin = make_user(
                db_session, test_settings, "ADMIN", f"mat_adm_{uuid.uuid4().hex[:6]}"
            )
            db_session.add(
                SystemSetup(
                    id=1,
                    completed_at=datetime.now(UTC),
                    admin_user_id=setup_admin.id,
                )
            )
            db_session.flush()

    elif row.path == "/api/settings":
        target_entity = db_session.scalar(select(ClinicSettings).where(ClinicSettings.id == 1))

    elif "/api/doctors/{id}" in row.path:
        doc = Doctor(name_en=f"Dr. Target {uuid.uuid4().hex[:6]}", default_fee_paise=30000)
        db_session.add(doc)
        db_session.flush()
        target_entity = doc
        resolved_path = row.path.replace("{id}", str(doc.id))

    elif "/api/fees/{id}" in row.path:
        fee = ConsultationFee(name=f"Fee Target {uuid.uuid4().hex[:6]}", fee_paise=20000)
        db_session.add(fee)
        db_session.flush()
        target_entity = fee
        resolved_path = row.path.replace("{id}", str(fee.id))

    elif "{id}" in row.path:
        is_active = "reactivate" not in row.path
        target_user = make_user(
            db_session,
            test_settings,
            "RECEPTION",
            f"mat_tgt_{uuid.uuid4().hex[:6]}",
            is_active=is_active,
        )
        if "unlock" in row.path:
            from datetime import timedelta
            target_user.locked_until = datetime.now(UTC) + timedelta(minutes=15)
            target_user.failed_login_count = 5
            db_session.flush()

        target_entity = target_user
        resolved_path = row.path.replace("{id}", str(target_user.id))

    body = row.body_factory(target_entity) if row.body_factory else None
    resp = client.request(row.method, resolved_path, json=body)

    expected_status = row.expected[identity]
    assert resp.status_code == expected_status, (
        f"{identity} {row.method} {row.path} returned {resp.status_code}, "
        f"expected {expected_status}: {resp.text}"
    )

    # Verify no secrets leak in any successful response
    if resp.is_success and resp.content:
        content_type = resp.headers.get("content-type", "")
        if "application/json" in content_type:
            _scan_for_forbidden_keys(resp.json(), row.path)


def test_doctor_overview_isolation(
    app: FastAPI,
    db_session: Session,
    test_settings: Settings,
    login_client: Any,
) -> None:
    """Doctor A and Doctor B overview responses must only include their own doctor ID and name."""
    client_a, user_a = build_isolated_client(
        app, db_session, test_settings, login_client, "doctor_a", make_user
    )
    client_b, user_b = build_isolated_client(
        app, db_session, test_settings, login_client, "doctor_b", make_user
    )

    assert user_a is not None and user_b is not None
    assert user_a.doctor_id != user_b.doctor_id

    res_a = client_a.get("/api/doctor/overview")
    assert res_a.status_code == 200
    data_a = res_a.json()
    assert data_a["doctor_id"] == user_a.doctor_id
    assert user_a.doctor is not None
    assert data_a["doctor_name_en"] == user_a.doctor.name_en
    assert data_a["doctor_id"] != user_b.doctor_id

    res_b = client_b.get("/api/doctor/overview")
    assert res_b.status_code == 200
    data_b = res_b.json()
    assert data_b["doctor_id"] == user_b.doctor_id
    assert user_b.doctor is not None
    assert data_b["doctor_name_en"] == user_b.doctor.name_en
    assert data_b["doctor_id"] != user_a.doctor_id
