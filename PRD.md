# Product Requirements — Kalyan Hospital v3.0

**Status:** Product baseline for v3; Phases 11–13 are recorded implemented, Phases 14–17 remain planned/incomplete. Client sign-off and deployment acceptance are pending.  
**Baseline:** 2026-11-01. This supersedes the single-workstation PRD for new development.

## 1. Product vision

An internet-independent, centralized hospital workflow platform. One on-premises server provides shared patient records to 3–5 browser-based PCs on the hospital LAN. Reception, doctors and administrators use individual accounts. The server is the system of record for authentication, permissions, database, patient files and audit events; backup operations are a planned Phase 16 capability, not yet delivered.

## 2. Users and roles

These are target role responsibilities; a capability is available only when its phase is implemented.
- **Admin:** user and clinic administration; planned audit/backup oversight and financial reversal authority (reversal policy requires client confirmation).
- **Reception:** patient registration/search/edit, appointments, registration printing and planned permitted billing/dues.
- **Doctor:** own appointment queue and doctor-scoped clinical records; prescriptions, treatment plans and sessions are Phase 14 scope.

Fixed role catalogue for v1; no shared accounts or custom per-user permission builder.

## 3. v1 requirements

### Security and setup
- SEC-01 Individual accounts and role landing routes /admin, /reception, /doctor.
- SEC-02 Every protected API endpoint enforces permission server-side; UI hiding is not authorization.
- SEC-03 Fixed Admin, Reception and Doctor permission catalogue.
- SEC-04 Idle timeout and lockout after repeated failed logins.
- SEC-05 Admin creates/deactivates accounts and resets passwords; first login forces password change; no default credentials.
- SEC-06 Stale updates return conflict response; never silently overwrite newer data.
- SEC-07 First-run wizard only while no administrator exists. A one-time code is printed to the server console, consumed atomically, and public setup is permanently disabled after first admin creation. Recovery is local CLI only.

### Clinic setup
- SET-01 English/Hindi clinic names, both branch addresses, phone and print header/footer.
- SET-02 Doctor profiles: name, qualification, registration number.
- SET-03 Consultation fee catalogue with effective dates and audit.

### Reception and registry
- PAT-01 Implement the client-approved registration form fields and unique KH-YYYY-XXXX URN under concurrent registration. The current API schema stores `full_name`, `guardian_name`, `gender`, `dob`, `age_years`, `mobile`, `address`, `district`, `state`, `emergency_contact`, `allergies` and `notes`; this does not yet map one-to-one to the client form fields listed below. Resolve the mapping before claiming full form parity. Define gap semantics for rolled-back/cancelled records.
- PAT-02 Search URN/name/mobile; Devanagari supported.
- PAT-03 Demographic edits audited with before/after values.
- PAT-04 Duplicate warning for same name + mobile.
- PAT-05 Patient photos stored server-side and served only to authorized users.
- APT-01 Daily appointments per doctor with token and doctor assignment.
- APT-02 Statuses: Booked, Arrived, In consultation, Done, Cancelled, No-show; doctor sees daily queue.
- PRN-01 A4 registration card with Patient/Attendant and Authorized signatures; verify on actual hospital printer.

Client-provided form fields to preserve in the final approved workflow: Serial/URN; patient name; age; sex; address (town/village, district, PIN); mobile; patient in date/time; patient out date/time; reference/referred by; patient condition; number of sessions; total amount; amount paid; balance amount. Patient picture is a separate element. The current API schema additionally stores guardian name, date of birth, emergency contact, allergies and notes; the exact mapping, ownership and lifecycle of each field remains an open requirement.

### Clinical
- CLN-01 Dated clinical encounters and notes.
- CLN-02 Finalized notes immutable; later corrections are dated addenda.
- RX-01 Prescription medicines, dosage and advice; English clinical text with static Hindi labels.
- TRT-01 Treatment plan/package.
- TRT-02 Chronological physiotherapy sessions with VAS 0–10, clinician, modalities and notes.
- TRT-03 Finalized sessions immutable; corrections by addendum.
- CLN-03 One chronological timeline of encounters, sessions and payments.

### Billing
- BIL-01 Consultation fees/installments: cash, UPI, card.
- BIL-02 Integer paise; reject negative and overpayment, including concurrent two-PC attempts.
- BIL-03 Balances computed from ledger; never editable.
- BIL-04 Sequential receipt numbers; print; reprints marked DUPLICATE.
- BIL-05 Admin-authorized reversal with mandatory reason; no silent deletion/edit of posted financial records.

### Audit, backup and deployment
- AUD-01 Append-only audit events for security, patient, clinical, billing and backup operations. The Phase 11 writer/foundation is implemented; complete coverage must be extended as Phase 14–16 modules are delivered.
- AUD-02 Admin filters audit by user, action, entity and date.
- BAK-01 Database + files backup bundle with checksums, manual and scheduled backup, second drive.
- BAK-02 Verify and restore on clean machine as handover gate.
- BAK-03 Integrity report: ledger reconciliation, URN gaps/duplicates, orphan files, session counts.
- DEP-01 Central server and 3–5 browser PCs on LAN, no internet dependency.
- DEP-02 Auto-start after power restoration and recover without routine manual steps.
- DEP-03 Offline, permission, integrity, real-printer and backup/restore acceptance tests.

## 4. Deferred scope

**v2:** VAS trend charts; daily collection and printable dues reports; missed-session list and treatment templates; canned Hindi advice and printable patient summary; backup health banner.

**v4+:** LAN HTTPS/webcam if not in v1 decision; document/scan attachments; SQLite-to-PostgreSQL migration only if genuine legacy data exists and migration is approved.

## 5. Explicit exclusions

IPD, pharmacy, laboratory, advanced ERP, Aadhaar, SMS/WhatsApp, cloud backup, patient portal, ICD/FHIR/ABDM, insurance, GST invoicing pending trust status, custom per-user permissions, drag/drop calendar, websocket live updates and separate installed clients.

## 6. Target technical direction

Implemented v3 stack: React + TypeScript frontend; FastAPI backend; PostgreSQL central database; Alembic migrations; private server-side file storage; one on-premises server and browser clients. Runtime must not require CDN, cloud services or internet. Server hardware assessment remains a deployment prerequisite; PostgreSQL is already the implemented database.

## 7. Open decisions requiring client confirmation

1. Server PC specification, OS, fixed IP and UPS.
2. Doctor visibility: the current implementation enforces a strict doctor silo; confirm whether to retain it or explicitly authorize cross-doctor access. Preserve the current silo until approval.
3. Admin photo viewing and demographic-edit rights; both are currently denied by the role map.
4. Financial reversal authority: current permission mapping reserves reversal for Admin; obtain client approval before Phase 15.
5. Receipt numbering reset: calendar year or financial year.
6. Whether genuine v2 data exists and requires migration.
7. Actual printer model and whether thermal receipts are required.
8. HTTPS required immediately or explicitly accepted HTTP on isolated trusted LAN.
9. Fee catalogue values, idle timeout, lockout thresholds, backup schedule and retention.
10. Patient registration form-to-API schema mapping, including patient in/out, referred by, condition, session count and payment fields.

Do not silently treat recommendations as client approval.

## 8. Acceptance gates

- **A — Secure foundation:** first-admin setup, individual accounts, server-side authorization, migrations, concurrency and automated tests.
- **B — Core workflows:** registry, appointments, clinical records, prescriptions, treatment, billing, receipts and audit.
- **C — Handover:** verified database+files backup, clean-machine restore, integrity report, offline LAN test, actual printer test, power-recovery test and staff walkthrough.

A demo is not production acceptance. Each gate requires recorded test evidence and client approval. The Phase 11 audit writer is a foundation only; full domain coverage remains incomplete until later modules are instrumented.

## 9. Legacy boundary

The existing PySide6/SQLite application is a legacy single-workstation implementation. Reuse reviewed business rules, assets and tests where useful, but do not describe it as v3.0 or share its SQLite file over a network drive.

---
*Proposed v3.0 product baseline; client sign-off pending.*