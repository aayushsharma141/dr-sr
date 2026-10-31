"""Command-line interface for database migration, inspection, and operations.

Prohibitions:
- Never print passwords or raw database connection URLs.
- Migration commands must run under the owner role; status checks run under the app role.
"""

import argparse
import sys
from collections.abc import Sequence

from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine

from kalyan_api.config import get_settings
from kalyan_api.db.migrate import alembic_config, upgrade_head
from kalyan_api.db.startup import check_durability


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

    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """CLI application entrypoint."""
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command == "migrate":
        return cmd_migrate()
    if args.command == "check-db":
        return cmd_check_db()

    parser.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
