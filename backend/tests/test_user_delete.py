"""Guarded user deletion: super admin password, unused accounts only, audited, throttled."""

from typing import Any

from sqlalchemy import Engine, func, select, text
from sqlalchemy.orm import Session

from kalyan_api.config import Settings
from kalyan_api.models import AuditLog, User
from tests.conftest import TEST_PASSWORD, make_user

SUPER_PASSWORD = "SuperAdminSecret456!"


def _users(db_session: Session, settings: Settings, suffix: str) -> tuple[User, User, User]:
    """Return (acting admin, super admin, deactivated never-used reception target)."""
    actor = make_user(db_session, settings, "ADMIN", f"del_actor_{suffix}")
    super_admin = make_user(
        db_session,
        settings,
        "ADMIN",
        f"del_super_{suffix}",
        password=SUPER_PASSWORD,
        is_super_admin=True,
    )
    target = make_user(db_session, settings, "RECEPTION", f"del_target_{suffix}", is_active=False)
    return actor, super_admin, target


def _delete(client: Any, target: User, password: str, reason: str | None = None) -> Any:
    return client.post(
        f"/api/users/{target.id}/delete",
        json={
            "version_id": target.version_id,
            "super_admin_password": password,
            "reason": reason,
        },
    )


def _exists(db_session: Session, user_id: int) -> bool:
    db_session.expire_all()
    return db_session.scalar(select(func.count(User.id)).where(User.id == user_id)) == 1


def test_super_admin_password_deletes_unused_account_and_audits(
    db_session: Session, login_client: Any, test_settings: Settings
) -> None:
    actor, _super, target = _users(db_session, test_settings, "ok")
    client = login_client(actor)

    res = _delete(client, target, SUPER_PASSWORD, reason="test leftover")

    assert res.status_code == 200
    assert res.json() == {"id": target.id, "username": target.username, "deleted": True}
    assert not _exists(db_session, target.id)

    audit = db_session.scalar(
        select(AuditLog)
        .where(AuditLog.action == "USER_DELETED", AuditLog.entity_id == str(target.id))
        .order_by(AuditLog.id.desc())
    )
    assert audit is not None
    assert audit.actor_user_id == actor.id
    assert audit.reason == "test leftover"
    assert audit.before_data == {
        "username": target.username,
        "role": "RECEPTION",
        "is_active": False,
    }
    assert SUPER_PASSWORD not in str(audit.before_data) + str(audit.after_data)


def test_wrong_super_admin_password_is_rejected_and_audited(
    db_session: Session, login_client: Any, test_settings: Settings
) -> None:
    actor, _super, target = _users(db_session, test_settings, "bad")
    client = login_client(actor)

    # The acting admin's own password is not the super admin's password.
    res = _delete(client, target, TEST_PASSWORD)

    assert res.status_code == 403
    assert res.json()["code"] == "super_admin_password_incorrect"
    assert _exists(db_session, target.id)
    denied = db_session.scalar(
        select(func.count(AuditLog.id)).where(
            AuditLog.action == "USER_DELETE_DENIED",
            AuditLog.actor_user_id == actor.id,
            AuditLog.outcome == "DENIED",
        )
    )
    assert denied == 1


def test_repeated_wrong_passwords_are_throttled(
    db_session: Session, login_client: Any, test_settings: Settings
) -> None:
    actor, _super, target = _users(db_session, test_settings, "thr")
    client = login_client(actor)

    for _ in range(5):
        assert _delete(client, target, "wrong-password").status_code == 403

    res = _delete(client, target, SUPER_PASSWORD)  # even the right password is refused now
    assert res.status_code == 429
    assert res.json()["code"] == "delete_throttled"
    assert _exists(db_session, target.id)


def test_account_must_be_deactivated_first(
    db_session: Session, login_client: Any, test_settings: Settings
) -> None:
    actor, _super, _target = _users(db_session, test_settings, "act")
    active = make_user(db_session, test_settings, "RECEPTION", "del_active_target")
    client = login_client(actor)

    res = _delete(client, active, SUPER_PASSWORD)

    assert res.status_code == 409
    assert res.json()["code"] == "user_still_active"
    assert _exists(db_session, active.id)


def test_account_with_recorded_history_cannot_be_deleted(
    db_session: Session, login_client: Any, test_settings: Settings
) -> None:
    actor, _super, _unused = _users(db_session, test_settings, "hist")
    used = make_user(db_session, test_settings, "RECEPTION", "del_used_target")
    login_client(used)  # a sign-in writes an audit row that references this user
    client = login_client(actor)
    db_session.expire_all()
    used = db_session.get(User, used.id)
    deact = client.post(f"/api/users/{used.id}/deactivate", json={"version_id": used.version_id})
    assert deact.status_code == 200
    db_session.expire_all()
    used = db_session.get(User, used.id)

    res = _delete(client, used, SUPER_PASSWORD)

    assert res.status_code == 409
    assert res.json()["code"] == "user_has_history"
    assert _exists(db_session, used.id)
    assert (
        db_session.scalar(
            select(func.count(AuditLog.id)).where(
                AuditLog.action == "USER_DELETED", AuditLog.entity_id == str(used.id)
            )
        )
        == 0
    )


def test_account_that_created_other_accounts_cannot_be_deleted(
    db_session: Session, login_client: Any, test_settings: Settings
) -> None:
    actor, _super, target = _users(db_session, test_settings, "cre")
    child = make_user(db_session, test_settings, "RECEPTION", "del_child")
    child.created_by = target.id
    db_session.flush()
    client = login_client(actor)

    res = _delete(client, target, SUPER_PASSWORD)

    assert res.status_code == 409
    assert res.json()["code"] == "user_has_history"
    assert _exists(db_session, target.id)


def test_self_and_super_admin_accounts_are_protected(
    db_session: Session, login_client: Any, test_settings: Settings
) -> None:
    actor, super_admin, _target = _users(db_session, test_settings, "prot")
    client = login_client(actor)

    own = _delete(client, actor, SUPER_PASSWORD)
    assert own.status_code == 409
    assert own.json()["code"] == "self_action_forbidden"

    super_admin.is_active = False
    db_session.flush()
    db_session.expire_all()
    super_admin = db_session.get(User, super_admin.id)
    sup = _delete(client, super_admin, SUPER_PASSWORD)
    assert sup.status_code == 409
    assert sup.json()["code"] == "super_admin_protected"


def test_non_admin_roles_cannot_delete(
    db_session: Session,
    login_client: Any,
    test_settings: Settings,
    reception_user: User,
    doctor_a_user: User,
) -> None:
    _actor, _super, target = _users(db_session, test_settings, "rbac")
    for user in (reception_user, doctor_a_user):
        res = _delete(login_client(user), target, SUPER_PASSWORD)
        assert res.status_code == 403
        assert res.json().get("code") != "super_admin_password_incorrect"
    assert _exists(db_session, target.id)


def test_deletion_needs_an_active_super_admin(
    db_session: Session, login_client: Any, test_settings: Settings
) -> None:
    actor = make_user(db_session, test_settings, "ADMIN", "del_actor_nosuper")
    target = make_user(
        db_session, test_settings, "RECEPTION", "del_target_nosuper", is_active=False
    )
    db_session.execute(text("UPDATE users SET is_super_admin = false"))
    db_session.expire_all()
    client = login_client(actor)

    res = _delete(client, db_session.get(User, target.id), SUPER_PASSWORD)

    assert res.status_code == 409
    assert res.json()["code"] == "no_super_admin"


def test_last_super_admin_cannot_be_deactivated_or_demoted(
    db_session: Session, login_client: Any, test_settings: Settings
) -> None:
    actor, super_admin, _target = _users(db_session, test_settings, "last")
    db_session.execute(
        text("UPDATE users SET is_super_admin = false WHERE id <> :id AND is_super_admin"),
        {"id": super_admin.id},
    )
    db_session.expire_all()
    super_admin = db_session.get(User, super_admin.id)
    client = login_client(actor)

    deact = client.post(
        f"/api/users/{super_admin.id}/deactivate", json={"version_id": super_admin.version_id}
    )
    assert deact.status_code == 409
    assert deact.json()["code"] == "last_super_admin"

    demote = client.patch(
        f"/api/users/{super_admin.id}",
        json={"version_id": super_admin.version_id, "role": "RECEPTION"},
    )
    assert demote.status_code == 409
    assert demote.json()["code"] == "super_admin_protected"


def test_direct_sql_delete_of_users_is_still_denied_to_the_app_role(app_engine: Engine) -> None:
    with app_engine.connect() as conn:
        try:
            conn.execute(text("DELETE FROM users WHERE id = -1"))
        except Exception as exc:  # noqa: BLE001 - assert on the database's message
            assert "permission denied" in str(exc).lower()
        else:
            raise AssertionError("kalyan_app must not hold table-level DELETE on users")


# --------------------------------------------------------------------------------------
# Bulk delete: one super admin password, per-account results
# --------------------------------------------------------------------------------------


def _bulk(client: Any, targets: list[User], password: str, reason: str | None = None) -> Any:
    return client.post(
        "/api/users/bulk-delete",
        json={
            "items": [{"id": t.id, "version_id": t.version_id} for t in targets],
            "super_admin_password": password,
            "reason": reason,
        },
    )


def test_bulk_delete_removes_unused_accounts_with_one_password_and_audits_each(
    db_session: Session, login_client: Any, test_settings: Settings
) -> None:
    actor, _super, first = _users(db_session, test_settings, "bulk1")
    second = make_user(db_session, test_settings, "RECEPTION", "bulk_second", is_active=False)
    third = make_user(db_session, test_settings, "RECEPTION", "bulk_third", is_active=False)
    client = login_client(actor)

    res = _bulk(client, [first, second, third], SUPER_PASSWORD, reason="clean-up")

    assert res.status_code == 200
    body = res.json()
    assert body["deleted_count"] == 3
    assert body["skipped_count"] == 0
    assert [r["deleted"] for r in body["results"]] == [True, True, True]
    for user in (first, second, third):
        assert not _exists(db_session, user.id)
        audit = db_session.scalar(
            select(AuditLog).where(
                AuditLog.action == "USER_DELETED", AuditLog.entity_id == str(user.id)
            )
        )
        assert audit is not None
        assert audit.actor_user_id == actor.id
        assert audit.reason == "clean-up"


def test_bulk_delete_skips_accounts_that_cannot_be_deleted_and_continues(
    db_session: Session, login_client: Any, test_settings: Settings
) -> None:
    actor, super_admin, good = _users(db_session, test_settings, "bulk2")
    active = make_user(db_session, test_settings, "RECEPTION", "bulk_active")
    used = make_user(db_session, test_settings, "RECEPTION", "bulk_used")
    login_client(used)  # sign-in writes an audit row that references this user
    client = login_client(actor)
    db_session.expire_all()
    used = db_session.get(User, used.id)
    assert (
        client.post(
            f"/api/users/{used.id}/deactivate", json={"version_id": used.version_id}
        ).status_code
        == 200
    )
    db_session.expire_all()
    used = db_session.get(User, used.id)
    good_after = make_user(db_session, test_settings, "RECEPTION", "bulk_good2", is_active=False)
    super_admin = db_session.get(User, super_admin.id)

    res = _bulk(client, [active, used, super_admin, actor, good, good_after], SUPER_PASSWORD)

    assert res.status_code == 200
    by_id = {r["id"]: r for r in res.json()["results"]}
    assert by_id[active.id]["code"] == "user_still_active"
    assert by_id[used.id]["code"] == "user_has_history"
    assert by_id[super_admin.id]["code"] == "super_admin_protected"
    assert by_id[actor.id]["code"] == "self_action_forbidden"
    assert by_id[good.id]["deleted"] is True
    assert by_id[good_after.id]["deleted"] is True  # a refusal earlier did not stop the rest
    assert res.json()["deleted_count"] == 2
    assert res.json()["skipped_count"] == 4
    assert _exists(db_session, used.id)
    assert _exists(db_session, active.id)
    assert not _exists(db_session, good.id)


def test_bulk_delete_skips_unknown_and_stale_accounts(
    db_session: Session, login_client: Any, test_settings: Settings
) -> None:
    actor, _super, target = _users(db_session, test_settings, "bulk3")
    client = login_client(actor)

    res = client.post(
        "/api/users/bulk-delete",
        json={
            "items": [
                {"id": 999_999_999, "version_id": 1},
                {"id": target.id, "version_id": target.version_id + 7},
            ],
            "super_admin_password": SUPER_PASSWORD,
        },
    )

    assert res.status_code == 200
    codes = [r["code"] for r in res.json()["results"]]
    assert codes == ["not_found", "version_conflict"]
    assert _exists(db_session, target.id)


def test_bulk_delete_wrong_password_deletes_nothing_and_is_audited_once(
    db_session: Session, login_client: Any, test_settings: Settings
) -> None:
    actor, _super, first = _users(db_session, test_settings, "bulk4")
    second = make_user(db_session, test_settings, "RECEPTION", "bulk_w2", is_active=False)
    client = login_client(actor)

    res = _bulk(client, [first, second], TEST_PASSWORD)

    assert res.status_code == 403
    assert res.json()["code"] == "super_admin_password_incorrect"
    assert _exists(db_session, first.id) and _exists(db_session, second.id)
    denied = db_session.scalar(
        select(func.count(AuditLog.id)).where(
            AuditLog.action == "USER_DELETE_DENIED", AuditLog.actor_user_id == actor.id
        )
    )
    assert denied == 1


def test_bulk_delete_wrong_passwords_are_throttled(
    db_session: Session, login_client: Any, test_settings: Settings
) -> None:
    actor, _super, target = _users(db_session, test_settings, "bulk5")
    client = login_client(actor)

    for _ in range(5):
        assert _bulk(client, [target], "wrong-password").status_code == 403

    res = _bulk(client, [target], SUPER_PASSWORD)
    assert res.status_code == 429
    assert res.json()["code"] == "delete_throttled"
    assert _exists(db_session, target.id)


def test_bulk_delete_is_admin_only_and_validates_the_request(
    db_session: Session,
    login_client: Any,
    test_settings: Settings,
    reception_user: User,
) -> None:
    actor, _super, target = _users(db_session, test_settings, "bulk6")

    forbidden = _bulk(login_client(reception_user), [target], SUPER_PASSWORD)
    assert forbidden.status_code == 403
    assert forbidden.json().get("code") != "super_admin_password_incorrect"

    client = login_client(actor)
    empty = client.post(
        "/api/users/bulk-delete", json={"items": [], "super_admin_password": SUPER_PASSWORD}
    )
    assert empty.status_code == 422
    duplicate = client.post(
        "/api/users/bulk-delete",
        json={
            "items": [
                {"id": target.id, "version_id": target.version_id},
                {"id": target.id, "version_id": target.version_id},
            ],
            "super_admin_password": SUPER_PASSWORD,
        },
    )
    assert duplicate.status_code == 422
    assert _exists(db_session, target.id)
