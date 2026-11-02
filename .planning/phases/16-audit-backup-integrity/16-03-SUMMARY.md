# Phase 16 Plan 03 Summary: Verified Safe Restore Engine & Pre-Restore Snapshot

## What was built:
- Extended `backend/src/kalyan_api/services/backup_service.py`:
  - `restore_database_sql`:
    - Cleanly wipes and resets public schema.
    - Sets default and active privileges for application user (`kalyan_app`).
    - Executes SQL dump with owner credentials via `psql`.
    - Re-grants schema and table permissions after dump table re-creation.
  - `restore_backup`:
    - Strict fail-closed verification: verifies manifest checksums before touching database or disk.
    - Raises `BackupCorruptedError` on missing, modified, or tampered bundles.
    - Automatically takes a pre-restore safety snapshot (`kalyan_backup_YYYYMMDD_HHMMSS_prerestore.tar.gz`).
    - Extracts `db.sql` and patient photos.
    - Restores database schema and rows.
    - Synchronizes photo files into `settings.photos_dir`.
- Added unit and integration tests in `backend/tests/test_restore_service.py`:
  - Verified restore of clean database and patient photos.
  - Verified automatic pre-restore safety snapshot creation.
  - Verified rejection of corrupt archives without database mutation.
