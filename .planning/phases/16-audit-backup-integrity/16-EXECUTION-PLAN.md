# Phase 16 Execution Plan: 6 Implementation Plans

## Plan Breakdown

- **16-01-PLAN.md**: Permission Activation & Audit Log Viewer REST API (`AUD-02`)
  - Activate `AUDIT_READ`, unreserve from `RESERVED` mapping.
  - Create `AuditLogFilter` and `AuditLogOut` Pydantic schemas.
  - Implement `GET /api/audit-logs` in `backend/src/kalyan_api/routers/audit.py` with multi-parameter filtering, pagination, and redaction verification.
  - Test suite in `backend/tests/test_audit_api.py`.

- **16-02-PLAN.md**: Checksummed Backup Engine & Manifest Generator (`BAK-01`)
  - Create `backend/src/kalyan_api/services/backup_service.py`:
    - Database dump generation + Photo bundle packaging.
    - Manifest with SHA-256 computation for every file.
    - Corrupted archive detection via checksum validation.
    - Support destination directory on secondary drive.
  - Unit & concurrency tests in `backend/tests/test_backup_service.py`.

- **16-03-PLAN.md**: Verified Safe Restore Engine & Pre-Restore Snapshot (`BAK-02`)
  - Create restore engine in `backup_service.py`:
    - Checksum integrity validation before touching database.
    - Automatic pre-restore snapshot generation (`kalyan-prerestore-YYYYMMDD-HHMMSS.tar.gz`).
    - Database wipe & reload under owner credentials.
    - Photo file synchronization.
  - Unit and integration tests in `backend/tests/test_restore_service.py`.

- **16-04-PLAN.md**: Clinical & Financial Integrity Engine (`BAK-03`)
  - Create `backend/src/kalyan_api/services/integrity_service.py`:
    - Ledger vs agreed price check.
    - URN uniqueness and sequence check.
    - Sequential receipt check.
    - Session count synchronization check.
    - Orphan & missing photo check.
  - Endpoint `GET /api/integrity/check` and CLI subcommand `kalyan integrity check`.
  - Unit tests in `backend/tests/test_integrity_service.py`.

- **16-05-PLAN.md**: Backup & Operations CLI and REST Endpoints (`BAK-01`, `BAK-02`, `BAK-03`)
  - Endpoints in `backend/src/kalyan_api/routers/operations.py`:
    - `POST /api/operations/backup`: trigger manual backup bundle.
    - `GET /api/operations/backups`: list available backup archives.
    - `POST /api/operations/restore`: trigger verified restore with pre-snapshot.
    - `GET /api/operations/integrity`: run live integrity audit.
  - Extend CLI `kalyan_api/cli.py` with `backup-create`, `backup-restore`, `integrity-check`.
  - Tests in `backend/tests/test_operations_api.py` and `test_cli_operations.py`.

- **16-06-PLAN.md**: Frontend Audit Log Viewer, Backup Manager & Integrity Dashboard
  - Types and query hooks in `frontend/src/api/types.ts` and `queries.ts`.
  - Admin Audit Log Viewer (`AuditViewerPage.tsx`) with search, filter chips, diff view.
  - Backup & Disaster Recovery Dashboard (`BackupManagerPage.tsx`) with one-click backup and bundle status.
  - System Integrity Audit Report view (`IntegrityDashboard.tsx`).
  - Vitest test suites in `frontend/src/pages/__tests__/`.

- **16-07-PLAN.md**: Phase 16 Integration Gate & Quality Verification
  - End-to-end integration test `backend/tests/test_phase16_gate.py`.
  - RBAC matrix update for operations & audit routes.
  - Full backend pytest coverage verification ($\ge 85\%$).
  - Full frontend Vitest and build verification.
  - Legacy isolation check (`git diff --stat origin/main -- app tests DECISIONS.md` == 0).
  - Validation documents (`16-VALIDATION.md`, `16-MANUAL-CHECKS.md`, `16-SUMMARY.md`).
