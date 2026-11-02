# Clean Phase 18 branch: what differs from the earlier records

Branch `phase-18-clean`: main at `bfae6cc` + three earlier local commits (webcam capture, A4 registration card letterhead, prescription letterhead) + the Phase 18 commit + these planning records.

Left out on purpose (still on `phase-18-ui-ux-hardening`, not in this PR): the other agent's in-progress redesign (UI primitives, AppShell/AreaHome/PatientsDirectory/PendingDuesPage restyle, index.css tokens, package changes), the `.archify` documents, and the desktop print-toast/editor-settings change.

## Numbers in the other records that do NOT apply here
The validation and decision records of Plan 05 were measured on a tree that included the redesign's `index.css`, which set a 14px root font. This branch has no root font-size override, so the browser default 16px applies:
- `text-xs` renders at 12px, not 10.5px. The "330 text-xs uses at 10.5px" limitation and the 14px deferral do not apply to this branch. The guard has `ROOT_SIZE_DEFERRED = false`.
- The 82-violation allow-list (66 in the redesign files) is replaced by 36 violations in 10 files measured on this base (after the PatientDetail fix): AppShell 12, AuditViewerPage 5, VasTrendChart 4, PatientDetail 1, PatientsDirectory 4, PendingDuesPage 4, AppointmentsReception 2, TreatmentPlanWorkspace 2, AdminNavTabs 1, BackupManagerPage 1. Most are main's own code that Phase 18 did not touch.
- The guard's expiry rule for the other agent's files was removed (those files are not on this branch). The ratchet remains.

## Decision made (client, 2026-11-03)
- PatientDetail section labels (4 lines): changed from `text-neutral-400` to `text-neutral-600`. On the redesign tree a heading rule had overridden the grey class, so they were dropped from the 17-line patch as no-ops. On main there is no such rule, so they rendered grey-400 at 2.59:1. Rendered on main after the change: #525252 on white, 7.81:1, 12px, no overflow or clipping (before value is the same neutral-400 colour measured earlier, 2.58:1; the before render was not repeated).
- AppShell on main has 12 sub-12px classes (sidebar and header). Not changed here.
- The guard cap for PatientDetail dropped from 5 to 1 (one 11px table header remains).

## Conflicts resolved when applying Phase 18 onto main
PatientTimeline (kept main's `visibleTimeline` and the darker text colour), PatientDetail (kept both the PatientTimeline and PaymentHistory imports; the PaymentHistory mount merged cleanly), patients-directory test (kept both the timeline and the payments mock routes).

## Gate on this branch (2026-11-03)
typecheck pass, lint pass, build pass, `npm test` 37 files / 158 passed / 5 skipped (Edge print tests, opt-in), six A4 Edge print checks 6 of 6. package.json and the lockfile are identical to main.
Still unverified: physical printers (waived by the client).
