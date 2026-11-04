# 18-03 summary: remaining overlays

Requirements: UX-02 (every pop-up is a native modal), UX-03 (banners inside modals announced).

Done:
- 14 overlays moved to the shared Modal: AppointmentBookingModal, SessionLoggerModal, SessionAddendumModal, Users (create, edit, confirm, temporary password), Doctors (doctor, fee), AppointmentsReception cancel reason, ClinicalEncounterWorkspace finalise, BackupManagerPage restore, TreatmentPlanWorkspace (cancel plan, new plan).
- No `fixed inset-0` or `role="dialog"` left outside tests and components/ui.
- Destructive confirmations focus the safe action (Cancel / Keep); the first field of each form is focused.
- Temporary password dialog: dismiss="none".
- Banners in SessionLogger and SessionAddendum: role=alert.
- Restore failure shown in the restore dialog as a persistent alert; page-level focus-return test for the restore dialog.

Gates: typecheck, lint, full suite green (see 18-VALIDATION.md, Wave 3).

Not done: page-level focus tests for every dialog (mechanism tested in modal.test.tsx); a page-level test for the temporary-password Escape block.

Not committed.
