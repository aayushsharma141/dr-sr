# Phase 22 Plan 07 Summary: Visit Checkout and Dues Payment Forms

**Plan:** 22-07  
**Status:** IMPLEMENTED — NOT VERIFIED  
**Task IDs:** T22-07, BILL-12  

---

## 1. AGENTS.md Governance Report

- **Task ID:** 22-07 (T22-07, BILL-12)
- **Owned Files:**
  - `frontend/src/api/types.ts`
  - `frontend/src/components/billing/VisitCheckout.tsx`
  - `frontend/src/pages/__tests__/reception-billing.test.tsx`
  - `frontend/src/components/__tests__/receipt-print.test.tsx`
- **Git Checkpoint:**
  - `stash@{0}: checkpoint: before 22-07 visit payment forms`
- **Findings:**
  - `PaymentCreate` and `PaymentOut` in `types.ts` now expose `visit_id?: number | null`.
  - `VisitDueOut` in `types.ts` matches the reshaped visit-level schema from 22-06 (`doctor_names: string[]`, `bill_total_paise: number`, `paid_paise: number`, `balance_paise: number`).
  - Checkout desk (`PaymentForm`) pays the visit:
    * Removed per-consultation dropdown picker.
    * Amount defaults to `visit.outstanding_paise`.
    * Amount capped at `visit.outstanding_paise` ("Only {amount} is due on this visit.").
    * Submits `visit_id: visit.id` without `appointment_id` (OD-D, OQ-1).
    * CTA remains "Collect ₹X & Issue Receipt" with Cash/UPI/Card method picker and remarks default "Visit {visit_date}".
    * Shown only when visit is open, at least one consultation is completed, and outstanding > 0.
  - `ConsultationTable`:
    * Removed per-consultation paid and balance columns (visit totals stay in panel header).
  - Dues tab (`VisitDuesSection` & `DueCollectForm`):
    * Rows keyed by `visit_id`.
    * Doctors listed as `doctor_names.join(', ')`.
    * Bill total column renders `formatPaise(d.bill_total_paise)`.
    * Submits `visit_id: due.visit_id` with remarks "Balance from visit {visit_date}".
    * Amount capped at row balance.
  - Error and LAN drop resilience:
    * Server 422 `overpayment_rejected` displays in an inline alert, re-enables submit button, and opens no receipt.
    * Network drop retains typed amount, method, and remarks; displays error; never retries automatically.
  - Receipt print:
    * `ReceiptPrint` asserts OD-H: visit payments render totals only, with no bill line items.
- **Root Cause:**
  - Client checkout and dues forms were originally designed for per-consultation billing against `appointment_id`. With Phase 22 unifying visit charges and visit-level dues in 22-06, client forms and types required alignment to post payments with `visit_id` and consume visit-level dues.
- **Changes:**
  - `frontend/src/api/types.ts`:
    * Added `visit_id?: number | null` to `PaymentCreate` and `PaymentOut`.
    * Reshaped `VisitDueOut` to visit-level contract (`visit_id`, `doctor_names`, `bill_total_paise`, etc.).
  - `frontend/src/components/billing/VisitCheckout.tsx`:
    * Updated `PaymentForm` to collect against visit (`visit_id: visit.id`, cap on `visit.outstanding_paise`, default notes `Visit ${visit.visit_date}`).
    * Removed paid and balance columns from `ConsultationTable`.
    * Updated `VisitDuesSection` and `DueCollectForm` to visit-level dues table and collection by `visit_id`.
  - `frontend/src/components/__tests__/receipt-print.test.tsx`:
    * Added test asserting OD-H (totals only, no line items table).
  - `frontend/src/pages/__tests__/reception-billing.test.tsx`:
    * Updated checkout payment test to assert `visit_id: 7` and absence of `appointment_id`.
    * Added test for visit payment cap validation.
    * Added test for server 422 `overpayment_rejected` alert and enabled submit button.
    * Added test for network failure form preservation without auto-retry.
    * Added test for visit dues table rendering and collection by `visit_id`.
- **Database Safety:**
  - Production database (`kalyan_dev`) was untouched.
  - All automated tests executed against test harness.
  - No Git commits created.

---

## 2. Test Verification Evidence

### 2.1 Frontend Tests & Typecheck
```
cd D:/dr-sr/frontend && npx.cmd vitest run --maxWorkers=2 src/pages/__tests__/reception-billing.test.tsx src/components/__tests__/receipt-print.test.tsx src/components/__tests__/receipt-dialog.test.tsx src/pages/__tests__/pending-dues.test.tsx src/test/guards/guards.test.ts
Test Files  5 passed (5)
Tests       31 passed (31)

cd D:/dr-sr/frontend && npm.cmd run typecheck
> typecheck
> tsc -b
Exit code: 0
```

### 2.2 Paired Backend Tests
```
cd D:/dr-sr/backend && $env:PYTHONPATH="D:/dr-sr/backend/src"; .venv/Scripts/python.exe -m pytest -p no:warnings tests/test_phase22_visit_payments.py tests/test_visit_checkout_api.py
21 passed in 8.70s
```

---

## 3. Requirements & UAT Traceability

| Requirement | Description | Status |
|-------------|-------------|--------|
| **T22-07** | Client checkout and dues payment forms submit `visit_id` | IMPLEMENTED — NOT VERIFIED |
| **BILL-12** | Receipt shows correct amount, patient details, and totals only (OD-H) | IMPLEMENTED — NOT VERIFIED |
| **OD-D** | Payment form active when visit open, consultation completed, outstanding > 0 | IMPLEMENTED — NOT VERIFIED |
| **OD-H** | Receipts totals only, no line items | IMPLEMENTED — NOT VERIFIED |
| **OQ-1** | Reception collects visit payment linked to visit_id | IMPLEMENTED — NOT VERIFIED |

---

## 4. Dependencies & Remaining Risks

- **Downstream Dependencies:**
  - **Plan 22-13 & 22-14 (Bill line UI)**: Will build upon these visit payment forms once line item APIs are wired.
- **Remaining Risks:**
  - Feature marked `IMPLEMENTED — NOT VERIFIED` pending end-to-end human verification on `:8000` after plan 22-20.
