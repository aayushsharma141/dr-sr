# Plan 15-05 Summary: Frontend Payment Collection Modal & Thermal/A5 Printable Receipt

## Execution Overview
- Updated `frontend/src/api/types.ts`:
  - Added types `PaymentMethod` ('CASH' | 'UPI' | 'CARD'), `PaymentCreate`, `PaymentReversalCreate`, `PaymentOut`, `PendingDueOut`, and `TimelineItemOut`.
- Updated `frontend/src/api/queries.ts`:
  - Added hooks `usePatientPayments`, `usePayment`, `usePendingDues`, `useRecordPayment`, `useReversePayment`, and `usePatientTimeline` with comprehensive query invalidation across billing, dues, and timeline keys.
- Created `frontend/src/components/PaymentModal.tsx`:
  - Modal dialog for Reception/Admin payment collection.
  - Converts user rupee inputs to exact integer paise on submission (`Math.round(rupees * 100)`).
  - Enforces positive amount validation before dispatch.
  - Supports payment method selection (`CASH`, `UPI`, `CARD`) and optional notes/transaction reference.
  - Automatically handles treatment plan packages and linked appointments.
- Created `frontend/src/components/ReceiptPrint.tsx`:
  - Pixel-perfect printable slip formatted for 80mm thermal POS rolls and standard A5 paper.
  - Displays Kalyan Hospital bilingual letterhead (Hindi/English) and address/contact details.
  - Shows receipt number, timestamp, cashier username, patient URN and name, payment mode, and formatted amount.
  - Displays prominent `DUPLICATE` watermark and copy banner when `isReprint=true` (BIL-04).
  - Displays reversal banner and reason if transaction has been reversed (BIL-05).
- Automated tests in `frontend/src/components/__tests__/payment-modal.test.tsx` and `receipt-print.test.tsx` (5 passed).
