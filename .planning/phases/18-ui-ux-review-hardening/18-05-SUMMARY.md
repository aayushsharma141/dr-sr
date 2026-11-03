# 18-05 summary: text size and contrast — CLOSED, ACCESSIBILITY CRITERION 4 NOT MET

> NOTE (2026-11-03): the figures below (14px root, 330 text-xs uses at 10.5px, 82 violations, the other agent files) were measured on a working tree that had an uncommitted redesign. On the clean branch phase-18-clean the root font is the default 16px (text-xs renders at 12px) and the guard caps 36 existing violations in 10 files. See 18-CLEAN-BRANCH-NOTE.md. Criterion 4 is still NOT met there.

Requirements: UX-04 (on-screen text at least 12px and 4.5:1 contrast, guarded by an automated check).

Status: closed 2026-11-03 by the client. Closure means the approved work is implemented and tested. It does NOT mean criterion 4 passed.

## Current measurements on phase-18-clean (2026-11-03)

These are the figures that apply to the branch under review.
- Root font size is the browser default 16px, so text-xs renders at 12px. There is no 14px root on this branch.
- The legibility guard caps 36 existing violations in 10 files, mostly main's own code: AppShell 12, AuditViewerPage 5, VasTrendChart 4, PatientsDirectory 4, PendingDuesPage 4, AppointmentsReception 2, TreatmentPlanWorkspace 2, PatientDetail 1, AdminNavTabs 1, BackupManagerPage 1.
- The four PatientDetail section labels were fixed in a later commit (7.81:1 on white, 12px).
- Criterion 4 (all on-screen text at least 12px) is still NOT met: the remaining small text is main's own sidebar and header plus the held items.
- Gate: npm ci, typecheck, lint, build pass; 37 test files and 158 tests pass (5 skipped); six A4 Edge print checks 6 of 6.

## Done (verified) — HISTORICAL, measured on the redesign tree
- Approved patch applied: 17 changed lines in 9 files, class names only, CRLF/LF preserved. PatientTimeline 4, TreatmentPlanWorkspace 4, DoctorDashboard 2, PrescriptionWorkspace 2, and one line each in PhotoUploader, SessionAddendumModal, SessionLoggerModal, PatientRegister, admin/Users.
- Rendered validation before approval (Edge, synthetic data, 1366x768 and 1920x1080): nine screens, no overflow, no clipping, no new wrapping. Contrast measured from computed colours including opacity and disabled state: grey 300/400 text 2.37-2.58:1 to 7.17-7.81:1; divider 1.47 to 7.56; VAS labels 2.54 to 7.37; remove button enabled 3.81 to 4.77.
- Legibility guard written: `frontend/src/test/guards/guards.test.ts`, block `legibility guard (UX-04)`, 5 tests (scanner self-test, per-file caps, ratchet, expiry of the other agent's entries, text-xs ceiling). Mutation-tested on a scratch copy: each deliberate violation made the matching test fail.
- Gate: typecheck pass, lint pass, full suite 37 files and 155 tests passed (5 print tests skipped by default), six A4 Edge print checks 6 of 6.
- Protected files unchanged: index.css, AppShell, AreaHome, PatientsDirectory, PendingDuesPage, AuditViewerPage, VasTrendChart are byte-identical to before. Root font size 14px retained. No commits.

## Not met / conditions recorded with the closure — HISTORICAL, redesign-tree figures (14px root, 330 text-xs, 82 violations); see the current measurements above
1. Criterion 4 is UNMET. 330 on-screen `text-xs` uses (235 in unprotected screens, 95 in protected files) render at 10.5px under the 14px root. The guard only stops the count from growing (baseline 330) and requires the root-size deferral to stay recorded.
2. 82 existing violations in 11 files stay documented as per-file caps in the guard: other agent's files 66 (AppShell 23, AreaHome 20, PatientsDirectory 17, PendingDuesPage 4, ui/dialog 1, ui/sheet 1) and client-held items 16 (AuditViewerPage 5, VasTrendChart 4, PatientDetail 4, TreatmentPlanWorkspace 2, BackupManagerPage 1).
3. Three typography changes were rejected and stay excluded: TreatmentPlanWorkspace 543 and 572, BackupManagerPage 187.
4. AuditViewerPage (dark log panel) and VasTrendChart (SVG font sizes) remain outstanding review items.
5. Modal first-field focus remains an outstanding accessibility issue: SessionLoggerModal and SessionAddendumModal open with focus on Close, not the first field. Not fixed here.
6. Physical printer verification (plan 04) was waived by the client, not passed. Printer compatibility is unverified.
7. The guard's allow-list must shrink: other-agent entries expire when those files are committed (the expiry test then fails until they are removed), and every fixed violation must lower its cap (ratchet).
8. Disabled remove button in the prescription workspace renders at 2.56:1; disabled controls are exempt under WCAG 1.4.3.
9. Manual display-scaling check (M-18-06) not performed. M-18-14 does not apply (R1 deferred).

Not committed. Plan 06 not started and not authorized.
