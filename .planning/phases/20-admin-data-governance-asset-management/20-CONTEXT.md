# Phase 20: Admin Data Governance & Asset Management - Context

**Gathered:** 2026-11-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Admin can run the hospital's data and identity work without a developer:

- correct patient demographics with a reason and an audit trail;
- import patients from CSV or XLSX through the 8-stage staging pipeline (upload, inspect, map, validate, resolve, preview, commit, reconcile);
- export patients as CSV or XLSX, permission-checked, field-selective and audited;
- manage the hospital logo and other assets, with version history;
- edit bilingual print templates per document type;
- use all existing admin pages through a reorganized sidebar with five sections.

Existing admin pages are kept and moved, never removed. Duplicate merge, bulk archive, bulk delete and LAN workstation monitoring stay in Phase 21, which overrides the "Bulk archive: Yes" row in `.planning/notes/admin-data-governance-architecture.md`. Counter catalogue and consolidated checkout (REC-05 to REC-08) are not part of this phase.

</domain>

<decisions>
## Implementation Decisions

Decisions are numbered `D-20-xx` so they don't clash with the project-level D-01 to D-08 or with D-19-xx.

### Permissions
- **D-20-01:** Add three Admin-only entries to the existing permission catalogue in `backend/src/kalyan_api/core/permissions.py`: `patient:correct`, `patient:import` and `patient:export`. The RBAC system itself is unchanged. This adjusts the roadmap's "no new permissions" wording, which assumed Admin already had patient write; it does not. Admin does not get `patient:update`, so reception's edit route stays closed to Admin. Logo, asset and print-template endpoints use the existing `settings:write`. Update the role-matrix snapshot tests to match.

### Demographic correction
- **D-20-02:** Admin correction is a separate route, `PATCH /api/admin/patients/{id}/demographics`. It requires a reason, shows a before/after preview, uses the `version_id` check (D-08), and records an audit event marked as a correction in the same transaction. Reception's existing patient edit is unchanged.
- **D-20-03:** Admin can correct every demographic field except the URN: full name, guardian name, gender, DOB and age, mobile, address, district, state and emergency contact. Allergies and notes stay with their existing routes. Clinical records are never edited; they keep append-only addenda.
- **D-20-04:** The correction page has its own server-side patient search. Admin's sidebar does not link to reception's patient directory.

### Patient details on printouts
- **D-20-05:** Every issued printout (receipt, prescription, consultation summary) identifies the patient by name, URN, mobile and address. — **Reversibility:** costly — changes the layouts of three print components, which must still fit their page sizes.
- **D-20-06:** Each issued document stores the patient's name, URN, mobile and address at issue, and a reprint shows those stored values, not the current record. Reprints stay available and are still marked DUPLICATE (BIL-04 unchanged). The registration card is a live ID card and always shows current details. — **Reversibility:** one-way — adds columns to `payments` (which has a tamper-prevention trigger) and to the Phase 19 prescription and encounter records; once documents rely on stored values, removing them changes printed history.
- **D-20-07:** The migration fills these stored details for all existing receipts, prescriptions and consultation summaries from current patient values, before any Admin correction can run. The migration has to work within the payments tamper-prevention trigger in `0005_billing_receipts_and_reversals.py`.

### Import rules
- **D-20-08:** The import source isn't known yet: there's no confirmed paper-register or v2.0 data. Build for the documented standard template and assume messy data. Importing from the v2.0 SQLite database (FUT-03) stays out of scope.
- **D-20-09:** Every imported patient gets a new URN from the normal gap-free `KH-YYYY-XXXX` sequence. Any old number in the file is kept in a new, separate, searchable field, so patient search can find it. Existing KH- numbers in a file are never reused as URNs. — **Reversibility:** costly — adds a patients column and changes patient search.
- **D-20-10:** A row missing a required field (guardian name, gender, age, mobile or address) can't be imported until Admin fixes it in the wizard or re-uploads. No placeholder values are invented. Such a row doesn't block the rest of the batch.
- **D-20-11:** Commit imports the valid, resolved rows. Failed or unresolved rows are listed in the reconcile report and kept for later. URNs are allocated only for rows that actually commit, so a failed row never leaves a URN gap.
- **D-20-12:** Commit first runs an automatic safety backup through the existing backup service, and it won't proceed if that backup fails. There is no batch undo; a wrong batch is fixed by restoring the backup or correcting patients one at a time. Deleting imported patients is never allowed.
- **D-20-13:** Duplicate candidates are flagged by matching mobile and address, plus name similarity and any URN found in the file. For each flagged row Admin chooses Skip or Import as new. An import never overwrites or updates an existing patient, which overrides the "updates" wording in the governance note's Preview stage.
- **D-20-14:** Each batch is recorded with its ID, filename, operator, timestamp, column mapping, validation results and commit status (from the roadmap).

### Export limits
- **D-20-15:** Clinical content can be exported, with a reason. **This reverses D-04 / EG-7** (Admin has no clinical-content permission), which is LOCKED with the trust administrator as owner. The user decided on 2026-11-07 to treat it as approved now. No written agreement from the doctors or the trust administrator was seen in the repo, so this is recorded as the user's decision, not as their sign-off. The change covers the export path only: Admin screens stay denied clinical content. Plan work must record the change in `.planning/phases/11-decisions-gate-foundation-auth/11-ENTRY-GATE.md` (EG-7) and in the Key Decisions table in `.planning/PROJECT.md`. — **Reversibility:** one-way — patient data exported to files can't be recalled.
- **D-20-16:** Exportable clinical content means everything clinical: encounters, full notes and addenda, specialty assessments, vitals, diagnoses, prescriptions, treatment plans and session records. Clinical fields start unticked; Admin ticks them on.
- **D-20-17:** Clinical export has no extra safeguards: one reason field and the standard export audit event, recording actor, reason, scope, selected fields and row count. The user chose this over a separate audit event and a longer reason.
- **D-20-18:** Allergies and notes on the patient record are offered as export fields, unticked by default.
- **D-20-19:** Exporting by department means patients with an appointment in that department within the chosen date range. A patient can appear under more than one department.
- **D-20-20:** The export file goes straight to the browser and isn't stored on the server. The audit event is the only lasting record.

### Sidebar sections
- **D-20-21:** The Overview dashboard is a single link at the top, followed by five sections:
  1. **Hospital Configuration:** clinic settings, logo and assets, print templates, doctors and fees.
  2. **Patient & Data Management:** record correction, import centre, export centre.
  3. **Billing & Finance:** billing and reversals, pending dues.
  4. **Users, Security & Governance:** users, roles, security and sessions, audit.
  5. **System & Maintenance:** backups, integrity, system health.

  This overrides the governance note, which counts Management Overview as section 1 and puts billing reversals under governance. All existing routes, including `/admin/roles`, keep working.
- **D-20-22:** Remove the placeholder links that only lead back to `/admin` (Hospital Performance, Department Analytics, Resource Utilization). Reports come back when they're actually built.
- **D-20-23:** Plan 20-02 builds on the uncommitted sidebar and admin-home changes on `refactor/admin-modules-ssot` (`AppShell.tsx`, `AreaHome.tsx`, `routers/areas.py`, `app-shell.test.tsx`). Those changes must be committed before 20-02 starts, and the user commits only when they ask. Keep `frontend/src/admin/modules.ts` as the single registry for admin pages.

### Claude's Discretion
- **Logo and reprint history (not discussed; Claude's default):** each issued document records the logo asset and print-template version it was printed with, and a reprint uses those. An asset or template version referenced by an issued document is never deleted. Uploads are validated by magic bytes, size and dimensions, following `photo_service.py`. Hospital photographs are stored and versioned but don't appear on printouts. Logo files are stored outside the web root, so the login page and printouts need a read endpoint for the current logo.
- **Print template scope (not discussed; Claude's default):** Admin edits the bilingual header and footer text per document type. The SAMPLE.pdf letterhead layout and its hardcoded doctor block in `PrintLetterhead.tsx` stay as they are. Document types are `prescription`, `receipt`, `registration_card` and `consultation_summary` (Phase 19's summary is the fourth type). Existing `print_header_*` and `print_footer_*` values are copied into each type's first template version. Whether the old settings columns are dropped is decided in planning.
- **Backups must cover new files:** backup bundles and restore must include the logo and asset directory, not just patient photos, and the integrity report should check for orphaned asset files.
- **Import mechanics:** file size and row limits, CSV encoding detection (Excel saves Hindi text in different encodings), the XLSX library (it must be installable offline, for example `openpyxl` from a bundled wheel), how long staging rows and uploaded files are kept, and whether failed rows can be downloaded as a file to fix.
- **Export mechanics:** stream large exports, neutralise spreadsheet formulas (cell values starting with `=`, `+`, `-` or `@`), and choose the field-picker layout.
- Server-side search and pagination, confirmation dialogs, and the 422-to-field error mapping, following the governance note's standards table.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope
- `.planning/ROADMAP.md` §"Phase 20: Admin Data Governance & Asset Management": goal, plans 20-01 to 20-08, endpoint names.
- `.planning/notes/admin-data-governance-architecture.md`: section contents, the 8-stage import pipeline, standards for every admin page. Untracked in git. Where it conflicts with D-20-01 (permissions), D-20-13 (no updates), D-20-21 (sections) or the Phase 21 deferrals, this CONTEXT.md wins.
- `.planning/REQUIREMENTS.md`: SET-01, BIL-04, BAK-01, BAK-03, AUD-01 and AUD-02, and FUT-03. The traceability rows mapping REC-05 to REC-08 to "Phase 18 / Phase 20" need correcting, because that work is not in Phase 20.

### Locked decisions this phase touches
- `.planning/phases/11-decisions-gate-foundation-auth/11-ENTRY-GATE.md`: EG-7 / D-04 (reversed for export by D-20-15, still to be recorded) and EG-11 / D-08 (optimistic concurrency).
- `.planning/PROJECT.md` §"Key Decisions": D-04 needs updating for the export change.
- `.planning/phases/19-universal-consultation-workspace/19-CONTEXT.md`: prescription status model and printed summary (D-19-15, D-19-28 to D-19-31), which D-20-06 extends with stored patient details.
- `.planning/phases/18-ui-ux-review-hardening/18-DECISIONS.md`: A4 receipt decision. Plan 18-06 (bundled Devanagari font) isn't implemented, which affects previews of Hindi templates.

### Admin navigation history
- `docs/ADMIN-NAVIGATION-REMEDIATION.md`: earlier unification of the sidebar and the module registry.
- `frontend/src/admin/modules.ts`: canonical registry of admin modules.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `backend/src/kalyan_api/services/photo_service.py`: magic-byte and size validation with UUID filenames outside the web root; the pattern for logo and asset uploads.
- `backend/src/kalyan_api/services/urn_service.py`: gap-free URN allocation, called once per committed import row.
- `backend/src/kalyan_api/services/backup_service.py`: the safety backup before commit; needs the asset directory added to bundles.
- `backend/src/kalyan_api/services/audit_service.py` and `audit_service.record` with `build_audit_context`: audit events written in the same transaction.
- `backend/src/kalyan_api/routers/patients.py` `update_patient_demographics`: the before/after audit and `require_version` pattern to copy for Admin correction.
- `backend/src/kalyan_api/routers/settings.py`: settings with `_SETTINGS_AUDIT_FIELDS` and a version check; the base for the asset and template endpoints.
- `frontend/src/components/PrintLetterhead.tsx`, `ReceiptPrint.tsx`, `RegistrationCard.tsx`, `PrescriptionPrint.tsx`, `ConsultationSummaryPrint.tsx`: the print components the templates and stored details feed.

### Established Patterns
- Every route declares `Depends(require(Permission.X))`, and a test enumerates the routes, so new routes need catalogue entries (D-20-01).
- Optimistic locking through `version_id`, with a 409 that the frontend's ConflictBanner handles.
- Alembic migrations live in `backend/src/kalyan_api/migrations/versions/`; the latest is `0014_follow_up_recommendations.py`. Backup and restore re-grant table rights per migration, so new tables must be added there.
- `payments` has the tamper-prevention trigger `trg_prevent_payment_tampering`.
- Today only `print_footer_*` is used (receipt and registration card); `print_header_*` isn't used by any printout.

### Integration Points
- `frontend/src/components/AppShell.tsx` (nav item list with `sectionStart`, and `renderAdminSidebar`) and `frontend/src/router.tsx` (admin routes).
- `backend/src/kalyan_api/core/permissions.py`: `ROLE_PERMISSIONS[Role.ADMIN]`.
- `Patient` model in `backend/src/kalyan_api/models.py`: add the old-number field; `allergies` and `notes` sit on the same table.
- `Department` and `Appointment.department_id`: used for export by department.

### Test hazard
- Run backend tests with `PYTHONPATH=D:/dr-sr/backend/src` and temp folders for `KALYAN_PHOTOS_DIR` and `KALYAN_BACKUP_DIR` (plus any new asset directory), and never on the hospital server.

</code_context>

<specifics>
## Specific Ideas

- Patients are identified by URN, mobile and address, both on printouts and when import flags duplicates.
- Reprints never show corrected details: a reprint shows what the document showed when it was issued.
- Printouts stay on the approved SAMPLE.pdf letterhead, one A4 page, with static Hindi labels.

</specifics>

<deferred>
## Deferred Ideas

- Duplicate patient merge, bulk archive, bulk delete, extended data-edit permissions and LAN workstation monitoring: Phase 21.
- Real reports and analytics to replace the removed placeholder links: future phase.
- Importing from the v2.0 SQLite database (FUT-03): only if real v2.0 data turns out to exist.
- Adding the eye doctor to the letterhead's doctor block: needs the eye doctor's details (pending todo) and a letterhead design decision.
- Admin editor for clinical templates (DWF-01): stays deferred.

### Reviewed Todos (not folded)
- **Implement Hospital Counter Product Catalogue and Consolidated Checkout Billing UI** (REC-05 to REC-08): kept separate as a billing feature of its own; the REQUIREMENTS.md mapping needs correcting.
- **Get sign-off on doctor access change and collect eye doctor details:** matched on keywords only; still blocks DWS-04, not this phase.
- **Merge PR #17 and PR #12 before Phase 19 starts:** matched on keywords only; not this phase.

</deferred>

---

*Phase: 20-admin-data-governance-asset-management*
*Context gathered: 2026-11-08*
