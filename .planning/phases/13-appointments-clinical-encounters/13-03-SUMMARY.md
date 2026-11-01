# Summary 13-03: Appointment Status State Machine & Doctor Queue API

**Date:** 2026-11-01  
**Status:** Complete  
**Plan:** `.planning/phases/13-appointments-clinical-encounters/13-03-PLAN.md`

## What Was Done

1. **State Machine Validator (`backend/src/kalyan_api/services/appointment_service.py`):**
   - Implemented `validate_status_transition(appt, target_status, principal, cancellation_reason)`.
   - Permitted paths:
     - `BOOKED` -> `ARRIVED`, `CANCELLED`, `NO_SHOW`.
     - `ARRIVED` -> `IN_CONSULTATION`, `CANCELLED`, `NO_SHOW`.
     - `IN_CONSULTATION` -> `DONE`, `CANCELLED`.
     - Terminal states (`DONE`, `CANCELLED`, `NO_SHOW`) reject further transitions with 422.
   - Enforced non-empty `cancellation_reason` when moving to `CANCELLED`.
   - Enforced doctor-only role for `IN_CONSULTATION` and `DONE`.

2. **Status Update REST Endpoint (`PATCH /api/appointments/{id}/status`):**
   - Protected by `Permission.APPOINTMENT_WRITE`.
   - Validates optimistic locking via `require_version(appt, payload.version_id)` (returns HTTP 409 `version_conflict` on mismatch).
   - Validates state transitions via `appointment_service`.
   - Records `AuditAction.APPOINTMENT_STATUS_UPDATED` with before and after state diffs.

3. **Doctor Queue REST Endpoint (`GET /api/doctor/queue` and `GET /api/appointments/queue/today`):**
   - Protected by `Permission.DASHBOARD_DOCTOR`.
   - Scoped strictly to the logged-in doctor's assigned appointments on the current date (`clock.utcnow().date()`).
   - Returns partitioned queue:
     - `in_consultation`: currently active consultation.
     - `waiting`: patients marked `ARRIVED`, ordered by token number.
     - `booked`: scheduled patients.
     - `completed`: completed or cancelled consultations today.
   - Reception users attempting to access `/api/doctor/queue` receive HTTP 403 Forbidden.

4. **Automated Verification:**
   - Created `backend/tests/test_appointment_status.py` covering:
     - Full valid transition path `BOOKED` -> `ARRIVED` -> `IN_CONSULTATION` -> `DONE`.
     - Invalid status jumps rejected with 422 `invalid_status_transition`.
     - Cancellation reason requirement verified with 422 `cancellation_reason_required`.
     - Stale version patch rejected with 409 `version_conflict`.
     - Doctor queue retrieval and reception default-deny 403.
   - All 5 tests passed.
   - `ruff check backend`: 100% clean.

## Verification Run
```bash
backend\.venv\Scripts\pytest.exe backend\tests\test_appointment_status.py
5 passed, 1 warning in 1.46s
```
