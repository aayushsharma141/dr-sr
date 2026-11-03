# Phase 18 decisions

## B-1 consent (plan 01 Task 0a) — recorded 2026-11-02
Diff shown to the user: `B1-other-agent-diff.txt` (same folder). Git state at recording: M index.css, M PendingDuesPage.tsx, M pending-dues.test.tsx, M test/setup.ts.
- H1 `test/setup.ts` import line: DECLINED. Fallback: each non-dirty test that renders a Modal imports `dialog-shim`; vite.config.ts edit NOT allowed.
- H2 `index.css` print + dialog rules: DECLINED. Fallback: new `frontend/src/print.css` imported from `main.tsx`; old `body:has(.print-portal)` rule stays in index.css; Modal mounts print dialogs only while open.
- H3 `index.css` `:user-invalid` rule: DECLINED. Fallback: same `print.css`.
- H4 `PendingDuesPage.tsx` edits: DECLINED. Fallback: PaymentModal dispatches `kalyan:payment-recorded`; new `ReceiptHost` mounted in main.tsx or router.tsx.
- H5 `pending-dues.test.tsx` append: DECLINED. Fallback: new `pending-dues-receipt.test.tsx`.

## Other up-front answers (asked 2026-11-02)
- Root font-size (plan 05 Task 2): DEFER. 14px root stays; 12px floor NOT met; `text-xs` stays 10.5px. Report this in the summary.
- Dirty UI files AppShell.tsx, AreaHome.tsx, PatientsDirectory.tsx (plan 05): NO edits; keep on temporary allow-list (TODO(18)) until their work is committed.
- Receipt paper (plan 04 Task 1): A4 SHEET. Not yet finalized: the receipt page size and layout must be re-confirmed in plan 04 Task 1 for A4 (the earlier 80mm/200mm assumption is void).
- Previews (plan 07): canvas (user did not object; default kept). HTTPS (plan 07): upload-only (default kept).

## Plan 04 Task 1: receipt printer and paper (decision c) — recorded 2026-11-03
- Paper: A4 SHEET. Answered by the user on 2026-11-02 (Wave 2 authorization: "A4 is the approved paper format"). This OVERRIDES UX-01's wording "80 mm" and the earlier 80mm / 200mm assumptions. Requirement text in REQUIREMENTS.md and the Phase 17 "80mm thermal" sign-off are NOT edited here; the conflict is open (see Wave 2 record).
- Printer make and model: NOT PROVIDED. Required before Task 5 can pass.
- Page height: fixed A4 (297 mm). Content-fit (`useReceiptPageHeight`) NOT implemented, because it applies only to roll paper.
- DUPLICATE mark: solid bordered stamp, not opacity-only (applies on any printer).
- Status: UNFINALIZED until plan 04 Task 5 (real printer check) passes. The receipt page CSS keeps its UNAPPROVED marker until then.

## Plan 04 Task 5 (real printer check) — WAIVED BY CLIENT, recorded 2026-11-03
- Decision (client): skip physical printer verification. Task 5 is recorded as "Waived by client — not tested". It is NOT a pass.
- Printer make and model: not provided and not tested. Actual printer compatibility is UNVERIFIED. Printer-specific issues are outside current acceptance and may need later support.
- What still IS verified (automated, Edge 156 headless, `--print-to-pdf`, `REQUIRE_PRINT_CHECK=1 npx vitest run src/print-check`, 6 of 6 passing on 2026-11-03): registration card 1 A4 page; prescription slip 1 A4 page; receipt dialog 1 A4 page on the named receipt page; a 120-line dialog paginates to 2+ pages; a closed print dialog mounts nothing; the card still prints one page with a closed print dialog present.
- Plan 04 is CLOSED with this documented limitation.
- Not covered by any automated check: Hindi glyph rendering on printed output (plan 06 adds the bundled font and its checks), DUPLICATE legibility on paper, and real paper margins and cut.
- The UNAPPROVED marker is not present in `index.css` or `print.css` (checked 2026-11-03), so the receipt page CSS has no open approval marker.

## Requirement change: receipt paper (recorded separately; historical records NOT edited)
- UX-01 (REQUIREMENTS.md, Phase 18) and the Phase 18 ROADMAP success criterion 1 say "80 mm receipt". The client decided A4 on 2026-11-02.
- The Phase 17 sign-off (17-MANUAL-CHECKS.md, "80mm x Receipt or Roll Paper 80 x 297 mm") and the Phase 17 print-layouts test title ("renders 80mm thermal receipt") still describe 80 mm. These are historical records and were NOT modified.
- Current implemented behaviour: receipt on A4 (`@page receipt { size: A4; margin: 12mm }` in print.css). Status: requirement change ACCEPTED by client; historical text to be annotated in a later, separate step if the client asks.

## Plan 04 closure accepted; Plan 05 decisions (client, 2026-11-03)
- Plan 04: CLOSED. Printer waiver accepted with the limitation documented. Six Edge print checks remain mandatory (6 of 6 passing).
- R1 (root font-size): AUTHORIZED CONDITIONALLY. Requires (a) the full `git diff -- frontend/src/index.css` reviewed before any edit, (b) the layout-regression check, (c) no protected-file edits, (d) no reduction of existing functionality. Implementation has NOT started.
- R2 (protected files): AppShell.tsx, AreaHome.tsx and PatientsDirectory.tsx stay UNTOUCHED. Not on the authorized edit scope. The shared-file allow-list is not expanded for typography.
- Plan 05 implementation: NOT AUTHORIZED. Proposed changes and layout risks to be reviewed first (see 18-05-PROPOSAL.md).
- Open question for the client: R1 edits `frontend/src/index.css`, which is the other agent's uncommitted file (its root font-size lines only). Confirm that this single hunk is acceptable under "no modifications to protected files", or defer.

## Plan 05 — client decision 2026-11-03 (R1 deferred)
- R1 (global root font-size): DEFERRED. index.css is NOT edited. Not approved as a shared-file hunk.
- R2: AppShell.tsx, AreaHome.tsx, PatientsDirectory.tsx stay untouched.
- Criterion 4: NOT met (not "partially met" by default). Known exceptions recorded in 18-05-PROPOSAL.md: text-xs at 10.5px (235 uses outside protected and print files, plus 95 in protected files), 44 explicit sub-12px classes in protected files, AuditViewer dark panel (surface exception needed), VasTrendChart SVG sizes.
- Next step: approval of the isolated 11-file patch (18-05-PROPOSED.patch) and a decision on option A/B for the text-xs uses. Nothing edited in the repo.

## Plan 05 — Option A adopted; patch approval withheld (client, 2026-11-03)
- Option A: the 235 unprotected `text-xs` uses stay unchanged. Criterion 4 recorded as NOT MET.
- The 24-line proposed patch is NOT applied. Scratch-only: `D:\dr-sr\...\scratchpad\p05\18-05-PROPOSED.patch`. The planning-folder copy was removed.
- Contrast audit done against enclosing backgrounds (computed from the Tailwind v4 palette). All 14 grey and 2 semantic replacements reach at least 4.76:1 on their surface. Two lines are decorative separators (`|`) whose visual weight rises; one is inside a disabled control (opacity-30 by design).
- Layout review: 9 size changes. 4 are chips or badges in TreatmentPlanWorkspace (502, 521, 572) and BackupManagerPage (187); 2 are compact rows (TreatmentPlan 543 addendum header; SessionLogger 132 VAS scale labels); 1 caption (SessionAddendum 54); 1 unmounted (PatientTimeline 84). Needs screenshots before any approval.
- CRLF preserved in every file that would change; 0 non-class content changes.
- AuditViewerPage excluded (dark log panel). VasTrendChart manual review. Plan 06 not authorized.

## Plan 05 visual validation (temporary copies, 2026-11-03) — patch still NOT approved
- Method: patch applied to a temp copy only; before/after copies rendered with synthetic data (mocked API) and captured in Edge at 1366x768, 1920x1080 and a tall 1366x2200 (treatment plan). Screens: treatment plan workspace, session logger, session addendum, backup manager, patient detail. Repo unchanged.
- Result: 0 horizontal overflow, 0 clipped elements, 0 new wrapping in 11 captures. Elements under 12px: treatment plan 79->62, logger 22->16, addendum 5->4, backup 50->48.
- Regressions (minor): hierarchy inversion where a changed element now exceeds its unchanged neighbour (TreatmentPlan 572 status badge vs plan name; TreatmentPlan 543 addendum header vs note; BackupManager 187 label chip vs filename, plus table columns shift ~50px).
- Not covered: the other colour-only screens (Users, DoctorDashboard, PatientRegister, PhotoUploader, PrescriptionWorkspace), pixel-sampled contrast, real data, other browsers.
- Unrelated observation: SessionLogger and SessionAddendum modals open with focus on the Close button, not the first field.

## Plan 05 — revised patch and rendered validation (2026-11-03) — implementation NOT yet approved
- Client decision: the three oversized changes are REJECTED and removed (TreatmentPlanWorkspace 543 addendum header, TreatmentPlanWorkspace 572 status badges, BackupManagerPage 187 label chip). They stay at their original sizes.
- Final proposed patch (scratch only): `...\scratchpad\vis\final.patch`. 10 files, 21 changed lines, class names only, CRLF/LF preserved. Repo unchanged. index.css and the three protected files untouched.
- Rendered validation (Edge, synthetic data, 1366x768 and 1920x1080; treatment plan also 1366x2200): 9 screens (treatment plan, session logger, session addendum, patient detail, users, doctor dashboard, patient register in its "Checking..." state, photo uploader, prescription workspace with 1 and 2 rows). 0 horizontal overflow, 0 clipped, 0 new wrapping.
- Rendered contrast (computed colours incl. ancestor backgrounds and opacity; enabled and disabled states): grey 300/400 text 2.37-2.58:1 -> 7.17-7.81:1; divider `|` 1.47 -> 7.56; VAS labels 2.54 -> 7.37; remove button enabled 3.81 -> 4.77; remove button DISABLED 2.10 -> 2.56 (still below 4.5; disabled controls are exempt under WCAG 1.4.3).
- Finding: the four PatientDetail section labels (h4) render #1a2332 (15.78:1) both before and after. The base `h1-h6 { color }` rule in the other agent's index.css overrides the utility class, so changing `text-neutral-400` there has NO visible effect. The labels already pass. The 4 lines matter only for source-level consistency (the class-based guard).
- Harness note: a first run measured the wrong elements (probes matched the injected script, treatment plan captured before its sessions loaded). Both were fixed and the data above is from the corrected run.

## Outstanding accessibility item (recorded separately, NOT part of the typography patch)
- SessionLoggerModal and SessionAddendumModal open with keyboard focus on the Close button instead of the first form field. Wave 3 did not add `data-autofocus` to their first fields. Separate fix, needs its own approval.

## Known-issues register (Phase 18)
- Criterion 4 (all on-screen text >= 12px) NOT met: 235 `text-xs` uses in unprotected screens (10.5px at the 14px root), 95 more in protected files, 44 explicit sub-12px classes in protected files (AppShell 21, AreaHome 16, PatientsDirectory 7).
- Held typography items: TreatmentPlanWorkspace 543 and 572, BackupManagerPage 187 (rejected for visual hierarchy), AuditViewerPage dark panel (surface exception), VasTrendChart SVG sizes (manual review).
- Disabled-control contrast (prescription remove button 2.56:1) is below 4.5 by design and WCAG-exempt.
- Printer compatibility unverified (client waiver). Modal first-field focus (above).

## Plan 05 implementation authorization (client, 2026-11-03)
- Approved: the 17 effective lines only; the four no-op PatientDetail lines removed. Applied and tested (see 18-VALIDATION.md, Wave 4).
- This is authorization to implement and test, NOT acceptance of Plan 05 closure. Closure waits for the client's review of the actual repository diff and results.
- Open for a separate decision: whether to write the UX-04 legibility guard with a temporary allow-list for the protected files.

## Plan 05 legibility guard (client approval, 2026-11-03)
- Written and passing. Allow-list entries are per-file caps with reasons, not free passes; they expire (other agent's files) or ratchet down (held items). See the guard file header and 18-VALIDATION.md.
- Plan 05 is still NOT closed: awaiting the client's review of the repository diff and results.

## Plan 05 CLOSED (client, 2026-11-03)
- Closure authorized: the approved 17-line patch, the legibility guard (5 tests) and validation are sufficient. Closure does NOT mean accessibility criterion 4 passed.
- Recorded conditions: criterion 4 unmet (330 on-screen text-xs uses at 10.5px); 82 violations in 11 files controlled by per-file caps; three rejected typography changes excluded; AuditViewerPage and VasTrendChart outstanding; modal first-field focus outstanding; physical printer verification WAIVED, not passed; the guard allow-list must shrink as the other agent's files are committed and violations are fixed.
- Root font stays 14px. Protected files unchanged. Nothing committed. Plan 06 not started and not authorized; it needs its own review and authorization.
