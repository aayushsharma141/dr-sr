# Phase 16 Context: Audit Viewer, Backup/Restore & Integrity

## Purpose
Phase 16 delivers operational resilience, administrative accountability, disaster recovery verification, and database health auditing for the Kalyan Hospital Centralized LAN Management Web Platform.

## Scope & Requirements Covered
1. **`AUD-02`**: Audit Log Viewer & Filter:
   - Admin-only access (`Permission.AUDIT_READ`).
   - Filter by actor user, action type, entity type, entity ID, date range, and outcome.
   - Expandable structured before/after diffs (redacted passwords/tokens preserved).
   - Export filtered audit logs as JSON/CSV.
2. **`BAK-01`**: Atomic Checksummed Backup Bundles:
   - Comprehensive package containing:
     - PostgreSQL database dump (via `pg_dump` custom/tar format or SQL dump).
     - Patient photograph directory (`var/photos`).
     - JSON manifest recording timestamps, application version, file list, and SHA-256 checksums.
   - CLI command `kalyan backup create [--destination <path>]` and Admin Web UI trigger (`Permission.BACKUP_RUN`).
   - Automatic secondary drive destination support (`KALYAN_BACKUP_DIR`).
   - Corrupted bundle detection via SHA-256 verification.
3. **`BAK-02`**: Verified Safe Restore:
   - Automatic pre-restore snapshot of the active database before any restoration commences.
   - Unpacking, checksum verification, database restoration, and photo file synchronization into target environment.
   - CLI command `kalyan backup restore <bundle_path> [--force]` and Admin Web UI workflow (`Permission.BACKUP_RESTORE`).
4. **`BAK-03`**: Clinical & Financial Integrity Audit:
   - Verification engine inspecting system-wide invariants:
     - Balance vs ledger: `agreed_price_paise - sum(payments)` matches dynamic pending dues.
     - Sequential URN consistency: zero duplicate or gap URNs without audit explanations.
     - Sequential receipt consistency: zero duplicate receipt numbers or sequence cycle gaps.
     - Session count reconciliation: plan `completed_sessions` matches `COUNT(treatment_sessions)`.
     - Orphan photo detection: disk files without database patient records, or records pointing to missing files.
   - CLI command `kalyan integrity check` and Admin Web UI report (`Permission.INTEGRITY_RUN`).
