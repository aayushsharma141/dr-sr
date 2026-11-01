# Roadmap: Kalyan Hospital v3.0 Centralized LAN Web Platform

## Overview

A 7-phase delivery plan (Phases 11–17) for one central offline LAN server: FastAPI + PostgreSQL backend and one React + TypeScript frontend with role-specific areas. The v2 desktop milestone is historical reference only.

**Current state:** Phases 11, 12 and 13 are recorded complete (31 plans total). Phase 14 is next. Phases 15–17 remain planned. See `.planning/STATE.md` for the phase ledger and `SECURITY.md` for permission findings.

## Planning notes

- Phase 11 delivered the audit writer/foundation. Each later module must add its own audit events; full domain coverage remains incomplete through Phases 14–16. The Admin audit viewer belongs to Phase 16.
- The A4 registration-card print spike started in Phase 12; actual printer sign-off belongs to Phase 17.
- Unified timeline including payments belongs to Phase 15, after billing exists.
- Phase 16 owns backup tooling and restore rehearsal; Phase 17 repeats clean-machine restore as deployment acceptance.

## Phases

- [x] **Phase 11: Decisions Gate, Foundation & Auth** — Complete (16/16 plans recorded).
- [x] **Phase 12: Clinic Settings & Patient Registration** — Complete (8/8 plans recorded).
- [x] **Phase 13: Appointments & Clinical Encounters** — Complete (7/7 plans recorded).
- [ ] **Phase 14: Prescriptions, Treatment Plans & Sessions** — Next.
- [ ] **Phase 15: Billing, Receipts & Reversals**.
- [ ] **Phase 16: Audit Viewer, Backup/Restore & Integrity**.
- [ ] **Phase 17: LAN Deployment, Printer & Acceptance**.

## Phase 11: Decisions Gate, Foundation & Auth

**Goal:** PostgreSQL + FastAPI + React scaffold, individual login, server-enforced permissions, safe concurrent updates, first-admin setup and audit-event writer.

**Requirements:** SEC-01–SEC-07, AUD-01.

**Recorded exit:** Phase 11 is marked 16/16 complete in `.planning/STATE.md`. The implementation includes database/migration foundation, account/session controls, role catalogue and policies, optimistic concurrency, bootstrap wizard, frontend role areas and gate checks.

**Completion caveat:** client policy decisions and deployment parameters still require sign-off; phase completion does not mean production acceptance.

## Phase 12: Clinic Settings & Patient Registration

**Goal:** Admin configures clinic identity, doctors and fees; Reception registers, searches and edits patients with unique URNs and photos.

**Requirements:** SET-01–SET-03, PAT-01–PAT-05.

**Plans:** 8/8 recorded complete.
1. [x] 12-01 Database models and migration 0002.
2. [x] 12-02 Settings, doctors, fees endpoints and concurrency.
3. [x] 12-03 Atomic annual URN generator and registration endpoint.
4. [x] 12-04 Search, demographic edit and authenticated photo streaming.
5. [x] 12-05 Frontend clinic settings and doctor profiles.
6. [x] 12-06 Frontend registration, photo uploader and duplicate warning.
7. [x] 12-07 Searchable directory and detail view with optimistic locking.
8. [x] 12-08 A4 registration-card print spike and phase gate.

**Completion caveat:** actual printer acceptance is Phase 17. Current role mapping grants PHOTO_READ and PATIENT_UPDATE only to Reception; see SECURITY.md. The current API patient schema also does not yet map one-to-one to all fields in the client-provided registration form; see PRD.md and brain/decisions/open-questions.md.

## Phase 13: Appointments & Clinical Encounters

**Goal:** Reception books per-doctor appointments; doctors manage their own queue and create/finalize encounter notes with addenda.

**Requirements:** APT-01, APT-02, CLN-01, CLN-02.

**Plans:** 7/7 recorded complete.
1. [x] 13-01 Models and migration 0003.
2. [x] 13-02 Daily token allocation, concurrency tests and booking API.
3. [x] 13-03 Appointment state machine and doctor queue API.
4. [x] 13-04 Clinical encounters, addenda API, doctor silo and note immutability.
5. [x] 13-05 Reception booking modal and queue board.
6. [x] 13-06 Doctor queue and clinical encounter workspace.
7. [x] 13-07 Integration gate, coverage verification and browser validation.

**Recorded gate evidence:** 422 backend tests, 92.51% backend coverage, 58 frontend tests and 0 lint errors, as recorded in `.planning/STATE.md`. These are not a fresh test run from this docs branch.

## Phase 14: Prescriptions, Treatment Plans & Sessions

**Goal:** Doctors issue printable prescriptions, create treatment plans/packages and log immutable physiotherapy sessions with VAS pain scores.

**Requirements:** RX-01, TRT-01, TRT-02, TRT-03.
**Success criteria:**
1. Encounter-linked prescription with medicines, dosage and advice; English clinical content with static Hindi labels.
2. Treatment plan/package with sessions and price, available to the later billing module.
3. Chronological session log with VAS 0–10, clinician, modalities and notes.
4. Finalized sessions cannot be edited/deleted; corrections are dated addenda.
5. Concurrent session allocation produces distinct ordered session numbers.
**Plans:** To be created before implementation.

## Phase 15: Billing, Receipts & Reversals

**Requirements:** BIL-01–BIL-05, CLN-03.
**Success criteria:** integer-paise ledger; derived balances; two-PC overpayment prevention; sequential receipts under client-approved year policy; DUPLICATE reprints; Admin reversal with reason; no silent edits/deletes; unified patient timeline including payments.
**Plans:** To be created.

## Phase 16: Audit Viewer, Backup/Restore & Integrity

**Requirements:** AUD-01 (complete domain coverage), AUD-02, BAK-01–BAK-03.
**Success criteria:** Admin audit filters; PostgreSQL + photo backup bundle with checksum manifest; manual and scheduled backup to second drive; staged verification and safe restore; integrity report; clean-machine restore drill.
**Plans:** To be created.

## Phase 17: LAN Deployment, Printer & Acceptance

**Requirements:** DEP-01–DEP-03, PRN-01.
**Success criteria:** offline installation on central server; 3–5 browser clients; automatic service recovery after power loss; actual A4 printer sign-off; role, security, integrity and restore acceptance with client sign-off.
**Plans:** To be created.

## Progress

| Phase | Plans complete | Status |
|---|---:|---|
| 11. Foundation & Auth | 16/16 | Complete (recorded) |
| 12. Clinic Settings & Patient Registration | 8/8 | Complete (recorded) |
| 13. Appointments & Clinical Encounters | 7/7 | Complete (recorded) |
| 14. Prescriptions, Treatment Plans & Sessions | 0/TBD | Next |
| 15. Billing, Receipts & Reversals | 0/TBD | Not started |
| 16. Audit Viewer, Backup/Restore & Integrity | 0/TBD | Not started |
| 17. LAN Deployment, Printer & Acceptance | 0/TBD | Not started |

---
*Roadmap synchronized to .planning/STATE.md on 2026-11-01. Client acceptance and deployment gates remain open.*
