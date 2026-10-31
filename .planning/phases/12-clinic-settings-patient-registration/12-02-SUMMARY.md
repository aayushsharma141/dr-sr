# Phase 12 Plan 02: Clinic Settings, Doctor Profiles, and Fee Schedules Endpoints Summary

**Execution Date:** 2026-11-01  
**Status:** COMPLETE  
**Coverage:** 92% (303 passed, 1 skipped, 0 failures)

---

## 1. What was built

### Endpoints Implemented:
1. **Clinic Settings (`SET-01`):**
   - `GET /api/settings`: Readable by all authenticated system roles (`ADMIN`, `RECEPTION`, `DOCTOR`); returns 401 for anonymous.
   - `PATCH /api/settings`: Restricted exclusively to `ADMIN` (`settings:write`). Enforces optimistic concurrency (`version_id`), returning 409 `version_conflict` on stale writes. Emits `SETTINGS_UPDATED` in `audit_logs` within the same transaction.

2. **Doctor Profiles (`SET-02`):**
   - `GET /api/doctors`: Readable by all authenticated roles (`doctor:read`). By default lists active doctors; `include_inactive=True` supported.
   - `POST /api/doctors`: Restricted to `ADMIN` (`doctor:manage`). Creates doctor profile with Hindi names, qualifications, registration number, and default fee. Emits `DOCTOR_CREATED` in `audit_logs`.
   - `PATCH /api/doctors/{id}`: Restricted to `ADMIN` (`doctor:manage`). Updates doctor profile with optimistic concurrency control (`version_id`), returning 409 on version mismatch. Emits `DOCTOR_UPDATED` in `audit_logs`.

3. **Consultation Fees (`SET-03`):**
   - `GET /api/fees`: Lists active fee rates in paise (`fee:read`).
   - `POST /api/fees`: Restricted to `ADMIN` (`fee:manage`). Creates consultation fee schedule in paise. Emits `FEE_CREATED` in `audit_logs`.
   - `PATCH /api/fees/{id}`: Restricted to `ADMIN` (`fee:manage`). Modifies consultation fee rate. Emits `FEE_UPDATED` in `audit_logs`.

### Security, RBAC & Invariants:
- `backend/src/kalyan_api/core/permissions.py`:
  - Active permissions removed from `RESERVED` catalog: `SETTINGS_READ`, `SETTINGS_WRITE`, `DOCTOR_READ`, `DOCTOR_MANAGE`, `FEE_READ`, `FEE_MANAGE`.
- `backend/tests/openapi.snapshot.json`:
  - Updated snapshot with all 8 new endpoint routes and schemas.
- `backend/tests/support/matrix.py`:
  - Added 8 matrix rows for the new endpoints across all 5 system identities (`anonymous`, `admin`, `reception`, `doctor_a`, `doctor_b`). Total RBAC matrix cell test cases increased from 84 to 124.
- `backend/tests/test_rbac_matrix.py`:
  - Handled dynamic mock entities for settings, doctors, and fees. All 124 cells passing.

---

## 2. Test Verification

- `backend/tests/test_clinic_settings.py`: 5 tests passing (anonymous 401, all-role read, non-admin 403, admin update + audit, 409 conflict).
- `backend/tests/test_doctor_admin.py`: 4 tests passing (anonymous 401, creation & listing RBAC, optimistic update & conflict, fee CRUD & RBAC).
- `backend/tests/test_permissions_catalogue.py`: 5 tests passing (noun:verb check, payment reversal isolation, clinical exclusivity, no-orphan check, golden role-permissions snapshot).
- `backend/tests/test_openapi_snapshot.py`: 2 tests passing.
- `backend/tests/test_rbac_matrix.py`: 124 tests passing.
- Full test suite: 303 passed, 1 skipped (frontend dist check when env var not set), 0 failures.
- Linter: `ruff check backend` clean (0 errors).
