# Phase 22 Plan 06 Summary: Visit payment guard, visit-level dues, fee guard on visit totals

**Plan:** 22-06  
**Status:** IMPLEMENTED — NOT VERIFIED  
**Task IDs:** T22-07, T22-08, AUD-04, BILL-07, BILL-08, BILL-09, BILL-10, BILL-11, BILL-13, BILL-14, BILL-15, LED-08, LED-09  

---

## 1. AGENTS.md Governance Report

- **Task ID:** 22-06 (T22-07, T22-08)
- **Owned Files:**
  - `backend/src/kalyan_api/schemas/billing.py`
  - `backend/src/kalyan_api/routers/billing.py`
  - `backend/src/kalyan_api/services/billing_service.py`
  - `backend/src/kalyan_api/services/bill_service.py`
  - `backend/src/kalyan_api/routers/fee_adjustments.py`
  - `backend/tests/test_phase22_visit_payments.py` (new)
  - `backend/tests/test_phase22_fee_adjustment.py`
  - `backend/tests/test_visit_checkout_api.py`
  - `backend/tests/test_phase22_bill_snapshot.py`
  - `backend/tests/openapi.snapshot.json`
- **Git Checkpoint:**
  - `stash@{0}: checkpoint: before 22-06 visit payments` (created before first edit, preserving untracked files).
- **Findings:**
  - `PaymentCreate` and `PaymentOut` now expose `visit_id: int | None`.
  - Reception can record visit payments (`visit_id`), serialized via row lock (`lock_visit`) with `SELECT ... FOR UPDATE`.
  - Target conflicts (`visit_id` combined with `appointment_id` or `treatment_plan_id`) are rejected with 422 `payment_target_conflict`.
  - IDOR payments targeting visits of different patients return 404 `visit_not_found`.
  - Locked Owner Decision (OD-D) enforced: payments are refused with 422 `checkout_not_open` until at least one consultation is `COMPLETED`. Once completed, payments succeed even if another consultation of the same visit remains `WAITING`.
  - Overpayments exceeding `v_tot.due_paise` are refused with 422 `overpayment_rejected`.
  - Legacy `appointment_id` branch locks the visit first (visit then appointment lock order), and caps payments by both consultation remaining fee and remaining visit due (closing the zero-fee consultation overpayment gap).
  - Closed-visit dues list (`GET /api/billing/visit-dues`) reshaped to 1 row per closed visit (`visit_id`, `patient_id`, `patient_urn`, `patient_name`, `doctor_names: list[str]`, `visit_date`, `bill_total_paise`, `paid_paise`, `balance_paise`, `close_reason`), computed via `visit_totals`.
  - Paying a closed visit succeeds, records payment, keeps status `CLOSED`, and does not reopen the visit.
  - Fee adjustment guard in `adjust_consultation_fee` re-based on visit totals (`visit_totals`), preventing waivers/discounts from lowering visit total bill below visit paid amount (422 `adjustment_below_paid`).
  - Lock order unified across owned writers to `Visit -> Appointment -> Line`.
- **Root Cause:**
  - Legacy billing and dues were indexed by `appointment_id`. Additional visit-level bill lines (e.g. medicines, procedures) and visit payments could not be unified without visit-level payment guards, reshaped dues, and visit-level fee adjustment guards.
- **Changes:**
  - `backend/src/kalyan_api/schemas/billing.py`:
    - Added `visit_id: int | None = Field(default=None, gt=0)` to `PaymentCreate`.
    - Added `visit_id: int | None = None` to `PaymentOut`.
    - Reshaped `VisitDueOut` to visit-level fields (`doctor_names: list[str]`, `bill_total_paise: int`, `paid_paise: int`, `balance_paise: int`).
  - `backend/src/kalyan_api/services/billing_service.py`:
    - Added `lock_visit(session, visit_id)` returning `Visit` row with `with_for_update()`.
    - Rewrote `compute_visit_dues` using `visit_totals` for CLOSED visits, grouping doctor names in check-in order.
  - `backend/src/kalyan_api/routers/billing.py`:
    - Added visit payment branch with conflict check (`payment_target_conflict`), `lock_visit`, OD-D completed check (`checkout_not_open`), and `overpayment_rejected` check against `due_paise`.
    - Added visit lock and visit due capping to legacy `appointment_id` branch.
    - Added `visit_id` and `appointment_id` to audit trail `after` payload.
    - Populated `visit_id` in `_to_payment_out`.
  - `backend/src/kalyan_api/services/bill_service.py`:
    - Replaced `_paid_on_consultation` with `visit_totals`-based guard rejecting new visit totals below `paid_paise` with 422 `adjustment_below_paid`.
  - `backend/src/kalyan_api/routers/fee_adjustments.py`:
    - Updated `_apply` to lock `visit` before `appointment`.
  - `backend/tests/test_phase22_visit_payments.py`:
    - Created comprehensive test suite covering visit payments, partial payments, overpayments, target conflicts, OD-D completion requirements, closed visit payments, legacy cap on visit due, non-patchable/deletable checks, and concurrent race tests.
  - `backend/tests/test_phase22_fee_adjustment.py`:
    - Added tests for visit-level payment waiver guard and multi-consultation visit totals adjustment.
  - `backend/tests/test_visit_checkout_api.py` & `backend/tests/test_phase22_bill_snapshot.py`:
    - Updated assertions to match new `VisitDueOut` schema shape (zero asserted amounts changed).
  - `backend/tests/openapi.snapshot.json`:
    - Regenerated via `kalyan_api.cli export-openapi`.
- **Database Safety:**
  - Zero modifications to production database (`kalyan_dev` was never touched).
  - All test runs strictly used isolated `kalyan_test`.
  - No changes committed to Git.

---

## 2. Lock-Order Audit Table

| Writer / Function | Owned Here? | Lock Order | Tables / Rows Locked | Concurrency Safety Notes |
|-------------------|-------------|------------|-----------------------|--------------------------|
| `billing.record_payment` (visit payment) | Yes | **Visit** | `visits` (`FOR UPDATE`) | Locks visit row via `lock_visit`, then computes `visit_totals`. Serializes all concurrent payments on the same visit. |
| `billing.record_payment` (appointment payment) | Yes | **Visit -> Appointment** | `visits` (`FOR UPDATE`) -> `appointments` (`FOR UPDATE`) | Unlocked read of `appointment.visit_id`, locks `visits`, then locks `appointments`. Re-verifies `visit_id`. Capped by visit remaining due. |
| `fee_adjustments._apply` | Yes | **Visit -> Appointment -> Bill Line** | `visits` (`FOR UPDATE`) -> `appointments` (`FOR UPDATE`) -> `bill_items` (`FOR UPDATE`) | Unlocked read of `appointment.visit_id`, locks `visits`, locks `appointments`, then `adjust_consultation_fee` locks `bill_items`. Strict hierarchical ordering. |
| `visits.close_visit` | No (Plan 22-05) | **Visit** | `visits` (`FOR UPDATE`) | Locks `visits` via `_locked_visit`. Computes outstanding balance without acquiring child locks. |
| `booking_service.reassign_waiting` | No (Read-only audit) | **Appointment** | `appointments` (`FOR UPDATE`) | Locks waiting appointment via caller. Allocates new token. Does not lock `visits`. |
| `booking_service.check_in` | No (Read-only audit) | **Appointment -> Visit** | `appointments` (`FOR UPDATE`) -> `visits` (`FOR UPDATE`) | **INVERSION RISK**: Caller locks appointment first, then `check_in` locks `visits` via `join_or_open_visit`. Not owned by Phase 22; reported as remaining risk below. |

---

## 3. Test Evidence

### 3.1 Task 1: Visit Payments & Concurrency Suite
```
cd D:/dr-sr/backend && $env:PYTHONPATH="D:/dr-sr/backend/src"; .venv/Scripts/python.exe -m pytest -p no:warnings tests/test_phase22_visit_payments.py
============================== 9 passed in 4.69s ==============================
```

### 3.2 Task 2: Visit Checkout, Dues Reshape & OpenAPI Suite
```
cd D:/dr-sr/backend && $env:PYTHONPATH="D:/dr-sr/backend/src"; .venv/Scripts/python.exe -m pytest -p no:warnings tests/test_visit_checkout_api.py tests/test_phase22_bill_snapshot.py tests/test_phase22_balance_switch.py tests/test_openapi_snapshot.py
============================== 43 passed in 13.19s ==============================
```

### 3.3 Task 3: Fee Adjustments & Visit Totals Suite
```
cd D:/dr-sr/backend && $env:PYTHONPATH="D:/dr-sr/backend/src"; .venv/Scripts/python.exe -m pytest -p no:warnings tests/test_phase22_fee_adjustment.py
============================== 13 passed in 6.30s ==============================
```

### 3.4 Full Automated Verification Suite
```
cd D:/dr-sr/backend && $env:PYTHONPATH="D:/dr-sr/backend/src"; .venv/Scripts/python.exe -m pytest -p no:warnings tests/test_phase22_visit_payments.py tests/test_phase22_fee_adjustment.py tests/test_phase22_balance_switch.py tests/test_phase22_bill_snapshot.py tests/test_visit_checkout_api.py tests/test_billing_api.py tests/test_receipt_concurrency.py tests/test_openapi_snapshot.py tests/test_rbac_matrix.py tests/test_permissions_catalogue.py
============================= 821 passed in 142.87s =============================
```

---

## 4. Requirements & UAT Traceability

| UAT / Requirement | Description | Status |
|-------------------|-------------|--------|
| **AUD-04** | Fee adjustment history and audit logs recorded | VERIFIED |
| **BILL-07** | Payment against visit (visit_id) recorded | VERIFIED |
| **BILL-08** | Payment reduces visit outstanding balance | VERIFIED |
| **BILL-09** | Multiple payments accumulate on same visit | VERIFIED |
| **BILL-10** | Overwriting existing payment history is prevented | VERIFIED |
| **BILL-11** | Payment row tracks visit_id, receipt_number, cashier | VERIFIED |
| **BILL-13** | Payment above visit balance rejected (`overpayment_rejected`) | VERIFIED |
| **BILL-14** | PATCH or DELETE on `/api/payments/{id}` refused | VERIFIED |
| **BILL-15** | Non-admin payment reversal forbidden (403) | VERIFIED |
| **LED-08** | Treatment plan payments retain separate ledger and cap | VERIFIED |
| **LED-09** | Paying closed visit balance succeeds; visit remains CLOSED | VERIFIED |
| **T-22-17** | Concurrent visit payments serialize (row-lock test: exactly one 201, one 422) | VERIFIED |
| **T-22-18** | Payment against visit of another patient rejected (404) | VERIFIED |
| **T-22-19** | Waiver/discount hiding money already paid at visit level rejected (422) | VERIFIED |
| **T-22-20** | `visit_id` and `appointment_id` included in audit payload | VERIFIED |

---

## 5. Dependencies & Remaining Risks

- **Downstream Dependencies:**
  - **Plan 22-07 (Frontend Client Dues & Payment Form)**: Updates client UI to consume the reshaped `VisitDueOut` fields (`doctor_names`, `bill_total_paise`, etc.) and submit payments with `visit_id`.
  - **Plan 22-08+ (Line Item Endpoints)**: Bill lines will be added to visits, seamlessly integrating with visit totals and payment guards.
  - **Deploy Gate**: Deploy after 22-07 ships so frontend and backend dues schemas align.
- **Remaining Risks:**
  - **Lock Inversion in `booking_service.check_in`**: As identified in the Lock-Order Audit Table, `check_in` locks the appointment before acquiring `join_or_open_visit` which locks `visits` (inversion relative to the standard `Visit -> Appointment` order). If check-in and payment recording run concurrently on the same appointment/visit, PostgreSQL will detect deadlock and abort one transaction with safety. `booking_service.py` is not owned by Phase 22, so this was documented rather than edited.
