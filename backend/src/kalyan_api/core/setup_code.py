"""First-run setup code generation, verification, and rate limiting (SEC-07).

CRITICAL SECURITY INVARIANTS:
- The setup code must NEVER be logged via the logging module or written to audit tables.
- Stored in memory as SHA-256 hash only.
- Printed to console via print() ONLY when sys.stdout.isatty() is True.
- Written to backend/var/setup-code.txt (git-ignored, outside served paths).
- Compared using hmac.compare_digest in constant time.
"""

import hashlib
import hmac
import os
import secrets
import sys
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import FastAPI

from kalyan_api.config import Settings

# Unambiguous alphabet: excludes 0, O, 1, I
SETUP_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
SETUP_LOCK_THRESHOLD = 5
SETUP_LOCK_MINUTES = 15
SETUP_ROTATE_AFTER = 10


def get_default_setup_code_path() -> Path:
    """Resolve backend/var/setup-code.txt relative to the package tree."""
    return Path(__file__).resolve().parents[3] / "var" / "setup-code.txt"


def normalize_setup_code(submitted: str) -> str:
    """Normalize user input by stripping spaces, hyphens, and converting to uppercase."""
    return submitted.replace(" ", "").replace("-", "").upper()


def issue_setup_code(
    app: FastAPI,
    settings: Settings,
    path: Path | None = None,
) -> str:
    """Generate and issue a first-run setup code, writing it to disk and console only."""
    code_path = path or get_default_setup_code_path()
    code = "".join(secrets.choice(SETUP_CODE_ALPHABET) for _ in range(10))
    code_hash = hashlib.sha256(code.encode("ascii")).hexdigest()

    app.state.setup_code_hash = code_hash
    app.state.setup_code_path = code_path
    app.state.setup_failures_by_ip = {}
    app.state.setup_total_failures = 0

    code_path.parent.mkdir(parents=True, exist_ok=True)
    code_path.write_text(code.strip() + "\n", encoding="utf-8")

    try:
        os.chmod(code_path, 0o600)
    except OSError:
        pass  # Windows file systems may not support POSIX permission bits

    # Console display logic:
    # Print the code directly ONLY if stdout is a terminal (TTY)
    if sys.stdout.isatty():
        print("\n=======================================================")
        print(f"FIRST-RUN SETUP CODE: {code}")
        print(f"Written to: {code_path}")
        print("=======================================================\n")
    else:
        print(f"\nFirst-run setup code written to: {code_path}\n")

    return code


def verify_setup_code(app: FastAPI, submitted: str) -> bool:
    """Validate submitted setup code against the in-memory hash in constant time."""
    expected_hash: str | None = getattr(app.state, "setup_code_hash", None)
    if not expected_hash:
        return False

    normalized = normalize_setup_code(submitted)
    submitted_hash = hashlib.sha256(normalized.encode("ascii")).hexdigest()
    return hmac.compare_digest(submitted_hash, expected_hash)


def consume_setup_code(app: FastAPI, path: Path | None = None) -> None:
    """Atomically consume the setup code, clearing hash from memory and deleting file."""
    app.state.setup_code_hash = None
    target_path = (
        path or getattr(app.state, "setup_code_path", None) or get_default_setup_code_path()
    )
    try:
        if target_path and target_path.exists():
            target_path.unlink()
    except OSError:
        pass


def rotate_setup_code(
    app: FastAPI,
    settings: Settings,
    path: Path | None = None,
) -> str:
    """Rotate the setup code after repeated failure thresholds."""
    return issue_setup_code(app, settings, path)


def register_setup_failure(
    app: FastAPI,
    ip: str,
    now: datetime,
) -> tuple[int, bool, bool]:
    """Record an invalid setup code submission from an IP address.

    Returns:
        (current_ip_failures, is_ip_locked, should_rotate_code)
    """
    failures_by_ip: dict[str, tuple[int, datetime]] = getattr(app.state, "setup_failures_by_ip", {})
    count, window_start = failures_by_ip.get(ip, (0, now))

    if (now - window_start) > timedelta(minutes=SETUP_LOCK_MINUTES):
        count = 0
        window_start = now

    count += 1
    failures_by_ip[ip] = (count, window_start)
    app.state.setup_failures_by_ip = failures_by_ip

    total_failures: int = getattr(app.state, "setup_total_failures", 0) + 1
    app.state.setup_total_failures = total_failures

    is_locked = count >= SETUP_LOCK_THRESHOLD
    should_rotate = total_failures >= SETUP_ROTATE_AFTER

    return count, is_locked, should_rotate


def is_address_locked(app: FastAPI, ip: str, now: datetime) -> tuple[bool, int]:
    """Check if client IP address is temporarily locked out from submitting setup codes.

    Returns:
        (is_locked, retry_after_seconds)
    """
    failures_by_ip: dict[str, tuple[int, datetime]] = getattr(app.state, "setup_failures_by_ip", {})
    if ip not in failures_by_ip:
        return False, 0

    count, window_start = failures_by_ip[ip]
    elapsed = now - window_start
    window_duration = timedelta(minutes=SETUP_LOCK_MINUTES)

    if elapsed >= window_duration:
        return False, 0

    if count >= SETUP_LOCK_THRESHOLD:
        remaining_seconds = int((window_duration - elapsed).total_seconds())
        return True, max(1, remaining_seconds)

    return False, 0
