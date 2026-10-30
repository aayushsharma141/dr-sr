"""Application configuration and environment settings."""

import json
from contextlib import suppress
from functools import lru_cache
from pathlib import Path
from typing import Any

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import URL

# Resolve repository and backend roots
BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
ENV_FILE_PATH = BACKEND_DIR / ".env"


class Settings(BaseSettings):
    """Centralized configuration loaded from environment and backend/.env."""

    env: str = "development"

    # Database connection parameters
    db_host: str = "127.0.0.1"
    db_port: int = 5432
    db_name: str = "kalyan_dev"
    db_app_user: str = "kalyan_app"
    db_app_password: str = ""
    db_owner_user: str = "kalyan_owner"
    db_owner_password: str = ""

    # Session & cookie security
    cookie_name: str = "kalyan_session"
    cookie_secure: bool = False  # D-01: Plain HTTP on offline LAN
    session_idle_minutes: int = 30  # D-07
    session_absolute_hours: int = 12
    touch_throttle_seconds: int = 60

    # Brute-force lockout and rate limits
    lockout_threshold: int = 5
    lockout_minutes: int = 15  # D-07
    throttle_max_failures: int = 20
    throttle_window_minutes: int = 15

    # Argon2id password hashing parameters
    argon2_time_cost: int = 3
    argon2_memory_cost: int = 65536
    argon2_parallelism: int = 4

    # CORS and CSRF allowed origins
    extra_allowed_origins: list[str] | str = []

    # Frontend SPA distribution directory
    frontend_dist: Path | None = None

    model_config = SettingsConfigDict(
        env_prefix="KALYAN_",
        env_file=str(ENV_FILE_PATH) if ENV_FILE_PATH.exists() else None,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @field_validator("extra_allowed_origins", mode="after")
    @classmethod
    def parse_allowed_origins(cls, v: Any) -> list[str]:
        if isinstance(v, str):
            val = v.strip()
            if not val:
                return []
            if val.startswith("[") and val.endswith("]"):
                with suppress(json.JSONDecodeError, TypeError, ValueError):
                    parsed = json.loads(val)
                    if isinstance(parsed, list):
                        return [str(x).strip() for x in parsed if str(x).strip()]
            return [x.strip() for x in val.split(",") if x.strip()]
        if isinstance(v, (list, tuple)):
            return [str(x).strip() for x in v if str(x).strip()]
        return []

    @field_validator("db_app_password", "db_owner_password", mode="after")
    @classmethod
    def validate_password_not_placeholder(cls, v: str) -> str:
        if v == "CHANGE_ME":
            raise ValueError("Database password cannot be default placeholder 'CHANGE_ME'")
        return v

    @property
    def app_url(self) -> URL:
        """SQLAlchemy database URL for runtime application user (kalyan_app)."""
        return URL.create(
            drivername="postgresql+psycopg",
            username=self.db_app_user,
            password=self.db_app_password,
            host=self.db_host,
            port=self.db_port,
            database=self.db_name,
        )

    @property
    def owner_url(self) -> URL:
        """SQLAlchemy database URL for migration owner user (kalyan_owner)."""
        return URL.create(
            drivername="postgresql+psycopg",
            username=self.db_owner_user,
            password=self.db_owner_password,
            host=self.db_host,
            port=self.db_port,
            database=self.db_name,
        )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return cached Settings instance."""
    return Settings()

