# Phase 15: Execution Plan & Wave Decomposition

## Overview of Plans

| Plan | Goal | Requirements |
| :--- | :--- | :--- |
| **15-01** | Database Models, Migration 0005, Triggers & Constraints | `BIL-01`, `BIL-02`, `BIL-05` |
| **15-02** | Atomic Receipt Sequence Service & Concurrency Stress Test | `BIL-04` |
| **15-03** | Payments & Billing REST API with Reversal & Dues Ledger | `BIL-01`, `BIL-02`, `BIL-03`, `BIL-05` |
| **15-04** | Unified Patient Timeline REST API | `CLN-03` |
| **15-05** | Frontend Payment Collection Modal & Thermal/A5 Printable Receipt | `BIL-01`, `BIL-04` |
| **15-06** | Frontend Pending Dues Dashboard, Reversal Modal & Patient Timeline | `BIL-03`, `BIL-05`, `CLN-03` |
| **15-07** | Phase 15 Integration Gate, RBAC Matrix & Quality Certification | Quality Gate |

## Wave Dependency Structure
- **Wave 1:** Plan 15-01 (Database Models & Migration 0005)
- **Wave 2:** Plan 15-02 (Receipt Sequence Service) & Plan 15-03 (Payments & Billing REST API)
- **Wave 3:** Plan 15-04 (Unified Patient Timeline REST API) & Plan 15-05 (Frontend Payment Modal & Receipt)
- **Wave 4:** Plan 15-06 (Frontend Pending Dues, Reversals & Timeline UI)
- **Wave 5:** Plan 15-07 (Phase 15 Gate & Verification)
