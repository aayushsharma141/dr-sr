---
phase: "11"
slug: "decisions-gate-foundation-auth"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: true
wave_0_complete: false
created: "2026-10-30"
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Seeded from `11-RESEARCH.md` § Validation Architecture; the planner assigns task IDs.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Backend: pytest 9.2.0 + pytest-timeout + pytest-cov + httpx2 against real PostgreSQL 18.6 (no SQLite). Frontend: Vitest 5.0.5 + Testing Library + jsdom |
| **Config file** | `backend/pyproject.toml` `[tool.pytest.ini_options]` (Wave 0); `frontend/vite.config.ts` `test` block (Wave 0) |
| **Quick run command** | `backend\.venv\Scripts\python.exe -m pytest backend/tests -q -x -m "not concurrency and not slow"` (frontend-only change: `npm --prefix frontend run test`) |
| **Full suite command** | `backend\.venv\Scripts\python.exe -m pytest backend/tests -q --cov=kalyan_api --cov-report=term-missing --cov-fail-under=85`, then `backend\.venv\Scripts\ruff.exe check backend`, `npm --prefix frontend run typecheck`, `npm --prefix frontend run lint`, `npm --prefix frontend run test`, `npm --prefix frontend run build` |
| **Estimated runtime** | quick under 30 s; full a few minutes |

All commands run from `D:\dr-sr` in PowerShell. A failing run is a non-zero exit code plus the named failing test, a `tsc` error list, or an oxlint diagnostic.

---

## Sampling Rate

- **After every task commit:** quick run command (plus `ruff check backend` for backend tasks, `npm --prefix frontend run test` for frontend tasks)
- **After every plan wave:** full suite command (includes `concurrency` tests, coverage gate, typecheck, lint, build)
- **Before `/gsd-verify-work`:** full suite green, entry-gate ordering script OK, legacy-untouched check empty
- **Max feedback latency:** 30 seconds (quick run)

---

## Per-Task Verification Map

Task IDs are `{plan}-T{n}`. Commands run from `D:\dr-sr` in Windows PowerShell 5.1; pytest rows are prefixed with `backend\.venv\Scripts\python.exe -m` (written `pytest ...` below for brevity). Per-task verifies use targeted quick commands; the full suite, coverage gate and concurrency races run at wave ends (stated in each plan's verification) and in the 11-15 gate.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 11-01-T1 | 11-01 | 1 | SC-1 (SEC-03/SEC-04 decisions) | undecided gate | register EG-1..EG-20 and RISK-01..03, no OPEN row | script | `powershell -File .planning/phases/11-decisions-gate-foundation-auth/check-entry-gate.ps1 -Mode content` | created by the task itself (tests first) | pending |
| 11-01-T2 | 11-01 | 1 | SC-1 | code before gate / secrets | gate committed before any backend/ file; no secrets in bootstrap.sql/.env.example | script | `powershell -File .planning/phases/11-decisions-gate-foundation-auth/check-entry-gate.ps1 -Mode order` | created by the task itself (tests first) | pending |
| 11-01-T3..T6 | 11-01 | 1 | SC-1 (toolchain) | supply chain / DB exposure | Node 24.22.1, PG 18.6 localhost-only, synchronous_commit on (D-02), legitimacy gate, roles/DBs, .env ignored | human checkpoints + read-only commands | `node --version`; `Get-Service postgresql*`; `Test-Path backend\.env` | created by the task itself (tests first) | pending |
| 11-02-T1 | 11-02 | 2 | AUD-01 / SEC-02 | commit after response | settings to SessionDep(scope=function) to /api/health on real PG (tracer) | integration (tracer) | `pytest backend/tests/test_health_tracer.py -q` | created by the task itself (tests first) | pending |
| 11-02-T2 | 11-02 | 2 | SEC-02 | error leakage | one error envelope, no input echo, security headers, docs disabled | integration | `pytest backend/tests/test_health_tracer.py -q` | created by the task itself (tests first) | pending |
| 11-03-T1 | 11-03 | 3 | AUD-01 / SEC-05 | audit loss, seed users | migrate from empty; in-transaction fail-closed writer; redaction; zero users at birth (tracer) | integration (tracer) | `pytest backend/tests/test_audit_writer.py -q` | created by the task itself (tests first) | pending |
| 11-03-T2 | 11-03 | 3 | AUD-01 / SEC-03 / SEC-05 | audit tampering, privilege creep | UPDATE/DELETE/TRUNCATE blocked for app and owner; role CHECKs; no DELETE on users | integration | `pytest backend/tests/test_audit_append_only.py -q` | created by the task itself (tests first) | pending |
| 11-04-T1 | 11-04 | 4 | SEC-05 / AUD-01 | stale schema, non-durable DB, open setup | cli migrate; revision and durability gates (D-02); setup_required (tracer) | integration (tracer) | `pytest backend/tests/test_health_tracer.py -q` | created by the task itself (tests first) | pending |
| 11-04-T2 | 11-04 | 4 | SEC-03 | schema/stack drift | single head, alembic check, triggers and grants, pin canaries, clock seam | integration | `pytest backend/tests/test_migrations.py backend/tests/test_stack_smoke.py -q` | created by the task itself (tests first) | pending |
| 11-05-T1 | 11-05 | 5 | SEC-01 / SEC-03 | session cookie | login to /me, HttpOnly SameSite=Strict no Secure, Secure-cookie trap (tracer) | integration (tracer) | `pytest backend/tests/test_auth_login.py -q` | created by the task itself (tests first) | pending |
| 11-05-T2 | 11-05 | 5 | SEC-04 / SEC-03 / AUD-01 | session theft, permission drift | idle 30 min, absolute 12 h, touch, passive, logout; golden snapshot; fail-closed login | integration (clock seam) | `pytest backend/tests/test_sessions.py backend/tests/test_permissions_catalogue.py -q` | created by the task itself (tests first) | pending |
| 11-06-T1 | 11-06 | 6 | SEC-04 / AUD-01 | brute force | 5 failures lock 15 min, counters/audit survive the 401, no enumeration (tracer) | integration (tracer) | `pytest backend/tests/test_lockout_throttle.py -q -m "not concurrency"` | created by the task itself (tests first) | pending |
| 11-06-T2 | 11-06 | 6 | SEC-04 | password spraying | per-IP 429 with Retry-After, window reset, audit once | integration | `pytest backend/tests/test_lockout_throttle.py -q -m "not concurrency"` (wave end: `-m concurrency`) | created by the task itself (tests first) | pending |
| 11-07-T1 | 11-07 | 7 | SEC-05 / AUD-01 | temporary credentials, weak passwords | forced first-login change, Settings-driven policy, sessions revoked (tracer) | integration (tracer) | `pytest backend/tests/test_password_change.py -q` | created by the task itself (tests first) | pending |
| 11-07-T2 | 11-07 | 7 | SEC-02 | CSRF | missing token or foreign/null Origin on unsafe methods returns 403 | integration | `pytest backend/tests/test_csrf_origin.py -q` | created by the task itself (tests first) | pending |
| 11-08-T1 | 11-08 | 8 | SEC-02 / SEC-01 | unprotected route | exactly one policy per route via iter_route_contexts, negative control; role dashboards (tracer) | unit (tracer) | `pytest backend/tests/test_route_policies.py -q` | created by the task itself (tests first) | pending |
| 11-08-T2 | 11-08 | 8 | SEC-02 / SEC-03 | privilege escalation | role x endpoint matrix, completeness, secrets scan, no orphan permission | integration | `pytest backend/tests/test_rbac_matrix.py backend/tests/test_permissions_catalogue.py -q` | created by the task itself (tests first) | pending |
| 11-08-T3 | 11-08 | 8 | SEC-03 (D-03/D-04) | doctor silo breach, reception on clinical | default-deny row_scope, 404 for out-of-scope ids | integration | `pytest backend/tests/test_scope_helpers.py -q` | created by the task itself (tests first) | pending |
| 11-09-T1 | 11-09 | 9 | SEC-05 / AUD-01 | mass assignment, temp password leak | admin creates user, one-time password, forced change, fail-closed (tracer) | integration (tracer) | `pytest backend/tests/test_users_admin.py backend/tests/test_rbac_matrix.py backend/tests/test_permissions_catalogue.py -q` | created by the task itself (tests first) | pending |
| 11-09-T2 | 11-09 | 9 | SEC-06 | lost update | stale version_id 409, explicit compare, guards, no version_id assignment; 20x race at wave end | integration (+ concurrency at wave end) | `pytest backend/tests/test_optimistic_locking.py backend/tests/test_users_admin.py -q -m "not concurrency"` (wave end: `pytest backend/tests/test_optimistic_locking.py -q -m concurrency`) | created by the task itself (tests first) | pending |
| 11-10-T1 | 11-10 | 10 | SEC-05 / AUD-01 | account deletion | deactivate/reactivate revoke sessions, no DELETE route or privilege (tracer) | integration (tracer) | `pytest backend/tests/test_users_admin.py backend/tests/test_rbac_matrix.py backend/tests/test_permissions_catalogue.py -q -m "not concurrency"` | created by the task itself (tests first) | pending |
| 11-10-T2 | 11-10 | 10 | SEC-05 / SEC-04 | stuck lockout | admin reset-password and unlock before cooldown (D-07) | integration | `pytest backend/tests/test_users_admin.py backend/tests/test_permissions_catalogue.py -q -m "not concurrency"` | created by the task itself (tests first) | pending |
| 11-10-T3 | 11-10 | 10 | SEC-05 | default credentials, open setup | CLI create-admin/reset-admin-password, no password argv, legacy defaults absent | integration | `pytest backend/tests/test_cli_admin.py backend/tests/test_no_default_credentials.py -q` | created by the task itself (tests first) | pending |
| 11-11-T1 | 11-11 | 11 | SEC-01 | supply chain, toolchain drift | exact pins, lockfile, typecheck and build | build | `npm --prefix frontend run typecheck`; `npm --prefix frontend run build` | created by the task itself (tests first) | pending |
| 11-11-T2 | 11-11 | 11 | SEC-06 / SEC-01 | CSRF token storage | client CSRF header only on unsafe methods, envelope to ApiError, token in memory | frontend unit | `npm --prefix frontend run test -- client` | created by the task itself (tests first) | pending |
| 11-12-T1 | 11-12 | 12 | SEC-01 | UI routing | login routes by role to the area overview (tracer) | frontend unit (tracer) | `npm --prefix frontend run test -- login` (includes the reload restores CSRF token case) | created by the task itself (tests first) | pending |
| 11-12-T2 | 11-12 | 12 | SEC-01 / SEC-02 | UI guard bypass | anonymous to /login, wrong role to own home, must-change redirect | frontend unit | `npm --prefix frontend run test -- guards` | created by the task itself (tests first) | pending |
| 11-13-T1 | 11-13 | 13 | SEC-06 | silent overwrite | banner 'Record was modified by another user' with Reload latest; input kept (tracer) | frontend unit (tracer) | `npm --prefix frontend run test -- conflict-banner` | created by the task itself (tests first) | pending |
| 11-13-T2 | 11-13 | 13 | SEC-05 | forced change UX | change-password page, policy errors, new csrf token | frontend unit | `npm --prefix frontend run test -- change-password guards` | created by the task itself (tests first) | pending |
| 11-14-T1 | 11-14 | 14 | SEC-01 | path traversal, caching | app.frontend serving, immutable assets, no-store API, traversal probes (tracer) | integration (tracer) | `pytest backend/tests/test_spa_serving.py backend/tests/test_route_policies.py -q -m "not needs_build"` | created by the task itself (tests first) | pending |
| 11-14-T2 | 11-14 | 14 | SEC-01 | wrong bundle served | real build served from the absolute dist path | integration + build | `npm --prefix frontend run build`; `$env:KALYAN_FRONTEND_DIST=(Resolve-Path frontend/dist).Path; backend\.venv\Scripts\python.exe -m pytest backend/tests/test_spa_serving.py -q -m needs_build` | created by the task itself (tests first) | pending |
| 11-15-T1 | 11-15 | 15 | (all) | assembled-system defects | boot smoke: migrate, create-admin, uvicorn, health, SPA, CSRF, cookie (tracer) | script (tracer) | `powershell -File backend/scripts/smoke_boot.ps1` | created by the task itself (tests first) | pending |
| 11-15-T2 | 11-15 | 15 | (all) | API drift, coverage, legacy damage | full suite incl. concurrency with coverage 85, ruff, frontend gates, OpenAPI snapshot, ordering, legacy diff | integration + script | `$env:KALYAN_FRONTEND_DIST=(Resolve-Path frontend/dist).Path; backend\.venv\Scripts\python.exe -m pytest backend/tests -q --cov=kalyan_api --cov-report=term-missing --cov-fail-under=85`; `git diff --stat 43ab9c4 -- app tests pytest.ini requirements.txt requirements-dev.txt .github .vscode DECISIONS.md` | created by the task itself (tests first) | pending |
| 11-15-T3 | 11-15 | 15 | SEC-01 / SEC-02 / SEC-06 / AUD-01 | LAN-only behaviours | second LAN device, 409 visual/focus, CSP console, psql audit immutability | checkpoint:human-verify | `Select-String 11-MANUAL-CHECKS.md -Pattern '^Result: (PASS|FAIL|SKIPPED)'` (count 5) | created by the task itself (tests first) | pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `backend/pyproject.toml` (pins, pytest and ruff config), `backend/tests/conftest.py` (PostgreSQL fixtures, clock seam, `make_user`, logged-in clients), `backend/db/bootstrap.sql`, `backend/.env.example`
- [ ] All `backend/tests/test_*.py` files listed above, plus `backend/tests/support/`
- [ ] `frontend/package.json`, `vite.config.ts`, `src/test/setup.ts`, `src/**/__tests__/*.test.tsx`
- [ ] Framework install: `pip install -e "backend[dev]"`, `npm install`; PostgreSQL 18.6 and Node 24.22.1 installed by human-action checkpoints
- [ ] `11-ENTRY-GATE.md` and `.gitignore` additions

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Login from a second LAN device at `http://<server-ip>:8000` | SEC-01, SEC-02 | Needs a second device and a Windows Firewall inbound TCP 8000 rule (Private profile) | Open the URL from a phone or other PC, sign in, confirm the cookie and CSRF flow works across origins |
| Visual check of the 409 banner and focus handling | SEC-06 | Visual and accessibility judgment | Edit one user in two browser windows; save in both; confirm banner text, Reload button and focus |
| Audit rows visible and immutable in `psql` | AUD-01 | Operator-level confirmation on the real database | `SELECT action, outcome, actor_username, occurred_at FROM audit_logs ORDER BY id DESC LIMIT 20;` then confirm `UPDATE audit_logs ...` is refused |

The real power-cut drill belongs to Phase 17.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (each test file is created by the tests-first step of the task that needs it; plan 11-01 installs the toolchain)
- [x] No watch-mode flags
- [ ] Feedback latency < 30s (per-task commands are targeted quick runs; ticked by 11-15 Task 2 once measured)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planned 2026-10-30, revision 1 (15 plans, waves 1-15); execution status updated by plan 11-15 Task 2
