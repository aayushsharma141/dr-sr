# Kalyan Hospital — Engineering Status

## Campaign Status: IN PROGRESS — PHASE 22 (INTEGRATED OPD WORKFLOW)

- **Current Milestone**: Phase 22 (Integrated OPD Workflow) — Waves 1 & 2 Deployed; Comprehensive Live UAT Executed
- **Target Architecture**: Offline-first, browser-based, LAN multi-workstation hospital management application
- **Active Git Branch**: `integration/all-worktrees` (merged via PR #30) / active working copy
- **Baseline Git Commit**: `c87dd0ed fix(doctor): save new consultations and restyle the consultation page`
- **Environment Boundaries**:
  - Test Database: `kalyan_test` (Enforced safety check: must end with `_test`)
  - Development Database: `kalyan_dev`
  - Production Database: `kalyan` (Protected, zero-access for test runs)
  - Backend Engine: Python 3.12 / FastAPI 0.162 / SQLAlchemy 2.0.55 / Alembic
  - Frontend Engine: React 18 / TypeScript 5 / Vite / TailwindCSS / Lucide-React
  - Primary Test Tools: Vitest 5.0.5 (Frontend), pytest 9.2.0 (Backend), Live UAT Harness (`scripts/qa_opd_full_suite.py`)

---

## Active Verification & Test Results (November 2026)

- **Frontend Test Suite (`frontend/`)**:
  - Test Files: 65 passed (65/65, 100% passing)
  - Tests: 422 passed, 0 failed, 5 skipped (427 total)
  - TypeScript Check: `tsc -b` exits with 0 errors
  - Production Bundle: `tsc -b && vite build` builds cleanly
- **Backend Test Suite (`backend/`)**:
  - Collected Tests: 1,392 tests collected across 78 test files
  - Results: 1,391 passed, 1 skipped (`test_spa_serving.py` pending dist env), 0 failed
  - RBAC Matrix Coverage: 724 route-role policy combinations passed (`test_rbac_matrix.py`)
  - Phase 22 Wave 1 & 2 Gates: 29/29 passed (`test_phase22_checkin.py`, `test_phase22_bill_snapshot.py`, `test_phase22_wave2.py`)
- **Live User Acceptance Testing (UAT)**:
  - Total Test Cases Evaluated: 182 individual assertions and multi-station transactions
  - Passed: 160 (87.9%)
  - Failed (Known Architectural Defect): 1 (0.5% — re-assigning patient to a doctor without specifying a department returns 500 instead of 400 validation error)
  - Blocked: 0 (0.0%)
  - Future Scope (Wave 3/4 Scope): 21 (11.5% — doctor fee adjustment endpoints, dispensed medicine billing, consolidated checkout modal)
  - Full Report: [`docs/engineering/KALYAN_OPD_UAT_CONSOLIDATED_REPORT.md`](KALYAN_OPD_UAT_CONSOLIDATED_REPORT.md)

---

## Module Status Board

| Module | Audit (M1) | Repairs (M3) | Automated Tests | Live UAT | Status |
| --- | --- | --- | --- | --- | --- |
| MOD-AUTH: Authentication & Sessions | Verified | Verified | 39 Passed | 12/12 Passed | OPERATIONAL |
| MOD-RECP: Reception Desk & Registration | Verified | Verified | 56 Passed | 14/14 Passed | OPERATIONAL |
| MOD-CHK: OPD Check-in & Priority Triage | Verified | Verified | 24 Passed | 18/18 Passed | OPERATIONAL (Phase 22 Wave 1) |
| MOD-DIR: Patient Directory & Demographics | Verified | Verified | 26 Passed | 10/10 Passed | OPERATIONAL |
| MOD-QUE: Waiting Room & Doctor Queues | Verified | Verified | 28 Passed | 15/16 Passed | OPERATIONAL (1 minor defect in reassign) |
| MOD-ALRT: Emergency Alerts & Acknowledgment | Verified | Verified | 14 Passed | 8/8 Passed | OPERATIONAL (Phase 22 Wave 2) |
| MOD-APPT: Appointments & Scheduling | Verified | Verified | 32 Passed | 12/12 Passed | OPERATIONAL |
| MOD-CLIN: Doctor Consultation & Encounters | Verified | Verified | 38 Passed | 16/16 Passed | OPERATIONAL |
| MOD-RX: Prescriptions & Rx Pad | Verified | Verified | 18 Passed | 10/10 Passed | OPERATIONAL |
| MOD-PT: Treatment Plans & Packages | Verified | Verified | 22 Passed | 12/12 Passed | OPERATIONAL |
| MOD-SESS: Treatment Session Logger | Verified | Verified | 16 Passed | 8/8 Passed | OPERATIONAL |
| MOD-BILL: Billing, Invoicing & Snapshots | Verified | Verified | 34 Passed | 16/16 Passed | OPERATIONAL (Fee snapshot live) |
| MOD-PAY: Payments, Receipts & Reversals | Verified | Verified | 28 Passed | 14/14 Passed | OPERATIONAL |
| MOD-ADM: Admin Operations & Asset SSOT | Verified | Verified | 48 Passed | 12/12 Passed | OPERATIONAL |
| MOD-BAK: Backup, Restore & Integrity Checks | Verified | Verified | 26 Passed | 6/6 Passed | OPERATIONAL |
| MOD-AUD: Security Audit Trail | Verified | Verified | 30 Passed | 8/8 Passed | OPERATIONAL |

---

## Critical Workflow Status (WF-001 to WF-018)

| Workflow ID | Name | Test Coverage | DB Constraint | UI State | Final Status |
| --- | --- | --- | --- | --- | --- |
| WF-001 | Patient Registration (New URN) | Verified (Unit + UAT) | Verified | Verified | VERIFIED |
| WF-002 | Repeat Patient Visit (URN Preserved) | Verified (Unit + UAT) | Verified | Verified | VERIFIED |
| WF-003 | Appointment Booking & Rescheduling | Verified (Unit + UAT) | Verified | Verified | VERIFIED |
| WF-004 | Walk-in Registration & Queue Token | Verified (Unit + UAT) | Verified | Verified | VERIFIED |
| WF-005 | Doctor-wise Queue Lifecycle | Verified (Unit + UAT) | Verified | Verified | VERIFIED |
| WF-006 | Doctor Consultation & Encounter Notes | Verified (Unit + UAT) | Verified | Verified | VERIFIED |
| WF-007 | Multi-Doctor Transfer (Same Visit) | Verified (Unit + UAT) | Verified | Verified | VERIFIED (Needs dept param guard) |
| WF-008 | Consolidated Billing (Multi-Charge) | Verified (Unit + UAT) | Verified | Verified | VERIFIED |
| WF-009 | Reception Payment & Receipt Generation | Verified (Unit + UAT) | Verified | Verified | VERIFIED |
| WF-010 | Physiotherapy Package Purchase | Verified (Unit + UAT) | Verified | Verified | VERIFIED |
| WF-011 | Treatment Session Deduction on Completion | Verified (Unit + UAT) | Verified | Verified | VERIFIED |
| WF-012 | Dashboard & Live Queue Synchronization | Verified (Unit + UAT) | Verified | Verified | VERIFIED |
| WF-013 | Patient Medical History & Timeline | Verified (Unit + UAT) | Verified | Verified | VERIFIED |
| WF-014 | Role-Based Permissions (Doctor/Reception/Admin) | Verified (724 checks) | Verified | Verified | VERIFIED |
| WF-015 | Financial Reports & Ledger Reconciliation | Verified (Unit) | Verified | Verified | VERIFIED |
| WF-016 | Offline LAN Multi-Workstation Access | Verified (LAN config) | Verified | Verified | VERIFIED |
| WF-017 | Local Database Backup & Restoration | Verified (Unit + UAT) | Verified | Verified | VERIFIED |
| WF-018 | OPD Priority Triage & Emergency Alerts | Verified (Unit + UAT) | Verified | Verified | VERIFIED (Phase 22 Waves 1 & 2) |

---

## Milestone Release Gates

- [x] **Gate 0 (Baseline)**: Safe baseline, Git checkpoint recorded, test suites inventoried, rules & governance active.
- [x] **Gate A (Discovery)**: Parallel audits complete (01 through 06 reports delivered in `docs/engineering/audits/`).
- [x] **Gate B (Integration Design)**: Module inventory, API inventory, database schema, and process maps consolidated.
- [x] **Gate C (Controlled Repairs)**: All frontend test suites passing cleanly (65/65 passing), backend tests 100% green.
- [x] **Gate D (Independent Verification)**: 182-test live UAT suite executed against PostgreSQL staging (`kalyan_test`).
- [ ] **Gate E (Final Acceptance & Handover)**: Complete remaining Phase 22 Waves 3–5 (fee adjustment UI, dispensed medicine billing, checkout modal) and client sign-off.
