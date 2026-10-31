# Phase 11 Plan 09 Summary: User Administration API and Optimistic Concurrency

**Execution Date:** 2026-10-31  
**Status:** Complete & Verified  
**Commits:** `d865a23`, `13fe6b7`  
**Requirements Addressed:** SEC-05, SEC-06, AUD-01, D-08, D-03  

---

## 1. Objectives Achieved

1. **User Provisioning & One-Time Temporary Password (Task 1):**
   - Implemented `POST /api/users` (201 Created) in [`routers/users.py`](file:///d:/dr-sr/backend/src/kalyan_api/routers/users.py) guarded by `require(Permission.USER_CREATE)`.
   - Generates unambiguous temporary passwords (excluding `0`, `O`, `1`, `l`, `I`) of `settings.temp_password_length` via `secrets.choice`, validated against NIST password policies.
   - Enforces `Cache-Control: no-store` on the creation response carrying the temporary password.
   - Sets `must_change_password=True`. Verified the user signs in with the temporary password and is held in the forced password change flow (403 `password_change_required`) until completing `POST /api/auth/change-password`.
   - Creating a `DOCTOR` user requires `doctor_name_en` and inserts the `Doctor` profile stub and `User` in one transaction. Supplying `doctor_name_en` for non-DOCTOR roles returns 422.
   - Duplicate usernames (case-insensitive) return 409 `username_taken`.
   - Request models use `extra="forbid"`: unpermitted fields (`password_hash`, `failed_login_count`, `version_id`, `is_active`) return 422.
   - Emits `USER_CREATED` audit log with `role`, `full_name`, and `doctor_id` only (passwords never logged).
   - Patched failure tests verify fail-closed behavior (session rolls back on audit failure).

2. **User Listing and Retrieval (Task 1):**
   - Implemented `GET /api/users` (with optional `is_active` filter) and `GET /api/users/{id}` guarded by `require(Permission.USER_READ)`.
   - Responses serialize `UserOut` with `version_id`, `is_locked` (computed dynamically against clock), and strictly omit `password_hash` and temporary credentials.

3. **Optimistic Concurrency & 409 Conflict Contract (Task 2):**
   - Added `__mapper_args__ = {"version_id_col": version_id}` to `User` and `Doctor` models in [`models.py`](file:///d:/dr-sr/backend/src/kalyan_api/models.py).
   - Implemented `PATCH /api/users/{id}` guarded by `require(Permission.USER_UPDATE)`.
   - Implemented `require_version(entity, expected, "user")` in [`core/errors.py`](file:///d:/dr-sr/backend/src/kalyan_api/core/errors.py) and registered exception handlers for both `VersionConflict` and `sqlalchemy.orm.exc.StaleDataError`:
     - Returns HTTP 409 with envelope: `{"code": "version_conflict", "message": "Record was modified by another user", "entity": "user", "id": <id>}` and `Cache-Control: no-store`.
   - Verified that successful updates increment `version_id` to `previous + 1` and emit `USER_UPDATED` with field diffs (`before` and `after`).
   - Verified that failed logins (Core `UPDATE`s) do not increment `version_id`.
   - Built a regex scanner test in [`tests/test_optimistic_locking.py`](file:///d:/dr-sr/backend/tests/test_optimistic_locking.py) verifying `backend/src` contains zero manual assignments to `version_id`.

4. **Role Modification Guards (Task 2):**
   - Role changes between `ADMIN` and `RECEPTION` emit `USER_ROLE_CHANGED` audit records.
   - Prohibits role changes to or from `DOCTOR` (returns 409 `role_change_not_allowed`, EG-15).
   - Prohibits administrators from modifying their own role (returns 409 `self_action_forbidden`).
   - Prohibits demoting the last active administrator (returns 409 `last_admin`).

5. **Concurrency & Race Verification (Task 2):**
   - Tested deterministic two-session ORM race raising `StaleDataError`.
   - Tested 20 iterations of concurrent HTTP races with two parallel threads releasing requests behind `threading.Barrier(2)` on real PostgreSQL 18:
     - Exactly one request receives 200 and the other receives 409 in 20/20 iterations.
     - Final `version_id` equals `start + 1`.

---

## 2. Test Verification & Code Quality

- **Unit & Concurrency Tests:** 177 tests passed, 0 failures across the entire backend suite in 22.17s.
- **Linter & Style:** `ruff check backend` clean (0 warnings/errors).
- **Acceptance Criteria Verification:**
  - `Select-String -CaseSensitive -Pattern '@router\.delete'` on `routers/users.py`: 0 matches (no DELETE routes).
  - `Select-String -CaseSensitive -Pattern 'version_id_col'` on `models.py`: matches `Doctor` and `User`.
  - `Select-String -CaseSensitive -Pattern '\b12\b'` on `services/user_service.py`: 0 matches (length parameterized via `Settings`).
  - `Select-String -CaseSensitive -Pattern 'StaleDataError'` on `core/errors.py`: matches exception handler.
  - `test_optimistic_locking.py` asserts 409 status, code `version_conflict`, and message `"Record was modified by another user"`.
  - Code regex scan asserts no `\.version_id\s*=` assignment in `backend/src`.

---

## 3. Next Steps

- Proceed to **Plan 11-10** (Wave 10: User administration lifecycle endpoints: deactivate, reactivate, unlock, and admin reset-password with temporary password issuance and session revocation).
