# Implementation Roadmap — Kalyan Hospital v3.0

**Status:** Planned, not implemented.  
**Commercial note:** Prior client budget ceiling was ₹22,000 and prior 4–6 week estimate related to the smaller desktop MVP. Full v3 scope is materially larger; re-scope price and schedule before promising delivery.

## Delivery rules

One testable phase at a time. A feature is not complete merely because a screen exists. Security, financial correctness, audit and restore testing cannot be deferred. Use synthetic data. Keep legacy PySide6 app separate from v3 runtime.

## Phase 11 — Foundation and bootstrap
- [ ] React + TypeScript frontend and FastAPI backend skeleton.
- [ ] PostgreSQL, SQLAlchemy models and Alembic migrations.
- [ ] Configuration/secrets strategy for offline deployment.
- [ ] One-time first-admin console code and browser setup wizard.
- [ ] Atomic code consumption; concurrent bootstrap test; permanent shutdown.
- [ ] Individual accounts, modern password hashing, sessions, idle timeout and lockout.
- [ ] Fixed permission catalogue and server-side enforcement.
- [ ] Route coverage test fails on unguarded protected endpoint.
- [ ] Structured logs, request IDs and standard API error contract.
**Exit:** clean install creates exactly one admin; no defaults; migrations and authorization tests pass.

## Phase 12 — Clinic setup and patient registry
- [ ] Clinic English/Hindi identity, branch addresses, phone and print settings.
- [ ] Doctor profiles and consultation fee catalogue.
- [ ] Canonical 12-field patient record and photo metadata.
- [ ] Transaction-safe URN allocation and duplicate warning.
- [ ] Devanagari-safe search by URN/name/mobile.
- [ ] Demographic edits with before/after audit.
- [ ] Authorized photo upload/download and path validation.
- [ ] Registry/detail screens and A4 registration print.
**Exit:** concurrent registrations yield unique URNs; unauthorized photo access denied; actual printer verified.

## Phase 13 — Appointments and queue
- [ ] Daily per-doctor appointments and token numbers.
- [ ] Doctor assignment, rescheduling and queue.
- [ ] Booked, Arrived, In consultation, Done, Cancelled, No-show states.
- [ ] Appointment audit and permission-scoped doctor queue.
**Exit:** concurrent token allocation and state transitions tested.

## Phase 14 — Clinical workflows
- [ ] Encounter drafts and finalization.
- [ ] Immutable finalized notes and dated addenda.
- [ ] Prescription items, dosage, frequency, duration and advice.
- [ ] Printable prescription with English content/static Hindi labels.
- [ ] Treatment plans/packages and session allocation.
- [ ] Chronological immutable sessions with VAS, modalities, notes and clinician.
- [ ] Unified timeline of encounters, sessions and payments.
**Exit:** original finalized records preserved; addenda and chronology verified.

## Phase 15 — Billing and receipts
- [ ] Consultation charges and treatment financial accounts.
- [ ] Integer-paise ledger and computed balances.
- [ ] Transactional concurrent payment validation; reject negative/overpayment.
- [ ] Pending dues list.
- [ ] Transaction-safe receipt numbering after client numbering policy.
- [ ] Printable receipt; DUPLICATE reprint marker.
- [ ] Admin-authorized reversal with mandatory reason.
- [ ] Financial audit events.
**Exit:** two-PC race tests cannot overpay; receipt uniqueness, reversal and reprint semantics pass.

## Phase 16 — Audit, backup and integrity
- [ ] Append-only audit for security, patient, clinical, billing and backup events.
- [ ] Admin audit filters.
- [ ] PostgreSQL + patient-file backup bundle and checksum manifest.
- [ ] Manual and scheduled backup to second drive.
- [ ] Staged verification and safe restore.
- [ ] Integrity report: ledger reconciliation, URN gaps/duplicates, orphan files, session counts.
- [ ] Clean-machine restore drill.
**Exit:** corrupt backup rejected; restored data/files match checksums; integrity report reconciles.

## Phase 17 — Deployment and handover
- [ ] Central server, fixed LAN address and firewall.
- [ ] Browser clients on 3–5 PCs.
- [ ] Offline operation with internet disconnected.
- [ ] Auto-start after power restoration and controlled recovery.
- [ ] UPS and backup drive checks.
- [ ] Actual A4 printer acceptance.
- [ ] Role, security, concurrency and data integrity acceptance.
- [ ] Staff training, admin guide, backup/restore runbook and signed handover.
**Exit:** DEP acceptance evidence recorded and client signs off.

## Deferred
v2 reports: VAS charts, daily collection, printable dues, missed-session reports, treatment templates, canned Hindi advice, patient summary and backup health banner.

v4+: webcam/HTTPS if not in v1 deployment decision, document/scan attachments and conditional legacy SQLite migration.

## Traceability
Requirement-to-phase mapping is maintained in .planning/REQUIREMENTS.md. Each requirement needs an acceptance test and evidence artifact before release.

## Legacy desktop work
Existing PySide6/SQLite implementation and tests belong to the previous desktop milestone. They are not v3 phase completion evidence.

---
*This roadmap is the v3 plan; execution has not begun.*