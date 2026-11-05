---
phase: 13
phase_name: "Appointments & Clinical Encounters"
project: "Kalyan Hospital Patient & Physiotherapy Management"
generated: "2026-11-05"
counts:
  decisions: 6
  lessons: 3
  patterns: 4
  surprises: 3
missing_artifacts:
  - "13-VERIFICATION.md"
  - "13-UAT.md"
---

# Phase 13 Learnings: Appointments & Clinical Encounters

Items marked "Checked against code" were compared with the repository on 2026-11-05. Everything else comes from the named artifact.

## Decisions

### Atomic per-doctor daily tokens from a counter table
Tokens are integers unique per `(doctor_id, appointment_date)`, allocated inside the booking transaction from `daily_token_sequences` with a row lock.

**Rationale:** Parallel reception bookings must never produce duplicate or skipped tokens.
**Source:** 13-CONTEXT.md (D-13-01), 13-02-SUMMARY.md

---

### Validated appointment state machine
`BOOKED` -> `ARRIVED` -> `IN_CONSULTATION` -> `DONE`, with `CANCELLED` and `NO_SHOW` as terminal states. Cancelling requires a reason, and only a doctor can move an appointment to `IN_CONSULTATION` or `DONE`.

**Rationale:** Status changes must be auditable and safe under concurrent edits, so invalid jumps return 422 and stale versions return 409.
**Source:** 13-CONTEXT.md (D-13-02), 13-03-SUMMARY.md

---

### Cross-doctor lookups return 404, not 403
A doctor requesting another doctor's encounter gets Not Found.

**Rationale:** A 403 would confirm that the record exists, which allows ID harvesting.
**Source:** 13-04-SUMMARY.md

---

### Finalised notes are locked at both API and database level
The API rejects edits with HTTP 400, and `trg_prevent_finalised_encounter_tampering` blocks updates to clinical fields and deletions.

**Rationale:** Immutability must hold even against direct SQL.
**Source:** 13-CONTEXT.md (D-13-04), 13-01-SUMMARY.md, 13-07-SUMMARY.md

---

### Corrections are dated addenda in a separate table
`clinical_addenda` holds later changes, and an addendum can only be added to a finalised encounter.

**Rationale:** The original note stays intact and each later change has an author and timestamp.
**Source:** 13-CONTEXT.md (D-13-04), 13-04-SUMMARY.md

---

### Finalising an encounter completes its appointment
`POST /api/encounters/{id}/finalise` advances a linked appointment to `DONE`, and creating an encounter advances it to `IN_CONSULTATION`.

**Rationale:** The doctor's clinical action drives the queue, so reception sees the status without a separate step.
**Source:** 13-04-SUMMARY.md

---

## Lessons

### "Patient history" in the workspace is per-doctor history
`GET /api/patients/{patient_id}/encounters` returns only the calling doctor's encounters, while the workspace drawer is described as supporting longitudinal continuity of care. Under the silo, a doctor taking over a patient sees none of the earlier notes.

**Context:** This follows directly from D-03. It matters as soon as any workflow expects a second clinician to read prior records.
**Source:** 13-04-SUMMARY.md, 13-06-SUMMARY.md

---

### Auto-save was decided but never planned
D-13-05 called for "auto-save/draft support". Plan 13-06 specified only a manual "Save Draft" button, and that is what shipped.

**Context:** The decision was lost between CONTEXT and PLAN, and the gate did not catch it because the plan was what got verified. Checked against code: neither the encounter nor the prescription screen has auto-save logic.
**Source:** 13-CONTEXT.md (D-13-05), 13-06-PLAN.md, 13-06-SUMMARY.md

---

### Encounter creation is not a true draft
The create endpoint takes symptoms, clinical notes and diagnosis together, so the first save behaves more like a complete note than a partial draft.

**Context:** Checked against code: `EncounterCreate` requires all three fields with a minimum length of 2, and the columns are NOT NULL. A doctor can't save a consultation they have only just started.
**Source:** 13-04-PLAN.md, 13-01-PLAN.md

---

## Patterns

### Counter row plus row lock, proven by a thread race
Allocate gap-free sequences from a dedicated counter row locked with `SELECT ... FOR UPDATE`, and prove it with a 20-thread test asserting exactly `1..20`.

**When to use:** Any human-visible number that must have no duplicates and no gaps.
**Source:** 13-02-SUMMARY.md, 13-07-SUMMARY.md

---

### Defence-in-depth immutability
Pair an API rejection with a PostgreSQL trigger, and test both paths, including direct SQL.

**When to use:** Any clinical or financial record that must never change after sign-off.
**Source:** 13-01-SUMMARY.md, 13-07-SUMMARY.md

---

### Integration gate at the end of each phase
A dedicated `test_phase13_gate.py` covers concurrency, lifecycle, silo, immutability and audit rows, with a coverage floor of 85% and a zero-diff check on legacy code.

**When to use:** Closing any phase that crosses backend, frontend and permissions.
**Source:** 13-07-PLAN.md, 13-07-SUMMARY.md

---

### Polling instead of live connections for the queue
`useDoctorQueue` polls `GET /api/doctor/queue` every 10 seconds.

**When to use:** Near-live screens for 3 to 5 LAN users, where websockets are out of scope.
**Source:** 13-06-SUMMARY.md

---

## Surprises

### The central scope helper was planned but the routers don't use it
Plan 13-04 specified `get_scoped_or_404(..., ScopeFamily.CLINICAL)`, and D-13-03 names `row_scope` as the access mechanism.

**Impact:** Checked against code: no router or service calls either helper. The silo is written as inline `doctor_id` comparisons, 19 of them across the 5 clinical routers (encounters, prescriptions, timeline, treatment plans, treatment sessions). Any change to the access rule has to touch each one, not a single function.
**Source:** 13-04-PLAN.md, 13-CONTEXT.md (D-13-03)

---

### Nothing prevents two encounters for one appointment
Plan 13-04 validates that the appointment belongs to the doctor but does not check whether it already has an encounter, and Plan 13-01 defines `appointment_id` with a plain index.

**Impact:** Checked against code: a second create call for the same appointment succeeds. No test or manual check covered this case.
**Source:** 13-04-PLAN.md, 13-01-PLAN.md

---

### A manual check lists fields the encounter doesn't have
M-13-03 records "symptoms, diagnosis, examination, prescription, instructions" as persisting, but the encounter schema has no prescription or instructions fields, and prescriptions arrived in Phase 14.

**Impact:** A PASS in the manual check sheet shouldn't be read as proof of every field it names.
**Source:** 13-MANUAL-CHECKS.md, 13-01-PLAN.md
