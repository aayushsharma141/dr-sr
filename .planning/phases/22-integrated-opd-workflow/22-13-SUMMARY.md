# Phase 22 Plan 13 Summary: Billing & Checkout Bill Panel UI, Totals Block, and Previous Dues

**Plan:** 22-13  
**Status:** IMPLEMENTED — NOT VERIFIED  
**Task IDs:** T22-09, FEE-09, BILL-04, LED-01, LED-02  

---

## 1. AGENTS.md Governance Report

- **Task ID:** 22-13 (T22-09, FEE-09, BILL-04, LED-01, LED-02)
- **Owned Files:**
  - `frontend/src/api/bill.ts` (new)
  - `frontend/src/components/billing/BillPanel.tsx` (new)
  - `frontend/src/components/__tests__/bill-panel.test.tsx` (new)
  - `frontend/src/components/billing/VisitCheckout.tsx`
  - `frontend/src/pages/ReceptionBillingPage.tsx`
  - `frontend/src/components/AppShell.tsx`
  - `frontend/src/api/types.ts`
  - `frontend/src/api/queries.ts`
  - `frontend/src/pages/__tests__/reception-billing.test.tsx`
  - `frontend/src/components/__tests__/app-shell.test.tsx`
- **Git Checkpoint:**
  - Stash checkpoint: `stash@{0}: checkpoint: before 22-13 billing and checkout panel`
  - Working tree and index untouched; zero commits created in git.
  - kalyan_dev untouched; all tests run on kalyan_test and frontend vitest/typecheck.
- **Findings:**
  - Reception page title and primary navigation renamed from "Billing & Payments" to "Billing & Checkout" (OD-22-01, Q9).
  - Extended `VisitSummary` with `token_numbers: number[]` and `last_completed_at: string | null` (from 22-09 backend additions).
  - Left ready-checkout list renders patient name, URN, tokens via `formatToken`, completion time via `formatIst`, and outstanding balance via `formatPaise`. Empty state shows "Nothing to check out. Patients appear here when their doctor completes the consultation."
  - Created `frontend/src/api/bill.ts` with `useVisitBill` hook and schema types (`VisitBillOut`, `BillSectionOut`, `BillLineOut`, `BillLineHistoryOut`, `BillPaymentOut`, `PreviousDueOut`, `PackageInfoOut`).
  - Created `frontend/src/components/billing/BillPanel.tsx` rendering all 5 fixed sections in order (`CONSULTATION`, `PROCEDURE`, `PACKAGE`, `MEDICINE`, `ADDITIONAL`) with subtotals, Doctor (`bg-consult-100 text-consult-800`) and Reception (`bg-slate-100 text-slate-800`) source tags, SYSTEM check-in fee label ("Fee as billed at check-in"), line adjustment histories ("Changed from ₹X.XX · {reason} · {staff} · {time}"), collapsed `<details>` disclosure for voided lines, locked visit copy ("Visit closed on {formatIst(closed_at)}. The bill is locked."), and visit payment history with reversed badges.
  - Totals block renders rows in exact UI-SPEC S4 §7 order: Bill total, Paid earlier, Paying now, Remaining on this visit, Previous dues, Total outstanding (remaining + previous dues). "Paying now" dynamically updates as user types into the payment form.
  - Previous dues card renders "Previous dues (separate ledger)" with itemised visit balances and an individual "Collect previous dues" action invoking `DueCollectForm`.
  - Treatment packages card renders active package sessions used/remaining and financial progress.
  - Close visit CTA renamed to "Patient Out" (Q12). When closing with a balance, requires non-empty reason with 500-char counter (Q16, Q17).
  - Queries `useRecordPayment` and `useCloseVisit` invalidate `['visit-bill']` query key.
- **Root Cause:**
  - Design Wave 4 UI slice: reception requires full transparency of all active bill sections, fee adjustment audits, prior dues, treatment package sessions, and payments before collecting payments and marking patients out.
- **Changes:**
  - `frontend/src/api/bill.ts`:
    - Defined types and `useVisitBill(visitId)` hook polling every 10s.
  - `frontend/src/components/billing/BillPanel.tsx`:
    - Implemented read-only bill breakdown, totals settlement block, previous dues card, package information card, and payments history table with reversed badge.
  - `frontend/src/components/__tests__/bill-panel.test.tsx`:
    - 11 component tests covering section ordering, source tags, adjustment history, voided disclosures, empty/locked states, reversed payments, dynamic totals calculation, previous dues collection, and error/loading states.
  - `frontend/src/api/types.ts`:
    - Added `token_numbers: number[]` and `last_completed_at: string | null` to `VisitSummary`.
  - `frontend/src/components/AppShell.tsx`:
    - Updated navigation label and breadcrumbs from 'Billing & Payments' to 'Billing & Checkout'.
  - `frontend/src/pages/ReceptionBillingPage.tsx`:
    - Updated page heading to 'Billing & Checkout'.
  - `frontend/src/components/billing/VisitCheckout.tsx`:
    - Replaced redundant consultation and payments tables with `BillPanel`.
    - Lifted payment form amount state to `VisitDetailPanel` to feed dynamic "Paying now" into `BillPanel`.
    - Integrated previous dues collection action using `DueCollectForm`.
    - Updated left list rows to display token(s), completion time, and UI-SPEC empty copy.
    - Updated `CloseForm` heading and button to "Patient Out" with 500-char reason counter.
  - `frontend/src/api/queries.ts`:
    - Added `['visit-bill']` query invalidation to `useRecordPayment` and `useCloseVisit`.
  - `frontend/src/pages/__tests__/reception-billing.test.tsx` & `frontend/src/components/__tests__/app-shell.test.tsx`:
    - Updated assertions to match "Billing & Checkout", "Patient Out", token numbers, completion times, and mocked `/api/visits/7/bill`.
- **Test Commands & Results:**
  - Frontend test suite:
    `npm.cmd --prefix frontend test -- --maxWorkers=2 src/components/__tests__/bill-panel.test.tsx src/pages/__tests__/reception-billing.test.tsx src/components/__tests__/app-shell.test.tsx src/pages/__tests__/waiting-room.test.tsx src/pages/__tests__/pending-dues.test.tsx src/test/guards/guards.test.ts`
    -> **6 passed, 57 passed (57 total) in 11.67s**
  - Frontend typecheck:
    `npm.cmd --prefix frontend run typecheck`
    -> **Passed (0 errors)**
  - Frontend linter:
    `npm.cmd --prefix frontend run lint`
    -> **Passed (0 errors, 2 pre-existing warnings)**
  - Paired backend pytest:
    `$env:PYTHONPATH="D:/dr-sr/backend/src"; backend/.venv/Scripts/python.exe -m pytest -p no:warnings backend/tests/test_phase22_bill_view.py backend/tests/test_phase22_visit_payments.py`
    -> **19 passed in 6.25s**
- **Dependencies:**
  - Upstream: 22-09 (GET `/api/visits/{id}/bill`), 22-07 (Visit payment forms).
  - Downstream: 22-14 (Reception line add/void controls), 22-15 (Receipts tab and full ledger migration).
- **Remaining Risks:**
  - Manual end-to-end verification on browser `:8000` remains pending until wave 7 integration milestone (22-20). Reported as IMPLEMENTED — NOT VERIFIED per AGENTS.md rules.

---

## 2. Requirements & Verification Traceability

| Requirement | Implementation | Test Evidence |
|-------------|----------------|---------------|
| T22-09 | `api/bill.ts`, `BillPanel.tsx`, `VisitCheckout.tsx` | `bill-panel.test.tsx`, `reception-billing.test.tsx` |
| FEE-09 | Adjusted lines show "Changed from ₹X.XX · {reason} · {staff} · {time}" | `bill-panel.test.tsx` test 2 |
| BILL-04 | Medicine charges rendered with "Reception" source tag | `bill-panel.test.tsx` test 1 |
| LED-01 | Previous dues displayed as separate card, not added to bill | `bill-panel.test.tsx` test 8 |
| LED-02 | Prior visit dues collected via separate transaction and receipt | `bill-panel.test.tsx` test 8, `reception-billing.test.tsx` test 6 |
| OD-22-01 / Q9 | Navigation and page titled "Billing & Checkout" | `app-shell.test.tsx`, `reception-billing.test.tsx` |
| Q12 / Q16 / Q17 | "Patient Out" CTA with 500-char counter for unpaid balance | `reception-billing.test.tsx` test 2 |
