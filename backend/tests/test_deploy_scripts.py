"""Tests verifying deployment and auto-recovery orchestration scripts (DEP-01, DEP-02)."""

import json
import re
import shutil
import subprocess
import threading
from collections.abc import Generator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

HEALTH_SCRIPT = Path(__file__).resolve().parent.parent.parent / "deploy" / "health-check.ps1"
POWERSHELL = shutil.which("powershell") or shutil.which("pwsh")


def test_deploy_scripts_exist_and_executable():
    """Verify all production deployment files and templates exist."""
    repo_root = Path(__file__).resolve().parent.parent.parent
    deploy_dir = repo_root / "deploy"

    assert deploy_dir.exists()
    assert (deploy_dir / "install.ps1").exists()
    assert (deploy_dir / "start-server.bat").exists()
    assert (deploy_dir / "stop-server.bat").exists()
    assert (deploy_dir / "register-autostart.ps1").exists()
    assert (deploy_dir / "unregister-autostart.ps1").exists()
    assert (deploy_dir / "health-check.ps1").exists()
    assert (deploy_dir / ".env.production.template").exists()


def test_production_env_template_configuration():
    """Verify production template enforces offline LAN security and correct settings."""
    repo_root = Path(__file__).resolve().parent.parent.parent
    env_template = (repo_root / "deploy" / ".env.production.template").read_text(encoding="utf-8")

    assert "KALYAN_ENV=production" in env_template
    assert "KALYAN_COOKIE_SECURE=false" in env_template  # D-01: HTTP on offline LAN
    assert "KALYAN_EXTRA_ALLOWED_ORIGINS=" in env_template
    assert "KALYAN_FRONTEND_DIST=" in env_template
    assert "KALYAN_PHOTOS_DIR=" in env_template
    assert "KALYAN_BACKUP_DIR=" in env_template


def test_startup_script_verifies_database_durability():
    """Verify start-server.bat executes check-db before running server."""
    repo_root = Path(__file__).resolve().parent.parent.parent
    start_bat = (repo_root / "deploy" / "start-server.bat").read_text(encoding="utf-8")

    assert "check-db" in start_bat
    assert "uvicorn" in start_bat
    assert "--port 8000" in start_bat


def _script_response_keys() -> set[str]:
    """Every `$Response.<key>` property the health-check script reads."""
    script = HEALTH_SCRIPT.read_text(encoding="utf-8")
    return set(re.findall(r"\$Response\.([A-Za-z_][A-Za-z0-9_]*)", script))


def test_health_script_reads_only_keys_the_health_endpoint_returns(client: TestClient) -> None:
    """The script must check `db` (not the never-returned `database`) against /api/health."""
    res = client.get("/api/health")
    assert res.status_code == 200
    payload: dict[str, Any] = res.json()
    assert payload["db"] == "ok"

    referenced = _script_response_keys()
    assert "status" in referenced
    assert "db" in referenced
    assert "database" not in referenced
    missing = referenced - set(payload)
    assert not missing, f"health-check.ps1 reads keys /api/health never returns: {missing}"

    script = HEALTH_SCRIPT.read_text(encoding="utf-8")
    assert '$Response.db -eq "ok"' in script
    assert "connected" not in script


class _HealthStub(BaseHTTPRequestHandler):
    """Minimal stand-in for /api/health serving a configurable JSON payload."""

    payload: dict[str, Any] = {}

    def do_GET(self) -> None:  # noqa: N802 - http.server API
        body = json.dumps(self.payload).encode("utf-8")
        self.send_response(200 if self.path == "/api/health" else 404)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        return None


@pytest.fixture
def health_stub() -> Generator[tuple[str, type[_HealthStub]], None, None]:
    handler = type("HealthStubHandler", (_HealthStub,), {"payload": {}})
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}", handler
    finally:
        server.shutdown()
        server.server_close()


def _run_health_script(server_url: str) -> subprocess.CompletedProcess[str]:
    assert POWERSHELL is not None
    # Executed as a script block so the host's script execution policy is not involved.
    command = (
        f"& ([scriptblock]::Create((Get-Content -Raw -LiteralPath '{HEALTH_SCRIPT}'))) "
        f"-ServerUrl '{server_url}'"
    )
    return subprocess.run(  # noqa: S603
        [POWERSHELL, "-NoProfile", "-NonInteractive", "-Command", command],
        capture_output=True,
        text=True,
        timeout=45,
        check=False,
    )


@pytest.mark.skipif(POWERSHELL is None, reason="PowerShell is not available on this host")
@pytest.mark.parametrize(
    ("payload", "expected_exit"),
    [
        ({"status": "ok", "db": "ok", "setup_required": False}, 0),
        ({"status": "ok", "db": "ok", "setup_required": True}, 0),
        ({"status": "ok", "db": "down", "setup_required": False}, 1),
        # The pre-fix script required this legacy shape; it must now be reported as degraded.
        ({"status": "ok", "database": "connected"}, 1),
    ],
)
def test_health_script_exit_codes_against_stub(
    health_stub: tuple[str, type[_HealthStub]],
    payload: dict[str, Any],
    expected_exit: int,
) -> None:
    url, handler = health_stub
    handler.payload = payload
    result = _run_health_script(url)
    assert result.returncode == expected_exit, result.stdout + result.stderr


@pytest.mark.skipif(POWERSHELL is None, reason="PowerShell is not available on this host")
def test_health_script_unreachable_server_exits_2() -> None:
    probe = ThreadingHTTPServer(("127.0.0.1", 0), _HealthStub)
    port = probe.server_address[1]
    probe.server_close()  # free the port so nothing is listening there
    result = _run_health_script(f"http://127.0.0.1:{port}")
    assert result.returncode == 2, result.stdout + result.stderr
