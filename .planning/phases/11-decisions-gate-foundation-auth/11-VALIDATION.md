---
phase: "11"
slug: "decisions-gate-foundation-auth"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
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

Task IDs are assigned by the planner; rows below fix the requirement-level proof each task set must cover.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | SEC-01 | session cookie | HttpOnly, SameSite=Strict, no `Secure` on plain HTTP; `/me` returns role + permissions | integration | `pytest backend/tests/test_auth_login.py -q` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | SEC-01 | route guard | wrong-role redirect; unauthenticated to `/login`; must-change to `/change-password` | frontend unit | `npm --prefix frontend run test -- guards` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | SEC-02 | unprotected route | every route has exactly one policy; enumeration non-vacuous | unit | `pytest backend/tests/test_route_policies.py -q` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | SEC-02 | privilege escalation / IDOR | role x endpoint matrix (401/403/404) | integration | `pytest backend/tests/test_rbac_matrix.py -q` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | SEC-02 | CSRF | missing token or foreign Origin on unsafe methods returns 403 | integration | `pytest backend/tests/test_csrf_origin.py -q` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | SEC-03 | permission drift | golden role-permission snapshot; scope helpers (doctor silo, reception no clinical) | unit/integration | `pytest backend/tests/test_permissions_catalogue.py backend/tests/test_scope_helpers.py -q` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | SEC-04 | session theft / brute force | idle 30 min, absolute 12 h, revoke on logout/deactivate; 5 failures lock 15 min; throttle | integration (clock seam) | `pytest backend/tests/test_sessions.py backend/tests/test_lockout_throttle.py -q` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | SEC-05 | default credentials | no default users; CLI `create-admin`; forced password change; deactivate not delete | integration | `pytest backend/tests/test_users_admin.py backend/tests/test_password_change.py backend/tests/test_cli_admin.py backend/tests/test_no_default_credentials.py -q` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | SEC-06 | lost update | stale `version_id` returns 409, row and audit unchanged; 20 concurrent PATCH gives one 200 and the rest 409 | integration (+ `concurrency`) | `pytest backend/tests/test_optimistic_locking.py -q` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | SEC-06 | 409 UX | banner "Record was modified by another user", Reload refetches | frontend unit | `npm --prefix frontend run test -- conflict-banner` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | AUD-01 | audit tampering / loss | audit row commits with the business write; UPDATE/DELETE/TRUNCATE blocked as app role and owner; payload redaction | integration | `pytest backend/tests/test_audit_writer.py backend/tests/test_audit_append_only.py -q` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | (cross) | schema drift | migrate from empty, single head, `alembic check` clean, revision-mismatch refusal; SPA serving headers and traversal probes; pin canaries | integration | `pytest backend/tests/test_migrations.py backend/tests/test_spa_serving.py backend/tests/test_stack_smoke.py -q` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | SC-1 | undecided gate | entry-gate register committed before code with no OPEN rows | script | PowerShell snippet in `11-RESEARCH.md` § Entry-Gate Decision Record | ❌ W0 | ⬜ pending |

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

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
