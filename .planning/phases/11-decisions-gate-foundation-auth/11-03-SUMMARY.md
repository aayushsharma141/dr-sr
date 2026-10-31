# Phase 11 Plan 03 Summary: Baseline Schema, Append-Only Triggers & Audit Writer

**Phase:** 11 — Decisions Gate, Foundation & Auth  
**Plan:** 11-03 (Wave 2)  
**Status:** Completed  
**Execution Date:** 2026-10-31  

---

## 1. Objectives Completed

1. **SQLAlchemy 2.0 Declarative Models (`models.py`):**
   - Configured standard naming convention (`ix_`, `uq_`, `ck_`, `fk_`, `pk_`).
   - Implemented typed entity models:
     - `Doctor`: Stub clinical profile with `version_id` (D-08).
     - `User`: Accounts with `role` check constraint (`ADMIN`, `RECEPTION`, `DOCTOR`), `doctor_id` constraint (`SEC-03`), `version_id` (D-08), lockout counters, and lowercase unique username.
     - `AuthSession`: Token hash (`sha256`), CSRF token, user association, IP and user-agent metadata.
     - `LoginThrottle`: IP-level burst throttling tracking table.
     - `SystemSetup`: Authoritative singleton setup tracking entity with `CHECK (id = 1)` (`SEC-07`).
     - `AuditLog`: Structured audit entity with indices, `occurred_at`, `actor_user_id`, `actor_username`, `action`, `outcome`, `before_data`, `after_data`, `request_id`, `ip`, and `user_agent` (`AUD-01`).

2. **Programmatic Alembic Migration Engine (`0001_baseline.py`, `migrate.py`, `env.py`):**
   - Packaged migrations internally under `backend/src/kalyan_api/migrations`.
   - Created `0001_baseline.py` defining all six core tables.
   - Zero seed rows: Verified zero users, doctors, or default credentials created at migration birth (`SEC-05`).
   - Installed PostgreSQL PL/pgSQL append-only function `audit_logs_block_mutation()`.
   - Installed row triggers blocking `UPDATE` and `DELETE` on `audit_logs` and `system_setup`.
   - Installed statement triggers (`FOR EACH STATEMENT`) blocking `TRUNCATE` on `audit_logs` and `system_setup`.
   - Granted least-privilege permissions to runtime role `kalyan_app`:
     - `SELECT, INSERT` on `audit_logs` and `system_setup` (never `UPDATE`/`DELETE`/`TRUNCATE`).
     - `SELECT, INSERT, UPDATE` on `users`, `doctors`, `login_throttle` (never `DELETE` on `users`).
     - `SELECT, INSERT, UPDATE, DELETE` on `sessions`.
     - `SELECT` on `alembic_version` (never write access).
     - `USAGE, SELECT` on sequences.
     - No `CREATE` privilege on `public` schema.

3. **In-Transaction Audit Writer (`audit_service.py`):**
   - Catalogued audit actions (`AuditAction` enum) and outcomes (`Outcome` enum).
   - Structured context passing via frozen `AuditContext` (auto-truncating `actor_username` to 64 chars; system factory `AuditContext.system()`).
   - In-transaction `record()` writing directly to caller's `Session` and flushing immediately; fails closed on error and rolls back with the caller transaction.
   - Recursive redaction guard raising `AuditPayloadError` if sensitive keys (`password`, `password_hash`, `new_password`, `current_password`, `token`, `csrf_token`) appear at any depth.
   - Snapshot and diff utilities (`diff()`, `snapshot()`).

4. **Automated Verification Suite:**
   - `test_audit_writer.py` (13 tests): in-transaction writing, rollback elimination, recursion redaction guards across all forbidden keys, diff/snapshot utilities, zero seed row assertion.
   - `test_audit_append_only.py` (15 tests):
     - `kalyan_app` permission denied for `UPDATE`, `DELETE`, `TRUNCATE` on `audit_logs`.
     - `kalyan_app` permission denied for `DELETE` on `users`.
     - `kalyan_app` permission denied for `INSERT` on `alembic_version`.
     - `kalyan_app` permission denied for `UPDATE`, `DELETE`, `TRUNCATE` on `system_setup`.
     - `kalyan_app` lacks `CREATE` privilege on public schema.
     - `kalyan_owner` blocked by DB triggers for `UPDATE`, `DELETE`, `TRUNCATE` on `audit_logs` (`append-only`).
     - `kalyan_owner` blocked by DB triggers for `UPDATE`, `DELETE`, `TRUNCATE` on `system_setup` (`append-only`).
     - `system_setup` rejects `id != 1` and rejects duplicate insertion of `id = 1`.
     - `users` table rejects invalid roles, rejects `DOCTOR` without `doctor_id`, and rejects non-`DOCTOR` with `doctor_id`.
   - Full test suite passes: 35/35 tests passing in 0.85s.

---

## 2. Verification Summary

| Gate / Check | Expected | Actual | Result |
|---|---|---|---|
| Zero seed credentials (`SEC-05`) | 0 users, 0 doctors, 0 setup rows | `users=0, doctors=0, system_setup=0` | PASS |
| Static scan of `0001_baseline.py` | No `INSERT INTO users` | Confirmed 0 matches | PASS |
| Append-only triggers (`AUD-01`) | Row & statement triggers block mutations | Verified for both `kalyan_app` and `kalyan_owner` | PASS |
| TRUNCATE trigger level | `FOR EACH STATEMENT` | Verified in `0001_baseline.py` | PASS |
| Single-row setup constraint (`SEC-07`) | `CHECK (id = 1)` and PK constraint | Verified | PASS |
| Doctor role association (`SEC-03`) | Bidirectional equivalence check | Verified in `test_audit_append_only.py` | PASS |
| Pytest suite | 35 passed, 0 failed | 35 passed in 0.85s | PASS |
| Ruff linter | 0 errors | All checks passed | PASS |
| Legacy codebase isolation | Untouched | Confirmed clean | PASS |

---

## 3. Next Steps

- Proceed to **Wave 3 (`11-04-PLAN.md`)**:
  - Implement authentication core (`backend/src/kalyan_api/services/auth_service.py`): Argon2id password hashing, constant-time dummy verification, session creation, sliding idle (30m) & absolute (12h) limits, CSRF token validation.
  - Implement lockout mechanism (5 failures -> 15 min lock) and per-IP throttling (`login_throttle`).
  - Implement endpoints: `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/change-password`.
