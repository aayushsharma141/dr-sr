---
phase: 04-a4-printing-backup
plan: 02
subsystem: backup-and-restore
tags: [sqlite, hot-backup, verified-restore, safety-rollback, backup-ui]

requires:
  - phase: 01-app-shell-dashboard
    provides: [Database connection factory, schema.sql]
  - phase: 02-patient-registration-search
    provides: [PatientRepository]
  - phase: 03-treatment-cases-payments
    provides: [TreatmentRepository, PaymentRepository]
provides:
  - "BackupService providing atomic hot SQLite backups (Connection.backup()) and verified restore pipeline"
  - "BackupView management UI with 1-click snapshot creation, integrity checks, and restore confirmation"
  - "MainWindow integration at index 4 with cross-module refresh triggers upon database restore"
  - "Automated unit test suite in tests/test_backup_service.py"
affects: [05-demo-hardening]

actuals:
  tasks: 3
  commits: 1

tech-stack:
  added: [sqlite3.backup, shutil]
  patterns: [Online hot database snapshotting, Pre-restore integrity gate, Safety rollback snapshot]

key-files:
  created:
    - app/services/backup_service.py
    - app/ui/views/backup_view.py
    - tests/test_backup_service.py
  modified:
    - app/ui/main_window.py

key-decisions:
  - "Hot backups use SQLite's native Connection.backup() to prevent database locks or corruption."
  - "Restoration follows a fail-safe 4-step pipeline: pre-verify -> safety snapshot -> copy -> post-verify."
  - "Corrupt backup files are halted before any stream copy, leaving live clinic data 100% intact."

requirements-completed:
  - BAK-01
  - BAK-02

coverage:
  - id: D1
    description: "Atomic hot SQLite backup creation"
    requirement: BAK-01
    verification:
      - kind: unit
        ref: "tests/test_backup_service.py#test_create_hot_backup_creates_valid_file"
        status: pass
  - id: D2
    description: "Pre-restore integrity verification and safe restore pipeline"
    requirement: BAK-02
    verification:
      - kind: unit
        ref: "tests/test_backup_service.py#test_restore_from_backup_restores_data"
        status: pass
---

# Plan 04-02 Summary: Hot Backup Engine & Verified Restore UI

Delivered the offline data protection engine and management interface:
1. **Hot Backup Service:** `BackupService` uses SQLite's native `Connection.backup()` to create non-blocking snapshots (`kalyan_backup_YYYYMMDD_HHMMSS.db`).
2. **Verified Restore Pipeline:** Enforces PRAGMA integrity checks and row count audits before stream copying. Automatically creates a safety rollback snapshot (`safety_pre_restore_*.bak`) before replacing live data.
3. **Backup Management UI:** `BackupView` gives reception and IT staff a clear dashboard showing database size, total backups stored, a 1-click snapshot button, and a guarded restore workflow.
4. **Automated Testing:** `tests/test_backup_service.py` validates atomic creation, record count parity with live data, corrupt file rejection, and zero data loss on simulated catastrophic deletions.
