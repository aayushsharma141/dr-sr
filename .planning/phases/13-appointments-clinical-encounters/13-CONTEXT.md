# Phase 13: Appointments & Clinical Encounters - Context

**Gathered:** 2026-11-01  
**Status:** Ready for planning  

<domain>
## Phase Boundary

Phase 13 delivers reception appointment booking with daily per-doctor token numbers, appointment workflow tracking, doctor consultation queues, and clinical encounter note recording with locked finalisation and dated addenda for Kalyan Hospital LAN Platform.

Specifically:
- **Daily Appointments & Tokens (`APT-01`):** Reception books daily appointments per doctor with an atomic, gap-free token number (1, 2, 3...) unique per `(doctor_id, appointment_date)`. Concurrency-safe under simultaneous bookings.
- **Appointment Status Flow & Doctor Queue (`APT-02`):** Validated status progression: `BOOKED` -> `ARRIVED` -> `IN_CONSULTATION` -> `DONE` (plus terminal statuses `CANCELLED` and `NO_SHOW`). Doctor dashboard displays today's consultation queue scoped strictly to that doctor.
- **Clinical Encounter Recording (`CLN-01`):** Doctor records clinical encounter notes (chief complaints/symptoms, clinical examination, diagnosis). Strictly enforced doctor silo (`D-03`, `D-04`, `EG-16`): Reception and Admin cannot read clinical note content (default-deny 403/404).
- **Finalised Note Immutability & Addenda (`CLN-02`):** Once a doctor finalises an encounter note, it is permanently locked against edits/deletions at both the API and database levels. Any subsequent modifications must be appended as chronologically ordered, dated addenda with doctor identity.

</domain>

<decisions>
## Implementation Decisions

### 1. Token Numbering & Concurrency (D-13-01)
- **Format:** Integer token (1, 2, 3, ...) unique per `(doctor_id, appointment_date)`.
- **Concurrency Guarantee:** Atomic sequence generation inside the booking transaction using a counter table `daily_token_sequences` with `SELECT ... FOR UPDATE` (or advisory xact locks scoped to hash(doctor_id, date)), guaranteeing strictly zero duplicate tokens and zero gaps under parallel reception bookings.

### 2. Appointment Status State Machine (D-13-02)
- Permitted states: `BOOKED`, `ARRIVED`, `IN_CONSULTATION`, `DONE`, `CANCELLED`, `NO_SHOW`.
- Valid transitions:
  - `BOOKED` -> `ARRIVED`, `CANCELLED`, `NO_SHOW`
  - `ARRIVED` -> `IN_CONSULTATION`, `CANCELLED`, `NO_SHOW`
  - `IN_CONSULTATION` -> `DONE`, `CANCELLED`
  - `DONE`, `CANCELLED`, `NO_SHOW` are terminal states.
- Optimistic locking via `version_id` to prevent conflicting status updates.
- Status changes emit audit log entries with previous and new states.

### 3. Doctor Silo & Clinical Privacy (D-13-03)
- Follows `D-03`, `D-04`, and `EG-16`:
  - `ENCOUNTER_READ` and `ENCOUNTER_WRITE` are granted exclusively to `Role.DOCTOR`.
  - Reception and Admin roles are default-denied (403 Forbidden).
  - Row-level access is scoped to `doctor_id == principal.doctor_id` via `ScopeFamily.CLINICAL` in `core/scope.py`.
  - Scoped queries return 404 Not Found to prevent information leakage about encounter existence.

### 4. Note Finalisation & Addenda Pattern (D-13-04)
- An encounter has `is_finalised` (boolean, default False) and `finalised_at` (timestamp with timezone).
- A draft encounter can be updated with `PATCH /api/encounters/{id}` (protected by `version_id`).
- When `POST /api/encounters/{id}/finalise` is called:
  - `is_finalised` becomes `True`, `finalised_at` is set to the current timestamp.
  - Any future `PATCH` or `DELETE` attempt on this encounter row is rejected (HTTP 400 Bad Request: "Finalised clinical encounters are immutable").
  - Database trigger or CHECK prevents mutating clinical content once finalised.
- Addenda are stored in a dedicated `clinical_addenda` table linked by `encounter_id`, containing `addendum_text`, `doctor_id`, `created_at`.

### 5. Frontend Workspaces (D-13-05)
- **Reception Workspace:**
  - Fast appointment booking modal/form with patient auto-complete and active doctor selector.
  - Daily Appointment Queue board with quick status transition actions (e.g. "Mark Arrived", "Cancel").
- **Doctor Workspace:**
  - Dedicated `/doctor` dashboard featuring today's queue partitioned into Arrived (Waiting), In Consultation, Booked, and Done.
  - One-click "Start Consultation" taking doctor to encounter recording screen.
  - Clinical encounter form with auto-save/draft support, patient medical context banner (allergies, age/gender, past encounters history), and dual "Save Draft" / "Finalise Encounter" actions.
  - Finalised view displays locked encounter badge and Addendum input.

</decisions>

<canonical_refs>
## Canonical References

- `.planning/REQUIREMENTS.md`: `APT-01`, `APT-02`, `CLN-01`, `CLN-02`
- `.planning/ROADMAP.md`: Phase 13 goal and success criteria
- `DECISIONS.md`: `D-03` (Doctor silo), `D-04` (Reception clinical default-deny), `EG-16` (Admin operational scope)
- `backend/src/kalyan_api/core/permissions.py`: `APPOINTMENT_READ`, `APPOINTMENT_WRITE`, `ENCOUNTER_READ`, `ENCOUNTER_WRITE`
- `backend/src/kalyan_api/core/scope.py`: `ScopeFamily.CLINICAL`, `row_scope`, `get_scoped_or_404`
</canonical_refs>
