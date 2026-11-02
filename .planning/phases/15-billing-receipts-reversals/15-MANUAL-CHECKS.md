# Phase 15 Manual Verification Playbook

## Context
Phase 15 implements financial ledger integrity, atomic sequential receipt allocation, overpayment rejection, admin-authorized payment reversals, and the unified patient chronological history timeline.

## Manual Verification Steps

### Check 1: Consultation Payment Collection & Receipt Generation
1. Login as `reception`.
2. Navigate to `/reception/appointments` or `/reception/patients/:id`.
3. Open `Record Payment` modal.
4. Input amount: `₹500.00`, select method: `UPI`.
5. Submit and verify receipt generates in format `RCP-YYYY-XXXX` (e.g., `RCP-2026-0001`).
6. Click Print: verify dual format layout (80mm POS thermal slip and A5 paper) with Kalyan Hospital bilingual letterhead.

### Check 2: Package Instalment & Real-Time Balance Validation
1. Open a patient with an active treatment package (e.g. 10 sessions, ₹10,000 agreed fee).
2. Record first instalment of ₹6,000.
3. Verify pending dues dashboard shows remaining balance of ₹4,000.
4. Attempt to record payment of ₹4,500 against the package.
5. Verify system rejects payment with message: `Payment exceeds remaining balance of ₹4,000.00`.
6. Record payment of ₹4,000. Verify remaining dues drop to ₹0.00 and package marks fully paid.

### Check 3: Admin Reversal & Dues Restoration
1. Login as `admin`.
2. Open payment transaction history.
3. Select a posted payment and click `Reverse Payment`.
4. Enter short reason (`err`). Verify submit button or client validation asserts minimum 5 characters.
5. Enter valid justification (`Patient requested cancellation due to relocation`).
6. Confirm reversal.
7. Verify receipt now displays prominent `REVERSED PAYMENT RECEIPT` banner and justification reason.
8. Verify pending dues ledger restores the package balance by the reversed amount.
9. Attempt reversal as `reception`: verify 403 Forbidden is returned.

### Check 4: Unified Patient History Timeline
1. Navigate to `/reception/patients/:id` or `/doctor/encounters/new`.
2. Inspect `Unified Chronological History`:
   - Appointments (Token numbers, check-in timestamps)
   - Clinical consultation notes and addenda
   - Prescriptions and prescribed medication count
   - Physiotherapy rehabilitation packages
   - Daily therapy sessions with VAS pain scores
   - Payments and reversals
3. Verify reverse chronological order (newest first).
4. Verify doctor silo: Doctor B cannot see confidential consultation notes from Doctor A.
