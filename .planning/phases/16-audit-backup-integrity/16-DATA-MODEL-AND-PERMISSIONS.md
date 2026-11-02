# Phase 16: Architecture, Permissions & Invariants

## Permissions Activation
Unreserve and activate the 4 remaining reserved permissions:
- `Permission.AUDIT_READ` (`audit:read`) -> Assigned to `Role.ADMIN`.
- `Permission.BACKUP_RUN` (`backup:run`) -> Assigned to `Role.ADMIN`.
- `Permission.BACKUP_RESTORE` (`backup:restore`) -> Assigned to `Role.ADMIN`.
- `Permission.INTEGRITY_RUN` (`integrity:run`) -> Assigned to `Role.ADMIN`.
All other roles (`RECEPTION`, `DOCTOR`) default-deny (HTTP 403 Forbidden).

## Backup Bundle Structure (`.tar.gz` or directory structure)
Format: `kalyan-backup-YYYYMMDD-HHMMSS.tar.gz` containing:
```
manifest.json
database.dump (or database.sql)
photos/
  <photo_hash>.jpg
```

### `manifest.json` Specification:
```json
{
  "manifest_version": 1,
  "created_at": "2026-11-02T06:15:00Z",
  "app_version": "3.0.0",
  "database_name": "kalyan_prod",
  "files": [
    {
      "name": "database.sql",
      "size_bytes": 1048576,
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    },
    {
      "name": "photos/abc123.jpg",
      "size_bytes": 45000,
      "sha256": "3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b"
    }
  ],
  "totals": {
    "patients_count": 142,
    "payments_count": 310,
    "photos_count": 1
  }
}
```

## Integrity Check Results Specification (`IntegrityReportOut`):
```json
{
  "checked_at": "2026-11-02T06:20:00Z",
  "is_healthy": true,
  "checks": [
    {
      "check_name": "ledger_balance_reconciliation",
      "status": "PASS",
      "details": "All 45 active packages reconcile with payment ledger sums."
    },
    {
      "check_name": "urn_sequentiality",
      "status": "PASS",
      "details": "Zero duplicate URNs detected."
    },
    {
      "check_name": "receipt_sequentiality",
      "status": "PASS",
      "details": "Zero duplicate receipt numbers detected."
    },
    {
      "check_name": "session_progress_synchronization",
      "status": "PASS",
      "details": "All plan session counts equal logged treatment sessions."
    },
    {
      "check_name": "photo_file_integrity",
      "status": "PASS",
      "details": "Zero orphan photo files or missing patient photos."
    }
  ],
  "discrepancies": []
}
```
