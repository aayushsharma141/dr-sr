# Kalyan Hospital Management System — Environment Variable Contracts & Configuration Specification

**Document Version:** 1.0.0  
**Audit Date:** 2026-11-06  
**Auditor Roles:** Senior DevOps Engineer, Backend Architect, Security Auditor  
**Repository Scope:** `dr-sr` (Backend API, Frontend SPA, Desktop Runtime, Deployment Automation, CI/CD)  
**Classification:** Internal Technical Standard & Security Baseline  

---

## 1. Executive Summary & Architecture Overview

The **Kalyan Hospital Management System** operates as a zero-cloud, offline-first hospital management platform deployed on a local area network (LAN) inside the clinic facility. Architectural decisions dictate that the system operates strictly within local premises without mandatory external internet connectivity.

### 1.1 Architectural Context
- **Backend Architecture:** A centralized FastAPI (Python 3.12) REST service (`kalyan_api`) serving clinical, billing, audit, and administrative APIs over HTTP.
- **Database Architecture:** Dedicated PostgreSQL (v17/v18) instance bound to `127.0.0.1` on the clinic server machine. Employs a strict dual-role security architecture:
  - `kalyan_app`: Runtime DML-only user (no table creation, alteration, or dropping permissions).
  - `kalyan_owner`: Schema owner role used strictly for Alembic database migrations and PostgreSQL native dump/restore utilities (`pg_dump`, `psql`).
- **Frontend Architecture:** Single Page Application (React 19 + TypeScript + Vite + Tailwind CSS). Served statically by FastAPI in production environments via Starlette static file hosting (`app.frontend`), eliminating the need for a separate reverse proxy or Node.js production server.
- **Legacy Desktop Client:** Standalone PySide6 (Qt 6) application (`app/`), operating in maintenance mode with local SQLite database fallback and direct thermal printing capabilities.

### 1.2 Configuration Philosophy
Configuration follows the **12-Factor App** methodology adapted for hardened, on-premise clinical desktop environments:
1. All backend configuration parameters utilize an explicit prefix: `KALYAN_`.
2. Parsing and type coercion are governed strictly by Pydantic `BaseSettings` (`pydantic-settings`).
3. Sensitive credentials (passwords, encryption paths, audit stores) reside solely in environment files or process environments and are never hardcoded or checked into version control.
4. The system validates configuration eagerly at process startup; invalid or placeholder values abort execution immediately before socket binding.

---

## 2. Configuration Loading Flow & Precedence

Backend configuration resolution is implemented in [`backend/src/kalyan_api/config.py`](file:///d:/dr-sr/backend/src/kalyan_api/config.py#L73-L78). The loading precedence order (from highest to lowest priority) is:

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Operating System Environment Variables (Highest)         │
│    (Injected via shell, systemd, Windows service, or CI)    │
├─────────────────────────────────────────────────────────────┤
│ 2. Dotenv File: backend/.env                                │
│    (Loaded by pydantic-settings via SettingsConfigDict)      │
├─────────────────────────────────────────────────────────────┤
│ 3. In-Code Python Defaults in Settings class                │
│    (Defined in backend/src/kalyan_api/config.py) (Lowest)   │
└─────────────────────────────────────────────────────────────┘
```

### 2.1 Resolution Rules
- **Dotenv Path:** Evaluated dynamically as `BACKEND_DIR / ".env"`. If `backend/.env` exists on disk, it is ingested using UTF-8 encoding. If absent, the application relies on OS environment variables or code defaults without throwing a file-not-found error.
- **Prefix Isolation:** All settings attributes are mapped to environment variables prefixed with `KALYAN_` (case-insensitive in Pydantic, uppercase standard in practice).
- **Extra Variables:** Configured with `extra="ignore"`, preventing unknown environment variables from crashing the server while logging no extraneous values.
- **Caching Mechanism:** `get_settings()` utilizes `@lru_cache(maxsize=1)`. The configuration object is immutable during the process lifecycle unless explicitly invalidated in testing via `get_settings.cache_clear()`.

---

## 3. Master Environment Variable Registry

The following table provides the complete registry of every environment variable recognized across all components of the repository.

| Variable Name | Component | Scope / Visibility | Data Type | Code Default | Example / Template Default | Criticality |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `KALYAN_ENV` | Backend | Private (Server) | `Literal["development", "test", "production"]` | `"development"` | `"development"` / `"production"` | Operational |
| `KALYAN_DB_HOST` | Backend | Private (Server) | `str` | `"127.0.0.1"` | `"127.0.0.1"` | High |
| `KALYAN_DB_PORT` | Backend | Private (Server) | `int` | `5432` | `5432` | High |
| `KALYAN_DB_NAME` | Backend | Private (Server) | `str` | `"kalyan_dev"` | `"kalyan_dev"` / `"kalyan_prod"` | High |
| `KALYAN_DB_APP_USER` | Backend | Private (Server) | `str` | `"kalyan_app"` | `"kalyan_app"` | High |
| `KALYAN_DB_APP_PASSWORD` | Backend | Private (Server) | `str` | `""` (Empty) | `"CHANGE_ME"` | **CRITICAL** |
| `KALYAN_DB_OWNER_USER` | Backend | Private (Server) | `str` | `"kalyan_owner"` | `"kalyan_owner"` | High |
| `KALYAN_DB_OWNER_PASSWORD` | Backend | Private (Server) | `str` | `""` (Empty) | `"CHANGE_ME"` | **CRITICAL** |
| `KALYAN_COOKIE_NAME` | Backend | Private (Server) | `str` | `"kalyan_session"` | `"kalyan_session"` | Medium |
| `KALYAN_COOKIE_SECURE` | Backend | Private (Server) | `bool` | `False` | `false` | Security |
| `KALYAN_SESSION_IDLE_MINUTES` | Backend | Private (Server) | `int` | `30` | `30` | Security |
| `KALYAN_SESSION_ABSOLUTE_HOURS` | Backend | Private (Server) | `int` | `12` | `12` | Security |
| `KALYAN_TOUCH_THROTTLE_SECONDS` | Backend | Private (Server) | `int` | `60` | *None (Undocumented)* | Performance |
| `KALYAN_LOCKOUT_THRESHOLD` | Backend | Private (Server) | `int` | `5` | *None (Undocumented)* | Security |
| `KALYAN_LOCKOUT_MINUTES` | Backend | Private (Server) | `int` | `15` | *None (Undocumented)* | Security |
| `KALYAN_THROTTLE_MAX_FAILURES` | Backend | Private (Server) | `int` | `20` | *None (Undocumented)* | Security |
| `KALYAN_THROTTLE_WINDOW_MINUTES` | Backend | Private (Server) | `int` | `15` | *None (Undocumented)* | Security |
| `KALYAN_PASSWORD_MIN_LENGTH` | Backend | Private (Server) | `int` | `10` | *None (Undocumented)* | Security |
| `KALYAN_PASSWORD_MAX_LENGTH` | Backend | Private (Server) | `int` | `128` | *None (Undocumented)* | Security |
| `KALYAN_TEMP_PASSWORD_LENGTH` | Backend | Private (Server) | `int` | `12` | *None (Undocumented)* | Security |
| `KALYAN_ARGON2_TIME_COST` | Backend | Private (Server) | `int` | `3` | *None (Undocumented)* | Performance |
| `KALYAN_ARGON2_MEMORY_COST` | Backend | Private (Server) | `int` | `65536` | *None (Undocumented)* | Performance |
| `KALYAN_ARGON2_PARALLELISM` | Backend | Private (Server) | `int` | `4` | *None (Undocumented)* | Performance |
| `KALYAN_EXTRA_ALLOWED_ORIGINS` | Backend | Private (Server) | `list[str]` | `[]` | `["http://localhost:5173"]` | Security |
| `KALYAN_FRONTEND_DIST` | Backend | Private (Server) | `Path \| None` | `None` | `""` / `"D:/dr-sr/frontend/dist"` | Operational |
| `KALYAN_SETUP_CODE_PATH` | Backend | Private (Server) | `Path \| None` | `None` | *None (Undocumented)* | Security |
| `KALYAN_PHOTOS_DIR` | Backend | Private (Server) | `Path` | `backend/var/photos` | `"D:/dr-sr/backend/var/photos"` | Storage |
| `KALYAN_BACKUP_DIR` | Backend | Private (Server) | `Path` | `backend/var/backups` | `"D:/dr-sr/backend/var/backups"` | Storage |
| `KALYAN_BACKUP_DESTINATIONS` | Backend | Private (Server) | `list[Path]` | `[]` | *None (Undocumented)* | Storage |
| `KALYAN_TEST_DB_NAME` | Backend Test | Test Suite Only | `str` | `"kalyan_test"` | *None* | Test |
| `PGPASSWORD` | Postgres CLI | Process Subprocess | `str` | Injected dynamically | *None* | **CRITICAL** |
| `PGOPTIONS` | Postgres CLI | Process Subprocess | `str` | Injected dynamically | *None* | Operational |
| `POSTGRES_PASSWORD` | CI Service | CI Container | `str` | *None* | `"postgres"` | CI |
| `QT_QPA_PLATFORM` | Desktop / Pytest | Test Runtime | `str` | `"offscreen"` (conftest) | `"offscreen"` | Test |
| `EDGE_PATH` | Frontend Test | Test Runtime | `str` | Autodetected | *None* | Test |
| `REQUIRE_PRINT_CHECK` | Frontend Test | Test Runtime | `str` ("1") | *None* | *None* | Test |
| `PRINT_CHECK` | Frontend Test | Test Runtime | `str` ("1") | *None* | *None* | Test |

---

## 4. Required Environment Variables

The application enforces strict startup validation. While default fallback strings exist in code for developer convenience, the following variables are **strictly mandatory in operational environments**:

### 4.1 `KALYAN_DB_APP_PASSWORD`
- **Purpose:** Password for the low-privilege `kalyan_app` user executing everyday transactional clinical queries.
- **Required In:** Staging, Production, and local developer runs targeting PostgreSQL.
- **Code Enforcement:** Validated by `@field_validator("db_app_password")`. If value equals `"CHANGE_ME"`, Pydantic throws a `ValueError`. If left empty (`""`), PostgreSQL rejects authentication during pre-flight database readiness checks.
- **Failure Impact:** Server fails to boot; CLI commands exit with code 1.

### 4.2 `KALYAN_DB_OWNER_PASSWORD`
- **Purpose:** Password for the high-privilege `kalyan_owner` user executing Alembic schema migrations and binary database backups.
- **Required In:** Staging, Production, and any environment executing `cli.py migrate`, automated backups, or restore drills.
- **Code Enforcement:** Validated by `@field_validator("db_owner_password")`. Throws `ValueError` on `"CHANGE_ME"`.
- **Failure Impact:** Migrations cannot execute; backup generation fails with exit code 1.

### 4.3 `KALYAN_FRONTEND_DIST` (Production Mandatory)
- **Purpose:** Absolute filesystem directory containing compiled production frontend assets (`index.html`, `assets/*`).
- **Required In:** Production standalone deployments where FastAPI acts as the primary web server on port 8000.
- **Code Enforcement:** Validated by `@field_validator("frontend_dist")`. Must be an absolute path if provided.
- **Failure Impact:** If unset or invalid, FastAPI starts in API-only mode (`app.frontend` is bypassed) and returns 404 for all SPA navigation routes.

---

## 5. Optional Environment Variables & Tuning Knobs

All variables below default safely in code when omitted from `.env`.

### 5.1 Identity & Session Parameters
- **`KALYAN_COOKIE_NAME`** (Default: `"kalyan_session"`): Name of the HTTP session cookie. Customizing allows parallel testing of multiple instances on the same host domain.
- **`KALYAN_COOKIE_SECURE`** (Default: `False`): Sets `Secure` cookie directive. Under Decision D-01, plain HTTP on isolated LAN sets this to `false`. When deployed behind TLS termination, must be toggled to `true`.
- **`KALYAN_SESSION_IDLE_MINUTES`** (Default: `30`): Sliding session inactivity expiration window.
- **`KALYAN_SESSION_ABSOLUTE_HOURS`** (Default: `12`): Hard ceiling on continuous session duration regardless of ongoing activity.
- **`KALYAN_TOUCH_THROTTLE_SECONDS`** (Default: `60`): Debounce period before touching database session timestamp on user activity, preventing DB write-lock contention.

### 5.2 Security & Brute-Force Throttling
- **`KALYAN_LOCKOUT_THRESHOLD`** (Default: `5`): Maximum consecutive failed password attempts permitted before locking an account.
- **`KALYAN_LOCKOUT_MINUTES`** (Default: `15`): Duration of temporary account suspension upon lockout.
- **`KALYAN_THROTTLE_MAX_FAILURES`** (Default: `20`): IP-level rate-limiting failure threshold within the evaluation window.
- **`KALYAN_THROTTLE_WINDOW_MINUTES`** (Default: `15`): Sliding window duration for IP-level failure evaluation.

### 5.3 Cryptography & Password Policy
- **`KALYAN_PASSWORD_MIN_LENGTH`** (Default: `10`): Minimum password length (enforced >= 8 by Pydantic model validator).
- **`KALYAN_PASSWORD_MAX_LENGTH`** (Default: `128`): Maximum password length (enforced <= 1024 by Pydantic model validator).
- **`KALYAN_TEMP_PASSWORD_LENGTH`** (Default: `12`): Generated temporary password length for administrative resets.
- **`KALYAN_ARGON2_TIME_COST`** (Default: `3`): Argon2id iteration passes (NIST recommendation: 2–3).
- **`KALYAN_ARGON2_MEMORY_COST`** (Default: `65536`): Argon2id memory footprint (64 MiB).
- **`KALYAN_ARGON2_PARALLELISM`** (Default: `4`): Argon2id thread count.

### 5.4 Cross-Origin & LAN Access
- **`KALYAN_EXTRA_ALLOWED_ORIGINS`** (Default: `[]`): Comma-separated list or JSON array of allowed origins for CSRF origin verification on state-modifying requests (e.g. `http://localhost:5173`, `http://192.168.1.100:8000`).

### 5.5 Storage Paths & Backup Allowlist
- **`KALYAN_SETUP_CODE_PATH`** (Default: `None`): Explicit file path for the first-run administrator wizard setup code. If `None`, defaults to `backend/var/setup-code.txt`.
- **`KALYAN_PHOTOS_DIR`** (Default: `backend/var/photos`): Directory for stored patient portraits.
- **`KALYAN_BACKUP_DIR`** (Default: `backend/var/backups`): Directory for local `.tar.gz` database and photo backup archives.
- **`KALYAN_BACKUP_DESTINATIONS`** (Default: `[]`): Approved external storage drives (e.g., secondary USB hard drives) permitted as manual backup targets.

---

## 6. Backend / Private Environment Variables

Every variable prefixed with `KALYAN_` is strictly private to the server process.

```
   ┌──────────────────────────────────────────────┐
   │             Server Operating System          │
   │                                              │
   │   KALYAN_DB_APP_PASSWORD ────────┐           │
   │   KALYAN_DB_OWNER_PASSWORD ──────┼──────────┐│
   │   KALYAN_BACKUP_DIR ─────────────┤          ││
   │                                  ▼          ▼│
   │                      ┌──────────────────────┐│
   │                      │ kalyan_api (FastAPI) ││
   │                      └──────────┬───────────┘│
   │                                 │            │
   │                   HTTP API Only │ (No Secrets│
   │                   (Safe JSON)   │  Leaked)   │
   │                                 ▼            │
   └─────────────────────────────────┼────────────┘
                                     │
                                     ▼
                       ┌──────────────────────────┐
                       │ Frontend Single Page App │
                       │    (Client Workstation)  │
                       └──────────────────────────┘
```

- **Boundary Enforcement:** Backend configuration variables are never serialized in API responses, injected into HTML templates, or exposed via public debugging endpoints.
- **Introspection Safety:** The `/api/system/health` and `/api/system/status` endpoints report volume metrics and sanitized paths (`path_label`) but omit sensitive database passwords and internal credential structures.

---

## 7. Frontend / Public Environment Variables

The React Single Page Application (`frontend/`) contains **zero public build-time or runtime environment variables**:
- **API URL Discovery:** The frontend makes relative network requests to `/api/*`. In production, because FastAPI hosts the compiled assets, requests resolve to the same origin without CORS or configuration. In development, Vite's internal development server proxies `/api` to `http://127.0.0.1:8000` via [`frontend/vite.config.ts`](file:///d:/dr-sr/frontend/vite.config.ts#L8-L13).
- **Absence of `VITE_*` Variables:** Repository inspection confirms zero `VITE_*` environment variables in `frontend/src/` or `frontend/vite.config.ts`. The frontend build is completely deterministic and environment-agnostic.

---

## 8. Development Environment Contract

For local development without production LAN services, configure `backend/.env` based on `backend/.env.example`:

```ini
# --- Development Environment Baseline ---
KALYAN_ENV=development
KALYAN_DB_HOST=127.0.0.1
KALYAN_DB_PORT=5432
KALYAN_DB_NAME=kalyan_dev
KALYAN_DB_APP_USER=kalyan_app
KALYAN_DB_APP_PASSWORD=<local_app_password>
KALYAN_DB_OWNER_USER=kalyan_owner
KALYAN_DB_OWNER_PASSWORD=<local_owner_password>

# Session & Cookies
KALYAN_COOKIE_NAME=kalyan_session
KALYAN_COOKIE_SECURE=false
KALYAN_SESSION_IDLE_MINUTES=30
KALYAN_SESSION_ABSOLUTE_HOURS=12

# Cross-Origin: Allow Vite dev server
KALYAN_EXTRA_ALLOWED_ORIGINS=http://localhost:5173

# Frontend distribution left blank during development
KALYAN_FRONTEND_DIST=
```

---

## 9. Testing & CI/CD Environment Contract

### 9.1 Backend Pytest Suite (`backend/tests/`)
The test harness configures an isolated environment in [`backend/tests/conftest.py`](file:///d:/dr-sr/backend/tests/conftest.py#L23-L54):
- **Database Safety Guard:** The test database name is resolved via `KALYAN_TEST_DB_NAME` (default: `"kalyan_test"`). If the name does not end with `_test`, pytest immediately halts execution with `pytest.exit(returncode=2)` to prevent accidental truncation of live clinic databases.
- **Argon2 Test Acceleration:** Settings are instantiated with minimal cryptographic cost parameters (`argon2_time_cost=1`, `argon2_memory_cost=8`, `argon2_parallelism=1`) to maintain fast test execution.
- **Fixture Environment Injection:** The session-scoped fixture sets:
  ```python
  os.environ["KALYAN_DB_NAME"] = test_settings.db_name
  os.environ["KALYAN_ENV"] = "test"
  ```

### 9.2 GitHub Actions Workflow (`.github/workflows/tests.yml`)
The automated CI pipeline runs three parallel test matrix jobs:

1. **`pytest` (Desktop & Legacy Unit Tests):**
   - Environment: `QT_QPA_PLATFORM: offscreen` (forces Qt offscreen plugin on headless Ubuntu).
2. **`backend` (FastAPI + PostgreSQL Test Suite):**
   - Service Container: `postgres:18` configured with `POSTGRES_PASSWORD: postgres`.
   - Injected Job Environment:
     - `KALYAN_DB_HOST: 127.0.0.1`
     - `KALYAN_DB_PORT: "5432"`
     - `KALYAN_DB_NAME: kalyan_test`
     - `KALYAN_DB_OWNER_USER: kalyan_owner`
     - `KALYAN_DB_OWNER_PASSWORD: ciownerpassword`
     - `KALYAN_DB_APP_USER: kalyan_app`
     - `KALYAN_DB_APP_PASSWORD: ciapppassword`
     - `KALYAN_EXTRA_ALLOWED_ORIGINS: http://localhost:5173`
   - Step Environment (Pytest Run):
     - `KALYAN_PHOTOS_DIR: ${{ runner.temp }}/kalyan/photos`
     - `KALYAN_BACKUP_DIR: ${{ runner.temp }}/kalyan/backups`
3. **`frontend` (Vitest & Oxlint):**
   - Runs `npm ci`, `npm run test`, `npm run typecheck`, `npm run lint`, and `npm run build`.

### 9.3 Frontend Print Check Test Suite
- **`EDGE_PATH`**: Allows override of Edge/Chrome browser executable.
- **`PRINT_CHECK=1`**: Opt-in flag required to run browser-rendered PDF layout tests (`frontend/src/print-check/print-check.test.tsx`).
- **`REQUIRE_PRINT_CHECK=1`**: Strictly fails the test run if no compatible Chromium browser binary is detected.

---

## 10. Staging Environment Contract

Staging environments mirror production LAN topology while targeting a separate test database:
- `KALYAN_ENV=production` (Enforces production password restrictions and durability checks).
- `KALYAN_DB_NAME=kalyan_stage`
- `KALYAN_DB_APP_PASSWORD` and `KALYAN_DB_OWNER_PASSWORD` must be unique and distinct from production.
- `KALYAN_FRONTEND_DIST` points to the pre-release build directory to test SPA routing.

---

## 11. Production Environment Contract

The production deployment runs on the dedicated clinic server PC using the template at [`deploy/.env.production.template`](file:///d:/dr-sr/deploy/.env.production.template):

```ini
# Kalyan Hospital Management System - Production Environment Configuration
# Target Path: backend/.env

# Runtime Environment
KALYAN_ENV=production

# Database Connection (PostgreSQL 18 on Server PC)
KALYAN_DB_HOST=127.0.0.1
KALYAN_DB_PORT=5432
KALYAN_DB_NAME=kalyan_prod
KALYAN_DB_APP_USER=kalyan_app
KALYAN_DB_APP_PASSWORD=<STRONG_RANDOM_APP_PASSWORD>
KALYAN_DB_OWNER_USER=kalyan_owner
KALYAN_DB_OWNER_PASSWORD=<STRONG_RANDOM_OWNER_PASSWORD>

# Session and Security
KALYAN_COOKIE_NAME=kalyan_session
KALYAN_COOKIE_SECURE=false
KALYAN_SESSION_IDLE_MINUTES=30
KALYAN_SESSION_ABSOLUTE_HOURS=12

# Allowed LAN Origins (Substitute actual server static IP, e.g. 192.168.1.100)
KALYAN_EXTRA_ALLOWED_ORIGINS=["http://127.0.0.1:8000","http://localhost:8000","http://192.168.1.100:8000"]

# Frontend Distribution Directory
KALYAN_FRONTEND_DIST=D:/dr-sr/frontend/dist

# Storage Paths
KALYAN_PHOTOS_DIR=D:/dr-sr/backend/var/photos
KALYAN_BACKUP_DIR=D:/dr-sr/backend/var/backups
```

---

## 12. Docker, Containerization & Process Supervisors

### 12.1 Containerization State
- **Production Server:** The clinic deployment uses **no Docker containers** on the bare-metal Windows server PC. It runs native Windows processes orchestrated via PowerShell and Windows Task Scheduler.
- **Continuous Integration:** Docker is utilized exclusively in GitHub Actions to run the official `postgres:18` ephemeral service container.

### 12.2 Process Supervisors & Scripts (`deploy/`)
- **`deploy/install.ps1`**: Administrative installer setting up Python virtual environments (`backend/.venv`), running offline package installations (`wheelhouse/`), initializing `backend/var/*` directories, and running database migrations.
- **`deploy/start-server.bat`**: Startup script executed on system boot. Verifies virtual environment existence, runs `cli.py check-db` pre-flight checks, and launches Uvicorn:
  ```cmd
  "%VENV_PYTHON%" -m uvicorn kalyan_api.main:create_app --factory --host 0.0.0.0 --port 8000 --access-log
  ```
- **`deploy/register-autostart.ps1`**: Registers a Windows Scheduled Task (`KalyanHospitalServerAutoStart`) configured with trigger `-AtStartup`, principal `SYSTEM`, and automatic restart recovery on power failure.
- **`deploy/health-check.ps1`**: Automated probe validating `/api/health` connectivity and database readiness.

---

## 13. Variable Dependencies & Co-requisites

```
                   ┌───────────────────────┐
                   │       KALYAN_ENV      │
                   └───────────┬───────────┘
                               │
            ┌──────────────────┴──────────────────┐
            ▼                                     ▼
  ("production")                         ("development")
┌───────────────────────────┐         ┌───────────────────────────┐
│ KALYAN_DB_APP_PASSWORD    │         │ Defaults to empty string  │
│ KALYAN_DB_OWNER_PASSWORD  │         │ (PostgreSQL auth fails if │
│ (Must not be CHANGE_ME or │         │ password is required)     │
│  empty; fails boot)       │         └───────────────────────────┘
└───────────┬───────────────┘
            │
            ▼
┌───────────────────────────┐
│ KALYAN_FRONTEND_DIST      │
│ (Must be absolute path    │
│  containing index.html)   │
└───────────────────────────┘
```

1. **`KALYAN_DB_APP_PASSWORD` & `KALYAN_DB_OWNER_PASSWORD`:** Both must be set simultaneously. If `kalyan_app` connects but `kalyan_owner` is invalid, the server starts but database migrations and backup creation fail.
2. **`KALYAN_FRONTEND_DIST` & Production Mode:** In production, if `KALYAN_FRONTEND_DIST` is omitted, the API starts but hospital workstations navigating to `http://<SERVER_IP>:8000/` receive a 404 error instead of the user interface.
3. **`KALYAN_BACKUP_DESTINATIONS` & `KALYAN_BACKUP_DIR`:** The manual backup API rejects any backup destination request outside `KALYAN_BACKUP_DIR` unless the directory is explicitly enumerated in `KALYAN_BACKUP_DESTINATIONS`.

---

## 14. Fallback Values & Implicit Behaviors

| Variable Name | If Unset / Missing | Implicit System Behavior | Risk / Warning |
| :--- | :--- | :--- | :--- |
| `KALYAN_ENV` | Defaults to `"development"` | Bypasses production-only durability checks in CLI. | Durability regressions might go unnoticed in dev. |
| `KALYAN_DB_HOST` | Defaults to `"127.0.0.1"` | Assumes PostgreSQL is co-located on the same OS. | Fails if database resides on a separate server. |
| `KALYAN_DB_PORT` | Defaults to `5432` | Uses standard PostgreSQL TCP port. | Fails if PostgreSQL runs on non-standard port. |
| `KALYAN_DB_NAME` | Defaults to `"kalyan_dev"` | Connects to development database catalog. | High risk if run against prod with dev DB name. |
| `KALYAN_COOKIE_SECURE` | Defaults to `False` | Cookies issued without `Secure` attribute. | Plaintext cookie transmission over untrusted WiFi. |
| `KALYAN_FRONTEND_DIST` | Defaults to `None` | Application starts in API-only mode. | Frontend SPA becomes completely inaccessible. |
| `KALYAN_SETUP_CODE_PATH`| Defaults to `None` | Uses `backend/var/setup-code.txt`. | Setup code written to default directory. |
| `KALYAN_PHOTOS_DIR` | Defaults to `backend/var/photos` | Creates/reads photos relative to backend directory. | Storage volume filling server system drive. |
| `KALYAN_BACKUP_DIR` | Defaults to `backend/var/backups`| Backups saved in local backend folder. | Backups lost if server system disk fails. |

---

## 15. Security & Exposure Risk Matrix

| Risk ID | Variable / Area | Exposure Type | Severity | Description & Remediation |
| :--- | :--- | :--- | :--- | :--- |
| **SEC-ENV-01** | `KALYAN_DB_APP_PASSWORD` | Credential Leak | **CRITICAL** | If committed to git or exposed in logs, allows direct database compromise. **Rule:** Enforce `.gitignore` on `backend/.env`. |
| **SEC-ENV-02** | `KALYAN_DB_OWNER_PASSWORD` | Superuser Leak | **CRITICAL** | Schema owner credentials allow table truncation and DDL manipulation. Must never be shared with non-admin staff. |
| **SEC-ENV-03** | `KALYAN_COOKIE_SECURE` | Interception | **HIGH** | `false` permits session cookie transmission over plaintext HTTP. Mitigated in clinic by physically isolated wired LAN. |
| **SEC-ENV-04** | `KALYAN_EXTRA_ALLOWED_ORIGINS`| CSRF Bypass | **HIGH** | Wildcards (`*`) or erroneous IPs in this list disable CSRF defense. Ensure only verified static server IPs are allowed. |
| **SEC-ENV-05** | `KALYAN_SETUP_CODE_PATH` | Privilege Escalation| **HIGH** | If `setup-code.txt` is world-readable, unauthorized users can claim first-run admin account. File is deleted after wizard. |
| **SEC-ENV-06** | `KALYAN_BACKUP_DIR` | Data Exfiltration | **HIGH** | Uncompressed/plain `.tar.gz` dumps contain full patient clinical history (PHI). Directory must have restricted OS ACLs. |
| **SEC-ENV-07** | `KALYAN_PHOTOS_DIR` | PHI Exposure | **MEDIUM** | Patient photos stored unencrypted on disk. Direct directory indexing is disabled; authenticated endpoint controls access. |

---

## 16. Missing, Drifted & Undocumented Variables

Audit comparison between `backend/src/kalyan_api/config.py`, `backend/.env.example`, and `deploy/.env.production.template` reveals the following discrepancies:

### 16.1 Variables Present in Code but Missing from `backend/.env.example`
1. `KALYAN_TOUCH_THROTTLE_SECONDS`
2. `KALYAN_LOCKOUT_THRESHOLD`
3. `KALYAN_LOCKOUT_MINUTES`
4. `KALYAN_THROTTLE_MAX_FAILURES`
5. `KALYAN_THROTTLE_WINDOW_MINUTES`
6. `KALYAN_PASSWORD_MIN_LENGTH`
7. `KALYAN_PASSWORD_MAX_LENGTH`
8. `KALYAN_TEMP_PASSWORD_LENGTH`
9. `KALYAN_ARGON2_TIME_COST`
10. `KALYAN_ARGON2_MEMORY_COST`
11. `KALYAN_ARGON2_PARALLELISM`
12. `KALYAN_SETUP_CODE_PATH`
13. `KALYAN_PHOTOS_DIR`
14. `KALYAN_BACKUP_DIR`
15. `KALYAN_BACKUP_DESTINATIONS`

### 16.2 Variables in `deploy/.env.production.template` Missing from `backend/.env.example`
- `KALYAN_PHOTOS_DIR` (Included in production template, omitted from dev example)
- `KALYAN_BACKUP_DIR` (Included in production template, omitted from dev example)

### 16.3 Format Discrepancies
- In `backend/.env.example`, `KALYAN_EXTRA_ALLOWED_ORIGINS` is formatted as a plain comma-separated string (`http://localhost:5173`).
- In `deploy/.env.production.template`, `KALYAN_EXTRA_ALLOWED_ORIGINS` is formatted as a JSON array (`["http://127.0.0.1:8000", ...]`).
- *Note:* Both formats are handled correctly by the custom field validator in `backend/src/kalyan_api/config.py`.

---

## 17. Deprecated, Unused & Stale Variables

1. **`KALYAN_TEST_DB_NAME`:** Used exclusively in `backend/tests/conftest.py` as an override; not recognized by the main `Settings` class.
2. **Vendored Skill Variables (`.agents/skills/ui-ux-pro-max/`):** The repository contains references to `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `ATLASCLOUD_API_KEY`, `MUAPI_API_KEY`, and `DESIGN_SYSTEM_PROJECT_ROOT`. These are isolated to internal developer agent utilities and have no connection to the Kalyan Hospital clinical application runtime.
3. **Legacy Qt Variables:** `QT_QPA_PLATFORM` is used exclusively for headless PySide6 test fixtures and has zero effect on the production web application.

---

## 18. Validation Rules & Type Constraints

Validation logic defined in `Settings` (`backend/src/kalyan_api/config.py`):

```python
# 1. Database Password Placeholder Rejection
@field_validator("db_app_password", "db_owner_password", mode="after")
def validate_password_not_placeholder(cls, v: str) -> str:
    if v == "CHANGE_ME":
        raise ValueError("Database password cannot be default placeholder 'CHANGE_ME'")
    return v

# 2. Frontend Distribution Path Validation
@field_validator("frontend_dist", mode="before")
def validate_frontend_dist_absolute(cls, v: Any) -> Path | None:
    if v is None or v == "" or (isinstance(v, str) and not v.strip()):
        return None
    p = Path(v)
    if not p.is_absolute():
        raise ValueError(f"frontend_dist must be an absolute path, got: {v}")
    return p

# 3. Allowed Origins List Parser
@field_validator("extra_allowed_origins", mode="after")
def parse_allowed_origins(cls, v: Any) -> list[str]:
    # Handles empty, comma-separated, or JSON array strings
    ...

# 4. Password Policy Bounds
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
```

---

## 19. Safe Local & Production Setup Playbooks

### 19.1 Local Developer Setup Playbook
1. Ensure Python 3.12 and PostgreSQL 17+ are installed locally.
2. Run database initialization script:
   ```bash
   psql -U postgres -f backend/db/bootstrap.sql
   ```
3. Copy development configuration template:
   ```bash
   cp backend/.env.example backend/.env
   ```
4. Edit `backend/.env` and replace `CHANGE_ME` with the passwords set during bootstrap.
5. Apply database migrations:
   ```bash
   cd backend
   python -m kalyan_api.cli migrate
   ```
6. Start the development API server:
   ```bash
   uvicorn kalyan_api.main:create_app --factory --reload --port 8000
   ```
7. In a separate terminal, launch the frontend:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

### 19.2 Production LAN Server Setup Playbook
1. Open PowerShell with Administrator privileges.
2. Execute automated installation script:
   ```powershell
   powershell -ExecutionPolicy Bypass -File deploy\install.ps1
   ```
3. Copy production template to target location:
   ```powershell
   Copy-Item deploy\.env.production.template backend\.env
   ```
4. Generate cryptographically strong random passwords and configure `backend/.env`:
   - Set `KALYAN_DB_APP_PASSWORD`.
   - Set `KALYAN_DB_OWNER_PASSWORD`.
   - Update `KALYAN_EXTRA_ALLOWED_ORIGINS` with the hospital server's static LAN IP address (e.g., `["http://192.168.1.100:8000"]`).
   - Verify `KALYAN_FRONTEND_DIST=D:/dr-sr/frontend/dist`.
5. Build the frontend distribution:
   ```powershell
   cd frontend
   npm ci
   npm run build
   cd ..
   ```
6. Register the system auto-recovery task:
   ```powershell
   powershell -ExecutionPolicy Bypass -File deploy\register-autostart.ps1
   ```
7. Verify installation health:
   ```powershell
   powershell -ExecutionPolicy Bypass -File deploy\health-check.ps1
   ```

---

## 20. Audit Trail, Verification & Unknowns

### 20.1 Verification Evidence
- Source code inspection of [`backend/src/kalyan_api/config.py`](file:///d:/dr-sr/backend/src/kalyan_api/config.py).
- Review of deployment scripts in [`deploy/`](file:///d:/dr-sr/deploy/).
- Review of CI/CD configuration in [`.github/workflows/tests.yml`](file:///d:/dr-sr/.github/workflows/tests.yml).
- Verification of test suites in `backend/tests/conftest.py` and `frontend/src/print-check/print-check.test.tsx`.

### 20.2 Unverified Areas / Operational Unknowns
1. **Physical Server Static LAN IP:** The production template defaults to placeholder `192.168.1.100:8000`. The actual hospital LAN subnet and assigned static server IP must be confirmed with the clinic network administrator during physical hardware commissioning.
2. **External Backup Mount Points:** `KALYAN_BACKUP_DESTINATIONS` is left empty by default. The exact drive letter of the external backup drive (e.g. `E:\`, `F:\`) depends on the hardware port assigned on the physical server PC.

