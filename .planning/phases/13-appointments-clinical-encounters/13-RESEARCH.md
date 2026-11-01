# Phase 13: Appointments & Clinical Encounters - Research & Architecture

**Date:** 2026-11-01  
**Status:** Complete  

## 1. Concurrency Architecture for Daily Token Generation

### Problem Definition
Under `APT-01`, reception staff book daily appointments for patients with a chosen doctor. Each appointment must receive a sequential token number (1, 2, 3...) unique per doctor per calendar date. Under concurrent bookings across multiple reception terminals:
- Zero duplicate token numbers may be assigned.
- Zero gaps in tokens for a doctor on a given day.
- Booking throughput must not deadlock.

### Chosen Pattern: Dedicated Counter Table with Row-Level Locking
Just as `urn_sequences` was successfully used in Phase 12 (`test_urn_race.py` proved 20 parallel threads with zero gaps and zero duplicates), we implement:

```sql
CREATE TABLE daily_token_sequences (
    doctor_id INTEGER NOT NULL REFERENCES doctors(id) ON DELETE RESTRICT,
    appointment_date DATE NOT NULL,
    last_token INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (doctor_id, appointment_date)
);
```

Within the booking transaction:
1. `SELECT last_token FROM daily_token_sequences WHERE doctor_id = :doc_id AND appointment_date = :app_date FOR UPDATE`
2. If row does not exist, insert with `ON CONFLICT (doctor_id, appointment_date) DO NOTHING` and re-select with `FOR UPDATE`.
3. Increment `next_token = last_token + 1`.
4. Update `daily_token_sequences SET last_token = :next_token, updated_at = now()`.
5. Insert into `appointments (patient_id, doctor_id, appointment_date, token_number, status, ...)`.
6. Commit transaction.

A database unique constraint `UNIQUE (doctor_id, appointment_date, token_number)` on `appointments` guarantees database-level integrity as a secondary defense.

---

## 2. Appointment Status State Machine

### Status Enumeration
```python
class AppointmentStatus(StrEnum):
    BOOKED = "BOOKED"
    ARRIVED = "ARRIVED"
    IN_CONSULTATION = "IN_CONSULTATION"
    DONE = "DONE"
    CANCELLED = "CANCELLED"
    NO_SHOW = "NO_SHOW"
```

### Transition Matrix
| Current Status | Allowed Next States | Initiating Role |
| :--- | :--- | :--- |
| `BOOKED` | `ARRIVED`, `CANCELLED`, `NO_SHOW` | Reception, Doctor |
| `ARRIVED` | `IN_CONSULTATION`, `CANCELLED`, `NO_SHOW` | Doctor, Reception |
| `IN_CONSULTATION` | `DONE`, `CANCELLED` | Doctor |
| `DONE` | *(Terminal)* | None |
| `CANCELLED` | *(Terminal)* | None |
| `NO_SHOW` | *(Terminal)* | None |

Transitions to invalid next states return HTTP 422 Unprocessable Entity with a descriptive error code `invalid_status_transition`.

---

## 3. Clinical Encounter Immutability & Doctor Silo

### Security Requirements (`D-03`, `D-04`, `CLN-01`, `CLN-02`)
1. **Access Control:**
   - `ENCOUNTER_READ` and `ENCOUNTER_WRITE` are granted only to `Role.DOCTOR`.
   - Admin and Reception tokens receive HTTP 403 Forbidden on encounters endpoints.
   - Doctor queries use `core/scope.py` `ScopeFamily.CLINICAL` ensuring `encounter.doctor_id == principal.doctor_id`. Unauthorized cross-doctor lookups return 404 Not Found to prevent ID-enumeration leaks.
2. **Note Finalisation:**
   - Doctor creates encounter in draft mode (`is_finalised = False`).
   - Doctor can update draft encounter (`PATCH /api/encounters/{id}`).
   - Doctor finalises encounter (`POST /api/encounters/{id}/finalise`).
   - Once finalised:
     - API rejects any `PATCH` or `DELETE` with HTTP 400 (`encounter_finalised_immutable`).
     - PostgreSQL trigger `trg_prevent_finalised_encounter_update` raises exception if an UPDATE modifies clinical fields (`symptoms`, `clinical_notes`, `diagnosis`, `doctor_id`, `patient_id`) when `OLD.is_finalised = TRUE`.
3. **Addenda Pattern:**
   - Any follow-up observations or amendments must be submitted via `POST /api/encounters/{id}/addenda`.
   - Addenda rows are append-only; each carries `id`, `encounter_id`, `doctor_id`, `addendum_text`, `created_at`.

---

## 4. Work Breakdown Structure (Wave Parallelization)

- **Wave 1:**
  - `13-01-PLAN.md`: Database Models & Migration 0003 (`appointments`, `daily_token_sequences`, `clinical_encounters`, `clinical_addenda`, triggers and indices).
- **Wave 2:**
  - `13-02-PLAN.md`: Daily Token Service, Concurrency Stress Test & Appointment Booking REST Endpoints.
  - `13-03-PLAN.md`: Appointment Status State Machine, Queue Endpoints & Doctor Scoped Queue.
- **Wave 3:**
  - `13-04-PLAN.md`: Clinical Encounter & Addenda REST Endpoints with Strict Doctor Silo & Immutability Enforcement.
- **Wave 4:**
  - `13-05-PLAN.md`: Frontend Reception Appointment Booking Modal & Daily Queue Management Board.
  - `13-06-PLAN.md`: Frontend Doctor Consultation Queue & Clinical Encounter Workspace.
- **Wave 5:**
  - `13-07-PLAN.md`: Phase 13 End-to-End Verification Gate, Coverage Gate & DevTools MCP Testing.
