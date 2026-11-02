# Clean Phase 18 branch: what differs from the earlier records

Branch `phase-18-clean`: main at `bfae6cc` + three earlier local commits (webcam capture, A4 registration card letterhead, prescription letterhead) + the Phase 18 commit + these planning records.

Left out on purpose (still on `phase-18-ui-ux-hardening`, not in this PR): the other agent's in-progress redesign (UI primitives, AppShell/AreaHome/PatientsDirectory/PendingDuesPage restyle, index.css tokens, package changes), the `.archify` documents, and the desktop print-toast/editor-settings change.

## Numbers in the other records that do NOT apply here
The validation and decision records of Plan 05 were measured on a tree that included the redesign's `index.css`, which set a 14px root font. This branch has no root font-size override, so the browser default 16px applies:
- `text-xs` renders at 12px, not 10.5px. The "330 text-xs uses at 10.5px" limitation and the 14px deferral do not apply to this branch. The guard has `ROOT_SIZE_DEFERRED = false`.
- The 82-violation allow-list (66 in the redesign files) is replaced by 40 violations in 10 files measured on this base: AppShell 12, AuditViewerPage 5, PatientDetail 5, VasTrendChart 4, PatientsDirectory 4, PendingDuesPage 4, AppointmentsReception 2, TreatmentPlanWorkspace 2, AdminNavTabs 1, BackupManagerPage 1. Most are main's own code that Phase 18 did not touch.
- The guard's expiry rule for the other agent's files was removed (those files are not on this branch). The ratchet remains.

## Needs a decision
- PatientDetail section labels (4 lines): on the redesign tree a heading colour rule overrode the grey class, so they were dropped from the approved 17-line patch as no-ops. On main there is no such rule: they render grey-400 at 2.59:1 on white. They were NOT changed here. Changing them to `text-neutral-600` is a 4-line class change.
- AppShell on main has 12 sub-12px classes (sidebar and header). Not changed here.

## Conflicts resolved when applying Phase 18 onto main
PatientTimeline (kept main's `visibleTimeline` and the darker text colour), PatientDetail (kept both the PatientTimeline and PaymentHistory imports; the PaymentHistory mount merged cleanly), patients-directory test (kept both the timeline and the payments mock routes).

## Gate on this branch (2026-11-03)
typecheck pass, lint pass, build pass, `npm test` 37 files / 158 passed / 5 skipped (Edge print tests, opt-in), six A4 Edge print checks 6 of 6. package.json and the lockfile are identical to main.
Still unverified: physical printers (waived by the client).
