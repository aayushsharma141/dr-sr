"""Audit proof for zero default or seeded credentials in Kalyan Hospital platform (SEC-05, SC-4).

Guarantees:
- Legacy credentials extracted from app/ never appear in backend/ or frontend/ source.
- Attempting login with legacy default credentials fails with 401 invalid_credentials.
- Every password key in backend/.env.example is set to CHANGE_ME.
- Fresh migration head produces zero user rows and zero system_setup rows.
"""

import re
from pathlib import Path

from fastapi.testclient import TestClient


def test_legacy_credentials_absent_from_v3_codebase() -> None:
    """Legacy v2.0 credentials must NOT exist anywhere in v3.0 backend/ or frontend/ trees."""
    repo_root = Path(__file__).resolve().parents[2]
    legacy_auth_file = repo_root / "legacy" / "app" / "services" / "auth_service.py"
    assert legacy_auth_file.exists(), (
        "Legacy auth_service.py must exist to extract legacy credentials"
    )

    legacy_content = legacy_auth_file.read_text(encoding="utf-8")
    pw_match = re.search(r'default_password:\s*str\s*=\s*"([^"]+)"', legacy_content)
    user_match = re.search(r'default_username:\s*str\s*=\s*"([^"]+)"', legacy_content)

    assert pw_match is not None, "Could not extract default_password from legacy auth_service.py"
    assert user_match is not None, "Could not extract default_username from legacy auth_service.py"

    legacy_password = pw_match.group(1).strip()
    assert len(legacy_password) > 0

    # Search backend/ and frontend/ excluding build/venv/node_modules/test_no_default_credentials.py
    search_dirs = [repo_root / "backend", repo_root / "frontend"]
    ignored_patterns = {
        ".venv",
        "node_modules",
        "dist",
        "var",
        "__pycache__",
        ".pytest_cache",
        ".git",
        "test_no_default_credentials.py",
        "pnpm-lock.yaml",
        "package-lock.json",
    }
    binary_exts = {".pyc", ".ico", ".png", ".jpg", ".woff", ".woff2", ".exe", ".dll"}

    violations: list[str] = []
    for s_dir in search_dirs:
        if not s_dir.exists():
            continue
        for p in s_dir.rglob("*"):
            if not p.is_file():
                continue
            if any(part in ignored_patterns for part in p.parts):
                continue
            if p.suffix.lower() in binary_exts:
                continue

            try:
                text = p.read_text(encoding="utf-8", errors="ignore")
                if legacy_password in text:
                    violations.append(f"{p}: contains legacy default password")
            except OSError:
                continue

    assert not violations, "Legacy default password found in v3.0 files:\n" + "\n".join(violations)


def test_login_with_legacy_credentials_fails(client: TestClient) -> None:
    """Attempting authentication with legacy default credentials returns 401."""
    repo_root = Path(__file__).resolve().parents[2]
    legacy_auth_file = repo_root / "legacy" / "app" / "services" / "auth_service.py"
    legacy_content = legacy_auth_file.read_text(encoding="utf-8")
    pw_match = re.search(r'default_password:\s*str\s*=\s*"([^"]+)"', legacy_content)
    user_match = re.search(r'default_username:\s*str\s*=\s*"([^"]+)"', legacy_content)

    assert pw_match and user_match
    legacy_user = user_match.group(1).strip()
    legacy_password = pw_match.group(1).strip()

    resp = client.post(
        "/api/auth/login",
        json={"username": legacy_user, "password": legacy_password},
    )
    assert resp.status_code == 401
    assert resp.json()["code"] == "invalid_credentials"


def test_env_example_passwords_are_change_me() -> None:
    """All database password fields in backend/.env.example must be CHANGE_ME."""
    repo_root = Path(__file__).resolve().parents[2]
    env_example = repo_root / "backend" / ".env.example"
    assert env_example.exists()

    lines = env_example.read_text(encoding="utf-8").splitlines()
    pwd_lines = [
        line.strip()
        for line in lines
        if "PASSWORD" in line and not line.strip().startswith("#") and "=" in line
    ]
    assert len(pwd_lines) >= 2, "Expected at least 2 password entries in .env.example"

    for line in pwd_lines:
        key, val = line.split("=", 1)
        assert val.strip() == "CHANGE_ME", f"Expected CHANGE_ME placeholder for {key}, got '{val}'"


def test_migrated_db_has_zero_seed_rows(migrated_db: dict[str, int]) -> None:
    """Zero seed users and zero system_setup records exist after upgrade head."""
    assert migrated_db["users"] == 0
    assert migrated_db["doctors"] == 0
    assert migrated_db["system_setup"] == 0
