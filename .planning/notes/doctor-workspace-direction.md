---
title: Doctor Workspace direction
date: 2026-11-05
context: Exploration of a pasted Doctor Workspace specification against the delivered v3.0 code. Feeds Phase 19.
---

# Doctor Workspace direction

## Source and status

The specification was pasted into a session on 2026-11-05 and is not stored in the repo. It cites `Hospital Software Specification.txt` and `Project Plan Summary.txt`, which are also not in the repo, so its citations to them could not be checked. This note records what was decided from it. Where the spec and this note differ, this note wins.

## Decisions from the exploration

| Topic | Decision | Status |
| --- | --- | --- |
| Clinical access | Doctors read all clinical records and edit only their own; cross-doctor reads are audited | Chosen by the user. **Pending sign-off**, because it reverses EG-6 / D-03 (see the todo below) |
| Specialties | Physiotherapy (2 doctors) and Ophthalmology (1 doctor) | Confirmed by the user |
| Budget | Fits within the existing Rs 22,000 ceiling, as a phase rather than a new paid milestone | Chosen by the user. The remaining budget is not recorded anywhere |
| Templates | Versioned and developer-set, with no admin editor | Follows from the budget decision |
| Schema | Map the spec onto existing tables; do not adopt its UUID keys or parallel tables | Recommended; not objected to by the user |
| Specialty forms | Physiotherapy and Ophthalmology templates are an exception to the Reception spec v1.1 exclusion of specialty forms | Confirmed by the user |
| Base | PR #17 (departments) and PR #12 (visit type) merge before Phase 19 | Confirmed by the user |
| Logins | One PC at a time for all accounts, with an audited takeover. Changes the EG-10 default | Confirmed by the user |

Full implementation decisions are in `.planning/phases/19-universal-consultation-workspace/19-CONTEXT.md`.

`PROJECT.md` still lists only the two physiotherapy consultants and describes the hospital as physiotherapy-focused. It needs updating when this phase is planned.

## Spec terms mapped to the existing system

| Spec | Existing system | Action |
| --- | --- | --- |
| `patients.patient_number` | `patients.urn` (`KH-YYYY-XXXX`) | Reuse |
| `patients.date_of_birth` | `age_years` is required; no date of birth on the client-approved form | Keep as is |
| `doctors` with specialty and department | `doctors`, linked from `users.doctor_id`; no specialty field | Use `departments` and `doctor_departments` from PR #17 |
| `encounters` | `clinical_encounters` | Extend |
| `encounter_amendments` | `clinical_addenda` | Reuse |
| `audit_events` | `audit_logs`, append-only by trigger | Reuse |
| `prescriptions`, `prescription_items` | Same table names | Extend |
| `treatment_plans` as orders and advice | The name is taken by paid physiotherapy packages | Keep existing meaning; orders are deferred |
| `queue_entries` | Queue is derived from `appointments` | Not needed |
| Scheduled, Checked In, In Consultation, Completed | `BOOKED`, `ARRIVED`, `IN_CONSULTATION`, `DONE` | Keep existing statuses |
| `vital_observations` | None | New |
| `clinical_templates`, `template_versions`, `template_responses` | None | New |
| `follow_up_recommendations` | Only `prescriptions.follow_up_date` | New |

## Existing work the spec does not account for

- VAS session logging, treatment packages and package billing are the core physiotherapy work, and the consultation must leave them working. Ophthalmology does not use them, so the consultation cannot assume a treatment plan exists.
- The prescription printout must keep its static Hindi labels (RX-01). The spec does not mention Hindi.

## Gaps confirmed in the code

- One appointment can have two encounters: `create_encounter` has no check and the index is not unique.
- There is no auto-save, although Phase 13 decided on it (D-13-05), and an encounter cannot be saved until all three text fields are filled.
- The silo is 19 inline checks across 5 clinical routers. The central helper in `core/scope.py` exists but no router uses it.
- `appointments.check_in_at` and `check_out_at`, recorded as complete in the Phase 14 scope, do not exist.
- Diagnosis is entered separately on the encounter, prescription and treatment plan.
- Prescriptions are create-only, with no draft or authorise step, and are written on a separate page.

Details and sources are in `13-LEARNINGS.md` and `14-LEARNINGS.md`.

## Scope

**In Phase 19:** see DWS-01 to DWS-10 in `.planning/REQUIREMENTS.md`.

**Deferred:** admin template editor, treatment and investigation orders, reports, weekly calendar, multiple active prescriptions per encounter, extra clinical history tables, documents, notifications, medicine catalogue, printed glasses prescription.

**Not doing:** UUID keys, new parallel tables, changing age to date of birth on the client-approved form.

**First to cut if the budget runs short:** vitals and follow-up recommendations.

## Open points for discussion and planning

- How Phase 19 sequences with the open Phase 18 plans (06-08). Plan 18-06 is needed for the Hindi labels on the summary.
- Exact template field lists, drafted from the agreed sections and approved by each specialty's doctors.
- Nav items in the spec without a page specification (Documents, Reports, Notifications, My Profile) are not in scope unless raised.
