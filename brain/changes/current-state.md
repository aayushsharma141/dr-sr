# Current Project State

**Snapshot basis:** documentation hygiene branch created from the recorded `main` commit and current phase ledger. This is a project snapshot, not a fresh test run.

## Product

v3 is a centralized offline LAN web platform: one central server and browser clients over the clinic LAN. Legacy PySide6 + SQLite is historical reference only.

## Phase status

The phase ledger records:

| Phase | Scope | Recorded status |
|---|---|---|
| 11 | Foundation, auth, roles, permissions, bootstrap, audit-event foundation | Complete |
| 12 | Clinic settings, doctors/fees, patient registry, URN, search, photos, registration print spike | Complete |
| 13 | Appointments, queues, encounters, finalization and addenda | Complete |
| 14 | Prescriptions, treatment plans/packages, physiotherapy sessions and VAS | Next |
| 15 | Billing, receipts, reversals, patient financial timeline | Not started |
| 16 | Audit viewer, backup/restore, integrity reporting | Not started |
| 17 | Offline LAN deployment and final acceptance | Not started |

Recorded Phase 13 gate evidence: 422 backend tests, 92.51% backend coverage, and 58 frontend tests. These are historical results from the phase gate; they were not rerun as part of this documentation work.

## Known policy/implementation gaps

- Admin and Doctor lack `PHOTO_READ` while the photo endpoint requires it; Reception has it.
- Admin lacks `PATIENT_UPDATE`; Reception has it.
- Strict doctor silo is implemented, but clinical policy confirmation is pending.
- URN allocation is transactional; cancellation/void/gap semantics remain unresolved.
- The audit writer/foundation exists, but full domain coverage and the Admin audit viewer are not complete.
- The current patient API schema does not yet map one-to-one to all fields in the client-provided registration form; PAT-01 is therefore partial pending approved mapping.
- Financial, backup/restore/integrity, and final deployment acceptance phases are not yet delivered.

## Release posture

Phase completion and recorded automated test results do not equal production acceptance. Do not represent the system as production-ready until remaining phases, client policy decisions, real LAN deployment, printer testing, backup/restore verification, and operational acceptance are complete.

For the authoritative phase percentage and detailed gate record, see [planning state](../../.planning/STATE.md).
