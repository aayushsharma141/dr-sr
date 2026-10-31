"""Canary tests pinning the runtime stack, binary drivers, and timezone integrity."""

import importlib.metadata
import zoneinfo
from datetime import UTC
from pathlib import Path

import psycopg.pq

import kalyan_api
from kalyan_api import clock
from kalyan_api.config import Settings


def test_installed_package_versions_equal_pins() -> None:
    """Verify runtime stack packages match the exact locked research versions."""
    assert importlib.metadata.version("fastapi") == "0.162.0"
    assert importlib.metadata.version("starlette") == "1.10.0"
    assert importlib.metadata.version("sqlalchemy") == "2.0.55"
    assert importlib.metadata.version("psycopg") == "3.3.6"
    assert importlib.metadata.version("alembic") == "1.20.1"
    assert importlib.metadata.version("pydantic") == "2.14.2"


def test_psycopg_uses_binary_driver() -> None:
    """Verify psycopg is utilizing the fast C/binary implementation rather than pure Python."""
    assert psycopg.pq.__impl__ == "binary"


def test_timezone_data_resolves_asia_kolkata() -> None:
    """Verify ZoneInfo('Asia/Kolkata') resolves properly via tzdata without system dependency."""
    zone = zoneinfo.ZoneInfo("Asia/Kolkata")
    assert zone.key == "Asia/Kolkata"


def test_production_hasher_meets_owasp_floor() -> None:
    """Verify production settings configure Argon2id at or above OWASP minimum security floor."""
    prod_settings = Settings(env="production")
    assert prod_settings.argon2_time_cost >= 2
    assert prod_settings.argon2_memory_cost >= 19456
    assert prod_settings.argon2_parallelism >= 1


def test_kalyan_api_package_resolves_under_backend_src() -> None:
    """Verify kalyan_api resolves strictly from backend/src to prevent legacy module shadowing."""
    init_path = Path(kalyan_api.__file__).resolve()
    assert "backend" in init_path.parts
    assert "src" in init_path.parts


def test_clock_helpers() -> None:
    """Verify clock abstractions return timezone-aware UTC and IST datetimes."""
    utc = clock.utcnow()
    assert utc.tzinfo == UTC

    ist = clock.ist_now()
    assert ist.tzinfo == clock.IST

    today_ist = clock.ist_today()
    assert today_ist == ist.date()
