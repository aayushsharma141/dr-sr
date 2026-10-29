# Architecture Research

**Domain:** Offline hospital LAN web platform (patient registry, physiotherapy cases, billing), FastAPI + PostgreSQL + one React/TS SPA
**Researched:** 2026-10-30
**Confidence:** HIGH on structure, concurrency and backup (standard patterns, small scale). MEDIUM on Windows service/packaging choices (server hardware unconfirmed). Appointments, prescriptions and treatment plans are NOT in the v2.0 reference, so their schema is a proposal, not an extraction.

## Findings from the v2.0 reference (domain rules to carry over)

Extracted from `app/db/schema.sql` and `app/services/*`, `app/repositories/*`:

| Area | v2.0 behaviour | v3.0 consequence |
|------|----------------|------------------|
| Entities | `doctors`, `patients`, `treatment_cases` (fee + target sessions), `treatment_sessions` (append-only, VAS 0-10), `payments` (ledger, `amount > 0`), `users` (3 roles), `id_sequences(year,last_seq)`, `audit_logs` | Direct basis of the new schema. No appointments, prescriptions, treatment plans, encounters or receipts tables exist yet. |
| URN | `KH-YYYY-XXXX`, per-year counter, `BEGIN IMMEDIATE` | Keep format. BUT v2.0 increments the counter in a separate transaction from the patient INSERT, so a failed insert burns a number (gap). Fix: generate inside the registration transaction. |
| Patient search | name/URN/mobile `LIKE`, excludes `ARCHIVED`, filters: today, active_therapy, pending_balance, by doctor | Port as server-side query params; add `pg_trgm` indexes. |
| Validation | name <=150, age 0-125, sex in Male/Female/Other, mobile normalised to 10 digits (strips `+91`), condition required, doctor optional | Port to Pydantic validators. |
| Archive | Soft delete only (`status=ARCHIVED`), never hard delete | Keep. Hard-delete is not exposed by the API at all. |
| Case follows patient | New case copies `patient.doctor_id` | Keep, but store `doctor_id` on case explicitly. |
| Sessions | Append-only; `session_number = next` computed by read-then-insert (RACE in multi-user) | Must become `UNIQUE(case_id, session_number)` + retry or row lock. Immutability enforced by a DB trigger, plus a correction mechanism (see below). |
| Billing | Integer paise; `Decimal` conversion; payment > 0; mode in CASH/UPI/CARD/OTHER | Keep. **Discrepancy:** PROJECT.md says "rejects overpayments" but `BillingService.record_installment` only FLAGS overpayment (`is_overpayment`) and still inserts it. v3.0 must decide (recommend: reject, per the validated claim). Balance is derived (`fee - SUM(payments)`), never stored. |
| Auth | PBKDF2-SHA256 100k iterations, hand-rolled salt; roles ADMIN/RECEPTIONIST/DOCTOR; default seeded admin `admin/kalyan@admin`; min password 6 (8 for first admin) | Replace with argon2id (or bcrypt); NO default credentials; first-run admin bootstrap CLI. Rehash is impossible from old hashes, so migrated users get forced password reset. |
| Role checks | Only 4 static helper predicates; v2.0 reception can register, doctors can too | New matrix below; server-side on every route. |
| Audit | Free-text `details`, actor as a name string, `user_id` often NULL, no before/after, nothing prevents UPDATE/DELETE | Redesign: structured, FK to user, JSONB diff, append-only enforced in DB. |
| Photos | Stored as `<URN>.jpg/png`, silently overwritten on update, copied by local path | Content-addressed/immutable file names, validated by magic bytes, served only through authenticated endpoint. |
| Backup | SQLite online backup + photos into `.kalyan_bak` zip with manifest; verify (integrity + required tables + counts); restore with safety snapshot and auto-rollback | Re-implement same semantics with `pg_dump -Fc` + photos + manifest + checksums; keep verify-then-safety-snapshot-then-restore-then-verify flow. |

## Standard Architecture

### System Overview

```
 Reception PC        Doctor PC          Admin PC          (any LAN browser, no Node, no install)
 ┌──────────┐       ┌──────────┐       ┌──────────┐
 │ Browser  │       │ Browser  │       │ Browser  │
 └────┬─────┘       └────┬─────┘       └────┬─────┘
      │  HTTPS (self-signed/local CA) or HTTP on trusted LAN, port 443
══════╧═════════════════╧═════════════════╧═══════════ Hospital LAN (static IP / hostname kalyan-server)
                         │
┌────────────────────────┴───────────────────────────────────────┐
│ Central Windows Server PC                                       │
│                                                                 │
│  Caddy (or uvicorn direct)  ── TLS, static SPA files, /api proxy│
│        │                                                        │
│  ┌─────┴───────────────────────────────────────────────┐        │
│  │ FastAPI app (uvicorn, 1 process, 2-4 workers max)   │        │
│  │  routers → deps(auth, perms) → services →           │        │
│  │  repositories → SQLAlchemy 2.x sync/async           │        │
│  │  audit writer (same transaction)                    │        │
│  └─────┬──────────────────────┬────────────────────────┘        │
│        │                      │                                 │
│  ┌─────┴────────┐   ┌─────────┴────────┐   ┌────────────────┐   │
│  │ PostgreSQL 16│   │ D:\kalyan\photos │   │ D:\kalyan\     │   │
│  │ (localhost   │   │ (private, not    │   │ backups\       │   │
│  │  only)       │   │  web-served)     │   │ + external USB │   │
│  └──────────────┘   └──────────────────┘   └────────────────┘   │
│  Windows services: Postgres, Kalyan API, Caddy, Task Scheduler  │
│  (nightly backup)                                               │
└─────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| React SPA | Role-routed UI, forms, print views. Convenience only; never the security boundary | Vite + React + TS, built once on dev/build machine, shipped as static `dist/` |
| Reverse proxy (optional) | TLS, serve `dist/`, proxy `/api` | Caddy (single exe, local CA via `tls internal`) OR have FastAPI mount `StaticFiles` and skip the proxy to cut moving parts |
| Routers | HTTP shape, input/output schemas, declare required permission | FastAPI `APIRouter`, one per aggregate |
| Dependencies | Authenticate session, load user, assert permission, provide DB session | `Depends(current_user)`, `Depends(require("patient:read"))` |
| Services | Business rules, transaction boundary, audit emission | Plain Python classes/functions, ported from v2.0 services |
| Repositories | SQL only, no rules | SQLAlchemy 2.x Core/ORM queries |
| PostgreSQL | Source of truth, constraints, triggers for immutability | PG 16 bound to 127.0.0.1 |
| Photo store | Binary files, served via authenticated route | Local dir outside web root |
| Backup runner | Scheduled `pg_dump` + photos bundle + verify | Python CLI invoked by Windows Task Scheduler |

## Recommended Project Structure

```
kalyan/
├── backend/
│   ├── pyproject.toml
│   ├── alembic.ini
│   ├── alembic/versions/            # 0001_baseline, 0002_..., linear history, committed
│   ├── app/
│   │   ├── main.py                  # app factory, middleware, router include, SPA mount
│   │   ├── config.py                # pydantic-settings (env file), paths, session TTL
│   │   ├── db.py                    # engine, SessionLocal, get_db dependency
│   │   ├── core/
│   │   │   ├── security.py          # argon2 hashing, token generation, CSRF
│   │   │   ├── permissions.py       # Permission enum, ROLE_PERMISSIONS map, require()
│   │   │   ├── errors.py            # DomainError -> HTTP mapping
│   │   │   └── money.py             # rupees_to_paise, format_inr (ported)
│   │   ├── models/                  # SQLAlchemy models: user, doctor, patient, appointment,
│   │   │                            #   encounter, prescription, plan, case, session,
│   │   │                            #   payment, audit, setting, sequence, photo
│   │   ├── schemas/                 # Pydantic request/response models (OpenAPI source)
│   │   ├── repositories/            # one per aggregate
│   │   ├── services/                # auth, patient, urn, appointment, encounter, case,
│   │   │                            #   billing, receipt, photo, audit, backup, integrity, report
│   │   ├── routers/                 # auth, users, doctors, patients, photos, appointments,
│   │   │                            #   encounters, cases, payments, reports, audit, admin
│   │   └── cli/                     # create-admin, backup, restore, verify, import-sqlite
│   └── tests/                       # pytest: unit + API permission matrix + concurrency
├── frontend/
│   ├── package.json  vite.config.ts  openapi-ts.config.ts
│   └── src/
│       ├── api/                     # GENERATED client (do not edit) + thin wrapper
│       ├── auth/                    # AuthProvider, useMe, RequireAuth, RequirePermission
│       ├── routes/                  # router.tsx; admin/ reception/ doctor/ feature folders
│       ├── components/              # DataTable, FormField, MoneyInput, PatientPicker, PhotoCapture,
│       │                            #   ConfirmDialog, Toast, PrintSheet
│       ├── features/                # patients, appointments, encounters, billing, audit, backup
│       ├── lib/                     # money.ts (paise<->display), dates (IST), validators
│       └── print/                   # registration card (dual signature), receipt CSS @media print
├── deploy/                          # install.ps1, services (NSSM/WinSW), Caddyfile, backup task XML
└── docs/
```

### Structure Rationale

- **routers / services / repositories / models:** matches v2.0 service/repository split, so rules port almost 1:1. Routers hold no logic; services own the transaction; repositories own SQL.
- **permissions.py as one file:** the whole matrix is reviewable in one screen and unit-testable; the frontend gets the same list from `GET /auth/me`.
- **cli/:** admin bootstrap, backup, restore and SQLite import must run without the web server (restore especially).
- **frontend feature folders under role routes:** one codebase; `/admin`, `/reception`, `/doctor` are only route trees that compose shared features.

## Architectural Patterns

### Pattern 1: Permission-as-dependency (deny by default)

**What:** Every route declares the permission it needs; a router-level default of "authenticated" plus an explicit `require()` per route. A test walks `app.routes` and fails if any non-public route lacks a permission dependency.
**When to use:** Always here; it is the core requirement ("FastAPI enforces on every endpoint").
**Trade-offs:** Slight boilerplate; the route-walk test is what makes it trustworthy.

```python
# core/permissions.py
class P(str, Enum):
    PATIENT_READ="patient:read"; PATIENT_WRITE="patient:write"; ...
ROLE_PERMS = {"ADMIN": {...}, "RECEPTION": {...}, "DOCTOR": {...}}

def require(*perms: P):
    def dep(user: User = Depends(current_user)) -> User:
        if not set(perms) <= user.permissions:   # role perms +/- per-user overrides
            raise HTTPException(403)
        return user
    return dep

@router.post("/payments", dependencies=[Depends(require(P.PAYMENT_CREATE))])
```

### Pattern 2: One request = one transaction, audit in the same transaction

**What:** `get_db` opens a session/transaction per request; service mutations and their audit row commit or roll back together.
**When to use:** All writes.
**Trade-offs:** If audit insert fails the business write fails (desired for a medical audit trail). Failed logins (no business write) are audited in their own short transaction.

### Pattern 3: Database-enforced invariants, not just service checks

**What:** `CHECK (amount_paise > 0)`, `UNIQUE(case_id, session_number)`, trigger blocking UPDATE/DELETE on sessions/payments/audit, partial unique index for one active session per user.
**When to use:** Anything two PCs could violate by racing.
**Trade-offs:** Needs migrations discipline; pays off because the v2.0 read-then-insert patterns are exactly what breaks under concurrency.

### Pattern 4: Generated API client from OpenAPI

**What:** Backend publishes `/openapi.json`; build step runs `openapi-typescript-codegen` / `@hey-api/openapi-ts` (or `openapi-typescript` + `openapi-fetch`) into `src/api/`. CI/dev script fails if the generated file differs from committed.
**Trade-offs:** Requires tagging `operation_id`s cleanly (use `generate_unique_id_function`). Removes hand-written types and drift. Commit generated output so the build machine without the backend running can still build.

## Data Flow

### Request Flow

```
Browser (React Query) ── cookie + X-CSRF ──▶ FastAPI
   │                                        │ middleware: request-id, IP, session lookup
   │                                        ▼
   │                          Depends(current_user) → Depends(require(perm))
   │                                        ▼
   │                          Router → Service (rules, ownership checks)
   │                                        ▼
   │                          Repository → PostgreSQL  (+ audit row, same txn)
   ◀── JSON / problem+json ───────────────┘
```

### State Management

```
Server state: TanStack Query (cache keyed by API paths, invalidate on mutation)
Auth state:   GET /auth/me → { user, role, permissions[] } in AuthProvider
UI state:     local component state / react-hook-form + zod (schemas mirrored from OpenAPI)
```

### Key Data Flows

1. **Registration:** Reception POST `/patients` → service validates (ported rules) → in ONE txn: allocate URN, insert patient, audit → optional photo upload as second call → response with URN.
2. **Consultation → billing:** Doctor opens encounter for patient → writes notes/prescription/plan → opens a treatment case (fee in paise) → Reception records payments against the case → balance derived on read.
3. **Backup:** Task Scheduler → `kalyan backup` → `pg_dump` + photos + manifest → verify → copy to second drive/USB → audit event.

## Detailed Design

### 1. PostgreSQL schema outline

Conventions: `bigint generated always as identity` PKs; `timestamptz` stored UTC, displayed in Asia/Kolkata; `citext` or lower() unique index for usernames; money as `bigint ..._paise`; every table has `created_at`, mutable ones `updated_at` + `row_version int` (optimistic concurrency).

| Table | Key columns / constraints | Notes |
|-------|---------------------------|-------|
| `users` | id, username (unique, case-insens.), password_hash, role (enum ADMIN/RECEPTION/DOCTOR), doctor_id FK (nullable, unique, required when role=DOCTOR), full_name, is_active, must_change_password, failed_attempts, locked_until, last_login_at | v2.0 had no user↔doctor link; needed for "my patients". |
| `user_permission_overrides` | user_id, permission, granted bool | PROJECT.md says "users and permissions". Keep optional: start with role defaults only; table adds cheap flexibility. |
| `sessions` | id (hash of token, PK), user_id, created_at, last_seen_at, expires_at, ip, user_agent, revoked_at | Server-side sessions. |
| `doctors` | id, name_en, name_hindi, department, designation, is_active | Ported. Seeded with the two consultants. |
| `patients` | id, urn (unique, `KH-YYYY-NNNN`), patient_name, age, sex, address, mobile_no, patient_in, patient_out, referred_by, patient_condition, doctor_id FK, status (ACTIVE/DISCHARGED/ARCHIVED), photo_id FK nullable, row_version | CHECKs ported. Indexes: urn unique, `mobile_no`, `pg_trgm` GIN on `lower(patient_name)`. Do NOT enforce unique mobile (families share phones). Optional duplicate warning (name+mobile) in service. |
| `urn_sequences` | year PK, last_seq | Ported. See concurrency. |
| `patient_photos` | id, patient_id, storage_key, sha256, mime, size_bytes, uploaded_by, created_at, is_current | History kept; replacing sets old `is_current=false`. |
| `appointments` (NEW) | id, patient_id, doctor_id, scheduled_at, status (BOOKED/ARRIVED/DONE/CANCELLED/NO_SHOW), notes, created_by | Exclusion constraint optional (`btree_gist`) to forbid double-booking a doctor slot if the client wants it. |
| `encounters` (NEW) | id, patient_id, doctor_id, appointment_id nullable, encounter_at, complaint, examination, diagnosis, consultation_notes, consultation_fee_paise, status (OPEN/SIGNED), signed_at | The "clinical encounter". Signed encounters become immutable (addenda via new rows). |
| `prescriptions` + `prescription_items` (NEW) | encounter_id; item: drug, dose, frequency, duration, instructions | Printing may be out of scope; table is cheap. |
| `treatment_cases` | ported + `encounter_id` nullable, `doctor_id` | Doubles as "treatment plan" + package: `no_of_sessions`, `total_amount_paise`, status IN_PROGRESS/COMPLETED/SUSPENDED, notes. Free-text plan lives in `plan_text`. Keep this as the single "session package" concept to avoid two overlapping tables. |
| `treatment_sessions` | ported; `UNIQUE(case_id, session_number)`; `performed_by_user_id`, `therapist_name`; `pain_score` 0-10 check | Trigger forbids UPDATE/DELETE. Corrections: `treatment_session_amendments(session_id, amended_by, reason, new_text)` appended, displayed alongside. |
| `payments` | id, case_id, amount_paise (>0), mode (CASH/UPI/CARD/OTHER), reference_note, received_at, recorded_by_user_id, receipt_no (unique), `voided_at/voided_by/void_reason` nullable | No deletes; wrong entry is VOIDED (admin-only) with audit; balance sums non-void rows. Receipt number from a sequence (`KH-R-YYYY-NNNNN`). |
| `consultation_charges` | optional; or reuse `payments` against an encounter fee | Decision for requirements phase: billing is currently case-centric in v2.0. Consultation fee needs either an `encounter_id` on a charge row or a one-session case. Recommend a small `charges` table (patient_id, encounter_id/case_id nullable, description, amount_paise) and `payments` allocate to a charge. Flag to roadmap: v2.0 has no consultation-charge concept. |
| `audit_events` | id bigint, at timestamptz, user_id FK nullable, username_snapshot, ip, action, entity_type, entity_id, patient_id (indexed, for "who touched this patient"), before jsonb, after jsonb, request_id, outcome | Append-only (see audit). |
| `settings` | key PK, value jsonb, updated_by | Hospital name, addresses, print header, clinic list. |
| `clinics` | id, name, address, pincode | Two known sites; patients/encounters optionally carry `clinic_id`. |
| `schema_meta / backups_log` | backup history rows | For admin UI listing and "last good backup" banner. |

Alembic strategy:
- One linear history, hand-reviewed autogenerate, committed. `0001_baseline` creates everything above (extensions `pg_trgm`, `citext`, `btree_gist`; enums; triggers written as `op.execute` SQL).
- Naming convention dict on `MetaData` so constraint names are deterministic (needed for later drops).
- `alembic upgrade head` runs from the install/upgrade script BEFORE the service starts; app refuses to boot if DB revision != code head (`/health` reports it).
- Pre-upgrade hook: automatic `pg_dump` backup before any migration on the live server.
- Forward-only; downgrade is "restore the pre-upgrade backup". Data migrations separate from DDL revisions.
- Triggers/functions live in migrations (not only in models) so a fresh DB and an upgraded DB are identical; test: migrate-from-empty vs `metadata.create_all` diff in CI.

### 2. Authorization model

Roles map to permission sets; the API checks permissions, not role names.

| Capability (permission) | Admin | Reception | Doctor |
|-------------------------|:----:|:---------:|:------:|
| `patient:read` (demographics) | Y | Y | Y (own patients, see rules) |
| `patient:create` / `patient:update` | Y | Y | N (suggest; clients' own wording to confirm) |
| `patient:archive` | Y | N | N |
| `photo:read` / `photo:write` | Y | Y | read |
| `appointment:read/write` | Y | Y | read own; update status of own |
| `encounter:read` | Y | N (only existence/fee summary) | Y own |
| `encounter:write` (notes, prescription, plan) | N | N | Y own |
| `case:create` (package, fee) | Y | Y (fee/package set) | Y |
| `session:create` (clinical note) | Y (v2.0 allowed) | N | Y |
| `session:read` | Y | N (counts only) | Y |
| `payment:create` | Y | Y | N |
| `payment:read`, `receipt:print` | Y | Y | N (sees balance flag only) |
| `payment:void` | Y | N | N |
| `report:financial` | Y | N (own-day cash summary) | N |
| `user:manage`, `permission:manage` | Y | N | N |
| `doctor:manage`, `settings:manage` | Y | N | N |
| `audit:read` | Y | N | N |
| `backup:run/restore`, `integrity:run` | Y | N | N |

Notes: v2.0 let doctors register patients and let ADMIN record clinical sessions; the matrix above tightens both. These are DEFAULTS for the client to confirm in requirements, since the code reflects a single-PC trust model.

Record-level rules (enforced in services/repositories, not just routes):
- **Doctor sees own patients:** a patient is visible to a doctor if `patient.doctor_id = user.doctor_id` OR the doctor has an encounter/case/appointment with them. With only two doctors sharing one patient identity and one ledger (schema comment), a pragmatic default is: both doctors can READ all patient demographics and history (cross-cover is normal in a small clinic), but can WRITE clinical entries only as themselves (`encounter.doctor_id = user.doctor_id`) and cannot edit another doctor's signed encounter. Make "doctor sees all vs own" a `settings` toggle (`doctor_visibility = all | assigned`), default `all`, because strict ownership may block legitimate hand-offs. Confirm with client.
- **Reception cannot read clinical content:** `GET /patients/{id}` returns demographics + financial summary; encounter/session endpoints return 403. Search results omit `patient_condition` if the client considers diagnosis sensitive (it is a registration form field, so keep, but make it a field-level toggle).
- **Immutable after sign/save:** sessions and signed encounters cannot be edited; only addenda.
- **Self-protection:** admin cannot deactivate/demote the last active admin; users cannot change own role.
- **Read access is audited** for clinical records (`encounter:read`, `session:read`) as `VIEW` events, deduped per user/patient/10 min.
- Filtering must happen in SQL (`WHERE`), never fetch-then-hide. Single `visible_patients(user)` query builder reused by search, count, and detail.

### 3. Auth and session design

- **Server-side opaque sessions in `sessions` table**, token = 256-bit random, stored hashed (SHA-256). Delivered as `HttpOnly; SameSite=Strict; Path=/` cookie (add `Secure` once HTTPS). Chosen over JWT: instant revocation (admin deactivates user, logout, password change), no key rotation, trivial on one server.
- **CSRF:** SameSite=Strict + require custom header `X-CSRF-Token` (double-submit value returned by `/auth/me`) on unsafe methods. Same-origin SPA, so CORS is disabled entirely (SPA served from same host).
- **Passwords:** argon2id (`argon2-cffi`) or bcrypt; min length 8; `must_change_password` on admin-created accounts; rate limit and lockout (e.g. 5 failures → 5 min lock, per username AND per IP); constant-time check even for unknown users; audit `LOGIN_SUCCESS/FAILED/LOCKED/LOGOUT`.
- **Lifetime:** idle timeout 30 min (sliding, `last_seen_at`), absolute 12 h (one shift). Reception desk PCs are shared and public-facing, so short idle timeout plus fast re-login and a visible "Lock screen" button.
- **Bootstrap:** `kalyan create-admin` CLI at install; no default password (v2.0 shipped `admin/kalyan@admin`).
- **Password recovery offline:** admin reset (sets temp password + must_change); a CLI `kalyan reset-admin-password` on the server for the last-admin lockout case.
- **Transport:** hospital LAN is still hostile-ish (patients' devices on Wi-Fi?). Recommend HTTPS with a local CA cert (Caddy `tls internal` or `mkcert`-style) installed on each client PC once; fall back to HTTP only if the client refuses the cert step. Confirm LAN/Wi-Fi segmentation with client. Bind PostgreSQL to localhost; open only 443 in Windows Firewall, scope-limited to the LAN subnet.

### 4. Audit logging design

- Single `audit_events` table (above). Written by an `AuditService.record(action, entity, entity_id, before, after, patient_id)` called from services inside the request transaction; request context (user, IP, request_id) injected via a contextvar set by middleware.
- **Event set:** auth (login ok/fail/lock/logout, password change/reset), user/role/permission changes, patient create/update (field-level diff of changed fields only)/archive, photo set, appointment changes, encounter create/sign/view, case open/status change, session logged/amended, payment recorded/voided, receipt printed/reprinted, settings change, backup/restore/integrity-check, migration applied, data import.
- **Tamper resistance:** application DB role has only `INSERT, SELECT` on `audit_events` (no UPDATE/DELETE/TRUNCATE); plus a trigger raising on UPDATE/DELETE. Optional hash chain column (`prev_hash`, `row_hash`) giving real "tamper-evident" claim cheaply; `integrity:run` verifies the chain. (v2.0 only claimed this in a docstring; nothing enforced it.)
- Use two DB roles: `kalyan_owner` (migrations only) and `kalyan_app` (runtime, least privilege). Runtime role cannot DROP/ALTER.
- Redact: never log passwords, tokens; photo content never; large free-text stored as diff only for changed fields.
- Admin UI: filter by user, patient, action, date; export CSV. Retention: keep forever (volume is tiny); partition not needed.

### 5. Photo and document storage

- Directory `D:\kalyan\data\photos\` outside the SPA/static root, readable only by the service account (NTFS ACL). Not served by Caddy/StaticFiles.
- Path layout: `photos/<yyyy>/<uuid4>.jpg`; DB row `patient_photos` holds the key, sha256, size. No user-supplied filenames, no URN in filename (v2.0 used `<URN>.<ext>`, which overwrote history and leaks identity in the path).
- Upload endpoint: multipart, size cap (e.g. 5 MB), sniff magic bytes (JPEG/PNG), decode with Pillow to re-encode/strip EXIF and resize to max e.g. 1024 px, write to temp then `os.replace` (atomic), insert row in the same request; delete orphan file if the DB commit fails (and a nightly orphan sweep in the integrity check).
- Download: `GET /patients/{id}/photo` (and `/photo/thumb`) behind `photo:read` + record-level visibility; `Cache-Control: private`, ETag from sha256. Browser webcam capture via `getUserMedia` works only in a secure context: `https://` or `localhost`. This is a hard reason to do HTTPS on the LAN (the v2.0 app had a webcam dialog; if reception expects camera capture in the browser, plain `http://192.168.x.x` will not allow it).
- Other documents (scanned reports) use the same mechanism with a `documents` table (patient_id, kind, storage_key, sha256); add only if in requirements.

### 6. Concurrency

| Concern | v2.0 problem | v3.0 solution |
|---------|--------------|---------------|
| **URN under concurrency** | Counter incremented in its own txn; patient INSERT separate → gaps, and two writers rely on SQLite file lock | In the registration txn: `INSERT INTO urn_sequences(year,last_seq) VALUES (:y,1) ON CONFLICT (year) DO UPDATE SET last_seq = urn_sequences.last_seq + 1 RETURNING last_seq`. Row lock held until commit → strictly serial, gapless on rollback, no PG SEQUENCE (sequences are not rollback-safe and can't reset yearly cleanly). `patients.urn` UNIQUE as backstop. Year rollover is automatic (new row). Use hospital-local (IST) year, not UTC year, to avoid 31-Dec-evening bugs. 4 digits overflow at 9999/yr: widen format (`{:04d}` just grows) and test. |
| **Two PCs editing one patient** | Last-write-wins silently | Optimistic locking: `row_version` returned on read; `PATCH` sends `If-Match`/`version`; `UPDATE ... WHERE id=:id AND row_version=:v` → 0 rows = HTTP 409 with a "someone else changed this, reload" UX showing the newer values. Partial PATCH (only changed fields) reduces collisions. |
| **Payment races / overpayment** | `get_total_paid` then insert: two PCs can each pass the check and overpay | In the payment txn: `SELECT ... FROM treatment_cases WHERE id=:c FOR UPDATE` (serialises all payments on that case), re-sum payments, enforce `paid + amount <= total` (or the chosen overpayment policy), insert, commit. Plus **idempotency key** (`Idempotency-Key` header stored in `payments.client_request_id` UNIQUE) so double-click/retry on slow LAN can't post twice. Receipt number allocated in same txn. |
| **Session numbering** | `next = MAX+1` read-then-insert | Lock the case row `FOR UPDATE` (same lock), compute next, insert; `UNIQUE(case_id, session_number)` as backstop. |
| **Case fee changed while paying** | n/a | Fee edits take the same case row lock; fee cannot be reduced below paid-to-date. |
| **Appointment double-booking** | n/a | Exclusion constraint or unique `(doctor_id, scheduled_at)` plus 409. |
| **Isolation level** | n/a | Default READ COMMITTED + explicit row locks above is enough; avoid SERIALIZABLE retries complexity. |
| **Connection pool** | one conn per call | SQLAlchemy pool size ~10; with <=10 concurrent users that is ample. Single uvicorn process (or 2 workers) avoids in-memory state issues (rate limiter must be DB-backed or per-process-tolerant). |
| **Backup during writes** | hot backup | `pg_dump` is snapshot-consistent (MVCC); photos copied after the dump (orphan files harmless, missing files not) — see backup. |

### 7. Frontend layout

- **Single Vite SPA**, React Router v6 data router:

```
/login
/                      → redirect by role (ADMIN→/admin, RECEPTION→/reception, DOCTOR→/doctor)
/admin/*               <RequireRole roles=[ADMIN]>   users, doctors, settings, audit, backup, integrity, reports
/reception/*           <RequireRole roles=[RECEPTION, ADMIN]>  patients, register, appointments, billing
/doctor/*              <RequireRole roles=[DOCTOR, ADMIN]>     my-day, patients, encounters, cases/sessions
/403  /404  /session-expired
```
- **Route guards are UX only.** `RequireAuth` (calls `/auth/me`, redirects to `/login`), `RequirePermission perm="payment:create"` hides buttons/routes. Any 401 from the API clears auth state and redirects; any 403 shows a "not allowed" panel. Every guard has a matching server check; API tests assert 403 for each wrong role independent of the UI.
- Code-split per role (`React.lazy`) so reception PCs don't download admin/doctor bundles.
- **Shared components:** `DataTable` (server-side pagination/search), `PatientSearchBox` (debounced, URN/name/mobile), `PatientHeader` (photo, URN, balance chip), `MoneyInput` (rupee text → integer paise, never float), `MoneyText` (Indian grouping, port `format_inr`), `FormField` w/ react-hook-form + zod, `PhotoCapture` (webcam + file), `ConfirmDialog`, `Toast`, `ConflictDialog` (409 handling), `PrintSheet` (A4 CSS `@media print`; registration card with dual-signature layout, receipt).
- **Server state:** TanStack Query; mutations invalidate keys; global error boundary maps problem+json to toasts. Forms keep `row_version`.
- **Client generation:** `@hey-api/openapi-ts` (or `openapi-typescript`) from `backend` `/openapi.json` → `src/api/`. Script `npm run gen:api` exports spec via `python -m app.cli export-openapi` (no running server needed). Commit generated files; CI check `git diff --exit-code`.
- **Printing:** browser print of dedicated routes (`/print/registration/:id`) with `@page { size: A4 }`; avoids server-side PDF dependencies. Hindi text needs a bundled font (Noto Sans Devanagari) shipped locally; NO Google Fonts/CDN anywhere (offline). This is an easy-to-miss offline defect.
- **Time/locale:** all dates rendered in Asia/Kolkata; `en-IN` number format.

### 8. Deployment topology on the LAN

- One Windows PC with a **static IP** (DHCP reservation on the router) and a friendly hostname; clients bookmark `https://kalyan-server`. Local name resolution without internet: router DNS entry or `hosts` file on the 3-5 client PCs (document in install guide).
- Services (installed once by `install.ps1`, run as non-admin service account):
  - PostgreSQL 16 (official Windows installer or zipped binaries), listens on 127.0.0.1:5432, data dir on a drive with space and, ideally, a second physical disk for backups.
  - Kalyan API: `uvicorn app.main:app` wrapped as Windows service via **WinSW** or NSSM (auto-start, restart on failure), logs to `D:\kalyan\logs` with rotation.
  - Caddy (optional): HTTPS + static files + `/api` reverse proxy. If skipped, uvicorn serves `dist/` through `StaticFiles` and terminates TLS itself (`--ssl-keyfile/--ssl-certfile`); fewer moving parts, slightly less robust. Recommendation: skip Caddy for v1; add only if TLS cert handling is painful.
  - Windows Task Scheduler: nightly backup 02:00, weekly verify-restore-to-temp-DB, integrity check.
- **Python on server:** use an embedded/portable Python + wheelhouse built on the dev machine (`pip download`), installed offline; PROJECT.md already says Node only on the build machine. No pip over internet at the hospital.
- Windows Firewall: inbound 443 only, LAN scope. PostgreSQL port closed externally.
- **Power-loss reality:** small-town hospital; require a UPS on the server (hardware advice for client), set PG `fsync=on` (default), `synchronous_commit=on`. Services auto-start after power returns; test it. This is the single most likely real-world failure.
- Resource sizing: <10 concurrent users; 4 GB RAM / any modern dual-core handles it; data volume is megabytes per year plus photos (~200 KB each).
- Single point of failure acknowledged: when the server is down, the hospital cannot register patients. Mitigation = fast restore procedure and a printed paper fallback (the existing pad form), not clustering (out of budget).
- Dev/test/prod: Docker is NOT assumed (Windows Home server PCs often cannot run it, and it adds failure modes). Develop with local PG; the same `install.ps1` runs in a clean Windows VM for the pre-handover rehearsal.

### 9. Backup and restore design

Port of v2.0's verified pipeline to Postgres:

- **Bundle** `kalyan_backup_<ts>.kbak` (zip, no recompress of JPEGs needed): `db.dump` (`pg_dump -Fc`), `photos/` (all current files, relative keys), `manifest.json` {app version, alembic revision, created_at, row counts per core table, photo count, sha256 of each file}, `SHA256SUMS`.
- **Consistency:** start `pg_dump` first, then copy photos (photo rows referenced by dump will exist as files; extra files are orphans, harmless). Alternative for strict consistency: run inside `REPEATABLE READ` read-only txn and snapshot the photo list from the same txn. The simple ordering is sufficient here.
- **Verify (backup time and on demand):** zip test, checksums, `pg_restore --list` parses, then (weekly) **actual restore into scratch DB `kalyan_verify`** and compare manifest counts + run integrity checks. A backup that has never been restored is not a backup (matches PROJECT.md "proven to restore").
- **Destinations (3-2-1 lite):** local `D:\kalyan\backups` (retain 14 daily, 8 weekly, 12 monthly) + copy to external USB drive / second PC share + manual monthly off-site (client takes drive home). Admin UI shows "last successful backup, last verified restore" and warns red when >48 h old.
- **Restore flow (CLI first, admin UI wrapper):** (1) verify bundle; (2) take safety bundle of current state; (3) stop API service (maintenance flag, reject writes); (4) drop/recreate DB and `pg_restore`; (5) swap photo dir (extract to new dir, rename) ; (6) `alembic upgrade head` if bundle revision is older (refuse if newer than code); (7) post-verify counts + integrity; auto-rollback to safety bundle on failure; (8) restart, audit event, force all sessions invalid. Restore requires re-entering admin password (as v2.0 `verify_admin_credentials`) and an explicit typed confirmation.
- **Disaster test (handover acceptance):** restore a bundle on a different clean Windows machine with the installer, log in, open a patient with photo and payments, balances match manifest.
- Backup credentials: dedicated PG role `kalyan_backup` (read-only), `.pgpass`/env stored with NTFS ACL. Backups contain patient data → encrypt the off-site copy (7-Zip AES or `age`) with a passphrase the owner keeps.

### 10. Migration path from existing SQLite to PostgreSQL

The reference app may hold only demo/synthetic data (PROJECT.md: 100% synthetic during development). Decide in requirements whether any real hospital data exists; if not, migration reduces to a seed script, and the effort here shrinks to ~1 day. If real data exists:

1. Freeze v2.0, take its `.kalyan_bak` backup (this is the input artifact and also the rollback).
2. `kalyan import-sqlite <bundle>` CLI (Python, reads SQLite read-only, writes PG in one transaction, idempotent via `legacy_id` columns or run-once guard):
   - Order: doctors → users → patients → treatment_cases → treatment_sessions → payments → audit_logs → photos.
   - Preserve **URNs verbatim**, and rebuild `urn_sequences` as `max(seq)` per year; preserve session numbers; preserve `id`s where convenient (then `setval`/identity restart) so references stay trivial.
   - Timestamps: SQLite `datetime('now','localtime')` strings are naive local → interpret as Asia/Kolkata → store `timestamptz`.
   - Money already in paise → copy as-is; assert `total_paid <= total` and list violations (v2.0 allowed overpayment).
   - Users: cannot reuse PBKDF2 hashes (different algorithm/format); import accounts inactive-pending-reset with `must_change_password`; map role RECEPTIONIST→RECEPTION; DOCTOR users need a `doctor_id` assignment by admin.
   - Photos: copy `<URN>.ext` files into the new store with uuid keys; create `patient_photos` rows; sha256 computed; missing files reported.
   - Audit logs: import into `audit_events` with `action`/`entity_type` as-is, `username_snapshot = actor_name`, `before/after` null; mark `source='legacy'`. Hash chain starts after the import row.
   - Free-text enums normalised (sex capitalisation, status).
3. **Reconciliation report:** row counts per table, sum of fees and payments per patient, photo count, URN max per year, orphan/dup checks; must match before cutover; store report in repo/handover docs.
4. Dry-run on a copy first, at least twice; time it (should be seconds).
5. Cutover: stop v2.0 (retire the PC's app), import, verify with reception staff, then keep SQLite bundle archived read-only for 12 months.

## Anti-Patterns

### Anti-Pattern 1: Trusting the role-routed UI

**What people do:** Hide `/admin` links and assume protected.
**Why it's wrong:** Anyone on the LAN can call the API with curl/devtools; the requirement is explicit that hiding screens is not security.
**Do this instead:** Permission dependency on every route, route-walk test, and a parametrised role × endpoint test that asserts 401/403.

### Anti-Pattern 2: Read-check-then-write on shared state

**What people do:** Port `get_total_paid_paise` → compare → insert, and `MAX(session_number)+1`, unchanged.
**Why it's wrong:** v2.0 was single-PC so it was safe; with two PCs it double-pays and duplicates numbers.
**Do this instead:** Row-level locks (`FOR UPDATE`) on the case, DB unique constraints, idempotency keys.

### Anti-Pattern 3: Mixing stacks / copying the old code

**What people do:** Import `app/` services (SQLite `sqlite3`, `PHOTOS_DIR`) into FastAPI to save time.
**Why it's wrong:** Violates the approved "never mixed" decision; v2.0 services take a `db_path`, return dicts, and put audit in separate connections (not transactional).
**Do this instead:** Port rules and unit-test cases (fixtures from v2.0 tests) into new services; reuse only pure functions (`rupees_to_paise`, `format_inr`, mobile normalisation) by re-writing them with tests copied over.

### Anti-Pattern 4: Mutable money and history

**What people do:** Store `balance` on the case, edit/delete payments and sessions to "fix" mistakes.
**Why it's wrong:** Destroys the audit story and causes drift.
**Do this instead:** Balance derived; payments voided not deleted; sessions amended by addenda; DB triggers back this up.

### Anti-Pattern 5: Internet dependencies hiding in the frontend

**What people do:** Google Fonts, CDN scripts, map/analytics, `npm` at install time.
**Why it's wrong:** The hospital has no internet; Devanagari text and the UI silently break.
**Do this instead:** Vendor all fonts/assets in `dist/`; test with the network adapter disabled.

### Anti-Pattern 6: Single-process state and fat sessions

**What people do:** In-memory sessions or rate-limit counters; multiple uvicorn workers.
**Why it's wrong:** Logins vanish on restart/worker change.
**Do this instead:** Sessions and lockout counters in PostgreSQL.

### Anti-Pattern 7: Over-engineering for the budget

**What people do:** Docker/Kubernetes, microservices, Redis, Celery, fine-grained ABAC.
**Why it's wrong:** ₹22,000 / 4-6 weeks / one server PC / non-technical operators.
**Do this instead:** Modular monolith, one DB, role-default permissions with an optional override table.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| This hospital (<=15 users, ~100 registrations/day) | Single uvicorn process, one PG, local disk. Everything above. |
| 2-3 clinics over a VPN | Same server, add HTTPS + VPN (explicitly out of scope now); `clinic_id` columns make it possible later. |
| Larger hospital | PG tuning, read replica, object storage; not relevant. |

### Scaling Priorities

1. **First bottleneck:** patient name search with `LIKE '%x%'` → fixed by `pg_trgm` GIN index from day one.
2. **Second bottleneck:** photo/backup size on disk → cap and re-encode photos at upload; monitor free disk in integrity check.
3. **Realistic risk is operational, not scale:** disk full, power loss, forgotten backups, lost admin password. Design the health screen around those.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| (none at runtime) | Offline by requirement | No SMS/WhatsApp, no cloud, no telemetry, no CDN |
| Webcam / printer | Browser APIs (`getUserMedia`, `window.print`) | Webcam needs a secure context → HTTPS on LAN; printers are client-PC OS printers |
| Windows Task Scheduler / Services | Backup schedule, service supervision | Via install script |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| SPA ↔ API | JSON over HTTPS, cookie session, OpenAPI contract | Generated client; breaking API change = regenerate = compile errors in TS |
| Router ↔ Service | Python calls with Pydantic/domain objects | Routers never touch the DB session directly |
| Service ↔ Repository | Python calls, same SQLAlchemy session | Service owns commit boundary |
| Service ↔ Audit | In-transaction call | Fails with the business write |
| API ↔ Photo store | `PhotoService` only | Only module that touches the photo path |
| CLI ↔ DB | Same services where possible | Backup/restore/import work with API stopped |

## Suggested Build Order (phases and dependencies)

Timeline fit: 4-6 weeks. Phases 1-3 are the critical path; 4-7 can overlap once 3 exists (reception and doctor frontends can proceed in parallel on the same API).

| # | Phase | Delivers | Depends on | Est. |
|---|-------|----------|------------|------|
| 0 | Decisions & environment | Confirm server hardware/UPS/LAN, HTTPS yes/no, permission matrix & doctor-visibility rule sign-off, overpayment policy, consultation-charge model, real-data-or-demo for migration; dev tooling (Python, Node on build machine, PG) | - | 2 d |
| 1 | Foundation | Repo layout, config, Alembic baseline (all core tables, triggers, roles), SQLAlchemy models, pytest harness with real PG, `create-admin` CLI, health endpoint | 0 | 4 d |
| 2 | Auth & authorization | Users, argon2, server sessions, CSRF, lockout, `permissions.py`, `require()`, route-walk test, `/auth/me`, user management API | 1 | 4 d |
| 3 | Audit core | `AuditService`, contextvar middleware, append-only role/trigger, hash chain, audit read API | 1, 2 | 2 d |
| 4 | Patients & photos | URN allocation (concurrency tests), registration/search/update/archive, optimistic locking, photo upload/serve, doctors list | 2, 3 | 5 d |
| 5 | Frontend shell | Vite app, generated client, login, guards, role layouts, shared components, print CSS base, fonts vendored | 2 (API contract; can start earlier on mocked OpenAPI) | 4 d (parallel with 4) |
| 6 | Reception module | Registration form (12 fields, dual-signature print), search/profile edit/photo capture, appointments, doctor assignment | 4, 5 | 5 d |
| 7 | Clinical module | Encounters, notes, prescriptions, treatment cases/plans, sessions (append-only, VAS), history timeline | 4, 5 | 5 d |
| 8 | Billing | Charges, payments with locking & idempotency, receipts, balances, packages, void flow, reports | 4, 7 (cases) | 4 d |
| 9 | Admin module | Users/permissions UI, doctor profiles, settings, audit viewer, reports | 2, 3, 5 | 3 d |
| 10 | Backup/restore & integrity | Bundle creator, verify, scheduled task, restore CLI + UI, integrity checks, weekly restore test | 1 (can start early); full data from 4-8 | 4 d |
| 11 | SQLite import (only if real data) | `import-sqlite` CLI + reconciliation report | 4, 7, 8 | 2 d |
| 12 | Deployment & hardening | Offline installer script, services, firewall, HTTPS, auto-start after power loss test, clean-VM rehearsal | all | 4 d |
| 13 | Acceptance testing & handover | Two-PC concurrency test, LAN-only (no internet) test, permission matrix test, restore on clean machine, training, runbook | 12 | 3 d |

Critical path: 0 → 1 → 2 → 3 → 4 → (6, 7) → 8 → 12 → 13. Backup (10) and admin UI (9) float. If time slips, cut order (least harm first): prescriptions/appointments extras, reports, permission overrides table, hash chain, Caddy.

## Open questions to resolve before / during Phase 0

1. Do real hospital records exist in the v2.0 SQLite (drives phase 11)?
2. Overpayment: reject (matches PROJECT.md claim) or allow-and-flag (matches v2.0 code)?
3. Does a consultation charge exist separately from treatment-case fees? (not modelled in v2.0)
4. Doctor visibility: all patients vs assigned only; may reception see diagnosis?
5. HTTPS acceptable (needed for browser webcam)? Is Wi-Fi shared with patients?
6. Server hardware: RAM, disk, UPS, second drive/USB for backups, Windows edition?
7. Are appointments a booking calendar or a simple "visit today" queue? (Large scope difference.)

## Sources

- Reference code read directly: `D:\dr-sr\app\db\schema.sql`, `app\services\{auth,billing,patient,treatment,backup,audit}_service.py`, `app\repositories\{patient,payment}_repository.py`, `.planning\PROJECT.md`
- PostgreSQL docs: `INSERT ... ON CONFLICT DO UPDATE`, `SELECT ... FOR UPDATE`, `pg_dump -Fc`/`pg_restore`, `pg_trgm`, exclusion constraints, GRANT/REVOKE
- FastAPI docs: dependencies, security, OpenAPI `generate_unique_id_function`; SQLAlchemy 2.x; Alembic naming conventions
- OWASP ASVS / Session Management and Password Storage cheat sheets (argon2id, server-side sessions, CSRF)
- MDN: `getUserMedia` secure-context requirement
- Not verified in this session (no web access used): current minor versions of FastAPI/SQLAlchemy/PostgreSQL, WinSW vs NSSM maintenance status, openapi-ts package naming. Verify at install time.

---
*Architecture research for: offline LAN hospital management web platform (Kalyan Hospital v3.0)*
*Researched: 2026-10-30*
