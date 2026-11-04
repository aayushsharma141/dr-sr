# Kalyan Hospital — Admin Panel expansion: gap report

> Superseded in part by `docs/admin-panel-p0-evidence.md`, which covers the P0 sprint: editable security policy, backup scheduling and retention, the reversal screen, and the test isolation fix.

Status date: 2026-11-04. Branch `chore/repo-audit-hardening`. Changes are **uncommitted** in the working tree.

## Verification status

| Check | Result |
|---|---|
| Backend `pytest backend/tests` | Green (one environment skip: `KALYAN_FRONTEND_DIST` not set) |
| Backend `ruff check` / `ruff format --check` | Green |
| Frontend `vitest run` | 44 files, 228 passed, 5 skipped (existing headless Edge print checks) |
| Frontend `tsc --noEmit` | Clean |
| Frontend `npm run lint` | Clean |
| Frontend `npm run build` | Succeeds |
| Security review of backend diff | Done; see "Security review outcome". The planned clinical/financial invariants review did not run. |
| Screenshots | **Not produced.** Requires running the app against PostgreSQL and a browser pass. |
| Real-printer test for any print change | **Not done.** No print layout was changed in this pass. |

The implementing agents reported the behaviour below and the suites above are green. The feature list is "built and tested", not "independently reviewed line by line".

## Implemented in this pass

- **02 User & Authority:** read-only role/permission matrix (`GET /api/roles/permissions`, page `/admin/roles`). Last login, lock-until and password-change timestamps. Optional reason on deactivate, reactivate, reset and unlock. Sign-out-everywhere. Per-user sign-in history. The DOCTOR role option is no longer offered when editing non-doctor accounts.
- **09 Security & Access:** active-session list and per-session revoke (own session refused). Read-only effective security policy (`GET /api/security/policy`, values come from environment and are not editable). Password-length bounds endpoint readable during a forced change. Lockout message now uses the configured minutes.
- **10 Audit:** `GET /api/audit-logs/actions` for the filter dropdown. Filters for dates, entity, outcome and DENIED. Reason and user-agent shown. Field-level before/after diff. Receipt reprints now audited. Settings audit covers every mutated field.
- **03 / 04 / 06 Config and billing:** receipt-cycle change requires explicit confirmation and reason when receipts exist. Fee catalogue shows and reactivates inactive fees and uses optimistic locking (`version_id`, migration 0006). URN and receipt business periods now use IST, which fixes a 00:00–05:30 IST boundary bug.
- **01 Dashboard:** overview extended with registrations, appointments, doctor queues, collections (gross and reversals reported separately), dues, locked accounts, failed logins, recent admin actions, last backup, integrity status, storage, and factual alerts only.
- **11 Backup:** archive names are validated (path traversal closed). Manual backups may only target `backup_dir` or a drive listed by the operator in `KALYAN_BACKUP_DESTINATIONS`; network shares are refused. Pre-restore safety backup is always taken. Restore needs the typed phrase `RESTORE` and a reason of at least 10 characters. Failed backups and restores are audited. Per-archive verify endpoint. URN gap check reported as a warning.
- **12 System:** `GET /api/system/status` (app version, schema revision versus code head, PostgreSQL version, database size, connections, clocks, uptime, storage). `deploy/health-check.ps1` now reads the `db` key the API actually returns.
- **Navigation:** single admin module registry (`frontend/src/admin/modules.ts`) driving a grouped sub-navigation (Hospital / System Administration). Shell labels now match the registry; "Users & Permissions" is now "Users & Authority".
- **Frontend fixes in this session:** stale test mocks updated, restore dialog test now follows the phrase-and-reason flow, the stale legibility-guard exemption for `AuditViewerPage` was removed, and the restore dialog again closes on Esc (it had been made non-dismissable earlier, which broke the UX-03 contract).

## Not implemented (decision-free but deferred)

- Runtime editing of security policy (idle timeout, lockout, password rules). Values are locked or default decisions; editing needs approved bounds and an audit rule.
- Separate security administrator role. Conflicts with the fixed three-role decision (SEC-03).
- Admin-side access review workflow and cadence.
- Restore with maintenance mode (no way yet to block other workstations during restore).
- Scheduled backups and retention. BAK-01 is still unmet.
- Audit of patient-record reads, CSV export, and print or export events.
- Appointment and physiotherapy configuration screens. Shown as "fixed by requirement" in the registry.

## Pending client decisions (do not assume)

1. Confirm the D-01..D-08 entry-gate decisions and update `DECISIONS.md` OD-01..OD-12. Currently project-owner defaults, not client-confirmed.
2. Receipt number format: the code emits `RCP-YYYY-YYYY-XXXX`; the requirement records `RCPT-2627-XXXX`. Also confirm financial year or calendar year.
3. Idle timeout, lockout threshold and duration, absolute session length (EG-19 defaults), and whether admins may change them at runtime and within what bounds.
4. Backup schedule, retention, and the approved secondary drive(s).
5. Whether restore should require password re-entry and whether maintenance mode is needed.
6. Doctor registration number on prescriptions. The printed letterhead still hard-codes two doctors (`PrintLetterhead.tsx`) and is not linked to the doctors table.
7. Consultation validity window: is a free revisit enforced, and for how many days (the stored default of 7 comes from research, not a client decision).
8. Working hours, holidays, token caps and booking-validation rules: block or warn?
9. Branches: are Ara and Garhani two addresses only, or separate branches?
10. Treatment categories, modality catalogue, plan templates (RPT-03 is v2), VAS scale.
11. Printer make and model. The waived physical print check is still open.
12. Audit retention period and whether append-only without a hash chain is acceptable.
13. Which admin actions need typed confirmation or a mandatory reason beyond restore.
14. Whether v2-deferred dashboard items (RPT-02..RPT-05) are pulled into this scope. That is a re-scope and re-price.

## Known defects not fixed

- Print headers and footers that the admin edits are not printed on every document.
- Receipt-cycle dropdown text was corrected in the UI, but the backend format mismatch (decision 2 above) remains.
- Restore replaces the whole database schema, so audit rows written after the backup point are lost from the live database. The pre-restore snapshot keeps them.
- Failed backups have no persisted run record. The dashboard's "last successful backup" uses manifests and the audit log.

## Security review outcome

The review covered session revocation, backup and restore, secret leakage and route policy markers. Nothing real was found in session revocation or route markers. Archive path traversal, the mandatory snapshot and server-side restore confirmation all held up.

Fixed:

- **Unrestricted backup destination.** An admin could write the full dump to any directory, including the served web folder or a network share. Now limited to approved locations.
- **Patient data in error text.** `psql` errors can quote patient rows, and they reached the audit row and the HTTP response. Both now carry only the exception type or a generic message; detail goes to the server log.
- **False restore failure.** Restoring a backup older than the acting admin's account broke the success audit's foreign key, so a completed restore returned 500 with no audit row. The row is now written with the username kept and the user id cleared.
- **Read locks during restore.** The request transaction now ends before `psql` runs.

The lock fix is covered only by an ordering test and a helper unit test. The API tests stub the commit because they run inside a savepoint, so it has not been shown against real concurrent locks on PostgreSQL 18. A real restore rehearsal should confirm it.

Accepted, not changed:

- Listing and verifying backups use `backup:run`. Only Admin holds it, so there is no separate read permission.
- A login that lands during "sign out everywhere" can survive it, because the user row is not locked. Very narrow on a 3–5 user LAN.

## Remaining work before this can be called complete

- Real restore rehearsal on the target PostgreSQL version, with other workstations connected.
- Clinical/financial invariants review of the diff (IST dates, migration 0006, overview money math).
- Set `KALYAN_BACKUP_DESTINATIONS` on the server once the second drive is decided; until then the optional custom destination only accepts folders inside `backup_dir`.
- Screenshots and a manual browser pass in the real app.
- Real-printer check if any print surface is touched later.
- Client decisions above.
- Commit only when asked.
