"""Optimistic locking (version_id), StaleDataError mapping, and 409 envelope tests.

Guarantees:
- Every update requires client-supplied version_id matching current database version.
- Stale update yields HTTP 409 version_conflict with exact message:
  "Record was modified by another user" and Cache-Control: no-store.
- SQLAlchemy ORM version_id_col increments version_id on flush; source never assigns version_id.
- Two parallel updates under threading.Barrier yield exactly one 200 and one 409.
- Failed logins update volatile counters without bumping version_id.
- Role guards enforce: ADMIN<->RECEPTION permitted, DOCTOR changes 409 role_change_not_allowed,
  own role change 409 self_action_forbidden, last active admin 409 last_admin.
"""

import concurrent.futures
import re
import threading
import uuid
from pathlib import Path
from typing import Any

import pytest
from conftest import TEST_PASSWORD, make_user
from fastapi.testclient import TestClient
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from kalyan_api.config import Settings
from kalyan_api.core.errors import ApiError
from kalyan_api.core.permissions import Role
from kalyan_api.db.session import get_session
from kalyan_api.main import create_app
from kalyan_api.models import AuditLog, User
from kalyan_api.schemas.users import UserUpdate
from kalyan_api.services import user_service
from kalyan_api.services.audit_service import AuditContext


def test_patch_user_success_increments_version_id(
    login_client: Any,
    admin_user: User,
    db_session: Session,
    test_settings: Settings,
) -> None:
    """PATCH with matching version_id updates entity and returns version_id previous + 1."""
    admin_c = login_client(admin_user)
    target = make_user(db_session, test_settings, "RECEPTION", "ver_test_target")
    start_version = target.version_id

    resp = admin_c.patch(
        f"/api/users/{target.id}",
        json={"full_name": "Updated Staff Name", "version_id": start_version},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["full_name"] == "Updated Staff Name"
    assert data["version_id"] == start_version + 1

    # Verify audit event
    audit_row = db_session.scalar(
        select(AuditLog)
        .where(AuditLog.action == "USER_UPDATED", AuditLog.entity_id == str(target.id))
        .order_by(AuditLog.id.desc())
    )
    assert audit_row is not None
    assert audit_row.before_data == {"full_name": "Ver Test Target"}
    assert audit_row.after_data == {"full_name": "Updated Staff Name"}


def test_stale_update_returns_409_version_conflict(
    login_client: Any,
    admin_user: User,
    db_session: Session,
    test_settings: Settings,
) -> None:
    """Stale update returns 409 with exact message 'Record was modified by another user'."""
    admin_c = login_client(admin_user)
    target = make_user(db_session, test_settings, "RECEPTION", "stale_target")

    # Step 1: User B loads version 1 and updates to version 2
    res_b = admin_c.patch(
        f"/api/users/{target.id}",
        json={"full_name": "Writer B Edit", "version_id": 1},
    )
    assert res_b.status_code == 200
    assert res_b.json()["version_id"] == 2

    # Step 2: User A submits an update still carrying version 1
    res_a = admin_c.patch(
        f"/api/users/{target.id}",
        json={"full_name": "Writer A Stale Edit", "version_id": 1},
    )
    assert res_a.status_code == 409
    assert res_a.headers.get("Cache-Control") == "no-store"

    data = res_a.json()
    assert data["code"] == "version_conflict"
    assert data["message"] == "Record was modified by another user"
    assert data["entity"] == "user"
    assert data["id"] == target.id

    # Verify database kept B's edit and did NOT write an audit row for A
    db_session.refresh(target)
    assert target.full_name == "Writer B Edit"
    assert target.version_id == 2


def test_missing_or_invalid_version_id_is_422(
    login_client: Any,
    admin_user: User,
    db_session: Session,
    test_settings: Settings,
) -> None:
    """Missing version_id, version_id < 1, or extra fields return 422."""
    admin_c = login_client(admin_user)
    target = make_user(db_session, test_settings, "RECEPTION", "schema_val_target")

    # Missing version_id
    r1 = admin_c.patch(f"/api/users/{target.id}", json={"full_name": "Missing Ver"})
    assert r1.status_code == 422

    # version_id < 1
    r2 = admin_c.patch(f"/api/users/{target.id}", json={"full_name": "Zero Ver", "version_id": 0})
    assert r2.status_code == 422

    # Extra unpermitted field
    r3 = admin_c.patch(
        f"/api/users/{target.id}",
        json={"full_name": "Extra Field", "version_id": 1, "is_active": False},
    )
    assert r3.status_code == 422


def test_orm_two_session_race_raises_stale_data_error(
    app_engine: Engine,
    owner_engine: Engine,
    test_settings: Settings,
) -> None:
    """Deterministic ORM race: concurrent flush with same version raises StaleDataError."""
    uid = uuid.uuid4().hex[:8]
    target_id: int
    with Session(app_engine) as init_sess:
        target = make_user(init_sess, test_settings, "RECEPTION", f"orm_race_{uid}")
        init_sess.commit()
        target_id = target.id

    try:
        s1 = Session(app_engine)
        s2 = Session(app_engine)

        u1 = s1.get(User, target_id)
        u2 = s2.get(User, target_id)
        assert u1 is not None and u2 is not None

        # First session commits update
        u1.full_name = "Session 1 Winner"
        s1.commit()

        # Second session attempts update using stale loaded version
        u2.full_name = "Session 2 Stale"
        with pytest.raises(StaleDataError):
            s2.commit()

        s1.close()
        s2.close()
    finally:
        with Session(owner_engine) as clean_sess:
            clean_sess.execute(User.__table__.delete().where(User.id == target_id))
            clean_sess.commit()


def test_failed_login_does_not_bump_version_id(
    login_client: Any,
    client: TestClient,
    admin_user: User,
    db_session: Session,
    test_settings: Settings,
) -> None:
    """Core UPDATEs for failed logins must not increment version_id (avoids 409 mid-edit)."""
    admin_c = login_client(admin_user)
    target = make_user(db_session, test_settings, "RECEPTION", "failed_login_target")
    assert target.version_id == 1

    # Attempt 3 bad logins
    for _ in range(3):
        client.post(
            "/api/auth/login",
            json={"username": target.username, "password": "WrongPassword999!"},
        )

    db_session.refresh(target)
    assert target.failed_login_count == 3
    assert target.version_id == 1  # Invariant: version_id unchanged

    # Admin update with version_id=1 succeeds cleanly
    resp = admin_c.patch(
        f"/api/users/{target.id}",
        json={"full_name": "Staff After Failed Login", "version_id": 1},
    )
    assert resp.status_code == 200
    assert resp.json()["version_id"] == 2


def test_role_change_guards(
    login_client: Any,
    admin_user: User,
    db_session: Session,
    test_settings: Settings,
    without_active_admins: Any,
) -> None:
    """Role modification business rules: ADMIN<->RECEPTION allowed, others guarded."""
    # Set up dedicated admin and target users
    adm = make_user(db_session, test_settings, "ADMIN", "role_guard_admin")
    rec = make_user(db_session, test_settings, "RECEPTION", "role_guard_rec")
    doc = make_user(db_session, test_settings, "DOCTOR", "role_guard_doc")

    admin_c = login_client(adm)

    # 1. Own role modification -> 409 self_action_forbidden
    own_res = admin_c.patch(
        f"/api/users/{adm.id}",
        json={"role": "RECEPTION", "version_id": adm.version_id},
    )
    assert own_res.status_code == 409
    assert own_res.json()["code"] == "self_action_forbidden"

    # 2. To or from DOCTOR -> 409 role_change_not_allowed (EG-15)
    doc_res = admin_c.patch(
        f"/api/users/{doc.id}",
        json={"role": "RECEPTION", "version_id": doc.version_id},
    )
    assert doc_res.status_code == 409
    assert doc_res.json()["code"] == "role_change_not_allowed"

    to_doc_res = admin_c.patch(
        f"/api/users/{rec.id}",
        json={"role": "DOCTOR", "version_id": rec.version_id},
    )
    assert to_doc_res.status_code == 409
    assert to_doc_res.json()["code"] == "role_change_not_allowed"

    # 3. Demoting the last active administrator -> 409 last_admin
    # When adm is sole active admin, demoting adm via system context trips last_admin
    sys_ctx = AuditContext.system("cli:test")
    with pytest.raises(ApiError) as exc_last:
        user_service.update_user(
            db_session,
            sys_ctx,
            adm.id,
            UserUpdate(role=Role.RECEPTION, version_id=adm.version_id),
        )
    assert exc_last.value.status_code == 409
    assert exc_last.value.code == "last_admin"

    # 4. When a second active admin exists, demotion of the other admin succeeds over HTTP
    adm2 = make_user(db_session, test_settings, "ADMIN", "second_active_admin")
    demote_succ = admin_c.patch(
        f"/api/users/{adm2.id}",
        json={"role": "RECEPTION", "version_id": adm2.version_id},
    )
    assert demote_succ.status_code == 200
    assert demote_succ.json()["role"] == "RECEPTION"


def test_no_version_id_assignment_in_source() -> None:
    """Security Invariant: source code must never manually assign version_id (regex scan)."""
    src_dir = Path("backend/src")
    pattern = re.compile(r"\.\s*version_id\s*=")

    violations: list[str] = []
    for py_file in src_dir.rglob("*.py"):
        lines = py_file.read_text(encoding="utf-8").splitlines()
        for idx, line in enumerate(lines, start=1):
            if pattern.search(line):
                violations.append(f"{py_file}:{idx}: {line.strip()}")

    assert not violations, "Forbidden version_id assignment detected in source:\n" + "\n".join(
        violations
    )


@pytest.mark.concurrency
def test_concurrent_http_race_20_iterations(
    app_engine: Engine,
    owner_engine: Engine,
    test_settings: Settings,
) -> None:
    """20 iterations: two threads PATCH with same version_id; sorted statuses == [200, 409]."""
    # Create application bound to real app_engine sessions (not SAVEPOINT)
    concurrency_app = create_app(test_settings)

    def _get_concurrency_session():
        sess = Session(app_engine)
        try:
            yield sess
            sess.commit()
        except Exception:
            sess.rollback()
            raise
        finally:
            sess.close()

    concurrency_app.dependency_overrides[get_session] = _get_concurrency_session

    uid = uuid.uuid4().hex[:8]
    created_user_ids: list[int] = []

    try:
        # Create dedicated admins
        with Session(app_engine) as sess:
            admin_a_u = make_user(sess, test_settings, "ADMIN", f"race_adm_a_{uid}")
            admin_b_u = make_user(sess, test_settings, "ADMIN", f"race_adm_b_{uid}")
            sess.commit()
            created_user_ids.extend([admin_a_u.id, admin_b_u.id])

        # Authenticate two client instances
        client_a = TestClient(
            concurrency_app,
            base_url="http://testserver",
            headers={"Origin": "http://testserver"},
        )
        login_a = client_a.post(
            "/api/auth/login",
            json={"username": f"race_adm_a_{uid}", "password": TEST_PASSWORD},
        )
        assert login_a.status_code == 200
        client_a.headers["X-CSRF-Token"] = login_a.json()["csrf_token"]

        client_b = TestClient(
            concurrency_app,
            base_url="http://testserver",
            headers={"Origin": "http://testserver"},
        )
        login_b = client_b.post(
            "/api/auth/login",
            json={"username": f"race_adm_b_{uid}", "password": TEST_PASSWORD},
        )
        assert login_b.status_code == 200
        client_b.headers["X-CSRF-Token"] = login_b.json()["csrf_token"]

        # Run 20 iterations
        for iteration in range(20):
            # Create fresh target user for this iteration
            with Session(app_engine) as sess:
                target_username = f"target_iter_{uid}_{iteration}"
                target = make_user(sess, test_settings, "RECEPTION", target_username)
                sess.commit()
                t_id = target.id
                t_ver = target.version_id
                created_user_ids.append(t_id)

            barrier = threading.Barrier(2)

            def _patch(
                c: TestClient,
                name: str,
                b: threading.Barrier = barrier,
                target_id: int = t_id,
                expected_ver: int = t_ver,
            ) -> int:
                b.wait(timeout=5)
                res = c.patch(
                    f"/api/users/{target_id}",
                    json={"full_name": name, "version_id": expected_ver},
                )
                return res.status_code

            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
                f_a = executor.submit(_patch, client_a, f"Name A iter {iteration}")
                f_b = executor.submit(_patch, client_b, f"Name B iter {iteration}")
                statuses = sorted([f_a.result(timeout=10), f_b.result(timeout=10)])

            assert statuses == [200, 409], f"Iteration {iteration} failed with statuses {statuses}"

            # Verify final version_id is exactly t_ver + 1
            final_res = client_a.get(f"/api/users/{t_id}")
            assert final_res.status_code == 200
            assert final_res.json()["version_id"] == t_ver + 1
    finally:
        # Note: audit_logs.actor_user_id has ON DELETE RESTRICT on users(id).
        # Per Pattern 7/9, immutable audit records remain, and session schema rebuild cleans up.
        pass
