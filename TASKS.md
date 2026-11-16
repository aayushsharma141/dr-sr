# Implementation Roadmap & Phase Status — Kalyan Hospital v3.0

**Status:** Phases 11 through 21 Complete. Phase 22 (Integrated OPD Workflow) In Progress (Waves 1 & 2 Deployed).  
**Platform:** Centralized Offline LAN Web Platform (React 18 + FastAPI + PostgreSQL 16).

## Delivery rules

One testable phase at a time. A feature is not complete merely because a screen exists. Security, financial correctness, audit and restore testing cannot be deferred. Use synthetic data. Keep legacy PySide6 app separate from v3 runtime.

---

## Phase 11 — Foundation and bootstrap
- [x] React + TypeScript frontend and FastAPI backend skeleton.
- [x] PostgreSQL, SQLAlchemy models and Alembic migrations.
- [x] Configuration/secrets strategy for offline deployment.
- [x] One-time first-admin console code and browser setup wizard.
- [x] Atomic code consumption; concurrent bootstrap test; permanent shutdown.
- [x] Individual accounts, modern password hashing (Argon2id), sessions, idle timeout and lockout.
- [x] Fixed permission catalogue and server-side enforcement.
- [x] Route coverage test fails on unguarded protected endpoint.
- [x] Structured logs, request IDs and standard API error contract.
**Status: Complete.** Verified with clean bootstrap, migrations, and authorization matrix tests.

---

## Phase 12 — Clinic setup and patient registry
- [x] Clinic English/Hindi identity, branch addresses, phone and print settings.
- [x] Doctor profiles and consultation fee catalogue.
- [x] Canonical 12-field patient record and photo metadata.
- [x] Transaction-safe URN allocation and duplicate warning.
- [x] Devanagari-safe search by URN/name/mobile.
- [x] Demographic edits with before/after audit.
- [x] Authorized photo upload/download and path validation.
- [x] Registry/detail screens and A4 registration print.
**Status: Complete.** Concurrent registrations yield unique URNs; photo access authorized; print layout verified.

---

## Phase 13 — Appointments and queue
- [x] Daily per-doctor appointments and token numbers.
- [x] Doctor assignment, rescheduling and queue.
- [x] Booked, Arrived, In consultation, Done, Cancelled, No-show states.
- [x] Appointment audit and permission-scoped doctor queue.
**Status: Complete.** Monotonic daily tokens and queue state transitions fully tested.

---

## Phase 14 — Clinical workflows
- [x] Encounter drafts and finalization.
- [x] Immutable finalized notes and dated addenda.
- [x] Prescription items, dosage, frequency, duration and advice.
- [x] Printable prescription with English content/static Hindi labels.
- [x] Treatment plans/packages and session allocation.
- [x] Chronological immutable sessions with VAS, modalities, notes and clinician.
- [x] Unified timeline of encounters, sessions and payments.
**Status: Complete.** Original finalized records preserved; addenda and chronology verified.

---

## Phase 15 — Billing and receipts
- [x] Consultation charges and treatment financial accounts.
- [x] Integer-paise ledger and computed balances.
- [x] Transactional concurrent payment validation; reject negative/overpayment.
- [x] Pending dues list.
- [x] Transaction-safe receipt numbering after client numbering policy.
- [x] Printable receipt; DUPLICATE reprint marker.
- [x] Admin-authorized reversal with mandatory reason.
- [x] Financial audit events.
**Status: Complete.** Concurrency tests verify no overpayments; receipt uniqueness and reversals pass.

---

## Phase 16 — Audit, backup and integrity
- [x] Append-only audit for security, patient, clinical, billing and backup events.
- [x] Admin audit filters and viewer screen.
- [x] PostgreSQL + patient-file backup bundle and checksum manifest.
- [x] Manual and scheduled backup to secondary drive.
- [x] Staged verification and safe restore into isolated database.
- [x] Integrity report: ledger reconciliation, URN gaps/duplicates, orphan files, session counts.
- [x] Clean-machine restore drill.
**Status: Complete.** Corrupt backup rejected; restored data/files match checksums; integrity report operational.

---

## Phase 17 — Deployment and handover
- [x] Central server, fixed LAN address and firewall configuration.
- [x] Browser clients on 3–5 PCs.
- [x] Offline operation with internet disconnected.
- [x] Auto-start after power restoration and controlled recovery.
- [x] UPS and backup drive verification.
- [x] Actual A4 printer verification on plain sheet.
- [x] Role, security, concurrency and data integrity acceptance.
**Status: Complete.** Standard LAN deployment architecture validated.

---

## Phase 18 — UI/UX Review Hardening
- [x] Integrated into baseline build (receipt printing in-app, native modals, non-blocking error banners, typography legibility floor, bundled fonts, form accessibility).
**Status: Complete.** UX guards enforced across frontend components.

---

## Phase 19 — Universal Consultation Workspace (Completed 2026-11-06)
- [x] Universal consultation workspace for Physiotherapy and Ophthalmology.
- [x] Real encounter drafts with debounced auto-save.
- [x] New and follow-up encounter flows.
- [x] Versioned specialty templates (General, Eye, Physiotherapy).
- [x] Vitals recording with automatic BMI computation.
- [x] Integrated Rx pad and follow-up recommendations.
- [x] Read-all, edit-own cross-doctor access policy.
- [x] Printable consultation summary.
**Status: Complete.** 7/7 plans executed.

---

## Phase 20 — Admin Data Governance & Asset Management (Completed 2026-11-08)
- [x] Demographic correction with audit journal.
- [x] Staged 8-phase CSV/XLSX patient import center.
- [x] Controlled patient data export with field filtering and audit.
- [x] Hospital identity, logo, and asset management with versioning.
- [x] Bilingual print template management (Prescription, Receipt, Registration Card).
- [x] Reorganized 5-section Admin navigation architecture.
**Status: Complete.** 8/8 plans executed.

---

## Phase 21 — Build Takeover & System Stabilization (Completed 2026-11-11)
- [x] Frontend test suite remediation (all 65 suites passing cleanly).
- [x] Department-to-doctor memberships and cabin routing fixes.
- [x] Session concurrency and RBAC route coverage tests.
**Status: Complete.** 2/2 plans executed.

---

## Phase 22 — Integrated OPD Workflow (In Progress)
- [x] **Wave 1 (Check-in & Priority Triage):**
  - [x] Unified Check-in & Token desk as primary reception view (`OD-22-01`).
  - [x] Two-column layout: Check-in form + today's appointments panel (`OD-22-02`).
  - [x] Mandatory Referred By with categories (`SELF`, `DOCTOR`, `PERSONAL`, `ORGANIZATION`, `OTHER`) (`OD-22-16`).
  - [x] 3-tier classification (`NORMAL`, `PRIORITY`, `EMERGENCY`) with mandatory reason for non-normal (`OD-22-06`).
  - [x] Single-step registration and check-in for new patients (`OD-22-03`).
- [x] **Wave 2 (Emergency Alert & Doctor Cabin / Waiting Room):**
  - [x] Instant Emergency Alert Banner on assigned doctor's screen (`OD-22-09`).
  - [x] Doctor alert acknowledgment mutation with audit timestamps.
  - [x] Waiting Room with computed priority ordering (Emergency → Priority → Normal) (`OD-22-07`).
  - [x] Same-visit doctor reassignment (`OD-22-08`).
  - [x] Consultation fee snapshot into `bill_items` at check-in (`OD-22-10`).
- [ ] **Wave 3 (Doctor Fee Adjustments & Dispensed Medicines):**
  - [ ] Doctor fee discount/waiver on own consultation with reason (`OD-22-11`).
  - [ ] Reception billing for medicines actually dispensed (`OD-22-13`).
  - [ ] Distinct bill item categories (Consultation, Procedures, Packages, Medicines) (`OD-22-14`).
- [ ] **Wave 4 (Billing & Checkout Consolidation):**
  - [ ] Consolidated checkout screen with previous dues segregation (`OD-22-17`).
  - [ ] Patient Out with balance + mandatory reason (`OD-22-18`).
  - [ ] Integrated thermal and A4 receipt generation.
- [ ] **Wave 5 (OPD Full Workflow UAT & Hardening):**
  - [ ] Automated regression suite and end-to-end multi-station verification.
**Status: In Progress.** Waves 1 & 2 complete; live UAT evaluation completed (160 passed).

---

## Phase 23 — Advanced Data Operations (Deferred)
- [ ] Duplicate patient detection and merge workflow (high-risk FK cascade; dedicated transaction design).
- [ ] Bulk archive and bulk delete for eligible records.
- [ ] Extended data-edit permission controls.
- [ ] LAN workstation status monitoring.
**Status: Deferred.** Follows Phase 22 completion.

---
*Last updated: 2026-11-15 — Kalyan Hospital v3.0 Production Roadmap*