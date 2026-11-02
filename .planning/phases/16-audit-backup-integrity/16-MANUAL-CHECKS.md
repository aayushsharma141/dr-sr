# Phase 16 Manual Verification Guide

## 1. Audit Log Viewer Verification
1. Sign in as Admin (`/login`).
2. Navigate to Admin Dashboard -> **Audit Log Viewer** (`/admin/audit`).
3. Verify recent actions (e.g. `USER_CREATED`, `PAYMENT_RECORDED`, `BACKUP_CREATED`).
4. Type in the filter boxes (e.g. action name, username) and verify immediate dynamic table updates.
5. Click **Inspect** on any row to open the raw Before/After state viewer. Confirm passwords or auth hashes are never visible.
6. Verify Reception and Doctor cannot access `/admin/audit` (redirected to `/403` or forbidden).

## 2. Backup Bundle Creation & Inspection
1. Navigate to **Backup & Recovery** (`/admin/backups`).
2. In "Create System Backup Bundle", enter an optional label (e.g. `manual_test`) and click **Trigger Backup Now**.
3. Verify the generated bundle appears in the Available Backup Archives table with a green `✓ Cryptographically Verified` badge.
4. Check that file size, creation timestamp, and manifest details match expectations.
5. On the server command line, test CLI command:
   ```bash
   python backend/src/kalyan_api/cli.py backup-verify <path_to_bundle.tar.gz>
   ```
   Confirm output displays `SUCCESS: Backup bundle is cryptographically verified and intact`.

## 3. Safe Restore Verification
1. On the `/admin/backups` page, find an existing backup archive and click **Restore System**.
2. Review the confirmation modal explaining the automatic pre-restore safety snapshot.
3. Click **Yes, Execute Safe Restore**.
4. Confirm successful restoration message and notice the pre-restore snapshot file generated on server disk.
5. Verify that database records and patient photos are consistent.

## 4. System Integrity Diagnostic
1. Navigate to **Integrity Diagnostic** (`/admin/integrity`).
2. Click **Run Integrity Diagnostic**.
3. Verify green "All System Invariants Intact & Verified" status banner.
4. Verify each of the 5 cards shows `PASSED`:
   - Financial Ledger & Package Invariants
   - Patient URN Uniqueness
   - Sequential Receipt Number Uniqueness
   - Treatment Session Progress Synchronization
   - Patient Photo Storage Consistency
5. On the server command line, run CLI inspection:
   ```bash
   python backend/src/kalyan_api/cli.py integrity-check
   ```
   Confirm exit code 0 and all checks reporting `[PASS]`.
