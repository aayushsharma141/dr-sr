# 18-01 summary: Wave 1

Requirements: UX-03 (no blocking alert, persistent announced messages), UX-01 prerequisite (request bodies).

Done:
- Fixed the double `JSON.stringify` in `useRecordPayment`, `useReversePayment`, `useCreateBackup`, `useRestoreBackup` (`frontend/src/api/queries.ts`). Regression test through the real `apiFetch`: `frontend/src/api/__tests__/queries-body.test.ts`. Red before, green after.
- New `InlineAlert` component (role=alert for errors, role=status otherwise, labelled dismiss button) with tests.
- Removed both `alert()` calls: `BackupManagerPage` (create failure now a persistent alert; restore failure inside the confirmation dialog) and `Users` (unlock failures now shown, including non-API errors which were silently swallowed).
- Added roles to banners in `ClinicalEncounterWorkspace`, `PrescriptionWorkspace`, `TreatmentPlanWorkspace`, `IntegrityDashboard`.
- Guard `frontend/src/test/guards/guards.test.ts`: no `alert`/`confirm`/`prompt` (also `window.` and `globalThis.`), passing on the tree.
- Prototypes and SHA-256 provenance copied to `.planning/phases/18-ui-ux-review-hardening/prototypes/` (no key or certificate material).

Gates: typecheck, lint, full suite (31 files / 112 tests) all green. See 18-VALIDATION.md, Wave 1.

Not done: none of Task 0a's hunks were edited (declined). Other agent's files untouched.

Not committed.
