"""The runtime role's table rights: the restore copy must match the migrations exactly."""

from collections import defaultdict
from pathlib import Path

import pytest
from sqlalchemy import Engine, create_engine, text

from kalyan_api.config import Settings, get_settings
from kalyan_api.services.backup_service import RUNTIME_TABLE_GRANTS, runtime_grant_sql


def _actual_grants(engine: Engine, app_user: str) -> dict[str, set[str]]:
    grants: dict[str, set[str]] = defaultdict(set)
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT table_name, privilege_type FROM information_schema.role_table_grants "
                "WHERE grantee = :user AND table_schema = 'public'"
            ),
            {"user": app_user},
        ).all()
    for table, privilege in rows:
        grants[table].add(privilege)
    return dict(grants)


def test_restore_grant_table_matches_migrated_database(
    app_engine: Engine, test_settings: Settings
) -> None:
    """Every table the runtime role can touch on a migrated database is listed here, and vice versa."""
    actual = _actual_grants(app_engine, test_settings.db_app_user)
    expected = {table: set(privs) for table, privs in RUNTIME_TABLE_GRANTS.items()}
    assert actual == expected


def test_runtime_grant_sql_grants_no_schema_create_and_no_audit_edits() -> None:
    sql = runtime_grant_sql("kalyan_app")
    assert "CREATE" not in sql.upper()
    assert "DELETE" not in RUNTIME_TABLE_GRANTS["audit_logs"]
    assert "UPDATE" not in RUNTIME_TABLE_GRANTS["audit_logs"]


@pytest.mark.real_restore
def test_restore_leaves_runtime_role_with_migration_rights(tmp_path: Path) -> None:
    """After a real restore, the runtime role has exactly the migrated rights, not more."""
    from kalyan_api.services.backup_service import create_backup, restore_backup

    settings = get_settings()
    archive = create_backup(destination_dir=tmp_path, label="grants", settings=settings)
    restore_backup(archive, settings=settings, create_prerestore_snapshot=False)

    owner = create_engine(settings.owner_url)
    try:
        actual = _actual_grants(owner, settings.db_app_user)
    finally:
        owner.dispose()
    assert actual == {table: set(privs) for table, privs in RUNTIME_TABLE_GRANTS.items()}
