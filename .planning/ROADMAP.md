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
- [ ] **Phase 18: UI/UX Review Hardening** - Receipt printing from the app, native modal dialogs, non-blocking errors, 12px text and contrast floor, bundled Hindi font and language marking, form accessibility, webcam HTTPS decision, headless print verification.
- [x] **Phase 19: Universal Consultation Workspace** - One consultation for Physiotherapy and Ophthalmology: real drafts with auto-save, new and follow-up encounters, versioned specialty templates, vitals, integrated prescription, follow-up recommendations, read-all edit-own access, one login at a time and a printed summary. (completed 2026-11-06)

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
**Plans**: 7 plans

Plans:

- [x] 13-01-PLAN.md - Database Models & Migration 0003 (Appointments, Token Sequences, Encounters, Addenda)
- [x] 13-02-PLAN.md - Daily Token Service, Concurrency Stress Test & Appointment Booking Endpoints
- [x] 13-03-PLAN.md - Appointment Status State Machine & Doctor Queue API
- [x] 13-04-PLAN.md - Clinical Encounters & Addenda API with Doctor Silo & Note Immutability
- [x] 13-05-PLAN.md - Frontend Reception Appointment Booking Modal & Daily Queue Management Board
- [x] 13-06-PLAN.md - Frontend Doctor Consultation Queue & Clinical Encounter Workspace
- [x] 13-07-PLAN.md - Phase 13 Integration Gate, Coverage Verification & Browser DevTools Validation

### Phase 14: Prescriptions, Treatment Plans & Sessions

**Goal**: Doctors issue printable prescriptions, create treatment plans/packages and log immutable physiotherapy sessions with VAS pain scores.
**Depends on**: Phase 13
**Requirements**: RX-01, TRT-01, TRT-02
**Success Criteria**:

  1. A doctor writes a prescription (medicines, dosage, advice) linked to an encounter and prints it with English text and static Hindi labels using the bundled Devanagari font.
  2. A doctor creates a treatment plan/package for a patient (sessions, price) that billing can reference later.
  3. Sessions are logged with VAS pain score in chronological order; an attempt to edit or delete a session fails at the API and the database, and corrections are recorded only as addenda.
  4. Two simultaneous session entries for the same plan receive distinct, ordered session numbers.
**Plans**: 7 plans

Plans:

- [x] 14-01-PLAN.md - Schema Migration & Core Models (0004 Prescriptions, Plans, Sessions, Addenda)
- [x] 14-02-PLAN.md - Prescriptions REST API (RX-01)
- [x] 14-03-PLAN.md - Treatment Plans & Packages REST API (TRT-01)
- [x] 14-04-PLAN.md - Physiotherapy Sessions & Addenda REST API (TRT-02, TRT-03)
- [x] 14-05-PLAN.md - Frontend Prescriptions Workspace & Print Slip (RX-01)
- [x] 14-06-PLAN.md - Frontend Treatment Plan & Session Logger UI (TRT-01, TRT-02, TRT-03)
- [x] 14-07-PLAN.md - Phase 14 Integration Gate & Quality Verification

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

### Phase 18: UI/UX Review Hardening

**Goal**: Close every finding from the post-acceptance UI/UX and code review of the web frontend, so receipts print from the app, dialogs and forms are accessible, text is legible and offline-safe, and errors never block or vanish.
**Depends on**: Phase 17 (milestone v3.0 accepted); coordinates with the in-flight AppShell/AreaHome redesign so neither overwrites the other
**Requirements**: UX-01, UX-02, UX-03, UX-04, UX-05, UX-06, UX-07, UX-08
**Success Criteria**:

  1. After recording a payment, reception prints the A4 receipt from the app and can reprint it from payment history; reprints carry the DUPLICATE mark; the receipt header (clinic name, address, phone) comes from clinic settings; the receipt, the registration card and the prescription slip each print on one A4 page (receipt paper changed from 80 mm to A4 by client decision, 2026-11-02).
  2. Every pop-up (payment, patient edit, reversal, appointment booking, session logger, session addendum, prescription slip, user and doctor forms) is a native modal dialog: announced as a dialog, background inert, Esc closes it, and focus returns to the control that opened it.
  3. No screen uses a blocking browser `alert()`; backup, user-management and payment failures show a persistent inline message that screen readers announce.
  4. All on-screen text is at least 12px and meets 4.5:1 contrast, and an automated source check prevents regressions; print-only documents are exempt from the size floor.
  5. Hindi text is marked `lang="hi"` and rendered from a bundled Devanagari font that loads with no network, verified with the network disconnected.
  6. Every form control has an accessible name, and validation errors are announced to screen readers only after the user has interacted with the field.
  7. The HTTPS-for-webcam decision is recorded; if approved, the server serves HTTPS with a locally trusted certificate and reception PCs capture photos by webcam, otherwise the camera button explains the fallback and upload still works.
  8. Typecheck, lint, the frontend suite and headless one-page print checks pass, and a manual-check sheet covers the real printer, screen reader and display-scaling items.
**Plans**: 8 plans

Plans:

- [x] 18-01-PLAN.md - Consent for shared files, fix payment/backup request bodies, inline alerts replace alert(), guard start (Wave 1)
- [x] 18-02-PLAN.md - Shared native Modal, jsdom shim, named print pages, migrate 4 overlays (Wave 2)
- [x] 18-03-PLAN.md - Migrate the remaining 14 overlays (Wave 3)
- [x] 18-04-PLAN.md - Receipt dialog, clinic-settings header, payment history reprint, headless print check (Wave 3). CLOSED WITH WAIVER: physical printer test waived by client, not tested
- [x] 18-05-PLAN.md - Text size and contrast fixes with legibility guard (Wave 4). CLOSED 2026-11-03: 17-line patch and guard done; criterion 4 (12px minimum) NOT MET: 36 existing violations in 10 files remain, capped by the guard (measured on phase-18-clean; the earlier 330 text-xs / 82-violation figures came from a tree with an uncommitted 14px root)
- [ ] 18-06-PLAN.md - Bundled Devanagari font and lang="hi" (Wave 5)
- [ ] 18-07-PLAN.md - Webcam HTTPS decision and implementation or upload-only (Wave 5)
- [ ] 18-08-PLAN.md - Form accessibility, final gate and manual-check sheet (Wave 6)

### Phase 19: Universal Consultation Workspace

**Goal**: Doctors in both specialties work one consultation that holds the assessment, specialty template, diagnosis, prescription and follow-up together, can leave and resume it without losing saved work, and can read a patient's earlier records from other doctors.
**Depends on**: Phase 13 and Phase 14 (extends their encounter and prescription work), and PR #17 and PR #12 merged first (departments and visit type). DWS-04 also depends on the EG-6 sign-off todo, and the Hindi labels in DWS-09 depend on Plan 18-06 (bundled font). Sequencing with the rest of Phase 18 is to be settled in planning.
**Requirements**: DWS-01, DWS-02, DWS-03, DWS-04, DWS-05, DWS-06, DWS-07, DWS-08, DWS-09, DWS-10
**Canonical refs**: `.planning/phases/19-universal-consultation-workspace/19-CONTEXT.md`, `.planning/notes/doctor-workspace-direction.md`, `.planning/phases/13-appointments-clinical-encounters/13-LEARNINGS.md`, `.planning/phases/14-prescriptions-treatment-plans-sessions/14-LEARNINGS.md`
**Budget**: Must fit within the existing Rs 22,000 ceiling. No admin template editor. If it needs cutting, vitals (DWS-06) and follow-up recommendations (DWS-08) go first.
**Success Criteria**:

  1. Starting a consultation twice for one appointment opens the same encounter, and the database rejects a second one.
  2. A doctor closes the browser partway through a consultation and returns to the same draft, and the screen never shows "saved" for work the server has not stored.
  3. A patient seen by a physiotherapist and then the eye doctor keeps one URN, with two independent encounters, each on its own specialty template; publishing a new template version leaves both unchanged.
  4. Once EG-6 sign-off is recorded, a doctor can read another doctor's finalised encounter but cannot edit it or add to it; the read appears in the audit log, and Reception and Admin are still denied.
  5. A doctor creates the prescription inside the consultation, enters the diagnosis once, and authorises it; it can only print once authorised, it cannot then be overwritten, a correction cancels and reissues it, and it prints on one A4 page with its Hindi labels.
  6. A follow-up recommendation stays traceable from the original encounter to the appointment booked for it and the follow-up encounter that results; reception sees only its date and doctor.
  7. Physiotherapy packages, VAS session logging and package billing work unchanged, and an Ophthalmology consultation completes with no treatment plan.
  8. After finalising, the patient-copy summary prints on one A4 page using the approved letterhead, with no medicines listed.
  9. A second login on another PC is refused with the option to end the other session; taking over is audited, and a crashed PC never locks an account out.

**Plans**: 7/7 plans complete

Plans:

- [x] 19-01-PLAN.md - Prerequisites & Base Migration (PR alignment, encounter uniqueness, check-in timestamp, single-session login DWS-10) (Wave 1)
- [x] 19-02-PLAN.md - Specialty Clinical Templates & Vitals Engine (migration 0012, template registry, Physiotherapy/Ophthalmology seeds, BMI auto-calc, DWS-05, DWS-06) (Wave 2)
- [x] 19-03-PLAN.md - Prescription Lifecycle & Follow-up Recommendations (migration 0013/0014, draft->authorised->print, cancellation with reason, medicine extra fields, recommendations & reception booking, DWS-07, DWS-08) (Wave 3)
- [x] 19-04-PLAN.md - Centralized Scope & Cross-Doctor Reads (refactor core/scope.py, eliminate inline silo checks, audit log cross-doctor reads, preserve reception/admin denial, DWS-04) (Wave 4)
- [x] 19-05-PLAN.md - Universal Consultation Frontend Workspace (single-page continuous layout with jump list, prior visit copy controls, 3s debounced auto-save, vitals, specialty form, prescription authoring & auth modal, DWS-01, DWS-02, DWS-05, DWS-06, DWS-07) (Wave 5)
- [x] 19-06-PLAN.md - Dashboard Unfinished List & Print Summary (Doctor dashboard unfinished drafts card, consultation summary print component on letterhead without medications DWS-09, 409 session takeover dialog DWS-10) (Wave 6)
- [x] 19-07-PLAN.md - Integration Gate & Verification Suite (test_phase19_gate.py, end-to-end clinical workflow roundtrip, vitest suite, 85% coverage floor, OpenAPI & RBAC snapshot checks) (Wave 7)

## Backlog

- [ ] **999.1 Payment reversal workflow (BIL-05 UI)**: `PaymentReversalModal` and `PatientTimeline` exist but are mounted nowhere, so an admin has no accessible screen to reverse a payment. Outside Phase 18 (UX-01..UX-08); needs its own plan: admin-only entry point from payment history, mandatory reason, accessible dialog, audit and receipt/balance refresh tests. Found in the Phase 18 research (2026-11-02).

## Progress

**Execution Order:**
Phases execute in numeric order: 11 → 12 → 13 → 14 → 15 → 16 → 17 → 18 → 19

| Phase | Plans Complete | Status | Completed |
| --- | --- | --- | --- |
| 11. Decisions Gate, Foundation & Auth | 16/16 | Complete | 2026-10-31 |
| 12. Clinic Settings & Patient Registration | 8/8 | Complete | 2026-11-01 |
| 13. Appointments & Clinical Encounters | 7/7 | Complete | 2026-11-01 |
| 14. Prescriptions, Treatment Plans & Sessions | 7/7 | Complete | 2026-11-02 |
| 15. Billing, Receipts & Reversals | 7/7 | Complete | 2026-11-02 |
| 16. Audit Viewer, Backup/Restore & Integrity | 7/7 | Complete | 2026-11-04 |
| 17. LAN Deployment, Printer & Acceptance | 5/5 | Complete | 2026-11-05 |
| 18. UI/UX Review Hardening | 5/8 | In progress (04 closed with printer waiver; 05 closed with criterion 4 unmet; 06-08 pending) | - |
| 19. Universal Consultation Workspace | 7/7 | Complete | 2026-11-06 |

---
*Roadmap created: 2026-10-30*
