# Phase 11 Plan 10 Summary: User Lifecycle Operations (Deactivate, Reset-Password, Unlock)

**Execution Date:** 2026-10-31  
**Status:** Complete & Verified  
**Commit:** `eaf7c0b`  
**Requirements Addressed:** SEC-05, SEC-04, AUD-01, D-07, D-08  

---

## 1. Objectives Achieved

1. **User Deactivation and Reactivation Lifecycle (Task 1, SEC-05):**
   - Implemented `POST /api/users/{id}/deactivate` and `POST /api/users/{id}/reactivate` in [`routers/users.py`](file:///d:/dr-sr/backend/src/kalyan_api/routers/users.py), both protected by `require(Permission.USER_DEACTIVATE)`.
   - On deactivation:
     - Sets `is_active = False` on the `User` record.
     - Immediately terminates all active sessions in `auth_sessions` by setting `revoked_at = utcnow()`.
     - User row remains in the database (never deleted). Verified total `users` row count is unchanged before and after.
     - Former session cookies return 401 Unauthorized immediately.
     - Subsequent login attempts return the generic 401 `invalid_credentials` (SEC-05: never disclose account active/inactive state).
     - Records `USER_DEACTIVATED` audit row with `before={"is_active": True}` and `after={"is_active": False}`.
   - On reactivation:
     - Sets `is_active = True`.
     - Revoked sessions remain dead (requires fresh authentication).
     - Allows the user to authenticate again.
     - Records `USER_REACTIVATED` audit row with `before={"is_active": False}` and `after={"is_active": True}`.

2. **No User Deletion Enforcement (Task 1):**
   - Verified that neither `@router.delete` nor `session.delete(user)` exists anywhere in `routers/users.py` or `services/user_service.py`.
   - Confirmed via `test_users_never_deleted_database_permission_denied`:
     - `kalyan_app` runtime PostgreSQL role executing `DELETE FROM users` triggers an explicit `permission denied` SQL exception.
     - Route tree analysis via `walk_routes` yields 0 `DELETE` routes under `/api/users`.

3. **Lifecycle Guards (Task 1):**
   - Prohibits self-deactivation (409 `self_action_forbidden`).
   - Protects the last active administrator: attempting to deactivate the sole active admin returns 409 `last_admin`. Verified with `without_active_admins` test fixture that deactivation succeeds only when another active administrator exists.
   - Idempotency guards: deactivating an already deactivated user or reactivating an already active user returns 409 `state_unchanged`.
   - Concurrency guard: stale `version_id` returns 409 `version_conflict`.

4. **Admin Password Reset & Temporary Password Issuance (Task 2, D-01, RISK-01):**
   - Implemented `POST /api/users/{id}/reset-password` protected by `require(Permission.USER_RESET_PASSWORD)`.
   - Response sets `Cache-Control: no-store` and returns `UserCreatedOut` with a one-time `temporary_password` (length configured via `settings.temp_password_length` without ambiguous characters).
   - Flags `must_change_password = True` on the target user.
   - Immediately revokes all existing sessions for the target user.
   - Old password fails; new temporary password allows login and directs the user to the forced password change flow (403 `password_change_required` on protected endpoints until password change completes).
   - Audit trail: writes `USER_PASSWORD_RESET` with payload `{"must_change_password": True}`. Temporary passwords and hashes are strictly forbidden and never written to audit tables.
   - Self-reset guard: administrators cannot reset their own password via the admin endpoint (409 `self_action_forbidden`).
   - Lockout independence: resetting the password does not clear an active lockout (lockout override is a dedicated action).

5. **Admin Lockout Override (Task 2, D-07):**
   - Implemented `POST /api/users/{id}/unlock` protected by `require(Permission.USER_UNLOCK)`.
   - Zeroes `failed_login_count` and clears `locked_until`, allowing the locked user to sign in immediately before the 15-minute cooldown ends.
   - Records `USER_UNLOCKED` audit row recording before and after lockout counters.
   - Guards: calling unlock on an unlocked account returns 409 `state_unchanged`; stale `version_id` returns 409 `version_conflict`.

6. **Permissions Catalog and RBAC Matrix Completeness:**
   - Removed `USER_DEACTIVATE`, `USER_RESET_PASSWORD`, `USER_UNLOCK` from `RESERVED` mapping in [`core/permissions.py`](file:///d:/dr-sr/backend/src/kalyan_api/core/permissions.py) (all `user:*` permissions are now actively consumed).
   - Added all 4 endpoints to `MUST_EXIST` in [`tests/test_route_policies.py`](file:///d:/dr-sr/backend/tests/test_route_policies.py).
   - Added all 4 lifecycle operations to `MATRIX` in [`tests/support/matrix.py`](file:///d:/dr-sr/backend/tests/support/matrix.py), ensuring full coverage across all 5 identities (`anonymous`, `admin`, `reception`, `doctor_a`, `doctor_b`).

---

## 2. Test Verification & Code Quality

- **Test Suite Results:** 200 passed, 2 deselected (concurrency tests), 0 failures across the backend test suite in 30.50s.
- **RBAC Matrix:** 74 passed, 0 failures.
- **Linter & Style:** `ruff check backend` clean (0 warnings/errors).
- **Acceptance Criteria Verification:**
  - `Select-String -CaseSensitive -Pattern '@router\.delete|session\.delete\('` on `routers/users.py` and `services/user_service.py`: 0 matches.
  - `Select-String -CaseSensitive -Pattern '"user:'` in `RESERVED` in `permissions.py`: 0 matches.
  - `Select-String -CaseSensitive -Pattern 'temporary_password'` in `audit.record` calls: 0 matches.
  - User row count verified unchanged after deactivation.

---

## 3. Next Steps

- Proceed to **Plan 11-11** (Wave 11: First-run setup wizard and CLI admin recovery).
