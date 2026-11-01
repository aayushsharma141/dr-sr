# Secrets Management Assessment — Kalyan Hospital LAN Web Platform

This document audits where secrets exist, how they are configured and loaded, potential exposure vectors, and rotation policies across the Kalyan Hospital codebase.

---

## 1. Inventory of Project Secrets

| Secret Description | Secret Classification | Where Stored / Handled | Consumed By | Lifetime / Scope |
|---|---|---|---|---|
| **PostgreSQL App Password (`db_app_password`)** | Critical Infrastructure Secret | Loaded via `KALYAN_DB_APP_PASSWORD` from `backend/.env` or OS environment | `SessionLocal` SQLAlchemy engine (`kalyan_app` role) | Static across server run |
| **PostgreSQL Owner Password (`db_owner_password`)** | Critical Infrastructure Secret | Loaded via `KALYAN_DB_OWNER_PASSWORD` from `backend/.env` or OS environment | Alembic migrations and CLI setup (`kalyan_owner` role) | Static across migrations |
| **Staff User Passwords** | Critical User Secret | Argon2id hash (`password_hash`) in `users` table; cleartext transient during login/change | `auth_service.py`, `password_policy.py` | Rotated on demand or initial forced change |
| **Session Cookie Tokens** | High Transient Secret | Random 256-bit URL-safe token in `kalyan_session` cookie; SHA-256 hash stored in `sessions.token_hash` | `auth.py`, browser clients | 30-min idle window, 12-hour max absolute |
| **CSRF Protection Tokens** | Medium Transient Secret | Random URL-safe token in response payload; verified against session record | `client.ts` memory, `check_csrf_token()` | Per-session lifecycle |
| **First-Run Setup Code** | Critical Ephemeral Secret | Generated on boot in `setup_code.py`; stored in memory as SHA-256 hash; saved to `backend/var/setup-code.txt` | Local administrator via `/setup` wizard | Consumed atomically once or rotated after 10 failures |

---

## 2. Environment & Configuration Handling

### Mechanism
- Configuration is centralized in `backend/src/kalyan_api/config.py` using `pydantic-settings.BaseSettings`.
- Reads environment variables prefixed with `KALYAN_` (e.g. `KALYAN_DB_APP_PASSWORD`).
- Falls back to `backend/.env` if present on disk.
- Template provided in `backend/.env.example` with clear instructions and placeholder tokens (`CHANGE_ME`).

### Startup Refusal Controls
- In `config.py` (lines 101–106):
  ```python
  @field_validator("db_app_password", "db_owner_password", mode="after")
  @classmethod
  def validate_password_not_placeholder(cls, v: str) -> str:
      if v == "CHANGE_ME":
          raise ValueError("Database password cannot be default placeholder 'CHANGE_ME'")
      return v
  ```
  The application **refuses to start** if database passwords remain as `CHANGE_ME`.

---

## 3. Hardcoded Secret Analysis

### Codebase Inspection
- **Source Code Verification**: A scan across `backend/src/` confirms **zero hardcoded database passwords, API keys, or production user credentials**.
- **Test Scaffolding**: `backend/tests/test_no_default_credentials.py` runs as part of the CI test suite, explicitly verifying that no default or hardcoded credentials exist in source files or migrations (`SEC-05`).
- **Dummy Argon2 Hash**: In `backend/src/kalyan_api/core/security.py`, line 13 defines a fixed dummy hash (`_DUMMY_HASH = "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$RdescudvJCsgqlfreSAeYQ"`).
  - *Finding*: This is not a secret or vulnerability; it is a synthetic dummy hash executed during constant-time verification when an unmapped username is queried, successfully thwarting timing enumeration attacks.

---

## 4. Client-Side Exposure Risks

### Frontend Bundle Inspection
- **Vite & React Environment**:
  - The frontend build process (`tsc -b && vite build`) bundles assets into `frontend/dist`.
  - No `VITE_` prefixed sensitive variables (e.g. database credentials or master secrets) exist in `frontend/`.
- **Session Tokens**:
  - Session tokens are stored in `HttpOnly` cookies. JavaScript running in the browser cannot access `document.cookie` to read `kalyan_session`.
- **CSRF Tokens**:
  - The CSRF token is kept strictly in module-level in-memory state (`let csrfToken: string | null = null` in `frontend/src/api/client.ts`).
  - It is **never** persisted to `localStorage` or `sessionStorage`, mitigating token theft via Cross-Site Scripting (XSS).
- **First-Run Setup Code**:
  - Verification: `GET /api/v1/setup/status` returns only `{"setup_required": boolean}`. The actual setup code is never returned in HTTP responses.

---

## 5. Version Control (Git) Exposure Risks

### `.gitignore` Enforcement
- Root `.gitignore` explicitly excludes:
  - `.env`
  - `data/`
  - `backups/`
  - `backend/var/`
  - `var/`
  - `dist/` and `build/`
- Local `backend/var/setup-code.txt` and `backend/var/photos/` are located in git-ignored paths and are never tracked in version control.
- Git commit history inspection confirms no committed `.env` files or certificates.

---

## 6. Logging and Error Handling Exposure Risks

### Invariant Checks
- **Setup Code Invariant**: In `setup_code.py` (lines 3–9), the setup code is explicitly blocked from being sent to Python `logging` or database audit tables. It is displayed to stdout only if `sys.stdout.isatty()` is True.
- **Pydantic Validation Filtering**: In `backend/src/kalyan_api/core/errors.py` (lines 127–144), `handle_validation_error` extracts only `loc` (field path) and `msg` (validation rule message). The submitted invalid payload or cleartext password is intentionally **omitted** from HTTP responses.
- **Unhandled Exceptions**: In `backend/src/kalyan_api/core/errors.py` (lines 146–156), unhandled exceptions log the internal traceback with an attached `X-Request-ID` but return a sanitized JSON response:
  ```json
  {
    "code": "internal_error",
    "message": "An unexpected server error occurred."
  }
  ```
  No stack traces, SQL queries, or sensitive parameter values leak to the client.
- **CLI Password Prompts**: In `backend/src/kalyan_api/cli.py`, `cmd_reset_admin_password` uses `getpass.getpass()`, preventing password echoing on the terminal, and rejects command-line arguments like `--password`.

---

## 7. Secret Rotation Requirements

1. **Database Credentials (`kalyan_app`, `kalyan_owner`)**:
   - Rotation requires running SQL `ALTER ROLE ... WITH PASSWORD` in PostgreSQL followed by updating `backend/.env` and restarting the FastAPI service.
   - Frequency: Recommended upon administrator offboarding or suspected compromise.
2. **Staff Passwords**:
   - Supported via `POST /api/v1/auth/change-password` (self-service) or `POST /api/v1/users/{id}/reset-password` (Admin action).
   - Forces `must_change_password = True` on initial login or administrative reset.
3. **Session Tokens**:
   - Immediate invalidation on `POST /api/v1/auth/logout`.
   - Automatic background invalidation when an account is locked or deactivated.
   - Sliding idle expiration after 30 minutes; hard cap at 12 hours.
4. **First-Run Setup Code**:
   - Rotates automatically after 10 failed submission attempts (`rotate_setup_code`).
   - Automatically unlinked from disk upon successful administrator creation (`consume_setup_code`).

---

## 8. Specific Findings & Observations

### Observation 1: Plain HTTP Exposes Session Tokens on LAN Wire (Medium Severity Weakness)
- **Evidence**: `backend/src/kalyan_api/config.py` sets `cookie_secure: bool = False` by default under decision `D-01`.
- **Risk**: Without transport encryption (TLS/HTTPS), the session token transmitted in HTTP cookie headers can be sniffed by anyone on the local network.
- **Mitigation Requirement**: Deploy with a local TLS certificate or reverse proxy terminate TLS, and configure `KALYAN_COOKIE_SECURE=true`.

### Observation 2: Setup Code Written in Plaintext to Local Filesystem (Low Risk / Compensating Control Present)
- **Evidence**: `backend/src/kalyan_api/core/setup_code.py` writes the setup code to `backend/var/setup-code.txt`.
- **Risk**: Any local user on the Windows host with read access to the directory could obtain the initial setup code before the administrator registers.
- **Compensating Control**: File permissions set to `0o600` (on POSIX) and file is unlinked immediately upon successful registration.

