"""Command-line interface for database migration, inspection, and operations.

Recovery is authenticated by OS-level access to the server PC plus the protected
backend/.env database credentials; it cannot create a first admin or reopen setup;
first-admin creation is the web wizard (http://SERVER:8000/setup, or http://127.0.0.1:8000/setup
on a headless server) with the code from backend/var/setup-code.txt; create-admin
intentionally does not exist.

Prohibitions:
- Never accept a password as a command-line argument (--password is strictly prohibited).
- Never print passwords or raw database connection URLs.
- Migration commands must run under the owner role; status checks run under the app role.
"""

import argparse
import getpass
import secrets
import sys
from collections.abc import Sequence
from pathlib import Path

from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, func, select, update

from kalyan_api import clock
from kalyan_api.config import get_settings
from kalyan_api.core.password_policy import PasswordPolicyError, validate_password_policy
from kalyan_api.core.permissions import Role
from kalyan_api.core.security import build_hasher, hash_password
from kalyan_api.core.setup_code import SETUP_CODE_ALPHABET
from kalyan_api.db.migrate import alembic_config, upgrade_head
from kalyan_api.db.session import session_scope
from kalyan_api.db.startup import check_durability
from kalyan_api.models import AuthSession, User
from kalyan_api.services import audit_service
from kalyan_api.services.audit_service import AuditAction, AuditContext


def cmd_migrate() -> int:
    """Apply all pending database migrations up to head revision using owner credentials."""
    settings = get_settings()
    print(f"Applying migrations to database '{settings.db_name}'...")
    try:
        upgrade_head(settings.owner_url)
    except Exception as exc:
        print(f"Migration failed: {exc}", file=sys.stderr)
        return 1

    # Read back current revision using owner credentials
    cfg = alembic_config(settings.owner_url)
    script = ScriptDirectory.from_config(cfg)
    head_rev = script.get_current_head()

    owner_engine = create_engine(settings.owner_url)
    try:
        with owner_engine.connect() as conn:
            context = MigrationContext.configure(conn)
            current_rev = context.get_current_revision()
    finally:
        owner_engine.dispose()

    print(f"Migration completed successfully. Current revision: {current_rev} (head: {head_rev})")
    return 0


def cmd_check_db() -> int:
    """Verify database connection, schema revision, and durability settings as kalyan_app."""
    settings = get_settings()
    print(f"Inspecting database '{settings.db_name}' at {settings.db_host}:{settings.db_port}...")

    app_engine = create_engine(settings.app_url)
    try:
        with app_engine.connect() as conn:
            # Check schema revision
            context = MigrationContext.configure(conn)
            current_rev = context.get_current_revision()

        cfg = alembic_config(settings.app_url)
        script = ScriptDirectory.from_config(cfg)
        head_rev = script.get_current_head()

        print(f"Schema revision: {current_rev} (expected head: {head_rev})")
        if current_rev != head_rev:
            print(
                f"ERROR: Schema mismatch! Revision '{current_rev}' != head '{head_rev}'.",
                file=sys.stderr,
            )
            return 1

        # Check durability settings
        durability = check_durability(app_engine, strict=False)
        for k, v in durability.items():
            print(f"{k}: {v}")

        is_durable = (
            durability.get("synchronous_commit") in ("on", "remote_apply")
            and durability.get("fsync") == "on"
            and durability.get("full_page_writes") == "on"
        )

        if not is_durable:
            print(
                "WARNING: Database durability settings do not satisfy D-02 requirements.",
                file=sys.stderr,
            )
            if settings.env.lower() == "production":
                return 1

        print("Database health check: OK")
        return 0
    except Exception as exc:
        print(f"Database inspection failed: {exc}", file=sys.stderr)
        return 1
    finally:
        app_engine.dispose()


def cmd_reset_admin_password(
    username: str,
    password_stdin: bool = False,
    generate_password: bool = False,
) -> int:
    """Reset the password for an existing active administrator via console recovery."""
    settings = get_settings()

    if generate_password:
        new_pwd = "".join(
            secrets.choice(SETUP_CODE_ALPHABET) for _ in range(settings.temp_password_length)
        )
        must_change = True
    elif password_stdin:
        new_pwd = sys.stdin.read().strip()
        must_change = False
    else:
        p1 = getpass.getpass("Enter new password: ")
        p2 = getpass.getpass("Confirm new password: ")
        if p1 != p2:
            print("Error: Passwords do not match.", file=sys.stderr)
            return 1
        new_pwd = p1
        must_change = False

    # Validate password against NIST policy
    try:
        validate_password_policy(new_pwd, username, None, settings)
    except PasswordPolicyError as err:
        print(f"Error: Password policy violation: {err.message}", file=sys.stderr)
        return 1

    try:
        with session_scope(settings) as session:
            normalized_username = username.strip().lower()
            user = session.scalar(
                select(User).where(func.lower(User.username) == normalized_username)
            )
            if not user:
                print(f"Error: User '{username}' not found.", file=sys.stderr)
                return 1
            if user.role != Role.ADMIN.value:
                print(f"Error: User '{username}' is not an administrator.", file=sys.stderr)
                return 1
            if not user.is_active:
                print(f"Error: Administrator '{username}' is deactivated.", file=sys.stderr)
                return 1

            hasher = build_hasher(settings)
            user.password_hash = hash_password(hasher, new_pwd)
            user.failed_login_count = 0
            user.locked_until = None
            user.must_change_password = must_change

            # Revoke all active sessions for this user
            now = clock.utcnow()
            session.execute(
                update(AuthSession)
                .where(AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None))
                .values(revoked_at=now)
            )
            session.flush()

            try:
                operator = getpass.getuser()
            except Exception:
                operator = "unknown"

            ctx = AuditContext.system(f"cli:{operator}")
            audit_service.record(
                session,
                ctx,
                AuditAction.ADMIN_PASSWORD_RESET_CLI,
                "USER",
                user.id,
                after={"must_change_password": must_change},
            )
    except Exception as exc:
        print(f"Error during password reset: {exc}", file=sys.stderr)
        return 1

    if generate_password:
        print(f"Generated temporary password: {new_pwd}")
    print(f"Password reset successfully for administrator '{username}'.")
    return 0


def cmd_export_openapi(out_path: str) -> int:
    """Export normalized OpenAPI specification to JSON file."""
    import json
    from pathlib import Path

    from kalyan_api.main import create_app

    settings = get_settings()
    app = create_app(settings)
    schema = app.openapi()

    target = Path(out_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("w", encoding="utf-8") as f:
        json.dump(schema, f, indent=2, sort_keys=True)
        f.write("\n")
    print(f"OpenAPI specification exported to '{target}'.")
    return 0


def cmd_backup_create(destination: str | None = None, label: str | None = None) -> int:
    """Create a backup bundle from the command line."""
    from kalyan_api.services.backup_service import create_backup

    dest_path = Path(destination) if destination else None
    print(f"Creating backup bundle (label={label}, destination={destination or 'default'})...")
    try:
        archive_path = create_backup(destination_dir=dest_path, label=label)
        print(f"SUCCESS: Backup bundle created at {archive_path}")
        return 0
    except Exception as exc:
        print(f"ERROR: Backup creation failed: {exc}", file=sys.stderr)
        return 1


def cmd_backup_restore(archive_path_str: str, force: bool = False) -> int:
    """Restore from a backup bundle with pre-flight verification and pre-snapshot."""
    from kalyan_api.services.backup_service import restore_backup

    archive_path = Path(archive_path_str)
    if not archive_path.exists():
        print(f"ERROR: Backup archive not found: {archive_path_str}", file=sys.stderr)
        return 1

    print(f"Restoring system from backup bundle {archive_path_str}...")
    try:
        result = restore_backup(archive_path=archive_path, create_prerestore_snapshot=True)
        snap = result.get("prerestore_snapshot")
        print(f"SUCCESS: System restored. Pre-restore snapshot: {snap}")
        return 0
    except Exception as exc:
        print(f"ERROR: Restoration failed: {exc}", file=sys.stderr)
        return 1


def cmd_backup_verify(archive_path_str: str) -> int:
    """Inspect and cryptographically verify a backup archive without touching the database."""
    from kalyan_api.services.backup_service import verify_backup_bundle

    archive_path = Path(archive_path_str)
    if not archive_path.exists():
        print(f"ERROR: Archive does not exist: {archive_path_str}", file=sys.stderr)
        return 1

    is_valid, msg, manifest = verify_backup_bundle(archive_path)
    if is_valid:
        print(f"SUCCESS: {msg}")
        if manifest:
            v = manifest.get("version")
            c_at = manifest.get("created_at")
            print(f"Manifest Version: {v}, Created: {c_at}")
            sha = manifest.get("database_dump_sha256")
            pc = manifest.get("photos_count")
            print(f"DB Dump SHA: {sha}, Photos: {pc}")
        return 0
    else:
        print(f"VERIFICATION FAILED: {msg}", file=sys.stderr)
        return 1


def cmd_integrity_check() -> int:
    """Execute complete suite of clinical and financial integrity checks."""
    from kalyan_api.services.integrity_service import run_integrity_audit

    with session_scope() as session:
        report = run_integrity_audit(session=session)
        print(f"System Integrity Report ({report.generated_at})")
        print(f"Overall Status: {'HEALTHY' if report.is_healthy else 'DISCREPANCIES DETECTED'}")
        print(f"Checks Passed: {report.passed_checks}/{report.total_checks}")
        for c in report.checks:
            status_str = "PASS" if c.passed else "FAIL"
            print(f"  [{status_str}] {c.name}: {c.details}")
            for d in c.discrepancies:
                print(f"        -> {d}")
        return 0 if report.is_healthy else 1


def build_parser() -> argparse.ArgumentParser:
    """Build top-level argument parser with extensible subcommands."""
    parser = argparse.ArgumentParser(
        prog="python -m kalyan_api.cli",
        description="Kalyan Hospital Management System CLI administration tool",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Subcommand: migrate
    subparsers.add_parser(
        "migrate",
        help="Apply pending database migrations up to head using kalyan_owner",
    )

    # Subcommand: check-db
    subparsers.add_parser(
        "check-db",
        help="Verify database connectivity, schema revision, and D-02 durability invariants",
    )

    # Subcommand: reset-admin-password
    reset_parser = subparsers.add_parser(
        "reset-admin-password",
        help="Emergency CLI password reset for an active administrator account",
    )
    reset_parser.add_argument(
        "--username",
        required=True,
        help="Username of the active administrator account to reset",
    )
    pwd_group = reset_parser.add_mutually_exclusive_group(required=False)
    pwd_group.add_argument(
        "--password-stdin",
        action="store_true",
        help="Read the new password from standard input (stdin)",
    )
    pwd_group.add_argument(
        "--generate-password",
        action="store_true",
        help="Generate a temporary password and print it to standard output once",
    )

    # Subcommand: export-openapi
    openapi_parser = subparsers.add_parser(
        "export-openapi",
        help="Export normalized OpenAPI 3.1 specification to JSON file",
    )
    openapi_parser.add_argument(
        "--out",
        required=True,
        help="Target file path for the exported JSON schema",
    )

    # Subcommand: backup-create
    b_create = subparsers.add_parser("backup-create", help="Create full backup bundle (.tar.gz)")
    b_create.add_argument("--destination", help="Optional target directory")
    b_create.add_argument("--label", help="Optional backup label")

    # Subcommand: backup-restore
    b_restore = subparsers.add_parser(
        "backup-restore", help="Restore system from verified backup bundle"
    )
    b_restore.add_argument("archive", help="Path to backup .tar.gz bundle")
    b_restore.add_argument("--force", action="store_true", help="Force restore")

    # Subcommand: backup-verify
    b_verify = subparsers.add_parser(
        "backup-verify", help="Inspect and cryptographically verify backup bundle"
    )
    b_verify.add_argument("archive", help="Path to backup .tar.gz bundle")

    # Subcommand: integrity-check
    subparsers.add_parser(
        "integrity-check", help="Run comprehensive clinical and financial integrity audit"
    )

    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """CLI application entrypoint."""
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command == "migrate":
        return cmd_migrate()
    if args.command == "check-db":
        return cmd_check_db()
    if args.command == "reset-admin-password":
        return cmd_reset_admin_password(
            username=args.username,
            password_stdin=args.password_stdin,
            generate_password=args.generate_password,
        )
    if args.command == "backup-create":
        return cmd_backup_create(destination=args.destination, label=args.label)
    if args.command == "backup-restore":
        return cmd_backup_restore(archive_path_str=args.archive, force=args.force)
    if args.command == "backup-verify":
        return cmd_backup_verify(archive_path_str=args.archive)
    if args.command == "integrity-check":
        return cmd_integrity_check()
    if args.command == "export-openapi":
        return cmd_export_openapi(out_path=args.out)

    parser.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
