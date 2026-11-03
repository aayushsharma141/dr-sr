# Kalyan Hospital Management System — Claude Code Project Profile

## Project Overview
- **Name:** Kalyan Hospital Patient & Physiotherapy Management System (v3.0 LAN Platform)
- **Domain:** On-premises, internet-independent clinical and hospital management system (HMS/EMR) serving receptionists, doctors, and clinic administrators across 3–5 LAN workstations.
- **Repository Root:** `d:\dr-sr`

---

## Architectural Stack
- **Backend:** Python 3.12, FastAPI 0.162.0, SQLAlchemy 2.0.55 (synchronous session pattern), PostgreSQL 18.6, Alembic migrations, Pytest, Argon2id authentication, Pydantic v2 validation.
- **Frontend:** Vite 8.3.5, React 19.3.1, TypeScript 5.x, Tailwind CSS, Lucide icons, Vitest + React Testing Library.
- **Desktop / Legacy Tools:** Python 3, PySide6 (Qt6), SQLite, ReportLab PDF generator (retained for migration reference and offline single-station tools).
- **Deployment:** Windows Server on LAN (zero Node.js on server PC; static SPA served by FastAPI), Windows Scheduled Tasks watchdog/auto-recovery (`deploy/`), dual thermal (80mm) and A4/A5 medical document printing.

---

## Development & Test Commands

### Backend (`/backend`)
```bash
# Activate virtual environment
.\backend\.venv\Scripts\Activate.ps1

# Run full backend test suite (unit + acceptance)
pytest backend/tests -v

# Run single test module
pytest backend/tests/test_phase17_acceptance.py -v

# Lint and format checks
ruff check backend/src
ruff format --check backend/src

# Run database migrations
cd backend; alembic upgrade head
```

### Frontend (`/frontend`)
```bash
# Run unit and component tests
cd frontend; npm test

# Production build (outputs to frontend/dist, served by FastAPI in production)
cd frontend; npm run build

# Type check
cd frontend; npx tsc --noEmit

# Lint
cd frontend; npm run lint
```

### Server & Acceptance
```bash
# Launch server locally
.\deploy\start-server.bat

# Stop server
.\deploy\stop-server.bat
```

---

## Core Domain & System Invariants

1. **Unique Gap-Free URNs (`PAT-01`):** Format `KH-YYYY-XXXX` generated atomically with database-level concurrency locking. Rolled-back transactions do not produce unmapped gaps.
2. **Clinical Immutability (`CLN-02`, `TRT-03`):** Finalized clinical encounter notes and physiotherapy session records are immutable. Corrections and updates MUST be added as chronological addenda with PostgreSQL tamper-prevention database triggers.
3. **Financial Math & Ledger (`BIL-02`):** All monetary values are handled as integer paise (never floating point). Negative payments and overpayments are rejected at the database schema level. Dues are computed dynamically from the ledger.
4. **Bilingual Printing & Localization:** Real-time dual-language support: English clinical nomenclature paired with Hindi Devanagari labels and print layouts.
5. **Doctor Silo & Privacy Isolation (`D-03`, `D-04`):** Doctors only access their assigned consultation queue and authorized encounters; cross-doctor access is restricted by server-side permission checks.
6. **Strict RBAC:** 339-cell permission matrix across Admin, Reception, and Doctor roles enforced strictly server-side on every API endpoint. UI element hiding is purely ergonomic, never security.

---

## ECC & GSD Workflow Integration
- **ECC Plugin:** Installed at project scope (`ecc@ecc`). Use specialized ECC review and diagnostic agents (`python-reviewer`, `fastapi-reviewer`, `react-reviewer`, `typescript-reviewer`, `database-reviewer`, `security-reviewer`).
- **GSD Core:** Driven by `/gsd-*` commands. Maintain state truth in `.planning/` (`STATE.md`, `ROADMAP.md`, `REQUIREMENTS.md`).
- **Code Standards:** 
  - Explicit type annotations everywhere (strict TypeScript & Pyright).
  - No silent error swallowing (`try...except: pass` is prohibited).
  - Strict atomic database transactions with rollback on failure.

