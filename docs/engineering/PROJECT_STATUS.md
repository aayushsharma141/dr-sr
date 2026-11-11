# Kalyan Hospital — Engineering Status

## Campaign Status: IN PROGRESS

- **Current Milestone**: M1 / M2 — Integrated GSD Phase 20 Verification & Stabilization Complete
- **Target Architecture**: Offline-first, browser-based, LAN multi-workstation hospital management application
- **Active Git Branch**: `refactor/admin-modules-ssot`
- **Baseline Git Commit**: `2f587384 Merge feature/reception-all-specialties: department-driven specialty and UI fixes`
- **Uncommitted Changes**: Detected and preserved safely (modified frontend/backend files and untracked assets/skills)
- **Environment Boundaries**:
  - Test Database: `kalyan_test` (Enforced safety check: must end with `_test`)
  - Development Database: `kalyan_dev`
  - Production Database: `kalyan` (Protected, zero-access for test runs)
  - Backend Engine: Python 3.12 / FastAPI 0.162 / SQLAlchemy 2.0.55 / Alembic
  - Frontend Engine: React 18 / TypeScript 5 / Vite / TailwindCSS / Lucide-React
  - Primary Test Tools: Vitest 5.0.5 (Frontend), pytest 9.2.0 (Backend)

---

## Baseline Verification Results (M0 / Phase 20 Complete)

- **Frontend Test Suite (`frontend/`)**:
  - Test Files: 54 passed (54/54)
  - Tests: 286 passed, 0 failed, 5 skipped (291 total)
  - TypeScript Check: `tsc -b` exits with 0 errors
  - Linter: `oxlint` found 0 warnings and 0 errors across 145 files
  - Production Bundle: `tsc -b && vite build` built cleanly in 2.85s
- **Backend Test Suite (`backend/`)**:
  - Collected Tests: 1,064 tests collected with 0 errors
  - Phase 20 Integration Gate: 6/6 passed (`test_phase20_gate.py`)
  - Phase 20 Admin Overview & Assets: 13/13 passed (`test_admin_overview.py`, `test_assets_api.py`)
  - Route Policies & OpenAPI Snapshot: 4/4 passed (`test_route_policies.py`, `test_openapi_snapshot.py`)
  - Demographic Correction, Import, Export, Print Templates: 28/28 passed

---

## Module Status Board

| Module | Audit (M1) | Repairs (M3) | E2E Tests (M4) | Status |
| --- | --- | --- | --- | --- |
| Authentication & Sessions | Pending | Pending | Pending | In Progress |
| Patient Directory & Registration | Pending | Pending | Pending | In Progress |
| Reception & Queue Allocation | Pending | Pending | Pending | In Progress |
| Appointments & Scheduling | Pending | Pending | Pending | In Progress |
| Doctor Workspaces & Queues | Pending | Pending | Pending | In Progress |
| Clinical Encounters & Vitals | Pending | Pending | Pending | In Progress |
| Prescriptions & Medicines | Pending | Pending | Pending | In Progress |
| Treatment Plans & Packages | Pending | Pending | Pending | In Progress |
| Treatment Session Logger | Pending | Pending | Pending | In Progress |
| Billing & Unified Invoices | Pending | Pending | Pending | In Progress |
| Payment Transactions & Receipts | Pending | Pending | Pending | In Progress |
| Admin Governance & Modules SSOT | Verified | Verified | Pending E2E | VERIFIED (Tests Green) |
| Backup & Restore Operations | Verified | Verified | Pending E2E | VERIFIED (Tests Green) |
| Database Integrity & Trigger Audit | Pending | Pending | Pending | In Progress |
| Offline LAN & Multi-Station Sync | Pending | Pending | Pending | In Progress |

---

## Critical Workflow Status (WF-001 to WF-017)

| Workflow ID | Name | Test Coverage | DB Constraint | UI State | Final Status |
| --- | --- | --- | --- | --- | --- |
| WF-001 | Patient Registration (New URN) | Verified (Unit) | Verified | Pending E2E | IN PROGRESS |
| WF-002 | Repeat Patient Visit (URN Preserved) | Verified (Unit) | Verified | Pending E2E | IN PROGRESS |
| WF-003 | Appointment Booking & Rescheduling | Verified (Unit) | Verified | Pending E2E | IN PROGRESS |
| WF-004 | Walk-in Registration & Queue Token | Verified (Unit) | Verified | Pending E2E | IN PROGRESS |
| WF-005 | Doctor-wise Queue Lifecycle | Verified (Unit) | Verified | Pending E2E | IN PROGRESS |
| WF-006 | Doctor Consultation & Encounter Notes | Verified (Unit) | Verified | Pending E2E | IN PROGRESS |
| WF-007 | Multi-Doctor Transfer (Same Visit) | Pending Audit | Verified | Pending E2E | BLOCKED |
| WF-008 | Consolidated Billing (Multi-Charge) | Verified (Unit) | Verified | Pending E2E | IN PROGRESS |
| WF-009 | Reception Payment & Receipt Generation | Verified (Unit) | Verified | Pending E2E | IN PROGRESS |
| WF-010 | Physiotherapy Package Purchase | Verified (Unit) | Verified | Pending E2E | IN PROGRESS |
| WF-011 | Treatment Session Deduction on Completion | Verified (Unit) | Verified | Pending E2E | IN PROGRESS |
| WF-012 | Dashboard & Live Queue Synchronization | Verified (Unit) | Verified | Pending E2E | IN PROGRESS |
| WF-013 | Patient Medical History & Timeline | Verified (Unit) | Verified | Pending E2E | IN PROGRESS |
| WF-014 | Role-Based Permissions (Doctor/Reception/Admin) | Verified (Unit) | Verified | Pending E2E | IN PROGRESS |
| WF-015 | Financial Reports & Ledger Reconciliation | Pending Audit | Verified | Pending E2E | BLOCKED |
| WF-016 | Offline LAN Multi-Workstation Access | Pending Audit | Pending | Pending E2E | BLOCKED |
| WF-017 | Local Database Backup & Restoration | Pending Audit | Verified | Failing Tests | BLOCKED |

---

## Milestone Release Gates

- [x] **Gate 0 (Baseline)**: Safe baseline, Git checkpoint recorded, test suites inventoried, rules & governance active.
- [ ] **Gate A (Discovery)**: Parallel audits complete (01 through 06 reports delivered in `docs/engineering/audits/`).
- [ ] **Gate B (Integration Design)**: Module inventory, API inventory, database schema, and process maps consolidated.
- [ ] **Gate C (Controlled Repairs)**: Single-writer repairs for failing frontend tests and integration bugs completed.
- [ ] **Gate D (Independent Verification)**: Adversarial challenger and QA tests executed.
- [ ] **Gate E (Final Acceptance)**: All 17 workflows verified end-to-end with evidence; release readiness report approved.
