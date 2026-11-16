# Phase 22 Plan 14 Summary: Bill Line Actions UI Modals (Add Medicine, Add Particular, Void, Correct, Admin Fee Correction)

**Plan:** 22-14  
**Status:** IMPLEMENTED — NOT VERIFIED  
**Task IDs:** T22-09, MED-02, BILL-05, BILL-06, MED-07, MED-11, OD-A, OD-B, OD-E, OD-G, OD-22-13, OD-22-15  

---

## 1. AGENTS.md Governance Report

- **Task ID:** 22-14 (T22-09, MED-02, BILL-05, BILL-06, MED-07, MED-11)
- **Owned Files:**
  - `frontend/src/api/bill.ts`
  - `frontend/src/components/billing/BillPanel.tsx`
  - `frontend/src/components/billing/AddBillLineModal.tsx` (new)
  - `frontend/src/components/billing/BillLineActionModal.tsx` (new)
  - `frontend/src/components/billing/FeeCorrectionModal.tsx` (new)
  - `frontend/src/components/__tests__/bill-line-actions.test.tsx` (new)
- **Git Checkpoint:**
  - Checkpoint stash: `checkpoint: before 22-14 bill line actions` (stored as `stash@{0}`, commit `3f3e3895d70238a82fd50c465d6be3f3de71a2a5`).
  - Working tree and index untouched; untracked files preserved; zero commits made to git.
  - kalyan_dev untouched; all tests executed on kalyan_test and frontend vitest jsdom environment.
- **Findings:**
  - Integrated reception bill line creation for prescribed medicines (OD-B, B2) and unlinked medicines (MED-07), with live preview of quantity × rate, and "Still needed: ..." submit blocking.
  - Prescribed reference list displays strictly `medicine_name` and `form` without quantities or clinical instructions, leaving quantity empty for reception to type the supplied quantity.
  - Integrated additional particular addition (BILL-05) posting category `ADDITIONAL` with live preview and "Still needed: ..." validation.
  - Reception is granted Void and Change quantity controls strictly for its own same-day lines (`source == RECEPTION`, `created_by_user_id == me.id`, IST date == `istToday()`) on open visits with `bill:write` (OD-G).
  - Void and quantity change require a mandatory reason (3 to 500 characters with visible counter). Void confirm button uses destructive styling (`bg-[#C81E1E]`, danger-600).
  - Admin users with `bill:adjust` see "Adjust fee" on consultation lines (OD-A), opening `FeeCorrectionModal` with Discount, Waive (fixes ₹0.00), and Correct options, displaying S6 copy "Original ₹X → Revised ₹Y" and mandatory reason.
  - Per owner decision (v) on 2026-11-16 (option-a), admin users with `bill:adjust` see Void and Change controls unconditionally on all non-consultation active lines on open visits, routing to `/api/bill-items/{id}/admin-void` and `/api/bill-items/{id}/admin-correct`.
  - Every mutation refetches the bill (`['visit-bill', visitId]`) and visits (`['visits']`); network failures and 422 errors render in `InlineAlert` while preserving all user-typed inputs without auto-retry; 409 conflict errors render in `ConflictBanner` with "Reload latest".
- **Root Cause:**
  - Design Wave 4 UI slice: without bill line modals and actions in `BillPanel.tsx`, reception and admin users had no interface to exercise the backend endpoints created in Plans 22-08..22-11.
- **Changes:**
  - `frontend/src/api/bill.ts`:
    - Added interfaces: `PrescribedMedicineOut`, `BillLineCreate`, `BillLineVoidRequest`, `BillLineCorrectRequest`, `FeeAdjustmentRequest`, `FeeAdjustmentOut`.
    - Added `prescription_item_id` to `BillLineOut`.
    - Added hooks: `usePrescribedMedicines(visitId, enabled)`, `useAddBillLine(visitId)`, `useVoidBillLine(visitId)`, `useCorrectBillLine(visitId)`, `useAdminVoidBillLine(visitId)`, `useAdminCorrectBillLine(visitId)`, `useFeeCorrection(visitId)` with query invalidation on `['visit-bill', visitId]` and `['visits']` and `retry: false`.
  - `frontend/src/components/billing/AddBillLineModal.tsx`:
    - Native `Modal`-based dialog with `'medicine'` and `'particular'` modes.
    - Medicine mode displays prescribed medicine pills (name and form only); selection sets medicine name and `prescription_item_id`, leaving quantity blank. Free typing supported without link.
    - Live amount preview (e.g. `2 × ₹50.00 = ₹100.00`).
    - Input validation with "Still needed: ..." submit blocking.
    - Error handling via `InlineAlert`, retaining typed inputs on failure without auto-retry.
  - `frontend/src/components/billing/BillLineActionModal.tsx`:
    - Native `Modal`-based dialog with `'void'` and `'correct'` modes.
    - Character counter for reason (3–500 chars).
    - Destructive button styling for void confirmation.
    - Handles 409 with `ConflictBanner` and 422 with `InlineAlert`.
  - `frontend/src/components/billing/FeeCorrectionModal.tsx`:
    - Native `Modal`-based dialog with `'DISCOUNT'`, `'WAIVER'`, and `'CORRECTION'` modes.
    - Displays S6 copy "Original ₹X → Revised ₹Y".
    - Waive fixes new amount to 0; Discount requires reduced amount; Correct allows any non-negative amount.
    - Requires 3–500 character reason with counter.
  - `frontend/src/components/billing/BillPanel.tsx`:
    - Added "Add medicine" in Medicines section footer and "Add particular" in Additional Particulars footer when user has `bill:write` and bill is unlocked.
    - Added "Adjust fee" on consultation line for users with `bill:adjust` when bill is unlocked.
    - Added "Void" and "Change quantity" for reception on own same-day lines, and for admin (`bill:adjust`) on all active non-consultation lines.
    - Mounted `AddBillLineModal`, `BillLineActionModal`, and `FeeCorrectionModal`.
  - `frontend/src/components/__tests__/bill-line-actions.test.tsx`:
    - 15 comprehensive unit and interaction tests covering all three tasks: visibility, payloads, validation, error handling, network drops, own same-day enforcement, admin fee adjustment, and admin line actions.
- **Test Commands & Results:**
  - Frontend vitest test suite:
    `cd frontend; npx.cmd vitest run --maxWorkers=2 src/components/__tests__/bill-line-actions.test.tsx src/components/__tests__/bill-panel.test.tsx src/pages/__tests__/reception-billing.test.tsx src/test/guards/guards.test.ts`
    -> **4 test files passed, 41 passed in 10.80s**
  - Frontend typecheck & lint:
    `cd frontend; npm.cmd run typecheck; npm.cmd run lint`
    -> **Typecheck 0 errors, Lint 0 errors (2 warnings in preexisting files)**
  - Backend paired pytest suite:
    `$env:PYTHONPATH="D:/dr-sr/backend/src"; backend/.venv/Scripts/python.exe -m pytest -p no:warnings backend/tests/test_phase22_bill_lines.py backend/tests/test_phase22_bill_void.py backend/tests/test_phase22_bill_correct.py backend/tests/test_phase22_prescribed_medicines.py backend/tests/test_phase22_fee_adjustment.py`
    -> **55 passed in 14.52s**
- **Dependencies:**
  - Upstream: 22-08 (bill lines), 22-09 (visit bill view), 22-10 (void API), 22-11 (line correction & prescribed medicines), 22-13 (billing view).
  - Downstream: 22-20 (end-to-end OPD workflow integration and verification).
- **Remaining Risks:**
  - Full end-to-end manual verification on `:8000` is scheduled after Plan 22-20 completes all UI components.

---

## 2. UAT Requirements Satisfied

- **MED-02:** Prescription visible for reference at billing, names and form only; supplied quantity typed by reception (B2).
- **MED-07:** Free typing of medicines accepted without prescription link.
- **MED-11:** Quantity and rate correction recomputes line amount and visit total, preserving audit history with kind CORRECTION.
- **BILL-05:** Additional service added and displayed in bill with server amount after confirmation.
- **BILL-06:** Voided lines excluded from visit total and displayed in collapsed disclosure with reason.
- **FEE-05:** Consultation fee adjustment available to `bill:adjust` users with Discount, Waive, and Correct options.
