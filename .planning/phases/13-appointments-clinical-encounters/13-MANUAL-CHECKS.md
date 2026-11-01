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
- Reception role attempting to view or query clinical encounter details returns 403 Forbidden.
- Doctor A attempting to access Doctor B's consultation encounters returns 404 Not Found.
Result: PASS
