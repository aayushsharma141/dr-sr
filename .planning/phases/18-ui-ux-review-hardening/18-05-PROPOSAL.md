# Plan 05 proposal (for review; NOT implemented)

Status: awaiting "go R1" (after the index.css diff is reviewed) and confirmation of the protected-file scope. No source edited.

## Measured state (read-only, 2026-11-03)
- `text-xs` uses (non-test): 338. At the current 14px root they render at 10.5px. About 95 of them sit inside the protected files.
- Explicit sub-12px text on screen, outside print-only files and outside protected files: 10 (TreatmentPlanWorkspace 5, BackupManagerPage 1, VasTrendChart 1, SessionLoggerModal 1, SessionAddendumModal 1, PatientTimeline 1).
- Explicit sub-12px text in PROTECTED files (untouched under R2): 44 (AppShell 21, AreaHome 16, PatientsDirectory 7).
- Print-only files (exempt from the 12px floor): RegistrationCard 7, ReceiptPrint 4, PrescriptionPrint 3, PrintLetterhead 2.
- Grey text 300/400 on screen, unprotected: 20 (AuditViewerPage 5, PatientDetail 4, DoctorDashboard 2, PatientTimeline 2, Users 1, TreatmentPlanWorkspace 1, PrescriptionWorkspace 1, PatientRegister 1, SessionLoggerModal 1, PhotoUploader 1).
- Semantic colour fails on white, unprotected: 2 (PatientTimeline 1, PrescriptionWorkspace 1).
- PaymentReversalModal: already clean (rewritten in Wave 2).

## Proposed changes if R1 is approved
1. `frontend/src/index.css` (other agent's file; ONLY these hunks): delete `font-size: 14px;` in `:root` (line ~20) and in `html` (lines ~187-189). Add no body font-size (`body` keeps `1rem`, which becomes 16px). Fix the stale comment near line ~226. Copy the removed lines verbatim into 18-DECISIONS.md.
2. Unprotected files, class swaps only:
   - `text-[8px..11px]` on screen -> `text-xs` (12px after R1). Affected: TreatmentPlanWorkspace, BackupManagerPage, VasTrendChart (SVG fontSize 9/10 -> 12), SessionLoggerModal, SessionAddendumModal, PatientTimeline.
   - grey 300/400 text -> `-600` (tinted surfaces) or `-500` on pure white: AuditViewerPage, PatientDetail, DoctorDashboard, PatientTimeline, Users, TreatmentPlanWorkspace, PrescriptionWorkspace, PatientRegister, SessionLoggerModal, PhotoUploader.
   - `text-red-500` -> `text-red-600`; `text-emerald-600` -> `text-emerald-700`; `text-amber-600` -> `text-amber-700`; `text-teal-600` -> `text-teal-700` (PatientTimeline, PrescriptionWorkspace).
3. Print-only files are NOT changed (approved SAMPLE layouts).
4. Guard: `src/test/guards/guards.test.ts` gains the legibility block (sub-12px, 300/400 grey, semantic fails) with a temporary allow-list for protected files only (AppShell 21 sub-12 + 9 grey-related counts as recorded; AreaHome 16; PatientsDirectory 7 + grey; PendingDuesPage 2; ui/dialog 1; ui/sheet 1) and an expiry test that fails when an allow-listed file is clean in git.

## Expected layout risks (R1)
- Body and input text grows from 14px to 16px (about 14%) on every page, including protected files R2 does not edit. Dense tables (PatientsDirectory, PendingDuesPage, AuditViewer, IntegrityDashboard), fixed-width sidebar labels (AppShell 240px), header and button rows may wrap, clip or overflow horizontally.
- Print: print layouts use mm and explicit classes, but any rem- or text-sm-based print text would change. The six Edge print checks must still pass (A4, one page).
- Tailwind `text-xs` becomes 12px (+1.5px) everywhere, which may widen badges and chips.
- Touch targets stay at 44px minimum (min-h classes unchanged).

## What R2 leaves unresolved (must be reported)
- Under R2 the 44 explicit sub-12px classes in AppShell, AreaHome and PatientsDirectory are NOT fixed. The app shell (sidebar and header) on every page keeps 8-11px text. Success criterion 4 ("all on-screen text at least 12px") is therefore NOT met for those files even with R1. R1 fixes the 338 `text-xs` uses only.
- The grey and semantic findings in those three files remain too.

## Readability checks beyond the mechanical threshold (proposed)
- Contrast of each replaced colour on its real background (contrast.mjs).
- Labels, form instructions, error messages (InlineAlert, ConflictBanner), table headers and cells on the patients, pending-dues and audit pages: screenshot review at 1366x768 and 1920x1080, before and after.
- Manual sheet entries M-18-06 (display scaling 100/125/150) and M-18-14 (layout regression at 16px).

## Decisions needed before implementation
1. Confirm `go R1` AND that the index.css diff was reviewed (it was shown earlier as `B1-other-agent-diff.txt`).
2. Confirm that editing only the root font-size hunk of index.css is acceptable under "no modifications to protected files" (or defer).
3. Accept that success criterion 4 stays unmet for AppShell, AreaHome and PatientsDirectory under R2, and record it as a known limitation with a follow-up after the other agent commits.

## Revision 2026-11-03: R1 DEFERRED, protected files untouched (client decision)
Proposed patch: `18-05-PROPOSED.patch` (generated from copies; no repo file edited). 11 files, 24 changed lines.
- Files: TreatmentPlanWorkspace, admin/BackupManagerPage, SessionLoggerModal, SessionAddendumModal, PatientTimeline, PatientDetail, DoctorDashboard, admin/Users, PrescriptionWorkspace, PatientRegister, PhotoUploader.
- Swaps: explicit sub-12px `text-[8-11px]` -> `text-sm` (9 lines); grey 300/400 -> `-600` (14 lines); semantic `red-500`->`red-600`, `emerald-600`->`emerald-700`, `amber-600`->`amber-700`, `teal-600`->`teal-700` (2 lines).
- EXCLUDED: admin/AuditViewerPage.tsx. Its lines around 204-240 sit on a dark panel (`bg-neutral-900` / `bg-neutral-950`) with light grey text. Swapping them to -600 would make them unreadable. Needs a decision: keep as-is with a documented surface exception, or re-style the panel.
- EXCLUDED: components/VasTrendChart.tsx (SVG `fontSize` 9/10). SVG units scale with the viewBox, so 12 needs a visual check first.
- Print-only files untouched (approved SAMPLE layouts).

## Correction to the earlier exception count
- Under the deferred root, `text-xs` renders at 10.5px wherever it is used. Outside print-only files, 235 uses sit in unprotected screens (AppointmentsReception 28, TreatmentPlanWorkspace 22, PrescriptionWorkspace 17, ClinicalEncounterWorkspace 17, PatientDetail 16, DoctorDashboard 16, AuditViewer 14, Users 13, BackupManager 13, PatientEditModal 12, AppointmentBookingModal 12, Doctors 7, and others). Protected files add 95 more.
- So "44 protected sub-12px classes" understates the gap. Total on-screen text below 12px with the root deferred: 235 + 95 + 44 explicit, minus what the patch fixes (9). Criterion 4 is NOT partially met in a narrow sense: the `text-xs` size is the dominant failure.

## Options for the remaining text-xs (not in the patch; needs a decision)
A. Leave `text-xs` at 10.5px and report criterion 4 as not met for those screens (the honest current state).
B. Isolated per-file swap `text-xs` -> `text-sm` (12.25px at the 14px root) in the 235 unprotected on-screen uses. No `index.css` edit; no protected-file edit. Layout impact: +17% on those labels; badges, table cells and chips may wrap. Needs the layout check and per-file review; a large mechanical change, so it needs its own approval.
C. R1 (global 16px root) later, as its own reviewed change (rejected for this plan by the client).

## Accessibility limitations to report with Plan 05
- Dark AuditViewer log panel: light grey text is intentional for contrast; the guard needs a surface exception.
- Protected sidebar and header (AppShell, AreaHome, PatientsDirectory): 44 explicit sub-12px classes stay.
- Under defer-root, every `text-xs` stays 10.5px (above).
- Print-only documents keep their small print type (exempt by design).
- Contrast of each replaced colour was not checked against the real surfaces yet (planned with contrast.mjs before any edit).
