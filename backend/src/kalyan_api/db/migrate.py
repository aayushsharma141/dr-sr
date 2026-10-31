"""Programmatic Alembic configuration and migration execution."""

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy.engine import URL

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"


def alembic_config(url: URL | str) -> Config:
    """Build an Alembic Config programmatically pointing to package migrations.

    URL percent signs are doubled ('%%') to prevent ConfigParser interpolation errors.
    """
    url_str = str(url)
    safe_url = url_str.replace("%", "%%")

    cfg = Config()
    cfg.set_main_option("script_location", str(MIGRATIONS_DIR))
    cfg.set_main_option("sqlalchemy.url", safe_url)
    cfg.attributes["url"] = url
    cfg.attributes["target_metadata"] = None  # Populated by env.py
    return cfg


def upgrade_head(url: URL | str) -> None:
    """Run Alembic upgrade to head revision."""
    cfg = alembic_config(url)
    command.upgrade(cfg, "head")
