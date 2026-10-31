# Phase 11 Plan 04 Summary: Startup Gates, CLI, Clock Seam & Stack Canaries

**Phase:** 11 — Decisions Gate, Foundation & Auth  
**Plan:** 11-04 (Wave 3)  
**Status:** Completed  
**Execution Date:** 2026-10-31  

---

## 1. Objectives Completed

1. **Startup Pre-flight Gates & Durability Invariants (`db/startup.py`):**
   - **Database Connection Backoff (`wait_for_db`):** Implemented connection polling with exponential backoff up to 60s, handling server boots before PostgreSQL crash recovery completes (D-02 / Pitfall 4).
   - **Schema Revision Gate (`assert_schema_current`):** Compares database revision from `MigrationContext` with head revision from `ScriptDirectory`. Halts application lifespan with `SchemaMismatchError` if database revision != head (prohibiting application startup against stale schemas).
   - **Durability Invariant Gate (`check_durability`):** Enforces D-02 PostgreSQL settings (`synchronous_commit IN ('on', 'remote_apply')`, `fsync = 'on'`, `full_page_writes = 'on'`). In production mode, halts startup with `DurabilityError` if non-compliant.
   - **Authoritative Setup Verification (`setup_completed`):** Authoritatively checks whether setup has occurred via `SELECT EXISTS(SELECT 1 FROM system_setup WHERE id = 1)` (`SEC-07`). Deactivating admin users or server restarts never reopens setup.
   - **Pre-flight Orchestration (`run_startup_checks`):** Wired into application `lifespan` in `main.py` before accepting HTTP requests; verified that lifespan NEVER performs Alembic upgrade or `create_all`.

2. **Kalyan CLI Administration Tool (`cli.py`):**
   - Implemented extensible CLI entrypoint (`python -m kalyan_api.cli`):
     - `migrate`: Runs Alembic upgrade head using migration owner role credentials (`kalyan_owner`), printing the resulting revision.
     - `check-db`: Inspects database connectivity, schema head parity, and D-02 durability invariants using runtime role (`kalyan_app`).
   - Strict prohibition: Never prints passwords or raw database URLs to console/stderr.

3. **Authoritative Health Check & Setup Signal (`routers/health.py`):**
   - Updated `GET /api/health` to return `{"status": "ok", "db": "ok", "setup_required": <bool>}`.
   - Verified that `setup_required` is `True` when `system_setup` table has no row, flips to `False` once `system_setup` is recorded, and remains permanently `False` even if all admins are subsequently deactivated.

4. **Deterministic Clock Seam (`clock.py`):**
   - Standardized `clock.utcnow()` returning timezone-aware UTC datetime as the single authoritative application time source.
   - Added IST helpers (`clock.ist_now()`, `clock.ist_today()`) using pinned `Asia/Kolkata` zone for Indian financial and OPD workflows.
   - Static scan verified `datetime.now()` / `utcnow()` in `backend/src` matches only `clock.py`.

5. **Guard & Stack Canary Tests (`test_migrations.py`, `test_stack_smoke.py`):**
   - `test_single_head`: Verified linear migration history (single head `['0001']`).
   - `test_migrations_match_models`: Verified `alembic check` passes on migrated database with 0 autogenerate diffs.
   - `test_security_objects_present`: Verified append-only triggers on `audit_logs` and `system_setup` in `pg_trigger`, and exact least-privilege table grants for `kalyan_app` in `information_schema.role_table_grants`.
   - `test_installed_package_versions_equal_pins`: Validated pinned dependencies (`fastapi==0.162.0`, `starlette==1.10.0`, `sqlalchemy==2.0.55`, `psycopg==3.3.6`, `alembic==1.20.1`, `pydantic==2.14.2`).
   - `test_psycopg_uses_binary_driver`: Validated `psycopg.pq.__impl__ == "binary"`.
   - `test_production_hasher_meets_owasp_floor`: Validated Argon2 parameters satisfy OWASP floor (`time_cost >= 2`, `memory_cost >= 19456`, `parallelism >= 1`).

---

## 2. Verification Summary

| Gate / Check | Expected | Actual | Result |
|---|---|---|---|
| `upgrade` in `main.py` | None (lifespan never runs migrations) | 0 occurrences | PASS |
| `datetime.now()` in `backend/src` | Limited strictly to `clock.py` | Matches only `clock.py` | PASS |
| `cli check-db` on `kalyan_test` | Prints `synchronous_commit: on`, exits 0 | Verified | PASS |
| Schema revision gate | Raises `SchemaMismatchError` on stale schema | Verified in `test_lifespan_refuses_startup_on_schema_mismatch` | PASS |
| Durability gate | Enforces D-02 in strict mode | Verified in `test_check_durability_invariant_enforcement` | PASS |
| Authoritative setup lifecycle | `system_setup` row determines status; deactivation doesn't reopen | Verified in `test_health_check_setup_required_authoritative_lifecycle` | PASS |
| Model-migration parity | `alembic check` detects 0 diffs | Verified in `test_migrations_match_models` | PASS |
| Pytest suite | 48 passed, 0 failed | 48 passed in 1.85s | PASS |
| Ruff linter | 0 errors | All checks passed | PASS |
| Legacy codebase isolation | Untouched | Confirmed clean | PASS |

---

## 3. Next Steps

- Proceed to **Wave 4 (`11-05-PLAN.md`)**:
  - Implement authentication core and session manager:
    - Argon2id password hashing and constant-time dummy verification.
    - Token generation (`secrets.token_urlsafe(32)`) and SHA-256 hash storage.
    - Sliding session idle timeout (30 min D-07) and absolute timeout (12h).
    - Per-IP throttle tracking table (`login_throttle`) and account lockout (5 failures -> 15 min lock).
    - Origin verification and CSRF token validation.
    - Endpoints: `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/change-password`.
