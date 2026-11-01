---
gsd_state_version: '1.0'
milestone: 'v3.0'
milestone_name: 'Centralized LAN Web Platform'
status: in_progress
progress:
  total_phases: 7
  completed_phases: 3
  active_phase: 14
  percent: 43
---

# Project State: Kalyan Hospital Patient & Physiotherapy Management

## Project reference

See `.planning/PROJECT.md`, `PRD.md`, `ARCHITECTURE.md`, `SECURITY.md` and `DECISIONS.md`.

**Core value:** Reliable, internet-free shared patient records for reception and doctors across the hospital LAN, with server-enforced permissions, auditable clinical history and recoverable data.

## Current position

- **Last completed:** Phase 13 — Appointments & Clinical Encounters (7/7 plans).
- **Next phase:** Phase 14 — Prescriptions, Treatment Plans & Sessions.
- **Status:** Phases 11–13 recorded complete; Phases 14–17 remain.
- **Progress:** 3 of 7 phases complete (43%). This is phase-count progress, not a measure of feature completeness or client acceptance.
- **Last recorded milestone:** 2026-11-01 — Phase 13 gate.

## Phase overview

| Phase | Name | Status | Plans |
|---|---|---|---:|
| 11 | Decisions Gate, Foundation & Auth | Complete (recorded) | 16/16 |
| 12 | Clinic Settings & Patient Registration | Complete (recorded) | 8/8 |
| 13 | Appointments & Clinical Encounters | Complete (recorded) | 7/7 |
| 14 | Prescriptions, Treatment Plans & Sessions | Next | Not started |
| 15 | Billing, Receipts & Reversals | Not started | Not started |
| 16 | Audit Viewer, Backup/Restore & Integrity | Not started | Not started |
| 17 | LAN Deployment, Printer & Acceptance | Not started | Not started |

## Accumulated implementation context

- v2.0 PySide6 + SQLite desktop app (phases 1–10) remains historical reference only.
- Phase 11: PostgreSQL 18.6, SQLAlchemy 2, FastAPI, React/Vite SPA, Argon2id, HttpOnly sessions, CSRF, optimistic locking, first-run console-code setup and append-only audit foundation.
- Phase 12: clinic settings, doctor profiles, fee catalogue, transactional annual URN allocation, duplicate warning, multimodal search, demographic edits with before/after audit, authenticated photo streaming and A4 print spike.
- Phase 13: appointment models/migration, per-doctor daily tokens, appointment state machine, doctor queue, doctor-scoped encounters, finalization lock and addenda.
- Phase 13 gate record reports 422 backend tests, 92.51% backend coverage, 58 frontend tests and 0 lint errors. These figures are recorded from the prior gate; rerun CI on the release candidate.

## Known permission findings

1. `PHOTO_READ` is granted only to Reception, while the patient-photo download endpoint requires it. Admin and Doctor are denied by the current role map.
2. `PATIENT_UPDATE` is granted to Reception only. Admin cannot update demographics under the current role map.
3. Doctor appointments and encounters are scoped to the authenticated doctor. Confirm the strict silo with the client before production.
4. The current `PatientCreate` API schema has 12 fields, but they do not match the client's 12 registration-form categories; visit in/out, referral, condition, session-count and payment-total fields are not represented as equivalent patient fields.
5. Phase 11 provides an audit-event writer/foundation; full audit event coverage across later clinical, billing and backup modules remains incomplete.

Track remediation as code changes with role-allowed and role-denied tests; this documentation branch does not change application code.

## Open client/operations items

Server hardware/OS, fixed IP, UPS, HTTPS policy, doctor visibility approval, Admin demographic-edit policy, photo access policy, receipt numbering year, reversal policy, genuine legacy data/migration, actual printer, backup retention/schedule and final scope acceptance remain subject to client confirmation.

## Next actions

1. Begin Phase 14 planning/specification and keep prescription/session requirements separate from billing work.
2. Resolve the permission findings with explicit client policy decisions and tests.
3. Keep Phase 15–17 requirements planned until their implementation and acceptance evidence exists.
4. Resolve the client registration-form-to-API schema mapping before claiming full PAT-01 completion.
5. Extend audit events as each future module is implemented; do not treat the Phase 11 audit foundation as complete domain coverage.
6. Obtain written client decisions for doctor visibility, Admin photo/demographic permissions, reversal authority and receipt numbering before affected workflows are finalized.

---
*State synchronized to the recorded Phase 13 milestone on 2026-11-01. Documentation update only; no code tests rerun.*
