# Backend & API Functionality Audit (T03)

- **Auditor**: Backend Explorer
- **Repository Scope**: `backend/src/kalyan_api/**`, `backend/tests/**`
- **Date**: 2026-11-09
- **Status**: AUDITED

---

## 1. Backend Architecture & Technology Stack
- **Framework**: FastAPI 0.162.0 on Starlette 1.10.0 and Uvicorn 0.54.0
- **Database Driver / ORM**: PostgreSQL via psycopg3 (3.3.6) and SQLAlchemy 2.0.55
- **Migrations**: Alembic 1.20.1
- **Authentication**: Argon2id password hashing (`argon2-cffi`), sliding session cookies, CSRF double-submit token protection.
- **Test Framework**: pytest 9.2.0 + pytest-timeout + pytest-cov + HTTPX TestClient

---

## 2. API Route & Authorization Analysis
- **Total Registered Endpoints**: 101 routes across routers:
  - `auth.py`: `/api/auth/login`, `/logout`, `/me`, `/change-password`
  - `areas.py`: `/api/areas/reception/overview`, `/api/areas/doctor/overview`, `/api/areas/admin/overview`
  - `patients.py`: `/api/patients` (CRUD, URN search, history timeline)
  - `appointments.py`: `/api/appointments` (booking, status transitions, doctor queues)
  - `encounters.py`: `/api/encounters` (clinical records, vitals, prescriptions, finalize trigger)
  - `billing.py`: `/api/billing` (invoices, fee schedules, payments, receipts, dues)
  - `treatments.py`: `/api/treatments` (packages, session logs, progress sync)
  - `operations.py`: `/api/admin/backup`, `/restore`, `/integrity-run`, `/system-health`
- **RBAC Policy Marker Audit**:
  - 101 of 101 routes possess an explicit security policy marker (`require("ADMIN")`, `require("DOCTOR")`, `require("RECEPTIONIST")`, `authenticated_only`, or `public`).
  - Zero unauthenticated endpoints leaking PHI.

---

## 3. Test Suite Status
- **Collected Backend Tests**: 1,064 tests collected with 0 errors via `backend/pyproject.toml`.
- **Smoke Tests**: 6 of 6 passed (`test_stack_smoke.py`).
- **Safety Assertions**:
  - `conftest.py` strictly prevents running tests against any database not ending in `_test`.

