# Phase 16 Summary: Audit Viewer, Backup/Restore & Integrity

## Executive Summary
Phase 16 delivers complete enterprise-grade operational resilience, immutable accountability, and system self-auditing to the Kalyan Hospital Centralized LAN Management Web Platform. Administrators now possess full observability over system state transitions, automated tamper-evident backup creation, fail-closed restoration guarantees with automatic pre-restore snapshots, and a 5-pillar clinical/financial integrity engine.

---

## Deliverables Completed

### 1. Audit Log Viewer (`AUD-02`)
- **Backend**:
  - `GET /api/audit-logs` endpoint with multi-dimensional filtering (`actor_username`, `action`, `entity_type`, `entity_id`, `outcome`, `date_from`, `date_to`) and pagination (`page`, `page_size`, `total`, `pages`).
  - Sensitive parameter redaction guards; prevents leakage of passwords, temporary keys, or secret tokens.
  - Immutability enforced at the PostgreSQL trigger level; blocks `UPDATE`, `DELETE`, `TRUNCATE`.
  - Restricted strictly to `Role.ADMIN` (`Permission.AUDIT_READ`).
- **Frontend**:
  - `AuditViewerPage.tsx` at `/admin/audit`.
  - Interactive filter toolbar, chronological tabular view, outcome badges, pagination controls, and expandable JSON Before/After payload inspection.

### 2. Checksummed Backup Engine & Manifest Generator (`BAK-01`)
- **Backend**:
  - `backend/src/kalyan_api/services/backup_service.py`:
    - `dump_database`: Runs `pg_dump` CLI with owner credentials.
    - Copies patient photo files from `settings.photos_dir`.
    - Generates `manifest.json` detailing bundle metadata, file sizes, and cryptographic SHA-256 hashes.
    - Packages bundles into `.tar.gz` archives with timestamp and custom label.
    - Supports secondary drive destinations (e.g. external HDD, USB, network shared drive).
    - `verify_backup_bundle`: Inspects archive contents without extraction; detects single-bit tampering or corruption.

### 3. Verified Safe Restore Engine & Pre-Restore Snapshot (`BAK-02`)
- **Backend**:
  - `restore_backup`:
    - Fail-closed verification: inspects archive checksums before touching any database or disk files; aborts immediately on corrupted archives.
    - Automatically captures a pre-restore backup snapshot (`kalyan_backup_YYYYMMDD_HHMMSS_prerestore.tar.gz`) before resetting schema.
    - Drops and recreates public schema, applies SQL dump, re-grants table privileges to `kalyan_app`, and synchronizes photo files.

### 4. Clinical & Financial Integrity Diagnostic (`BAK-03`)
- **Backend**:
  - `backend/src/kalyan_api/services/integrity_service.py`:
    1. **Financial Ledger & Package Invariants**: Asserts agreed prices > 0, total payments <= agreed price, balance calculations exact.
    2. **Patient URN Uniqueness**: Checks for zero duplicate URNs across all patients.
    3. **Sequential Receipt Number Uniqueness**: Asserts zero duplicate receipt numbers.
    4. **Treatment Session Progress Synchronization**: Verifies `completed_sessions` on plans matches count of finalised session records.
    5. **Patient Photo Storage Consistency**: Checks disk file presence for all registered photos and identifies orphan images.

### 5. Web Dashboards & CLI Tooling
- **REST Endpoints**:
  - `POST /api/operations/backups`, `GET /api/operations/backups` (`Permission.BACKUP_RUN`)
  - `POST /api/operations/restore` (`Permission.BACKUP_RESTORE`)
  - `GET /api/operations/integrity` (`Permission.INTEGRITY_RUN`)
- **CLI Commands**:
  - `kalyan backup-create [--destination <path>] [--label <label>]`
  - `kalyan backup-restore <archive> [--force]`
  - `kalyan backup-verify <archive>`
  - `kalyan integrity-check`
- **Frontend Pages**:
  - `BackupManagerPage.tsx` at `/admin/backups`.
  - `IntegrityDashboard.tsx` at `/admin/integrity`.
  - Navigation links wired in `AreaHome.tsx` Admin Dashboard.

---

## Verification & Quality Metrics
- **Backend Pytest**: 591 passed, 1 skipped (dist environment variable).
- **Backend Coverage**: 92.80% (exceeds 85% requirement threshold).
- **RBAC Matrix**: 339 cells verified covering 100% of registered endpoints.
- **Frontend Vitest**: 23 test files, 75 tests passing.
- **Frontend Build**: Zero TypeScript errors; clean production bundle.
- **Legacy v2.0 Drift**: Zero diffs in `app/`, legacy `tests/`, and `DECISIONS.md`.
