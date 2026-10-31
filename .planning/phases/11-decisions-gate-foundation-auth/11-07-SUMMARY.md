# Phase 11 Plan 07 Summary: Forced Password Change, NIST Policy & CSRF/Origin Defense

**Phase:** 11 — Decisions Gate, Foundation & Auth  
**Plan:** 11-07 (Wave 7)  
**Status:** Completed  
**Execution Date:** 2026-10-31  

---

## 1. Objectives Completed

1. **Configurable Password Policy in Settings (`config.py`):**
   - Added `password_min_length: int = 10`, `password_max_length: int = 128`, and `temp_password_length: int = 12` with `KALYAN_` env overrides (EG-19).
   - Validated policy constraints: `min >= 8`, `max <= 1024`, `min <= max`, `temp >= min`.
   - Guaranteed that policy lengths are driven by `Settings` without hardcoded constants in validator code.

2. **NIST-Style Password Policy Validator (`core/password_policy.py`):**
   - Implemented `validate_password_policy`: Validates candidate passwords against `Settings` length bounds, case-insensitive identity match with username or full name, and the common blocklist.
   - Rejects passwords matching entries or stems in `BLOCKLIST` (curated `frozenset` with 125 entries, exceeding the 100-entry floor).
   - Prohibits arbitrary character composition rules (allowing long passphrases and Unicode strings).
   - Fails with `PasswordPolicyError` (422 `password_policy`) without ever echoing or leaking candidate passwords in error messages.

3. **Forced First-Login Password Change Endpoint (`routers/auth.py`):**
   - Stamped with `authenticated_only` so users flagged with `must_change_password=True` can reach it, while `require()` routes block access with 403 `password_change_required` (SEC-05).
   - Enforces current password verification: Incorrect current password increments `failed_login_count`, records `AUTH_PASSWORD_CHANGE_FAILED`, triggers 15m lockout upon reaching threshold, and returns HTTP 403 `current_password_invalid`.
   - On valid change:
     - Rejects duplicate of current password (422 `password_policy`).
     - Hashes new password with Argon2id.
     - Updates `must_change_password=False`, `password_changed_at=now`, and resets failed login counters.
     - Revokes ALL of the user's existing sessions (`auth_service.revoke_all_user_sessions`).
     - Issues a fresh session, sets the new session cookie, and returns `MeResponse`.
     - Emits `AUTH_PASSWORD_CHANGED` audit record capturing the state transition (never any password text).

4. **Origin Verification & CSRF Protection (`core/csrf.py`):**
   - `verify_origin`: Global application dependency on `FastAPI(dependencies=[Depends(verify_origin)])`.
     - Safe methods (`GET`, `HEAD`, `OPTIONS`) bypass origin verification.
     - Unsafe methods (`POST`, `PUT`, `PATCH`, `DELETE`) require an `Origin` (or fallback `Referer`) whose `host:port` strictly matches the request `Host` header or `KALYAN_EXTRA_ALLOWED_ORIGINS` (dev proxy support).
     - Missing, `'null'`, or mismatched origins are rejected with 403 `csrf_failed`.
     - Documented invariant: `verify_origin` is the only global app dependency; authentication and RBAC checks remain strictly per-route.
   - `check_csrf_token`: Cryptographically validates `X-CSRF-Token` against session `csrf_token` via `hmac.compare_digest` for all authenticated state-modifying requests in `_resolve_principal_from_request`.
   - Unauthenticated requests to protected endpoints return 401 `not_authenticated` rather than 403.

---

## 2. Verification Summary

| Gate / Test Suite | Description | Status |
|---|---|---|
| `test_password_change.py` (6 tests) | Blocklist size >= 100, must-change access restriction & flow, wrong password counter increment & lock, policy length/identity/unicode validation, KALYAN_PASSWORD_MIN_LENGTH override, and audit secret redaction | PASS |
| `test_csrf_origin.py` (5 tests) | Origin/Referer requirement, extra allowed origins, safe methods bypass, per-session X-CSRF-Token compare_digest, and unauthenticated 401 vs 403 distinction | PASS |
| Full backend suite | All 89 tests across all phases and modules pass clean | PASS |
| Static checks & linter | `ruff check backend` clean (0 errors), zero `Sec-Fetch`, zero hardcoded `MIN_LENGTH`/`MAX_LENGTH` in `password_policy.py`, `compare_digest` confirmed in `csrf.py` | PASS |

---

## 3. Next Steps (Plan 11-08)

- Implement route-walk verification test: Iterates over all application endpoints via `fastapi.routing.iter_route_contexts(app.routes)` to prove that every route declares **exactly one** policy marker (`public`, `authenticated_only`, or `require()`).
- Verify that only permitted public endpoints exist (`GET /api/health`, `POST /api/auth/login`).
- Verify that no route lacks policy protection (default-deny architecture).

