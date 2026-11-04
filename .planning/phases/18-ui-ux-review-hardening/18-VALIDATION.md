# Phase 18 validation record

> NOTE (2026-11-03): the Wave 4 figures below (14px root, 330 text-xs uses at 10.5px, 82 violations, the other agent files) were measured on a working tree that had an uncommitted redesign. On the clean branch phase-18-clean the root font is the default 16px (text-xs renders at 12px) and the guard caps 36 existing violations in 10 files. See 18-CLEAN-BRANCH-NOTE.md. Criterion 4 is still NOT met there.

## Wave 1 (2026-11-02)

Plans: 18-01. Commands (from `D:\dr-sr\frontend`, PowerShell):
- `npm run typecheck` (tsc -b): exit 0
- `npm run lint` (oxlint): exit 0
- `npm test` (vitest run): exit 0. 31 test files, 112 tests passing. Baseline was 27 files / 98 tests; new files: queries-body, inline-alert, users-alerts, guards. Backup-manager gained 2 tests.
- Targeted: `npx vitest run` on queries-body, payment-modal, pending-dues, backup-manager, inline-alert, users-alerts, conflict-banner: all pass.
- Red-first check: queries-body test failed 4/5 before the fix (the 409 rejection test passed by design), green after.
- Static: no `alert(` in non-test source; no non-synthetic 10-digit numbers in new or edited tests.

Shared-file status (other agent): index.css, setup.ts, PendingDuesPage.tsx, pending-dues.test.tsx, AppShell.tsx, AreaHome.tsx, PatientsDirectory.tsx, vite.config.ts, package*.json unchanged by Wave 1. B-1 consent: all five hunks DECLINED (see 18-DECISIONS.md).

Unresolved issues:
- Restore failure is shown inside the confirmation dialog (`BackupManagerPage`), not via the shared Modal; plan 03 migrates that dialog.
- The `ClinicalEncounterWorkspace`, `PrescriptionWorkspace` and `TreatmentPlanWorkspace` banner roles were added by attribute only; the visible text is unchanged and the suites pass, but no screen-reader check has run (plan 08 manual sheet).
- Root font-size and sub-12px text are NOT addressed here (plan 05; root deferred).

## Wave 2 (2026-11-02)

Plans: 18-02, with the conditions from the user's Wave 2 authorization (A4 receipt, dialog variants, keyboard/focus tests, long-text layout, print evidence, no unrelated edits).

Commands (from `D:\dr-sr\frontend`, PowerShell):
- `npm run typecheck`: exit 0
- `npm run lint`: exit 0
- `npm test`: exit 0. 33 test files, 133 tests (Wave 1 was 31 / 112).
- `npm run build`: exit 0 (built CSS used for the print evidence below).
- Targeted: modal.test.tsx 15 tests, payment-modal 4, payment-reversal-modal 4, patient-edit-modal 3, prescription-print and prescription-workspace all pass.

Print evidence (headless Edge 156, `--print-to-pdf`, fixtures in `prototypes/print-check-wave2/`, synthetic data only):
- receipt.html (one receipt dialog, `data-print-page="receipt"`): 1 page, 209.9 x 297.0 mm (A4). Rendered page 1 checked as an image: the app page behind it is NOT printed; only the receipt prints.
- receipt-long.html (60 line items): 2 pages, both A4, page break works.
- LIMIT: these are hand-written fixtures that copy the Modal markup, not the real `ReceiptDialog`. The real receipt print is proven in plan 04 Task 4. No real printer was used; no printer compatibility is claimed.

What is verified by tests:
- Escape closes once through onClose and returns focus to the opener (payment-modal, modal).
- A destructive confirmation ignores Escape and backdrop; its Cancel/Keep action still works (modal, payment-reversal-modal).
- A 409 version conflict keeps the patient edit dialog open with the entered values (patient-edit-modal).
- A closed print dialog is not in the DOM (modal).
- Long English and Hindi content gets a scrolling body (class-level only, not visually checked).
- Variant label is visible text, not colour alone (modal).

NOT verified in this wave (manual or later plan):
- Tab / Shift+Tab cycling and the native focus containment: browser behaviour, not run in jsdom. Manual sheet entry needed (plan 08).
- Screen-reader announcement of dialog titles: manual (plan 08, NVDA).
- Click over an open Radix Sheet (PatientsDirectory): only the class `pointer-events-auto` is asserted. Real click = manual.
- Visual layout of long Hindi/English text inside the dialog: not screenshotted.
- Print of the migrated prescription slip itself: covered by the print check in plan 04 Task 4, not this wave.

Deviations from plan 02 as written (for the record):
- H2 declined, so print rules live in new `src/print.css` (imported from main.tsx). `index.css` untouched.
- Receipt page is A4 (user decision), not `80mm 200mm`. `@page receipt { size: A4; margin: 12mm }`. No 80mm rule remains in `print.css`.
- Modal falls back to the `open` attribute only when `showModal` is missing (old jsdom). This lets `pending-dues.test.tsx` (other agent's dirty file, H5 declined) keep passing without its edit. All supported browsers take the modal path.
- Header close button now calls onClose directly (not via cancel), so `dismiss="none"` dialogs still close from their X button while Escape and backdrop stay blocked.

Shared files: `index.css`, `test/setup.ts`, `PendingDuesPage.tsx`, `pending-dues.test.tsx`, `AppShell.tsx`, `PatientsDirectory.tsx`, `AreaHome.tsx` were NOT edited in this wave. Their diffs are the other agent's pre-existing edits (`git status` M before this wave). `main.tsx` got one import line (it was not dirty).

Unresolved issues:
- Root font-size 14px stays (deferred). The 12px minimum is NOT met: `text-xs` renders at 10.5px. Plan 05 owns this. Not claimed as achieved.
- Phase 17 documents still say "80mm thermal" (REQUIREMENTS PRN/BIL-04 history, ROADMAP Phase 17 notes, and the test title in `pages/__tests__/print-layouts.test.tsx`). The user's A4 decision supersedes them, but those records are not updated. Needs a decision before plan 04 changes the receipt.
- PatientEditModal / PaymentModal / PaymentReversalModal still contain text-slate-500/400 and other small text. Plan 05 (contrast/size) owns that.
- Other 14 overlays (incl. the backup restore dialog that shows restore errors) are migrated in plan 03, not here.
- `PrescriptionPrint` with no `onClose` has a header X that does nothing (noop). Callers pass onClose today; flagged, not changed.

## Wave 3 (2026-11-03)

Plans: 18-03 (complete) and 18-04 (Tasks 1-4 done; Task 5 BLOCKING and open).

Gate (from `D:\dr-sr\frontend`, PowerShell):
- `npm run typecheck`: exit 0
- `npm run lint`: exit 0
- `npm test` (default, print check skipped): exit 0. 37 test files, 150 passed, 5 skipped (the Edge print tests; opt-in).
- `PRINT_CHECK=1` / `REQUIRE_PRINT_CHECK=1` `npx vitest run src/print-check`: exit 0. 6 tests: registration card 1 A4 page; prescription slip 1 A4 page; receipt dialog 1 A4 page; a 120-line dialog paginates to 2+ pages; a closed print dialog mounts nothing (DOM check); the card still prints one page with a closed print dialog present.
- Static: no `fixed inset-0` or `role="dialog"` outside `__tests__` and `components/ui/` (0 left). No theme-dependent classes in the receipt files. No `94310` placeholder in source (one test asserts its absence).

Plan 03 (14 overlays on Modal): Booking, SessionLogger, SessionAddendum, Users x4 (create, edit, confirm, temporary password), Doctors x2, reception cancel reason, finalise confirmation, treatment cancel and new plan, backup restore. Destructive confirmations focus the safe action. Temporary password dialog: `dismiss="none"` (busy is not applicable: it is shown after the request is done). Backup restore failure is shown inside the dialog and persists after it closes (persistent alert from wave 1).
Gap: no page-level test for the Users temporary-password dialog's Escape block (mechanism covered by modal.test `dismiss="none"`). Page-level focus-return test added for backup restore only; the other pages use the same Modal and its tests.

Plan 04 status:
- Task 1 (printer decision): paper A4 recorded (18-DECISIONS.md, "Plan 04 Task 1"). Printer make and model NOT PROVIDED.
- Task 2: ReceiptPrint takes settings (header, address, phone; fallback text; no placeholder phone; no theme classes; Hindi `lang="hi"`); ReceiptDialog (named A4 receipt page, Print button focused, DUPLICATE title and solid stamp on reprint).
- Task 3: payment flow: PaymentModal dispatches `kalyan:payment-recorded` (fallback because PendingDuesPage edits were declined); ReceiptHost (mounted once in main.tsx) opens the receipt. PendingDuesPage and its test UNCHANGED (other agent's files). PaymentHistory card on PatientDetail (Admin and Reception only), Reprint with DUPLICATE COPY; reversed payments labelled, no reprint. The reversal UI is NOT mounted (out of Phase 18, BIL-05 gap). `useReceiptPageHeight` NOT created: content-fit does not apply to A4.
- Task 4: print check (see gate above).
- Task 5: REAL PRINTER CHECK NOT RUN. Items M-18-01..04 are PENDING in 18-MANUAL-CHECKS.md. 18-04-SUMMARY.md must NOT be written until they are PASS or FAIL with notes.

Deviations from plan 04 as written (for the record):
- UX-01 and plan 04 say 80 mm. The user chose A4 (2026-11-02). The receipt is A4 and the print-check asserts A4. REQUIREMENTS UX-01 text and the Phase 17 "80mm thermal" records are not yet updated.
- Print check is opt-in (`PRINT_CHECK=1`, or `REQUIRE_PRINT_CHECK=1` for the gate) so a plain `npm test` stays fast. One full-suite run with the browser check enabled made four unrelated tests time out at the 5 s default; the same four passed when run alone, so the timeouts came from CPU load.

Unresolved issues:
- Root font size 14px still deferred (12px minimum not met, plan 05).
- Real printer result missing (M-18-01..04).
- Phase 17 docs still say 80mm thermal.
- Plan 03 page-level focus tests for the other dialogs not written (component tests cover the mechanism).

## Wave 4, Plan 05 (2026-11-03) — IMPLEMENTED, AWAITING CLIENT REVIEW (plan NOT closed)

Applied: the exact 17-line patch (client approval, 2026-11-03). `patch -p1 --binary` dry-run then apply; no `.rej` or `.orig` files.
Files (9) and changed lines: PatientTimeline 4, PhotoUploader 1, SessionAddendumModal 1, SessionLoggerModal 1, DoctorDashboard 2, PatientRegister 1, PrescriptionWorkspace 2, TreatmentPlanWorkspace 4, admin/Users 1. Total 17. Class names only; CRLF/LF counts unchanged in every file; 0 non-class content changes.
Not applied by decision: PatientDetail (4 no-op lines), TreatmentPlanWorkspace 543 and 572, BackupManagerPage 187, AuditViewerPage, VasTrendChart.

Gate (from `D:\dr-sr\frontend`, PowerShell):
- `npm run typecheck`: exit 0
- `npm run lint`: exit 0
- `npm test` (default): exit 0. 37 files, 150 passed, 5 skipped (the Edge print tests, opt-in).
- `REQUIRE_PRINT_CHECK=1 npx vitest run src/print-check`: exit 0. 6 of 6 (card 1 A4 page, slip 1 A4 page, receipt 1 A4 page, tall dialog paginates, closed print dialog mounts nothing, card unaffected by a closed print dialog).

Scope verification (snapshot before vs after):
- `git status` set: only 4 files newly modified (PatientTimeline, PhotoUploader, DoctorDashboard, PatientRegister). The other 5 targets were already modified by earlier waves. Git diff vs HEAD for those 4: 8 insertions and 8 deletions, equal to the patch.
- SHA-256 identical before and after: index.css, AppShell, AreaHome, PatientsDirectory, AuditViewerPage, VasTrendChart, PendingDuesPage. PatientDetail untouched. package.json and lockfile status unchanged.

NOT done in this step (outside the approved patch):
- The automated legibility guard (plan 05 Task 3) and its temporary allow-list are NOT written. UX-04 has no regression guard yet.
- Layout-regression and display-scaling manual checks (M-18-06; M-18-14 only applies to R1, which was deferred).
- The modal first-field focus fix; the 235 + 95 `text-xs` uses; the 44 explicit sub-12px classes in protected files.

Unresolved (kept visible): criterion 4 NOT met; held typography items (TreatmentPlanWorkspace 543 and 572, BackupManagerPage 187); AuditViewerPage dark panel; VasTrendChart; disabled remove button 2.56:1 (WCAG-exempt); modal focus issue; printer compatibility unverified.

### Wave 4 addendum: UX-04 legibility guard written (2026-11-03, client approval) — plan still awaiting review
File: `frontend/src/test/guards/guards.test.ts` (new `legibility guard (UX-04)` block, 5 tests). No other source file changed; the 7 protected/held files are byte-identical; the 9 patched files still carry exactly the 17 approved lines.
Rules: no on-screen `text-[<12px]`, no `text-(neutral|slate|gray|zinc|stone)-(300|400)`, no `text-(red-500|emerald-600|amber-600|teal-600)`, no SVG `fontSize` below 12; print-only components exempt (PrintLetterhead, RegistrationCard, PrescriptionPrint, ReceiptPrint); `placeholder:` and `dark:` variants ignored.
Tests: (1) scanner self-test (flags and ignores the right things); (2) no file exceeds its documented cap (default 0); (3) ratchet: a fixed violation must lower its cap; (4) expiry: other-agent entries must be removed when their files are committed (skipped only if git is missing); (5) text-xs: the root-size deferral must be recorded, no new `text-xs` while it renders at 10.5px (baseline 330, may only go down).
Allow-list (82 violations in 11 files, all documented in the test): other agent (66): AppShell 23, AreaHome 20, PatientsDirectory 17, PendingDuesPage 4, ui/dialog 1, ui/sheet 1. Held by client (16): VasTrendChart 4, AuditViewerPage 5, BackupManagerPage 1, TreatmentPlanWorkspace 2, PatientDetail 4 (class overridden by index.css; renders 15.78:1).
Mutation check (scratch copy only): a new `text-[10px]` in Doctors, a new `text-neutral-400` in Modal, an extra `text-xs`, a fixed violation in PatientDetail, and a scratch git commit of the other agent's files each made the matching test FAIL with a clear message.
Gate: typecheck 0, lint 0, `npm test` 37 files / 155 passed / 5 skipped, six Edge print checks 6 of 6.
Not met: criterion 4 (all on-screen text at least 12px). The guard documents and ratchets it; it does not fix it.
