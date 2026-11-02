# Phase 16 Plan 02 Summary: Checksummed Backup Engine & Manifest Generator

## What was built:
- Added `backup_dir` setting to `backend/src/kalyan_api/config.py` defaulting to `backend/var/backups`.
- Added Phase 16 audit action catalog entries in `backend/src/kalyan_api/services/audit_service.py` (`BACKUP_CREATED`, `BACKUP_RESTORED`, `INTEGRITY_CHECK_RUN`).
- Built core backup engine in `backend/src/kalyan_api/services/backup_service.py`:
  - `dump_database`: Runs `pg_dump` with owner credentials, targeting clean SQL export.
  - `compute_sha256`: Streamed cryptographic SHA-256 calculation.
  - `create_backup`:
    - Bundles `db.sql` database dump.
    - Copies patient photo files from `settings.photos_dir` to `photos/`.
    - Generates `manifest.json` detailing bundle metadata, file counts, and SHA-256 digests.
    - Packages as `.tar.gz` archive with timestamp and custom label.
    - Supports custom destination directory (e.g. secondary drive/network share).
  - `verify_backup_bundle`:
    - Inspects archive contents without extraction.
    - Verifies manifest presence and checks `db.sql` SHA-256.
    - Verifies presence and SHA-256 of all declared photos.
    - Detects corrupted or tampered files.
- Added comprehensive unit tests in `backend/tests/test_backup_service.py`:
  - Verified archive bundle creation and manifest validity.
  - Verified tamper detection when data in `db.sql` is altered.
