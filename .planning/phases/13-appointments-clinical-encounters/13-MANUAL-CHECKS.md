# Phase 13 Manual Checks

## M-13-01: Daily Token Allocation (APT-01)

Description: Reception books appointment for a patient with a selected doctor.
Verification:

- Token sequence is generated atomically per doctor per date (e.g. Token #1, #2...).
- Two doctors on the same date have independent token sequences.
Result: PASS

## M-13-02: Queue Status Flow (APT-02)

Description: Reception updates patient arrival and doctor manages consultation state.
Verification:

- Status transitions `BOOKED` -> `ARRIVED` -> `IN_CONSULTATION` -> `DONE` update properly.
- Cancellation requires a mandatory reason.
- Terminal states `DONE` and `CANCELLED` cannot transition back.
Result: PASS

## M-13-03: Doctor Clinical Workspace & Immutability (CLN-01, CLN-02)

Description: Doctor opens consultation workspace, fills clinical findings, and finalises note.
Verification:

- Clinical fields (symptoms, diagnosis, examination, prescription, instructions) persist.
- Clicking "Finalise" locks the encounter note permanently.
- Subsequent changes are made strictly as dated addenda displayed in chronological order.
Result: PASS

## M-13-04: Doctor Silo & Reception Default-Deny (D-03, D-04)

Description: Verify role separation for clinical notes.
Verification:

- Reception role attempting to view or query clinical encounter details returns 403 Forbidden / 404 Not Found (zero info leak).
- Doctor A attempting to access Doctor B's consultation encounters returns 404 Not Found.
Result: PASS

## Live Browser DevTools Walkthrough (2026-11-01)

- **Environment:** Chrome DevTools MCP on `http://localhost:8000` backed by local FastAPI + PostgreSQL 18.
- **Reception Booking:** Logged in as `test.reception`, accessed `/reception/appointments`, verified Token #1 for Ravi Shankar (KH-2026-0001) with Dr. Test Physician.
- **Arrival Status:** Reception marked patient arrived, verified queue counters update to Waiting Room (1).
- **Doctor Consultation:** Logged in as `test.doctor`, navigated to `/doctor`, verified Token #1 appears in live waiting queue.
- **Encounter Draft & Lock:** Doctor opened `/doctor/encounters/new?patient_id=1&appointment_id=1`, entered Symptoms, Clinical Examination Notes, and Diagnosis. Saved draft notes (created encounter #1). Clicked "Finalise Consultation", confirmed modal warning; UI switched to static locked consultation view with lock badge `🔒 Finalised & Locked (11/1/2026)`.
- **Dated Addenda:** Doctor appended follow-up addendum. Verified Addendum #1 immediately appeared in chronological timeline with author and timestamp.
- **Client & Server Silo:** Logged in as `test.reception`, navigated to `/doctor/encounters/1`; client router redirected to `/reception` and API fetch returned 404 Not Found.
- **Queue Synchronization:** Reception viewed `/reception/appointments`; appointment status showed "Completed" with action `Done`.
Result: ALL BROWSER CHECKS PASSED
