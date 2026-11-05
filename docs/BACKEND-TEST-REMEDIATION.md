# Backend Test Suite Remediation Report

## 1. Executive Summary
- **Target:** 100% green test pass rate across the full Kalyan Hospital backend pytest test suite without changing production application behavior or weakening security contracts (SEC-06, RBAC, D-02).
- **Result:** **709 passed**, 1 skipped (`test_spa_serving` missing env var), **0 failed**.
- **Code Quality:** `ruff check backend` **All checks passed** (0 errors).
- **Database Hygiene:** `kalyan_dev` remains 100% clean (0 patient records, 3 active standard users). All tests isolated to `kalyan_test`.

---

## 2. Root Cause Analysis & Key Remediations

### 2.1 Test Database Isolation (`backend/tests/conftest.py`)
- **Root Cause:** Certain test modules invoked `get_settings()` before pytest's test settings took effect, falling back to values from `backend/.env` which defaulted to `kalyan_dev`.
- **Fix:** Added an autouse session fixture `configure_test_environment` in `conftest.py` setting `os.environ["KALYAN_DB_NAME"] = "kalyan_test"`, `os.environ["KALYAN_ENV"] = "test"`, and clearing the settings cache via `get_settings.cache_clear()`.

### 2.2 Optimistic Locking Contract (`backend/tests/test_doctor_admin.py` & `backend/tests/support/matrix.py`)
- **Root Cause:** `PATCH /api/fees/{fee_id}` was updated under SEC-06 to enforce optimistic concurrency via `version_id`. Legacy test payloads omitted `version_id`, causing 409 Conflict.
- **Fix:** Updated test payloads to dynamically query and supply the record's current `version_id`. SEC-06 concurrency protection remains strictly enforced.

### 2.3 Dynamic Migration Head Verification (`backend/tests/test_migrations.py` & `backend/tests/test_health_tracer.py`)
- **Root Cause:** Tests hardcoded an assertion checking for migration revision `"0005"`. With subsequent migrations committed up to `"0007"`, the assertion failed.
- **Fix:** Replaced hardcoded string with dynamic checks querying Alembic's `ScriptDirectory.from_config(cfg).get_heads()`.

### 2.4 OpenAPI Snapshot Synchronization (`backend/tests/openapi.snapshot.json`)
- **Root Cause:** Snapshot did not reflect the recent operations and administration routes added in phases 15–17.
- **Fix:** Regenerated canonical specification using the built-in CLI:
  ```powershell
  python -m kalyan_api.cli export-openapi --out backend/tests/openapi.snapshot.json
  ```
  Verified `test_openapi_snapshot.py` passed with 0 drift.

### 2.5 Admin Permissions Catalogue (`backend/tests/test_permissions_catalogue.py`)
- **Root Cause:** Six new permissions (`SESSION_READ`, `SESSION_REVOKE`, `SECURITY_READ`, `SECURITY_WRITE`, `BACKUP_CONFIGURE`, `SYSTEM_READ`) were added to `Role.ADMIN` during administrative panel hardening.
- **Fix:** Updated the permissions catalogue golden snapshot to include these administrative permissions.

### 2.6 Full RBAC Authorization Matrix Coverage (`backend/tests/support/matrix.py` & `test_rbac_matrix.py`)
- **Root Cause:** 15 newly introduced non-public endpoints were unmapped in the RBAC matrix test suite. Furthermore, `AuthSession` initialization in the matrix test attempted to pass a non-existent `expires_at` column.
- **Fix:** Added all 15 endpoints with strict expected status codes (401 unauth, 403 doctor/reception, 200/201/422 admin). Fixed `AuthSession` model instantiation to use `created_at` and `last_seen_at`.

### 2.7 Restore Test Isolation & Deadlock Prevention (`backend/tests/test_operations_api.py` & `test_phase16_gate.py`)
- **Root Cause:** `TestClient` API tests run inside a transaction/savepoint (`db_session`). When an endpoint or test executed a full database schema reset (`DROP SCHEMA public CASCADE` via `psql`), PostgreSQL blocked waiting for the open `db_session` transaction to release its table locks, resulting in an indefinite deadlock / 60s timeout.
- **Fix:** 
  1. In `test_operations_api.py`, mocked the destructive subprocess wipe in the API lifecycle test so the REST request schema, RBAC, audit logging, and JSON response are verified without dropping the test database mid-suite. (Real physical database restore remains 100% verified by `test_restore_service.py` and `test_phase17_acceptance.py`).
  2. In `test_phase16_gate.py`, separated the HTTP Audit Log test (`test_phase16_audit_log_gate`) from the physical backup/restore test (`test_phase16_backup_restore_gate`), ensuring no uncommitted savepoints are active during the physical restore drill.
  3. In `test_integrity_service.py`, used `db_session` with automatic rollback rather than manual DML deletes (which `kalyan_app` lacks table privileges for).

---

## 3. Verification Commands & Outcomes

| Test Suite / Tool | Command | Outcome |
| :--- | :--- | :--- |
| **RBAC Matrix** | `pytest backend/tests/test_rbac_matrix.py` | **419 passed** |
| **Operations API** | `pytest backend/tests/test_operations_api.py` | **2 passed** |
| **Restore Service** | `pytest backend/tests/test_restore_service.py` | **2 passed** |
| **Phase 16 Gate** | `pytest backend/tests/test_phase16_gate.py` | **2 passed** |
| **Phase 17 Acceptance** | `pytest backend/tests/test_phase17_acceptance.py` | **3 passed** |
| **Integrity Service** | `pytest backend/tests/test_integrity_service.py` | **2 passed** |
| **Full Backend Suite** | `pytest backend/tests` | **709 passed, 1 skipped, 0 failed** |
| **Ruff Linter** | `ruff check backend` | **All checks passed** |
