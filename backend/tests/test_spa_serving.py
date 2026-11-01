"""Tests for SPA static frontend serving, caching semantics, and path traversal security.

Guarantees:
- HTML navigations return index.html with Cache-Control: no-cache.
- JSON requests to SPA paths return 404 JSON without returning index.html.
- /assets/* responses carry Cache-Control: public, max-age=31536000, immutable.
- Missing assets return 404.
- HEAD requests work correctly for HTML and asset files.
- /api responses strictly maintain Cache-Control: no-store.
- Path traversal probes (/../secret.txt, /assets/../../secret.txt, URL-encoded %2e%2e, backslash)
  never expose files outside the frontend dist directory.
- Settings rejects relative frontend_dist paths to prevent serving unintended directories.
- Without dist/index.html, the application starts gracefully in API-only mode.
- Real production bundle contains no external host references (needs_build).
"""

import os
import re
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from kalyan_api.config import Settings
from kalyan_api.main import create_app

SECRET_CONTENT = "CLASSIFIED_HOSPITAL_SECRET_TOP_CONFIDENTIAL_12345"


def _make_client(app: FastAPI) -> TestClient:
    """Build a TestClient configured with testserver base URL and Origin header."""
    return TestClient(
        app,
        base_url="http://testserver",
        headers={"Origin": "http://testserver"},
    )


@pytest.fixture
def mock_spa_dist(tmp_path: Path) -> tuple[Path, Path]:
    """Create a temporary mock dist directory with index.html, assets, and an out-of-dist secret."""
    parent_dir = tmp_path / "sandbox"
    parent_dir.mkdir()

    secret_file = parent_dir / "secret.txt"
    secret_file.write_text(SECRET_CONTENT, encoding="utf-8")

    dist_dir = parent_dir / "dist"
    dist_dir.mkdir()

    index_html = dist_dir / "index.html"
    index_html.write_text(
        "<!doctype html><html><head><title>K</title></head>"
        "<body><div id='root'>Mock SPA</div></body></html>",
        encoding="utf-8",
    )

    assets_dir = dist_dir / "assets"
    assets_dir.mkdir()
    asset_file = assets_dir / "app-abc123.js"
    asset_file.write_text("console.log('kalyan spa bundle');", encoding="utf-8")

    return dist_dir, secret_file


def test_html_navigation_returns_index_html_with_no_cache(
    test_settings: Settings,
    mock_spa_dist: tuple[Path, Path],
) -> None:
    """HTML navigations serve index.html with Cache-Control: no-cache."""
    dist_dir, _ = mock_spa_dist
    settings = Settings(
        env="test",
        db_name=test_settings.db_name,
        frontend_dist=dist_dir.resolve(),
        argon2_time_cost=1,
        argon2_memory_cost=8,
        argon2_parallelism=1,
    )
    app = create_app(settings)

    with _make_client(app) as client:
        # GET /
        resp_root = client.get("/")
        assert resp_root.status_code == 200
        assert "text/html" in resp_root.headers.get("content-type", "")
        assert resp_root.headers.get("Cache-Control") == "no-cache"
        assert "<div id='root'>Mock SPA</div>" in resp_root.text

        # GET /reception/patients with HTML accept
        resp_spa = client.get("/reception/patients", headers={"Accept": "text/html"})
        assert resp_spa.status_code == 200
        assert "text/html" in resp_spa.headers.get("content-type", "")
        assert resp_spa.headers.get("Cache-Control") == "no-cache"
        assert "<div id='root'>Mock SPA</div>" in resp_spa.text


def test_spa_route_with_json_accept_returns_404_json(
    test_settings: Settings,
    mock_spa_dist: tuple[Path, Path],
) -> None:
    """SPA route with Accept: application/json returns 404 JSON, preserving API contract."""
    dist_dir, _ = mock_spa_dist
    settings = Settings(
        env="test",
        db_name=test_settings.db_name,
        frontend_dist=dist_dir.resolve(),
        argon2_time_cost=1,
        argon2_memory_cost=8,
        argon2_parallelism=1,
    )
    app = create_app(settings)

    with _make_client(app) as client:
        resp = client.get("/reception/patients", headers={"Accept": "application/json"})
        assert resp.status_code == 404
        assert "application/json" in resp.headers.get("content-type", "")
        assert resp.json().get("code") == "not_found" or resp.json().get("detail") == "Not Found"


def test_api_unknown_route_returns_404_and_no_store(
    test_settings: Settings,
    mock_spa_dist: tuple[Path, Path],
) -> None:
    """Unknown /api paths preserve error envelope and Cache-Control: no-store."""
    dist_dir, _ = mock_spa_dist
    settings = Settings(
        env="test",
        db_name=test_settings.db_name,
        frontend_dist=dist_dir.resolve(),
        argon2_time_cost=1,
        argon2_memory_cost=8,
        argon2_parallelism=1,
    )
    app = create_app(settings)

    with _make_client(app) as client:
        resp = client.get("/api/nonexistent/endpoint")
        assert resp.status_code == 404
        assert resp.headers.get("Cache-Control") == "no-store"
        assert resp.json()["code"] == "not_found"


def test_assets_caching_and_missing_assets(
    test_settings: Settings,
    mock_spa_dist: tuple[Path, Path],
) -> None:
    """Asset files return immutable cache headers; missing assets return 404."""
    dist_dir, _ = mock_spa_dist
    settings = Settings(
        env="test",
        db_name=test_settings.db_name,
        frontend_dist=dist_dir.resolve(),
        argon2_time_cost=1,
        argon2_memory_cost=8,
        argon2_parallelism=1,
    )
    app = create_app(settings)

    with _make_client(app) as client:
        # Existing asset
        resp_asset = client.get("/assets/app-abc123.js")
        assert resp_asset.status_code == 200
        assert resp_asset.headers.get("Cache-Control") == "public, max-age=31536000, immutable"
        assert "console.log" in resp_asset.text

        # Missing asset
        resp_missing = client.get("/assets/missing-asset.js")
        assert resp_missing.status_code == 404
        assert resp_missing.headers.get("Cache-Control") != "public, max-age=31536000, immutable"


def test_head_requests_work(
    test_settings: Settings,
    mock_spa_dist: tuple[Path, Path],
) -> None:
    """HEAD / and HEAD /assets/... return 200 with matching headers and empty body."""
    dist_dir, _ = mock_spa_dist
    settings = Settings(
        env="test",
        db_name=test_settings.db_name,
        frontend_dist=dist_dir.resolve(),
        argon2_time_cost=1,
        argon2_memory_cost=8,
        argon2_parallelism=1,
    )
    app = create_app(settings)

    with _make_client(app) as client:
        # HEAD /
        head_root = client.head("/")
        assert head_root.status_code == 200
        assert head_root.headers.get("Cache-Control") == "no-cache"
        assert head_root.text == ""

        # HEAD /assets/app-abc123.js
        head_asset = client.head("/assets/app-abc123.js")
        assert head_asset.status_code == 200
        assert head_asset.headers.get("Cache-Control") == "public, max-age=31536000, immutable"
        assert head_asset.text == ""


def test_path_traversal_probes_never_leak_external_files(
    test_settings: Settings,
    mock_spa_dist: tuple[Path, Path],
) -> None:
    """Raw-ASGI traversal probes never return files outside the dist directory."""
    dist_dir, secret_file = mock_spa_dist
    assert secret_file.exists()

    settings = Settings(
        env="test",
        db_name=test_settings.db_name,
        frontend_dist=dist_dir.resolve(),
        argon2_time_cost=1,
        argon2_memory_cost=8,
        argon2_parallelism=1,
    )
    app = create_app(settings)

    probes = [
        "/../secret.txt",
        "/assets/../../secret.txt",
        "/%2e%2e/secret.txt",
        "/%2e%2e%2fsecret.txt",
        "/..%2fsecret.txt",
        "/..\\secret.txt",
        "/assets/..\\..\\secret.txt",
        "/assets/%2e%2e%2f%2e%2e%2fsecret.txt",
        "/assets/%2e%2e%5c%2e%2e%5csecret.txt",
    ]

    with _make_client(app) as client:
        for probe in probes:
            resp = client.get(probe)
            assert SECRET_CONTENT not in resp.text, (
                f"CRITICAL LEAK: Probe '{probe}' exposed secret file content!"
            )


def test_settings_rejects_relative_frontend_dist() -> None:
    """Settings must reject relative frontend_dist paths to prevent serving legacy dist folders."""
    with pytest.raises(ValidationError, match="frontend_dist must be an absolute path"):
        Settings(
            frontend_dist=Path("relative/dist"),
            db_app_password="test",
            db_owner_password="test",
        )


def test_missing_dist_starts_in_api_only_mode(
    test_settings: Settings,
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """If frontend_dist is None or missing index.html, app logs warning and serves API only."""
    empty_dist = tmp_path / "empty_dist"
    empty_dist.mkdir()

    settings = Settings(
        env="test",
        db_name=test_settings.db_name,
        frontend_dist=empty_dist.resolve(),
        argon2_time_cost=1,
        argon2_memory_cost=8,
        argon2_parallelism=1,
    )

    with caplog.at_level("WARNING"):
        app = create_app(settings)

    assert "Frontend dist not found or missing index.html" in caplog.text

    with _make_client(app) as client:
        # API works
        api_resp = client.get("/api/health")
        assert api_resp.status_code == 200
        assert api_resp.json()["status"] == "ok"

        # Non-API route returns 404 since no frontend is mounted
        root_resp = client.get("/")
        assert root_resp.status_code == 404


# =============================================================================
# Task 2: Real Production Bundle Verification (marked needs_build)
# =============================================================================


@pytest.mark.needs_build
def test_real_build_served(test_settings: Settings) -> None:
    """Serve real frontend/dist build and verify no external host references exist."""
    dist_env = os.environ.get("KALYAN_FRONTEND_DIST")
    if not dist_env:
        pytest.skip("KALYAN_FRONTEND_DIST environment variable not set")

    dist_path = Path(dist_env).resolve()
    assert (dist_path / "index.html").is_file(), f"Real index.html not found in {dist_path}"

    settings = Settings(
        env="test",
        db_name=test_settings.db_name,
        frontend_dist=dist_path,
        argon2_time_cost=1,
        argon2_memory_cost=8,
        argon2_parallelism=1,
    )
    app = create_app(settings)

    with _make_client(app) as client:
        resp = client.get("/")
        assert resp.status_code == 200
        assert "text/html" in resp.headers.get("content-type", "")
        assert resp.headers.get("Cache-Control") == "no-cache"
        assert '<div id="root">' in resp.text

    # Audit all files in dist for external URLs (zero external CDN or remote resources)
    # Permitted: XML namespaces (w3.org), library licenses and doc strings (react, tailwind, etc.)
    url_pattern = re.compile(r'https?://[^\s\'"<>]+')
    allowed_domains = {
        "www.w3.org",
        "tailwindcss.com",
        "react.dev",
        "reactrouter.com",
        "github.com",
        "localhost",
    }

    violating_urls: list[str] = []
    for file_path in dist_path.rglob("*"):
        if file_path.is_file() and file_path.suffix in {".html", ".js", ".css"}:
            content = file_path.read_text(encoding="utf-8", errors="ignore")
            for match in url_pattern.finditer(content):
                url = match.group(0)
                domain_match = re.search(r"https?://([a-zA-Z0-9.-]+)", url)
                if domain_match:
                    domain = domain_match.group(1).lower().rstrip(".")
                    if domain not in allowed_domains:
                        violating_urls.append(f"{file_path.name}: {url}")

    assert not violating_urls, (
        f"External host references found in production frontend bundle: {violating_urls}"
    )
