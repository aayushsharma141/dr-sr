# Current Project State

**Snapshot basis:** Verified v3.0 codebase, active test suites (1,392 backend tests, 427 frontend tests), and live UAT results on staging database `kalyan_test`.  
**Snapshot date:** 2026-11-15

## Product

v3.0 is an operational centralized offline LAN web platform: one central server hosting a Python FastAPI application server and serving a React 18 + TypeScript SPA across 3–5 LAN workstations. Legacy PySide6 + SQLite is historical reference only.

## Phase status

The phase ledger records:

| Phase | Scope | Recorded status |
|---|---|---|
| 11 | Foundation, auth, roles, permissions, bootstrap, audit-event foundation | Complete |
| 12 | Clinic settings, doctors/fees, patient registry, URN, search, photos, registration print | Complete |
| 13 | Appointments, queues, encounters, finalization and addenda | Complete |
| 14 | Prescriptions, treatment plans/packages, physiotherapy sessions and VAS | Complete |
| 15 | Billing, integer-paise invoices, receipts, reversals, dues ledger | Complete |
| 16 | Audit viewer, backup/restore to secondary drive, integrity reporting | Complete |
| 17 | Offline LAN deployment architecture and acceptance gates | Complete |
| 18 | UI/UX review hardening and legibility guard enforcement | Complete |
| 19 | Universal consultation workspace for Physio and Eye (auto-save drafts, vitals, templates) | Complete |
| 20 | Admin data governance, patient import/export staging, bilingual templates, asset CRUD | Complete |
| 21 | Build takeover, frontend test stabilization (65/65 suites passing) | Complete |
| 22 | Integrated OPD Workflow (Check-in desk, priority triage, doctor emergency alert, fee snapshots) | In Progress (Waves 1 & 2 Live) |
| 23 | Advanced Data Operations (duplicate patient merge, bulk archive/delete) | Deferred |

## Live Test & Verification Evidence

- **Backend Pytest Suite:** 1,392 tests collected, 1,391 passed, 1 skipped (`test_spa_serving.py` pending dist env), 0 failed.
- **Frontend Vitest Suite:** 427 tests across 65 suites, 422 passed, 5 skipped, 0 failed. TypeScript check (`tsc -b`) exits cleanly.
- **Live Staging UAT Suite:** 182 test assertions evaluated live on PostgreSQL `kalyan_test` via `scripts/qa_opd_full_suite.py`:
  - 160 Passed (87.9%)
  - 1 Known Defect: Doctor reassignment without explicit department parameter returns 500 instead of 400 validation error
  - 21 Future Scope: Wave 3/4 doctor fee discounts, dispensed medicine billing, and consolidated checkout modal
  - 0 Blocked workflows

## Active Implementation Scope (Phase 22 OPD Workflow)

1. **Wave 1 (Deployed):** Primary Check-in & Token desk at reception, mandatory Referred By, 3-tier classification (Normal, Priority, Emergency) with mandatory justification, single-step registration & token generation.
2. **Wave 2 (Deployed):** Persistent Doctor Emergency Alert Banner with audit-tracked doctor acknowledgment, Waiting Room with computed priority ordering, consultation fee snapshotting at check-in.
3. **Wave 3 (Open):** Doctor fee discount/waiver on own consultations with reason, reception billing for medicines actually dispensed at checkout.
4. **Wave 4 (Open):** Consolidated checkout modal with separate previous dues collection, Patient Out with balance permitted with reason.
5. **Wave 5 (Open):** Full multi-station OPD regression verification.

## Release posture

The software platform is verified and stable in staging. On-premises physical LAN deployment, Epson A4 desktop printer calibration, and final client operational sign-off will proceed following Wave 3–5 delivery.

For authoritative phase details, see [.planning/STATE.md](../../.planning/STATE.md) and [ROADMAP.md](../../.planning/ROADMAP.md).
