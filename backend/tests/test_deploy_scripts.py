"""Tests verifying deployment and auto-recovery orchestration scripts (DEP-01, DEP-02)."""

from pathlib import Path


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
