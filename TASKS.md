# Implementation Roadmap — Kalyan Hospital v3.0

**Current status:** Phases 11, 12 and 13 are recorded complete in `.planning/STATE.md`. Phase 14 is next. Phases 15–17 remain unstarted.

**Commercial note:** Prior client budget ceiling was ₹22,000 and the earlier 4–6 week estimate applied to the smaller desktop MVP. The full LAN platform is materially larger; commercial scope, price and schedule must be agreed separately.

## Delivery rules

One testable phase at a time. A feature is not complete merely because a screen exists. Security, financial correctness, audit and restore testing cannot be deferred. Use synthetic data. Keep the legacy PySide6 app separate from v3 runtime. Treat the phase state file as the execution ledger and link each completion claim to tests/evidence.

## Phase 11 — Decisions Gate, Foundation & Auth <badge>Complete — recorded</badge>

- [x] Repository, toolchain, PostgreSQL and backend/frontend scaffolding.
- [x] SQLAlchemy/Alembic baseline and append-only audit-event foundation.
- [x] Individual accounts, Argon2id, sessions, CSRF and logout.
- [x] Idle/session controls and failed-login lockout.
- [x] First-login password change and user administration.
- [x] Fixed Admin/Reception/Doctor permission catalogue and server-side policy enforcement.
- [x] Optimistic concurrency with 409 conflict behavior.
- [x] One-time first-admin console-code wizard and local CLI recovery.
- [x] React SPA role routing and FastAPI serving.
- [x] Phase 11 gate recorded as 16/16 plans in `.planning/STATE.md`.
**Evidence note:** Verify the current CI logs and exact Phase 11 gate commit before release; this documentation pass did not rerun tests.

## Phase 12 — Clinic Settings & Patient Registration <badge>Complete — recorded</badge>

- [x] Clinic settings, doctor profiles and fee catalogue.
- [x] Canonical patient registration fields and private photo metadata/storage.
- [x] Transactional annual `KH-YYYY-XXXX` URN allocation.
- [x] Search by URN/name/mobile, including Devanagari names.
- [x] Duplicate warning for same name and mobile.
- [x] Demographic updates with optimistic locking and before/after audit.
- [x] Authenticated photo upload/download.
- [x] A4 registration-card print spike.
**Evidence note:** Phase 12 is recorded as 8/8 plans complete. Actual printer sign-off remains Phase 17.

## Phase 13 — Appointments & Clinical Encounters <badge>Complete — recorded</badge>

- [x] Appointment models and migration 0003.
- [x] Per-doctor daily token allocation and booking API.
- [x] Appointment status state machine and doctor queue.
- [x] Clinical encounter API, doctor silo, reception default-deny.
- [x] Finalized encounter immutability and dated addenda.
- [x] Reception booking/queue UI and doctor consultation workspace.
- [x] Phase 13 integration gate recorded as 7/7 plans complete.
**Evidence note:** `.planning/STATE.md` records 422 backend tests, 92.51% backend coverage and 58 frontend tests passing at the Phase 13 gate. These are historical recorded results, not a fresh run during this docs update.

## Phase 14 — Prescriptions, Treatment Plans & Sessions

- [ ] Encounter-linked prescription items, dosage, frequency, duration and advice.
- [ ] Printable prescription with English clinical content and static Hindi labels.
- [ ] Treatment plans/packages and session allocation.
- [ ] Chronological physiotherapy sessions with VAS 0–10, clinician, modalities and notes.
- [ ] Finalized session immutability and dated addenda.
- [ ] Unified clinical timeline groundwork; payments join in Phase 15.
**Exit:** API/database immutability, chronology, authorization and print-format tests pass.

## Phase 15 — Billing and Receipts

- [ ] Consultation charges and treatment financial accounts.
- [ ] Integer-paise ledger and computed balances.
- [ ] Transactional concurrent payment validation; reject negative/overpayment.
- [ ] Pending dues list.
- [ ] Transaction-safe receipt numbering after client numbering policy.
- [ ] Printable receipts; DUPLICATE reprint marker.
- [ ] Admin-authorized reversal with mandatory reason.
- [ ] Unified timeline includes payments.
**Exit:** two-PC race tests cannot overpay; receipt uniqueness, reversal and reprint semantics pass.

## Phase 16 — Audit, Backup and Integrity

- [ ] Admin audit viewer and filters.
- [ ] Full append-only audit coverage across security, patient, clinical, billing and backup events.
- [ ] PostgreSQL + patient-file backup bundle and checksum manifest.
- [ ] Manual and scheduled backup to second drive.
- [ ] Staged verification and safe restore.
- [ ] Integrity report: ledger reconciliation, URN gaps/duplicates, orphan files, session counts.
- [ ] Clean-machine restore drill.
**Exit:** corrupt backup rejected; restored data/files match checksums; integrity report reconciles.

## Phase 17 — Deployment and Handover

- [ ] Central server, fixed LAN address and firewall.
- [ ] Browser clients on 3–5 PCs.
- [ ] Offline operation with internet disconnected.
- [ ] Auto-start after power restoration and controlled recovery.
- [ ] UPS and backup drive checks.
- [ ] Actual A4 printer acceptance.
- [ ] Role, security, concurrency and data-integrity acceptance.
- [ ] Staff training, admin guide, backup/restore runbook and signed handover.
**Exit:** deployment acceptance evidence recorded and client signs off.

## Deferred scope

v2 reports: VAS charts, daily collection, printable dues, missed-session reports, treatment templates, canned Hindi advice, patient summary and backup health banner.

v4+: webcam/HTTPS if not in v1 deployment decision, document/scan attachments and conditional legacy SQLite migration.

## Legacy desktop work

Existing PySide6/SQLite implementation and tests belong to the previous desktop milestone. They are not v3 phase completion evidence.

---
*Roadmap execution status synchronized with .planning/STATE.md on 2026-11-01.*
