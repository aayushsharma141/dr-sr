# Phase 9 Specification: Local Security & Verified Disaster Recovery

## 1. Objective
Harden user access control with named roles (`ADMIN`, `RECEPTIONIST`, `DOCTOR`) and implement unified disaster recovery bundling the SQLite database and all patient photos into a verifiable, atomic archive.

---

## 2. Requirements & Traceability
- **SEC-01 (Role-Based Access Control):**
  - Named user roles: `ADMIN`, `RECEPTIONIST`, `DOCTOR`.
  - Service-level role validation helpers (`can_manage_backups`, `can_modify_clinical_sessions`, `can_manage_users`).
  - Audited user creation and credential updates.
- **BAK-01 & BAK-02 (Unified Disaster Recovery):**
  - Atomic hot backup of the SQLite database using SQLite Online Backup API.
  - Bundling of `data/photos/` alongside `kalyan.db` into a unified `.kalyan_bak` package.
  - Verification of database integrity, canonical table presence, and photo bundle completeness prior to restoration.
  - Pre-restore rollback snapshot preserving both active database and photos, with automated rollback on verification failure.
- **AUD-01:** Comprehensive audit logging for all administrative, backup, and restore operations.

---

## 3. Scope Boundaries
- **In Scope:**
  - `AuthService` user management: support `DOCTOR` role, user creation, and role checking.
  - `BackupService` unified archive support (`.kalyan_bak` zip package bundling `kalyan.db` + `photos/` + `manifest.json`).
  - Path traversal protection during photo extraction.
  - Automated tests in `tests/test_backup_service.py` and `tests/test_auth_service.py`.
- **Out of Scope:**
  - Multi-PC network synchronization.
  - Cloud database replication.

---

## 4. Verification Criteria
1. `AuthService.create_user()` supports `DOCTOR` role and rejects invalid roles.
2. `BackupService.create_backup()` creates a unified package containing the database and patient photos.
3. `BackupService.restore_from_backup()` successfully restores both the SQLite database and patient photos.
4. If a backup is corrupt or incomplete, restore aborts without modifying active data.
5. All automated unit and integration tests pass cleanly.

