"""Verification of append-only database triggers, least-privilege role permissions, and CHECKs.

Requirements:
- AUD-01: audit_logs rejects UPDATE, DELETE, TRUNCATE for both runtime and owner roles.
- SEC-03: users table enforces role IN ('ADMIN', 'RECEPTION', 'DOCTOR') and doctor_id binding.
- SEC-05: kalyan_app has no DELETE on users, no CREATE on schema.
- SEC-07: system_setup table is append-only singleton (id=1).
"""

import uuid

import pytest
from sqlalchemy import Engine, text
from sqlalchemy.exc import DBAPIError, IntegrityError, ProgrammingError

# ==============================================================================
# 1. Least-Privilege Role Grants (kalyan_app runtime user)
# ==============================================================================


def test_kalyan_app_cannot_update_audit_logs(app_engine: Engine) -> None:
    """kalyan_app lacks UPDATE privilege on audit_logs."""
    with app_engine.connect() as conn:
        with pytest.raises(ProgrammingError, match="permission denied"):
            conn.execute(text("UPDATE audit_logs SET action = 'tampered' WHERE id = 1"))


def test_kalyan_app_cannot_delete_from_audit_logs(app_engine: Engine) -> None:
    """kalyan_app lacks DELETE privilege on audit_logs."""
    with app_engine.connect() as conn:
        with pytest.raises(ProgrammingError, match="permission denied"):
            conn.execute(text("DELETE FROM audit_logs WHERE id = 1"))


def test_kalyan_app_cannot_truncate_audit_logs(app_engine: Engine) -> None:
    """kalyan_app lacks TRUNCATE privilege on audit_logs."""
    with app_engine.connect() as conn:
        with pytest.raises(ProgrammingError, match="permission denied"):
            conn.execute(text("TRUNCATE audit_logs"))


def test_kalyan_app_cannot_delete_from_users(app_engine: Engine) -> None:
    """kalyan_app lacks DELETE privilege on users (SEC-05: deactivate, never delete)."""
    with app_engine.connect() as conn:
        with pytest.raises(ProgrammingError, match="permission denied"):
            conn.execute(text("DELETE FROM users WHERE id = 1"))


def test_kalyan_app_cannot_insert_into_alembic_version(app_engine: Engine) -> None:
    """kalyan_app has read-only access to alembic_version; cannot forge revision."""
    with app_engine.connect() as conn:
        with pytest.raises(ProgrammingError, match="permission denied"):
            conn.execute(text("INSERT INTO alembic_version (version_num) VALUES ('fake')"))


def test_kalyan_app_cannot_create_objects_in_public_schema(app_engine: Engine) -> None:
    """kalyan_app has no CREATE privilege on public schema."""
    with app_engine.connect() as conn:
        has_create = conn.scalar(
            text("SELECT has_schema_privilege('kalyan_app', 'public', 'CREATE')")
        )
        assert has_create is False


def test_kalyan_app_cannot_mutate_system_setup(app_engine: Engine) -> None:
    """kalyan_app lacks UPDATE, DELETE, and TRUNCATE privileges on system_setup."""
    with app_engine.connect() as conn:
        with pytest.raises(ProgrammingError, match="permission denied"):
            conn.execute(text("UPDATE system_setup SET admin_user_id = 999 WHERE id = 1"))

    with app_engine.connect() as conn:
        with pytest.raises(ProgrammingError, match="permission denied"):
            conn.execute(text("DELETE FROM system_setup WHERE id = 1"))

    with app_engine.connect() as conn:
        with pytest.raises(ProgrammingError, match="permission denied"):
            conn.execute(text("TRUNCATE system_setup"))


# ==============================================================================
# 2. Append-Only Database Triggers (kalyan_owner migration user)
# ==============================================================================


@pytest.mark.db_owner
def test_kalyan_owner_cannot_update_audit_logs(owner_engine: Engine) -> None:
    """Triggers block UPDATE on audit_logs even for table owner (AUD-01)."""
    with owner_engine.connect() as conn:
        trans = conn.begin()
        row_id = conn.scalar(
            text("""
                INSERT INTO audit_logs (action, outcome, actor_username)
                VALUES ('OWNER_PROBE', 'SUCCESS', 'owner_test_update')
                RETURNING id
            """)
        )

        with pytest.raises(DBAPIError, match="append-only.*UPDATE blocked"):
            conn.execute(
                text("UPDATE audit_logs SET reason = 'tampered' WHERE id = :id"),
                {"id": row_id},
            )
        trans.rollback()


@pytest.mark.db_owner
def test_kalyan_owner_cannot_delete_from_audit_logs(owner_engine: Engine) -> None:
    """Triggers block DELETE on audit_logs even for table owner (AUD-01)."""
    with owner_engine.connect() as conn:
        trans = conn.begin()
        row_id = conn.scalar(
            text("""
                INSERT INTO audit_logs (action, outcome, actor_username)
                VALUES ('OWNER_PROBE', 'SUCCESS', 'owner_test_delete')
                RETURNING id
            """)
        )

        with pytest.raises(DBAPIError, match="append-only.*DELETE blocked"):
            conn.execute(
                text("DELETE FROM audit_logs WHERE id = :id"),
                {"id": row_id},
            )
        trans.rollback()


@pytest.mark.db_owner
def test_kalyan_owner_cannot_truncate_audit_logs(owner_engine: Engine) -> None:
    """Triggers block TRUNCATE on audit_logs even for table owner (AUD-01)."""
    with owner_engine.connect() as conn:
        trans = conn.begin()
        with pytest.raises(DBAPIError, match="append-only.*TRUNCATE blocked"):
            conn.execute(text("TRUNCATE audit_logs"))
        trans.rollback()


@pytest.mark.db_owner
def test_kalyan_owner_cannot_update_system_setup(owner_engine: Engine) -> None:
    """Triggers block UPDATE on system_setup (SEC-07)."""
    unique_suffix = uuid.uuid4().hex[:8]
    with owner_engine.connect() as conn:
        trans = conn.begin()
        admin_id = conn.scalar(
            text("""
                INSERT INTO users (username, full_name, role, password_hash)
                VALUES (:uname, 'Admin Test', 'ADMIN', 'fake_hash')
                RETURNING id
            """),
            {"uname": f"owner_admin_{unique_suffix}"},
        )
        conn.execute(
            text("""
                INSERT INTO system_setup (id, completed_at, admin_user_id)
                VALUES (1, now(), :admin_id)
            """),
            {"admin_id": admin_id},
        )

        with pytest.raises(DBAPIError, match="append-only.*UPDATE blocked"):
            conn.execute(text("UPDATE system_setup SET admin_user_id = 999 WHERE id = 1"))
        trans.rollback()


@pytest.mark.db_owner
def test_kalyan_owner_cannot_delete_from_system_setup(owner_engine: Engine) -> None:
    """Triggers block DELETE on system_setup (SEC-07)."""
    unique_suffix = uuid.uuid4().hex[:8]
    with owner_engine.connect() as conn:
        trans = conn.begin()
        admin_id = conn.scalar(
            text("""
                INSERT INTO users (username, full_name, role, password_hash)
                VALUES (:uname, 'Admin Test', 'ADMIN', 'fake_hash')
                RETURNING id
            """),
            {"uname": f"owner_admin_{unique_suffix}"},
        )
        conn.execute(
            text("""
                INSERT INTO system_setup (id, completed_at, admin_user_id)
                VALUES (1, now(), :admin_id)
            """),
            {"admin_id": admin_id},
        )

        with pytest.raises(DBAPIError, match="append-only.*DELETE blocked"):
            conn.execute(text("DELETE FROM system_setup WHERE id = 1"))
        trans.rollback()


@pytest.mark.db_owner
def test_kalyan_owner_cannot_truncate_system_setup(owner_engine: Engine) -> None:
    """Triggers block TRUNCATE on system_setup (SEC-07)."""
    with owner_engine.connect() as conn:
        trans = conn.begin()
        with pytest.raises(DBAPIError, match="append-only.*TRUNCATE blocked"):
            conn.execute(text("TRUNCATE system_setup"))
        trans.rollback()


# ==============================================================================
# 3. Model Constraints (system_setup singleton & users role constraints)
# ==============================================================================


def test_system_setup_enforces_single_row_id_1(app_engine: Engine) -> None:
    """system_setup table only permits id = 1 and rejects second row (SEC-07)."""
    unique_suffix = uuid.uuid4().hex[:8]
    with app_engine.connect() as conn:
        trans = conn.begin()
        admin_id = conn.scalar(
            text("""
                INSERT INTO users (username, full_name, role, password_hash)
                VALUES (:uname, 'Setup Admin', 'ADMIN', 'fake_hash')
                RETURNING id
            """),
            {"uname": f"setup_admin_{unique_suffix}"},
        )

        # id != 1 violates check constraint
        with pytest.raises(IntegrityError, match="ck_system_setup_single_row"):
            conn.execute(
                text("""
                    INSERT INTO system_setup (id, completed_at, admin_user_id)
                    VALUES (2, now(), :admin_id)
                """),
                {"admin_id": admin_id},
            )
        trans.rollback()

    with app_engine.connect() as conn:
        trans = conn.begin()
        admin_id = conn.scalar(
            text("""
                INSERT INTO users (username, full_name, role, password_hash)
                VALUES (:uname, 'Setup Admin 2', 'ADMIN', 'fake_hash')
                RETURNING id
            """),
            {"uname": f"setup_admin2_{unique_suffix}"},
        )
        conn.execute(
            text("""
                INSERT INTO system_setup (id, completed_at, admin_user_id)
                VALUES (1, now(), :admin_id)
            """),
            {"admin_id": admin_id},
        )

        # Inserting id 1 twice violates primary key unique constraint
        with pytest.raises(IntegrityError, match="pk_system_setup"):
            conn.execute(
                text("""
                    INSERT INTO system_setup (id, completed_at, admin_user_id)
                    VALUES (1, now(), :admin_id)
                """),
                {"admin_id": admin_id},
            )
        trans.rollback()


def test_users_role_and_doctor_id_check_constraints(app_engine: Engine) -> None:
    """users table enforces valid role enum and strict doctor_id association (SEC-03)."""
    with app_engine.connect() as conn:
        trans = conn.begin()

        # 1. Invalid role string violates ck_users_role_valid
        with pytest.raises(IntegrityError, match="ck_users_role_valid"):
            conn.execute(
                text("""
                    INSERT INTO users (username, full_name, role, password_hash)
                    VALUES ('bad_role', 'Super User', 'SUPERUSER', 'hash')
                """)
            )
        trans.rollback()

    with app_engine.connect() as conn:
        trans = conn.begin()
        # 2. DOCTOR role without doctor_id violates ck_users_doctor_role_requires_id
        with pytest.raises(IntegrityError, match="ck_users_doctor_role_requires_id"):
            conn.execute(
                text("""
                    INSERT INTO users (username, full_name, role, password_hash)
                    VALUES ('doc_without_id', 'Dr. Ghost', 'DOCTOR', 'hash')
                """)
            )
        trans.rollback()

    with app_engine.connect() as conn:
        trans = conn.begin()
        # Create a doctor stub
        doc_id = conn.scalar(
            text("""
                INSERT INTO doctors (name_en)
                VALUES ('Dr. Valid')
                RETURNING id
            """)
        )

        # 3. ADMIN role WITH a doctor_id violates ck_users_doctor_role_requires_id
        with pytest.raises(IntegrityError, match="ck_users_doctor_role_requires_id"):
            conn.execute(
                text("""
                    INSERT INTO users (username, full_name, role, doctor_id, password_hash)
                    VALUES ('admin_with_doc', 'Admin Doctor', 'ADMIN', :doc_id, 'hash')
                """),
                {"doc_id": doc_id},
            )
        trans.rollback()

    with app_engine.connect() as conn:
        trans = conn.begin()
        # Create a doctor stub
        doc_id = conn.scalar(
            text("""
                INSERT INTO doctors (name_en)
                VALUES ('Dr. Real')
                RETURNING id
            """)
        )

        # 4. DOCTOR role with valid doctor_id succeeds
        user_id = conn.scalar(
            text("""
                INSERT INTO users (username, full_name, role, doctor_id, password_hash)
                VALUES ('doc_valid', 'Dr. Real User', 'DOCTOR', :doc_id, 'hash')
                RETURNING id
            """),
            {"doc_id": doc_id},
        )
        assert user_id is not None
        trans.rollback()
