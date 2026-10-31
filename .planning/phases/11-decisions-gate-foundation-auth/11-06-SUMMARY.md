# Phase 11 Plan 06 Summary: Account Lockout & DB-Backed Per-IP Throttling

**Phase:** 11 — Decisions Gate, Foundation & Auth  
**Plan:** 11-06 (Wave 6)  
**Status:** Completed  
**Execution Date:** 2026-10-31  

---

## 1. Objectives Completed

1. **Peer IP Canonical Normalization (`core/net.py`):**
   - Implemented `normalize_ip` handling IPv4, IPv6, localhost/testclient, and invalid strings gracefully, defaulting safely to `"0.0.0.0"`.
   - Implemented `client_ip(request)` extracting exclusively from TCP socket peer (`request.client.host`).
   - Strict security guarantee: Never inspects client request headers (e.g., `X-Forwarded-For`), preventing IP spoofing on plaintext LAN.

2. **Atomic Account Lockout (`services/auth_service.py`):**
   - Implemented `record_failed_login`: Atomically increments `failed_login_count` and sets `locked_until = now + lockout_minutes` via a single Core `UPDATE ... RETURNING` statement with SQL `CASE`.
   - Invariant: Counter updates execute directly via Core statements, completely avoiding ORM entity flush and preserving `users.version_id` against accidental optimistic locking conflicts.
   - Enforced 5-consecutive-failure threshold locking the account for 15 minutes (D-07).
   - While locked, even correct passwords return byte-identical generic 401s without extending the lockout window.
   - Lock expiration is evaluated deterministically against `clock.utcnow()`, resetting counters upon subsequent successful authentication.

3. **Database-Backed Per-IP Throttle (`services/throttle_service.py`):**
   - Leveraged `login_throttle` table with atomic PostgreSQL `INSERT ... ON CONFLICT (ip) DO UPDATE`.
   - Window management: Automatically resets `window_start` when the active window is older than `throttle_window_minutes` (15 minutes).
   - Pre-verification burst limit: After 20 failures within 15 minutes from an IP address, requests return HTTP 429 `too_many_attempts` with `Retry-After` header before running any expensive Argon2id hash computations.
   - Zero external caching or Redis dependencies, preserving 100% offline hospital LAN operation.

4. **Audit Trail & Constant-Time Guarantees (`routers/auth.py`):**
   - Every failure path (unknown user, bad password, locked account) executes exactly one constant-time Argon2 verification (`dummy_verify` or `verify_password`).
   - Failure responses are returned as `JSONResponse(status_code=401, ...)` rather than raised exceptions, ensuring that `failed_login_count`, `locked_until`, throttle counters, and audit log entries (`AUTH_LOGIN_FAILED`, `AUTH_ACCOUNT_LOCKED`, `AUTH_LOGIN_THROTTLED`) commit reliably.
   - All failure responses return byte-identical JSON envelopes (`code="invalid_credentials"`, `GENERIC_INVALID_CREDENTIALS_MSG`), entirely preventing username enumeration.

---

## 2. Verification Summary

| Gate / Test Suite | Description | Status |
|---|---|---|
| `test_five_failed_logins_lock_account_and_persist_state` | 5 failures produce count 5, 15m lock, 5 failed audits, 1 locked audit | PASS |
| `test_locked_account_rejects_correct_password_without_counter_extension` | Correct password rejected during lock, lock time unextended | PASS |
| `test_lockout_expires_and_allows_login` | Clock advance past 15m allows login and resets DB counters | PASS |
| `test_successful_login_resets_failed_counter_prior_to_lockout` | 3 failures followed by success resets counter to 0 | PASS |
| `test_users_version_id_never_bumped_by_failed_logins` | `users.version_id` untouched by failed login counter updates | PASS |
| `test_byte_identical_bodies_and_constant_verification_counts` | Unknown, wrong, and locked attempts have identical content & 1 verify | PASS |
| `test_per_ip_throttle_blocks_burst_after_twenty_failures` | 21st attempt hits 429 with `Retry-After`, zero verify calls, 1 throttle audit | PASS |
| `test_successful_login_does_not_reset_throttle_counter` | Successful login does not reset IP failure count | PASS |
| `test_different_ip_addresses_are_throttled_independently` | IP A throttled, IP B unaffected | PASS |
| `test_concurrent_failed_logins_atomic_increment` (@concurrency) | 6 concurrent worker threads increment counter atomically to 6 | PASS |
| Full backend suite | All 78 tests across health, db, migrations, audit, auth, and permissions pass clean | PASS |
| Static checks & linter | `ruff check backend` clean (0 errors), zero `raise` in login, zero `X-Forwarded-For` | PASS |

---

## 3. Next Steps (Plan 11-07)

- Implement Origin verification on all unsafe HTTP methods (POST, PUT, PATCH, DELETE) against request `Host` header and `extra_allowed_origins`.
- Implement CSRF header validation (`X-CSRF-Token` compared against `sessions.csrf_token` via `hmac.compare_digest`).
- Implement forced password change endpoint: `POST /api/auth/change-password` with current password check, password policy validation, session rotation, and other sessions revocation.
