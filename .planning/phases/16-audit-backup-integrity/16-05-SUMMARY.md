# Phase 16 Plan 05 Summary: Backup & Operations CLI and REST Endpoints

## What was built:
- Defined Pydantic operations schemas in `backend/src/kalyan_api/schemas/operations.py`:
  - `BackupCreateRequest`, `BackupArchiveInfo`, `BackupArchiveListResponse`
  - `RestoreRequest`, `RestoreResultOut`
  - `IntegrityCheckItemOut`, `IntegrityReportOut`
- Built administrative operations router in `backend/src/kalyan_api/routers/operations.py`:
  - `POST /api/operations/backups`: Creates checksummed backup bundle on demand (`BACKUP_RUN`, Admin only).
  - `GET /api/operations/backups`: Discovers, inspects, and lists backup bundles on disk (`BACKUP_RUN`, Admin only).
  - `POST /api/operations/restore`: Verifies bundle, captures pre-restore snapshot, wipes/restores DB & photos (`BACKUP_RESTORE`, Admin only).
  - `GET /api/operations/integrity`: Runs diagnostic audit across ledger, URNs, receipts, session progress, photos (`INTEGRITY_RUN`, Admin only).
  - Wired router into `backend/src/kalyan_api/main.py`.
- Extended CLI administration tool in `backend/src/kalyan_api/cli.py`:
  - `backup-create`: Creates full `.tar.gz` bundle with optional label and destination.
  - `backup-restore`: Restores system from bundle with pre-flight verification and automatic pre-snapshot.
  - `backup-verify`: Cryptographically verifies archive integrity against manifest.
  - `integrity-check`: Runs 5-pillar clinical, financial, and photo integrity diagnostic.
- Added comprehensive test suites:
  - `backend/tests/test_operations_api.py`: Tested RBAC restrictions (401 unauthenticated, 403 Reception/Doctor, 200/201 Admin lifecycle).
  - `backend/tests/test_cli_operations.py`: Tested full CLI command lifecycle (integrity-check, backup-create, backup-verify, backup-restore).
