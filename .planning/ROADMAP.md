# Roadmap: Kalyan Hospital v3.0 Centralized LAN Web Platform

## Overview

A 7-phase delivery plan (Phases 11-17, continuing from v2.0 which ended at Phase 10) to replace the single-PC desktop app with one central LAN server: FastAPI + PostgreSQL backend and one React + TypeScript frontend with `/admin`, `/reception` and `/doctor` dashboards. Budget is Rs 22,000 over 4-6 weeks, so phases are ordered by the user's delivery priorities: (1) database, authentication and permissions; (2) clinic settings, doctors and reception registration; (3) appointments and clinical workflows; (4) billing, receipts and reversals; (5) audit, backup/restore and integrity checks; (6) LAN deployment, real-printer testing and acceptance testing. Feature freeze is at the end of Phase 16; Phase 17 is reserved for operations and handover (about 20% of effort).

Ordering notes:
- **AUD-01 (audit event writing) is in Phase 11**, not with the audit viewer, because every later module (patients, clinical, billing, backup) writes audit rows in the same transaction as its business write. Retrofitting audit calls later would mean touching every service. The audit viewer (AUD-02) stays in Phase 16.
- **PRN-01 is owned by Phase 17** (sign-off on the real hospital printer). A registration-card print spike (mm-based A4 `@page`, bundled Devanagari font, signature layout) starts in Phase 12 alongside registration, without owning the requirement, so print drift is found early.
- **CLN-03 (unified timeline) is owned by Phase 15**, because the timeline includes payments and can only be complete once billing exists; encounter and session feeds are built in Phases 13-14.
- **BAK-02 is owned by Phase 16** (restore tooling and rehearsal); Phase 17 repeats the clean-machine restore as part of DEP-03 acceptance.

## Phases

- [ ] **Phase 11: Decisions Gate, Foundation & Auth** - Open decisions closed, repo/PostgreSQL/Alembic scaffold, individual accounts, role-routed login, server-enforced permissions, optimistic concurrency, and the audit-event writer.
- [x] **Phase 12: Clinic Settings & Patient Registration** - Clinic details, doctor profiles, fee list, patient registration with atomic URN, search, edit, duplicate warning and photos (print spike starts).
- [ ] **Phase 13: Appointments & Clinical Encounters** - Per-doctor daily appointments with tokens and status, doctor queue, encounters, finalised notes with addenda.
- [ ] **Phase 14: Prescriptions, Treatment Plans & Sessions** - Bilingual prescriptions, treatment plans/packages, immutable physiotherapy session log with VAS.
- [ ] **Phase 15: Billing, Receipts & Reversals** - Integer-paise payments, computed balances, dues list, gap-free receipts with DUPLICATE reprints, admin reversals, unified patient timeline.
- [ ] **Phase 16: Audit Viewer, Backup/Restore & Integrity** - Audit log viewer, scheduled checksummed backups on a second drive, verified restore, integrity report.
- [ ] **Phase 17: LAN Deployment, Printer & Acceptance** - One-time server install, auto-recovery after power cut, LAN multi-PC offline operation, real-printer sign-off, full acceptance suite.

## Phase Details

### Phase 11: Decisions Gate, Foundation & Auth
**Goal**: Close the open client decisions, stand up the PostgreSQL + FastAPI + React scaffold with migrations, and deliver individual login with server-enforced permissions, safe concurrent updates and an audit-event writer that all later modules use.
**Depends on**: Nothing (first v3.0 phase; v2.0 desktop app is reference only)
**Requirements**: SEC-01, SEC-02, SEC-03, SEC-04, SEC-05, SEC-06, SEC-07, AUD-01
**Entry gate (must be recorded before build work starts)**: server hardware, UPS and fixed IP (and whether client PCs may trust a local certificate); role/permission matrix for Admin, Reception, Doctor; whether doctors may read other doctors' patients (recommended: read yes, write only own); receipt numbering year (calendar vs April-March) and who may authorise a reversal. Unresolved items are logged with a default assumption and an owner.
**Success Criteria**:
  1. The four entry-gate decisions are written down (with client confirmation or an explicit default) before any schema or API work is committed.
  2. A staff member signs in with an individual account and is routed to `/admin`, `/reception` or `/doctor` according to role; a user cannot open another role's dashboard data by typing the URL or calling the API directly.
  3. An automated test enumerates every API route and fails if any route lacks a permission check; a role x endpoint test matrix passes with default-deny behaviour.
  4. Idle sessions expire, repeated failed logins lock the account, and admin can create, deactivate (not delete) and reset users; first login forces a password change and no default credentials exist in the repo or installer.
  5. Two simultaneous edits to the same record result in a 409 conflict for the stale update rather than overwriting, and sign-in, failed-login and user-admin events appear as append-only audit rows.
  6. First-run setup wizard (SEC-07) passes these acceptance tests: with no users the wizard is available; an invalid code is rejected; a valid code creates exactly one administrator; two simultaneous valid submissions produce exactly one success; once an administrator exists every setup endpoint rejects creation, including direct API calls; after a server restart setup stays disabled; the setup code never appears in any HTTP response or application log.
**Plans**: 16 plans (sequential waves 1-16)

Plans:
- [ ] 11-01: Entry-gate register, decisions, toolchain installs (Node 24.22.1, PostgreSQL 18.6), roles and databases (human checkpoints)
- [ ] 11-02: Backend skeleton tracer: settings, session dependency, `/api/health` on real PostgreSQL, error envelope
- [ ] 11-03: Alembic `0001_baseline` (CHECKs, append-only audit triggers, grants) and in-transaction audit writer
- [ ] 11-04: CLI migrate/check-db, revision and durability startup gates, `setup_required`, clock seam, pin canaries
- [ ] 11-05: Login and `/me`, permission catalogue, policy markers, idle/absolute sessions, logout
- [ ] 11-06: 5-failure / 15-minute lockout and per-IP login throttle
- [ ] 11-07: Forced first-login password change, password policy settings, CSRF token and Origin check
- [ ] 11-08: Role dashboards, route-walk permission test, role x endpoint matrix, doctor/reception scope helpers
- [ ] 11-09: Users create/list/get and PATCH with `version_id` and 409 conflict
- [ ] 11-10: Deactivate/reactivate, reset password, unlock
- [ ] 11-11: First-run setup wizard backend (setup mode only, one-time console code, single-admin race guard), `reset-admin-password` CLI, no-default-credentials scan
- [ ] 11-12: Frontend toolchain and API client
- [ ] 11-13: Login to role area, route guards, CSRF token restore, setup notice
- [ ] 11-14: Admin Users screen with conflict banner, change-password page, `/setup` wizard page
- [ ] 11-15: SPA serving from FastAPI with cache headers and traversal tests
- [ ] 11-16: Phase gate: full suite, coverage, legacy-untouched check, manual LAN UAT incl. setup wizard (human checkpoint)

### Phase 12: Clinic Settings & Patient Registration
**Goal**: Admin configures the clinic, doctors and fees; reception registers, finds and edits patients with unique URNs and photos, with the registration-card print spike started.
**Depends on**: Phase 11
**Requirements**: SET-01, SET-02, SET-03, PAT-01, PAT-02, PAT-03, PAT-04, PAT-05
**Success Criteria**:
  1. Admin saves English and Hindi clinic names, both clinic addresses, phone and print header/footer, plus doctor profiles and the consultation fee list; values appear on later screens and print templates.
  2. Reception registers a patient with the 12 canonical fields; 20 parallel registrations produce unique, gap-free `KH-YYYY-XXXX` URNs.
  3. Searching by URN, name (including Devanagari) or mobile returns the right patient, and a same-name-and-mobile registration shows a duplicate warning.
  4. Editing a patient records an audit row with before and after values; a stale concurrent edit is rejected.
  5. A patient photo is uploaded, stored on the server, and is only served to authenticated, authorised users (direct file URL access without a session is refused).
**Plans**: 8 plans

Plans:
- [x] 12-01: Database Models & Migration 0002 (Settings, Doctors, Fees, Patients, Sequences)
- [x] 12-02: Settings, Doctors, Fees REST Endpoints & Concurrency Control
- [x] 12-03: Atomic KH-YYYY-XXXX URN Generator & Reception Registration Endpoint
- [x] 12-04: Multi-Modal Patient Search, Demographic Edit & Authenticated Photo Streaming
- [x] 12-05: Frontend Clinic Settings & Doctor Profiles Management
- [x] 12-06: Frontend Patient Registration, Photo Uploader & Duplicate Warning
- [x] 12-07: Searchable Directory & Detail View with Optimistic Locking
- [x] 12-08: A4 Registration Card Print Spike & Phase 12 Gate Verification

### Phase 13: Appointments & Clinical Encounters
**Goal**: Reception books and tracks per-doctor daily appointments, and doctors work their day's queue and record finalised encounter notes with addenda.
**Depends on**: Phase 12
**Requirements**: APT-01, APT-02, CLN-01, CLN-02
**Success Criteria**:
  1. Reception books an appointment for a patient with a chosen doctor and receives a token number unique per doctor per day.
  2. Appointment status moves through Booked, Arrived, In consultation, Done, Cancelled and No-show, and a doctor sees only their own day's queue in order.
  3. A doctor records an encounter with clinical notes for a patient; reception cannot read clinical note content.
  4. Once a note is finalised it can no longer be edited (rejected at the API); changes appear as dated addenda attached to the original.
**Plans**: TBD

Plans:
- [ ] TBD (created by plan-phase)

### Phase 14: Prescriptions, Treatment Plans & Sessions
**Goal**: Doctors issue printable prescriptions, create treatment plans/packages and log immutable physiotherapy sessions with VAS pain scores.
**Depends on**: Phase 13
**Requirements**: RX-01, TRT-01, TRT-02
**Success Criteria**:
  1. A doctor writes a prescription (medicines, dosage, advice) linked to an encounter and prints it with English text and static Hindi labels using the bundled Devanagari font.
  2. A doctor creates a treatment plan/package for a patient (sessions, price) that billing can reference later.
  3. Sessions are logged with VAS pain score in chronological order; an attempt to edit or delete a session fails at the API and the database, and corrections are recorded only as addenda.
  4. Two simultaneous session entries for the same plan receive distinct, ordered session numbers.
**Plans**: TBD

Plans:
- [ ] TBD (created by plan-phase)

### Phase 15: Billing, Receipts & Reversals
**Goal**: Reception records fees and instalments in integer paise with safe concurrency, receipts are sequential and reprintable as duplicates, admin reverses with a reason, and staff see one patient timeline.
**Depends on**: Phase 14 (treatment plans/packages) and Phase 11 (permissions, audit)
**Requirements**: BIL-01, BIL-02, BIL-03, BIL-04, BIL-05, CLN-03
**Success Criteria**:
  1. Reception records consultation fees and instalment payments by cash, UPI or card; amounts are stored and returned as integer paise end to end.
  2. Overpayments and negative amounts are rejected, including when two PCs submit payments for the same patient at the same moment (concurrency test passes, retries are idempotent).
  3. Outstanding balance is always computed from the ledger (no editable balance field) and a pending-dues list shows patients with unpaid amounts.
  4. Receipts carry gap-free sequential numbers per the agreed year rule, print correctly, and every reprint is marked `DUPLICATE`.
  5. Only Admin can authorise a reversal and must give a reason; the original payment stays visible, the reversal is a new ledger entry, and any delete/edit of payments is blocked.
  6. Doctor and reception see one chronological patient timeline of encounters, sessions and payments, with each role seeing only the content its permissions allow.
**Plans**: TBD

Plans:
- [ ] TBD (created by plan-phase)

### Phase 16: Audit Viewer, Backup/Restore & Integrity
**Goal**: Admin can inspect the audit log, produce scheduled verified backups on a second drive, restore them safely, and run an integrity report.
**Depends on**: Phase 15 (all data modules exist to back up and check)
**Requirements**: AUD-02, BAK-01, BAK-02, BAK-03
**Success Criteria**:
  1. Admin filters the audit log by user, action, entity and date, and sees before/after values for patient edits; non-admins cannot access it.
  2. Admin creates a backup bundle (database dump plus photos plus manifest with checksums) manually and by a schedule, written to a second physical drive; a corrupted bundle is detected by checksum verification.
  3. A backup is verified and restored into a scratch environment, and the restored system opens with the expected patients, payments and photos; a pre-restore snapshot is taken before any live restore.
  4. The integrity report flags balance-vs-ledger mismatches, URN gaps or duplicates, orphan files and session-count discrepancies, and reports clean on good data.
**Plans**: TBD

Plans:
- [ ] TBD (created by plan-phase)

### Phase 17: LAN Deployment, Printer & Acceptance
**Goal**: Install once on the server PC, prove 3-5 browser PCs work over the LAN offline and survive power cuts, sign off the registration card on the real printer, and pass client acceptance.
**Depends on**: Phase 16 (feature freeze)
**Requirements**: DEP-01, DEP-02, DEP-03, PRN-01
**Success Criteria**:
  1. The system is installed once on the central server PC from an offline installer (wheelhouse, built frontend assets, no Node on the server), and 3 to 5 PCs use it through a browser over the LAN with internet disconnected.
  2. After a pull-the-plug power cut, PostgreSQL and the API service start automatically and the system serves requests without manual steps.
  3. The A4 registration card with the approved dual-signature layout is printed on the actual hospital printer and signed off physically against the paper pad.
  4. The acceptance suite passes for offline operation, role permission matrix, data integrity (URN, balances, receipts), real-printer output and a clean-machine backup/restore rehearsal, with client sign-off recorded.
**Plans**: TBD

Plans:
- [ ] TBD (created by plan-phase)

## Progress

**Execution Order:**
Phases execute in numeric order: 11 → 12 → 13 → 14 → 15 → 16 → 17

| Phase | Plans Complete | Status | Completed |
|---|---|---|---|
| 11. Decisions Gate, Foundation & Auth | 0/16 | Planned | - |
| 12. Clinic Settings & Patient Registration | 0/TBD | Not started | - |
| 13. Appointments & Clinical Encounters | 0/TBD | Not started | - |
| 14. Prescriptions, Treatment Plans & Sessions | 0/TBD | Not started | - |
| 15. Billing, Receipts & Reversals | 0/TBD | Not started | - |
| 16. Audit Viewer, Backup/Restore & Integrity | 0/TBD | Not started | - |
| 17. LAN Deployment, Printer & Acceptance | 0/TBD | Not started | - |

---
*Roadmap created: 2026-10-30*
