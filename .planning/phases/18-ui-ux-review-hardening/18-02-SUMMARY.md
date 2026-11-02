# 18-02 summary: Wave 2

Requirements: UX-02 (shared native dialog for four overlays), UX-01 (print foundation: A4 receipt page, print dialogs scoped).

Done:
- `src/components/Modal.tsx`: one shared native `<dialog>` (showModal), with variants info/success/warning/error/destructive (visible label on each), Esc/backdrop/busy rules, print portal mounted only while open, scrolling body for long Hindi/English text.
- `src/test/dialog-shim.ts`: jsdom shim so modal behaviour is testable (imported per test file; shared setup.ts left alone per B-1 H1).
- `src/print.css` (new, imported from main.tsx): dialog overscroll rules; `@page receipt { size: A4; margin: 12mm }`; `html:has(dialog[open][data-print-page=receipt]) { page: receipt }`; `dialog.print-portal[open]` print overrides. `index.css` untouched.
- Migrated to Modal: PaymentModal (role=dialog and dark: classes removed), PaymentReversalModal (destructive, Esc blocked), PatientEditModal (409 conflict regression test, first field focused), PrescriptionPrint (print portal, A4).
- Tests: modal.test.tsx (15), payment-modal (Esc + focus return, validation alert), payment-reversal-modal (destructive blocks Esc), patient-edit-modal (new, 409 regression), prescription tests.
- Print evidence (headless Edge): receipt fixture prints 1 A4 page with the app page hidden; long fixture prints 2 A4 pages. Fixtures in `prototypes/print-check-wave2/`.

Gates: typecheck, lint, build clean; tests 33 files / 133 passing. See 18-VALIDATION.md, Wave 2.

Not done here (see VALIDATION for detail): root font-size (14px kept, 12px floor NOT met); other 14 overlays (plan 03); real receipt print check (plan 04); keyboard Tab/focus containment and screen-reader checks (manual, plan 08); Phase 17 "80mm thermal" text left in planning docs, needs a decision.

Not committed.
