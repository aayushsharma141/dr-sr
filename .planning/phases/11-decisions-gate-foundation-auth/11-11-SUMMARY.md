# Phase 11 Plan 11 Summary: First-Run Setup Wizard Backend & Console Recovery

**Execution Date:** 2026-10-31  
**Status:** Complete & Verified  
**Requirements Addressed:** SEC-07, SEC-05, SEC-02, AUD-01  

---

## 1. Objectives Achieved

1. **First-Run Web Setup Wizard Backend (SEC-07, SC-6):**
   - **`GET /api/setup/status`**: Public endpoint reporting `{"setup_required": true}` while `system_setup` row does not exist. Returns `410 setup_closed` permanently once completed.
   - **`POST /api/setup/admin`**: Atomic creation of the initial administrator account and insertion of the singleton `system_setup` row (`id=1`).
   - Protected by `pg_advisory_xact_lock(SETUP_LOCK_KEY)` to eliminate race conditions.
   - Re-verifies `setup_completed(session)` within the transaction.
   - Requires a high-entropy 10-character code generated from an unambiguous alphabet (`SETUP_CODE_ALPHABET`).
   - Verification executed in constant time using `hmac.compare_digest`.
   - On completion, returns `201 Created` with `UserOut` (`role=Role.ADMIN`, `must_change_password=False`) and registers `ADMIN_BOOTSTRAPPED` audit event with `actor_username="setup:wizard"`.
   - Code consumption is atomic: the in-memory hash is cleared and `backend/var/setup-code.txt` is deleted via a Starlette `BackgroundTask` only after transaction commit.

2. **Security Invariants & Leakage Defense (SEC-07, SC6-7):**
   - The setup code is stored in memory as a SHA-256 hash only.
   - Printed via `print()` only when `sys.stdout.isatty()` is `True`; otherwise, logs only the file path banner.
   - The setup code is never passed to Python's logging module, never logged in uvicorn access logs, never returned in response headers or bodies, and never recorded in audit tables.
   - `backend/var/setup-code.txt` is strictly git-ignored (`.gitignore`).

3. **Brute-Force Defense & Code Rotation (SEC-07, D-07):**
   - Per-IP failure tracking via `register_setup_failure`: after 5 invalid attempts within 15 minutes, the IP receives `429 Too Many Requests` with a `Retry-After` header.
   - Each failure also feeds the database-backed `login_throttle` table.
   - After 10 total failures across all IPs, the setup code is automatically rotated.

4. **Console Emergency Recovery (`cli.py`):**
   - `python -m kalyan_api.cli reset-admin-password --username <admin>`:
     - Prompts for password via `getpass.getpass` twice or accepts `--password-stdin` / `--generate-password`.
     - Strictly prohibited from accepting `--password` in command-line arguments.
     - Operates only on existing, active administrators. Refuses non-admin or deactivated users.
     - Never touches or reopens `system_setup`.
     - `create-admin` command was deliberately eliminated.
     - Writes `ADMIN_PASSWORD_RESET_CLI` audit record with `actor="cli:<windows_user>"`.

---

## 2. Verification & Automated Tests

All acceptance criteria (SC6-1 through SC6-7) verified across test suites:
- `backend/tests/test_setup_wizard.py` (16 passed):
  - `test_setup_available_when_never_completed`
  - `test_valid_code_creates_exactly_one_admin`
  - `test_invalid_code_rejected`
  - `test_failed_commit_does_not_consume_code`
  - `test_setup_closed_after_completion`
  - `test_setup_not_reopened_by_deactivation`
  - `test_code_never_logged`
  - `test_code_never_in_responses`
  - `test_code_never_in_audit`
  - `test_address_locked_after_wrong_codes`
  - `test_code_rotated_after_total_failures`
  - `test_restart_before_setup_rotates_code`
  - `test_simultaneous_submissions_single_admin` (concurrency race test)
  - `test_restart_after_setup_stays_closed`
- `backend/tests/test_cli_admin.py` (8 passed)
- `backend/tests/test_no_default_credentials.py` (2 passed)
- `backend/tests/test_rbac_matrix.py` (82 passed)
- Full backend suite: **238 passed, 1 warning (100% GREEN)**.
- `ruff check backend`: Clean.
