---
phase: 11-decisions-gate-foundation-auth
plan: 16
wave: 16
status: completed
date: 2026-11-01
---

# Plan 11-16: Phase 11 Gate Summary

## 1. Executive Summary
Plan 11-16 is the final verification gate for Phase 11 (`11-decisions-gate-foundation-auth`). It successfully validated the fully assembled v3.0 platform across automated tests, durability checks, freeze artifacts, and live browser/PostgreSQL manual checkpoints.

All automated and human verification requirements passed without gaps:
- Assembled system boots cleanly over real HTTP via `smoke_boot.ps1` on `kalyan_dev`.
- Backend test suite achieved **91.38% test coverage** on `kalyan_api` (exceeding the strict >= 85% requirement).
- All 9 named SC-6 setup wizard acceptance tests passed.
- OpenAPI schema snapshot drift test established and passing; `cli export-openapi` subcommand integrated.
- Python dependencies frozen in `requirements.lock.txt` (`fastapi==0.162.0`, `starlette==1.10.0`, `SQLAlchemy==2.0.55`, `psycopg==3.3.6`).
- Frontend typecheck, oxlint, Vitest unit suite (37 tests), and Vite build passed with exit code 0.
- Entry-gate ordering verified (`check-entry-gate.ps1 -Mode order` prints `OK: gate precedes code`).
- Legacy v2.0 codebase remains 100% untouched (zero git diff against `43ab9c4` across `app/`, `tests/`, `pytest.ini`, `requirements*.txt`, etc.).
- Human verification checkpoints M-1 through M-6 verified live on the running platform with zero failures.

---

## 2. Tasks Executed

### Task 1 (Tracer): Boot Smoke Script (`backend/scripts/smoke_boot.ps1`)
- Implemented `backend/scripts/smoke_boot.ps1` in strict PowerShell 5.1 without `&&` chaining.
- Verifies:
  1. `cli migrate` on `kalyan_dev` -> revision `0001` (head).
  2. `cli check-db` -> `synchronous_commit: on`, `fsync: on`, `full_page_writes: on`.
  3. Memory-only 24-character random password generation (never printed or stored).
  4. Uvicorn startup with `--no-server-header` on `127.0.0.1:8000`.
  5. Setup wizard API: `POST /api/setup/admin` with code from `setup-code.txt` -> 201 Created; second POST -> 410 Gone.
  6. Existing setup branch: `reset-admin-password --username smoke.admin --password-stdin`.
  7. `GET /api/health` -> 200 with `setup_required: false` and no `Server` header.
  8. `GET /` -> 200 HTML with `<div id="root">`.
  9. `GET /api/unknown` with `Accept: application/json` -> 404 JSON.
  10. `POST /api/auth/login` without `Origin` -> 403 `csrf_failed`.
  11. `POST /api/auth/login` with `Origin: http://127.0.0.1:8000` -> 200 with `HttpOnly`, `SameSite=Strict`, no `Secure`.
  12. `GET /api/auth/me` with session cookie -> 200 with `role: "ADMIN"`.
  13. Clean process teardown in `finally` ensuring no process listens on port 8000.
- Output: `SMOKE OK`.

### Task 2: Stack Freeze, OpenAPI Snapshot, Coverage & Legacy Integrity Checks
- Added `export-openapi --out PATH` subcommand to `backend/src/kalyan_api/cli.py`.
- Generated and committed normalized `backend/tests/openapi.snapshot.json`.
- Implemented `backend/tests/test_openapi_snapshot.py` asserting strict structural equality across paths, HTTP methods, operation IDs, and component schemas.
- Regenerated `backend/requirements.lock.txt` using UTF-8 encoding.
- Ran full backend test suite with coverage: 247 passed, 0 skipped, coverage: **91.38%** (fail-under 85%).
- Ran named SC-6 setup tests (`test_setup_wizard.py -rA`): all 16 tests passed.
- Ran `ruff check backend`: all checks passed clean.
- Ran frontend toolchain: typecheck, oxlint, 37 Vitest tests, and Vite build all exit 0.
- Ran entry-gate ordering check: `OK: gate precedes code`.
- Verified legacy v2.0 files: empty diff against commit `43ab9c4`.
- Verified root pytest collect: zero backend tests collected.
- Updated `.planning/phases/11-decisions-gate-foundation-auth/11-VALIDATION.md` to `status: validated`, `wave_0_complete: true`, and all tasks marked `green`.

### Task 3: Human Verification Checkpoints (M-1..M-6)
Recorded in `.planning/phases/11-decisions-gate-foundation-auth/11-MANUAL-CHECKS.md`:
- **M-6 (First-Run Setup Wizard):** PASS. Completed for `kalyan.admin`. Invalid code rejected (403). Setup permanently closed (410, redirect to `/login?notice=closed`). Throwaway `RECEPTION` and `DOCTOR` users created.
- **M-1 (Role Refusal):** PASS. `test.reception` forced password update redirected to `/change-password`. Landed on `/reception`. Direct URL navigation to `/admin` refused and redirected back to `/reception`.
- **M-2 (409 Conflict Banner & Focus):** PASS. Concurrently edited `test.reception` in two browser pages. Page 1 saved v2. Page 2 submitted stale v1. ConflictBanner displayed exact text `"Record was modified by another user"` and button `"Reload latest"`. Focus moved to banner. User input kept. Clicking reload updated form to v2.
- **M-3 (CSP & Console Errors):** PASS. 0 CSP violation errors, 0 blocked resources, 100% of requests strictly local to `http://localhost:8000/*` (zero external CDN/font calls).
- **M-4 (PostgreSQL Audit Immutability):** PASS. Querying `audit_logs` as `kalyan_app` returned valid records. Executing `UPDATE audit_logs SET outcome = 'TAMPERED'` was strictly refused with `InsufficientPrivilege: permission denied for table audit_logs`.
- **M-5 (Plaintext LAN Indicator):** PASS. Permanent "Not secure" indicator displayed in address bar as expected under locked decision D-01.

---

## 3. Verification Commands & Outputs Summary

| Check | Command | Result |
|---|---|---|
| System Smoke | `powershell -File backend/scripts/smoke_boot.ps1` | `SMOKE OK` (exit 0) |
| Backend Coverage | `pytest backend/tests --cov=kalyan_api --cov-fail-under=85` | 247 passed, 91.38% coverage |
| Setup Wizard SC-6 | `pytest backend/tests/test_setup_wizard.py -rA` | 16 passed, all SC-6 tests green |
| Python Linter | `ruff check backend` | Clean (0 diagnostics) |
| Frontend Verification | `typecheck && lint && test && build` | 37 tests passed, build clean (0 errors) |
| Entry-Gate Order | `check-entry-gate.ps1 -Mode order` | `OK: gate precedes code` |
| Legacy Immutability | `git diff --stat 43ab9c4 -- app tests ...` | 0 lines modified (empty diff) |
| Root Pytest Collect | `pytest --collect-only 2>&1 \| Select-String 'backend'` | 0 lines matched |
| Manual Verifications | `Select-String 11-MANUAL-CHECKS.md -Pattern '^Result:'` | 6 PASS lines recorded |
