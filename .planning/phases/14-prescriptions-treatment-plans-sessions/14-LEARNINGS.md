---
phase: 14
phase_name: "Prescriptions, Treatment Plans & Sessions"
project: "Kalyan Hospital Patient & Physiotherapy Management"
generated: "2026-11-05"
counts:
  decisions: 6
  lessons: 3
  patterns: 4
  surprises: 2
missing_artifacts:
  - "14-VERIFICATION.md"
  - "14-UAT.md"
  - "14-07-SUMMARY.md (14-SUMMARY.md covers plan 14-07)"
---

# Phase 14 Learnings: Prescriptions, Treatment Plans & Sessions

Items marked "Checked against code" were compared with the repository on 2026-11-05. Everything else comes from the named artifact.

## Decisions

### Sessions are finalised the moment they are submitted
A treatment session has no draft state. `is_finalised` is true on submission, and API plus trigger reject later edits or deletes.

**Rationale:** TRT-03 requires immutable session history, with corrections only as dated addenda.
**Source:** 14-SCOPE-AND-WORKFLOW.md, 14-01-SUMMARY.md, 14-04-SUMMARY.md

---

### A recurrence gets a new package, not an edited patient
Repeatable treatment plans are kept separate from static patient identity.

**Rationale:** A patient returning six months later needs a fresh session count without overwriting the original record.
**Source:** 14-SCOPE-AND-WORKFLOW.md (Form Mapping Principles)

---

### Balances are derived, never stored
The patient table holds no editable balance. Amounts come from ledger payments minus billed packages and fees.

**Rationale:** A mutable balance invites race conditions, double counting and audit drift.
**Source:** 14-SCOPE-AND-WORKFLOW.md (Form Mapping Principles)

---

### Prescriptions link to an encounter optionally
`encounter_id` is nullable on both `prescriptions` and `treatment_plans`, so a prescription can be written against the patient alone.

**Rationale:** The Phase 14 workflow starts from the patient workspace rather than from within a consultation.
**Source:** 14-SCOPE-AND-WORKFLOW.md, 14-01-PLAN.md

---

### Follow-up is a date on the prescription
`prescriptions.follow_up_date` is the only follow-up record.

**Rationale:** Phase 14 scoped follow-up as one field captured during prescription issuance.
**Source:** 14-SCOPE-AND-WORKFLOW.md, 14-01-PLAN.md, 14-05-SUMMARY.md

---

### Plan progress is synchronised by a database trigger
`trg_sync_treatment_plan_session_progress` updates `completed_sessions` and marks the plan `COMPLETED` when the target is reached.

**Rationale:** Progress stays correct regardless of which code path logs a session.
**Source:** 14-01-SUMMARY.md, 14-SUMMARY.md

---

## Lessons

### Row locks and joined eager loading don't mix
Locking `treatment_plans` with `SELECT ... FOR UPDATE` needed eager relationships switched off with `lazyload`, to avoid PostgreSQL's restrictions on locking outer joins.

**Context:** Models here commonly use `lazy="joined"`, so any new row-locked allocation on these tables will meet the same restriction.
**Source:** 14-SUMMARY.md

---

### A prescription is issued the moment it is created
The API is create and read only, so there is no draft, edit or authorise step.

**Context:** This suited a form submitted in one go. It doesn't support a prescription built up during a consultation and authorised at the end.
**Source:** 14-02-SUMMARY.md, 14-02-PLAN.md

---

### Plan text on read permissions was superseded by D-04
Plan 14-02 lists `PRESCRIPTION_READ` for Admin, Reception and Doctor, while the summary reports reception default-deny.

**Context:** Checked against code: only the Doctor role holds clinical read permissions, so D-04 was preserved. The plan should not be used as the reference for this rule.
**Source:** 14-02-PLAN.md, 14-02-SUMMARY.md

---

## Patterns

### Lock the parent row to number its children
`allocate_next_session_number()` locks the treatment plan and validates its state before numbering, proven by a 20-thread test against real PostgreSQL.

**When to use:** Contiguous child numbering where a parent's state also has to be checked.
**Source:** 14-04-SUMMARY.md

---

### Finalise plus dated addenda as a reusable shape
Phase 14 reused the Phase 13 approach for sessions: an immutable record, a trigger, and a separate addenda table.

**When to use:** Any new clinical record type that needs correction without overwriting.
**Source:** 14-01-SUMMARY.md, 14-04-SUMMARY.md, 14-06-SUMMARY.md

---

### Map every paper form field to a domain, table and phase
The OQ-13 table reconciled the client's registration slip field by field before any schema work.

**When to use:** Any change touching the client-approved form or a new paper workflow.
**Source:** 14-SCOPE-AND-WORKFLOW.md

---

### Keep a shared bilingual print component
`PrescriptionPrint.tsx` holds letterhead, Rx symbol, English medicine table and Hindi labels in one A4 layout, separate from the authoring screen.

**When to use:** Any new printed clinical document, including a consultation summary.
**Source:** 14-05-SUMMARY.md, 14-SUMMARY.md

---

## Surprises

### The check-in columns recorded as complete don't exist
The OQ-13 table maps the paper form's In / Out date and time to `appointments.check_in_at` and `check_out_at`, marked "Phase 13 (Complete)". Plan 13-01 never defined them.

**Impact:** Checked against code: neither column exists anywhere in the backend, and `status_updated_at` is overwritten on each change. Actual arrival time and the form's In / Out fields are not stored.
**Source:** 14-SCOPE-AND-WORKFLOW.md, 13-01-PLAN.md

---

### Diagnosis lives in three separate columns
`clinical_encounters.diagnosis`, `prescriptions.diagnosis` and `treatment_plans.condition_diagnosis` are each independently required free text.

**Impact:** A doctor can record different diagnoses for one visit, and has to retype the same one. An integrated consultation needs a single source for this.
**Source:** 14-01-PLAN.md, 13-01-PLAN.md, 14-SCOPE-AND-WORKFLOW.md
