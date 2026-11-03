# Post-Redesign UX and Clinical Workflow Validation — 2026-11-03

Branch `chore/repo-audit-hardening`. Method: code reading of the redesigned screens, the full automated suites, and new regression tests.
**Not done:** no live browser walkthrough, no screenshots, no 125%/150% display-scaling pass, no physical printer or PDF check, no backup-restore drill. Those items are listed under "Production readiness" and must be done on a workstation before sign-off.

## 1. Corrections made in this pass

| # | Severity | Finding | Fix |
|---|----------|---------|-----|
| C1 | High | **Finalise skipped unsaved edits.** On an existing draft, "Finalise" locked the server copy and silently dropped anything typed since the last save. | `ClinicalEncounterWorkspace` now saves the draft (with the current `version_id`) and only then finalises. Required fields are checked before the confirm dialog opens. |
| C2 | High | **No allergy warning when prescribing.** The allergy alert existed in the consultation view only; the prescription screen showed nothing. | `PrescriptionWorkspace` now shows the recorded allergy text (display only, no interaction rules). |
| C3 | High | **Prescription could be issued twice.** The form stayed filled and enabled after success. | Form resets after issue and re-entrant submit is ignored. "Clear Form" now also resets the medication rows (it used to leave them). |
| C4 | High | **Registration could be submitted twice.** Form stayed filled and enabled after success. | Submit is disabled and ignored once a patient is created. |
| C5 | Medium | **Every error looked like a version conflict.** Validation and network failures showed "Record was modified by another user". | Reload banner now only for HTTP 409; other errors use a normal error alert. |
| C6 | Medium | **No unsaved-changes protection.** | New `UnsavedChangesGuard`: tab close/reload prompt plus an in-app "Discard unsaved changes?" dialog. Wired into encounter, prescription and registration. Deliberate post-save navigation is exempt. |
| C7 | Medium | **Photo-upload failure was swallowed** (`console.error` only), contrary to the project rule against silent errors. | Registration success banner now shows a warning that the photo is missing. |
| C8 | Medium | Prescription row inputs had no accessible names; remove button was icon-only and under 44px. | `aria-label` per field/row, labelled remove button, 44px target. |
| C9 | Low | Action bars scrolled away on long forms. | Sticky action bar on encounter and prescription forms. `Ctrl+S` saves the encounter draft. |
| C10 | Low | Allergy check compared a literal string. | One helper (`hasReportedAllergies`), case-insensitive, shared by consultation, queue and prescription screens. |
| C11 | Build | `DoctorDashboard.tsx` had an unused variable that failed the strict typecheck. | Removed. |

## 2. Remaining issues, ranked

**High**
1. **Allergies default to "None reported".** The registration field is pre-filled, so "not asked" and "asked, none" are identical on every later screen. Needs a product decision (e.g. force an explicit choice). Not changed.
2. **Hindi text is not language-marked.** Only 3 `lang="hi"` uses exist against many Devanagari strings. Fails WCAG 3.1.2 and affects screen-reader pronunciation. Phase 18 recorded this as done; it is not.
3. **Session dialogs focus Close, not the first field** (already logged in `STATE.md`, still open).

**Medium**
4. Phase 18 plans 06–08 are not started, and manual accessibility checks are outstanding (`STATE.md`).
5. Registration mobile field has no client-side pattern; errors only surface from the server after submit.
6. Many controls use `text-xs` (12px). Legible on a desktop monitor, weak at 100% scaling for clinicians; confirm against hospital screens.
7. Addendum text and the treatment-plan form are not covered by the unsaved-changes guard.

**Low**
8. `README.md` still says v3 is "not yet implemented" while `STATE.md` says Phases 11–17 are complete. Documentation drift.
9. Test-suite timeouts under load (see §5).

## 3. Workflow results

Only automated and static results are claimed.

| Journey | Result |
|---|---|
| Reception: register, duplicate detection, search, appointment, arrival, payment, print | Covered by existing component and backend tests (passing). Not exercised live. Double-submit on register fixed (C4). |
| Doctor: queue, start, history, notes, save, prescription, plan, finalise | Existing tests pass; C1–C3 found by reading the code, then covered by new regression tests. Treatment plan not reviewed in depth. |
| Admin: users, roles, audit, backup, restore | Backend suites include the 339-cell RBAC matrix and restore tests. Not exercised in the UI. |

## 4. Clinical safety findings

- Finalise-without-save (C1) was the most serious: a locked record could differ from what the doctor saw.
- Allergy visibility at prescribing (C2) and the default allergy text (Remaining #1).
- No rule or recommendation about drugs or doses was added; the allergy banner only displays the stored text.
- Unauthorized modification: finalised encounters render read-only in the UI, and immutability is enforced by database triggers per project docs. Server-side checks were not re-tested in this pass.

## 5. Regression results

- `clinical-safety.test.tsx` (new, 6 tests): save-before-finalise ordering, blank-field refusal with no misleading banner, 409-only reload banner, allergy banner, form reset after issue, allergy helper.
- Frontend: typecheck clean, lint clean, 38 files / 166 tests passed, 5 skipped, production build succeeds.
- Before the change, one test timed out at the 5s default when all 37 jsdom files ran together (it passed alone). `vite.config.ts` now sets `testTimeout: 15000`; I did not make that edit.
- Backend: the suite ran with one error, `test_phase17_acceptance.py::test_lan_health_and_cli_check` (`relation "doctors" does not exist` in the test database). My changes were frontend-only. I did not confirm whether it also fails on a clean database, and I did not capture a total pass count.

## 6. Architecture: standalone versus LAN

| | Standalone (legacy desktop) | LAN platform (v3.0) |
|---|---|---|
| Code | `main.py`, `app/` (PySide6, ReportLab) | `backend/` (FastAPI), `frontend/` (React SPA) |
| Database | SQLite file on the one PC | PostgreSQL 18 on the server PC |
| Server needed | No | Yes: FastAPI process on the server PC (`deploy/start-server.bat`) |
| Network needed | None | LAN only; no internet. Workstations use a browser |
| Node.js | Not needed | Build time only; none on the server PC |
| Backup/restore | Local SQLite backup service | Server-side CLI and admin screens, checksummed bundles |
| Multi-user | No. Never share the SQLite file over a network | Yes, 3–5 workstations, with roles and optimistic locking |

The desktop app is retained only as a migration and domain-rule reference. No deployment change was made or proposed.

## 7. Production-readiness assessment

**Not ready for unattended clinical use yet.** The automated suites are healthy and the worst data-loss and duplicate-record defects found are fixed. Before go-live:
1. Walk the three journeys live on a clinic workstation and capture screenshots.
2. Test at 100%, 125% and 150% Windows scaling and at the minimum window size.
3. Print a registration card, receipt and prescription on the real printers and save the PDFs.
4. Run the backup/restore drill in a controlled copy.
5. Decide the allergy-default question and finish Hindi language marking.
6. Resolve the backend acceptance-test database error.
