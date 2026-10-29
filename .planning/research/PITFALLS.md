# Pitfalls Research

**Domain:** Moving a single-PC desktop clinic app (PySide6 + SQLite) to a central-server, LAN-only, offline web app (FastAPI + PostgreSQL + one React/TS app) for a small Indian physiotherapy hospital; fixed price Rs 22,000, 4-6 weeks
**Researched:** 2026-10-30
**Confidence:** HIGH for security, PostgreSQL, concurrency and money pitfalls (well-established engineering practice); MEDIUM for Windows-service and power-cut specifics (depends on unconfirmed server hardware); MEDIUM for printing (depends on the physical pad and printer)

Phase names below are suggested roadmap phases for v3.0. Adjust to the real roadmap:
- **P1** Server foundation: PostgreSQL schema, migrations, FastAPI skeleton, auth/session, install and service scaffolding
- **P2** Reception: registration, URN, photos, appointments
- **P3** Doctor: encounters, sessions, prescriptions
- **P4** Billing: charges, payments, receipts, packages
- **P5** Admin, audit, backup and restore
- **P6** Printing, reports, hardening, LAN/power-cut testing, handover

## Critical Pitfalls

### Pitfall 1: Role hiding in the UI with no per-endpoint authorization (IDOR)

**What goes wrong:**
The `/admin` route is hidden from reception in React, but `GET /api/admin/users` or `GET /api/patients/123` works for any logged-in user. A doctor can read other doctors' patients or encounters by changing an ID in the URL, and a reception user can call billing-edit or backup endpoints directly.

**Why it happens:**
Routes were split by role in the frontend, so the developer feels the roles are "done". Object-level access (this doctor's patient) is forgotten because the v2.0 desktop app never had multiple users per data set.

**How to avoid:**
- Default-deny: a FastAPI dependency such as `require_permission("billing.write")` on every router; a startup test that walks `app.routes` and fails if any route lacks an auth dependency (explicit allowlist for login and health).
- Object-level rules in the service layer, not routers: define who may see a patient/encounter (assigned doctor, or any doctor if the hospital allows shared access; decide and write it down with the client).
- Return 404 rather than 403 for other users' objects where leaking existence matters.
- Never trust role or user_id from the request body or JWT claims that the client can alter; resolve from the server-side session each request.
- API test matrix: every endpoint x every role (admin, reception, doctor A, doctor B, anonymous) with expected status.

**Warning signs:**
Permission checks written only as `if user.role == ...` in React; endpoints taking `doctor_id` as a parameter; tests only exercising the happy path with an admin token; "we will add permissions at the end".

**Phase to address:** P1 (permission dependency and route-coverage test), enforced in every later phase; full role x endpoint matrix verified in P6.

---

### Pitfall 2: Weak password and session handling on plain HTTP LAN

**What goes wrong:**
Passwords travel in cleartext across the LAN; anyone with Wireshark on the Wi-Fi/switch can capture them. Passwords stored with fast hashes or in the seed script; shared "reception" logins; sessions never expire; staff leave a doctor PC logged in; default admin password left unchanged after handover.

**Why it happens:**
"It is only the LAN" thinking, plus HTTPS looks hard without a public domain.

**How to avoid:**
- Hash with argon2id (argon2-cffi) or bcrypt; never store or log plaintext; rate-limit and lock out after repeated failures (per user and per IP).
- Prefer HTTPS even on LAN: a self-signed or locally generated CA cert (mkcert-style) installed on the few client PCs, served by Caddy/uvicorn. If the client rejects it, document the accepted risk explicitly and keep the network wired/segregated from guest Wi-Fi.
- Server-side session in PostgreSQL (random 256-bit token, hashed in DB), idle timeout (e.g. 30 min) and absolute timeout (e.g. 12 h), logout invalidates server-side, session rotation on login.
- Cookie flags: HttpOnly, SameSite=Lax/Strict, Secure when HTTPS. Without HTTPS, Secure cannot be set, so this is the main argument for TLS.
- Force password change on first login; no default credentials in the installer (generate random initial admin password and print once).
- One account per person; audit login success/failure.

**Warning signs:**
Same password for all reception staff; token in localStorage; no session table; admin/admin in the README; login endpoint with no throttling.

**Phase to address:** P1 (auth design, hashing, session store, TLS decision recorded); P6 (pen-test checklist: cleartext capture, timeout tests).

---

### Pitfall 3: CSRF and CORS misconfiguration

**What goes wrong:**
Cookie-session auth plus `allow_origins=["*"]` with credentials, or CORS copied from a dev setup; a malicious page opened in a staff browser can post state-changing requests to `http://192.168.x.x/api`. Alternatively CORS is blocked on the LAN because the server is reached by IP, hostname and localhost interchangeably.

**Why it happens:**
Dev server (Vite on :5173) and API (:8000) are cross-origin, so CORS gets loosened and the loosened setting ships.

**How to avoid:**
- Production: serve the built React assets and the API from the same origin (FastAPI StaticFiles or a reverse proxy); then CORS is not needed at all. Keep CORS permissive only in dev config.
- If cookies are used: SameSite=Lax/Strict plus a CSRF token (double-submit or custom header such as `X-Requested-With`/`X-CSRF-Token` checked on all non-GET); GET must never change state.
- Pick one canonical URL (a fixed hostname like `http://kalyan-server` or fixed IP) so cookies and the cert match.
- Set security headers (X-Content-Type-Options, frame-ancestors/X-Frame-Options, a basic CSP).

**Warning signs:**
`allow_origins=["*"]` with `allow_credentials=True`; POST endpoints that work from a curl call with only a cookie; state change via GET.

**Phase to address:** P1 (same-origin serving and CSRF middleware); P6 (verification).

---

### Pitfall 4: Windows service does not come back after a power cut

**What goes wrong:**
Bihar power outages are frequent and often abrupt. After power returns, the server PC either stays at the BIOS "press F1" screen, waits at the Windows login screen (services needing a logged-in user never start), PostgreSQL starts after the API (API crashes on first connect and never retries), or the app was started from a console/Task Scheduler "at logon" so nothing runs. Staff then think the system is down and restart things incorrectly.

**Why it happens:**
The app is developed by running `uvicorn` in a terminal. Service registration (NSSM, WinSW, or pywin32) is left to the end; BIOS "restore on AC power loss" is never set.

**How to avoid:**
- BIOS: set "AC Power Recovery = Power On" (or Last State); disable F1-on-error prompts. Document in the handover.
- Run PostgreSQL as a Windows service (the installer default) and the API as a service via NSSM or WinSW, startup type Automatic (Delayed Start), account with least privilege (not an interactive user), recovery actions set to restart on failure (restart after 5-10 s, reset counter daily).
- Service dependency: API service depends on `postgresql-x64-NN`.
- API startup retries DB connection with backoff rather than exiting; `/health` endpoint checks DB.
- A UPS (even a 600-1000 VA unit) giving 10+ minutes plus clean shutdown; PostgreSQL is crash-safe via WAL, but abrupt power loss with cheap disks/write-cache can still corrupt data. Keep `fsync` and `full_page_writes` on (defaults) and never disable them for speed.
- Windows: disable automatic restarts for updates during working hours, set active hours, and avoid auto-login passwords stored in plaintext as the only way the system works.
- Test: pull the plug during writes (3 times), power on, confirm no human action beyond pressing power; confirm browser from a client PC works within N minutes.

**Warning signs:**
App works only when someone is logged in; services show "Manual"; no recovery tab config; startup log shows "connection refused" on boot; no UPS in the plan or budget.

**Phase to address:** P1 (service scaffolding as part of the very first install), proven in P6 (power-cut drill, as an acceptance criterion).

---

### Pitfall 5: PostgreSQL data directory and backup mistakes

**What goes wrong:**
- Data directory on a dying or only disk with no free-space monitoring; WAL or logs fill the disk and PostgreSQL stops.
- Backups written to the same physical disk (disk dies, data and backup both gone), or to a folder inside the PostgreSQL data directory.
- Backups never test-restored; `pg_dump` run with wrong credentials (password prompt in a scheduled task) and silently producing empty files; photos not included, so a restore gives patients without pictures.
- Backup file copied while being written; backup of the data folder by file copy while the server is running (inconsistent).
- Antivirus scanning or locking the data directory causing stalls/corruption.

**Why it happens:**
v2.0 had a single-file SQLite bundle that was trivially copyable; PostgreSQL needs `pg_dump`/`pg_basebackup`, credentials, versions and a separate restore procedure. Backup is treated as "done" once a file appears.

**How to avoid:**
- Use `pg_dump -Fc` (custom format) from a scheduled job via `pgpass.conf` or env var; check exit code and file size; write a manifest with checksum (SHA-256), PostgreSQL version, app schema version, row counts; bundle with the photo directory (carry over the v2.0 verified-bundle concept).
- Destination on a different physical device: external USB disk plus a second copy on another PC on the LAN (and a rotated off-site copy kept by the trustee). Keep daily x7, weekly x4, monthly x6.
- Backup runs nightly, plus on-demand button in `/admin`; alert on the admin dashboard when last successful backup is older than 36 h.
- Restore drill is an acceptance test: restore onto a clean machine/VM, run integrity checks (counts, URN max, receipt totals vs payments), open a photo. Repeat quarterly; document in a one-page runbook with screenshots.
- Pin PostgreSQL major version; store the installer for that exact version with the project (offline!), because restores need compatible binaries.
- Exclude data dir from antivirus; monitor free disk; set log rotation.

**Warning signs:**
Backup dir path starts with the same drive letter as the data dir; backup files of a few KB; no restore script in the repo; nobody knows the postgres superuser password; backup documented but never run on a second machine.

**Phase to address:** P5 (backup bundle, manifest, restore); first restore rehearsal in P5, repeated as a handover gate in P6.

---

### Pitfall 6: Photo and document upload vulnerabilities (path traversal, bad validation, unauthenticated static serving)

**What goes wrong:**
Uploaded filenames used directly on disk (`../../app/config`); executable or HTML/SVG files accepted and later served inline; photos exposed through a public `/static/photos/` path with no auth; huge phone photos (10 MB each) fill disk and slow pages; photo files and DB rows drift (orphans, or DB rows pointing at missing files); file names containing patient names leak PHI.

**Why it happens:**
StaticFiles mount is the fastest way to show images; the filename from the client is trusted.

**How to avoid:**
- Never use the client filename. Generate server-side names (UUID) and store `photos/<yyyy>/<uuid>.jpg`; keep original name only as metadata.
- Validate by content, not extension/Content-Type: decode with Pillow, allow JPEG/PNG only (and PDF for documents if needed, checked by magic bytes), re-encode and strip EXIF (GPS), cap dimensions (e.g. 1024 px) and size (e.g. 5 MB), reject SVG/HTML.
- Resolve and confirm the final path is inside the photo root (`Path.resolve().is_relative_to(root)`); no user-supplied path segments.
- Serve through an authenticated endpoint (`GET /api/patients/{id}/photo`) that applies the same permission check as patient data; set `Content-Disposition`/`X-Content-Type-Options: nosniff`.
- Photo root outside the web root and outside the app install folder; included in the backup bundle; periodic integrity check (DB rows vs files, checksums stored at upload).
- Limit request body size at the server/proxy.

**Warning signs:**
`app.mount("/photos", StaticFiles(...))`; `open(upload.filename, ...)`; photo URL guessable and openable in a private window without login; no file size limit.

**Phase to address:** P2 (upload pipeline and authenticated serving); P5 (backup inclusion and integrity check); P6 (traversal and unauthenticated-access tests).

---

### Pitfall 7: Concurrent URN (KH-YYYY-XXXX) and receipt number generation

**What goes wrong:**
Two reception PCs register patients at the same moment; code does `SELECT MAX(seq)+1` and both get KH-2026-0042, causing a unique-constraint error or, worse, duplicate IDs if there is no constraint. Receipt numbers gap or duplicate; a rolled-back transaction burns a number; the counter does not reset or increment correctly at year change; manual import leaves counters behind data.

**Why it happens:**
SQLite serialised writes made `MAX+1` safe in v2.0. Under PostgreSQL's concurrent transactions it is not.

**How to avoid:**
- Counter table `(series, year, last_value)` updated atomically in the same transaction: `INSERT ... ON CONFLICT (series, year) DO UPDATE SET last_value = counters.last_value + 1 RETURNING last_value` (row lock serialises concurrent callers). Or a per-year PostgreSQL SEQUENCE if gaps are acceptable. Decide with the client whether gaps are acceptable: for receipts (accounting) prefer the counter-table approach so a rolled-back transaction does not burn a number, and never delete receipts (void instead).
- UNIQUE constraints on `urn` and `receipt_no` as the last line of defence.
- Year boundary derived from IST date (see Pitfall 9), not UTC, and not from client clock.
- Format at presentation: `KH-{year}-{seq:04d}`; handle > 9999 (widen rather than truncate).
- Migrated data: set the counter to max existing value before go-live.
- Concurrency test: 20 parallel registration requests in CI; assert contiguous unique numbers.

**Warning signs:**
`MAX(` in registration code; unique violations in logs under load; receipts numbered by client-side JS; no test with parallel clients.

**Phase to address:** P1 (counter primitive and migrations); used in P2 (URN) and P4 (receipts); parallel test in P2/P4.

---

### Pitfall 8: Money rounding and integer-paise leaks

**What goes wrong:**
Integer paise are used in the DB but a float sneaks in at the edges: JSON `1250.50` parsed to a float, `Math.round(x*100)` in JS giving 1250.4999, percentage discounts or per-session package splits (Rs 5,000 / 3 sessions) losing or inventing paise, display with `toFixed` rounding differently than the server, PostgreSQL `NUMERIC` and Python `Decimal` mixed with ints, receipts totals not equal to sum of lines.

**Why it happens:**
Rupees are the human unit; every boundary (form input, API, report, print) is a conversion point.

**How to avoid:**
- Wire format is integer paise only (`amount_paise: int`); Pydantic `StrictInt`/`conint(ge=0)`; reject floats. DB columns `BIGINT` with CHECK constraints (payments > 0; paid <= total; balance >= 0 unless refunds are modelled).
- One shared conversion function per side (parse rupee string to paise by string/Decimal arithmetic, never float; format paise to "Rs 1,250.50", Indian digit grouping lakh/crore).
- Define the rounding rule explicitly for any division (package per-session value, discounts): round-half-up on paise, remainder assigned to the last instalment, so sums always reconcile. Write it as a unit test table.
- Totals computed on the server only; the UI displays them.
- Payments immutable; corrections via reversal entries with audit.
- Carry over v2.0 tests (negative payment, overpayment rejected) as the acceptance baseline for the port.

**Warning signs:**
`float` or `parseFloat` near amounts; `NUMERIC(10,2)` appearing in new migrations beside paise columns; reports whose totals differ by 1 paisa from the sum of rows.

**Phase to address:** P1 (money type and tests), P4 (billing, packages, receipts), P6 (reconciliation report check).

---

### Pitfall 9: Time zone handling (IST)

**What goes wrong:**
Timestamps stored as naive local time in some tables and UTC in others; server PC clock or time zone set wrong or drifting after power cuts (no RTC battery, no internet NTP); registration at 00:30 IST on 1 January gets the previous year's URN because the server computed the year in UTC; appointment "today" lists shift by 5.5 hours; browser clients with a wrong clock create wrong "created at"; the printed card shows UTC time.

**Why it happens:**
SQLite stored plain text; Python `datetime.now()` is naive; JSON serialisation drops offsets.

**How to avoid:**
- Store all instants as `timestamptz` (PostgreSQL stores UTC); set the connection `TimeZone='Asia/Kolkata'` and render in IST in the UI; "business date" fields (appointment date, URN year, receipt date) are computed on the server using `zoneinfo.ZoneInfo("Asia/Kolkata")`. Include `tzdata` pip package since Windows lacks the tz database.
- Server timestamps only; client clock never trusted for audit, URN, or receipt dates.
- Windows server: time zone "India Standard Time", sync from the router or a local NTP source when available; show the server time on the admin dashboard and warn on large drift; BIOS RTC battery checked.
- Migrated data: v2.0 text timestamps assumed IST and converted explicitly with a documented rule.
- Tests around 23:59/00:00 on 31 Dec and 31 Mar (financial year).

**Warning signs:**
`datetime.now()` or `datetime.utcnow()` anywhere; `TIMESTAMP WITHOUT TIME ZONE` columns; registrations after midnight appearing under the wrong date; JS `new Date()` used to fill a form's date field and POSTed.

**Phase to address:** P1 (conventions and schema), P2 (URN year), P4 (receipt dates); P6 (clock-drift and midnight tests).

---

### Pitfall 10: SQLite-to-PostgreSQL migration traps

**What goes wrong:**
- Assuming the v2.0 database must be migrated when it may only hold demo data; or the opposite, if real data exists, silently losing it.
- Type affinity differences: SQLite accepts strings in integer columns and mixed types; booleans stored as 0/1; dates as free text; these fail or mis-sort in PostgreSQL.
- Case sensitivity and collation: patient name search `LIKE` is case-insensitive in SQLite for ASCII but case-sensitive in PostgreSQL; Devanagari/Hindi names need a UTF-8 database and proper collation (use `ILIKE`, `unaccent`/`pg_trgm` if needed). Create the DB with UTF8 encoding (Windows installers may default to a Windows-1252-ish locale).
- Autoincrement IDs vs sequences: after import, sequences are not advanced, causing duplicate-key errors on the first insert.
- SQL dialect differences: `?` vs `%s`, `INSERT OR REPLACE`, `AUTOINCREMENT`, `strftime`, no `PRAGMA`, stricter GROUP BY, transactions behave differently (DDL transactional in PostgreSQL).
- Reusing the SQLite code path in tests (so tests pass on SQLite but production uses PostgreSQL); schema owned by ORM `create_all` instead of migrations.
- Foreign keys not enforced in SQLite by default, so existing data has orphans that break FK creation.

**Why it happens:**
The v2.0 repo is nearby and tempting to port line-by-line; SQLite is easy for tests.

**How to avoid:**
- Decide early and record: is there production v2.0 data? PROJECT.md says development uses synthetic data, so likely a clean start; confirm with the client. If real data exists, write a one-off ETL script with validation (row counts, sum of paise, max URN) and a dry run on a copy.
- Treat v2.0 as a specification of rules, not code to port (already stated in PROJECT.md); rewrite the data layer.
- Alembic migrations as the only way to change schema; tests run against real PostgreSQL (local instance or testcontainers equivalent available offline); no SQLite fallback.
- After any bulk import: `setval` all sequences/counters; run orphan checks before adding FKs.
- DB created with `ENCODING 'UTF8'`; test with Hindi names.

**Warning signs:**
Both `sqlite3` and `psycopg` imports in new backend; tests using in-memory SQLite; "works after I restart" duplicate-key errors after import; Hindi name search returns nothing.

**Phase to address:** P1 (schema, migrations, test DB policy); migration script only if real data is confirmed, before P2 go-live.

---

### Pitfall 11: Server PC as a single point of failure

**What goes wrong:**
One PC hosts everything; if it dies, the hospital cannot register or bill. The server doubles as a reception PC, so staff reboot, shut it down, install software or let it sleep/hibernate; it is under a desk with dust and no UPS; the only knowledge is in the developer's head.

**Why it happens:**
Budget forces one machine; the server is "just another PC".

**How to avoid:**
- Dedicated server role: no daily-use account, no sleep/hibernate (power plan: never sleep; disable USB selective suspend), Windows Update active hours and no forced reboot, firewall allows only the app port on the private LAN profile, fixed IP via DHCP reservation, hostname shortcut on each client.
- Hardware advice in the handover: UPS, SSD with a second disk or USB backup target, surge protection.
- Cold-standby plan: second PC with PostgreSQL and the app pre-installed, backup restored on demand; documented runbook with an estimated recovery time (e.g. under 2 hours). Practise once.
- Downtime procedure: paper pad forms remain available (the v2.0 dual-signature pad is a natural fallback); data is entered afterwards. Agree with the client.
- Read-only monitoring on `/admin` (disk free, last backup, DB up).

**Warning signs:**
Server hardware undecided at P3; no UPS line item; nobody besides the developer can restart the service; server PC placed at the reception desk.

**Phase to address:** P1 (hardware and LAN confirmation as an entry gate; record in Key Decisions), P6 (runbook, standby drill, handover).

---

### Pitfall 12: Browser caching of old frontend builds after updates

**What goes wrong:**
After a deployment, reception PCs keep running the old JS bundle (cached `index.html` or unhashed filenames) against the new API; screens break or silently send fields the server no longer accepts. Staff report "bug is not fixed" when it is a cache issue; hard refresh instructions get relayed by phone.

**Why it happens:**
Static file servers add aggressive default caching; `index.html` is cached; no version contract between UI and API.

**How to avoid:**
- Vite hashed filenames (default) for assets with `Cache-Control: public, max-age=31536000, immutable`; `index.html` and the service worker (if any, preferably none) served with `Cache-Control: no-cache`.
- Do not add a PWA/service worker unless necessary; it is the classic source of stuck old builds.
- Expose `GET /api/version`; the UI sends its build id header and shows a "New version available, reload" banner when it differs; API rejects incompatible clients with a clear message (HTTP 426-style) instead of failing obscurely.
- Show app version in the footer for support calls; update procedure ends with "Ctrl+F5 on each client" as a fallback checklist item.
- Keep API changes backward compatible within a release; deploy during off hours.

**Warning signs:**
Same bundle filename between builds; index.html returns `ETag` only with long max-age; support messages after every update.

**Phase to address:** P1 (static serving headers, version endpoint), P6 (update/rollback procedure tested: deploy v+1 while a client tab is open).

---

### Pitfall 13: Print alignment drift between the browser and the physical dual-signature pad

**What goes wrong:**
The v2.0 print layout was tuned to the physical pad in a Qt print path. In a browser, margins, scaling ("Fit to page"), default headers/footers (URL, date), different printer drivers and Chrome vs Edge differences shift fields by millimetres; the approved 12-field form no longer lines up with the pre-printed pad; Hindi text renders in a fallback font; each PC prints differently.

**Why it happens:**
HTML printing is not a pixel-exact medium and the browser print dialog retains per-user settings.

**How to avoid:**
- Use a CSS `@page { size: A4; margin: 0 }` with absolute mm-based layout, `print-color-adjust`, and a dedicated print route; test on the real pad and the real printer, not just PDF preview.
- Prefer server-generated PDF (e.g. WeasyPrint is heavy on Windows; ReportLab or a headless-browser-free approach) for the registration card so layout is deterministic, then open and print the PDF at "Actual size". Choose one path early; evaluate in a spike during P2.
- Embed the Devanagari font (Noto Sans Devanagari) locally; no CDN (offline).
- Provide a calibration offset (x/y mm) in admin settings per printer; store a reference scan of the approved v2.0 print for visual diff.
- Document the print dialog settings (Margins None, Scale 100%, headers/footers off); preconfigure the reception browser profile.
- Get client sign-off on a physical test print before building other print outputs.

**Warning signs:**
Alignment validated only in on-screen preview; fields clipped on one PC; text size depends on the browser zoom; fonts differ between server and client.

**Phase to address:** Spike in P2 (decide HTML vs PDF with a real print), full implementation and client sign-off in P6 (or earlier if registration print is needed at go-live).

---

### Pitfall 14: Node.js build-only dependency leaking into the server or blocking builds

**What goes wrong:**
Node is not installed on the dev machine; installation is delayed late in the schedule. Or the server PC ends up needing Node/npm to run (dev server `vite` in production), and offline installation of npm packages on the hospital PC fails. Builds work on the developer's laptop but cannot be reproduced; `node_modules` or CDN links (Google Fonts, icons) cause the UI to break offline.

**Why it happens:**
The "build-only" boundary is stated but not enforced; third-party assets default to CDNs.

**How to avoid:**
- Install Node LTS on the build machine in week 1; lock versions (`.nvmrc`/`engines`, `package-lock.json`, `npm ci`).
- Commit or archive the built `dist/` as a release artifact; the install package contains only Python backend + `dist/` + PostgreSQL installer + scripts. No Node, no npm on the server.
- Self-host fonts, icons and all assets (no CDN references); verify by running the built app with the network disabled and watching the browser Network tab for external hosts.
- Python dependencies: vendored wheelhouse (`pip download`) or a bundled virtualenv/embedded Python so the server install works offline; pin versions.
- Release script builds, hashes, and tags the artifact; the same artifact is what gets installed.

**Warning signs:**
`npm run dev` mentioned in the install guide; any `https://` URL in `index.html` or CSS; the install requiring internet to `pip install`.

**Phase to address:** P1 (toolchain and offline packaging skeleton), P6 (clean-machine offline install rehearsal).

---

### Pitfall 15: Scope creep against Rs 22,000 / 4-6 weeks

**What goes wrong:**
"While you are there" additions: SMS reminders, reports, pharmacy, lab, inpatient, extra roles, dashboards, data import, UI polish per role. Three dashboards are built to full depth. Time goes to auth and ops (services, backup, restore, print) which are invisible to the client but mandatory, leaving billing unfinished. The effective hourly rate collapses.

**Why it happens:**
Fixed price plus a friendly client; features are cheap to mention; the invisible infrastructure work is underestimated.

**How to avoid:**
- Freeze v3.0 scope from `.planning/REQUIREMENTS.md`; keep a visible "Not in v3.0" list (already: SMS/WhatsApp, ERP, bed allocation, biometrics, cloud). Anything new is logged as a change request with a time/price estimate; defer to v3.1.
- Time-box: week 1 foundation + auth + service; weeks 2-3 reception/doctor vertical slices; week 4 billing; week 5 admin/backup/print; week 6 hardening, drills, handover. Hard cut-off for features at end of week 4.
- Build vertical slices end to end (UI + API + permission + audit + test) rather than all backends first.
- Reuse over invention: component library (e.g. a minimal one), generated OpenAPI client types, no custom design system, no i18n framework beyond what the pad requires.
- Reserve ~20 percent of time for ops/handover/testing; if a phase slips, cut doctor-side extras (treatment plan editor) before cutting backup/restore or permissions.
- Prioritise by Core Value: shared records, permissions at the API, proven restore.

**Warning signs:**
New requirements arriving in chat without an estimate; "nice-to-have" tickets above must-haves; week 3 and billing not started; hardware/LAN still unconfirmed.

**Phase to address:** Roadmap creation (phase sizing and explicit cut list); reviewed at each phase transition.

---

### Pitfall 16: Client approval gaps

**What goes wrong:**
Work proceeds on assumptions (who can see which patients, whether doctors share patients, receipt format, what "outstanding" means, backup frequency, server hardware); at handover the client says "this is not what I wanted". The v2.0 form was approved but the v3.0 screens, receipts, and roles were not. Payment is disputed because acceptance is undefined.

**Why it happens:**
Non-technical client, verbal agreement, no sign-off checkpoints, and long gaps between demos.

**How to avoid:**
- Written approval at defined gates (short email/WhatsApp acknowledgement is fine): (1) role matrix and data-visibility rules, (2) hardware and LAN confirmation, (3) registration print on the real pad, (4) receipt and billing format, (5) backup schedule and restore demo, (6) final acceptance checklist.
- Weekly demo on a LAN with synthetic data; record decisions in PROJECT.md Key Decisions.
- Written acceptance criteria tied to the Success metric (two PCs share records offline; permission test; clean-machine restore; power-cut recovery) and the payment milestones.
- Staff training session plus a one-page Hindi quick guide; named hospital owner who can say yes.
- Ask the open questions early: doctor visibility (own patients vs all), who may void a receipt, whether real v2.0 data exists, who holds admin credentials.

**Warning signs:**
Open decisions marked "Pending" in PROJECT.md (hardware/LAN) past week 1; feedback arrives only at the end; multiple stakeholders giving conflicting input.

**Phase to address:** Before P1 (hardware and role-rule decisions), and gates inside P2, P4, P5, P6.

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Run `uvicorn` from a terminal/batch file for the demo | Fast start | Dies on logoff/power cut; staff confusion | Dev only; never at handover |
| `allow_origins=["*"]` in dev copied to prod | No CORS errors | Cross-site request exposure | Dev only |
| ORM `create_all` instead of Alembic | No migration files | Cannot upgrade the installed DB safely | Never after first install |
| Store sessions in memory | Simple | All users logged out on every restart/power cut; no multi-worker | Only P1 spike; replace before P2 |
| Role checks only in React | Fast UI | Total bypass via API | Never |
| Serving photos via public StaticFiles | Quick display | Unauthenticated PHI access | Never |
| Skipping audit on "minor" edits | Less code | Cannot reconstruct who changed a bill | Never for billing/patient identity; acceptable for UI preferences |
| Hard-coded hospital name/addresses in templates | Fast print | Change requires code release | Acceptable if in one settings table seeded once |
| Skipping automated tests for print | Saves time | Alignment regressions | Acceptable if a manual print checklist exists |
| Single shared DB superuser for the app | One config | Compromise gives full DB control; accidental drops | Never: use an app role with limited rights |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| PostgreSQL on Windows | Default encoding/locale not UTF-8; listening on all interfaces with `trust` auth | UTF8 DB; `listen_addresses` localhost only (the API is the only client); `scram-sha-256` in `pg_hba.conf` |
| Windows Firewall | Opening port to Public profile or disabling the firewall | Allow only the app port on Private profile, scoped to the LAN subnet |
| NSSM/WinSW service | Relative paths, wrong working directory, stdout lost | Absolute paths, set app directory, log to rotating files, restart on failure |
| Reverse proxy (optional Caddy) | Extra moving part for little value | Use only if TLS is required; otherwise uvicorn serves static + API |
| Router / DHCP | Server IP changes after a power cut, bookmarks break | DHCP reservation or static IP, hostname alias, shortcut on each PC |
| Printer drivers | Client printer defaults override CSS @page | Test on each reception printer; documented dialog settings or PDF path |
| Backup target (USB/other PC) | Drive letter changes, share requires credentials | Use stable path / volume label check; alert if target missing |
| Hindi text (UTF-8) | Fallback fonts, mojibake in PDF/CSV exports | Embedded Devanagari font; UTF-8 everywhere; CSV with BOM for Excel |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| No index on patient search (name, phone, URN) | Search slows as patients accumulate | Indexes on URN, phone, lower(name) (or pg_trgm) | Tens of thousands of patients (not soon, but cheap to add up front) |
| Loading all patients/sessions in one response | Slow lists on older PCs | Server-side pagination, limits | Several thousand rows |
| Full-size phone photos | Slow page loads, disk growth | Resize on upload, thumbnails | Hundreds of photos |
| Unbounded audit table scans | Admin audit page slow | Index on timestamp and user; paginate | Hundreds of thousands of events (years) |
| Opening a DB connection per request on a low-end server | Latency, "too many connections" | Connection pool with sane limits | 10+ simultaneous users |
| Reports computed in Python from all rows | Slow monthly reports | Aggregate in SQL | Large billing history |
| Polling every second from every PC | Needless load | Poll sparingly or fetch on navigation | Rarely at this scale; mostly avoid wasted effort |

At this hospital's scale (a handful of concurrent users) raw performance is not the risk; correctness and operations are.

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Doctor can request any patient/encounter by ID (IDOR) | Patient confidentiality breach | Object-level policy in service layer, tested with doctor A vs doctor B |
| Cleartext login on LAN | Credential sniffing on shared network/Wi-Fi | HTTPS with local cert, or wired network and documented risk; strong hashing |
| Server reachable from guest Wi-Fi or internet via router port forward | External exposure of PHI | Bind to LAN, firewall scope, no port forwarding; segment guest Wi-Fi |
| Audit log editable by admin via API | Cannot prove who did what | Append-only table, no update/delete endpoints, DB role without UPDATE/DELETE rights on it |
| Default/seed credentials left in production | Immediate takeover | Installer generates admin password; forced change |
| Verbose error responses/stack traces | Information leak | Generic errors to clients; details to server log |
| Logging PHI or tokens | Log files become a data leak | Log IDs not names/phones; never log passwords/tokens |
| Backup bundles unencrypted on USB that leaves the premises | Lost drive exposes all patients | Encrypt bundles (passphrase held by trustee) or keep drives locked |
| Admin can edit own permissions/delete self last admin | Lockout | Guard: at least one active admin; password reset runbook offline |
| Inadequate lockout and reset flow when staff forget password | Staff share passwords | Admin-driven reset with forced change on next login |
| Role changes not effective until relogin | Revoked access persists | Resolve permissions per request from DB |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Staff logged out mid-registration with the patient waiting | Lost data, frustration | Reasonable idle timeout, warn before expiry, preserve unsaved form drafts locally |
| Duplicate patient registrations | Split histories, wrong billing | Phone+name+age duplicate warning before creating a new URN |
| Unclear error messages in English only | Staff cannot act | Plain messages; key labels bilingual (English/Hindi) consistent with the pad |
| Money shown without Indian grouping or with decimals confusion | Billing mistakes | Rs 1,25,000.50 style; consistent formatting component |
| No "server unreachable" state | Staff think data saved when it was not | Global connectivity banner; disable submit while offline; never claim success without server response |
| Double-click submits twice | Duplicate payments/registrations | Disable on submit plus idempotency key on create endpoints |
| Role dashboards with different navigation habits | Confusion for admins who also reception | Consistent layout; admin can switch views by permission |
| Receipts/prints requiring many dialog steps | Slow front desk | One-click print route with preconfigured settings |
| Small touch/click targets, tiny fonts on old monitors | Errors | Larger default font, high contrast, tested at 1366x768 |

## "Looks Done But Isn't" Checklist

- [ ] **Permissions:** Often missing per-endpoint checks - verify the role x endpoint matrix test passes and that a route-coverage test fails if a route has no auth dependency
- [ ] **Doctor privacy:** Often missing object-level checks - verify doctor B gets 404/403 on doctor A's patient (if that is the agreed rule)
- [ ] **Login:** Often missing throttling and session expiry - verify lockout after N failures, idle timeout, server-side logout
- [ ] **Service start:** Often missing auto-start and recovery - verify cold boot with no one logging in; kill the process and watch it restart; power-pull drill x3
- [ ] **Backup:** Often missing off-disk copy and restore proof - verify the backup is on another device and a restore on a clean PC passes integrity checks, photos included
- [ ] **Photos:** Often missing authenticated serving and validation - verify a direct URL fails in a private window; a file renamed `.jpg` that is not an image is rejected; `../` names rejected
- [ ] **URN/receipt numbers:** Often missing concurrency safety - verify the parallel-request test yields unique, contiguous numbers; year rollover at midnight IST
- [ ] **Money:** Often missing boundary conversions - verify no float in API schemas, package split sums to total, overpayment/negative rejected
- [ ] **Time zone:** Often missing IST business dates - verify records at 00:05 IST on 1 Jan use the new year; server clock/zone documented
- [ ] **Audit log:** Often missing coverage of reads of sensitive data and failed logins - verify append-only and events for login, patient edit, payment, void, backup, restore, role change
- [ ] **Offline:** Often missing hidden CDN dependencies - verify with the network cable unplugged from the router uplink and DevTools showing zero external requests
- [ ] **Update path:** Often missing cache busting and DB migration - verify deploying v+1 with a client tab open prompts reload and migration is idempotent
- [ ] **Print:** Often missing real-pad validation - verify a physical print on the actual pad and each reception printer, signed off by the client
- [ ] **Clean-machine install:** Often missing undeclared dependencies - verify full install from the offline package on a fresh Windows machine/VM by a person who is not the developer
- [ ] **Handover docs:** Often missing credentials custody and runbooks - verify one-page restart, backup, restore, password-reset guides in Hindi/English exist and the trustee holds the admin credentials

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Missing endpoint authorization found late | MEDIUM | Add default-deny dependency, run route coverage test, fix gaps, rotate sessions, review audit log for misuse |
| Service not starting after power cut | LOW | Set service to Automatic (Delayed), configure recovery, set BIOS AC recovery; document manual restart one-pager |
| Database corruption after abrupt power loss | HIGH | Stop service, restore latest verified backup to a new data dir, replay nothing (no PITR unless configured), re-enter data from paper pad since last backup; add UPS |
| Backup only on same disk, disk dies | HIGH | Recover from any copy elsewhere (USB, other PC); otherwise re-enter from paper pads and printed cards; institute off-disk backup immediately |
| Untested restore fails | HIGH | Use pg_restore with matching PostgreSQL version; check manifest; if photos missing, restore from photo folder copy; fix procedure and retest |
| Duplicate URN or receipt discovered | MEDIUM | Freeze registration, identify duplicates via query, re-issue one with an audited correction and reprint card; fix counter, add unique constraint |
| Rounding discrepancy in accounts | MEDIUM | Reconcile payments vs charges per patient, post audited adjustment entries (never edit history), patch conversion code, add regression test |
| Wrong timestamps/years | MEDIUM | Identify affected rows by window, correct via audited migration, fix server zone and NTP |
| Photo path traversal/exposure found | MEDIUM | Disable serving endpoint, audit file tree for unexpected files, patch validation, move to authenticated serving |
| Stale frontend after update | LOW | Hard reload (Ctrl+F5), clear site data; fix headers and add version banner |
| Print misalignment | LOW | Apply calibration offsets, re-tune CSS, reprint; if browser path is hopeless switch to PDF path |
| Server PC dies | MEDIUM | Install PostgreSQL and app on standby PC from offline package, restore latest backup, repoint DHCP reservation/hostname |
| Scope overrun | MEDIUM | Cut to Core Value (shared records, permissions, backup/restore), move rest to v3.1 with client written agreement |
| Client rejects at handover | HIGH | Return to written acceptance criteria; agree a short punch list with dates; avoid new scope under the same fee |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. UI-only role hiding / IDOR | P1 (mechanism), all phases, P6 (matrix) | Route-coverage test plus role x endpoint x object test matrix |
| 2. Password/session on plain HTTP | P1; P6 | Hash format check, lockout/timeout tests, packet capture shows no cleartext (if TLS) |
| 3. CSRF/CORS | P1; P6 | Cross-origin POST from a test page fails; same-origin serving confirmed |
| 4. Windows service / power cuts | P1; P6 | Power-pull drill x3 with no manual step; service recovery config checked |
| 5. PostgreSQL dir and backup | P5; P6 | Clean-machine restore with integrity report; backup on separate device |
| 6. Photo/upload safety | P2; P5; P6 | Traversal and fake-image tests; unauthenticated URL fails |
| 7. Concurrent URN/receipt | P1 (primitive), P2, P4 | 20-parallel-request test; year rollover test |
| 8. Money rounding | P1, P4 | Property tests on conversions; reconciliation report; v2.0 rule tests ported |
| 9. IST time zone | P1, P2, P4; P6 | Midnight/new-year tests; timestamptz everywhere (schema lint) |
| 10. SQLite-to-PostgreSQL traps | P1 (and migration step if real data) | Tests on real PostgreSQL; sequences/counters checked; Hindi search test |
| 11. Server single point of failure | P1 (hardware gate), P6 | Standby restore drill timed; runbook reviewed with staff |
| 12. Stale frontend caches | P1; P6 | Deploy-with-open-tab test; headers inspected |
| 13. Print alignment | P2 spike, P6 sign-off | Physical print overlay on pad approved by client |
| 14. Node.js build-only | P1; P6 | Clean server has no Node; zero external network requests offline |
| 15. Scope creep | Roadmap; each transition | Change-request log; week-4 feature freeze held |
| 16. Client approval gaps | Pre-P1 and gates in P2/P4/P5/P6 | Signed/acknowledged gate messages on file |

## Sources

- Project context: `D:\dr-sr\.planning\PROJECT.md` (constraints, decisions, v2.0 validated rules)
- OWASP Top 10 and OWASP ASVS / Cheat Sheets: Authorization (IDOR), Session Management, CSRF Prevention, File Upload, Password Storage
- PostgreSQL documentation: backup and restore (`pg_dump`, `pg_basebackup`, continuous archiving), reliability and WAL, `INSERT ... ON CONFLICT`, sequences and their gaps, `timestamptz`
- FastAPI documentation: security dependencies, CORS middleware, static files; Starlette `StaticFiles`
- Vite documentation: build, hashed asset filenames, deployment caching guidance
- NSSM / WinSW service wrapper documentation; Windows service recovery options; BIOS "restore on AC power loss" setting
- Python `zoneinfo` and `tzdata` package notes for Windows
- Pillow documentation on image verification and re-encoding; general upload-handling guidance
- Experience-based knowledge of small-clinic software migrations and power-unreliable deployments (no live web research performed in this pass; findings are from established engineering practice, so version-specific details should be re-checked during phase planning)

---
*Pitfalls research for: LAN-only central-server clinic web app (FastAPI + PostgreSQL + React/TS), Kalyan Hospital v3.0*
*Researched: 2026-10-30*
