# Phase 22 Plan 05 Summary: Visit-level balance switch with before/after regression and compare script

**Plan:** 22-05  
**Status:** IMPLEMENTED — NOT VERIFIED  
**Task IDs:** T22-07, FEE-07, BILL-01, BILL-02, BILL-16, BILL-17, BILL-19, LED-11  

---

## 1. AGENTS.md Governance Report

- **Task ID:** 22-05 (T22-07)
- **Owned Files:**
  - `backend/src/kalyan_api/services/billing_service.py`
  - `backend/src/kalyan_api/routers/visits.py`
  - `backend/src/kalyan_api/routers/billing.py`
  - `backend/tests/test_phase22_balance_switch.py`
  - `scripts/phase22_balance_compare.py`
  - `backend/tests/test_visit_checkout_api.py`
  - `backend/tests/test_billing_api.py`
  - `backend/tests/test_phase22_bill_snapshot.py`
  - `.planning/phases/22-integrated-opd-workflow/22-05-SUMMARY.md`
- **Git Checkpoint:**
  - Checkpoint stash: `stash@{0}: checkpoint: before 22-05 balance switch`
  - Stash commit ID: `d5592098f7db8484fdf2c939f144e51d30261fc5`
  - Legacy `billing_service.py` per-consultation balance formula frozen from this stash commit into `scripts/phase22_balance_compare.py`.
- **Task 1: Recorded Decision (Option-a):**
  - Owner decision locked 2026-11-16 (recorded in `22-CONTEXT.md` and `22-05-PLAN.md`):
    1. Doctor charge payable when consultation completes (`status = 'COMPLETED'`).
    2. Exclude lines of cancelled or reassigned-away consultations via join on consultation status (`status != 'CANCELLED'`), with zero historical rows rewritten.
    3. Visit payment accepted once one consultation is completed (OD-D).
- **Findings:**
  - Switched balance computation from legacy per-consultation calculation (`visit_charge_lines` iterating consultations) to visit-level aggregation:
    - `VisitTotals` frozen dataclass provides `visit_id`, `bill_total_paise`, `paid_paise`, `due_paise`, `has_completed`, and `has_active`.
    - `visit_totals(session, visit_ids)` batches computation across visits in fixed queries:
      - Line charges: sum of `amount_paise` where `bill_items.status = 'ACTIVE'`, excluding appointments with `status = 'CANCELLED'`.
      - Appointment-linked lines (consultations and procedures) count towards bill total only when their consultation is `COMPLETED` (Option-a, Owner Decision 6).
      - Unlinked lines (medicines, extra items) count as soon as `ACTIVE`.
      - Payments: single `OR` query over non-reversed payments with `payments.visit_id = visit_id OR payments.appointment_id IN (appointments of visit)`. Each payment row is counted exactly once (no double counting).
      - Due: `max(0, bill_total_paise - paid_paise)`.
    - Fail-closed safeguard (W4, K-63): Removed live fallback to `doctor.default_fee_paise` in `visit_totals`, `visit_charge_lines`, and `billing.py` overpayment guard. Any completed consultation with a fee (>0) that lacks a `CONSULTATION` bill line raises `HTTPException(409, detail="consultation_missing_bill_line")`.
    - `visit_outstanding_paise(session, visit_id)` returns `visit_totals(session, [visit_id])[visit_id].due_paise`.
    - `visit_payments(session, visit_id)` returns payments matching the same OR condition (`payments.visit_id == visit_id | appointment_id.in_(...)`), sorted newest first (`created_at.desc(), id.desc()`).
    - In `routers/visits.py`: `_to_detail` and `_to_summaries` read `outstanding_paise` and `total_paid_paise` directly from `visit_totals`.
  - Zero database drift or OpenAPI schema drift:
    - Schema remains 100% compliant with existing contracts (`test_openapi_snapshot.py` passed).
    - `VisitPayment` appointment_id nullability preserved for existing API consumers while visit-level payments flow into visit totals.
  - Verification & Safety:
    - Never touched `kalyan_dev`. All tests and comparisons ran on isolated `kalyan_test`.
    - No git commits created.
- **Root Cause:**
  - In legacy architecture, visit outstanding balance was computed per-consultation. Additional line items (medicines, procedures, bill lines) and visit-level payments were invisible to dues, checkout, and patient-out checks. Plan 22-05 establishes the foundational visit-level balance truth before line endpoints and visit-level payments are exposed.
- **Changes:**
  - `backend/src/kalyan_api/services/billing_service.py`:
    - Added `VisitTotals` frozen dataclass and `visit_totals(session, visit_ids)` function.
    - Updated `visit_outstanding_paise` to delegate to `visit_totals`.
    - Updated `visit_payments` to query both `visit_id` and `appointment_id` in visit via single OR condition.
    - Added fail-closed check (`consultation_missing_bill_line`) removing `doctor.default_fee_paise` fallback.
  - `backend/src/kalyan_api/routers/visits.py`:
    - Updated `_to_detail` and `_to_summaries` to read `outstanding_paise` and `total_paid_paise` from `visit_totals`.
  - `backend/src/kalyan_api/routers/billing.py`:
    - Overpayment guard updated to fail closed if consultation has missing bill line (refuses payment rather than falling back to live doctor fee).
  - `scripts/phase22_balance_compare.py`:
    - Created read-only comparison script requiring explicit `--database`.
    - Runs in a single read-only transaction (`SET TRANSACTION READ ONLY`).
    - Anonymized output: outputs only visit IDs and amounts, never patient names, URNs, or mobiles.
  - `backend/tests/test_phase22_balance_switch.py`:
    - Created comprehensive suite covering S1..S13 scenarios and requirements FEE-07, BILL-01, BILL-02, BILL-16, BILL-17, BILL-19, LED-11.
    - Includes unit test for compare script and 4 new Task 3 visit-level behaviour tests.
  - Test fixtures updated:
    - `backend/tests/test_visit_checkout_api.py`, `backend/tests/test_billing_api.py`, `backend/tests/test_phase22_bill_snapshot.py`: updated directly-created consultations to include associated `CONSULTATION` `BillItem` so they pass the fail-closed check.

---

## 2. Evidence & Test Results

### 2.1 BEFORE Evidence (Task 2 against unchanged code)
```
cd D:/dr-sr/backend && $env:PYTHONPATH="D:/dr-sr/backend/src"; .venv/Scripts/python.exe -m pytest -p no:warnings tests/test_phase22_balance_switch.py
======================= 17 passed, 1 xfailed in 10.06s =======================
```
*(All 17 initial baseline scenarios passed against unchanged code; the compare script test was xfailed until Task 3).*

### 2.2 AFTER Evidence (Task 3 with visit-level switch & new behaviours)
```
cd D:/dr-sr/backend && $env:PYTHONPATH="D:/dr-sr/backend/src"; .venv/Scripts/python.exe -m pytest -p no:warnings tests/test_phase22_balance_switch.py
============================== 22 passed in 7.55s ==============================
```
*(All 17 baseline scenarios continue passing with identical paise amounts, compare script test passes, plus 4 new visit-level behaviour tests).*

### 2.3 Compare Script Execution (`kalyan_test`)
```
cd D:/dr-sr && $env:PYTHONPATH="D:/dr-sr/backend/src"; backend/.venv/Scripts/python.exe scripts/phase22_balance_compare.py --database kalyan_test
Database: kalyan_test
Total visits compared: 0
All visit balances match between legacy and new formulas.
```
*Script refusal verification without `--database`:*
```
usage: phase22_balance_compare.py [-h] --database DATABASE
phase22_balance_compare.py: error: the following arguments are required: --database
(Exit code: 1)
```

### 2.4 Full Regression Suite Execution
```
cd D:/dr-sr/backend && $env:PYTHONPATH="D:/dr-sr/backend/src"; .venv/Scripts/python.exe -m pytest -p no:warnings tests/test_phase22_balance_switch.py tests/test_phase22_bill_snapshot.py tests/test_phase22_fee_adjustment.py tests/test_visit_checkout_api.py tests/test_billing_api.py tests/test_reception_visits_schema.py tests/test_openapi_snapshot.py tests/test_rbac_matrix.py tests/test_permissions_catalogue.py
============================ 819 passed in 137.91s ============================
```

---

## 3. Scenarios & UAT Coverage

| Scenario / UAT | Description | Result |
|----------------|-------------|--------|
| **S1** | Completed & unpaid: outstanding equals line fee | PASS |
| **S2** | Completed & part-paid by appointment payment: fee minus paid | PASS |
| **S3** | Completed & fully paid: outstanding 0 | PASS |
| **S4** | Two completed consultations in one visit, one paid: the other's fee | PASS |
| **S5** | One completed and one WAITING consultation: only completed fee counts | PASS |
| **S6 / LED-11** | Waiting consultation reassigned, new one completed: exactly one fee (new doctor's) | PASS |
| **S7** | Cancelled visit with cancelled consultation: outstanding 0 | PASS |
| **S8 / BILL-16 / BILL-17** | Patient Out with balance requires reason; closed visit dues match balance; payment lowers due | PASS |
| **S9** | Fee waived: 0; fee discounted: discounted amount | PASS |
| **S10 / FEE-07 / BILL-19** | Doctor default fee changed after check-in: outstanding unchanged | PASS |
| **S11** | Completed consultation with no bill line fails closed (`consultation_missing_bill_line`) | PASS |
| **S12** | Treatment plan payment for same patient: visit outstanding unchanged | PASS |
| **S13** | Reversed payment: does not count toward paid total | PASS |
| **BILL-01** | Visit appears in `ready_for_checkout` once consultation is completed | PASS |
| **BILL-02** | Consultation charge reads fee accurately | PASS |
| **Visit Payment** | Payment carrying `visit_id` (ORM) lowers visit outstanding | PASS |
| **Single Target** | Payment with both `visit_id` and `appointment_id` counted exactly once | PASS |
| **Unlinked Line** | Active medicine line adds to due; voided line does not; package reference (0) does not change due | PASS |
| **Procedure Line** | Procedure line on consultation becomes payable only once consultation is completed | PASS |

---

## 4. Dependencies & Remaining Risks

- **Downstream Dependencies:**
  - **Plan 22-06 (Visit payment guard & dues list reshape)**: Will consume `visit_totals`, allow `POST /api/billing/payments` with `visit_id`, and reshape `/api/billing/visit-dues`.
  - **Plan 22-08..22-12 (Line endpoints)**: Will insert line items that seamlessly factor into `visit_totals`.
  - **Plan 22-20 (Dev Migration & Comparison Gate)**: Will run `scripts/phase22_balance_compare.py --database kalyan_dev` under owner approval.
- **Remaining Risks:**
  - Balance compare script has run only against `kalyan_test`. Comparison against `kalyan_dev` remains approval-gated at plan 22-20.
  - No changes committed to Git per governance constraints.
