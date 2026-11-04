# Backup Manager Redesign

**Branch:** `fix/backup-manager-full-redesign-2026-11-04`  
**Depends on:** `fix/admin-navigation-hierarchy-2026-11-04` (PR #15)  
**Status:** Frontend redesign and server-enforced restore confirmation implemented; automated checks not run in this environment.

## Implemented

### Archive workspace
- Replaced the long unfiltered archive table with client-side search, date range filters, archive-type filters and pagination (10, 25 or 50 rows).
- Added archive type labels for manual, scheduled, safety snapshot and test/diagnostic archives. Classification uses filename/label conventions and is a convenience filter, not a trusted server-side source of provenance.
- Added summary cards for latest archive, count of archives passing the latest server integrity check, and combined size of listed archives.
- Removed raw backup directory paths from the UI.
- Removed engineering requirement IDs from administrator-facing copy.
- Changed the per-row action to a neutral menu; restore is disabled for archives that fail integrity checks.
- Clarified that integrity status reflects the server check performed when the archive list is loaded.

### Manual backup
- Moved the manual backup form behind a clear action.
- Kept an optional descriptive label.
- Removed the arbitrary destination path input from this screen. The API still supports custom destinations, but the UI must not encourage staff to type unapproved server paths. Add approved destinations only after a server-side allowlist/configuration contract exists.

### Restore safety
- Added a confirmation dialog with the selected archive filename.
- Requires the exact phrase `RESTORE-DATABASE-OVERWRITE`.
- Requires a reason of at least 10 characters.
- Sends the confirmation phrase and reason to the backend.
- Backend schema now validates the phrase and reason; successful restore audit records include the reason in the audit log's dedicated `reason` field.
- Updated frontend and backend tests for the new contract.

## Important gaps / owner action

### Schedule & automation
The checked-in source reviewed for this branch does not contain the `BackupSchedulePanel.tsx` described in the supplied browser audit, and no schedule API endpoint or schedule response type was found. The UI therefore deliberately reports schedule status as **Not reported** and shows a clear unavailable state instead of inventing a frequency, retention policy or next run time.

To complete this tab:
1. Confirm the actual Windows Task Scheduler task and its enabled state on the hospital server.
2. Define an authenticated ADMIN API contract that reports schedule enabled state, cadence, next run, last result, retention policy and approved destinations.
3. Add audited endpoints for schedule changes and manual run-now actions if those controls are to be available in the UI.
4. Surface the actual task execution history and errors.
5. Do not display a green "Protected" status unless schedule execution and a recent valid archive are both evidenced by the server.

### Archive classification and cleanup
- Archive type is inferred from filename/label patterns. Confirm actual naming conventions before relying on the categories for retention or compliance.
- Test/diagnostic archives are visible under their own filter. No archive was deleted, moved or hidden from the default All view.
- Do not automatically prune `matrix_test`, `prerestore` or other files until each archive is classified, retention requirements are approved, and at least one independent verified recovery copy is retained.
- The current list endpoint returns all archive metadata. Pagination is client-side. If the archive volume grows substantially, add server-side filtering/pagination and avoid re-hashing every archive on every list request.

### Restore audit completeness
- Successful restore events now include the mandatory reason.
- A rejected request that fails schema validation is rejected before the restore handler executes and is not recorded by this handler. If failed/denied restore attempts must also be audited, implement a dedicated denial audit path or middleware with safe transaction handling.
- Verify that the existing audit event is committed to the restored database/session as intended after the restore operation; test the resulting audit record in a real database rehearsal.

## Files changed

- `frontend/src/pages/admin/BackupManagerPage.tsx`
- `frontend/src/api/types.ts`
- `frontend/src/pages/__tests__/backup-manager.test.tsx`
- `backend/src/kalyan_api/schemas/operations.py`
- `backend/src/kalyan_api/routers/operations.py`
- `backend/tests/test_operations_api.py`

## Verification required

Frontend, from `frontend/`:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

Backend, from `backend/` using the repository's documented test environment:

```bash
pytest tests/test_operations_api.py
ruff check src tests
mypy src
```

Also manually verify at a narrow laptop viewport and at 1366px/1920px widths, then rehearse restore against a disposable database. Do not test a destructive restore against live hospital data.
