# Full-Project UI/UX Pro Max Audit — Kalyan Hospital

**Audit date:** 2026-10-28  
**Repository:** `aayushsharma141/dr-sr`  
**Audit baseline:** `main` commit `81de9b26d18ea2dc4dd7b81734a462e9beeca6e1` (official hospital emblem/window-icon integration)  
**Review mode:** Source review of the native PySide6 application, existing design contract and tests; visual inspection of user-supplied A4 PDF page renders.  
**Important limitation:** A fresh runtime screenshot/interaction session of the live Windows desktop app was not available in this audit. Desktop-screen scores are provisional and must not be presented as a completed Windows visual acceptance test.

## Executive finding

**Release status: NOT READY FOR CLIENT HANDOVER until the release blockers below are closed.**

The application has a coherent offline-clinic goal, a usable green/white clinical palette, recognisable hospital identity, fast global patient lookup, a VAS control with both score and severity text, clear financial status labels, and backup/authentication workflows. These are real strengths.

The supplied registration PDF exposes a hard output defect: the form and signatures are on page 1, while the remaining hospital/date footer is stranded on an otherwise blank page 2. The source also inserts raw user-entered text into two A4 HTML templates. In addition, the active dependency file contradicts the recorded decision not to ship QFluentWidgets before commercial licence confirmation.

An audit branch contains a candidate fix for A4 pagination and HTML escaping, with regression tests. CI must pass before those fixes are considered verified.

## Provisional six-pillar score

Scores apply to the code and PDF evidence available for this audit, not a fresh, fully exercised Windows build.

| Pillar | Score | Evidence-based reason |
|---|---:|---|
| Copywriting & task clarity | 3/4 | Clear task labels, clinical fields, empty states and explicit payment statuses. Some recoverable errors still use blocking modal dialogs. |
| Visual system & assets | 2/4 | Strong hospital identity and good card/table hierarchy in code; the actual live application has not been captured in this review, and multiple widget/style systems coexist. |
| Color & state communication | 3/4 | Central green/white clinical palette and distinct success/warning/danger tokens; focus and selected states need consistent verification. |
| Typography & legibility | 3/4 | Segoe UI/Nirmala UI fallback exists. Some supporting labels and control hints are 9–10 px, which is small for a clinical workstation at scaling. |
| Spacing & output layout | 2/4 | Desktop layouts use a declared spacing system, but the delivered registration PDF demonstrably spills footer content to page 2. |
| Experience design & accessibility | 2/4 | Offline-first flow, Ctrl+K search, VAS labels and clear backup safeguards are positives. Keyboard focus, default form values, result limits and modal feedback still need work. |
| **Total** | **15/24 (62.5%)** | **Provisional code/PDF review; not a substitute for live Windows UAT.** |

The previous Phase 5 review scoring 21/24 is historical and should not be interpreted as current release sign-off: it predates the latest output evidence and the license-decision conflict.

## Critical and high-priority findings

### RELEASE BLOCKER — LIC-01: QFluentWidgets dependency conflicts with the recorded licence decision

**Evidence:** `requirements.txt` includes `PySide6-Fluent-Widgets>=1.11.0`; `DECISIONS.md` ADR-10 says not to add it unless a commercial licence is confirmed. The official QFluentWidgets site states the Python library is GPLv3 for non-commercial projects and that commercial use requires a commercial licence: [official licence page](https://qfluentwidgets.com/pages/about/) and [official FAQ](https://qfluentwidgets.com/pages/faq/).

**Risk:** The app is being delivered as paid custom software. A dependency decision that conflicts with the repository's own licensing record is a release/packaging blocker until a licence is confirmed or the dependency is replaced. This audit has no evidence that a commercial licence was purchased; it does not conclude that no licence exists.

**Action:** Record the licence holder, permitted distribution/use, and proof/reference in the project decision log. If there is no suitable commercial licence, migrate the QFluentWidgets components to permitted Qt/PySide6 components and remove the dependency and `--collect-all qfluentwidgets` packaging option. Do not solve this by silently changing the legal assumption.

### P1 — PDF-01: Registration output breaks across two A4 pages

**Evidence:** The user-supplied registration PDF render shows the complete record and signature labels on page 1, then only a hospital-location line and the dated application footer on page 2. Page 2 is mostly empty.

**User impact:** Wastes paper, makes an official record look unfinished, and may cause staff to discard or misfile a page.

**Audit-branch change:** Compressed vertical padding in the registration body while preserving the official letterhead, fields and dual signatures; added a headless `QTextDocument.pageCount()` regression test for one printable A4 page. This is a *candidate fix until CI passes and a Windows export is rechecked*.

### P1 — PDF-02: A4 templates do not escape user-entered text

**Evidence:** The registration and prescription builders interpolate patient demographics, condition/referral, case title and treatment notes into HTML. The thermal receipt builder already uses HTML escaping, but the two A4 templates did not do so in the audited baseline.

**Risk:** Ordinary text containing `<`, `>` or `&` can be interpreted as markup, silently changing or breaking clinical print output.

**Audit-branch change:** Added a shared HTML-escaping helper and applied it to dynamic patient/case/clinical fields in both A4 templates; replaced the emoji in the blank-photo placeholder with a text label; added regression tests for hostile/malformed markup examples. CI remains the acceptance gate.

### P1 — FORM-01: Patient age is pre-filled as 35

**Evidence:** `app/ui/views/patient_form_view.py` sets the required age field to 35 at initialisation and resets it to 35 after clearing the form. The service accepts ages from 0 to 125, so the form provides no indication that the default is not a verified value.

**Risk:** Reception staff can unintentionally save an incorrect age without touching the field. In a clinical record, this is more serious than a cosmetic form issue.

**Action:** Replace the unverified default with a visibly unselected state. Keep age 0 valid where clinically appropriate, and validate that the user made an intentional selection before saving.

### P1 — REG-01: The registry loads at most 500 records without paging

**Evidence:** `PatientListView.reload_patients()` passes `limit=500` to patient search. The visible status text describes the loaded result count but does not disclose that the result set is capped.

**Risk:** Once the registry grows beyond 500 matching records, older/less-recent records can be absent from the visible result list even when the query is valid.

**Action:** Add database-backed paging/incremental loading or an explicit result-limit message and a reliable route to older matches. Preserve search and filter state across pages.

### P1 — A11Y-01: Focus styling is not defined consistently for keyboard users

**Evidence:** `app/ui/styles.py` gives editable fields a focus border, but the shared button rules do not define a similarly prominent focus ring. The table stylesheet includes `outline: 0`. Ctrl+K is implemented, but that alone does not make all actions keyboard-discoverable.

**Risk:** Keyboard-only staff may lose track of focus, especially in dense tables, filter chips and custom action buttons.

**Action:** Define shared, high-contrast focus styling for buttons, filter chips, table views and their row actions; verify Tab/Shift+Tab order and that focus remains visible in selected, disabled and modal states on the target Windows theme.

## Medium-priority findings

### P2 — UX-01: Blocking message boxes remain in common workflow failures

Treatment and payment flows still use `QMessageBox` for several validation and recoverable errors, even though success feedback is non-blocking.

**Action:** Use inline field errors for invalid values and non-blocking toast feedback for recoverable save errors. Retain modal confirmation for destructive or high-consequence actions only; never hide a failure behind an auto-dismiss toast when staff need to act.

### P2 — UX-02: Small control typography and click targets need workstation validation

The VAS range labels and several supporting hints are 9–10 px; modality chips are 32 px high in the native control code. These can be difficult to read or hit on high-DPI displays or when the app is viewed from a reception position.

**Action:** Check Windows scaling at 100%, 125% and 150%; increase critical text and primary click targets where layout permits. Avoid shrinking labels to compensate for fixed-width layouts.

### P2 — VIS-01: Widget-style consistency needs an on-device pass

The UI combines global QSS with QFluentWidgets controls and some per-widget inline styles. This can create differences in focus, padding, disabled states and selected-state contrast between native and Fluent controls.

**Action:** Establish a component-level checklist and visually compare the same state (normal/hover/focus/pressed/disabled/error) for buttons, inputs, chips, badges and tables in the built Windows app.

### P2 — PRINT-01: Patient photo rendering needs aspect-ratio validation

The registration template requests a 35 mm × 45 mm photo and uses `object-fit: cover` in HTML. Qt's rich-text renderer does not provide the same CSS support as a browser for all image-layout properties.

**Action:** Export test photos in landscape, square and portrait source aspect ratios. Pre-crop/canvas-fit images to the passport ratio before embedding, so a person's face is not stretched, while preserving the required print dimensions.

### P2 — PRINT-02: Thermal receipt length is fixed

The thermal printer is configured with an 80 mm × 240 mm custom page, while condition, case title and reference text can vary in length.

**Action:** Test maximum realistic text lengths on the actual Windows printer driver; confirm that the final totals, current-balance footnote and receipt footer are printed and cut without an extra page or truncation.

### P2 — TEST-01: Physical printer behavior remains a manual acceptance requirement

The repository deliberately skips the native `QPrinter` PDF export test in headless CI due to the Windows print-spooler/COM limitation. The new document pagination test improves regression coverage but cannot prove the target printer's fonts, printable area, driver margins or paper-roll cutting.

**Action:** On the clinic workstation, run the current build, export both A4 document types to PDF, count pages, inspect Hindi glyphs and image proportions, and print one receipt on the target 80 mm printer. Save a blank/synthetic test output for acceptance evidence; do not commit real patient data.

## Strengths to preserve

- Fully offline application design and a clearly identified local database.
- Coherent trust-led green/white application palette with reserved clinical teal and semantic financial states.
- Authentic hospital identity and the original maroon prescription/registration letterhead.
- Persistent `Ctrl+K` patient/action launcher and visible offline status.
- VAS score uses a numeric value and explicit severity label, not color alone.
- Payment status labels are descriptive; the code avoids claiming `OVERDUE` without a stored due date.
- Local backup/restore has administrative guards and integrity checks; preserve these safety workflows during UI polish.

## Recommended execution order

1. **Resolve LIC-01** before commercial packaging.
2. Validate the audit-branch PDF and HTML-escaping fixes in CI, then run A4 export on Windows.
3. Remove the age default and add a form validation test that preserves valid age 0.
4. Add registry paging or make the 500-record cap explicit.
5. Implement consistent keyboard focus and verify the app at 100%/125%/150% scaling.
6. Replace modal feedback in recoverable error paths and unify the component states.
7. Complete the physical 80 mm receipt acceptance test.

## Evidence and limitations

- Code findings reference the repository's current application files and tests; links can be opened through the paths in this report.
- PDF findings are based on the user-supplied generated A4 page renders, not on patient-identifying values.
- No real patient name, mobile number, address, diagnosis or uploaded PDF has been copied into this report.
- No fresh interactive Windows desktop screenshot was captured during this remote audit. Treat the score as a provisional implementation audit until an operator completes target-workstation UAT.
- The audit branch includes fixes for PDF pagination and A4 HTML escaping; the PR and CI result determine whether those changes are accepted.
