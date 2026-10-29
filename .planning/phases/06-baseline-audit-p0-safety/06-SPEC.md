# Phase 6 Specification: Baseline Audit & P0 Safety/Audit Core

## 1. Objective
Establish complete safety compliance for Kalyan Hospital v2.0 by resolving three critical P0 baseline audit findings:
1. **P0 Audit Logging (AUD-01):** Create canonical `audit_logs` table schema and implement an `AuditService` that logs clinical, financial, security, and backup events.
2. **P0 Credential Safety (SEC-01):** Eliminate hardcoded default administrator credentials (`kalyan@admin`) from `AuthService` and implement a first-run administrator credential initialization mechanism.
3. **P0 Disaster Recovery Safety (BAK-01):** Replace raw `shutil.copy2` file copies in `BackupService.restore_from_backup()` with SQLite atomic `conn.backup()` and explicit WAL checkpointing before and during restore operations.

---

## 2. Scope Boundaries
- **In Scope:**
  - `app/db/schema.sql` update to include `audit_logs` table with proper indexes and foreign keys.
  - Automatic migration for existing databases in `app/db/connection.py`.
  - `app/services/audit_service.py` implementation with event types: `AUTH_LOGIN`, `AUTH_LOGOUT`, `PATIENT_CREATE`, `PATIENT_UPDATE`, `TREATMENT_SESSION_CREATE`, `PAYMENT_CREATE`, `BACKUP_CREATE`, `BACKUP_RESTORE`, `SYSTEM_CONFIG`.
  - `app/services/auth_service.py` modification: remove hardcoded `"kalyan@admin"` password, add `has_admin_user()`, `initialize_admin(password)` for first-run setup.
  - `app/services/backup_service.py` modification: replace `shutil.copy2` with atomic SQLite backup snapshots and WAL checkpoint handling.
  - Unit tests covering all changes: `tests/test_audit_service.py`, updated `tests/test_auth_service.py`, updated `tests/test_backup_service.py`.
- **Out of Scope for Phase 6:**
  - Multi-PC network synchronization (deferred to future milestone).
  - UI visual overhauls (addressed in Phase 7).

---

## 3. Verification Criteria
1. `audit_logs` table is automatically created and populated whenever audit events are dispatched.
2. `AuditService.log_event()` persists actor, action, entity, entity_id, timestamp, and metadata.
3. `AuthService.ensure_default_admin()` no longer sets a known insecure password in production; `has_admin_user()` returns false if no admin exists, allowing the UI/system to trigger first-run setup.
4. `BackupService.restore_from_backup()` creates pre-restore safety snapshots via SQLite online backup API without depending on `shutil.copy2()`, safely handling WAL mode without journal corruption.
5. All automated tests in `tests/` pass cleanly.
