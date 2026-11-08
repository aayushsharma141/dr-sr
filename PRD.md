# Product Requirements — Kalyan Hospital v3.0

**Status:** Proposed baseline; client sign-off and open decisions pending.  
**Baseline:** 2026-11-01. This supersedes the single-workstation PRD for new development.

## 1. Product vision

An internet-independent, centralized hospital workflow platform. One on-premises server provides shared patient records to 3–5 browser-based PCs on the hospital LAN. Reception, doctors and administrators use individual accounts. The server owns authentication, permissions, database, patient files, audit history and backups.

## 2. Users and roles

- **Admin:** users, clinic configuration, doctors, fee catalogue, audit, backup/restore and authorized financial reversals.
- **Reception:** patient registration/search/edit, appointments, registration printing, permitted billing and dues.
- **Doctor:** assigned queue, authorized patient timeline, encounters, prescriptions, treatment plans and sessions.

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
- REC-01 Reception supports patient intake and OPD routing across all configured hospital departments and specialties; specialty-specific clinical workflows remain separately scoped.
- REC-02 Reception selects department/specialty, then an active doctor belonging to that department before booking or walk-in check-in.
- REC-03 Each doctor has an independent daily queue and token sequence; tokens are unique per (doctor_id, appointment_date).
- REC-04 Reception owns payment collection. Only RECEPTION may post payment transactions; ADMIN may read/reconcile and reverse with reason, but cannot collect/post payments. DOCTOR cannot create, edit or reverse payments.
- REC-05 Walk-ins and booked appointments enter the selected doctor's queue through an explicit check-in event; prevent duplicate active queue entries for one visit.
- PAT-01 Canonical 12 fields; unique KH-YYYY-XXXX URN under concurrent registration. Define gap semantics for rolled-back/cancelled records.
- PAT-02 Search URN/name/mobile; Devanagari supported.
- PAT-03 Demographic edits audited with before/after values.
- PAT-04 Duplicate warning for same name + mobile.
- PAT-05 Patient photos stored server-side and served only to authorized users.
- APT-01 Daily appointments per doctor with token and doctor assignment, including department/specialty selection.
- APT-02 Statuses: Booked, Arrived, In consultation, Done, Cancelled, No-show; doctor sees daily queue.
- PRN-01 A4 registration card with Patient/Attendant and Authorized signatures; verify on actual hospital printer.

Canonical 12 fields: Serial/URN; patient name; age; sex; address (town/village, district, PIN); mobile; patient in date/time; patient out date/time; reference/referred by; condition/diagnosis/chief complaints; number of sessions agreed; total agreed fee, paid to date and balance due. Patient picture is a separate element.

### Clinical
- CLN-01 Dated clinical encounters and notes.
- CLN-02 Finalized notes immutable; later corrections are dated addenda.
- RX-01 Prescription medicines, dosage and advice; English clinical text with static Hindi labels.
- TRT-01 Treatment plan/package.
- TRT-02 Chronological physiotherapy sessions with VAS 0–10, clinician, modalities and notes.
- TRT-03 Finalized sessions immutable; corrections by addendum.
- CLN-03 One chronological timeline of encounters, sessions and payments.

### Billing
- BIL-01 Consultation fees/installments: cash, UPI, card; payment creation restricted to RECEPTION.
- BIL-02 Integer paise; reject negative and overpayment, including concurrent two-PC attempts.
- BIL-03 Balances computed from ledger; never editable.
- BIL-04 Sequential receipt numbers; print; reprints marked DUPLICATE.
- BIL-05 Admin-authorized reversal with mandatory reason; no silent deletion/edit of posted financial records.

### Audit, backup and deployment
- AUD-01 Append-only audit for security, patient, clinical, billing and backup events.
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

React + TypeScript frontend; FastAPI backend; PostgreSQL central database; Alembic migrations; private server-side file storage; one on-premises server and browser clients. Runtime must not require CDN, cloud services or internet. PostgreSQL is the recommended target pending server hardware assessment.

## 7. Open decisions requiring client confirmation

1. Server PC specification, OS, fixed IP and UPS.
2. Doctor visibility; recommended read all clinically relevant records, write assigned cases only.
3. Reversal authority; recommended Admin only.
4. Receipt numbering reset: calendar year or financial year.
5. Whether genuine v2 data exists and requires migration.
6. Actual printer model and whether thermal receipts are required.
7. HTTPS required immediately or explicitly accepted HTTP on isolated trusted LAN.
8. Fee catalogue, idle timeout, lockout thresholds, backup schedule and retention.

Do not silently treat recommendations as client approval.

## 8. Acceptance gates

- **A — Secure foundation:** first-admin setup, individual accounts, server-side authorization, migrations, concurrency and automated tests.
- **B — Core workflows:** registry, appointments, clinical records, prescriptions, treatment, billing, receipts and audit.
- **C — Handover:** verified database+files backup, clean-machine restore, integrity report, offline LAN test, actual printer test, power-recovery test and staff walkthrough.

A demo is not production acceptance. Each gate requires recorded test evidence and client approval.

## 9. Legacy boundary

The existing PySide6/SQLite application is a legacy single-workstation implementation. Reuse reviewed business rules, assets and tests where useful, but do not describe it as v3.0 or share its SQLite file over a network drive.

---
*Proposed v3.0 product baseline; client sign-off pending.*