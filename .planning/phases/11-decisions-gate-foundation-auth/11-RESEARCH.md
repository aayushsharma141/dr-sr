# Phase 11: Decisions Gate, Foundation & Auth - Research

**Researched:** 2026-10-30
**Domain:** FastAPI + PostgreSQL + React/TypeScript foundation for a Windows LAN hospital system: server-side session auth over plain HTTP, default-deny RBAC, optimistic concurrency (409), append-only transactional audit, Alembic baseline, Windows toolchain bootstrap
**Confidence:** HIGH for pinned versions, FastAPI 0.162.0 behaviour, PostgreSQL facts and auth/concurrency patterns (registry, official docs and throw-away-venv experiments, all 2026-10-30); MEDIUM for the frontend toolchain (Node is not installed here, so `npm install`/`vite build`/`vitest` were NOT executed) and for client decisions that are still unconfirmed.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Phase boundary (CONTEXT `<domain>`):** Phase 11 delivers the authoritative entry gate resolution, repo scaffolding for the PostgreSQL + FastAPI backend, Alembic database migrations, RBAC role-routed authentication (`/admin`, `/reception`, `/doctor`), session security controls (rate-limiting, lockout, 409 optimistic locking), and the canonical transactional audit-event writer (`AUD-01`).

**1. Server Hardware, UPS & Network Security**
- **D-01:** Workstations access central server via plain HTTP on a dedicated, isolated private hospital subnet (e.g., `http://192.168.1.50:8000`). This eliminates self-signed SSL certificate installation overhead and browser warnings on staff machines across the offline clinic LAN.
- **D-02:** The central server PC must be protected by a dedicated 600VA+ line-interactive UPS. PostgreSQL write transactions will run with `synchronous_commit = on` to ensure complete data integrity against sudden Bhojpur grid power failures. — **Reversibility:** costly — changing database durability config affects all subsequent write pipelines.

**2. Access Control & Cross-Doctor Visibility**
- **D-03:** Strict Silo Doctor Partitioning: Doctors can only view, search, and access patients and clinical encounters assigned directly to their `doctor_id`. A doctor cannot access another doctor's clinical records. — **Reversibility:** one-way — database query filters and RBAC scopes enforce doctor-siloed data partitioning across all future clinical tables.
- **D-04:** Strict Default-Deny on Reception Access: Reception staff accounts can access patient demographics, appointments, and billing/dues. The FastAPI backend strictly blocks reception role from reading or writing clinical SOAP notes, prescriptions, and physiotherapy session logs (`SEC-02`).

**3. Receipt Numbering & Reversal Rules**
- **D-05:** Receipt Numbering Sequence Cycle is made configurable in the Admin Panel (`SET-01`). The system supports Indian Financial Year (`RCPT-2627-XXXX`, 1 Apr – 31 Mar) and Calendar Year (`RCPT-2026-XXXX`), defaulting to Indian Financial Year to satisfy Sri Vashishtha Kalyan Trust accounting compliance. — **Reversibility:** costly — affects sequence generators in billing.
- **D-06:** Reversals and refunds are strictly restricted to the Admin role only. Every reversal requires a mandatory reason, writes a contra-record in the billing ledger, and emits an immutable event to `audit_logs` (`AUD-01`). Reception staff cannot void receipts.

**4. Session Lifecycle & Concurrency Controls**
- **D-07:** Inactivity session expiration is set to 30 minutes. Account lockout triggers after 5 consecutive failed login attempts, applying a 15-minute cooldown period unless unlocked sooner by an Administrator (`SEC-04`).
- **D-08:** Concurrency conflict resolution (`SEC-06`): Every mutable entity carries a `version_id`. Stale updates return HTTP 409 Conflict. The client interface displays a clear warning: *"Record was modified by another user"* and provides a 1-click reload to re-fetch the latest state without silent data overwrites.

**Specific Ideas (CONTEXT `<specifics>`):**
- The admin dashboard must expose the sequence format toggle (Financial Year vs Calendar Year) under clinic settings.
- First boot of the web platform prompts the first-run admin initialization wizard (`SEC-05`) with zero hardcoded default credentials in the repository.

**Established patterns (CONTEXT `<code_context>`):**
- `app/db/schema.sql` (v2.0): Canonical tables and columns (patients, treatment_cases, treatment_sessions, payments, doctors, audit_logs) provide the domain model for SQLAlchemy 2.0 models and Alembic migrations.
- `app/services/audit_service.py`: Standard audit action schema (`action`, `actor`, `entity_type`, `entity_id`, `details`, `timestamp`) serves as the foundation for the async `AUD-01` writer in FastAPI.
- Integer-paise financial calculations (`amount_paise INTEGER`) must be preserved in PostgreSQL schemas.
- Explicit `try...finally` resource closure and database transaction management.

### Claude's Discretion
- Scaffolding folder structure for FastAPI (`backend/app/...`) and Alembic migrations.
- JWT / HTTP-only cookie session token storage mechanism for web browser clients.
- Rate-limiting threshold implementation on `/auth/login` endpoint.

### Deferred Ideas (OUT OF SCOPE)
- Multi-doctor cross-case sharing (if the clinic later requests co-managing complex cases) will be considered in a post-v3.0 update.
- HTTPS local cert distribution utility deferred unless hospital network topology changes.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SEC-01 | Staff member signs in with an individual account and lands on the dashboard for their role (`/admin`, `/reception` or `/doctor`) of one React + TypeScript app. | Opaque server-side session in an HttpOnly cookie (Pattern 3); `GET /api/auth/me` returns role + permissions; React Router data mode with `RequireRole` layout routes (Frontend section); per-area `dashboard:*` permission and `GET /api/<area>/overview` endpoints so the "type the URL / call the API directly" criterion is testable (Pattern 1, Role matrix). |
| SEC-02 | Every API endpoint enforces permissions on the server independently of the UI, and an automated test fails if any route lacks a permission check. | Policy-marker dependencies + route-walk test built on the public `fastapi.routing.iter_route_contexts` (Pattern 1, Code Example CE-1). **Critical:** the classic `for r in app.routes: isinstance(r, APIRoute)` walk is vacuous on FastAPI 0.162.0 (Pitfall 1). |
| SEC-03 | Three roles (Admin, Reception, Doctor) with a fixed permission catalogue. | Code-defined `Permission`/`Role` enums + `ROLE_PERMISSIONS`, golden-snapshot test, DB CHECK on `users.role`, "no orphan permission" test (Pattern 1, Entry-Gate matrix). |
| SEC-04 | Session expires after an idle timeout, and an account is locked after repeated failed logins. | 30-min sliding idle (D-07) with 60 s touch throttle + 12 h absolute limit; 5 failures -> 15-min lock with admin unlock; DB-backed per-IP throttle (Pattern 3, Pattern 4); Python clock seam for deterministic tests (Pitfall 4). |
| SEC-05 | Admin creates, deactivates (never deletes) and resets passwords for users; first login forces a password change; no default credentials ship. | `must_change_password` restricted-session design, admin endpoints, `REVOKE DELETE ON users`, first-run CLI `create-admin` with no default credentials (Pattern 4, Code Example CE-5, Security Domain). |
| SEC-06 | Concurrent edits are safe: stale updates are rejected with a conflict response rather than overwriting. | `version_id` column + SQLAlchemy `version_id_col` PLUS explicit client-version comparison (the ORM alone does NOT catch stale client edits - verified), `StaleDataError`/`VersionConflict` -> 409, two-session race tests on PostgreSQL (Pattern 6, CE-3). |
| AUD-01 | Security, patient, clinical, billing and backup events are written to an append-only audit log. | `audit_logs` schema, in-transaction writer, BEFORE UPDATE/DELETE/TRUNCATE triggers + INSERT/SELECT-only runtime role, event list for Phase 11, no hash chain (Pattern 7, CE-4). |
</phase_requirements>

## Project Constraints (from GEMINI.md)

`D:\dr-sr\GEMINI.md` is the generic GSD Antigravity context file; it carries no project-specific technical constraints. The actionable directives it does contain (treated with CONTEXT.md authority):
- Treat `.planning/` as the source of truth; read it before acting and keep it current. [VERIFIED: D:\dr-sr\GEMINI.md:48-49 "Treat `.planning/` as the source of truth for project state — read it before acting, and keep it current as work progresses."]
- Prefer the smallest change that satisfies the phase's verification criteria. [VERIFIED: D:\dr-sr\GEMINI.md:50]
- Run the project's tests and linters before declaring a phase done. [VERIFIED: D:\dr-sr\GEMINI.md:51]
- Small, atomic, test-backed commits; durable context in version-tracked files (GEMINI.md:18-19).

**Project skills (`D:\dr-sr\.agents\skills\`) - applicability to Phase 11:**

| Skill | Applied? | How |
|-------|----------|-----|
| `healthcare-emr-hms` | Partly | Audit field list (`timestamp`, `user_id`, `action`, `ip_or_terminal`, `reason`; patient URN added when patients exist in Phase 12), "never silently update clinical records" philosophy. Its SQLite-sequence/UHID and paise helper code is NOT used (Phase 12/15, and the `parse_inr_to_paise` float example violates BIL-02). |
| `python-pytest-excellence` | Partly | Per-test isolated database principle and the coverage gate `pytest --cov=app --cov-report=term-missing --cov-fail-under=85` (applied to `kalyan_api`). NOT applied: `pytest-qt`/PySide6 patterns, in-memory SQLite fixtures (there is no SQLite fallback in v3.0). |
| `ui-ux-pro-max` | Partly | Accessibility/forms guidance for the login, forced-password-change, user-admin and 409 UI (visible labels, error text next to the field, 44 px targets, focus rings, `role="alert"`, no emoji icons). NOT applied: its `typography` domain emits Google Fonts imports (forbidden - fully offline, no CDN); its `--design-system --persist` output is not needed for this small UI. |
| `pyside6-qt-desktop`, `sqlite-offline-database`, `pyinstaller-windows-build` | **No** | Belong to the superseded v2.0 desktop architecture (PROJECT.md: "PySide6 + SQLite ... Superseded for v3.0; kept as reference only"). |
| `abdm-india-compliance` | **No** | ABDM/FHIR is out of scope for v3.0 (REQUIREMENTS.md Out of Scope: "ICD/FHIR/ABDM, insurance, GST invoicing"). |
| `medical-pdf-reporting` | No (not for Phase 11) | Printing is the Phase 12 spike / Phase 17 sign-off, not this phase. |

## Summary

Phase 11 is the only phase whose mistakes are expensive to unwind (D-03 is "one-way", D-02 "costly"), so the research concentrated on the places where a plausible-looking implementation silently fails. Eight findings change what the planner should write, several of them discovered by running the pinned stack in a throw-away venv (Python 3.12.10, win_amd64, wheels only) rather than reading docs:

1. **The standard "walk `app.routes`" authorization test passes vacuously on FastAPI 0.162.0.** `include_router` now yields a single lazy `_IncludedRouter` entry in `app.routes`; an `isinstance(route, APIRoute)` loop sees zero routes. The supported enumeration API is `fastapi.routing.iter_route_contexts(app.routes)` (it flattens included routers and merges router-level dependencies). The test must also assert a non-empty "must exist" route set (CE-1). [VERIFIED: experiment]
2. **`Depends(get_session)` with the default scope commits AFTER the response is sent**, so a failed commit (stale version, audit insert failure) would still return 200. Use `Depends(get_session, scope="function")`: a failure in the teardown then becomes a real 409/500 (experiment: teardown `HTTPException(409)` -> client received 409 with `scope="function"`, 200 with the default). [VERIFIED: experiment + CITED FastAPI docs]
3. **SQLAlchemy `version_id_col` alone does not implement SEC-06.** It guards the server-side read-modify-write window only (UPDATE ... WHERE version_id = loaded value); a client holding a stale form still overwrites. The service must compare the client's `version_id` to the loaded one, and must never assign `version_id` from client input (assigning it re-writes the counter backwards). [VERIFIED: experiment on SQLAlchemy 2.0.55]
4. **Pin SQLAlchemy 2.0.55, not 2.1.6**; use **sync** SQLAlchemy + psycopg 3. psycopg async is documented as incompatible with the default Windows ProactorEventLoop, Argon2 is CPU-bound, and 3-5 users need no async. This is compatible with every locked decision; the CONTEXT phrase "async AUD-01 writer" is descriptive text in `<code_context>`, not a decision, and an asynchronous (deferred) writer would contradict the same-transaction requirement.
5. **Plain HTTP (D-01) removes more than the `Secure` flag**: no `__Host-` cookie prefix, no `Sec-Fetch-*` headers (browsers send them only to trustworthy origins), and no secure-context APIs (`crypto.subtle`, `crypto.randomUUID`, `getUserMedia`, clipboard, service workers) at `http://192.168.x.x`. CSRF therefore rests on SameSite=Strict + a session-bound `X-CSRF-Token` header + an Origin==Host check. Chrome 154's HTTPS-by-default warning explicitly excludes private IPs and single-label hostnames, so D-01 is not hit by it.
6. **Frontend toolchain**: the official `create-vite` react-ts template now pins `typescript ~7.0.2` and `oxlint`; `typescript-eslint@8.72.1` peers `typescript >=4.8.4 <6.1.0` and `openapi-typescript@7.13.0` peers `^5.x`, so they cannot be used with TS 7. Follow the template (TS 7.0.2 + oxlint, hand-written API client). The effective Node floor of the pinned set is **22.22.2** (jsdom 30.1.3), not Vite's 20.19; install **Node 24.22.1** (`winget` `OpenJS.NodeJS.LTS --version 24.22.1`).
7. **PostgreSQL**: current minor is **18.6** (18.5 was never released; EOL 2030-11-14); winget `PostgreSQL.PostgreSQL.18` **18.6-5** is the EDB installer. The earlier "18.3 vs 18.6" conflict is resolved. Create databases explicitly with `TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER builtin BUILTIN_LOCALE 'C.UTF-8'` (documented; Windows allows UTF-8 with any locale) and verify on first install.
8. **Layout**: name the new Python package `kalyan_api` (not `app`): the legacy `D:\dr-sr\app` package, the root `pyrightconfig.json`, and `python -m pytest` with cwd = repo root would all resolve `import app` to the legacy code. pytest config discovery was tested: `backend/pyproject.toml` wins for paths under `backend/`, bare `pytest` at the root still runs only the legacy `tests/`; collecting both suites in one session fails on duplicate basenames.

**Primary recommendation:** Build Phase 11 as `backend/src/kalyan_api` (sync FastAPI 0.162.0 + SQLAlchemy 2.0.55 + psycopg 3.3.6, Starlette 1.10.0 pinned explicitly) and `frontend/` (Vite 8.3.5, React 19.3.1, React Router 8.5.1 data mode, TanStack Query 5.105.0, TypeScript ~7.0.2, oxlint, Vitest 5.0.5) after a Wave 0 that records the entry-gate register and installs PostgreSQL 18.6-5 and Node 24.22.1 behind human-action checkpoints; enforce SEC-02 with exactly-one-policy-marker-per-route plus the `iter_route_contexts` test, SEC-06 with `version_id` + explicit compare, and AUD-01 with an in-transaction writer backed by triggers and an INSERT-only runtime role.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Authentication (password check, lockout, throttle) | API / Backend | Database / Storage | Argon2id verification and counters must be server-side; counters live in PostgreSQL rows so they survive restarts and are atomic. |
| Session lifecycle (create, idle/absolute expiry, revoke) | API / Backend | Database / Storage | Opaque token hash in `sessions`; instant revocation on deactivate/password change; browser only holds an HttpOnly cookie. |
| Authorization (permission check, default-deny) | API / Backend | - | SEC-02: the only security boundary. UI guards are convenience (PROJECT.md: "hiding screens is not security"). |
| Row-level scope (D-03 doctor silo, D-04 reception block) | API / Backend | Database / Storage | SQL `WHERE` predicates built by shared helpers; later phases reuse them. DB-level partitioning is not attempted. |
| Route/role guards and landing redirect | Browser / Client | API / Backend | UX only; every guard has a server check behind it. |
| Optimistic concurrency (409) | Database / Storage | API / Backend | `version_id` column + UPDATE ... WHERE; API maps to 409; browser shows the reload UX. |
| Audit writing (AUD-01) | API / Backend | Database / Storage | Written in the request transaction; append-only enforced by triggers and role grants in the DB. |
| Schema migrations and revision gate | Database / Storage | API / Backend | Alembic run as an explicit step under the owner role; app only checks the revision at startup. |
| Static SPA delivery | API / Backend (FastAPI `app.frontend`) | CDN / Static (n/a) | Same-origin single process; no CORS; Node not needed on the server. |
| CSRF defence | API / Backend | Browser / Client | Server validates header token + Origin; client stores the token in memory and sends it. |
| Time (IST business dates, session clocks) | API / Backend | Database / Storage | Python clock seam for logic; `timestamptz` storage; `TimeZone=Asia/Kolkata` on connections. |

## Standard Stack

All versions below were read from the live registries on **2026-10-30** (PyPI JSON API, registry.npmjs.org, winget catalogue, postgresql.org). The Python set was additionally dry-run resolved and installed (wheels only, Python 3.12.10 win_amd64) in a throw-away venv: 41 packages, 0 source distributions, all imports succeed. The npm set was **not** installed (Node absent): peer/engine compatibility below was checked by reading each package's registry metadata, not by running npm.

### Core (backend)
| Library | Version (published) | Purpose | Why Standard |
|---------|---------------------|---------|--------------|
| Python | 3.12.10 (installed) ; `requires-python >=3.12,<3.14` | Runtime | Installed on the dev PC; every pin below ships cp312 win_amd64 wheels or `py3-none-any`. |
| FastAPI | **0.162.0** (2026-10-23) | HTTP API, DI, OpenAPI | Required by project. **Pin exactly** - GitHub releases show about 30 releases between 2026-10-18 (0.145.0) and 2026-10-23 (0.162.0), at least nine flagged "Breaking Changes" (0.145, 0.146, 0.147, 0.149, 0.150, 0.151, 0.155, 0.160, 0.162; mostly form/query/header parameter handling, plus 0.151.0: explicit JSON `null` is now distinguished from an omitted field). Our JSON-only usage is largely unaffected, but upgrades must be deliberate [VERIFIED: api.github.com/repos/fastapi/fastapi/releases, 2026-10-30]. |
| Starlette | **1.10.0** (2026-10-24) pinned explicitly | ASGI toolkit | FastAPI 0.162.0 declares only `starlette>=0.46.0` (no upper bound), so the resolver floats; pin the tested version. |
| Pydantic | 2.14.2 (2026-10-29) (+ pydantic-core 2.50.2) | Schemas/validation | `extra="forbid"` request models; FastAPI requires `>=2.9.0`. 1 day old at research time: fall back to 2.14.1 (2026-10-11) if any issue. |
| pydantic-settings | 2.16.2 (2026-10-28) | Typed env config | Documented FastAPI settings approach; pulls python-dotenv 1.2.4. |
| Uvicorn | 0.54.0 (2026-09-25), **no `[standard]` extra** | ASGI server | h11 only; no uvloop/httptools/watchfiles wheels to manage on Windows. Run with `--no-server-header` (verified to drop the `Server` header). |
| SQLAlchemy | **2.0.55** (2026-10-16) | ORM/Core, sync `Session` | 2.1.0 is only 5 weeks old (2026-09-24) with six patch releases in four weeks (2.1.1-2.1.6); 2.0.x is still maintained in parallel (2.0.55 and 2.1.5 were both released on 2026-10-16). Alembic 1.20.1 requires only `SQLAlchemy>=2.0`. |
| Alembic | 1.20.1 (2026-10-22) | Migrations | Standard; `alembic check` available (>=1.9). |
| psycopg | 3.3.6 + `psycopg-binary` 3.3.6 (2026-09-18) | PG driver | URL `postgresql+psycopg://`; binary wheel bundles libpq (`psycopg.pq.version()` = 180004 in the experiment). |
| argon2-cffi | 25.1.0 (2025-06-03) + argon2-cffi-bindings 26.1.0 | Argon2id hashing | `PasswordHasher()` defaults measured: t=3, m=65536 KiB, p=4, hash_len=32, salt_len=16, ~67 ms hash/verify on this dev PC. |
| tzdata | 2026.6 (2026-10-28) | IANA tz data on Windows | psycopg also declares `tzdata; sys_platform == "win32"`. Without it `ZoneInfo("Asia/Kolkata")` raises `ZoneInfoNotFoundError` on this machine's global Python (reproduced). |
| setuptools (build backend) | 84.2.1 (2026-10-20) | Build `pyproject.toml` project / editable install | Ubiquitous; Phase 17 builds a wheel from it. |

### Supporting (backend dev/test)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pytest | 9.2.0 (2026-10-27) | Test runner | All tests. |
| pytest-timeout | 2.4.0 | Kill hung lock/thread tests | Always (`timeout = 60` in ini); concurrency tests can deadlock. |
| pytest-cov | 7.1.0 | Coverage gate | Phase gate (`--cov-fail-under=85`, from the project skill). |
| httpx2 | **2.16.0** (2026-10-21) | Backend for `TestClient` | Starlette 1.10 `TestClient` emits `StarletteDeprecationWarning: Using httpx with starlette.testclient is deprecated; install httpx2 instead` with plain httpx 0.28.1. With only httpx2 installed, `TestClient` ran with warnings-as-errors (verified). FastAPI 0.143.4 added `httpx2` to its optional deps. Fallback: `httpx==0.28.1` + `filterwarnings`. |
| ruff | 0.17.3 (2026-10-27) | Lint | Enable `DTZ` (verified: DTZ005/DTZ003 flag naive `datetime.now()/utcnow()`), `S`, `B`, `UP`, `I`, `E`, `F`. |

Resolved transitive set (verified by dry-run, all wheels): alembic 1.20.1, annotated-doc 0.0.5, annotated-types 0.8.0, anyio 4.15.1, argon2-cffi 25.1.0, argon2-cffi-bindings 26.1.0, cffi 2.1.1, click 8.5.0, colorama 0.4.6, coverage 7.17.0, fastapi 0.162.0, greenlet 3.5.6, h11 0.16.0, httpcore2 2.16.0, httpx2 2.16.0, idna 3.20, iniconfig 2.3.1, Mako 1.4.3, MarkupSafe 3.0.4, **opentelemetry-api 1.45.2** (new hard dependency of FastAPI; inert without an SDK/exporter - do not set `OTEL_*` or `FASTAPI_OTEL_AUTO_CONFIGURE`; it must be in the Phase 17 wheelhouse), packaging 26.3, pluggy 1.7.0, psycopg 3.3.6, psycopg-binary 3.3.6, pycparser 3.12, pydantic 2.14.2, pydantic_core 2.50.2, pydantic-settings 2.16.2, python-dotenv 1.2.4, pytest 9.2.0, pytest-cov 7.1.0, pytest-timeout 2.4.0, ruff 0.17.3, SQLAlchemy 2.0.55, starlette 1.10.0, truststore 0.10.5, typing-inspection 0.4.4, typing_extensions 4.16.0, tzdata 2026.6, uvicorn 0.54.0. (Pygments 2.21.0 also appears when pytest is installed.)

Deferred to later phases (do NOT install now): Pillow 13.0.0 and python-multipart 0.0.32 (Phase 12 photos), react-hook-form/zod/@hookform/resolvers (Phase 12 registration form), shadcn/Radix, `@fontsource/*` (Phase 12 print/Devanagari), date-fns.

### Core (frontend) - `frontend/`
| Library | Version (published) | Purpose | Notes |
|---------|---------------------|---------|-------|
| Node.js (build/dev machine only) | **24.22.1** via winget `OpenJS.NodeJS.LTS` | Toolchain | Floor of the pinned set = **22.22.2** (jsdom 30.1.3 `^22.22.2 \|\| ^24.15.0 \|\| >=26`); react-router 8.5.1 `>=22.22.0`; vitest 5.0.5 `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0`; vite 8.3.5 `^20.19.0 \|\| >=22.12.0`; jest-dom 7.0.1 `node >=22`. |
| react / react-dom | 19.3.1 (2026-10-14) | UI | |
| react-router | **8.5.1** (2026-10-27) | Routing (data mode) | `import { createBrowserRouter } from "react-router"; import { RouterProvider } from "react-router/dom"`. Peers: react >=19.2.7, @types/react >=19.2.0. No `react-router-dom`. |
| @tanstack/react-query | 5.105.0 (2026-10-26) | Server state | |
| vite | 8.3.5 (2026-10-21) | Build/dev server | Rolldown-based; native optional deps (rolldown, lightningcss) install per platform with no install scripts. |
| @vitejs/plugin-react | 6.1.2 | React plugin | Peer `vite ^8.0.0`. |
| typescript | **~7.0.2** (2026-07-08) | Type check (`tsc -b`) | Matches the official create-vite react-ts template today (see Alternatives). |
| tailwindcss + @tailwindcss/vite | 4.3.3 (2026-07-16) | Styling | CSS-first config; compiled to one local CSS file, no CDN. |
| oxlint | 1.90.0 (2026-10-27) | Lint | The create-vite template's `lint` script is `oxlint`. |
| vitest | 5.0.5 (2026-10-15) | Test runner | Requires Vite >=6.4.0 and Node >=22.12.0 [CITED: vitest.dev/guide]. |
| jsdom | 30.1.3 | DOM for tests | |
| @testing-library/react 16.3.3, @testing-library/dom 10.4.2 (peer of RTL), @testing-library/jest-dom 7.0.1, @testing-library/user-event 14.6.8 | | Component tests | jest-dom 7.0.1 exports `./vitest` [VERIFIED: registry `exports` keys: ".", "./vitest", "./matchers", "./jest-globals", "./package.json"]. |
| @types/react 19.3.0, @types/react-dom 19.3.0, @types/node **24.19.2** | | Types | Same as the template (`@types/node ^24.19.2`); do not use @types/node 26.x with Node 24. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| SQLAlchemy 2.0.55 | 2.1.6 | Newer line, five weeks old and still stabilising; nothing in Phase 11 needs it. Re-evaluate after Phase 17. |
| Sync SQLAlchemy/psycopg | Async | Rejected: Windows Proactor incompatibility, CPU-bound Argon2, no concurrency need. |
| Server-side opaque sessions | JWT | JWT is listed under Claude's Discretion; sessions give instant revocation (deactivate, lockout, password change). |
| TypeScript 7.0.2 + oxlint | TS 5.9.3 + ESLint 10.13 + typescript-eslint 8.72.1 | Fallback if oxlint proves too thin. TS 6.0.3 is possible but still breaks the `openapi-typescript` peer (`^5.x`). Do not mix TS >= 6.1 with typescript-eslint. |
| Hand-written API client | `openapi-typescript` 7.13.0 + `openapi-fetch` 0.17.0 | Needs TS 5.x; ~12 endpoints in this phase do not justify it. Use a backend OpenAPI snapshot test as the drift alarm (Validation Architecture). |
| `app.frontend()` | Hand-rolled `StaticFiles` + catch-all | Native method verified on 0.162.0 (see Pattern 10); hand-rolled only as a fallback. |
| httpx2 | httpx 0.28.1 | httpx is what the FastAPI testing tutorial still names; it works but warns. |
| PostgreSQL 18.6 | 17.11 (EOL 2029-11-08) | Fallback if the 18 installer misbehaves on the server PC; both support the `builtin` locale provider. |
| Node 24.22.1 | Node 26.13.0 (LTS since 2026-10-28), Node 22.23.4 | 26 is two days into LTS - avoid for a 6-week project; 22 is in maintenance. |

**Installation:**
```powershell
# Backend (from D:\dr-sr; PowerShell 5.1 - no && chaining)
python -m venv backend\.venv
backend\.venv\Scripts\python.exe -m pip install --upgrade pip
backend\.venv\Scripts\python.exe -m pip install -e "backend[dev]"      # pins live in backend\pyproject.toml
backend\.venv\Scripts\python.exe -m pip freeze --exclude-editable > backend\requirements.lock.txt

# Frontend (after Node 24.22.1 is installed; .npmrc has save-exact=true)
npm --prefix frontend install
npm --prefix frontend ci            # reproducible installs thereafter
```

**Version verification:** commands used (re-run before locking pins):
```powershell
Invoke-RestMethod https://pypi.org/pypi/fastapi/json | % { $_.info.version }   # PyPI JSON API
Invoke-RestMethod https://registry.npmjs.org/vite/latest | % { $_.version, $_.engines.node }
winget show --id PostgreSQL.PostgreSQL.18 --versions --source winget
winget show --id OpenJS.NodeJS.LTS --versions --source winget
```

## Package Legitimacy Audit

`gsd_run query package-legitimacy check` could **not** be run (it needs Node, which is absent; STATE.md notes `gsd-tools.cjs` is unavailable). The audit below is therefore a **manual registry audit** (first release, weekly downloads from pypistats.org / api.npmjs.org, source repo, install scripts, GitHub advisory query). The GitHub advisories API returned **zero advisories** for every pinned Python version on 2026-10-30 (a lookup result, not a proof of safety). **Planner: add a `checkpoint:human-verify` that runs the seam for both ecosystems right after Node is installed in Wave 0 and before the first `pip install`/`npm install`; any SUS/SLOP verdict overrides this table.** Package names are `[CITED]` from official docs/templates: FastAPI/Starlette/SQLAlchemy/Alembic/psycopg/argon2-cffi/pytest docs and the create-vite template (react, react-dom, vite, @vitejs/plugin-react, typescript, oxlint, @types/*), React Router and Vitest docs, FastAPI release notes (httpx2), registry `exports`/`requires_dist` (tzdata, jest-dom).

| Package | Registry | First release | Downloads/wk | Source repo | Verdict | Disposition |
|---------|----------|---------------|--------------|-------------|---------|-------------|
| fastapi | PyPI | 2018-12 | 122M | github.com/fastapi/fastapi | OK (manual) | Approved, exact pin |
| starlette | PyPI | 2018-06 | 159M | maintainer Kludex (PyPI lists sponsor link only) | OK (manual) | Approved, exact pin |
| pydantic / pydantic-settings | PyPI | 2017-05 / 2019-08 | 257M / 113M | github.com/pydantic/* | OK (manual) | Approved |
| uvicorn | PyPI | 2017-06 | 148M | maintainer Kludex | OK (manual) | Approved |
| SQLAlchemy / alembic | PyPI | 2006-02 / 2011-11 | 94.5M / 53.1M | github.com/sqlalchemy/* | OK (manual) | Approved |
| psycopg / psycopg-binary | PyPI | 2021-08 / 2021-10 | n/a (429) / 45.5M | github.com/psycopg/psycopg | OK (manual) | Approved |
| argon2-cffi / argon2-cffi-bindings | PyPI | 2015-12 / 2021-11 | 18.8M / 19.1M | github.com/hynek/* | OK (manual) | Approved |
| tzdata | PyPI | 2016-08 | 173M | github.com/python/tzdata | OK (manual) | Approved |
| pytest, pytest-timeout, pytest-cov | PyPI | 2010 / 2012 / 2010 | 219M / 27.6M / 58.3M | github.com/pytest-dev/* | OK (manual) | Approved |
| ruff | PyPI | 2022-08 | 97.1M | github.com/astral-sh/ruff | OK (manual) | Approved |
| **httpx2** (+ httpcore2, truststore transitive) | PyPI | **2026-05-11 (5 months)** | 93.1M | github.com/pydantic/httpx2 (1.6k stars, active) | OK (manual) - **young package** | Approved with note; named in Starlette's own deprecation warning and FastAPI 0.143.4 notes; fallback `httpx==0.28.1`. Planner may keep a `checkpoint:human-verify` here. |
| opentelemetry-api (transitive of FastAPI) | PyPI | 2019-10 | 157.6M | github.com/open-telemetry/opentelemetry-python | OK (manual) | Approved (inert, no exporter) |
| react, react-dom | npm | 2011 / 2014 | 246M / 231M | github.com/react/react (registry `repository.url`) | OK (manual) | Approved |
| react-router | npm | 2014-02 | 74.4M | github.com/remix-run/react-router | OK (manual) | Approved |
| @tanstack/react-query | npm | 2022-07 | 81.2M | github.com/TanStack/query | OK (manual) | Approved |
| vite, @vitejs/plugin-react | npm | 2020-04 / 2021-09 | 254.6M / 121.9M | github.com/vitejs/* | OK (manual) | Approved |
| typescript | npm | 2012-10 | 402M | github.com/microsoft/TypeScript | OK (manual) | Approved; v7 ships native binaries as optional deps `@typescript/typescript-win32-x64` with no install script |
| tailwindcss, @tailwindcss/vite | npm | 2017-10 / 2024-02 | 170M / 57.2M | github.com/tailwindlabs/tailwindcss | OK (manual) | Approved (native `@tailwindcss/oxide-*` optional deps, no install hooks) |
| oxlint | npm | 2023-06 | 40.5M | github.com/oxc-project/oxc | OK (manual) | Approved (official template lint) |
| vitest, jsdom | npm | 2021-12 / 2011-11 | 170M / 151.7M | github.com/vitest-dev/vitest, github.com/jsdom/jsdom | OK (manual) | Approved |
| @testing-library/{react,dom,jest-dom,user-event} | npm | 2019 | 91M / 113M / 95M / 83M | github.com/testing-library/* | OK (manual) | Approved |
| @types/react, @types/react-dom, @types/node | npm | 2016 | 221M / 188M / 609M | github.com/DefinitelyTyped | OK (manual) | Approved |

**Packages removed due to [SLOP] verdict:** none (seam not run).
**Packages flagged as suspicious [SUS]:** none from the manual audit; `httpx2` is the only young package (5 months) - see note above.

## Architecture Patterns

### System Architecture Diagram

```
 Browser on any LAN PC (Chrome/Edge)                     Windows server PC (dev PC today)
 ┌──────────────────────────────┐   plain HTTP :8000   ┌────────────────────────────────────────────────────────────┐
 │ GET /, /assets/*, /admin ...  │ ───────────────────▶ │ uvicorn (1 process, --no-server-header, no --proxy-headers)  │
 │ (Accept: text/html)           │                      │  FastAPI app = create_app(settings)                          │
 │                               │                      │   ├─ http middleware: security headers, Cache-Control         │
 │ SPA (React Router data mode)  │                      │   ├─ global dependency verify_origin (unsafe methods only)    │
 │  in-memory: csrf_token        │                      │   ├─ app.frontend("/", ABS dist path, fallback=index.html)    │
 │  cookie: kalyan_session       │ ── XHR /api/* ─────▶ │   │      (public static; API routes are matched first)       │
 │   (HttpOnly, SameSite=Strict) │  X-CSRF-Token + cookie│   └─ /api routers: every route has EXACTLY ONE policy marker  │
 └──────────────────────────────┘                      │        public ────────▶ GET /api/health, POST /api/auth/login│
                                                        │        authenticated_only ▶ me / logout / change-password     │
                                                        │        require(Permission…) ▶ users, <area>/overview          │
                                                        │            │ current_principal: hash(token) → sessions row,   │
                                                        │            │  idle+absolute check, user active, must_change,  │
                                                        │            │  CSRF header, touch (≤ 1 write/min)              │
                                                        │            ▼                                                  │
                                                        │   services: rules · row_scope() · version compare · audit    │
                                                        │            │ SessionDep (scope="function") = 1 txn / request  │
                                                        └────────────┼───────────────────────────────────────────────┘
                                                                     ▼
                              PostgreSQL 18.6 on 127.0.0.1:5432 (listen_addresses = localhost, synchronous_commit = on)
                              runtime role kalyan_app (DML; audit_logs INSERT/SELECT only) · owner role kalyan_owner (Alembic only)
                              users · doctors(stub) · sessions · login_throttle · audit_logs(+3 triggers) · alembic_version
   Server-side CLI (no HTTP): create-admin · reset-admin-password · migrate (owner role) · check-db · export-openapi
   [Superseded by EG-17 (user decision 2026-10-30): first-run web wizard with setup-mode-only availability and a one-time server-console setup code; `create-admin` dropped, `reset-admin-password` kept. See 11-11-PLAN.md.]
```

### Recommended Project Structure (answers question 1)

```
D:\dr-sr\
├── app\  tests\  pytest.ini  requirements*.txt  main.py  .venv\  ...      # LEGACY v2.0 - do not touch
├── backend\                                    # NEW
│   ├── pyproject.toml                          # exact pins, [tool.pytest.ini_options], [tool.ruff]
│   ├── requirements.lock.txt                   # pip freeze of the verified set (generated at end of Phase 11)
│   ├── alembic.ini                             # dev convenience only (autogenerate); points into the package
│   ├── .env.example                            # placeholders only; backend\.env is git-ignored
│   ├── .venv\                                  # NOT the legacy root .venv
│   ├── db\bootstrap.sql                        # roles + databases, run once by a human as postgres
│   ├── src\kalyan_api\
│   │   ├── main.py            create_app(settings) factory (uvicorn --factory)
│   │   ├── config.py          pydantic-settings; builds DB URLs from parts (sqlalchemy.engine.URL.create)
│   │   ├── clock.py           utcnow(), IST helpers - the ONLY time seam (tests monkeypatch it)
│   │   ├── db\                base.py (MetaData naming convention) · session.py (SessionDep) · migrate.py (alembic Config, revision gate)
│   │   ├── models\            user.py · doctor.py (stub) · session.py · login_throttle.py · audit.py
│   │   ├── core\              security.py (argon2, tokens) · permissions.py · policy.py · scope.py · csrf.py · errors.py
│   │   ├── services\          auth_service.py · session_service.py · user_service.py · audit_service.py
│   │   ├── routers\           health.py · auth.py · users.py · areas.py
│   │   ├── schemas\           pydantic request/response models (extra="forbid" on requests)
│   │   ├── cli.py             argparse: create-admin · reset-admin-password · migrate · check-db · export-openapi
   [Superseded by EG-17 (user decision 2026-10-30): first-run web wizard with setup-mode-only availability and a one-time server-console setup code; `create-admin` dropped, `reset-admin-password` kept. See 11-11-PLAN.md.]
│   │   └── migrations\        env.py · script.py.mako · versions\0001_baseline.py     (INSIDE the package so a wheel ships them)
│   └── tests\                 conftest.py · test_*.py · support\
├── frontend\                  package.json · package-lock.json · .nvmrc · .npmrc · index.html · vite.config.ts · tsconfig*.json · src\
└── .planning\phases\11-decisions-gate-foundation-auth\11-ENTRY-GATE.md        # decision register (first commit of the phase)
```

**Why `kalyan_api` and not `backend/app/`** (CONTEXT lists `backend/app/...` under Claude's Discretion): the legacy package `D:\dr-sr\app` has `__init__.py` [VERIFIED: `Test-Path app\__init__.py` = True], the root `pytest.ini` sets `pythonpath = .`, root `pyrightconfig.json` pins `"venv": ".venv"`, and `python -m pytest`/`uvicorn app.main:app` with cwd = repo root resolve `import app` to the legacy package. Experiment: two packages both named `app` only worked because pytest inserted `backend` first; a distinct name removes the whole class of failure. This is a deviation from the example path in CONTEXT.md, flagged in Open Questions (Q1).

**Legacy-collision rules (all verified in a mirror of this layout, pytest 9.2.0, 2026-10-30):**

| Command (cwd) | Result |
|---|---|
| `pytest` (repo root, no args) | Uses root `pytest.ini`; collects only `tests/` (legacy). |
| `pytest backend` / `pytest backend/tests/x.py` (repo root) | Common ancestor of args is `backend`; the nearest config upward is `backend/pyproject.toml` -> backend config wins. [CITED: docs.pytest.org customize: "searches upward ... first match wins ... never merged"] |
| `pytest` (cwd = `backend`) | backend config. |
| `pytest tests backend/tests` (both suites, one session) | **Fails**: `import file mismatch` for equal basenames (`test_auth_service.py`) under prepend import mode. Never collect both together; backend config sets `--import-mode=importlib` and backend test basenames avoid the legacy names (`test_auth_service.py`, `test_audit_service.py`, `test_billing_service.py`, ...). |

Legacy files that Phase 11 must NOT change and that must keep working: `pytest.ini` (`[pytest]` / `pythonpath = .` / `testpaths = tests` / `addopts = -ra -q`) [VERIFIED: D:\dr-sr\pytest.ini:1-4]; `.github/workflows/tests.yml` (`python-version: "3.11"`, `run: pytest`, installs `requirements-dev.txt`) [VERIFIED: tests.yml:24,32,49]; `.vscode/settings.json` (`"python.testing.pytestArgs": ["tests"]`, interpreter = root `.venv`) [VERIFIED: settings.json:2,9]. Root `DECISIONS.md` is the superseded v2.0 ADR log (ADR-02 defers "web portals, and multi-PC LAN databases") - do not append v3.0 decisions to it.

**`.gitignore` facts that bite** [VERIFIED: D:\dr-sr\.gitignore:1-10 `.venv/`, `__pycache__/`, `.pytest_cache/`, `*.py[cod]`, `data/`, `backups/`, `.env`, `dist/`, `build/`, `*.spec`]: (a) there is **no `node_modules/`** entry - add `node_modules/`, `*.tsbuildinfo`, `coverage/` BEFORE the first `npm install`; (b) `data/`, `build/`, `dist/` match at any depth, so never name a source folder `data`, `build` or `dist` (e.g. `src/data/`) - git would silently ignore it; (c) `frontend/dist` and `backend/.venv` are already ignored (intended); (d) `.env` is ignored but `.env.example` is a different filename and is committed.

### Pattern 1: Exactly-one policy marker per route + code-defined RBAC (questions 2-3, SEC-02/SEC-03)

**What:** Three marker dependencies - `public`, `authenticated_only`, `require(*Permission)` - each stamps a `Policy` object on the dependency function (`fn.__policy__`). Every route declares **exactly one** marker through `dependencies=[Depends(...)]` on the route decorator (not on an `APIRouter`: router-level dependencies are merged only at include time, so a `route_class` boot guard could not see them). `require()` depends on `current_principal`, which authenticates, loads the user, rejects `must_change_password`, and checks the CSRF header on unsafe methods; `authenticated_only` uses `current_principal_allow_pending` (same, but tolerates `must_change_password`) and exists for `me`, `logout`, `change-password`.

**Why exactly one:** two stacked `require()` markers are an AND with no visible intent; the test can assert `len(policies) == 1` and the matrix stays readable. A multi-permission need is expressed as one `require(P.A, P.B)` (all-of).

**Permission catalogue and role defaults (SEC-03, the entry-gate "role/permission matrix"):** code is the source of truth (`Permission`, `Role` as `StrEnum`; `ROLE_PERMISSIONS: dict[Role, frozenset[Permission]]`); there is no editable role table (REQUIREMENTS Out of Scope: "Per-user custom permission trees"). `users.role` is `VARCHAR(16)` with a **named CHECK** (`role IN ('ADMIN','RECEPTION','DOCTOR')`) - v2.0 used `RECEPTIONIST` [VERIFIED: D:\dr-sr\app\db\schema.sql:93 `role TEXT NOT NULL DEFAULT 'RECEPTIONIST' CHECK (role IN ('ADMIN', 'RECEPTIONIST', 'DOCTOR'))`]; v3.0 uses `RECEPTION` to match REQUIREMENTS wording. Native PG enums are avoided ([ASSUMED] `ALTER TYPE ... ADD VALUE` friction when later phases add values; a named CHECK is a one-line migration).

| Permission | Implemented in | ADMIN | RECEPTION | DOCTOR | Note |
|---|---|:-:|:-:|:-:|---|
| `user:read` `user:create` `user:update` `user:deactivate` `user:reset_password` `user:unlock` | Phase 11 | Y | - | - | `user:update` covers name + role change; `user:deactivate` covers reactivate. |
| `dashboard:admin` / `dashboard:reception` / `dashboard:doctor` | Phase 11 | Y / - / - | - / Y / - | - / - / Y | Backs `GET /api/{admin,reception,doctor}/overview` so "cannot open another role's dashboard data by typing the URL or calling the API directly" (SC-2) is testable now. [ASSUMED] Admin does not use the reception/doctor dashboards. |
| `settings:read/write`, `doctor:read/manage`, `fee:read/manage` | Phase 12 (reserved) | write/manage Y; read Y | read Y | read Y | |
| `patient:read/create/update`, `photo:read/write` | Phase 12 (reserved) | read Y [ASSUMED] | Y | read **own** (scope) | Reception: demographics only (D-04). |
| `appointment:read/write` | Phase 13 (reserved) | read Y [ASSUMED] | Y | read/status-update **own** queue | |
| `encounter:*`, `prescription:*`, `plan:*`, `session_log:*` | Phases 13-14 (reserved) | **-** [ASSUMED] | **- (D-04)** | Y **own** (D-03) | Admin has no clinical-content permission by default ("minimum necessary"); client to confirm. |
| `payment:read/create`, `receipt:reprint` | Phase 15 (reserved) | read/reprint Y | Y | - [ASSUMED] | |
| `payment:reverse` | Phase 15 (reserved) | **Y only (D-06)** | - | - | |
| `audit:read`, `backup:run`, `backup:restore`, `integrity:run` | Phase 16 (reserved) | Y | - | - | |

Tests that make the catalogue enforceable: (1) `test_role_permission_matrix_snapshot` - a golden dict in the test file; any edit to `ROLE_PERMISSIONS` must edit the snapshot in the same commit; (2) `test_no_orphan_permissions` - every `Permission` is used by >=1 route OR listed in `RESERVED = {permission: "phase 12"}`; later phases shrink `RESERVED`; (3) `test_role_values_constrained` - raw SQL insert with `role='SUPERUSER'` fails with `IntegrityError`.

**Route-walk test technique (SEC-02) - verified on FastAPI 0.162.0 / Starlette 1.10.0** (full code CE-1):
- Enumerate with `fastapi.routing.iter_route_contexts(app.routes)`. Each `RouteContext` proxies the effective route (`.path`, `.methods`, `.dependant`, ...) with router-level and decorator-level dependencies already merged (experiment: `POST /api/users` showed both the router-level `user:read` and the decorator-level `user:create` markers). `app.routes` itself contains one `_IncludedRouter` and **zero** `APIRoute` objects after `include_router`.
- Walk `ctx.dependant.dependencies` recursively and collect `getattr(sub.call, "__policy__", None)`.
- Fail when: a route has `!= 1` markers; a context has no `dependant` (docs/redoc/openapi routes, mounts) - the API app must not contain non-API routes, so build it with `docs_url=None, redoc_url=None, openapi_url=None`; the set of `public` `(METHOD, path)` pairs differs from an explicit allow-list (`GET /api/health`, `POST /api/auth/login`); or a **must-exist** list (`POST /api/auth/login`, `GET /api/auth/me`, `GET /api/users`, `POST /api/users`) is not fully enumerated - this last assertion is what makes the test non-vacuous.
- `app.frontend(...)` does not appear in `iter_route_contexts` (verified: 7 contexts for 7 API routes), so no allow-list entry is needed for the SPA.
- Optional boot-time guard (verified on 0.162.0): `APIRouter(route_class=PolicyRoute)` where `PolicyRoute.__init__` raises `RuntimeError` when the route's own dependant has no marker - the app then cannot even import with an unprotected route. It complements, never replaces, the CI test.

**Role x endpoint matrix pattern:** one table in `tests/test_rbac_matrix.py`: `(method, path_template, body_factory, {anonymous: 401, admin: 200, reception: 403, doctor_a: 403, doctor_b: 403})`, executed with five ready-made clients (`anonymous`, `admin`, `reception`, `doctor_a`, `doctor_b`, each logged in through the real `/api/auth/login`). Add a **completeness test**: every `(method, path_template)` from `iter_route_contexts` that is not `public` must appear in the table, so a new endpoint without a matrix row fails CI. A recursive key scan asserts `password_hash` (and `token`, `csrf_token` except on login/me) never appears in any response body. Conventions: 401 = no/expired session; 403 = authenticated but not permitted (and CSRF/Origin failures, `password_change_required`); 404 = object exists but is outside the caller's scope (D-03), so existence does not leak.

### Pattern 2: One request = one transaction, committed BEFORE the response (questions 5-6)

- `SessionDep = Annotated[Session, Depends(get_session, scope="function")]` where `get_session` yields a `Session`, `commit()`s after the handler returns, `rollback()`s on exception, `close()`s in `finally`. **`scope="function"` is mandatory**: docs - the default for yield dependencies is `"request"`, whose exit code runs "after the response is sent"; `"function"` ends "before the response is sent back" [CITED: fastapi.tiangolo.com/tutorial/dependencies/dependencies-with-yield/]. Experiment: teardown raising `HTTPException(409)` produced a 409 to the client with `scope="function"` and a silent 200 with the default scope.
- `app.dependency_overrides[get_session]` works for this dependency (verified): the test override is a generator that yields the test session and commits (releases the SAVEPOINT) in its teardown.
- A non-yield dependency such as `current_principal` that takes `SessionDep` shares the **same** `Session` as the handler (verified: same object id) - authentication reads and the business write are one transaction.
- **Raising rolls back.** Anything that must persist even though the response is an error (failed-login counter, lockout, `AUTH_LOGIN_FAILED` audit row) must be done in a handler that *returns* the 401 response (`JSONResponse`) rather than raising `HTTPException`; otherwise the teardown rolls the counter back and an attacker gets unlimited guesses (test: after 5 bad logins the row shows `locked_until` and 5 audit rows exist).
- **Build the response after `session.flush()`.** `version_id` increments at flush; a response built before flush carries the OLD version (observed: `PATCH ... -> version_id: 1` when the row had just become 2), so the client's next save would 409 spuriously. A test asserts `response.version_id == previous + 1`.
- **Sync, not async (question 6).** Rationale: (1) psycopg's own docs: "On Windows, Psycopg is not compatible with the default ProactorEventLoop" [CITED: psycopg.org/psycopg3/docs/advanced/async.html] and uvicorn on Windows uses it by default; (2) Argon2 (~67 ms CPU) would block the event loop in `async def` handlers; (3) FastAPI runs `def` handlers/dependencies in a threadpool, so 3-5 concurrent staff need no event-loop concurrency; (4) the unit-of-work/ORM/test-isolation story is simpler with sync `Session`. Compatibility with the locked decisions: D-01..D-08 say nothing about async; the CONTEXT line "async `AUD-01` writer" sits in `<code_context>` (descriptive of the v2.0 service), and a fire-and-forget async writer would break the "same transaction as the business write" rule the ROADMAP states for AUD-01. Engine: `pool_size=5, max_overflow=5, pool_pre_ping=True, pool_recycle=1800`; `connect_args={"options": "-c timezone=Asia/Kolkata -c statement_timeout=30000 -c lock_timeout=10000 -c idle_in_transaction_session_timeout=60000"}` [ASSUMED values].
- **Error envelope contract** (registered handlers for `HTTPException`, `RequestValidationError`, `VersionConflict`, `StaleDataError`, `Exception`): every error body is `{"code": "<snake_case>", "message": "<human text>", ...extras}`; 422 adds `"fields": [{"loc": [...], "message": "..."}]`; 500 never includes internals. Codes used in this phase: `not_authenticated`, `session_expired`, `invalid_credentials`, `too_many_attempts` (429 + `Retry-After`), `password_change_required` (403), `forbidden` (403), `csrf_failed` (403), `not_found` (404), `version_conflict` (409), `username_taken` (409), `last_admin` (409), `self_action_forbidden` (409), `validation_error` (422). FastAPI's default nests custom detail under `"detail"`; the handler must flatten it so the SPA reads one shape.

### Pattern 3: Server-side sessions, cookie and CSRF over plain HTTP (question 2, SEC-01/SEC-04)

| Aspect | Decision | Evidence |
|---|---|---|
| Token | `secrets.token_urlsafe(32)` (256 bit). Stored only as `sha256(token).hexdigest()` in `sessions.token_hash` (UNIQUE). | OWASP: IDs >= 128 bits when self-generated; "store a one-way verifier" [CITED: cheatsheetseries.owasp.org Session_Management]. |
| Cookie | Name `kalyan_session`; `HttpOnly`; `SameSite=Strict`; `Path=/`; **no `Secure`** (D-01); no `Domain` (host-only); no `Max-Age` (session cookie). Name/`Secure` come from settings so HTTPS later flips one flag and the name to `__Host-kalyan_session`. | Verified live on Windows (uvicorn 0.54.0 + httpx2): `Set-Cookie: kalyan_session=...; HttpOnly; Path=/; SameSite=strict` round-trips over `http://`; the same cookie WITH `Secure` is silently not sent back (login "works", every next call is 401) - so a cookie round-trip test over plain HTTP is a mandatory regression test. |
| Why not `__Host-` | Prefix requires `Secure` set "by a secure page (HTTPS)". | [CITED: developer.mozilla.org Set-Cookie] |
| Session cookies and restart | Browsers may restore session cookies after restart ("session restore"), so server-side idle/absolute limits are the real control. | [CITED: MDN Set-Cookie] |
| Idle timeout | **30 min sliding (D-07)**; `last_seen_at` refreshed with `UPDATE sessions SET last_seen_at=:now WHERE id=:id AND last_seen_at < :now - 60 s` (conditional -> no row lock and no write on most requests). OWASP's "15-30 minutes for low risk" range puts 30 at the top; compensate with a visible Sign out button in the shell. | [CITED: OWASP Session_Management] |
| Absolute limit | **12 h** from login (no renewal), setting `KALYAN_SESSION_ABSOLUTE_HOURS` [ASSUMED: one shift; confirm]. | |
| Expiry handling | Computed in Python at lookup; return 401 `session_expired` (idle/absolute) or `not_authenticated`; do **not** write on expiry (a write inside a request that raises 401 would be rolled back anyway). Purge old rows opportunistically at login. | |
| Rotation | New token on every login (revoke a presented valid session first) and after password change; revoke all of a user's sessions on admin reset, deactivation and password change. Concurrent sessions per user are allowed [ASSUMED]. | OWASP: renew after privilege change. |
| CSRF token | Random `secrets.token_urlsafe(24)` per session stored in `sessions.csrf_token`, returned by `POST /auth/login` and `GET /auth/me`, kept **in JS memory only**, sent as `X-CSRF-Token` on POST/PUT/PATCH/DELETE; compared with `hmac.compare_digest`. | OWASP: bind the token to session-specific data [CITED]. |
| Origin check | Global dependency on all unsafe methods **including login**: take `Origin` (else `Referer`); its `host:port` must equal the request `Host` header or be in `KALYAN_EXTRA_ALLOWED_ORIGINS` (dev: `http://localhost:5173`); both headers missing -> 403 `csrf_failed`. Host-equality (not a fixed allow-list) means a DHCP/IP change of the server never breaks CSRF. | OWASP: "If the Origin header is not present, verify that the hostname in the Referer header matches the target origin ... Missing headers and Origin: null are not evidence of a same-origin request." [CITED] |
| Do not rely on | `Sec-Fetch-Site` (browsers send `Sec-Fetch-*` only to potentially trustworthy URLs, which excludes `http://192.168.x.x`) [CITED: W3C Fetch Metadata, Chromium]; SameSite alone ("Lax only blocks unsafe methods", "defense-in-depth ... does not replace a proper CSRF defense") [CITED: OWASP CSRF]. | |
| CORS | None in production (same origin). Dev uses the Vite proxy (`/api` -> `http://127.0.0.1:8000`) without `changeOrigin`, so Host == Origin host. | |
| Response headers | `Cache-Control: no-store` on every `/api/*` response; `X-Content-Type-Options: nosniff`; `X-Frame-Options: DENY`; `Referrer-Policy: no-referrer`; a CSP `default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'` [ASSUMED - smoke-test in a browser once the SPA exists]. | |

**Plain-HTTP consequences for the frontend (verify nothing relies on them):** `window.isSecureContext` is false at `http://192.168.x.x` [CITED: MDN Secure_Contexts: potentially trustworthy = https/wss/file, 127.0.0.0/8, ::1, localhost, *.localhost], so `crypto.subtle`, `crypto.randomUUID()`, `navigator.mediaDevices.getUserMedia`, `navigator.clipboard` and service workers are unavailable [MDN names service workers explicitly; the other APIs per general knowledge, [ASSUMED]]. Use `crypto.getRandomValues` for client-generated idempotency keys in Phase 15, no PWA/service worker, no webcam capture (FUT-01 stays deferred). Use an IP or a **single-label hostname** (`http://kalyan-server`): Chrome 154's default "Always Use Secure Connections" warns only for public sites and explicitly excludes "local IP addresses like 192.168.0.1, single-label hostnames" [CITED: blog.google/security/https-by-defau/]; a fake FQDN such as `kalyan.hospital` would be treated as public and warned about.

**Residual risk of plaintext credentials - record as an accepted risk (RISK-01, do not re-litigate D-01):**
- *Risk:* login passwords, temporary passwords, the session cookie and all patient data cross the LAN unencrypted; anyone who can sniff the LAN segment (ARP spoofing, a shared/guest Wi-Fi, a compromised PC) can capture credentials or hijack a session until it expires.
- *Cheap mitigations to adopt (all in-scope, none require TLS):* (1) the "isolated private subnet" is a stated assumption of D-01 - write it as a condition: wired or staff-only Wi-Fi, no guest/patient devices on the same subnet, no router port-forwarding; (2) Windows Firewall inbound rule for TCP 8000 limited to the LAN subnet and Private profile; PostgreSQL bound to localhost; (3) per-person accounts, forced change at first login, random server-generated temporary passwords shown once; (4) session limits (30 min idle, 12 h absolute), server-side revocation, `HttpOnly` cookie, `SameSite=Strict`, per-session CSRF token; (5) lockout + per-IP throttle; (6) audit of every login/failed login/lockout/admin action, reviewed by the Admin; (7) staff rule: never sign in from personal phones/laptops; (8) optional later hardening, off by default: bind sessions to the client IP (`sessions.ip` is stored already) - reject a mismatch; trade-off: DHCP renewals mid-session cause surprise logouts.
- *Likelihood/impact:* low-to-moderate on a wired, isolated switch (switches do not flood unicast); high impact (role-level access to PHI). *Owner:* project owner records, trust administrator accepts. *Review triggers:* any Wi-Fi/guest device on the subnet, router replacement, remote-access request, or the FUT-01 HTTPS item.
- Browsers will show "Not secure" permanently - add a line to the staff guide.

### Pattern 4: Passwords, lockout, throttle, forced change, first-run admin (SEC-04/SEC-05)

- **Argon2id:** `argon2.PasswordHasher()` defaults (t=3, m=64 MiB, p=4; the RFC 9106 "SECOND RECOMMENDED" low-memory profile) - stronger than the OWASP floor (m=19 MiB, t=2, p=1 [CITED: cheatsheetseries.owasp.org Password_Storage]); measured on this dev PC: default 67.3 ms hash / 66.8 ms verify, OWASP-floor 27 ms. Keep defaults; on login call `check_needs_rehash()` and re-hash if true; expose `cli bench-hash` so Phase 17 can raise `time_cost` on the real server if it verifies in < 100 ms. For an unknown username verify against a precomputed dummy hash so timing does not reveal existence. Worst case 5 concurrent hashes = ~320 MiB: acceptable; the per-IP throttle bounds bursts.
- **Password policy** [ASSUMED defaults, confirm in the register]: minimum 10 characters, maximum 128 (request-size guard), not equal to username/full name, not in a ~100-entry embedded blocklist (`password`, `kalyan123`, `hospital123`, ...), no composition rules (NIST-style). Temporary passwords: 12 chars from an unambiguous alphabet via `secrets`.
- **Lockout algorithm (D-07):** (1) load user by `lower(username)` (store usernames lowercased); unknown -> dummy verify, then the failure path below minus the per-user counter (there is no row): upsert `login_throttle`, audit, return the generic 401; (2) if `locked_until > now` -> dummy verify, generic 401, **no per-user counter change** (a lock is not extended by further attempts) but the attempt still counts in `login_throttle`; (3) if a previous lock has expired (`locked_until <= now`) reset `failed_login_count=0, locked_until=NULL`; (4) verify; on success `UPDATE users SET failed_login_count=0, locked_until=NULL, last_login_at=:now` and create the session; (5) on failure `UPDATE users SET failed_login_count = failed_login_count + 1, locked_until = CASE WHEN failed_login_count + 1 >= 5 THEN :now + 15 min ELSE locked_until END WHERE id=:id RETURNING ...` - one atomic Core statement (no lost updates under concurrency), audit `AUTH_LOGIN_FAILED` (+ `AUTH_ACCOUNT_LOCKED` when it trips), commit, **return** 401. **These counter updates are Core statements, not ORM flushes, so they never bump `users.version_id`** (otherwise a failed login would 409 an admin who is editing the user).
- **One generic message** for unknown user / wrong password / locked: "Invalid username or password, or the account is temporarily locked. Wait 15 minutes or ask an administrator." - no user enumeration, still actionable. Residual: an attacker can lock a known account with 5 bad guesses (DoS); accepted; admin unlock + CLI recovery exist.
- **Per-IP throttle (Claude's-Discretion item):** table `login_throttle(ip inet PK, window_start timestamptz, attempt_count int)`; failures upsert in one statement (reset the window when `window_start <= now - 15 min`, else increment); before verifying, if the current window has `attempt_count >= 20` return 429 `too_many_attempts` with `Retry-After`. Failures only; not reset on success (password spraying). DB-backed so it survives restarts and needs no extra service (rejects Redis/slowapi per STACK.md). Constants in settings.
- **Forced change:** `users.must_change_password BOOLEAN NOT NULL DEFAULT true`. While true, `current_principal` raises 403 `password_change_required` for everything except `GET /auth/me`, `POST /auth/logout`, `POST /auth/change-password` (the three `authenticated_only` routes). Change requires the current password, applies the policy, sets `must_change_password=false`, `password_changed_at`, rotates the session and revokes the user's other sessions.
- **Admin operations:** create (server-generated temporary password returned once with `Cache-Control: no-store`, `must_change_password=true`), update name/role (needs `version_id`), deactivate/reactivate (sets `is_active`, revokes sessions; never delete - the runtime role is never granted `DELETE` on `users`), reset password (new temporary password, `must_change_password=true`, sessions revoked), unlock. Guards: an admin cannot deactivate/demote themselves; the last active admin cannot be deactivated or demoted (`409 last_admin`); request models use `extra="forbid"` so `password_hash`, `failed_login_count`, etc. cannot be mass-assigned (tested).
- **First-run admin (SEC-05):** `python -m kalyan_api.cli create-admin --username NAME --full-name "..."` reads the password with `getpass` (twice, never from argv; `--password-stdin` for automation/tests), applies the policy, refuses when an active admin already exists, writes an `ADMIN_BOOTSTRAPPED` audit row with actor `cli:<windows-user>`; `--generate-password` prints a random password once and sets `must_change_password=true`. `reset-admin-password --username NAME` is the offline recovery path for a lost admin (needs OS access + `.env`). **No unauthenticated web setup endpoint**: CONTEXT's "first-run admin initialization wizard" is satisfied by `GET /api/health` returning `setup_required: true` so the login page can show "No administrator exists - run create-admin on the server"; a public create-admin endpoint would let whoever reaches the LAN port first become Admin. No seed users in any migration (test: fresh `alembic upgrade head` -> `SELECT count(*) FROM users` = 0); the legacy defaults must not reappear [VERIFIED: D:\dr-sr\app\services\auth_service.py:112-113 `default_username: str = "admin"`, `default_password: str = "kalyan@admin"`; v2.0 also used `ITERATIONS = 100000` PBKDF2 at line 18].

**[Superseded by EG-17 (user decision 2026-10-30): first-run web wizard with setup-mode-only availability and a one-time server-console setup code; `create-admin` dropped, `reset-admin-password` kept. See 11-11-PLAN.md.]**


### Pattern 5: Reusable row-scope helpers for D-03 / D-04 (question 3)

Phase 11 has no patient or clinical tables, so it ships the **mechanism and its tests**; Phases 12-15 only call it.
- `Principal` (frozen dataclass: `user_id, username, role, doctor_id, permissions, session_id`) is what dependencies return - never the ORM `User` (no lazy loads, role/doctor_id re-read from the DB on every request, so role changes apply immediately).
- `ScopeFamily` enum: `CLINICAL` (encounters, prescriptions, plans, session logs), `DEMOGRAPHIC` (patients, appointments), `FINANCIAL` (payments, receipts).
- `row_scope(principal, family, doctor_id_col) -> ColumnElement[bool]`, **default-deny** (`sqlalchemy.false()`): CLINICAL -> `doctor_id_col == principal.doctor_id` for DOCTOR with a non-null `doctor_id`, otherwise `false()` (ADMIN and RECEPTION get nothing - D-04 defence in depth even if a route were mis-guarded); DEMOGRAPHIC -> `true()` for RECEPTION/ADMIN, own rows for DOCTOR; FINANCIAL -> `true()` for RECEPTION/ADMIN, `false()` for DOCTOR [ASSUMED].
- `get_scoped_or_404(session, Model, id, principal, family, doctor_id_col)`: single query `WHERE id = :id AND <row_scope>`; no row -> 404 (never 403) so another doctor's record is indistinguishable from a missing one. List/search/count queries in later phases must build on the same helper (filter in SQL, never fetch-then-hide).
- Rows with `doctor_id IS NULL` are invisible to every doctor (default-deny): Phase 12 registration must assign a doctor or reception reassigns.
- Tests now (`tests/test_scope_helpers.py`): a test-only `TEMPORARY` table (`Table(..., prefixes=["TEMPORARY"])` created on the savepoint-isolated connection - the runtime role has no CREATE on the schema, but PUBLIC has TEMP by default [ASSUMED]) with rows for doctor A, doctor B and NULL; assert A sees only A's rows, `get_scoped_or_404` of B's row as A raises not-found, reception/admin see zero CLINICAL rows, unknown role sees zero. Later phases add their real models to a `SCOPED_MODELS` registry and a parametrized test reuses the same assertions.
- **Open risk to flag (not a re-litigation):** D-03 plus the v2.0 comment "two clinicians share one patient identity and one payment ledger" [VERIFIED: schema.sql:4] means a patient seen by both consultants needs an Admin-audited reassignment of `doctor_id`; the deferred idea (cross-case sharing) is post-v3.0. Record the reassignment rule in the register (default: Admin only, audited) - Phase 12/13 must implement it.

### Pattern 6: Optimistic concurrency with `version_id` (question 4, SEC-06 / D-08)

**Column and mapper:** every mutable entity gets `version_id INTEGER NOT NULL DEFAULT 1` (the name D-08 uses) and `__mapper_args__ = {"version_id_col": version_id}`. The `users` table is the first versioned entity; `doctors` (stub) too. Volatile/system columns on `users` (`failed_login_count`, `locked_until`, `last_login_at`) are written with Core `UPDATE` and never touch `version_id`.

**What the ORM guard does and does not do (SQLAlchemy 2.0.55, observed):**

| Case | Observed | Consequence |
|---|---|---|
| Two sessions both loaded v1; first commits; second flushes | `sqlalchemy.orm.exc.StaleDataError: UPDATE statement on table 'thing' expected to update 1 row(s); 0 were matched.` | Protects the server-side read-modify-write window. Import path is `sqlalchemy.orm.exc`, not `sqlalchemy.exc`. |
| Client opened the form at v1; DB is already at v2; the request loads the row fresh (v2) and saves | `UPDATE thing SET name=?, version_id=? WHERE thing.id = ? AND thing.version_id = ?` with params `('client-stale-edit', 3, 1, 2)` (new version 3, WHERE version 2) - **accepted, silently overwrote** | The ORM compares against the *loaded* version. Docs agree: the WHERE uses "the last version identifier we've been known to use on this object" and the page documents no client-supplied-version feature [CITED: docs.sqlalchemy.org/en/20/orm/versioning.html]. **The service must compare the client's `version_id` itself.** |
| Code assigns `obj.version_id = client_value` before flush | WHERE still used the loaded version, but **SET wrote the assigned value back** (counter went 3 -> 1) | Never assign `version_id` from input. Add a test that greps `src/` for `\.version_id\s*=`. |
| Core `UPDATE ... WHERE id=:id AND version_id=:v` | `rowcount` 0 on mismatch, 1 on match | Valid alternative for bulk/atomic updates; not needed in Phase 11. |

**Contract (client <-> server):** every entity JSON (detail and list items) carries `version_id`; every update request carries `version_id` **in the JSON body** (required, `>= 1`, missing -> 422), not `If-Match`/`ETag`: D-08 fixes the status as 409 while an `If-Match` mismatch is HTTP 412, and a body field is visible in OpenAPI and trivial for the hand-written client. After a successful write the response returns the NEW `version_id`; the SPA stores it for the next edit.

**Service steps:** `get_scoped_or_404` -> `require_version(entity, body.version_id)` (raises `VersionConflict`) -> mutate -> `session.flush()` -> build response -> teardown commit. Handlers map both `VersionConflict` and `StaleDataError` to `409 {"code": "version_conflict", "message": "Record was modified by another user", "entity": "user", "id": 5}` with `Cache-Control: no-store`.

**409 UX (D-08):** the SPA mutation helper catches `ApiError.code === "version_conflict"`, keeps the user's unsaved input on screen, and renders `<ConflictBanner>` (`role="alert"`, text "Record was modified by another user", one button "Reload latest") whose button invalidates the entity query and resets the form to the fetched values. Other 409 codes (`username_taken`, `last_admin`, `self_action_forbidden`) show their own messages, never the banner.

**Race-test technique on real PostgreSQL (Code Example CE-3):**
1. *Deterministic ORM race* (no threads, no HTTP): two `Session`s on two connections load the same `users` row, both change a field, first `commit()`s, second `commit()` must raise `StaleDataError`; then assert DB state equals the first writer's.
2. *Stale client over HTTP*: GET (v1) -> PATCH by client B (v1 -> v2) -> PATCH by client A with v1 -> 409 `version_conflict`; row and audit unchanged by A.
3. *Concurrent HTTP race*: 20 iterations; each iteration resets the row, starts two threads with their own logged-in `TestClient`, a `threading.Barrier(2)` releases both PATCHes with the same `version_id`; assert `sorted(statuses) == [200, 409]` every time and the final `version_id == start + 1`. Under READ COMMITTED the loser either fails the explicit compare (winner already committed) or blocks on the row lock and then matches 0 rows -> `StaleDataError` -> 409; both paths are covered. Mark `@pytest.mark.concurrency`; this test must use real commits (no SAVEPOINT fixture) and `pytest-timeout` guards deadlocks.

### Pattern 7: Audit writer and append-only enforcement (question 5, AUD-01)

**`audit_logs` columns** (DDL in CE-4): `id BIGINT GENERATED ALWAYS AS IDENTITY`, `occurred_at timestamptz DEFAULT now()`, `actor_user_id` (nullable FK, `ON DELETE RESTRICT`), `actor_username` (snapshot, `varchar(64)`; for failed logins it is the *attempted* name, truncated), `actor_role`, `action varchar(48)`, `outcome` (`SUCCESS|FAILURE|DENIED`), `entity_type`, `entity_id` (text), `before_data jsonb`, `after_data jsonb`, `reason varchar(500)` (D-06 reversal reason lives here too), `request_id uuid`, `ip inet`, `user_agent varchar(255)`. (`before`/`after` are SQL keywords; use `*_data`.) Indexes: `(occurred_at)`, `(action)`, `(entity_type, entity_id)`, `(actor_user_id, occurred_at)`. A nullable `patient_id`/`patient_urn` column is added by the Phase 12 migration when patients exist (the healthcare skill lists `patient_urn` as an audit field).

**Writer (one function, in-transaction):** `audit.record(session, ctx, action, entity_type, entity_id, *, before=None, after=None, reason=None, outcome=Outcome.SUCCESS)` does `session.add(AuditLog(...))` + `session.flush()`. `ctx` is an explicit `AuditContext(actor_user_id, actor_username, actor_role, ip, user_agent, request_id)` built by a dependency from the request/principal (CLI uses `AuditContext.system("cli:create-admin")`) - explicit parameter passing instead of contextvars, which are fragile across FastAPI's threadpool. If the audit insert fails the whole request rolls back (fail-closed - intended for a medical audit trail). `diff(before, after)` stores only changed fields. A redaction guard **raises** (does not silently strip) if a payload contains `password`, `password_hash`, `new_password`, `current_password`, `token`, `csrf_token`.

**No second "standalone" writer in Phase 11:** failed login and lockout are persisted by *returning* the 401 from the handler (Pattern 2), so they commit with the counter update. Auditing 403s/denied access and clinical `*_VIEWED` reads is a Phase 13+ extension (a read needs no business write; the same `SessionDep` commit covers it).

**Append-only, defence in depth (SQL in CE-4):**
1. `BEFORE UPDATE OR DELETE ... FOR EACH ROW` trigger raising `audit_logs is append-only`, and a **separate** `BEFORE TRUNCATE ... FOR EACH STATEMENT` trigger - TRUNCATE triggers can only be statement-level [CITED: postgresql.org/docs/18/sql-createtrigger.html: "triggers may be defined to fire for TRUNCATE, though only FOR EACH STATEMENT"].
2. Two DB roles: `kalyan_owner` (owns objects, runs Alembic, never used by the API) and `kalyan_app` (runtime). `REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM kalyan_app` (the runtime role only gets INSERT, SELECT) - a table owner/superuser could still `DROP TRIGGER`, which is why the API never runs as owner.
3. Tests (`test_audit_append_only.py`): as `kalyan_app`, `UPDATE`/`DELETE`/`TRUNCATE` -> `sqlalchemy.exc.ProgrammingError` (permission denied); as `kalyan_owner` (marker `db_owner`, own connection, committed unique row) -> `DBAPIError` whose message contains "append-only"; assert `pg_trigger` contains the three triggers (autogenerate and `alembic check` cannot see triggers or grants).

**Hash chain: not worth it in this budget.** It forces serialised inserts (each row hashes its predecessor -> a global lock), protects only against someone who already owns the database (who can recompute the chain), and needs a verifier job. Cheaper tamper-evidence with the same threat coverage for Phase 16: write a SHA-256 digest of each day's audit rows into the backup manifest stored on the second drive. Record "no hash chain" in the register.

**Events Phase 11 must emit** (`action` as `StrEnum`; entity type; notes):

| Action | Entity | Outcome | Payload |
|---|---|---|---|
| `AUTH_LOGIN_SUCCEEDED` | USER | SUCCESS | session id (not token) in `after_data` |
| `AUTH_LOGIN_FAILED` | USER (id if known, else null) | FAILURE | attempted username in `actor_username`; failure count after increment |
| `AUTH_ACCOUNT_LOCKED` | USER | FAILURE | `locked_until` |
| `AUTH_LOGIN_THROTTLED` | - | DENIED | ip (optional, volume-limited) |
| `AUTH_LOGOUT` | USER | SUCCESS | - |
| `AUTH_PASSWORD_CHANGED` | USER | SUCCESS | `{"must_change_password": [true, false]}` (never the password) |
| `USER_CREATED` | USER | SUCCESS | role, full_name, doctor_id; NOT the temporary password |
| `USER_UPDATED` / `USER_ROLE_CHANGED` | USER | SUCCESS | changed fields before/after (role change gets its own action) |
| `USER_DEACTIVATED` / `USER_REACTIVATED` | USER | SUCCESS | `is_active` before/after |
| `USER_PASSWORD_RESET` | USER | SUCCESS | `{"must_change_password": true}` only |
| `USER_UNLOCKED` | USER | SUCCESS | counters before/after |
| `ADMIN_BOOTSTRAPPED` / `ADMIN_PASSWORD_RESET_CLI` | USER | SUCCESS | actor `cli:<windows user>` |

v2.0 used free-text `details` and a name-string actor with `user_id` often NULL [VERIFIED: app/services/audit_service.py:21-29 `def log_event(self, action: str, entity_type: str, entity_id: Optional[str | int] = None, actor_name: str = "System", details: Optional[str] = "", user_id: Optional[int] = None)`]; v3.0 keeps the `action/actor/entity_type/entity_id/timestamp` skeleton and replaces `details` with structured JSON.

### Pattern 8: Alembic baseline, roles and the startup gate (question 7)

- **Where:** `backend/src/kalyan_api/migrations/` (`env.py`, `script.py.mako`, `versions/`) so the wheel built in Phase 17 ships them and the app can read the head revision at runtime; `backend/alembic.ini` is dev-only (`script_location = %(here)s/src/kalyan_api/migrations`). Production/CLI builds the `alembic.config.Config` programmatically (`kalyan_api.db.migrate.alembic_config(url)`).
- **History:** one linear history, hand-numbered ids: `alembic revision -m "baseline" --rev-id 0001` with `file_template = %%(rev)s_%%(slug)s` -> `0001_baseline.py`. Test `test_single_head` (`ScriptDirectory.get_heads()` has exactly one entry). Forward-only: downgrade = restore the pre-upgrade backup (Phase 16/17).
- **Naming convention** on `MetaData` [CITED: alembic.sqlalchemy.org/en/latest/naming.html pattern]: `ix_%(column_0_label)s`, `uq_%(table_name)s_%(column_0_name)s`, `ck_%(table_name)s_%(constraint_name)s`, `fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s`, `pk_%(table_name)s`. Every `CheckConstraint` needs `name=`.
- **`0001_baseline` creates:** `doctors` (stub: `id, name_en, is_active, version_id, created_at, updated_at`; Phase 12 `ALTER`s it), `users`, `sessions`, `login_throttle`, `audit_logs` + functions/triggers, explicit per-table `GRANT`s to `kalyan_app` via a small helper (not `ALTER DEFAULT PRIVILEGES`: explicit grants survive the test fixture's `DROP SCHEMA public CASCADE` and are reviewable): `users` without `DELETE` (SEC-05), `sessions` with `DELETE` (purge), `audit_logs` with `SELECT, INSERT` only (`UPDATE/DELETE/TRUNCATE` never granted), `GRANT SELECT ON alembic_version` only (no write access for the runtime role), `GRANT USAGE ON SCHEMA public TO kalyan_app`. Tables owned by `kalyan_owner` carry no default privileges for `kalyan_app`, so every needed privilege is an explicit line in the migration. **No seed rows.** No extensions needed in Phase 11 (`pg_trgm`/`citext` arrive with search in Phase 12; both are "trusted" extensions in PG13+ [ASSUMED]).
- **`users` essentials:** `username varchar(64)` stored lowercase with `UNIQUE`; `role varchar(16)` + named CHECK; `doctor_id bigint NULL UNIQUE REFERENCES doctors(id)` + named CHECK `((role = 'DOCTOR') = (doctor_id IS NOT NULL))`; `password_hash text`; `must_change_password`, `is_active`, `failed_login_count`, `locked_until`, `last_login_at`, `password_changed_at`; `created_by`; `created_at/updated_at timestamptz`; `version_id`. DOCTOR users: the create endpoint takes `doctor_name_en` and inserts the stub `doctors` row in the same transaction (Phase 12 completes the profile) - see Open Question 2.
- **Autogenerate traps** [CITED: alembic.sqlalchemy.org/en/latest/autogenerate.html]: does not detect table/column renames (appear as drop+add), anonymously named constraints, Enum on backends without native ENUM, sequences; CHECK constraints only by name and with "significant limitations"; server defaults only if `compare_server_default=True` (default off); triggers/functions/grants/comments are not covered at all. `compare_type` defaults to True since 1.12.0. Hence: hand-review every generated file, write triggers/grants as `op.execute(...)`, and keep two guard tests - `test_migrations_match_models` (calls `alembic.command.check(cfg)` after `upgrade head` on an empty database; `command.check` exists [VERIFIED: hasattr]) and `test_security_objects_present` (queries `pg_trigger`, `information_schema.role_table_grants`).
- **Config gotcha (verified):** `Config.set_main_option("sqlalchemy.url", url)` raises `ValueError: invalid interpolation syntax` when the rendered URL contains percent-encoded characters (`%40` for `@`). Always `.replace("%", "%%")`, and/or pass the URL via `config.attributes`; generate DB role passwords from `[A-Za-z0-9]` only. Build URLs with `sqlalchemy.engine.URL.create(...)` (verified: it keeps `p@ss%word#1` intact and `str(url)` hides the password).
- **Revision gate (app refuses to start on mismatch):** `lifespan` startup does `wait_for_db(timeout=60 s, backoff)` (the PC may boot before PostgreSQL finishes recovery after a power cut - Pitfall 4 in PITFALLS.md), then compares `MigrationContext.configure(conn).get_current_revision()` with `ScriptDirectory(...).get_current_head()` (both verified to exist); mismatch -> log a clear error and exit non-zero ("run `python -m kalyan_api.cli migrate`"). It also reads `SHOW synchronous_commit`, `SHOW fsync`, `SHOW full_page_writes` and, in production, refuses to start unless synchronous_commit is `on`/`remote_apply` and the other two are `on` - turning D-02 into an executable invariant [defaults verified in PG 18 docs: `synchronous_commit` "on (the default)", `full_page_writes` "The default is on"]. `/api/health` returns `{status, db, setup_required}` only.
- **Migration is an explicit step:** `python -m kalyan_api.cli migrate` (uses `KALYAN_DB_OWNER_*`); never `create_all()` or `upgrade` at startup (STACK.md "What NOT to Use").
- **Time:** all instants `timestamptz` (`DateTime(timezone=True)`); connection `TimeZone=Asia/Kolkata` and `ALTER DATABASE ... SET timezone TO 'Asia/Kolkata'`; business dates computed in Python with `ZoneInfo("Asia/Kolkata")` (needs `tzdata`; startup self-check resolves the zone); ruff `DTZ` bans naive datetimes.

### Pattern 9: Test harness on a shared PostgreSQL (questions 4, 11, 12)

- **Real PostgreSQL only** (no SQLite fallback; legacy skill's in-memory SQLite fixtures do not apply). Database `kalyan_test`, created by the bootstrap script. `conftest.py` **refuses to run** (`pytest.exit`) unless the configured database name ends with `_test` - the fixture drops the schema.
- **Session fixture:** as `kalyan_owner`: `DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;` then `alembic upgrade head` (this *is* the "migrate from empty" test and re-creates every grant/trigger). **API tests run as `kalyan_app`** so a missing `GRANT` fails in CI instead of on the hospital server.
- **Per-test isolation:** `conn = engine.connect(); outer = conn.begin(); Session(bind=conn, join_transaction_mode="create_savepoint")` (parameter exists in 2.0.55 [VERIFIED]); the `get_session` override yields it and commits (= releases the SAVEPOINT); teardown rolls back the outer transaction - no `DELETE`/`TRUNCATE` needed, so append-only `audit_logs` never needs cleanup.
- **Clock seam (not SQL `now()`):** inside the outer transaction PostgreSQL's `now()` is frozen at transaction start [ASSUMED standard PG behaviour], so any `now()`-based expiry/lock logic would misbehave under savepoint isolation. All application time comes from `kalyan_api.clock.utcnow()` and is passed as bind parameters; tests `monkeypatch.setattr(clock, "utcnow", ...)` to jump 31 minutes or 15 minutes instead of sleeping or editing rows. DB `DEFAULT now()` is allowed only for `created_at`-style columns.
- **Markers** (`--strict-markers`): `concurrency` (real commits on separate connections, unique usernames/ids, no cleanup because the schema is rebuilt every pytest session), `db_owner` (owner-role trigger tests), `slow`. Tests must not assert global `count(*)` on `audit_logs`; filter by `request_id`/`entity_id`/unique actor.
- **Starlette `TestClient`** uses `http://testserver`, so its cookie jar behaves like plain HTTP: a `Secure` cookie would not be returned - the login->`/me` round trip test is the guard. Use `httpx2` (Standard Stack).
- **Optional CI:** a second workflow file (do not edit `tests.yml`) with `services: postgres:` (image 18) and the same commands; only if the owner wants it - the dev PC will have PostgreSQL after Wave 0.

### Pattern 10: Frontend scaffold and SPA serving (question 8)

**Scope in this phase:** one Vite app with `/login`, `/change-password`, `/admin/*` (overview + Users), `/reception` and `/doctor` (shells that call their `overview` endpoint), `/403`, not-found; guards; hand-written API client; 409 banner; Vitest tests. No forms library, no component library (a native `<dialog>` for the user forms), no fonts (system stack; `@fontsource/noto-sans-devanagari` is Phase 12), no icon font, no `openapi-typescript`.

- **Files (mirrors the official template):** `package.json` with exact pins (`.npmrc`: `save-exact=true`, `engine-strict=true`; `engines.node: ">=22.22.2"`; `.nvmrc`: `24`), scripts `dev` = `vite`, `build` = `tsc -b && vite build`, `typecheck` = `tsc -b`, `lint` = `oxlint`, `test` = `vitest run`; `tsconfig.app.json` copied from the template (`"types": ["vite/client"]`, `moduleResolution: "bundler"`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `noUnusedLocals`) [VERIFIED: raw.githubusercontent.com/vitejs/vite/main/packages/create-vite/template-react-ts/tsconfig.app.json]; tests import `describe/it/expect/vi` explicitly from `vitest` (no `globals`). Tailwind: `@tailwindcss/vite` plugin + `@import "tailwindcss";` in `src/index.css`.
- **Routing:** data mode - `createBrowserRouter` (from `react-router`) + `<RouterProvider>` (from `react-router/dom`, "almost always" the right import per the RR docs [CITED: reactrouter.com/api/data-routers/RouterProvider]); route objects, area bundles lazy-loaded (`lazy: () => import(...)`) so reception PCs do not download admin code. Guards are **layout routes**: `RequireAuth` (uses `useQuery(['me'])`; spinner while loading; 401 -> `/login?reason=expired|signin`; `must_change_password` -> `/change-password`) and `RequireRole role="ADMIN"` (wrong role -> redirect to that user's home). `/` redirects to `ROLE_HOME[role]`. Guards are UX only (PROJECT.md); every API call is independently authorised.
- **API client:** `apiFetch<T>(path, {method, body, signal})` ~60 lines: prefix `/api`, `credentials: "same-origin"`, JSON, `X-CSRF-Token` from a module-level variable on non-GET, flattens the error envelope into `ApiError(status, code, message)`; a response with `code in {not_authenticated, session_expired}` clears the `me` cache and navigates to `/login?reason=expired`. The CSRF token is held in memory only (restored by `GET /api/auth/me` after a reload). Types for the ~12 endpoints are written by hand in `src/api/types.ts`; drift alarm = backend `test_openapi_snapshot` (committed `openapi.snapshot.json`; paths, methods, operationIds, request/response schema names) that fails when the API changes without updating the snapshot.
- **Idle UX:** a 401 `session_expired` shows "You were signed out after 30 minutes of inactivity" on `/login`. Optional (cut-line): `useActivityKeepAlive` - on `keydown/pointerdown`, at most every 5 min, call `GET /api/auth/me` so a user typing a long Phase 12 form is not signed out mid-entry (this reflects human activity; **never** let background polling touch the session - Pitfall 13).
- **Forms (ui-ux-pro-max applied):** visible `<label>`s, field-adjacent error text, `aria-invalid`/`aria-describedby`, submit buttons disabled while pending (prevents double submit), min 44 px targets, visible focus rings, `prefers-reduced-motion` respected, text-only status (no emoji icons), contrast >= 4.5:1.
- **Vitest:** `vite.config.ts` carries `test: { environment: "jsdom", setupFiles: "./src/test/setup.ts", css: false }` (`/// <reference types="vitest/config" />`, or import `defineConfig` from `vitest/config` if the type check complains) [ASSUMED - first `npm run typecheck` in Wave 0 confirms]; `setup.ts` imports `@testing-library/jest-dom/vitest` and registers `afterEach(cleanup)`. Tests: guards (anonymous, wrong role, must-change, correct role), login error rendering (401 message, 429 message), change-password validation, `ConflictBanner` reload behaviour, `apiFetch` (adds CSRF header on POST only; maps 401/409). `fetch` is stubbed with `vi.stubGlobal` (no MSW).
- **Serving the build from FastAPI - `app.frontend()` (verified on 0.162.0):**
  | Request (Accept) | Result |
  |---|---|
  | `GET /` and any SPA route such as `/reception/patients` (`text/html`) | 200 `index.html`, `ETag` + `Last-Modified`, **no `Cache-Control`** |
  | same SPA route with `Accept: application/json` | 404 JSON `{"detail":"Not Found"}` |
  | `GET /api/unknown` with `Accept: application/json`, `POST /api/unknown` | 404 JSON (API contract preserved) |
  | `GET /api/unknown` typed into the address bar (`text/html`) | 200 SPA shell (benign) |
  | `/assets/app-abc123.js` present / missing | 200 `text/javascript` with ETag / 404 JSON |
  | `HEAD /`, `HEAD /assets/...` | 200 |
  | raw-ASGI path traversal probes (`/../secret.txt`, `/assets/../../secret.txt`, `/%2e%2e/...`, `..\\`, `..%2f`) with a secret file placed outside `dist` | always the SPA shell, never the file |

  - Call `app.frontend("/", directory=<ABSOLUTE path from settings>, fallback="index.html", check_dir=False)` only when `<dist>/index.html` exists, otherwise log a warning and serve API only. **Never pass a relative `directory`**: it resolves against the process cwd and the repo already has a legacy PyInstaller `D:\dr-sr\dist` [VERIFIED: directory listing].
  - Docs: API routes win over frontend files; HTTP middleware and dependencies apply to frontend responses [CITED: fastapi.tiangolo.com/tutorial/frontend/]. **Observed: an app-level global dependency also runs for frontend requests** (with `scope["route"] = None`) - so put only cheap, method-gated checks (the Origin check for unsafe methods) in global dependencies; authentication must never be global or the login page would be blocked.
  - Cache headers via a small `@app.middleware("http")`: `/assets/*` -> `public, max-age=31536000, immutable`; `text/html` responses -> `no-cache`; `/api/*` -> `no-store` (the native frontend sets none).
  - Dev: Vite on :5173 proxying `/api` to `http://127.0.0.1:8000` (no `changeOrigin`, no CORS); prod/LAN: `npm --prefix frontend run build`, then uvicorn serves `frontend/dist` on :8000. The earlier hand-rolled `StaticFiles` + catch-all is only a fallback.

## Wave 0: Windows Toolchain Bootstrap (question 9)

Environment facts were probed on this dev PC (Windows 11 Home 10.0.26300, 7.3 GB RAM; C: 185 GB free, D: 10.2 GB free); the winget IDs/versions below were verified with `winget search/show` here, but the install steps themselves have **not** been executed. PostgreSQL data stays on C: (default); the repo and `node_modules` live on D:. Steps marked **HUMAN** need UAC or a password typed by a person - an agent must not type passwords.

| # | Step | Command / action | Expected / verify |
|---|------|------------------|-------------------|
| W0-1 | Record the entry gate | Create `11-ENTRY-GATE.md` (template below) and commit before any `backend/` or `frontend/` file | `git log` ordering check below |
| W0-2 | **HUMAN** Node 24 LTS | `winget install --id OpenJS.NodeJS.LTS --version 24.22.1 --exact --source winget --accept-package-agreements --accept-source-agreements` (UAC prompt); open a NEW terminal | `node --version` -> `v24.22.1`; `npm --version` -> `11.x` |
| W0-3 | Package-legitimacy seam | With Node present: `gsd_run query package-legitimacy check --ecosystem pypi <backend names>` and `--ecosystem npm <frontend names>` | Any SUS/SLOP overrides the Package Legitimacy Audit table |
| W0-4 | **HUMAN** PostgreSQL 18.6 | `winget install --id PostgreSQL.PostgreSQL.18 --version 18.6-5 --exact --source winget --interactive --accept-package-agreements --accept-source-agreements` - choose **PostgreSQL Server + Command Line Tools** (pgAdmin optional, Stack Builder not needed), default install/data directories, port 5432, default locale, type a strong superuser password and keep it in a password manager (never in the repo, shell history, or `--superpassword`) | `Get-Service postgresql*` shows a Running service (name expected `postgresql-x64-18` [ASSUMED]) |
| W0-5 | psql on PATH | `$env:Path += ";C:\Program Files\PostgreSQL\18\bin"` (session) or add to the user PATH | `psql --version` -> `psql (PostgreSQL) 18.6` |
| W0-6 | Check/lock durability + network | `psql -h 127.0.0.1 -U postgres -c "SHOW listen_addresses;" -c "SHOW synchronous_commit;" -c "SHOW fsync;" -c "SHOW full_page_writes;" -c "SHOW data_directory;"`; then `psql ... -c "ALTER SYSTEM SET listen_addresses = 'localhost';"` and, in an elevated PowerShell, `Restart-Service postgresql-x64-18` | `synchronous_commit` = `on` (D-02: do **not** change), `fsync` = `on`, `full_page_writes` = `on`, `listen_addresses` = `localhost` (PG default is `localhost`, "can only be set at server start" [CITED: postgresql.org/docs/18/runtime-config-connection.html]; the EDB installer's own default is unverified [ASSUMED] - always set it explicitly) |
| W0-7 | **HUMAN** roles + databases | `psql -h 127.0.0.1 -U postgres -v ON_ERROR_STOP=1 -f backend\db\bootstrap.sql` (CE-5). The script `CREATE ROLE`s without passwords and then runs `\password kalyan_owner` / `\password kalyan_app` (hidden prompts - type letters+digits only, 24+ chars) | `psql -h 127.0.0.1 -U kalyan_app -d kalyan_dev -c "SELECT current_user"` succeeds |
| W0-8 | Verify UTF-8 / Devanagari / timezone | `SELECT datname, pg_encoding_to_char(encoding), datlocprovider, datlocale FROM pg_database WHERE datname LIKE 'kalyan%';` then `SELECT lower('ÉCOLE'), ('अमित शर्मा' ILIKE '%मित%'), current_setting('TimeZone');` (set `chcp 65001` / `$env:PGCLIENTENCODING='UTF8'` first) | [ASSUMED outputs] `UTF8`, provider `b`, locale `C.UTF-8`; `école`, `t`, `Asia/Kolkata`. If the `builtin` provider is rejected, fall back to `LOCALE_PROVIDER icu ICU_LOCALE 'und'` (needs an ICU-enabled build [ASSUMED for EDB]) and record it |
| W0-9 | `.gitignore` | Append `node_modules/`, `*.tsbuildinfo`, `coverage/` before the first install | `git status` stays quiet after `npm install` |
| W0-10 | Python env | `python -m venv backend\.venv` -> `pip install -e "backend[dev]"` -> `pip freeze --exclude-editable > backend\requirements.lock.txt` | `python -c "import fastapi,sqlalchemy,psycopg"` works; `psycopg.pq.__impl__` = `binary` |
| W0-11 | `backend\.env` | **HUMAN** creates from `.env.example`: DB host `127.0.0.1` (not `localhost`, avoids IPv6-first resolution delays [ASSUMED]), both role passwords | App refuses to start when a password is empty/placeholder |
| W0-12 | Frontend env | `npm --prefix frontend install` then `npm --prefix frontend run typecheck` | exit 0 confirms the TS 7 + Vitest + jest-dom type setup |

Notes: winget's `PostgreSQL.PostgreSQL.18` manifest 18.6-5 is an `exe`, `Scope: machine`, silent switches `--mode unattended --unattendedmodeui none`, release date 2026-10-01, SHA-256 `227E2BC08091B4C2B8338C7D61B11D057F895711480B006F90BFCFCD2410A58A` [VERIFIED: raw.githubusercontent.com/microsoft/winget-pkgs manifest 18.6-5; installer URL `get.enterprisedb.com/postgresql/postgresql-18.6-5-windows-x64.exe`]. EDB's documented unattended options include `--superpassword`, `--serverport` (5432), `--servicename`, `--datadir`, `--prefix`, `--enable-components` (default `server pgAdmin stackbuilder commandlinetools`) [CITED: enterprisedb.com/docs/supported-open-source/postgresql/installing/command_line_parameters/], but the interactive wizard is preferred so the password never touches a command line. Keep the installer for Phase 17's offline restore ("Offline Distribution Supported: true" in winget). `OpenJS.NodeJS.LTS` currently resolves to 26.13.0 (LTS since 2026-10-28); `--version 24.22.1` pins the Krypton line [VERIFIED: `winget show --versions`].

## Entry-Gate Decision Record (question 10, success criterion 1)

**Where / format:** one committed file `.planning/phases/11-decisions-gate-foundation-auth/11-ENTRY-GATE.md`, created by the very first plan task and committed before any `backend/`, `frontend/` or schema/API file. It is a register (table) plus an accepted-risk section; each locked decision is also added as a row to `PROJECT.md` "Key Decisions" (project convention: "Decisions to log? -> Add to Key Decisions") pointing back to the register. Do **not** use the root `DECISIONS.md` (superseded v2.0 ADR log). Client acknowledgement evidence (short WhatsApp/email text, per PITFALLS gate guidance) is referenced in the `Evidence` column.

**Machine checks for the plan's verification step (PowerShell):**
```powershell
$gate = git log --diff-filter=A --format=%ct -- ".planning/phases/11-decisions-gate-foundation-auth/11-ENTRY-GATE.md" | Select-Object -Last 1
$code = git log --diff-filter=A --format=%ct -- backend frontend | Select-Object -Last 1
if ($gate -and (-not $code -or [int64]$gate -le [int64]$code)) { "OK: gate precedes code" } else { "FAIL: entry gate not committed before code" }
Select-String -Path ".planning/phases/11-decisions-gate-foundation-auth/11-ENTRY-GATE.md" -Pattern '\|\s*OPEN\s*\|'   # must print nothing
```

**Register skeleton** (`Status`: LOCKED = decided by the project owner in 11-CONTEXT.md, 2026-10-30; DEFAULT = assumption in force until confirmed; every row has an owner and a confirm-by phase; `Evidence` is empty until the client answers):

| ID | Item | Decision / default | Status | Source | Owner | Confirm by | If it changes |
|----|------|--------------------|--------|--------|-------|-----------|---------------|
| EG-1 | Server hardware | Dedicated always-on Windows PC, >= 4 GB RAM, SSD preferred, second physical drive/USB for backups, no daily-use login | DEFAULT | PROJECT.md "not yet confirmed" | Trust administrator | before Phase 17 | Sizing, backup target |
| EG-2 | UPS | 600VA+ line-interactive UPS on the server; `synchronous_commit = on` | LOCKED (D-02) - client purchase unconfirmed | CONTEXT D-02 | Trust administrator | before Phase 17 | Costly: durability config. No UPS -> written risk acceptance |
| EG-3 | Fixed IP / name | DHCP reservation (example 192.168.1.50); optional single-label alias `kalyan-server` via hosts file; never a fake FQDN | DEFAULT | CONTEXT D-01 example | Trust administrator / project owner | before Phase 17 | Bookmarks, firewall rule |
| EG-4 | Transport | Plain HTTP on the isolated LAN; client PCs install no certificate; HTTPS deferred (FUT-01) | LOCKED (D-01) | CONTEXT D-01, Deferred | Project owner | - | Cookie `Secure`/`__Host-` flip; webcam capture becomes possible |
| EG-5 | Network isolation condition | Wired or staff-only Wi-Fi; no guest/patient devices on the subnet; no router port-forwarding | DEFAULT | RISK-01 | Trust administrator | before Phase 17 | RISK-01 likelihood |
| EG-6 | Doctor visibility | Strict silo by `doctor_id` (supersedes the ROADMAP "recommended: read yes, write only own"); reassignment of a patient to the other doctor = Admin-only, audited | LOCKED (D-03) + reassignment DEFAULT | CONTEXT D-03 | Both consultants + trust administrator | before Phase 13 | One-way: scopes across all clinical tables |
| EG-7 | Role/permission matrix | Pattern 1 tables; Reception has no clinical permission (D-04); Admin has no clinical-content permission and uses only `/admin` | LOCKED (D-04) + rest DEFAULT | CONTEXT D-04 | Trust administrator | before Phase 13 | Matrix snapshot test + ROLE_PERMISSIONS |
| EG-8 | Receipt numbering year | Configurable; default Indian FY (`RCPT-2627-XXXX`), alternative calendar year | LOCKED (D-05) | CONTEXT D-05 | Trust accountant | before Phase 15 | Costly: billing sequence generators |
| EG-9 | Who authorises reversals | Admin only, mandatory reason, contra-record, audit row | LOCKED (D-06) | CONTEXT D-06 | Trust administrator | before Phase 15 | Permission `payment:reverse` |
| EG-10 | Session & lockout | 30 min idle, 5 failures -> 15 min lock, admin unlock (D-07); defaults: 12 h absolute, min password 10, per-IP throttle 20 failures/15 min, multiple concurrent sessions | LOCKED (D-07) + extras DEFAULT | CONTEXT D-07 | Project owner (trust administrator informed) | before Phase 17 | Settings only |
| EG-11 | Concurrency UX | `version_id` + 409 + "Record was modified by another user" + 1-click reload | LOCKED (D-08) | CONTEXT D-08 | Project owner | - | - |
| EG-12 | Audit tamper-evidence | Append-only (triggers + INSERT-only role); no hash chain; daily digest in backup manifest considered for Phase 16 | DEFAULT | Pattern 7 | Project owner | before Phase 16 | Phase 16 scope |
| EG-13 | Real v2.0 data to migrate | None assumed (PROJECT.md: synthetic data); not part of this gate | DEFAULT | REQUIREMENTS "Open Decisions" | Project owner | before Phase 12 | FUT-03 |

**Accepted-risk section:** `RISK-01 Plaintext credentials and session on the LAN` (full text in Pattern 3) with accept/review fields; `RISK-02 Server is a single point of failure` (paper-pad fallback, restore runbook - Phase 16/17); `RISK-03 Lockout can be abused to deny a known account for 15 minutes` (admin unlock + CLI).

## Suggested Plan Decomposition and Cut Line (advisory)

`config.json` has `parallelization: false`, so waves run sequentially. Dependencies drive this order (policy markers need `current_principal`; users admin needs policy + audit + versioning; the SPA needs the API contract):

| Plan | Wave | Content | Requirements | Human checkpoints |
|------|------|---------|--------------|-------------------|
| 11-01 | 0 | Entry-gate register (`11-ENTRY-GATE.md`, PROJECT.md Key Decisions rows, RISK-01..03), `.gitignore` additions, Node 24.22.1, package-legitimacy seam run, PostgreSQL 18.6-5, `bootstrap.sql`, `.env`, PG setting checks (W0-1..W0-9, W0-11) | SC-1 (gate) | UAC installs, superuser/role passwords |
| 11-02 | 1 | `backend/` skeleton: `pyproject.toml`, config, clock, naming convention, models, Alembic env + `0001_baseline` (tables, triggers, grants), `cli migrate/check-db`, `conftest.py` fixtures, migration + stack-smoke tests, W0-10 | AUD-01 (schema), SEC-03 (role CHECK) | - |
| 11-03 | 2 | Auth core: Argon2, tokens, `sessions`, `current_principal`, login/logout/me/change-password, CSRF/Origin, lockout + throttle, forced change, audit writer + auth events, tests (clock seam) | SEC-01, SEC-04, AUD-01, SEC-05 (forced change) | - |
| 11-04 | 3 | `Permission`/`Role`/`ROLE_PERMISSIONS`, policy markers, `require`, route-walk + negative control + matrix + completeness tests, `row_scope`/`get_scoped_or_404` + TEMPORARY-table tests, `GET /api/<area>/overview` | SEC-02, SEC-03 | - |
| 11-05 | 3 | Users admin API (create/update/role/deactivate/reactivate/reset/unlock), `version_id` + 409, `create-admin` / `reset-admin-password` CLI, audit events, race tests, `last_admin`/self guards | SEC-05, SEC-06, AUD-01 | - |

**[Superseded by EG-17 (user decision 2026-10-30): first-run web wizard with setup-mode-only availability and a one-time server-console setup code; `create-admin` dropped, `reset-admin-password` kept. See 11-11-PLAN.md.]**

| 11-06 | 4 | `frontend/` scaffold (Vite/React/TS/Tailwind/Vitest/oxlint), API client, guards, Login / ChangePassword / Users admin / shells, ConflictBanner, `app.frontend` serving + `test_spa_serving.py`, `npm run build` | SEC-01, SEC-06 (UX) | W0-12 (`npm install`) |
| 11-07 | 5 | Phase gate: full suite + coverage, ruff/oxlint/tsc/build, legacy-untouched check, `requirements.lock.txt`, manual UAT (second LAN device, 409 banner, psql audit check), update PROJECT.md/STATE | all | Browser/LAN UAT |

**Cut line if the Rs 22,000 / 4-6 week budget slips (cut in this order, never the "keep" list):** (1) optional keep-alive hook, `route_class` boot guard, CI workflow, `bench-hash` CLI; (2) per-IP `login_throttle` table (keep per-account lockout, which D-07 requires); (3) runtime/owner role split (keep the audit triggers and add a DELETE-blocking trigger on `users` instead of the privilege); (4) the stub `doctors` table (test D-03 with the TEMPORARY table only). **Keep:** route-walk test + matrix, default-deny scope helpers, `version_id` + explicit compare + 409, sessions with idle/absolute limits, forced password change, CLI-only admin bootstrap, append-only audit with same-transaction writes, entry-gate register. ARCHITECTURE.md budgeted about 12 days for foundation + auth + audit and 4 days for the frontend shell; this phase is the largest single slice of the 4-6 weeks.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Password hashing | PBKDF2/own salt scheme (v2.0 did) | `argon2-cffi` `PasswordHasher` | Encoded hash carries parameters; `check_needs_rehash`; OWASP-aligned. |
| Session/CSRF token generation | `random`, uuid4, timestamps | `secrets.token_urlsafe` + `hmac.compare_digest` | CSPRNG and constant-time compare. |
| Route enumeration for the authz test | Parsing `app.routes` by hand | `fastapi.routing.iter_route_contexts` | `app.routes` is lazy `_IncludedRouter` on 0.162.0. |
| SPA static serving + fallback | Custom catch-all route / `StaticFiles` subclass | `app.frontend(...)` | Handles HEAD, Accept-gating, 404s, traversal (verified). |
| Schema creation/versioning | `create_all()` at startup, ad-hoc SQL scripts | Alembic with naming convention | Documented upgrade path after handover. |
| Time zones | Manual `+5:30` offsets | `zoneinfo` + `tzdata`, `timestamptz` | Windows has no tz database (reproduced failure). |
| Optimistic locking counter | Custom `UPDATE ... SET v = v + 1` everywhere | SQLAlchemy `version_id_col` + explicit client compare | ORM increments atomically at flush. |
| Atomic counters (lockout, throttle) | Read-modify-write in Python | Single `UPDATE ... RETURNING` / `INSERT ... ON CONFLICT DO UPDATE` | No lost updates under concurrency. |
| Rate limiting service | Redis/slowapi | One-row-per-IP table | No new service; survives restarts. |
| Tamper-evident audit | In-DB hash chain | Triggers + role grants (+ daily digest later) | Chain serialises writers and adds nothing against a DB owner. |
| Password strength estimation | zxcvbn port | Length + small blocklist | Adequate for 10 named staff; no dependency. |
| JSON error shapes | Per-endpoint dicts | One envelope + registered handlers | The SPA reads one shape. |
| TS API types | Parser of OpenAPI | Hand-written types now; revisit generator after TS/openapi-typescript support | Peer conflict with TS 7. |

**Key insight:** every item above is either a security primitive or a framework mechanism whose failure mode is silent (vacuous test, post-response commit, frozen `now()`, lost counter update); the project's safety comes from using the exact verified mechanism and testing the failure mode, not from custom code.

## Common Pitfalls

### Pitfall 1: The authorization route-walk silently tests nothing (FastAPI 0.162.0)
**What goes wrong:** the textbook test `for r in app.routes: if isinstance(r, APIRoute): ...` enumerates zero routes after `include_router` (one `_IncludedRouter`), so SEC-02's "automated test fails if any route lacks a permission check" can never fail.
**Why it happens:** FastAPI moved to lazily-included routers; old tutorials and `PITFALLS.md`/`STACK.md` describe the old shape.
**How to avoid:** `fastapi.routing.iter_route_contexts(app.routes)` + the must-exist route assertion + public allow-list equality (CE-1). Pin FastAPI exactly; a version bump re-runs the same test as a canary.
**Warning signs:** the test passes on a deliberately unprotected dummy route (add one in a negative test: build a throwaway app with an unprotected route and assert the walker reports it).

### Pitfall 2: Commit after the response was already sent
**What goes wrong:** with the default `Depends(get_session)` scope, `session.commit()` after `yield` runs after the client got 200; a stale version, audit-insert failure or deferred constraint is logged but invisible to the user, who believes the save succeeded.
**How to avoid:** `scope="function"` via the `SessionDep` alias; every request-scoped dependency with `yield` that touches the DB uses the same alias. A test makes the audit insert fail (monkeypatch) and asserts a non-2xx response and no business row.

### Pitfall 3: Expected failures that must persist are raised, so they roll back
**What goes wrong:** `raise HTTPException(401)` from the login handler rolls back `failed_login_count` and the audit row; lockout never triggers.
**How to avoid:** return the response for login failures (Pattern 2/4); test "5 bad logins -> row locked + 5 audit rows". The same applies to any future "denied + audited" flow.

### Pitfall 4: PostgreSQL `now()` is the transaction start time
**What goes wrong:** under the SAVEPOINT test fixture (and in any long request) `now()` never advances, so idle/lock expiry computed in SQL looks frozen.
**How to avoid:** Python `clock.utcnow()` seam passed as bind parameters; tests patch it. `DEFAULT now()` only for informational `created_at`.

### Pitfall 5: ORM versioning that does not actually prevent lost updates
See Pattern 6: compare the client's `version_id`; never assign it; build the response after `flush()`; Core `UPDATE`s for volatile columns do not bump it (otherwise a failed login 409s an admin mid-edit).

### Pitfall 6: Plain-HTTP traps
(a) Setting `Secure` (or the `__Host-` prefix) makes login succeed but every later request 401 - verified live; keep `cookie_secure=false` explicit and test the round trip. (b) Do not build CSRF on `Sec-Fetch-Site` - never sent to `http://192.168.x.x`. (c) `crypto.randomUUID()`, `crypto.subtle`, `getUserMedia`, clipboard API, service workers are unavailable (secure-context only); do not add a PWA; use `crypto.getRandomValues` for client keys. (d) Browser session restore can revive session cookies, so keep server-side idle/absolute limits. (e) Use IP or a single-label hostname; Chrome 154's HTTPS-first warning exempts only those private forms.

### Pitfall 7: Dependency churn
FastAPI shipped ~30 releases in 5 days (18-23 Oct 2026); Starlette is 1.x and FastAPI leaves it unbounded; Pydantic 2.14.2 and pytest 9.2.0 are days old. Pin every direct dependency exactly, commit `requirements.lock.txt` and `package-lock.json`, never run `pip install -U`/`npm update` mid-phase; upgrades are separate tasks that rerun CE-1 and the full suite. `StarletteDeprecationWarning` for `httpx` disappears with `httpx2`.

### Pitfall 8: Alembic blind spots and config escaping
Autogenerate misses triggers, grants, renames, anonymous constraints and (by default) server defaults; `Config.set_main_option` raises on percent-encoded passwords (verified). Hand-review `0001`, keep `test_migrations_match_models` and `test_security_objects_present`, escape `%` as `%%`, build URLs with `URL.create`, keep DB passwords alphanumeric. `alembic_version` must be readable by the runtime role (revision gate) but not writable.

### Pitfall 9: Test database safety and append-only data
The fixture drops `public`: refuse to run unless the DB name ends `_test`. Audit rows can never be cleaned (that is the point): rely on rollback isolation and, for committed concurrency tests, on the per-session schema rebuild; never assert global counts. `TRUNCATE` bypasses row triggers: keep the statement-level trigger and the revoked privilege. Do not run the API as `kalyan_owner`.

### Pitfall 10: Windows specifics
`ZoneInfo("Asia/Kolkata")` fails without `tzdata` (reproduced) - add it and self-check at startup; psycopg async + Proactor loop (avoided by sync); connect to `127.0.0.1` rather than `localhost` [ASSUMED IPv6-first delay]; PostgreSQL's `bin` directory is not on PATH after install [ASSUMED]; first bind of `0.0.0.0:8000` triggers a Windows Defender Firewall prompt (choose Private network or bind `127.0.0.1` in dev); Windows PowerShell 5.1 has no `&&` (use `;` or `if ($?)`); psql console output of Devanagari needs `chcp 65001`.

### Pitfall 11: Collisions with the legacy repo
Package name `app`; `pytest` invoked with both suites; `.gitignore` lacks `node_modules/` but ignores any folder named `data`, `build`, `dist`; `app.frontend(directory="dist")` relative to cwd picks the legacy PyInstaller `D:\dr-sr\dist`; root `.vscode/settings.json` and `pyrightconfig.json` point at the legacy `.venv` (open `backend/` as its own VS Code folder or add a `backend/pyrightconfig.json`); `DECISIONS.md` at the root is the superseded v2.0 ADR log.

### Pitfall 12: Global dependencies and the docs UI
App-level dependencies also execute for frontend requests (observed) - authentication/permission must never be global. FastAPI's default `/docs` loads Swagger assets from a CDN (violates "no CDN/offline") - disable docs/redoc/openapi in the app; produce the spec with `cli export-openapi`.

### Pitfall 13: Idle timeout versus polling and long forms
Phase 13's `refetchInterval` queue polling would keep a session alive forever if every API call touches `last_seen_at`; design now: polling requests carry `X-Kalyan-Passive: 1` and the touch is skipped (a client can only shorten its own session by sending it). Conversely, a user typing a long form for > 30 min loses the save with a 401; the optional activity keep-alive hook (Pattern 10) covers it.

### Pitfall 14: Enumeration and lockout abuse
Unknown user, wrong password and locked account return the same 401 text and equal timing (dummy hash). A known account can be locked by 5 bad guesses; that residual is accepted (RISK-03).

### Pitfall 15: Frontend toolchain conflicts
`typescript-eslint@8.72.1` (peer `typescript >=4.8.4 <6.1.0`) and `openapi-typescript@7.13.0` (peer `^5.x`) conflict with TS 7; do not add them. Node floor is 22.22.2 for the pinned set (jsdom), not Vite's 20.19; use `@types/node@24`, not 26, with Node 24. Native optional dependencies (rolldown, lightningcss, tailwind oxide, typescript-win32-x64) install per platform with no install hooks; `npm ci` on the same OS is reproducible. Windows `node_modules` on D: is fine (10 GB free).

### Pitfall 16: Scope helper edge cases (D-03/D-04)
Rows with `doctor_id IS NULL` are invisible to doctors (default-deny); out-of-scope object ids return 404, lists and counts must use the same predicate, "update/finalise" endpoints must also load through `get_scoped_or_404` (not by bare id), and `users.doctor_id` must be non-null exactly when `role = 'DOCTOR'` (CHECK).

### Pitfall 17: Durability configuration can be overridden below `postgresql.conf`
`ALTER DATABASE/ROLE ... SET synchronous_commit = off` overrides the server default; the startup check reads the effective value on the app's own connection and refuses to start in production if it is not `on`/`remote_apply` (D-02).

## Code Examples

Patterns marked **[verified]** were executed in the 2026-10-30 throw-away venv; **[sketch]** blocks are the intended shape and must be run in Wave 1.

### CE-1: Policy markers and the route-walk test (SEC-02) [verified shape]
```python
# backend/src/kalyan_api/core/policy.py
from dataclasses import dataclass
from typing import Callable
from fastapi import Depends, HTTPException

@dataclass(frozen=True)
class Policy:
    kind: str                                  # "public" | "authenticated" | "permission"
    permissions: frozenset[str] = frozenset()

def _mark(fn: Callable, policy: Policy) -> Callable:
    fn.__policy__ = policy                     # read by tests via iter_route_contexts
    return fn

def public() -> None:
    """Marker: intentionally reachable without a session (health, login)."""
_mark(public, Policy("public"))

def authenticated_only(principal=Depends(current_principal_allow_pending)):    # me / logout / change-password
    return principal
_mark(authenticated_only, Policy("authenticated"))

def require(*needed):                          # needed: Permission members; ALL must be held
    if not needed:
        raise ValueError("require() needs at least one permission")
    def dependency(principal=Depends(current_principal)):                      # rejects must_change_password, checks CSRF
        if not set(needed) <= principal.permissions:
            raise HTTPException(403, detail={"code": "forbidden", "message": "You do not have permission to do this."})
        return principal
    return _mark(dependency, Policy("permission", frozenset(p.value for p in needed)))

# usage - policy goes on the ROUTE decorator, exactly one per route
# @router.get("", dependencies=[Depends(require(Permission.USER_READ))])
```
```python
# backend/tests/test_route_policies.py
from fastapi.routing import iter_route_contexts
from kalyan_api.main import create_app

PUBLIC_ALLOWLIST = {("GET", "/api/health"), ("POST", "/api/auth/login")}
MUST_EXIST = {("POST", "/api/auth/login"), ("GET", "/api/auth/me"), ("GET", "/api/users"), ("POST", "/api/users")}

def _policies(dependant):
    for sub in dependant.dependencies:
        pol = getattr(sub.call, "__policy__", None)
        if pol is not None:
            yield pol
        yield from _policies(sub)

def _routes(app):
    for ctx in iter_route_contexts(app.routes):
        dep = getattr(ctx, "dependant", None)          # None for docs/mount/static contexts
        for method in sorted((ctx.methods or set()) - {"HEAD", "OPTIONS"}):
            yield method, ctx.path, dep

def test_every_route_has_exactly_one_policy(test_settings):
    app = create_app(test_settings)                    # no lifespan -> no DB needed
    seen = {(m, p) for m, p, _ in _routes(app)}
    assert MUST_EXIST <= seen, f"route enumeration incomplete (vacuous test?): {MUST_EXIST - seen}"
    problems, public = [], set()
    for method, path, dep in _routes(app):
        if dep is None:
            problems.append(f"{method} {path}: non-API route present (docs/mount) - not allowed in the API app")
            continue
        pols = list(_policies(dep))
        if len(pols) != 1:
            problems.append(f"{method} {path}: expected exactly 1 policy marker, found {len(pols)}")
        elif pols[0].kind == "public":
            public.add((method, path))
    assert not problems, "\n".join(problems)
    assert public == PUBLIC_ALLOWLIST
```
Observed on the experiment app: `GET /api/oops` (no marker) -> `policies=[]` and was reported; `POST /api/users` with a router-level and a decorator-level marker showed both; the optional boot guard `APIRouter(route_class=PolicyRoute)` raised `RuntimeError: route /nope has no policy dependency` at registration.

### CE-2: Unit of work and the 409 handler [verified shape on SQLite; rerun on PostgreSQL]
```python
# backend/src/kalyan_api/db/session.py
from collections.abc import Iterator
from typing import Annotated
from fastapi import Depends
from sqlalchemy.orm import Session, sessionmaker

SessionLocal = sessionmaker(expire_on_commit=False)       # SessionLocal.configure(bind=engine) in lifespan

def get_session() -> Iterator[Session]:
    session = SessionLocal()
    try:
        yield session
        session.commit()            # scope="function": runs BEFORE the response is sent
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()

SessionDep = Annotated[Session, Depends(get_session, scope="function")]    # use this alias everywhere
```
```python
# registered in create_app: both end up as the same envelope
app.add_exception_handler(StaleDataError, version_conflict_handler)     # from sqlalchemy.orm.exc import StaleDataError
app.add_exception_handler(VersionConflict, version_conflict_handler)
# -> JSONResponse(409, {"code": "version_conflict", "message": "Record was modified by another user", "entity": ..., "id": ...},
#                 headers={"Cache-Control": "no-store"})
```
Tests override with `app.dependency_overrides[get_session] = override` where `override` is a generator that yields the test session and commits after the yield (verified to work with the `scope="function"` alias; a failing teardown still produced 409).

### CE-3: Versioned entity, explicit compare, race tests [verified semantics; sketch for PostgreSQL]
```python
# models/user.py (excerpt)
class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True)
    # ... role, doctor_id, password_hash, must_change_password, is_active, failed_login_count, locked_until ...
    version_id: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")
    __mapper_args__ = {"version_id_col": version_id}

# core/errors.py
def require_version(entity, expected: int, label: str) -> None:
    if entity.version_id != expected:
        raise VersionConflict(label, entity.id)

# services/user_service.py (excerpt)
user = get_scoped_or_404(...)                       # 404 if missing
require_version(user, body.version_id, "user")      # stale client form -> 409
before = snapshot(user, UPDATABLE); user.full_name = body.full_name or user.full_name
session.flush()                                     # version_id is now N+1 -> response carries it
audit.record(session, ctx, AuditAction.USER_UPDATED, "USER", user.id, before=before, after=snapshot(user, UPDATABLE))
```
```python
@pytest.mark.concurrency
def test_orm_two_session_race(app_engine, committed_user):
    s1, s2 = Session(app_engine), Session(app_engine)
    u1, u2 = s1.get(User, committed_user.id), s2.get(User, committed_user.id)
    u1.full_name = "Writer One"; s1.commit()
    u2.full_name = "Writer Two"
    with pytest.raises(StaleDataError):
        s2.commit()
    s2.rollback()

@pytest.mark.concurrency
def test_http_race_one_wins(make_client, committed_user):
    for _ in range(20):
        a, b = make_client("admin"), make_client("admin")       # two logged-in TestClients, real commits
        start = a.get(f"/api/users/{committed_user.id}").json()["version_id"]
        barrier = threading.Barrier(2)
        def patch(c, name):
            barrier.wait(timeout=5)
            return c.patch(f"/api/users/{committed_user.id}", json={"full_name": name, "version_id": start}).status_code
        with ThreadPoolExecutor(2) as ex:
            codes = sorted(f.result(timeout=30) for f in [ex.submit(patch, a, "A"), ex.submit(patch, b, "B")])
        assert codes == [200, 409]
        assert a.get(f"/api/users/{committed_user.id}").json()["version_id"] == start + 1
```

### CE-4: `audit_logs`, append-only triggers and grants (inside `0001_baseline`) [sketch]
```sql
CREATE TABLE audit_logs (
  id             BIGINT GENERATED ALWAYS AS IDENTITY CONSTRAINT pk_audit_logs PRIMARY KEY,
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_user_id  BIGINT NULL CONSTRAINT fk_audit_logs_actor_user_id_users REFERENCES users(id) ON DELETE RESTRICT,
  actor_username VARCHAR(64) NOT NULL,
  actor_role     VARCHAR(16) NULL,
  action         VARCHAR(48) NOT NULL,
  outcome        VARCHAR(12) NOT NULL DEFAULT 'SUCCESS'
                 CONSTRAINT ck_audit_logs_outcome CHECK (outcome IN ('SUCCESS','FAILURE','DENIED')),
  entity_type    VARCHAR(48) NOT NULL,
  entity_id      VARCHAR(64) NULL,
  before_data    JSONB NULL,
  after_data     JSONB NULL,
  reason         VARCHAR(500) NULL,
  request_id     UUID NULL,
  ip             INET NULL,
  user_agent     VARCHAR(255) NULL
);
CREATE INDEX ix_audit_logs_occurred_at ON audit_logs (occurred_at);
CREATE INDEX ix_audit_logs_action      ON audit_logs (action);
CREATE INDEX ix_audit_logs_entity      ON audit_logs (entity_type, entity_id);
CREATE INDEX ix_audit_logs_actor_time  ON audit_logs (actor_user_id, occurred_at);

CREATE FUNCTION audit_logs_block_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only (% blocked)', TG_OP;
END;
$$;
CREATE TRIGGER trg_audit_logs_no_update_delete BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_mutation();
CREATE TRIGGER trg_audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_block_mutation();      -- TRUNCATE triggers are statement-level only

GRANT USAGE  ON SCHEMA public TO kalyan_app;
GRANT SELECT, INSERT         ON audit_logs      TO kalyan_app;          -- never UPDATE/DELETE/TRUNCATE
GRANT SELECT, INSERT, UPDATE ON users           TO kalyan_app;          -- never DELETE (SEC-05: deactivate, not delete)
GRANT SELECT, INSERT, UPDATE ON doctors         TO kalyan_app;
GRANT SELECT, INSERT, UPDATE ON login_throttle  TO kalyan_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions TO kalyan_app;          -- purge of old sessions
GRANT SELECT                 ON alembic_version TO kalyan_app;          -- revision gate, read-only
-- if INSERT fails with "permission denied for sequence ...": GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kalyan_app;
```
```python
# services/audit_service.py (signature)
def record(session: Session, ctx: AuditContext, action: AuditAction, entity_type: str, entity_id: int | str | None, *,
           before: dict | None = None, after: dict | None = None, reason: str | None = None,
           outcome: Outcome = Outcome.SUCCESS) -> None: ...   # add + flush; raises on redacted keys; fail-closed
```

### CE-5: Bootstrap SQL and first-run admin CLI [sketch]
```sql
-- backend/db/bootstrap.sql  - run ONCE by a human as the postgres superuser:
--   psql -h 127.0.0.1 -U postgres -v ON_ERROR_STOP=1 -f backend\db\bootstrap.sql
CREATE ROLE kalyan_owner LOGIN;           -- owns objects, runs Alembic only
CREATE ROLE kalyan_app   LOGIN;           -- API runtime role (DML only)
\password kalyan_owner
\password kalyan_app
CREATE DATABASE kalyan_dev  OWNER kalyan_owner TEMPLATE template0 ENCODING 'UTF8'
       LOCALE_PROVIDER builtin BUILTIN_LOCALE 'C.UTF-8';
CREATE DATABASE kalyan_test OWNER kalyan_owner TEMPLATE template0 ENCODING 'UTF8'
       LOCALE_PROVIDER builtin BUILTIN_LOCALE 'C.UTF-8';
ALTER DATABASE kalyan_dev  SET timezone TO 'Asia/Kolkata';
ALTER DATABASE kalyan_test SET timezone TO 'Asia/Kolkata';
-- production (Phase 17) runs the same script with one database named kalyan.
```
Syntax checked against the PG 18 `CREATE DATABASE` page (`LOCALE_PROVIDER`, `BUILTIN_LOCALE` values `C`, `C.UTF-8`, `PG_UNICODE_FAST`; `TEMPLATE template0` required when encoding/locale differ; "On Windows, however, UTF-8 encoding can be used with any locale") [CITED: postgresql.org/docs/18/sql-createdatabase.html]; behaviour of the EDB build and `\password` inside `-f` scripts are unverified [ASSUMED].
```python
# cli.py (sketch) - python -m kalyan_api.cli create-admin --username kalyan.admin --full-name "..."
# [Superseded by EG-17 (user decision 2026-10-30): first-run web wizard with setup-mode-only availability and a one-time server-console setup code; `create-admin` dropped, `reset-admin-password` kept. See 11-11-PLAN.md.]
def cmd_create_admin(args):
    password = sys.stdin.readline().rstrip("\r\n") if args.password_stdin else (
        generate_password() if args.generate_password else getpass.getpass("New admin password: "))
    if not args.password_stdin and not args.generate_password and password != getpass.getpass("Repeat: "):
        raise SystemExit("Passwords differ")
    validate_password_policy(password, username=args.username)
    with session_scope(owner=False) as s:                      # runtime role is enough
        if s.scalar(select(exists().where(User.role == "ADMIN", User.is_active))):
            raise SystemExit("An active administrator already exists. Use reset-admin-password.")
        user = create_user(s, role="ADMIN", username=args.username, full_name=args.full_name,
                           password=password, must_change_password=args.generate_password)
        audit.record(s, AuditContext.system(f"cli:{getpass.getuser()}"), AuditAction.ADMIN_BOOTSTRAPPED, "USER", user.id)
    if args.generate_password:
        print(f"One-time password (shown once): {password}")
```

### CE-6: Test harness skeleton [sketch]
```python
# backend/tests/conftest.py
@pytest.fixture(scope="session")
def test_settings():
    s = Settings(db_name=os.environ.get("KALYAN_TEST_DB_NAME", "kalyan_test"),
                 argon2_time_cost=1, argon2_memory_cost=8, argon2_parallelism=1)   # 0.2 ms/hash; memory_cost=8 with p=4 raises HashingError (verified)
    if not s.db_name.endswith("_test"):
        pytest.exit(f"refusing to wipe database {s.db_name!r}: name must end with _test", returncode=2)
    return s

@pytest.fixture(scope="session")
def migrated_db(test_settings):
    owner = create_engine(test_settings.owner_url, isolation_level="AUTOCOMMIT")
    with owner.connect() as c:
        c.execute(text("DROP SCHEMA IF EXISTS public CASCADE")); c.execute(text("CREATE SCHEMA public"))
    command.upgrade(alembic_config(test_settings.owner_url), "head")        # = "migrate from empty" test
    owner.dispose()

@pytest.fixture(scope="session")
def app_engine(migrated_db, test_settings):
    eng = create_engine(test_settings.app_url, pool_pre_ping=True); yield eng; eng.dispose()

@pytest.fixture
def db_session(app_engine):
    conn = app_engine.connect(); outer = conn.begin()
    session = Session(bind=conn, join_transaction_mode="create_savepoint", expire_on_commit=False)
    try: yield session
    finally: session.close(); outer.rollback(); conn.close()

@pytest.fixture
def app(test_settings, db_session):
    app = create_app(test_settings)
    def override():
        yield db_session
        db_session.commit()                                                  # releases the SAVEPOINT
    app.dependency_overrides[get_session] = override
    return app

@pytest.fixture
def clock(monkeypatch):                                                      # one seam for all time
    now = {"t": datetime(2026, 11, 2, 4, 30, tzinfo=timezone.utc)}
    monkeypatch.setattr("kalyan_api.clock.utcnow", lambda: now["t"])
    return now
```
Use a tiny Argon2 cost in test settings so ~20 users per test stay fast (`t=1, m=8 KiB, p=1` hashes in ~0.2 ms; Argon2 requires `memory_cost >= 8 * parallelism`, so keep `p=1` there); one test (`test_stack_smoke::test_production_hasher_meets_owasp_floor`) asserts the production factory has `time_cost>=2, memory_cost>=19456, parallelism>=1`.

### CE-7: App factory wiring and cookie helper [sketch; `app.frontend` and the docs-off flags verified]
```python
def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        engine = build_engine(settings); SessionLocal.configure(bind=engine)
        wait_for_db(engine, timeout_s=60); assert_schema_current(engine)       # exit non-zero on mismatch
        check_durability(engine, strict=settings.env == "production")           # D-02 invariant
        check_timezone_data(); app.state.engine = engine; app.state.settings = settings
        yield
        engine.dispose()
    app = FastAPI(title="Kalyan Hospital API", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None,
                  dependencies=[Depends(verify_origin)])                         # cheap, unsafe-method-only check
    install_error_handlers(app); install_http_middleware(app)                    # security headers + Cache-Control
    for r in (health_router, auth_router, users_router, areas_router): app.include_router(r, prefix="/api")
    if (settings.frontend_dist / "index.html").is_file():
        app.frontend("/", directory=str(settings.frontend_dist), fallback="index.html", check_dir=False)
    else:
        logging.getLogger(__name__).warning("frontend dist not found at %s - API only", settings.frontend_dist)
    return app

def set_session_cookie(response, token: str, settings: Settings) -> None:
    response.set_cookie(settings.cookie_name, token, httponly=True, samesite="strict",
                        secure=settings.cookie_secure, path="/")                # cookie_secure=False under D-01
```
Run: `backend\.venv\Scripts\python.exe -m uvicorn kalyan_api.main:create_app --factory --host 0.0.0.0 --port 8000 --no-server-header` (dev: add `--reload`).

### CE-8: Frontend essentials [sketch; not executed - Node absent]
```ts
// frontend/src/api/client.ts
let csrfToken: string | null = null
export const setCsrfToken = (t: string | null) => { csrfToken = t }
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, unknown> = {}) { super(message) }
}
export async function apiFetch<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const method = init.method ?? 'GET'
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'
  if (method !== 'GET' && method !== 'HEAD' && csrfToken) headers['X-CSRF-Token'] = csrfToken
  const res = await fetch(`/api${path}`, { method, headers, signal: init.signal, credentials: 'same-origin',
    body: init.body === undefined ? undefined : JSON.stringify(init.body) })
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, data?.code ?? 'error', data?.message ?? res.statusText, data ?? {})
  return data as T
}
```
```tsx
// frontend/src/auth/guards.tsx
export function RequireAuth() {
  const me = useMe()                                            // useQuery({ queryKey: ['me'], queryFn: getMe, retry: false })
  const loc = useLocation()
  if (me.isPending) return <p role="status">Loading…</p>
  if (me.isError) return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  if (me.data.must_change_password) return <Navigate to="/change-password" replace />
  return <Outlet context={me.data} />
}
export function RequireRole({ role }: { role: Role }) {
  const user = useOutletContext<Me>()
  return user.role === role ? <Outlet context={user} /> : <Navigate to={ROLE_HOME[user.role]} replace />
}
```
```ts
// frontend/vite.config.ts
/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: { '/api': 'http://127.0.0.1:8000' } },     // no changeOrigin: Host stays localhost:5173 == Origin
  test: { environment: 'jsdom', setupFiles: './src/test/setup.ts', css: false },
})
// src/test/setup.ts:  import '@testing-library/jest-dom/vitest'; import { afterEach } from 'vitest'; import { cleanup } from '@testing-library/react'; afterEach(cleanup)
```

## State of the Art

| Old approach | Current approach (2026-10-30) | Changed | Impact |
|--------------|-------------------------------|---------|--------|
| `for r in app.routes: isinstance(r, APIRoute)` | `fastapi.routing.iter_route_contexts(app.routes)`; `app.routes` holds lazy `_IncludedRouter` | FastAPI 0.14x-0.162 | Old authz tests pass vacuously. |
| Commit in `get_db` teardown | `Depends(..., scope="function")` | FastAPI docs (default scope = request) | Commit/rollback before the response. |
| Hand-written SPA catch-all / `StaticFiles` | `app.frontend("/", directory=..., fallback="index.html")` | FastAPI tutorial `frontend` page (introduction version not stated in docs; a secondary blog says 0.138.0; a fallback-check fix shipped in 0.143.2) | Less code, Accept-gated fallback. |
| `httpx` for `TestClient` | `httpx2` (pydantic org) | Starlette 1.x deprecation warning; FastAPI 0.143.4 | Warning-free tests. |
| Starlette 0.x | Starlette 1.10.0 | 1.0 in 2026 | FastAPI leaves it unbounded - pin. |
| SQLAlchemy 2.0 | 2.1.x exists (2026-09-24) | | Stay on 2.0.55 for this milestone. |
| ESLint + typescript-eslint | oxlint in the official Vite template | create-vite react-ts template | TS 7 compatible. |
| TypeScript 5.x JS compiler | TypeScript 7.0.2 (native binaries, `tsc`) | 2026-07-08 | typescript-eslint/openapi-typescript not yet compatible. |
| `react-router-dom` | single `react-router` package; `RouterProvider` from `react-router/dom` | v7+ | Fewer imports to get wrong. |
| Chrome warns on all HTTP | Chrome 154: warns only for public HTTP sites; private IPs/single-label hosts excluded | Oct 2026 | D-01 plain HTTP on 192.168.x.x unaffected. |
| libc/ICU-only collations | PostgreSQL `builtin` provider (`C.UTF-8`) | PG 17+ | Collation independent of Windows locale (restore-safe). |

**Deprecated/outdated for this project:** `passlib`, `python-jose`, `fastapi-users` (STACK.md "What NOT to Use"); `@app.on_event`; `datetime.utcnow()`/naive `datetime.now()` (ruff DTZ); SQLAlchemy 1.x `Query` style; `create_all()` at startup; PBKDF2-100k with a hand-rolled salt (v2.0).

## Assumptions Log

> Every `[ASSUMED]` claim in this document. The planner/discuss-phase should obtain confirmation where "Risk" is non-trivial; items marked "verify in Wave N" are cheap to check mechanically.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Package `kalyan_api` under `backend/src/` is acceptable instead of the example `backend/app/` in CONTEXT's Discretion list | Structure | Low: rename is cheap now, costly later; needs one acknowledgement |
| A2 | Admin has no clinical-content permissions and uses only `/admin`; reserved-permission role defaults in the Pattern 1 table (patient/appointment read for Admin, payments hidden from Doctor, etc.) | Pattern 1, EG-7 | Medium: reopens Phase 13-15 matrix and tests |
| A3 | 12 h absolute session limit, 60 s touch throttle, multiple concurrent sessions per user | Pattern 3 | Low |
| A4 | Password policy (min 10, max 128, ~100-entry blocklist, 12-char temporary passwords) and per-IP throttle 20 failures/15 min | Pattern 4 | Low |
| A5 | Stub `doctors` table in `0001`; creating a DOCTOR user creates the doctor row in the same transaction | Pattern 8, Open Q2 | Medium: Phase 12 scope (SET-02) |
| A6 | Reassigning a patient's `doctor_id` is Admin-only and audited | Pattern 5, EG-6 | Medium: workflow with two consultants |
| A7 | `LOCALE_PROVIDER builtin BUILTIN_LOCALE 'C.UTF-8'` works on the EDB Windows build and the Wave 0 smoke outputs (`école`, `t`, `Asia/Kolkata`); ICU availability unknown | Wave 0 | Medium: fallback documented; verify in W0-8 |
| A8 | EDB installer's default `listen_addresses` unknown (set explicitly); service name `postgresql-x64-18`; PostgreSQL `bin` not on PATH; `\password` works inside `psql -f` | Wave 0 | Low: verify in W0-4..W0-7 |
| A9 | Identity columns need no explicit sequence GRANT for `kalyan_app` | CE-4 | Low: one extra GRANT |
| A10 | PUBLIC has TEMP on the test database, so `kalyan_app` can create TEMPORARY test tables | Pattern 5/9 | Low |
| A11 | PostgreSQL `now()` is the transaction start time (standard behaviour; motivates the clock seam) | Pitfall 4 | Low |
| A12 | Engine/session option values (pool 5+5, statement_timeout 30 s, lock_timeout 10 s, idle_in_transaction 60 s, pool_recycle 1800) | Pattern 2 | Low |
| A13 | CSP string and "Vite build has no inline scripts" | Pattern 3 | Low: tune after a browser smoke test |
| A14 | `crypto.subtle`, `crypto.randomUUID`, `getUserMedia`, clipboard are secure-context-only (MDN page fetched confirms only service workers explicitly) | Pattern 3 | Low |
| A15 | Vitest/jest-dom/jsdom config, the `/// <reference types="vitest/config" />` line, and the template tsconfig compile under TS 7.0.2; oxlint default rules suffice | Pattern 10 | Low-Medium: fallback TS 5.9.3 + typescript-eslint |
| A16 | Browsers send `Origin` on same-origin unsafe fetches over plain HTTP | Pattern 3 | Medium: otherwise the Referer fallback carries the check; verify in UAT |
| A17 | Host-only session cookie works across LAN PCs at `http://192.168.x.x` in Chrome/Edge (RFC 6265 identical-string domain match supports it) | Pattern 3 | Medium: verify on a second device |
| A18 | Using `127.0.0.1` instead of `localhost` avoids IPv6-first delays on Windows | Wave 0 | Low |
| A19 | `pg_trgm`/`citext` are trusted extensions (PG13+) installable by a database owner | Pattern 8 | Low (Phase 12) |
| A20 | Hardware, UPS purchase, fixed IP and network isolation facts (EG-1..EG-5) | Entry gate | Medium: sets RISK-01 likelihood |
| A21 | A GitHub Actions workflow with a PostgreSQL service is wanted (optional) | Pattern 9 | Low |
| A22 | The 85% coverage gate (project skill) is feasible for scaffold-heavy Phase 11 | Validation | Low: planner may lower |
| A23 | Chrome/Edge are the staff browsers | Validation | Low |

## Open Questions (RESOLVED)

All questions below were resolved by the plan-phase orchestrator on 2026-10-30 and recorded in `11-ENTRY-GATE.md` (plan 11-01) as DEFAULT rows with an owner and confirm-by phase, not as client-confirmed facts:

| Q | Resolution | Register row |
|---|------------|--------------|
| 1 | RESOLVED: adopt `backend/src/kalyan_api` | EG-14 |
| 2 | RESOLVED: stub `doctors` table in `0001_baseline`, created with the DOCTOR user | EG-15 |
| 3 | RESOLVED (DEFAULT): ADMIN least privilege, no clinical permissions, `/admin` only; confirm by Phase 13 | EG-16 |
| 4 | RESOLVED (DECIDED-BY-USER 2026-10-30): first-run web wizard protected by setup-mode-only availability and a one-time server-console setup code; create-admin dropped; reset-admin-password kept for recovery | EG-17 |
| 5 | RESOLVED (DEFAULT): only ADMIN reassigns between consultants; decided properly in Phase 13 | EG-18 |
| 6 | RESOLVED (DEFAULT): 12 h absolute session limit and research password-policy numbers, held as settings | EG-19 |
| 7 | RESOLVED (DEFAULT): client facts EG-1..EG-5 recorded with owner; D-01/D-02 locked | EG-1..EG-5 |
| 8 | RESOLVED: pin FastAPI 0.162.0 + Starlette 1.10.0 exactly, with canary tests | EG-20 |
| 9 | RESOLVED: no CI workflow in Phase 11 | EG-20 |
| 10 | RESOLVED: no separate UI-SPEC (user chose to skip); ui-ux-pro-max rules folded into plans | — |

1. **Package name / layout deviation** - `backend/src/kalyan_api` vs CONTEXT's example `backend/app/...`.
   - What we know: the legacy `app` package, `pythonpath = .`, and root pyright config make `app` ambiguous; layout experiment passed only by sys.path ordering.
   - Recommendation: adopt `kalyan_api` (A1); if the owner insists on `backend/app`, keep cwd = `backend`, `--import-mode=importlib`, never run from repo root, and rename in Phase 17 packaging.
2. **DOCTOR users before the doctor profile phase** - SET-02 (doctor profiles) is Phase 12, but D-03 needs `users.doctor_id`.
   - Recommendation: stub `doctors` table in `0001` and create the row with the DOCTOR user (A5); alternative: create only ADMIN/RECEPTION users in Phase 11 and test the silo with a test-only table. Planner/discuss decides.
3. **Admin's access to clinical data and to the reception/doctor dashboards** (A2) - client confirmation by Phase 13; the golden matrix test records whatever is decided.
4. **First-run "wizard" wording in CONTEXT `<specifics>`** vs the CLI mechanism - research recommends CLI + a login-page notice and no unauthenticated setup endpoint. Confirm that this satisfies the intent.

**[Superseded by EG-17 (user decision 2026-10-30): first-run web wizard with setup-mode-only availability and a one-time server-console setup code; `create-admin` dropped, `reset-admin-password` kept. See 11-11-PLAN.md.]**

5. **Strict silo vs two consultants who "share one patient identity and one payment ledger"** (v2.0 schema comment) - who reassigns, and can a doctor cover for the other? (A6) Needs the clinicians' answer before Phase 13.
6. **Absolute session limit and password policy numbers** (A3, A4) - confirm with the trust administrator; they are settings, not code.
7. **UPS / server / IP / network facts** (EG-1..EG-5) - still unconfirmed; they drive RISK-01 and Phase 17.
8. **FastAPI pin policy** - 0.162.0 is 7 days old in a very busy release train; acceptable because the usage is narrow and CE-1 plus the suite act as canaries. Alternative pin: 0.144.0 (2026-10-18), the last release before the 0.145-0.162 run, at the cost of missing about 30 releases of fixes, features and breaking changes (and of the 0.151.0 null-vs-omitted JSON semantics).
9. **CI** - add the optional PostgreSQL-service workflow (A21)? Not required by any success criterion.
10. **UI-SPEC** - the UI surface is small (login, change password, user admin, 409 banner, three shells); folding the ui-ux-pro-max rules into the plan is enough, a separate `/gsd-ui-phase` is optional.

## Environment Availability

Probed 2026-10-30 on the dev PC (Windows 11 Home 10.0.26300, PowerShell 5.1).

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python 3.12 + venv + pip | backend | Yes | 3.12.10 (`C:\Users\147ha\AppData\Local\Programs\Python\Python312`), pip 25.0.1 bundled | - |
| Node.js + npm | frontend, `gsd_run` package seam, `gsd-tools.cjs` | **No** | - | None. HUMAN W0-2 (`winget ... OpenJS.NodeJS.LTS --version 24.22.1`) |
| PostgreSQL server + psql | every DB task, all tests | **No** (no service, no `C:\Program Files\PostgreSQL`) | - | None - no SQLite fallback (project decision), no Docker. HUMAN W0-4 (`PostgreSQL.PostgreSQL.18` 18.6-5) |
| winget | installs | Yes | v1.29.380 | Official installers |
| git | VCS, entry-gate ordering check | Yes | 2.56.0.windows.4 | - |
| Docker / WSL | - | No | - | Not needed (Out of scope per STACK.md) |
| Internet to registries | installs/pins | Yes (2026-10-30) | - | Production server stays offline; Phase 17 wheelhouse |
| Disk | repo, node_modules, PG data | C: 185.4 GB free; D: 10.2 GB free | - | PG data on C: |
| RAM | Argon2 (64 MiB/hash), PG, Vite | 7.3 GB | - | - |
| Chrome/Edge | UAT | [ASSUMED] present | - | Claude Browser pane for smoke checks |
| Second LAN device (phone/PC) | LAN cookie/UAT check | [ASSUMED] optional | - | Defer to Phase 17 |
| `gsd_run` / `gsd-tools.cjs` | package-legitimacy seam, commits | No (needs Node) | - | Orchestrator commits manually until Node exists |

**Missing dependencies with no fallback:** Node.js, PostgreSQL (both resolved by Wave 0 human-action checkpoints; nothing in Phase 11 can run before them except writing the entry-gate record).
**Missing dependencies with fallback:** none.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Backend: pytest 9.2.0 + pytest-timeout 2.4.0 + pytest-cov 7.1.0 + httpx2 2.16.0 (real PostgreSQL 18.6). Frontend: Vitest 5.0.5 + @testing-library/react 16.3.3 + jsdom 30.1.3 |
| Config file | `backend/pyproject.toml` `[tool.pytest.ini_options]` (`testpaths=["tests"]`, `addopts="-ra -q --import-mode=importlib --strict-markers"`, `timeout=60`, markers `concurrency`, `db_owner`, `slow`) - **Wave 0**; `frontend/vite.config.ts` `test` block - **Wave 0** |
| Quick run command | `backend\.venv\Scripts\python.exe -m pytest backend/tests -q -x -m "not concurrency and not slow"` ; frontend-only change: `npm --prefix frontend run test` |
| Full suite command | `backend\.venv\Scripts\python.exe -m pytest backend/tests -q --cov=kalyan_api --cov-report=term-missing --cov-fail-under=85` ; `backend\.venv\Scripts\ruff.exe check backend` ; `npm --prefix frontend run typecheck` ; `npm --prefix frontend run lint` ; `npm --prefix frontend run test` ; `npm --prefix frontend run build` |

All commands run from `D:\dr-sr` in PowerShell 5.1 (they work as-is; `pytest backend/...` selects `backend/pyproject.toml` - verified). A failing run is observable as a non-zero exit code plus the named failing test, a `tsc` error list, or an oxlint diagnostic.

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command (append to `backend\.venv\Scripts\python.exe -m pytest`) | Fails when | File Exists? |
|--------|----------|-----------|--------------------|-----------|-------------|
| SEC-01 | Login sets HttpOnly, SameSite=Strict, no-Secure cookie; `/me` works on the next request over plain HTTP; `me` returns role + permissions; each role gets its home | integration | `backend/tests/test_auth_login.py -q` | cookie has `Secure`, wrong flags, `/me` 401 after login | Wave 0 |
| SEC-01 | Wrong-role navigation redirects; unauthenticated -> `/login`; must-change -> `/change-password` | frontend unit | `npm --prefix frontend run test -- guards` | redirect target wrong | Wave 0 |
| SEC-02 | Every route has exactly one policy; public set equals allow-list; enumeration non-vacuous; negative control reports an unprotected route | unit | `backend/tests/test_route_policies.py -q` | message lists offending `METHOD path`; "route enumeration incomplete" | Wave 0 |
| SEC-02 | Role x endpoint matrix incl. anonymous (401), reception/doctor on admin routes (403), doctor B on doctor A (404), matrix covers every route, no secret keys in bodies | integration | `backend/tests/test_rbac_matrix.py -q` | any status differs; uncovered route named | Wave 0 |
| SEC-02 | CSRF: missing/wrong `X-CSRF-Token` -> 403; foreign/missing Origin on unsafe methods incl. login -> 403; GET unaffected | integration | `backend/tests/test_csrf_origin.py -q` | state change succeeds without token | Wave 0 |
| SEC-03 | Golden role->permission snapshot; no orphan permissions; role CHECK; scope helpers (A sees A, not B/NULL; reception/admin see no CLINICAL; 404 for foreign id) | unit/integration | `backend/tests/test_permissions_catalogue.py backend/tests/test_scope_helpers.py -q` | snapshot diff; orphan permission named | Wave 0 |
| SEC-04 | Idle 30 min -> 401 `session_expired`; activity refreshes (throttled); absolute 12 h; logout/deactivate/password-change revoke | integration (clock seam) | `backend/tests/test_sessions.py -q` | session survives past limit | Wave 0 |
| SEC-04 | 5 failures lock 15 min incl. correct password during lock; counters persist despite 401; lock expiry; admin unlock; per-IP 429 + `Retry-After`; identical message for unknown/locked | integration | `backend/tests/test_lockout_throttle.py -q` | row not locked after 5 failures (rollback bug) | Wave 0 |
| SEC-05 | Create returns one-time temp password + forces change; blocked endpoints until changed; deactivate keeps row (DELETE privilege revoked); reset revokes sessions; last-admin/self guards; mass assignment rejected | integration | `backend/tests/test_users_admin.py backend/tests/test_password_change.py -q` | any non-409/403 where a guard is expected | Wave 0 |
| SEC-05 | CLI `create-admin`: prompts/stdin, refuses second bootstrap, policy applied, audit actor `cli:`; fresh migrated DB has 0 users; repo scan finds no default credentials | integration | `backend/tests/test_cli_admin.py backend/tests/test_no_default_credentials.py -q` | users count > 0; legacy string found | Wave 0 |

**[Superseded by EG-17 (user decision 2026-10-30): first-run web wizard with setup-mode-only availability and a one-time server-console setup code; `create-admin` dropped, `reset-admin-password` kept. See 11-11-PLAN.md.]**

| SEC-06 | Stale `version_id` -> 409 and row/audit unchanged; response carries incremented version; missing version -> 422; deterministic two-session race raises `StaleDataError`; 20x concurrent PATCH -> `[200, 409]`; no code assigns `.version_id =` | integration (+ `concurrency`) | `backend/tests/test_optimistic_locking.py -q` (full run includes `-m concurrency`) | two 200s; version not incremented | Wave 0 |
| SEC-06 | 409 UX: banner text "Record was modified by another user", Reload refetches and resets form | frontend unit | `npm --prefix frontend run test -- conflict-banner` | banner missing / no refetch | Wave 0 |
| AUD-01 | Audit row commits with the business write and both vanish when the audit insert fails (non-2xx); events for login ok/fail/lock/logout, user create/update/role/deactivate/reactivate/reset/unlock/password change; payloads redacted (writer raises on secrets) | integration | `backend/tests/test_audit_writer.py -q` | missing row/action; secret key accepted | Wave 0 |
| AUD-01 | UPDATE/DELETE/TRUNCATE blocked as `kalyan_app` (permission) and as owner (trigger "append-only"); 3 triggers + grants present | integration (`db_owner`) | `backend/tests/test_audit_append_only.py backend/tests/test_migrations.py::test_security_objects_present -q` | statement succeeds | Wave 0 |
| (cross) | Migrate from empty; single head `0001`; `alembic check` clean; app refuses to start on revision mismatch and on `synchronous_commit=off` in production | integration | `backend/tests/test_migrations.py -q` | non-empty autogenerate diff; app starts | Wave 0 |
| (cross) | SPA serving: index for HTML navigation, 404 JSON for XHR, assets cached `immutable`, `index.html` `no-cache`, `/api/*` `no-store`, traversal probes never leak a file, absolute dist path only | integration | `backend/tests/test_spa_serving.py -q` | secret file served; wrong headers | Wave 0 |
| (cross) | Pin canaries: versions, `ZoneInfo("Asia/Kolkata")`, production Argon2 params >= OWASP floor, `psycopg.pq.__impl__ == "binary"`, OpenAPI snapshot | unit | `backend/tests/test_stack_smoke.py backend/tests/test_openapi_snapshot.py -q` | pin or snapshot drift | Wave 0 |
| SC-1 | Entry-gate register committed before code and has no OPEN rows | script | PowerShell snippet in "Entry-Gate Decision Record" | prints FAIL / any OPEN match | Wave 0 |
| (cross) | Legacy app/tests untouched and root pytest still collects only legacy | script | `git diff --stat -- app tests pytest.ini requirements.txt requirements-dev.txt .github .vscode` (must be empty); `python -m pytest --collect-only -q` at repo root lists only `tests/` | diff non-empty | n/a |

**Manual-only (cannot be automated in this phase):** (1) login from a second LAN device at `http://<server-ip>:8000` (needs a Windows Firewall inbound TCP 8000 rule, Private profile) - proves the cookie/CSRF flow across 192.168.x.x origins; (2) visual check of the 409 banner and focus management in Chrome/Edge; (3) read `SELECT action, outcome, actor_username, occurred_at FROM audit_logs ORDER BY id DESC LIMIT 20;` in psql and confirm `UPDATE audit_logs ...` is refused; (4) the real power-cut drill belongs to Phase 17.

### Sampling Rate
- **Per task commit:** quick run command (< 30 s target; `concurrency` and `slow` excluded) plus `ruff check backend` for backend tasks, `npm --prefix frontend run test` for frontend tasks.
- **Per wave merge:** full suite command (includes `concurrency` tests, coverage gate, typecheck, lint, build).
- **Phase gate:** full suite green, entry-gate ordering script OK, legacy-untouched check empty, manual-only items 1-3 recorded in `11-VERIFICATION`/UAT before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `backend/pyproject.toml` (pins, pytest/ruff config), `backend/tests/conftest.py` (PG fixtures, clock seam, `make_user`, logged-in clients), `backend/db/bootstrap.sql`, `backend/.env.example`
- [ ] All `backend/tests/test_*.py` files listed above; `backend/tests/support/` (TEMPORARY scoped table, matrix table)
- [ ] `frontend/package.json`, `vite.config.ts`, `src/test/setup.ts`, `src/**/__tests__/*.test.tsx`
- [ ] Framework install: W0-10 (`pip install -e "backend[dev]"`), W0-12 (`npm install`); PostgreSQL + Node via W0-2/W0-4
- [ ] `11-ENTRY-GATE.md`; `.gitignore` additions (W0-9)

## Security Domain

`security_enforcement` is absent in `.planning/config.json` (treated as enabled).

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | argon2-cffi Argon2id (defaults, `check_needs_rehash`), 5-failure lockout, per-IP throttle, forced first-login change, random temporary passwords, no default credentials, CLI-only first admin |
| V3 Session Management | yes | 256-bit opaque token stored as SHA-256, HttpOnly + SameSite=Strict cookie (no Secure under D-01, accepted RISK-01), 30-min idle + 12 h absolute, rotation on login/password change, server-side revocation, per-session CSRF token |
| V4 Access Control | yes | default-deny exactly-one-policy routes, route-walk test, role x endpoint matrix, `row_scope`/404 for D-03/D-04, last-admin and self-demotion guards |
| V5 Validation | yes | Pydantic v2 request models with `extra="forbid"`, length caps (password 128, names), `AwareDatetime`, bound SQL parameters only |
| V6 Cryptography | yes | `argon2-cffi`, `secrets`, `hashlib.sha256`, `hmac.compare_digest` - nothing hand-rolled |
| V7 Errors/Logging | yes | one JSON error envelope, no stack traces, structured append-only audit; never log passwords/tokens |
| V9 Communications | accepted risk | plain HTTP by D-01; compensating controls in RISK-01; HTTPS deferred (FUT-01) |
| V13 API | yes | JSON only, `/api` prefix, CSRF header + Origin check, no CORS in production |
| V14 Configuration | yes | docs/openapi disabled, `--no-server-header`, PostgreSQL on localhost with least-privilege roles, pinned dependencies + lockfiles, no CDN/outbound calls (opentelemetry-api has no exporter configured) |

### Known Threat Patterns for FastAPI + PostgreSQL + SPA on a plain-HTTP LAN
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Password guessing / spraying | Spoofing | Lockout (D-07) + per-IP throttle + Argon2id + generic error |
| Credential/session sniffing on the LAN | Information disclosure | Accepted RISK-01 + isolation condition, short sessions, revocation, random temp passwords |
| CSRF from a page in a staff browser | Tampering | SameSite=Strict + `X-CSRF-Token` + Origin==Host (incl. login) |
| Horizontal escalation (doctor B reads doctor A) | Information disclosure | `row_scope` in SQL + 404 + matrix tests |
| Vertical escalation (reception -> clinical/admin) | Elevation of privilege | Default-deny policy markers, permission catalogue snapshot |
| Mass assignment on user update | Elevation of privilege | `extra="forbid"` request models + test |
| SQL injection | Tampering | SQLAlchemy bound parameters; no f-string SQL (ruff `S608`); the legacy rule "dynamic SQL ... forbidden" carries over [CITED: SECURITY.md 2.2] |
| Audit tampering | Repudiation | Triggers + INSERT-only runtime role, owner never used by the API |
| Lost update / double submit | Tampering | `version_id` + 409; disabled submit buttons |
| User enumeration / timing | Information disclosure | Generic message, dummy hash verification |
| Lockout abuse | Denial of service | Accepted (RISK-03): admin unlock + CLI |
| Oversized password / body | Denial of service | Password max 128; Phase 12 sets upload limits |
| Swagger UI/CDN or stack-trace leakage | Information disclosure | Docs disabled, error envelope, `--no-server-header` |
| Supply chain (typosquat, floating pins) | Tampering | Exact pins, lockfiles, package-legitimacy seam gate, wheels only |
| Log injection via attempted username | Tampering | Truncate to 64, store as data, React escapes on display |

## Sources

### Primary (HIGH confidence)
- PyPI JSON API (`pypi.org/pypi/<pkg>/json`) and pypistats.org - versions, dates, wheels, `requires_dist`, downloads (fetched 2026-10-30); `pip install --dry-run --report` and a real install of the pinned set in a throw-away venv (Python 3.12.10, win_amd64, 41 packages, 0 sdists)
- registry.npmjs.org and api.npmjs.org - versions, engines, peer dependencies, exports, scripts, downloads (2026-10-30)
- GitHub API: `fastapi/fastapi` releases (0.142.2-0.162.0 notes), `pydantic/httpx2` repo, GitHub advisories (`affects=` queries for every pinned Python version: zero returned)
- raw.githubusercontent.com `vitejs/vite/main/packages/create-vite/template-react-ts/{package.json,tsconfig.app.json,tsconfig.node.json,vite.config.ts}` (TS ~7.0.2, oxlint, @types/node ^24.19.2)
- FastAPI docs: tutorial/dependencies/dependencies-with-yield (scope), tutorial/frontend (`app.frontend`), tutorial/testing (httpx)
- SQLAlchemy docs: docs.sqlalchemy.org/en/20/orm/versioning.html; Alembic docs: autogenerate (limits, `alembic check`, `compare_type` default since 1.12.0); psycopg docs: advanced/async (Windows Proactor)
- PostgreSQL 18 docs: sql-createdatabase, runtime-config-connection (`listen_addresses`), runtime-config-wal (`synchronous_commit`, `fsync`, `full_page_writes`), sql-createtrigger (TRUNCATE statement-level), sql-alterdefaultprivileges; postgresql.org/support/versioning (18.6 current; EOL 2030-11-14) and docs/release/18.6 (18.5 never released)
- winget catalogue on the dev PC (`winget search/show --versions`) and the winget-pkgs manifest `PostgreSQL.PostgreSQL.18` 18.6-5; nodejs.org/dist/index.json (LTS lines)
- OWASP cheat sheets: Session Management, Password Storage, CSRF Prevention; MDN: Set-Cookie, Secure Contexts; RFC 6265 (5.1.3, 8.5); W3C Fetch Metadata / Chromium behaviour; blog.google/security/https-by-defau (Chrome 154)
- pytest docs: customize (rootdir/config discovery); React Router docs: start/modes, RouterProvider; vitest.dev/guide
- Throw-away experiments (scratchpad, not committed): route enumeration and `app.frontend` behaviour, dependency scope/override semantics, SQLAlchemy versioning cases, Argon2 timings, pytest layout, live uvicorn cookie round trip, ruff DTZ, Alembic API names and `%` escaping
- Repo files read this session: `.planning/{PROJECT,STATE,ROADMAP,REQUIREMENTS,config.json}`, `research/{SUMMARY,STACK,ARCHITECTURE,PITFALLS}.md`, `11-CONTEXT.md`, `app/db/schema.sql`, `app/services/{auth,audit}_service.py`, `.gitignore`, `pytest.ini`, `.github/workflows/tests.yml`, `.vscode/settings.json`, `SECURITY.md`, `DECISIONS.md`, `GEMINI.md`, project skills

### Secondary (MEDIUM confidence)
- dev.to / umesh-malik.com posts on `app.frontend()` (version 0.138.0 claim) - only used for the introduction version, which does not matter at the pinned 0.162.0
- Android Authority / Search Engine Journal / SecurityWeek on Chrome 154 (corroborated by the primary Google blog)

### Tertiary (LOW confidence - marked [ASSUMED] in the text)
- EDB installer defaults (service name, `listen_addresses`, PATH), `\password` inside `-f` scripts, behaviour of the `builtin` locale on the EDB Windows build, TEMP privilege default, identity-column sequence privileges, browser behaviour for `Origin` and IP-host cookies

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH (Python set installed and exercised; npm set verified from registry metadata only)
- Architecture: HIGH for FastAPI/SQLAlchemy/auth mechanics (experiments), MEDIUM for PostgreSQL-specific behaviour not runnable here (triggers, grants, locale provider) until Wave 0/1
- Pitfalls: HIGH (most reproduced), MEDIUM for Windows installer details
- Frontend toolchain: MEDIUM (Node absent; compatibility inferred from registry `engines`/`peerDependencies` and the official template)

**Research date:** 2026-10-30
**Valid until:** 2026-11-06 for the pins (FastAPI, Pydantic, pytest, pydantic-settings, tzdata are days old and fast-moving - re-check `pip index versions` before locking); 2026-11-30 for the architecture and PostgreSQL/Node findings (the next PostgreSQL minor is expected around 2026-11-12 under the quarterly cadence [ASSUMED]; minor releases need no dump/restore per the 18.6 release notes).

