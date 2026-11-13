# COLD-PATHS — Repository Analysis

> **Path note (2026-11-08):** the legacy desktop app now lives under `legacy/`. Paths below such as `app/…` and root `main.py` refer to `legacy/app/…` and `legacy/main.py`.

**Repository:** `D:\dr-sr`  
**Analysis basis:** Read-only static inspection of the currently present source tree. No application was launched and no tests were run.  
**Status labels:** **Confirmed** means the source explicitly implements the path. **Potential** means the source indicates a path or condition but reachability or operational use is not established statically. **Unknown** means runtime/deployment evidence is needed.

## Executive summary

This repository contains two distinct applications:

1. A PySide6 desktop application using local SQLite, entered through root `main.py` and `app.ui.main_window.MainWindow`.
2. A FastAPI backend with React/TypeScript frontend under `backend/src/kalyan_api` and `frontend/src`; the API mounts 24 router modules and optionally serves a built frontend.

The code is more implemented than the top-level README and `ARCHITECTURE.md` status text suggests: the web backend, frontend, migrations, and admin flows are present in source. This is a source-presence finding only; whether this web stack is the intended/operational product, configured, deployed, or connected to a live database is **Unknown**. Conversely, the same README identifies the desktop app as the earlier legacy application; its entry point and UI remain in source.

High-value cold paths are first-run administrator bootstrap, CLI-only operator workflows, scheduled backups, restore/verification/integrity operations, admin-only screens and APIs, doctor/reception conditional routes, SPA fallback/API-only startup, optional desktop photo/print/backup behavior, and error recovery paths. No independent evidence was found for a third-party runtime integration; configured storage, database, and local file dependencies are described below.

## Scope and inventory

The source inventory included 498 file paths after excluding `.git`, Python virtual environments/caches, Node dependencies, build output, and bytecode caches. It included application source, project documentation/configuration, tests in the file inventory, and project-specific scripts; media, screenshots, and generated artifacts were not analyzed as execution logic. Static code review focused on:

- 93 Python files under `backend/src/kalyan_api` (24 router modules, 15 service modules, database/core/config/schema/migration support).
- 67 non-test TypeScript/TSX files under `frontend/src` (router, role guards, API client/query layer, pages, admin modules, shared components).
- 39 Python files in `app/` plus root `main.py` (legacy desktop app).
- Root and backend launch/config/deployment scripts and key architecture/status documents.
- 11 Alembic migration version files as schema evolution evidence, without executing them.

A repository-wide source/path inventory was performed. Findings below cite the main implementation points rather than enumerate every ordinary CRUD handler. Tests were not executed; their existence is not treated as runtime proof. The checked-out working tree already contained numerous user modifications, deletions, and untracked files when inspected; no existing file was altered by this analysis.

## Execution roots and architecture boundary

### Desktop application — Confirmed

- `main.py:main` calls `app.db.connection.init_db`, sets the Qt application identity/icon if present, instantiates `app.ui.main_window.MainWindow`, and starts the Qt event loop.
- `app/config.py` derives `data/kalyan.db`, photo, and backup directories from the repository root and creates those directories during module import. This has a filesystem side effect when the desktop application imports config; it was not triggered during this static analysis.
- `app/ui/main_window.py:MainWindow` builds the dashboard, patient, treatment, payment, and backup views. `set_page` refreshes the selected view, including backup listing when index 4 is selected. Ctrl+K opens `QuickLauncherDialog`.
- `app/ui/quick_launcher.py:QuickLauncherDialog` conditionally searches patients only for a nonempty query; database search exceptions are caught and treated as no patient matches.
- `app/db/schema.sql`, `app/db/connection.py`, `app/services/*`, `app/repositories/*`, and `app/ui/views/*` implement the SQLite desktop data path. Local backup and restore are in `app/services/backup_service.py` and `app/ui/views/backup_view.py`.
- `app/services/auth_service.py` includes demo-admin seeding when no admin exists. This differs from the web backend's one-time setup approach. Whether that seeding is exercised in a normal packaged launch is not runtime-verified.

### Web application — Confirmed source, operational status Unknown

- `backend/src/kalyan_api/main.py:create_app` registers health, setup, auth, areas, users, settings, doctors, patients, appointments, doctor appointment queue, encounters, templates, vitals, follow-up, prescriptions, treatment plans/sessions, billing, timeline, audit, operations, roles, sessions, security, and system routers (24 router modules; appointments exports two routers).
- API middleware includes request IDs, security headers, origin checking as an application-wide dependency, and uniform error handlers. `SecurityHeadersMiddleware.dispatch` applies private/no-cache photo handling, no-store API responses, immutable successful `/assets/` responses, and no-cache HTML responses.
- During FastAPI lifespan, `run_startup_checks` verifies timezone data, waits up to 60 seconds for PostgreSQL, checks Alembic head revision, and checks durability settings (strict failure in production). It then issues a one-time setup code only when `system_setup` is absent, otherwise attempts to remove a stale setup-code file and clears the in-memory hash. Shutdown disposes the engine.
- The SPA distribution is mounted only if `settings.frontend_dist` is configured and contains `index.html`. Otherwise the server logs a warning and starts API-only. The SPA mount uses `index.html` fallback.
- `backend/src/kalyan_api/config.py:Settings` reads `KALYAN_` environment variables and an optional `backend/.env`, with database, session/security, frontend distribution, setup-code, photo, and backup path settings. Relative frontend distribution paths are rejected. Exact production values and live environment are **Unknown**.
- `frontend/src/main.tsx` mounts the React app only when `#root` exists. `frontend/src/router.tsx` handles setup redirects, login, role homes, protected routes, and not-found handling. Most feature routes use router `lazy` dynamic imports and load their page only when navigated to.

## Confirmed cold paths

### First-run and account recovery

- `backend/src/kalyan_api/routers/setup.py:get_setup_status` and `setup_first_admin` expose setup status and first-admin creation while setup remains incomplete. The handler has IP-based lockout/failure bookkeeping, password-policy checks, and conflict/integrity handling. `db/startup.py:setup_completed` uses the append-only `system_setup` row as the authoritative completed flag. Bootstrap is therefore a first-run-only branch and does not reopen just because all administrators are later deactivated.
- `backend/src/kalyan_api/core/setup_code.py:issue_setup_code` and `backend/src/kalyan_api/main.py:lifespan` contain setup-code creation/cleanup paths. The code is issued at startup only when setup is incomplete.
- `backend/src/kalyan_api/cli.py` exposes explicit operator subcommands: `migrate`, `check-db`, `reset-admin-password`, `export-openapi`, `backup-create`, `backup-run-scheduled`, `backup-restore`, `backup-verify`, and `integrity-check`. These paths run only when invoked by the operator. The CLI docstring states that create-admin is intentionally absent and password arguments are prohibited. `export-openapi` writes a file when invoked; it was not run.
- Web session takeover/conflict, forced password change, revocation, lockout/throttle, and role changes are conditional paths in `routers/auth.py`, `routers/sessions.py`, `services/session_service.py`, `services/throttle_service.py`, `services/user_service.py`, and corresponding React dialogs/pages (`TakeoverSessionModal`, `ChangePassword`, admin `Users`). Which branch occurs depends on account/session state.

### Scheduled backup, restore, verification, and integrity

- `backend/src/kalyan_api/services/backup_schedule_service.py:run_scheduled_backup` is not a continuously running in-process worker. Its module documentation specifies a Windows Scheduled Task invoking `kalyan_api.cli backup-run-scheduled`; the task checks a persisted schedule and returns skipped/success/failure. Actual task registration and cadence on any installed server are **Unknown**.
- Scheduling is disabled unless `BackupSettings.schedule_enabled` is true. `is_due` checks the latest IST slot and whether settings were updated after that slot. `_claim_run` uses a row lock to avoid duplicate overlapping runs and marks old RUNNING rows interrupted after six hours. Failures wait for the next slot. Successful runs verify the archive, optionally checksum-copy it to an approved destination, then prune only scheduled-labeled archives according to retention. Second-copy, disk, and retention outcomes depend on configured paths and filesystem state.
- `backend/src/kalyan_api/routers/operations.py` gates manual backup, schedule configuration, run/archive listing, verification, restore, and integrity report endpoints by permissions. Restore requires `BACKUP_RESTORE`; configuration requires `BACKUP_CONFIGURE`. Failure paths record backup/restore failure audit events. `services/backup_service.py` contains bundle verification, safety snapshot, restore, and cleanup/recovery branches. Restore is destructive to the target database when deliberately invoked; it was not invoked here.
- Frontend `/admin/backups` (`pages/admin/BackupManagerPage.tsx`) and `/admin/integrity` (`pages/admin/IntegrityDashboard.tsx`) are admin-gated lazy routes. The backup page has archive filters, manual creation, schedule tab, and a restore confirmation phrase/reason flow. This UI guard complements API permission checks; it is not runtime-tested here.
- Legacy desktop backup is a separate SQLite/photofile archive/restore implementation in `app/services/backup_service.py`, reached from the desktop backup view and refreshed on navigation. It must not be confused with the web PostgreSQL backup subsystem.

### Admin and role-specific functionality

- `frontend/src/router.tsx` nests `/admin/*` routes under `RequireAuth` and `RequireRole role="ADMIN"`. Admin users, roles, security, system health, settings, billing, doctors, audit, backups, and integrity pages are imported only when their route is activated. The two special reception dues and registration routes have Admin/Reception and Reception-only guards respectively; doctor workspace routes are Doctor-only; patient, appointment, patient-detail, and print routes allow the listed clinical/reception roles.
- The `ADMIN_MODULES` registry in `frontend/src/admin/modules.ts` describes 11 admin modules. Appointment/workflow and physiotherapy configuration entries are marked fixed with no actions; prescription/print is partial and routes through clinic settings. These are explicitly not standalone active configuration paths.
- Backend authorization is separately implemented through `core/policy.py`, `core/permissions.py`, `core/principal.py`, router dependencies, and row scoping in `core/scope.py`. Doctor, Reception, and Admin branches narrow data/permissions. Frontend-only route access must not be interpreted as the server authorization boundary.
- Doctor follow-up recommendations are only available when principal role/doctor assignment checks pass in `routers/follow_up.py`; reception has a separate response/list path. Booking and closure are conditional on record state and user role.
- Backup, audit, users, role matrix, security policy, system health, integrity, and fee administration are infrequently used operational/admin paths by nature of their route and permission; access frequency itself is **Unknown**.

### Conditional workflows, fallback, and recovery

- Setup-required redirects in `frontend/src/router.tsx:LoginRoute` and `RootRoute` depend on `useSetupStatus`. A `notice` query parameter suppresses the login-to-setup redirect. `frontend/src/api/queries.ts` includes a fallback setup-status result when the query fails; this can cause UI behavior to continue without authoritative status and needs runtime review under API failure.
- `backend/src/kalyan_api/main.py` has the API-only fallback when the SPA build is missing. Static inspection cannot verify browser deep-link behavior or deployed static asset correctness.
- `backend/src/kalyan_api/core/errors.py` installs structured handlers for API, HTTP, validation, and unexpected exceptions; request IDs are attached through middleware. Exact client-visible behavior depends on exception/status path.
- `backend/src/kalyan_api/core/csrf.py:verify_origin` compares Origin or Referer against Host and configured extra origins; `check_csrf_token` is a separate token check used by auth/session flows. Paths vary by request headers, origin configuration, and cookie/session state.
- `backend/src/kalyan_api/core/principal.py` rejects revoked/inactive/expired sessions and throttles session touch writes; passive requests follow a distinct no-touch path. `services/throttle_service.py` and authentication routes implement lockout/rate-limit recovery conditions.
- Optimistic locking and conflict recovery are implemented in `core/errors.py:require_version`, relevant mutation routers/services, and frontend `ConflictBanner` / unsaved-changes guard. Conflicts occur only when persisted versions differ.
- `backend/src/kalyan_api/services/photo_service.py` and `routers/patients.py` handle optional photo upload/read/delete behavior and missing/unavailable files. The security middleware gives successful photo responses private caching. Actual filesystem permissions/availability are **Unknown**.
- Print-only browser components (`ReceiptHost`, `ReceiptPrint`, `PrescriptionPrint`, `ConsultationSummaryPrint`, `PatientCardPrint`, `print.css`) are reached only through print flows; finalized encounter summaries have an explicit finalized-state condition. Browser/printer output was not verified.
- Specialty physiotherapy and ophthalmology forms are conditional clinical UI components. Static references indicate use within clinical forms; specialty selection/data paths were not runtime-observed.

## Potential cold or legacy paths

- **Potential — Desktop is legacy but remains launchable.** `README.md` labels `app/` as a legacy PySide6/SQLite source, while root `main.py` still provides a direct launch path. Packaging/shortcut usage is **Unknown**.
- **Potential — Documentation status drift.** `README.md` and `ARCHITECTURE.md` call the web platform a target/not-yet-implemented, while the API routers/services/migrations and React route tree exist in the current checkout. Treat those status statements as stale or branch-specific until reconciled with deployment evidence; no deployment was inspected.
- **Potential — Unfinished doctor dashboard card.** `frontend/src/components/DoctorDashboardUnfinishedCard.tsx` exists and appears feature-specific. Whether it is mounted in the current dashboard and under what data state is **Unknown** from this inspection.
- **Potential — Older project-level helper scripts and root documentation/scripts** (`build_product_tour.py`, `render_product_video.py`, batch launch/build files, `demo_seeder.py`) are task- or operator-invoked; ordinary application launch does not imply their execution.
- **Potential — `backend/src/kalyan_api.egg-info`** is package build metadata rather than application source and was excluded from execution-path conclusions. Generated media, screenshots, caches, lock/dependency contents, and vendor/dependency trees were not traced.
- **No confirmed feature flags or plugin-based third-party integrations** were identified in the inspected application entry/route/service paths. This is not proof that no external integration exists in every script or deployment environment.

## Data, schema, and environment-dependent behavior

- The legacy app has SQLite schema in `app/db/schema.sql`; its initialization/migration behavior is in `app/db/connection.py`.
- The web backend uses SQLAlchemy models in `backend/src/kalyan_api/models.py` and Alembic revisions in `backend/src/kalyan_api/migrations/versions/` (11 version files present). `db/startup.py:assert_schema_current` refuses startup on a stale revision; migrations are operator-invoked through CLI rather than automatically applied in the app factory/lifespan.
- Web photos and backup archives default under `backend/var/photos` and `backend/var/backups`, but may be configured via `KALYAN_` settings. Optional `frontend_dist`, setup-code file, extra backup destinations, production durability requirements, allowed origins, and secure-cookie setting all change reachable behavior.
- `backend/scripts/start_server.ps1`, `smoke_boot.ps1`, root `deploy/*`, and `backend/tests/test_deploy_scripts.py` describe/probe deployment paths. No script was executed, and the active Windows services/task registration, PostgreSQL settings/data, `.env`, secrets, server firewall, local HTTPS/HTTP choice, and scheduled task are **Unknown**.

## Potentially dead or superseded paths

Static inspection cannot reliably prove dead code. The following are candidates for a separate reachability check:

- Legacy `app/` desktop code may be unused in a current web deployment but remains live through root `main.py`.
- Admin module entries marked `fixed` have no route actions; they represent status notices rather than executable feature screens.
- Development/demo seed and product-tour helpers are not normal web startup paths and require explicit invocation.
- Generated or packaged files under `backend/src/kalyan_api.egg-info`, `.pytest_cache`, `.ruff_cache`, `.venv`, screenshots, promo assets, demo recordings, and raw media are not part of the cold-path map except where source explicitly opens a project-specific asset.

No claim that a function/file is dead is made without runtime import/reachability evidence.

## Verification and gaps

- **Verified statically:** cited paths and symbols were checked in the current working tree; router registration, role wrappers, lazy imports, settings branches, startup checks, CLI command dispatch, and scheduler conditions are visible in source.
- **Not runtime-verified:** application launch, actual URL routing, database connectivity/schema, setup/bootstrap, permission decisions, environment parsing in a real deployment, Windows Scheduled Task registration, backup/restore integrity, local filesystem permissions, photo delivery, error recovery under injected faults, concurrency behavior, browser print layout, and installed desktop packaging.
- No tests, migrations, deployments, destructive operations, or application startup were run for this analysis.
- The working tree had pre-existing modified, deleted, and untracked files. Their content/state was left unchanged; a post-write check is limited to confirming the requested document exists.

## Summary counts

| Measure | Count / finding |
|---|---:|
| Included repository file paths in inventory | 498 |
| Backend package Python files inspected by inventory | 93 |
| Backend router modules registered | 24 |
| Backend service modules | 15 |
| Alembic migration version files | 11 |
| Non-test frontend TS/TSX files | 67 |
| Legacy desktop Python files plus root entrypoint | 40 |
| Runtime launches / test runs / migrations performed | 0 / 0 / 0 |
| Confirmed web deployment state | Unknown |
| Confirmed scheduler registration / live environment values | Unknown |
