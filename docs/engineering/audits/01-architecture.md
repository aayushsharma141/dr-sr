# Architecture & Repository Audit (T01)

- **Auditor**: Architecture Explorer
- **Repository Scope**: Whole Repository, Directory Layout, Startup, Packaging, Packaging Scripts
- **Date**: 2026-11-09
- **Status**: AUDITED

---

## 1. Executive Architecture Summary
- **Organization**: श्री वशिष्ठ कल्याण ट्रस्ट
- **Facility**: Kalyan Hospital (Ara, Bhojpur, Bihar)
- **Deployment Topology**: Offline LAN local server hosting PostgreSQL 16+ and FastAPI backend, serving a React/TypeScript SPA to client workstations over Ethernet LAN.
- **Repository Layout**:
  - `backend/`: FastAPI application (`kalyan_api`), SQLAlchemy ORM, Alembic migrations, psycopg3 driver.
  - `frontend/`: React 18, Vite, TypeScript, TailwindCSS, Lucide icons, Vitest.
  - `deploy/`: Windows deployment scripts, scheduled tasks, firewall scripts.
  - `legacy/`: Historical PySide6 desktop client (retained for reference / data extraction, not part of v3 production runtime).
  - `.planning/`: Phase tracking artifacts (Phases 01 through 20).

---

## 2. Startup & Execution Contracts
- **Backend Startup**:
  - Command: `python -m uvicorn kalyan_api.main:app --host 0.0.0.0 --port 8000`
  - Python Environment: Python 3.12 (`backend/.venv/Scripts/python.exe`)
  - Entrypoint: `backend/src/kalyan_api/main.py:create_app()`
- **Frontend Development Server**:
  - Command: `npm.cmd run dev` (Vite on port 5173 with proxy to backend `/api`)
- **Frontend Build & SPA Hosting**:
  - Command: `npm.cmd run build` (outputs to `frontend/dist/`)
  - Production Hosting: FastAPI mounts `frontend/dist` via `StaticFiles` when `KALYAN_FRONTEND_DIST` is configured.

---

## 3. Findings & Architectural Risks
1. **[ARCH-01] Legacy PySide6 Directory Scanning**:
   - Running pytest from workspace root triggers collection in `legacy/tests/`, which fails due to missing PySide6.
   - Root Cause: Missing pytest root configuration in workspace root.
   - Fix: Direct pytest strictly to `backend/pyproject.toml` or add root `pytest.ini` ignoring `legacy/`.
2. **[ARCH-02] Admin SSOT Refactoring In-Flight**:
   - Branch `refactor/admin-modules-ssot` has uncommitted changes migrating admin navigation and management overview.
   - Deletion of `ManagementOverviewDashboard.tsx` broke tests expecting it before routing consolidated to `AdminDashboard.tsx`.
3. **[ARCH-03] Offline Asset Self-Sufficiency**:
   - All fonts, icons, and crest images are hosted locally under `frontend/public/` (zero CDN / external web dependencies verified).

