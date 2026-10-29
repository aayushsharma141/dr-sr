# Stack Research

**Domain:** Offline LAN hospital web platform (outpatient registration, physiotherapy, billing), single Windows server PC, Rs 22,000 budget
**Researched:** 2026-10-30
**Confidence:** HIGH on architecture and library choices; MEDIUM on exact latest versions (read from PyPI/npm registries on 2026-10-30; PostgreSQL and WinSW minor versions could not be confirmed and must be checked on the vendor pages before install)

> Versions below were read live from the PyPI/npm registries on 2026-10-30. Treat them as "latest known at research time". Pin exact versions in `requirements.txt` / `package-lock.json` when the project scaffold is created, and rebuild once on a machine that has internet. After the build, nothing needs internet again.

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Python | 3.12 or 3.13 (64-bit Windows) | Server runtime | All libs below require >=3.10. Pick a version with prebuilt wheels for psycopg-binary, argon2-cffi, pydantic-core, Pillow. Avoid brand-new 3.14 until wheels are confirmed. |
| FastAPI | 0.162.0 | HTTP API, dependency-injection auth/RBAC, OpenAPI | Required by project. Dependencies (`Depends`/`Security`) are the idiomatic place for per-endpoint permission checks. |
| Pydantic | 2.14.2 | Request/response validation (comes with FastAPI) | Strict schemas; use `int` paise fields so floats never enter billing. |
| Uvicorn | 0.54.0 | ASGI server | Run single process (or 2 workers) behind a Windows service. Do NOT use `--reload` or gunicorn (no Windows support). |
| SQLAlchemy | 2.x (registry latest 2.1.6; pin `>=2.0.40,<2.2` and test) | ORM / Core | 2.0-style typed `Mapped[]` models, sync `Session`. Sync is enough for ~10 LAN users and far simpler than async. |
| Alembic | 1.20.1 | Schema migrations | Standard with SQLAlchemy. Versioned migrations are the upgrade path after handover. |
| psycopg (v3) | 3.3.6 with `psycopg[binary]` | PostgreSQL driver | Use URL `postgresql+psycopg://`. The binary wheel avoids needing libpq/compiler on Windows. |
| psycopg-pool | 3.3.3 (optional) | Connection pool | SQLAlchemy's own `QueuePool` is sufficient at this scale; add psycopg-pool only if needed. Skip by default. |
| PostgreSQL | 18.x (current major; confirm exact minor at postgresql.org/download/windows) or 17.x if the 18 installer misbehaves | Database | Official EDB Windows installer (.exe), runs as a Windows service out of the box. Installer is downloaded once, offline thereafter. |
| React | 19.3.1 | UI | Required by project. |
| TypeScript | registry latest 7.0.2; safe fallback 5.9.x | Type safety | If the Vite/ESLint toolchain complains about TS 7, pin to the newest 5.x. Verify at scaffold time. |
| Vite | 8.3.5 (+ `@vitejs/plugin-react` 6.1.2) | Build tool / dev server | Fast static build into `dist/`. Needs a current Node LTS (check Vite 8 engines field; expect Node 20.19+ or 22.12+). |
| React Router | 8.5.1 (use declarative/library mode, NOT framework mode) | `/admin`, `/reception`, `/doctor` routes, route guards | One SPA, role-based layout routes. No SSR, no Node on server. |
| TanStack Query | 5.105.0 | Server-state cache, mutations, refetch | Removes hand-rolled loading/error/refetch code; invalidation after writes keeps multi-PC views fresh (use `refetchInterval` ~15-30 s on appointment lists instead of websockets). |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| argon2-cffi | 25.1.0 | Password hashing (Argon2id) | Default. Use `PasswordHasher()`; call `check_needs_rehash()` on login to upgrade params. Fallback `bcrypt` only if the wheel fails on the server PC. |
| python-multipart | 0.0.32 | Multipart/photo upload parsing | Required by FastAPI for `UploadFile`. |
| Pillow | 13.0.0 | Validate and downscale patient photos (re-encode to JPEG, strip EXIF) | Always on upload: verifies the file is a real image, caps size to ~800 px, removes metadata. |
| pydantic-settings | latest (pin at scaffold) | Typed config from `.env` | DB URL, photo dir, secret key, cookie flags. |
| itsdangerous | 2.2.0 | Not required | Only if signing short-lived tokens is wanted; session IDs from `secrets.token_urlsafe(32)` need no library. |
| pytest + httpx | 9.2.0 / 0.28.1 | API tests with `TestClient` | Test every endpoint x role matrix (permission tests are the core acceptance criterion). |
| react-hook-form | 7.91.0 | Forms (12-field registration, billing) | Uncontrolled inputs, good performance, works with Zod. |
| zod + @hookform/resolvers | 4.6.7 / 6.0.2 | Client-side validation schemas | Mirror server rules (phone, age, paise as integers). Server stays authoritative. |
| Tailwind CSS | 4.3.3 (with `@tailwindcss/vite`) | Styling, `@media print` rules for A4 card | Compiles to one local CSS file; no CDN. |
| shadcn/ui (Radix primitives, source copied into repo) | CLI latest at scaffold | Accessible dialogs, tables, selects, toasts | Components live in your repo, so there is no runtime dependency on a hosted service. Alternative: Mantine (see Alternatives). |
| @fontsource/noto-sans-devanagari + @fontsource/inter | latest at scaffold | Self-hosted fonts | Hindi/Devanagari text for hospital identity and addresses. Bundled into `dist/`; never use Google Fonts links. |
| @tanstack/react-table | 9.3.1 (only if tables need sort/filter/pagination) | Patient/billing tables | Skip if server-side pagination with simple tables suffices. |
| date-fns | latest at scaffold | Date formatting (en-IN, Asia/Kolkata) | Small, tree-shakable. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Node.js LTS (build machine only) | Run `npm ci && npm run build` | Not on the dev machine today. Install on a build machine (or dev PC) with internet, commit the resulting `frontend/dist` or attach it to the handover bundle. The server PC never needs Node. |
| ruff + mypy (optional) | Lint/type-check Python | Dev dependency only. |
| ESLint + typescript-eslint | Frontend lint | Dev dependency only. |
| pg_dump / pg_restore (ship with PostgreSQL) | Backups | Called via Windows Task Scheduler. |
| WinSW (stable 2.12.0 line; v3 is still alpha as of last check) | Run uvicorn as a Windows service | One XML file + one exe. Preferred over NSSM for XML-configured log rotation and auto-restart. NSSM 2.24 is an acceptable alternative (last release is old, 2014, but stable). Verify download page before use. |

## Installation

```bash
# Backend (Python 3.12/3.13, in a venv on the server PC; wheels can be pre-downloaded with `pip download` for offline install)
pip install "fastapi==0.162.0" "uvicorn[standard]==0.54.0" "sqlalchemy>=2.0.40,<2.2" "alembic==1.20.1" \
            "psycopg[binary]==3.3.6" "pydantic==2.14.2" pydantic-settings \
            "argon2-cffi==25.1.0" "python-multipart==0.0.32" "pillow==13.0.0"
pip install -D pytest==9.2.0 httpx==0.28.1   # dev only

# Offline install on the server: build a wheelhouse on an internet PC
#   pip download -r requirements.txt -d wheelhouse
# then on the server:
#   pip install --no-index --find-links wheelhouse -r requirements.txt

# Frontend (BUILD MACHINE ONLY, needs Node LTS + internet)
npm create vite@latest frontend -- --template react-ts
npm install react-router@8 @tanstack/react-query@5 react-hook-form@7 zod@4 @hookform/resolvers@6 date-fns
npm install @fontsource/noto-sans-devanagari @fontsource/inter
npm install -D tailwindcss@4 @tailwindcss/vite
npm run build        # outputs frontend/dist
```

## Integration and architecture decisions

### Auth: server-side sessions in a cookie (not JWT)
- Store sessions in a PostgreSQL `sessions` table: random 256-bit token (`secrets.token_urlsafe(32)`), store only its SHA-256 hash, user_id, created_at, last_seen_at, expires_at (e.g. 12 h absolute, 30 min idle for reception; tune).
- Cookie: `HttpOnly`, `SameSite=Lax` (or Strict), `Path=/`, `Secure` once HTTPS is on. No token in `localStorage`.
- Why not JWT: single server, single DB, so stateless tokens buy nothing; sessions can be revoked instantly (disable user, forced logout, role change takes effect immediately), which matters for an audited hospital system. Avoids refresh-token complexity.
- Argon2id for passwords (argon2-cffi defaults are fine on a modern PC; tune `time_cost` so login takes ~100-300 ms on the server). Enforce a minimum length, lockout/backoff after N failed attempts (counter in DB), audit login success/failure.
- CSRF: since cookies are used, require a custom header on all state-changing requests (double-submit: server sets a readable `csrf_token` cookie, SPA echoes it in `X-CSRF-Token`, a dependency compares) plus an `Origin`/`Host` check against an allowlist. `SameSite=Lax` alone is a good baseline but add the header check. Because the SPA and API are same-origin (FastAPI serves both), do NOT enable CORS at all in production.
- Login rate limit: simple DB-backed counter; do not add Redis or slowapi.

### RBAC pattern: dependencies + permission strings
- `get_current_user` dependency: reads cookie, loads session + user, rejects expired/disabled, bumps `last_seen_at`.
- `require_permission("patient:write")` returns a dependency; attach per route via `dependencies=[Depends(require_permission(...))]` or per-router so a missing check is hard to forget.
- Model: `roles` -> `permissions` (string codes) -> users have one or more roles; seed roles admin/reception/doctor. Decide permissions on the server from DB, never from a client-sent claim.
- Add a test that enumerates `app.routes` and fails if any route (except `/api/auth/login`, health, static) lacks an auth dependency. This turns "backend enforces permissions" into an automated gate.
- Audit: write audit rows from the same dependency/service layer (user, action, entity, before/after summary, IP, timestamp) in the same DB transaction as the change.
- Photos: serve through an authenticated endpoint (`GET /api/patients/{id}/photo`) with `FileResponse`; never mount the photo directory as public static.

### Serving the frontend: FastAPI itself (no reverse proxy needed)
- Build with Vite `base: "/"`, copy `dist/` next to the backend. In FastAPI mount `/assets` via `StaticFiles` and add a catch-all GET that returns `index.html` for non-`/api` paths (so `/admin`, `/reception`, `/doctor` deep links and refresh work). Namespace all API routes under `/api`.
- One process, one port, one service, same origin (no CORS, simpler cookies/CSRF). Fine for ~10-20 concurrent LAN users.
- Do NOT add nginx/IIS/Caddy unless HTTPS termination needs it (see below). Set `Cache-Control: immutable` on hashed assets, `no-cache` on `index.html`.

### Running as Windows services
- PostgreSQL: official EDB Windows installer registers `postgresql-x64-NN` service (auto start). Bind `listen_addresses = 'localhost'` (the app and backups run on the same PC), so the DB is not reachable from the LAN. Keep `pg_hba.conf` at `scram-sha-256` for 127.0.0.1 only.
- API: WinSW service wrapping `venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1` (add `--proxy-headers` only if a proxy is introduced). Config: `onfailure restart`, log rotation by size, dependency `<depend>postgresql-x64-NN</depend>` so DB starts first, run as a dedicated low-privilege local account with write access only to the app, photo and backup directories.
- Windows Firewall: inbound allow on the chosen port for the Private/LAN profile only. Reserve a static IP (or DHCP reservation) for the server and optionally set a friendly name via each PC's hosts file or the router DNS (e.g. `kalyan-server`).
- Run Alembic (`alembic upgrade head`) as an explicit install/upgrade step, not automatically at every service start.

### HTTPS on the LAN
- Plain HTTP on a closed LAN works technically, but credentials and patient data travel unencrypted and Secure cookies are impossible. Recommended: HTTPS with a locally generated CA.
- Simplest integration: create a private root CA + server certificate (SAN = server IP and hostname) with `mkcert` or OpenSSL (generated once on a build machine), install the root CA into Windows "Trusted Root" on each client PC (one-time, in handover checklist; Firefox needs its own import or `security.enterprise_roots.enabled`), and give uvicorn `--ssl-keyfile/--ssl-certfile`. Keep the key out of the repo.
- Use a long validity (e.g. 5-10 years for the CA, 2-3 years for the leaf) and record the renewal procedure in the handover doc. An expired cert silently breaks everyone, so add it to the admin integrity page.
- Caddy (single exe, internal CA, auto-renews) is a good alternative if renewals become a worry, at the cost of one more service. Not needed on day one.
- Never expose the port to the internet (router NAT or port-forwarding off).

### PDF and print: browser print CSS for the A4 registration card
- Use a dedicated React print route/component with `@page { size: A4; margin: 10mm }` and `@media print` rules, trigger `window.print()`; the browser's text engine does Devanagari shaping correctly and the dual-signature pad layout is just CSS grid with fixed mm dimensions. Zero extra server dependencies, works offline, matches the on-screen preview.
- Why not server-side: ReportLab (5.1.0) does not do complex-script shaping, so Hindi conjuncts and matras can render wrongly. WeasyPrint (70.0) shapes correctly but needs GTK/Pango runtime DLLs on Windows, which is a heavy, fragile install for a one-time handover.
- Revisit server-side PDF (WeasyPrint, or a headless Chromium) only if the client demands emailed/archived PDFs or automated batch printing. Receipts and reports can reuse the same print-CSS approach. Document that print fidelity depends on browser settings ("Headers and footers" off, scale 100%) in the handover guide, and test on the actual reception PC and printer.

### Backups: pg_dump + photo files
- Nightly Windows Task Scheduler job running a script that: (1) `pg_dump -Fc` to a timestamped file (custom format, restorable with `pg_restore`), (2) copies/zips the photo and documents directory, (3) writes a manifest with SHA-256 hashes of each file, (4) retains N days, (5) copies to a second drive/USB. The PostgreSQL password is supplied via `PGPASSFILE` or `%APPDATA%\postgresql\pgpass.conf` for the service account, never on the command line.
- Admin UI "Backup now" calls the same script via the API (admin permission, audited); restore is a documented offline procedure (stop the API service, `pg_restore --clean --if-exists` into a fresh DB, restore photos, run integrity check, start service). Proving restore on a clean machine is a v3.0 success criterion, so script and test it.
- Keep the DB dump and photos in ONE timestamped folder or archive so they cannot drift apart. Back up the `.env` / secret key separately and securely.

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Server-side sessions in PostgreSQL | JWT access+refresh tokens | Only if a separate mobile/third-party client or multiple API servers appear. |
| argon2-cffi (Argon2id) | bcrypt / passlib | bcrypt if the argon2 wheel will not install on the server's Python. Avoid passlib (unmaintained). |
| Sync SQLAlchemy session | Async SQLAlchemy + asyncpg/psycopg async | Only for very high concurrency; not needed for a single-hospital LAN, and async adds debugging cost. |
| psycopg 3 | psycopg2-binary | Only for legacy tooling; psycopg3 is the current driver and works with SQLAlchemy 2. |
| WinSW | NSSM 2.24 | NSSM is simpler for a one-liner install (`nssm install`) and fine if the installer isn't scripted. Both are free. |
| FastAPI serves SPA | nginx / Caddy in front | Caddy if you want automatic internal-CA HTTPS and cert renewal; nginx/IIS add little here. |
| Tailwind + shadcn/ui | Mantine (v8.x, verify) | Mantine gives ready-made tables, forms, dates and a date picker in one npm package: faster for a solo dev, less design flexibility. Also offline-safe once bundled. |
| Browser print CSS | WeasyPrint / headless Chromium PDF | When server-generated archived PDFs are required. |
| TanStack Query polling | WebSockets / SSE | Only if reception needs instant push of queue changes; polling every 15-30 s is enough for v3.0. |
| react-hook-form + zod | Formik, plain controlled state | No compelling reason; RHF is lighter. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Any CDN link (Google Fonts, unpkg, cdnjs, Font Awesome kit, Tailwind CDN script) | System runs with no internet; page would break or hang | Self-host via npm (`@fontsource`, bundled icons such as `lucide-react`) so everything is inside `dist/`. |
| Next.js / Remix / React Router framework mode | Requires Node on the server; contradicts "server PC does not need Node" | Vite SPA + React Router library mode. |
| Three separate frontend projects | Out of scope and over budget | One app, role-guarded routes. |
| JWT in localStorage | XSS-stealable, hard to revoke | HttpOnly session cookie. |
| SQLite for the server DB | Weak concurrent writes across PCs | PostgreSQL (decided). |
| Docker / WSL2 / Kubernetes on the server PC | Heavy, virtualization/BIOS/RAM requirements on an unknown low-cost PC, extra failure modes for non-technical staff | Native Windows installs: Python venv + EDB PostgreSQL + WinSW. |
| Redis, Celery, RabbitMQ, Elasticsearch | No need at this scale; each adds a service to maintain | PostgreSQL (sessions, rate-limit counters, full-text/trigram search if needed). |
| Cloud/SaaS auth (Auth0, Firebase, Clerk), email/SMS gateways | Needs internet and recurring cost | Local accounts. |
| Public static mount of the photo/upload folder | Patient photos readable without login | Authenticated download endpoint. |
| gunicorn, `uvicorn --reload` in production | Gunicorn does not run on Windows; reload is for dev | Uvicorn under WinSW. |
| passlib, python-jose, fastapi-users | Unmaintained or heavy for a fixed 3-role system | argon2-cffi and a small custom auth module (about 150 lines). |
| Auto-running `alembic upgrade` or `create_all()` at startup | Silent schema changes on a medical DB | Explicit migration step in the install/upgrade runbook. |
| Floats for money | Rounding errors | Integer paise end to end (`BigInteger` column, `int` in Pydantic and TS). |
| Storing photos as BLOBs in PostgreSQL (for this project) | Bloats dumps; but simplifies consistency | Files on disk with relative paths in DB; backed up together (decision in project). |

## Stack Patterns by Variant

**If the server PC is a low-spec machine (4 GB RAM, HDD):**
- Use a single uvicorn worker and keep PostgreSQL default shared_buffers (128 MB). Put backups on a separate disk or USB.
- Because Argon2 uses memory per hash, keep parameters near defaults; avoid parallel login storms.

**If HTTPS client trust setup proves too painful for the staff PCs:**
- Run HTTP on the closed LAN as a documented fallback with `Secure` cookie flag off, and prioritise physical/LAN security. Prefer fixing HTTPS; patient data is sensitive.

**If the dev machine cannot get Node at all:**
- Build the frontend in CI (GitHub Actions) or on any internet PC; commit/attach the built `dist/` as the release artefact. The backend repo only needs `frontend/dist`.

**If network topology turns out to be a single-PC deployment:**
- The PROJECT notes keep the v2.0 desktop app valid for that case; do not retrofit this stack into it.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| FastAPI 0.162.0 | Pydantic 2.14.x, Starlette (pulled in automatically), Python >=3.10 | Do not mix Pydantic v1. |
| SQLAlchemy 2.0/2.1 | Alembic 1.20.1 (requires SQLAlchemy>=2.0) | 2.1.6 is listed as stable on PyPI; if a dependency pin or a tutorial breaks, drop to the latest 2.0.x. Re-run migrations tests on whichever you pin. |
| SQLAlchemy 2.x | psycopg 3.3.x | Dialect `postgresql+psycopg`. Use `psycopg[binary]` on Windows. |
| Vite 8.3.5 | @vitejs/plugin-react 6.1.2, Node LTS (check engines) | Confirm Node version at scaffold. |
| React 19.3.1 | React Router 8.5.1, TanStack Query 5.x, react-hook-form 7.x | `@hookform/resolvers` 6 pairs with zod 4. |
| Tailwind 4.3.3 | `@tailwindcss/vite` same major | No `tailwind.config.js` needed in v4 (CSS-first config). |
| TypeScript 7.0.2 | typescript-eslint / Vite tooling | Newest major: if any tool errors, pin the last 5.x/6.x. |

## Open items (unverified, check before install)

- Exact current PostgreSQL 18 minor release and whether the EDB installer is supported on the server PC's Windows edition (search results conflicted: 18.3 vs 18.6). Check postgresql.org/download/windows. Support horizon for 18 is roughly 2029-2030.
- WinSW: stable is the 2.12.0 line; v3 was still alpha (v3.0.0-alpha.11) at last check. Download from GitHub Releases and verify the checksum.
- Node LTS version required by Vite 8 (read the package `engines` field after scaffold).
- Server PC specs, static IP and whether client PCs can have a custom root CA installed (affects HTTPS plan).
- Printer drivers and browser (Chrome/Edge) on the reception PC for A4 print testing.

## Sources

- https://pypi.org/pypi/fastapi/json (0.162.0, requires Python >=3.10) — checked 2026-10-30
- https://pypi.org/pypi/sqlalchemy/json (2.1.6 stable) — checked 2026-10-30
- https://pypi.org/pypi/alembic/json (1.20.1, requires SQLAlchemy>=2.0) — checked 2026-10-30
- https://pypi.org/pypi/psycopg/json (3.3.6, uploaded 2026-09-18) — checked 2026-10-30
- https://pypi.org/pypi/argon2-cffi/json (25.1.0), uvicorn (0.54.0), reportlab (5.1.0), pydantic (2.14.2), python-multipart (0.0.32), pillow (13.0.0), pytest (9.2.0), httpx (0.28.1), weasyprint (70.0), psycopg-pool (3.3.3) — checked 2026-10-30
- https://registry.npmjs.org/ (react 19.3.1, vite 8.3.5, react-router 8.5.1, @tanstack/react-query 5.105.0, react-hook-form 7.91.0, zod 4.6.7, @hookform/resolvers 6.0.2, typescript 7.0.2, tailwindcss 4.3.3, @vitejs/plugin-react 6.1.2, @tanstack/react-table 9.3.1) — checked 2026-10-30
- https://www.postgresql.org/download/windows/ — web search only; minor version unconfirmed (LOW confidence on minor number)
- https://github.com/winsw/winsw and https://winsw.github.io/v3/ — web search only; v3 pre-release status (MEDIUM)
- Architecture patterns (sessions vs JWT, CSRF, RBAC dependencies, print CSS vs server PDF): author's engineering judgement, no single source (MEDIUM-HIGH)

---
*Stack research for: offline LAN hospital web platform (FastAPI + PostgreSQL + React/TS)*
*Researched: 2026-10-30*
