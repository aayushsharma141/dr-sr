# Phase 11 Plan 05 Summary: User Login, Session Lifecycle, Policy Markers & RBAC Catalogue

**Phase:** 11 — Decisions Gate, Foundation & Auth  
**Plan:** 11-05 (Wave 4/5)  
**Status:** Completed  
**Execution Date:** 2026-10-31  

---

## 1. Objectives Completed

1. **Role and Permission Enumeration (`core/permissions.py`):**
   - Implemented `Role` StrEnum strictly adhering to `ADMIN`, `RECEPTION`, and `DOCTOR` (SEC-03).
   - Implemented `Permission` StrEnum following strict `noun:verb` naming convention across Foundation, Clinic Settings, Appointments/Clinical, Prescriptions/Plans, Billing/Receipts, and System Audit/Backup phases.
   - Authoritative `ROLE_PERMISSIONS` catalogue mapping:
     - `ADMIN`: Operational administration, user management, fee/doctor setup, audit/backup/integrity, and exclusive payment reversal (`payment:reverse` under D-06 / EG-16). Completely segregated from clinical records (D-03/D-04).
     - `RECEPTION`: Patient registration, photo management, appointment booking, payment creation, and receipt reprint. Completely segregated from clinical encounters and notes.
     - `DOCTOR`: Doctor clinical silo; exclusive authority over encounters, prescriptions, treatment plans, and therapy session logs. Segregated from financial management.
   - Pinned `RESERVED` mapping associating upcoming permissions with owning plans/milestones.

2. **Argon2id Cryptographic Core (`core/security.py`):**
   - Implemented `build_hasher` using configurable Argon2id profile (`time_cost`, `memory_cost`, `parallelism`).
   - Implemented `hash_password`, `verify_password`, and `needs_rehash` for seamless parameter upgrades.
   - Implemented constant-time `dummy_verify` against precomputed dummy hash to mitigate username enumeration and timing oracle attacks.
   - Implemented high-entropy cryptographic token generators: `new_session_token` (256-bit base64url), `hash_token` (SHA-256 hex), `new_csrf_token`, and client IP sanitization (`clean_ip`).

3. **Principal Resolution & Session Lifecycle (`core/principal.py` & `services/auth_service.py`):**
   - Immutable frozen `Principal` dataclass with `user_id`, `username`, `role`, `doctor_id`, `permissions`, `session_id`, and `must_change_password`.
   - Sliding idle expiration (30 minutes; D-07) and absolute expiration (12 hours) calculated against `clock.utcnow()`.
   - Touch throttling (`touch_throttle_seconds = 60`): `last_seen_at` is updated via conditional Core UPDATE only after 60s of elapsed activity; suppressed completely when `X-Kalyan-Passive: 1` header is present.
   - Opportunistic stale session cleanup: purged during login if older than absolute limit + 24 hours.

4. **Policy Markers & Default-Deny Authorization (`core/policy.py`):**
   - Stamped route dependency markers: `public`, `authenticated_only`, and `require(*permissions)`.
   - Strict default-deny semantics: `require` validates `required_set.issubset(principal.permissions)`, returning HTTP 403 `forbidden` JSON envelope on missing permissions.
   - Pending password change guard: blocks users with `must_change_password=True` from application endpoints (`403 password_change_required`), while permitting access to `/api/auth/change-password` via `current_principal_allow_pending`.

5. **Authentication Endpoints (`routers/auth.py`):**
   - `POST /api/auth/login`:
     - Constant-time authentication with generic failure message (prevents enumeration).
     - Session rotation on authentication: invalidates any existing token present in cookies before issuing a fresh session.
     - Emits cookie with `HttpOnly`, `SameSite=Strict`, `Path=/`, and NO `Secure` flag on plaintext hospital LAN (avoiding the D-01 browser drop trap).
     - Emits in-transaction `AUTH_LOGIN_SUCCEEDED` audit log referencing session ID only (never the raw token).
   - `GET /api/auth/me`: Returns profile, role, resolved permissions set, and active CSRF token.
   - `POST /api/auth/logout`: Revokes active session row via Core UPDATE, records `AUTH_LOGOUT`, and clears the session cookie.

---

## 2. Verification Summary

| Gate / Test Suite | Description | Status |
|---|---|---|
| `test_auth_login.py` (7 tests) | Login happy path, cookie semantics (no Secure/MaxAge/Expires), /me round-trip, byte-identical 401s, extra fields 422, Secure trap regression guard, login audit recording | PASS |
| `test_sessions.py` (8 tests) | Idle expiration (+29m OK, +31m 401), periodic activity retention, absolute 12h timeout, 60s touch throttling, passive header suppression, logout revocation & cookie clearing, deactivated user rejection, token SHA-256 hash at rest, require() policy enforcement, fail-closed login rollback | PASS |
| `test_permissions_catalogue.py` (5 tests) | `noun:verb` regex validation, exclusive `payment:reverse` on ADMIN, clinical isolation on DOCTOR, RESERVED dictionary completeness, golden role-permissions snapshot | PASS |
| Full backend suite | All 68 tests across health, db, migrations, audit, auth, and permissions pass clean | PASS |
| `time.sleep` check | 0 occurrences in `backend/tests` (driven deterministically via `clock` seam) | PASS |
| Linter (`ruff check`) | Zero errors, strict formatting and import order compliant | PASS |

---

## 3. Next Steps (Plan 11-06)

- Implement account lockout mechanism: 5 consecutive failed attempts trigger a 15-minute lockout (`locked_until`).
- Implement per-IP throttling via `login_throttle` table to mitigate network-level brute-force attacks.
- Implement forced password change workflow (`must_change_password` flag) and `POST /api/auth/change-password`.
- Verify CSRF validation on mutating auth endpoints.
