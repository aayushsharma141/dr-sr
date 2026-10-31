"""Application configuration and environment settings."""

import json
from contextlib import suppress
from functools import lru_cache
from pathlib import Path
from typing import Any

from pydantic import field_validator, model_validator
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

    # Password policy constraints (EG-19)
    password_min_length: int = 10
    password_max_length: int = 128
    temp_password_length: int = 12

    # Argon2id password hashing parameters
    argon2_time_cost: int = 3
    argon2_memory_cost: int = 65536
    argon2_parallelism: int = 4

    # CORS and CSRF allowed origins
    extra_allowed_origins: list[str] | str = []

    # Frontend SPA distribution directory
    frontend_dist: Path | None = None

    # First-run setup code file location (SEC-07)
    setup_code_path: Path | None = None

    # Patient photos storage location (PAT-05)
    photos_dir: Path = BACKEND_DIR / "var" / "photos" 

    model_config = SettingsConfigDict(
        env_prefix="KALYAN_",
        env_file=str(ENV_FILE_PATH) if ENV_FILE_PATH.exists() else None,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @field_validator("frontend_dist", mode="before")
    @classmethod
    def validate_frontend_dist_absolute(cls, v: Any) -> Path | None:
        if v is None or v == "" or (isinstance(v, str) and not v.strip()):
            return None
        p = Path(v)
        if not p.is_absolute():
            raise ValueError(f"frontend_dist must be an absolute path, got: {v}")
        return p

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

    @model_validator(mode="after")
    def validate_password_policy_bounds(self) -> "Settings":
        if self.password_min_length < 8:
            raise ValueError("password_min_length must be at least 8 characters")
        if self.password_max_length > 1024:
            raise ValueError("password_max_length must not exceed 1024 characters")
        if self.password_min_length > self.password_max_length:
            raise ValueError("password_min_length cannot exceed password_max_length")
        if self.temp_password_length < self.password_min_length:
            raise ValueError("temp_password_length cannot be less than password_min_length")
        return self

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

