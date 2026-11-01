# Attack Surface Analysis — Kalyan Hospital LAN Web Platform

This document enumerates all externally or internally reachable surfaces in the Kalyan Hospital system as of November 1, 2026.

---

## 1. Network & Deployment Exposure

| Surface | Port / Interface | Binding | Exposure Level | Protocol | Description |
|---|---|---|---|---|---|
| **FastAPI HTTP Service** | 8000 (default) | Configurable / LAN IP | Hospital LAN subnet (3–5 workstations) | Plain HTTP (HTTPS planned) | Serves both the JSON API (`/api/v1/*`) and static React SPA bundle (`/`, `/assets/*`) |
| **PostgreSQL Database** | 5432 | `127.0.0.1` | Localhost only | PostgreSQL Wire Protocol | Database engine running locally on the central server; blocked from direct LAN access |
| **Vite Dev Server (Dev Only)** | 5173 | `localhost` | Developer workstation | HTTP | Development frontend hot-reload server (not active in production) |

*Note*: The hospital LAN must remain isolated with no router port forwarding or public internet exposure (`SECURITY.md` Section 6).

---

## 2. Public (Unauthenticated) HTTP Endpoints

The following endpoints do not require an active session cookie:

| Method | Endpoint Path | Functionality | Request Input | Security & Rate Controls |
|---|---|---|---|---|
| `GET` | `/api/health` | Healthcheck tracer | None | Verifies database ping; exposes no confidential details |
| `GET` | `/api/v1/setup/status` | Informs UI if setup is needed | None | Returns `{ "setup_required": bool }`; no secrets exposed |
| `POST` | `/api/v1/setup/bootstrap` | Registers first administrator | `SetupBootstrapRequest` (setup_code, username, full_name, password) | Active ONLY when `system_setup` table has 0 rows; requires valid one-time setup code; IP throttled (5 failures/15 min); single-admin race guard; permanently closed after use |
| `POST` | `/api/v1/auth/login` | Authenticates staff user | `LoginRequest` (username, password) | 5-failure account lockout (15 min); 20-failure IP rate throttle (15 min); dummy Argon2 verification prevents timing enumeration |
| `GET` | `/` | Root HTML | None | Returns `index.html` with security headers |
| `GET` | `/assets/*` | Frontend assets | Path parameter | Static JS/CSS/fonts; path traversal protected; immutable cache headers |

---

## 3. Internal (Authenticated) Endpoints & RBAC Surfaces

All routes below require an active `kalyan_session` cookie verified via FastAPI dependency `current_principal`.

### Administrative Surface (`ADMIN` Role)
- **Users Management** (`/api/v1/users`):
  - `GET /api/v1/users`: List staff users (`USER_READ`).
  - `POST /api/v1/users`: Create new staff user (`USER_CREATE`).
  - `GET /api/v1/users/{id}`: View user details (`USER_READ`).
  - `PATCH /api/v1/users/{id}`: Modify user attributes (`USER_UPDATE`) with `version_id` optimistic locking.
  - `POST /api/v1/users/{id}/deactivate`: Deactivate account (`USER_DEACTIVATE`), revoking active sessions.
  - `POST /api/v1/users/{id}/reactivate`: Reactivate account.
  - `POST /api/v1/users/{id}/reset-password`: Set temporary password (`USER_RESET_PASSWORD`).
  - `POST /api/v1/users/{id}/unlock`: Clear brute-force lockout (`USER_UNLOCK`).
- **Clinic Configuration** (`/api/v1/settings`):
  - `GET /api/v1/settings`: View clinic details (`SETTINGS_READ`).
  - `PUT /api/v1/settings`: Update bilingual names, addresses, phone, print headers (`SETTINGS_WRITE`).
- **Doctor Roster & Fees** (`/api/v1/doctors`):
  - `GET /api/v1/doctors`: List doctors (`DOCTOR_READ`).
  - `POST /api/v1/doctors`: Create doctor profile (`DOCTOR_MANAGE`).
  - `GET /api/v1/doctors/fees`: List consultation fees (`FEE_READ`).
  - `POST /api/v1/doctors/fees`: Create consultation fee entry (`FEE_MANAGE`).

### Reception Surface (`RECEPTION` Role)
- **Patient Intake & Demographics** (`/api/v1/patients`):
  - `POST /api/v1/patients`: Register patient with 12 canonical fields (`PATIENT_CREATE`). Allocates gap-free `KH-YYYY-XXXX` URN.
  - `GET /api/v1/patients/search`: Search patients by URN, phone, or name (Latin/Devanagari) (`PATIENT_READ`).
  - `GET /api/v1/patients/{id}`: View patient demographic details (`PATIENT_READ`).
  - `PATCH /api/v1/patients/{id}`: Edit demographics with optimistic locking (`PATIENT_UPDATE`). Writes audit before/after log.
- **Biometric Photo Handling** (`/api/v1/patients/{id}/photo`):
  - `POST /api/v1/patients/{id}/photo`: Upload patient photograph (`PHOTO_WRITE`). Enforces 5 MB limit, magic bytes check.
  - `GET /api/v1/patients/{id}/photo`: Authenticated streaming (`PHOTO_READ`). Direct unauthenticated requests rejected.
- **Appointment Queue & Booking** (`/api/v1/appointments`):
  - `POST /api/v1/appointments`: Book appointment with doctor; allocates daily token (`APPOINTMENT_WRITE`).
  - `GET /api/v1/appointments`: List appointments by date and doctor (`APPOINTMENT_READ`).
  - `POST /api/v1/appointments/{id}/status`: Transition appointment status (`ARRIVED`, `CANCELLED`, `NO_SHOW`) (`APPOINTMENT_WRITE`).

### Doctor Clinical Surface (`DOCTOR` Role)
- **Consultation Queue** (`/api/v1/appointments/doctor-queue`):
  - `GET /api/v1/appointments/doctor-queue`: Real-time queue for logged-in doctor on selected date (`APPOINTMENT_READ`).
  - `POST /api/v1/appointments/{id}/call`: Transition status to `IN_CONSULTATION`.
  - `POST /api/v1/appointments/{id}/complete`: Transition status to `DONE`.
- **Clinical Encounters & Notes** (`/api/v1/encounters`):
  - `POST /api/v1/encounters`: Create draft clinical encounter (`ENCOUNTER_WRITE`). Scoped strictly to logged-in doctor.
  - `GET /api/v1/encounters/{id}`: View encounter (`ENCOUNTER_READ`). Enforces doctor silo (`D-03`). Reception denied (`404 not_found` / `403`).
  - `PUT /api/v1/encounters/{id}`: Update draft notes (`ENCOUNTER_WRITE`). Blocked if encounter is finalized.
  - `POST /api/v1/encounters/{id}/finalize`: Seal encounter (`ENCOUNTER_WRITE`). Triggers database immutability lock.
  - `POST /api/v1/encounters/{id}/addenda`: Append dated correction note (`ENCOUNTER_WRITE`). Requires reason.

---

## 4. User Input Surfaces & Validation

| Input Channel | Input Types / Models | Validation Mechanisms | Security Risk Mitigated |
|---|---|---|---|
| **JSON Request Bodies** | Pydantic v2 schemas (`UserCreate`, `PatientCreate`, `EncounterCreate`, etc.) | Strict type constraints, regex string validation, min/max bounds | Type juggling, buffer/string overflow, missing fields |
| **URL Query Parameters** | Search terms (`q`), date filters (`date`), pagination (`limit`, `offset`) | Type casting (`date`, `int`), sanitization in SQLAlchemy parameterized queries | SQL injection, unbounded result set exhaustion |
| **HTTP Headers** | `Origin`, `Referer`, `Host`, `X-CSRF-Token`, `X-Request-ID` | Netloc parsing, host comparison, `hmac.compare_digest` constant-time match | CSRF attacks, DNS rebinding |
| **HTTP Cookies** | `kalyan_session` | 256-bit URL-safe token format, lookup by SHA-256 hash | Session spoofing |
| **Multipart Form Data** | Patient photo uploads | Magic byte header inspection (`\xff\xd8\xff`, `\x89PNG`), 5 MB length check | File format spoofing, payload injection |

---

## 5. File Upload Surface

- **Target Route**: `POST /api/v1/patients/{id}/photo`
- **Validation Controls**:
  - Max body size: 5 MB (`MAX_PHOTO_BYTES`).
  - Format verification: Magic byte checking for JPEG (`.jpg`) and PNG (`.png`).
  - Naming: Discards client filename. Persists under cryptographically random UUID (`uuid.uuid4().hex`).
  - Destination: `backend/var/photos/` (isolated from web root).
  - Serving: Read route checks session authentication and `Permission.PHOTO_READ`. Path traversal is blocked using `Path(filename).name`.

---

## 6. Database Access Surface

- **Engine**: PostgreSQL 18.6 accessed via SQLAlchemy 2.0 (psycopg3).
- **SQL Injection Defense**: 100% of queries utilize SQLAlchemy parameterized statements and ORM expressions (`select(Model).where(...)`). Zero raw string formatting (`f"SELECT ... {input}"`).
- **Database User Separation**:
  - `kalyan_app`: Runtime user. Granted `SELECT, INSERT, UPDATE` on application tables. Has NO `DDL`, `DROP`, or `CREATE TABLE` privileges.
  - `kalyan_owner`: Schema owner. Used only for Alembic migrations and CLI administration.
- **Engine-Level Trigger Enforcement**:
  - `trg_audit_logs_no_update_delete`: Blocks `UPDATE`, `DELETE`, `TRUNCATE` on `audit_logs`.
  - `trg_prevent_finalised_encounter_tampering`: Blocks `UPDATE` or `DELETE` on finalized clinical encounters.

---

## 7. Storage Surfaces

| Storage Asset | Path | Security Controls | Exposure Risk |
|---|---|---|---|
| **Patient Photographs** | `backend/var/photos/*.jpg\|png` | Outside web root, UUID names, git-ignored | Unauthenticated access blocked by API streaming gate |
| **Setup Code** | `backend/var/setup-code.txt` | Outside web root, git-ignored, unlinked after setup | Local server console user access |
| **PostgreSQL Data Files** | PostgreSQL `data/` directory | OS user `postgres` permissions | Server host compromise only |
| **Static Web Distribution** | `frontend/dist/` | Read-only static assets | Publicly served; no sensitive data bundled |

---

## 8. Webhooks & Third-Party Integrations

- **Webhooks**: **None**. There are zero incoming or outgoing webhook handlers in the application.
- **Third-Party Services**: **Zero**. The system is completely offline and standalone with no cloud APIs, CDNs, external analytics, or remote authenticators.

---

## 9. Administrative Console Surface (CLI)

- **Executable**: `kalyan-api` CLI (`backend/src/kalyan_api/cli.py`).
- **Commands**:
  - `kalyan-api migrate`: Executes Alembic migrations using `kalyan_owner` credentials.
  - `kalyan-api check-db`: Checks connectivity and durability parameters as `kalyan_app`.
  - `kalyan-api reset-admin-password <username>`: Interactive console-only password reset for administrators. Prompts via `getpass.getpass()`, revokes active sessions, and records audit event.
- **Access Control**: Relies strictly on server operating system authentication (physical or SSH access to the server PC).

