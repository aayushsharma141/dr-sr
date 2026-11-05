# Phase 19: Universal Consultation Workspace - Context

**Gathered:** 2026-11-05
**Status:** Ready for planning, after the base PRs merge (D-19-02). DWS-04 stays blocked until sign-off (D-19-05).

<domain>
## Phase Boundary

One consultation for doctors in both current specialties, Physiotherapy (2 doctors) and Ophthalmology (1 doctor). It holds the assessment, vitals, specialty template, diagnosis, prescription and follow-up together, can be left and resumed without losing saved work, and lets a doctor read a patient's earlier records from other doctors.

Requirements: DWS-01 to DWS-10. This phase extends the existing encounter and prescription work from Phases 13 and 14. Physiotherapy packages, VAS session logging and package billing must keep working unchanged, and an Ophthalmology consultation must complete with no treatment plan.

</domain>

<decisions>
## Implementation Decisions

Numbered `D-19-xx` to avoid clashing with the project-level D-01 to D-08.

### Scope and base
- **D-19-01:** Specialty templates for Physiotherapy and Ophthalmology are in scope within the existing Rs 22,000 ceiling. This is an exception to the Reception spec v1.1 scope line excluding specialty-specific clinical forms. Forms for any other specialty stay excluded unless separately priced and approved.
- **D-19-02:** Merge PR #17 (departments) and PR #12 (hybrid appointment workflow) before Phase 19 work starts. PR #12's `0006` migration collides with main and must be renumbered. Phase 19 migrations follow them.
- **D-19-03:** A department is the specialty. Reuse `departments` and `doctor_departments` from PR #17; do not add a specialty field to `doctors`. Doctors can belong to several departments, so the template comes from the appointment's department, not from the doctor. — **Reversibility:** costly — template lookup and every encounter's stored version depend on this link.
- **D-19-04:** Reuse the appointment visit type from PR #12 for new and follow-up visits instead of adding a second concept. PR #12 marks historical appointments `UNSPECIFIED`, and those must stay readable.
- **D-19-05:** Doctors read all clinical records and edit only their own, with cross-doctor reads audited. Reception and Admin stay denied (D-04). Doctor queues stay doctor-scoped, as Reception spec v1.1 requires. Blocked until the EG-6 sign-off todo is complete. — **Reversibility:** costly — replaces 19 inline silo checks and rewrites cross-doctor tests.

### Consultation layout
- **D-19-06:** One page with sections, with a jump list: complaints, vitals, specialty form, diagnosis, prescription, follow-up. No tabs and no wizard.
- **D-19-07:** A side panel keeps the patient, allergy alert and a short read-only summary of the last encounter in view.
- **D-19-08:** Earlier findings are read-only. The doctor presses Copy on a section to reuse it. Nothing is copied automatically.
- **D-19-09:** Finalising requires the chief complaint, a diagnosis and the template's required fields, validated on the server. Vitals, prescription and follow-up stay optional.

### Specialty templates
- **D-19-10:** First Physiotherapy template sections: pain assessment (with a starting VAS score), range of motion, strength and function, posture and gait.
- **D-19-11:** First Ophthalmology template sections: visual acuity, intraocular pressure, anterior segment, fundus and refraction.
- **D-19-12:** Fields are structured where it counts: numbers and pick-lists for measurable items, free text for findings. Eye fields use side-by-side right and left eye columns.
- **D-19-13:** Claude drafts each template from these sections. The doctors of that specialty approve it before it is seeded, and every later change is a new version. Draft templates are not clinically validated until approved.

### Prescriptions
- **D-19-14:** A prescription is authorised separately, before finalising, so the doctor can print it while the patient is present and finish the notes later. It cannot print until it is authorised.
- **D-19-15:** A mistake in an authorised prescription is corrected by cancelling it with a reason and reissuing it. The original stays visible, marked cancelled, with its author and reason. An encounter has one active prescription at a time. — **Reversibility:** costly — sets the prescription status model and the uniqueness rule.
- **D-19-16:** Retire creation on `/doctor/prescriptions/new`. New prescriptions are written only in a consultation, so each has an encounter. Past prescriptions stay readable and printable.
- **D-19-17:** The printout keeps its static Hindi labels (RX-01), and the diagnosis is entered once for the encounter.

### Follow-up
- **D-19-18:** Either the doctor or reception can turn a recommendation into an appointment. Reception confirms slots from its Follow-up & Visits list, and a doctor can book from inside the consultation.
- **D-19-19:** Reception sees only the date and doctor. The clinical reason stays with doctors, which keeps D-04 intact.
- **D-19-20:** A follow-up defaults to the current doctor, and the doctor can choose another active doctor.
- **D-19-21:** An unbooked recommendation stays open as overdue until it is booked or closed with a reason. It never expires automatically.

### Auto-save and drafts
- **D-19-22:** Drafts save about 3 seconds after typing stops, and on leaving a section. "Saved" shows only after the server confirms.
- **D-19-23:** If the server can't be reached, a "Not saved" warning stays up, the text stays on screen and saving retries. No clinical text is stored in the browser, because PCs are shared. A power cut can therefore lose unsaved text; the user accepted this.
- **D-19-24:** Unfinished drafts are kept until finalised and appear in an Unfinished list on the doctor's dashboard. Nothing clinical is discarded automatically.

### One login at a time
- **D-19-25:** An account can be logged in on one PC at a time, for all roles. This changes EG-10, which set multiple concurrent sessions as the default.
- **D-19-26:** A second login is refused after the password is checked, with a message that the account is in use and a button to end that session and log in here. The takeover is audited. A crashed PC therefore can't lock anyone out, and expired sessions don't count as in use.
- **D-19-27:** Optimistic concurrency via `version_id` (D-08) stays as the safety net behind this rule.

### Printed consultation summary
- **D-19-28:** The summary is a patient copy: complaint, diagnosis, advice and follow-up in plain form. Detailed findings stay in the system.
- **D-19-29:** The summary and prescription slip are separate documents. The summary lists no medicines, so a cancelled prescription can't leave an out-of-date summary with the patient.
- **D-19-30:** It prints only after finalising, one A4 page on the approved letterhead. A reprint shows its print date.
- **D-19-31:** English with static Hindi labels, matching the prescription slip. This depends on Plan 18-06 (bundled Devanagari font), which is not implemented.

### Claude's Discretion
- Extra medicine fields. The user gave no preference. Leaning towards strength, form and route, because eye drops need the eye specified; quantity is less useful with no pharmacy module.
- Vitals entry. Not discussed. Doctors enter them, because there is no nurse role and the three fixed roles stay. The field list per specialty is for planning.
- Cross-doctor access details. Not discussed. Leaning towards finalised records only, each labelled with its author, with no addenda on another doctor's record, matching Phase 19 success criterion 4.
- Consultations with no appointment, including how a doctor in several departments picks the template.
- Exact schema, including how existing prescriptions and `prescriptions.follow_up_date` are carried over.

### Folded Todos
- **Get sign-off on doctor access change and collect eye doctor details:** gates D-19-05 and supplies the eye doctor's profile and template review (D-19-13).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Direction and requirements
- `.planning/notes/doctor-workspace-direction.md` — mapping of the pasted spec onto existing tables, confirmed code gaps, and scope. The pasted spec itself is not in the repo.
- `.planning/REQUIREMENTS.md` — DWS-01 to DWS-10 and deferred items DWF-01 to DWF-05
- `.planning/ROADMAP.md` — Phase 19 goal and success criteria
- `.planning/todos/pending/doctor-access-signoff-and-eye-doctor-setup.md` — sign-off gating DWS-04
- `.planning/todos/pending/merge-phase-19-base-prs.md` — prerequisite merges

### Earlier phases
- `.planning/phases/13-appointments-clinical-encounters/13-LEARNINGS.md` — silo spread, draft limits, double-encounter gap
- `.planning/phases/14-prescriptions-treatment-plans-sessions/14-LEARNINGS.md` — diagnosis duplication, missing check-in columns, row-lock restriction
- `.planning/phases/13-appointments-clinical-encounters/13-CONTEXT.md` — D-13-02 state machine, D-13-04 finalisation and addenda
- `.planning/phases/14-prescriptions-treatment-plans-sessions/14-SCOPE-AND-WORKFLOW.md` — form mapping principles
- `.planning/phases/11-decisions-gate-foundation-auth/11-ENTRY-GATE.md` — EG-6 and EG-10, both changed by this phase

### Open PRs this phase builds on
- `docs/reception-module-spec-v1.1.md` — Reception spec; present only on `feature/reception-all-specialties` (PR #17) until it merges
- PR #17, `feature/reception-all-specialties` — migrations `0008` and `0009`, `departments`, `doctor_departments`, `appointments.department_id`
- PR #12, `fix/hybrid-appointment-workflow-review` — visit type, walk-in and scheduled booking, token allocated at check-in

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `frontend/src/pages/ClinicalEncounterWorkspace.tsx`: starting point, with the allergy banner, history drawer, locked view and addenda timeline.
- `frontend/src/components/ConflictBanner.tsx`, `InlineAlert.tsx`, `Modal.tsx`, `UnsavedChangesGuard.tsx`: conflict, warning, dialog and leave-page handling.
- `frontend/src/components/PrescriptionPrint.tsx`, `PrintLetterhead.tsx`: prescription slip and the shared letterhead for the summary.
- `frontend/src/pages/PrescriptionWorkspace.tsx`: medicine row editor and frequency presets to move into the consultation.
- `frontend/src/pages/AppointmentsReception.tsx`: the `FollowUpVisits` list and its Overdue filter, which read `usePrescriptionFollowUps`.
- `backend/src/kalyan_api/core/scope.py`: `row_scope` and `get_scoped_or_404`, unused by any router today; the place to centralise D-19-05.
- `backend/src/kalyan_api/services/auth_service.py`: `active_session_criteria` and `revoke_all_user_sessions`, already enough for most of D-19-25 and D-19-26.

### Established Patterns
- Immutability pairs an API rejection with a PostgreSQL trigger, and both are tested.
- Corrections are separate dated records. The spec's "amendments" are existing addenda.
- Every write records its audit row in the same transaction, and stale `version_id` returns 409.
- Cross-doctor denial returns 404. Under D-19-05 this applies only to writes, so read tests must change.
- Each phase closes with an integration gate test and a coverage floor of 85%.

### Integration Points
- `backend/src/kalyan_api/routers/encounters.py`, `prescriptions.py`, `timeline.py`, `treatment_plans.py`, `treatment_sessions.py`: the 19 inline silo checks.
- `backend/src/kalyan_api/routers/encounters.py`: `create_encounter` needs the one-per-appointment guard, and creation must accept partial drafts.
- `backend/src/kalyan_api/models.py`: `symptoms`, `clinical_notes` and `diagnosis` are NOT NULL, and the finalised-encounter trigger must keep protecting any new columns.
- `backend/tests/support/matrix.py`, `test_rbac_matrix.py`, `openapi.snapshot.json`: permission and contract guards to update.
- Login flow and tests: D-19-25 may break any test that logs the same user in from two clients.
- `frontend/src/pages/DoctorDashboard.tsx`: add the Unfinished list.
- `frontend/src/router.tsx`: retire `/doctor/prescriptions/new` for creation.

</code_context>

<specifics>
## Specific Ideas

- The user does not want one login or draft open on two PCs at once.
- Eye findings use right and left eye columns side by side.
- Starting VAS in the Physiotherapy template sits alongside the VAS already recorded on session logs; the two should read as one series, not compete.

</specifics>

<deferred>
## Deferred Ideas

- Printed glasses prescription from refraction findings. New document type.
- Admin template editor (DWF-01).
- Treatment, investigation and referral orders (DWF-02).
- Weekly calendar and multiple active prescriptions per encounter (DWF-03).
- Extra clinical history tables, clinical reports and notifications (DWF-04).
- Medicine catalogue (DWF-05).

</deferred>

---

*Phase: 19-universal-consultation-workspace*
*Context gathered: 2026-11-05*
