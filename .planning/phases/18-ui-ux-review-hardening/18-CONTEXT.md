# Phase 18 Context: UI/UX Review Hardening

## Purpose
Fix every finding from the post-acceptance UI/UX and code review of the React frontend (reviewed 2026-11-02 against the committed tree plus the in-flight AppShell/AreaHome redesign). The user's instruction was "fix all". The v2.0 PySide6 desktop app is out of scope; this phase touches `frontend/` and, for the HTTPS item only, `deploy/` and docs.

## Scope & Requirements Covered
1. **UX-01 Receipts print from the app.** `frontend/src/components/ReceiptPrint.tsx` is never rendered (only its tests use it), although `PaymentModal.tsx` says "Collect & Issue Receipt" and the v3.0 plan requires printing and DUPLICATE reprints.
   - Wire the receipt into the payment flow (after a successful payment) and into payment history/patient detail for reprints with `isReprint`.
   - Replace the hardcoded hospital name, address and phone (`+91 94310 00000` is a placeholder) with `useClinicSettings()` values, falling back to the standard clinic text.
   - `frontend/src/index.css` currently sets `@page { size: A4; margin: 6mm }` for every print. Define named pages: A4 for the registration card and prescription slip, 80 mm wide (auto height, 3 mm margin) for the receipt, applied through the CSS `page` property on each document root.
   - Receipt prints through the same print-portal pattern already used by `PrescriptionPrint.tsx` so the app page behind it is not printed.
2. **UX-02 Shared native modal dialog.** Only `PaymentModal`, `PatientEditModal`, `PaymentReversalModal`, `pages/admin/Users.tsx` and `pages/Doctors.tsx` declare `role="dialog"`; none manage Esc, focus return or an inert background. `AppointmentBookingModal`, `SessionLoggerModal`, `SessionAddendumModal` and the `PrescriptionPrint` portal have no dialog semantics at all.
   - Build one shared `Modal` component on the native `<dialog>` element opened with `showModal()` (per modern-web-guidance guide `dialog`: do not add `role="dialog"`, `aria-modal`, a focus trap or an Esc handler; add `overscroll-behavior: contain` for `dialog:modal` and `dialog::backdrop`).
   - Migrate all modals to it, keeping every existing test passing.
   - jsdom may not implement `HTMLDialogElement.showModal()` or `close()`; the test strategy must handle that (a small test-setup shim) and must not weaken assertions.
3. **UX-03 No blocking alerts.** `pages/admin/BackupManagerPage.tsx:27` ("Backup failed: ...") and `pages/admin/Users.tsx:194` call `alert()`. Replace with persistent inline `role="alert"` messages (an existing banner pattern in the app can be reused); a failed backup must stay on screen until dismissed or retried.
4. **UX-04 Legibility.** On-screen text below 12px: `components/AppShell.tsx` (21 uses of `text-[8px..11px]`), `pages/AreaHome.tsx` (16), `PatientsDirectory.tsx` (7), `TreatmentPlanWorkspace.tsx` (5). Low-contrast `text-neutral-400`/`text-slate-400` on white appears in `PatientsDirectory`, `PaymentModal`, `PatientTimeline`, `admin/AuditViewerPage` and others (fails 4.5:1).
   - Raise on-screen text to a 12px minimum (14px body) and use at least `-500`/`-600` greys on white.
   - Add an automated guard (a Vitest test scanning `src/**/*.tsx`) that fails on `text-[<12px]` and on `text-(neutral|slate|gray)-(300|400)` for text, with an explicit allow-list for print-only components (`PrintLetterhead`, `RegistrationCard`, `PrescriptionPrint`, `ReceiptPrint`) where small print type is intentional.
5. **UX-05 Hindi language and offline font.** `frontend/index.html` has `lang="en"`; no element uses `lang="hi"`; no Devanagari font is bundled (it relies on whatever Windows provides). Mark Hindi runs `lang="hi"` and bundle a Devanagari web font (for example Noto Sans Devanagari) served from the build output, with no CDN request.
6. **UX-06 Form accessibility.** `PatientRegister.tsx` pairs 13 inputs with 13 labels (good). Filter and form inputs in `admin/AuditViewerPage.tsx`, `admin/BackupManagerPage.tsx` and `admin/Users.tsx` have no accessible name. Give every control an accessible name and announce validation errors only after interaction (guide `accessible-error-announcement`: `aria-invalid` and `aria-errormessage` synchronised with `:user-invalid`).
7. **UX-07 Webcam over HTTPS.** Browsers allow `getUserMedia` only on `localhost` or HTTPS; the server is `http://<LAN IP>:8000` (see `deploy/`), so `PhotoUploader.tsx` webcam capture (commit 73741d4) falls back to upload on LAN PCs. `DEPLOYMENT.md` lists HTTPS as "preferred", and the open decision is whether client PCs may trust a local certificate.
   - Record the decision with the client. If approved: certificate generation and trust steps, server TLS configuration in `deploy/`, and a LAN camera check. If not: keep upload-only and make the on-screen explanation clear.
8. **UX-08 Verification.** Typecheck, `oxlint`, the frontend suite (currently 92 tests across 26 files) and the backend suite stay green. Add a headless-browser print check (Microsoft Edge `--headless=new --print-to-pdf`, then page count) proving the registration card and prescription slip stay on one A4 page and the receipt page is 80 mm wide, plus a manual-check sheet (real printer, screen reader, display scaling 100/125/150%).

## Decisions (locked)
- Use native `<dialog>` (no new modal or focus-trap library). No new UI component library.
- Keep the approved SAMPLE.pdf letterhead and crimson `#9E1B42` for printed documents; do not change print layouts beyond the receipt wiring and named pages.
- Print documents keep their own small type; the 12px floor applies to on-screen UI only.
- No new network dependency at runtime. A font package may be added at build time only, and its files must ship in the built assets.
- The PySide6 desktop app is untouched.

## Coordination constraints
- At review time `frontend/src/components/AppShell.tsx`, `frontend/src/pages/AreaHome.tsx`, `frontend/package.json` and `package-lock.json` had uncommitted edits from another agent (shadcn-style redesign plan, `lucide-react` added). Phase 18 plans that touch those files must start by confirming they are committed (or merging with them), and must never revert them.
- Phase 18 adds files and changes only what each task names; no drive-by redesign.

## Canonical references
- `docs/plans/frontend-ui-plan.md` (frontend plan, partly out of date versus the real app)
- `frontend/src/components/PrintLetterhead.tsx`, `RegistrationCard.tsx`, `PrescriptionPrint.tsx` (print patterns, print portal, `body:has(.print-portal)` rule in `index.css`)
- `frontend/src/components/ReceiptPrint.tsx`, `PaymentModal.tsx`, `PaymentReversalModal.tsx`, `pages/PatientDetail.tsx`, `components/PatientTimeline.tsx`, `pages/PendingDuesPage.tsx`
- `frontend/src/api/queries.ts` (`useClinicSettings`, payment and receipt hooks), `frontend/src/api/types.ts` (`PaymentOut`, `ClinicSettingsOut`)
- `DEPLOYMENT.md`, `deploy/` (install, start-server, certificate work for UX-07)
- modern-web-guidance guides: `dialog`, `accessible-error-announcement`, `prevent-page-scroll-under-modal-dialog`, `respect-os-text-scale`

## Deferred (not in this phase)
- Replacing the removed decorative barcode with a real scannable barcode.
- Rewiring `RegistrationCard` to show the Patient In/Out, referral, condition, session and fee values (the patient record does not hold them; handwritten lines remain).
- Dark mode, additional languages, and any shadcn migration of the application shell.
- The unused `physiotherapy_header.jpg` and `.ico` assets in `frontend/public/assets` (owned by the other agent).
