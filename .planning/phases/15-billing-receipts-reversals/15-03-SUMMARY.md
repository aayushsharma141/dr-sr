# Plan 15-03 Summary: Payments & Billing REST API

## Execution Overview
- Implemented permissions: `PAYMENT_READ`, `PAYMENT_CREATE`, `RECEIPT_REPRINT`, `PAYMENT_REVERSE`, and `TIMELINE_READ` in `backend/src/kalyan_api/core/permissions.py`.
- Registered `PAYMENT_RECORDED` and `PAYMENT_REVERSED` audit actions in `backend/src/kalyan_api/services/audit_service.py`.
- Created Pydantic billing schemas in `backend/src/kalyan_api/schemas/billing.py`:
  - `PaymentCreate`: integer paise validation (`gt=0`), `PaymentMethod` enum, optional appointment / treatment plan references.
  - `PaymentOut`: complete receipt and payment payload, patient and plan metadata, reversal tracking.
  - `PaymentReversalCreate`: mandatory reversal reason (`min_length=5`).
  - `PendingDueOut`: dynamic computation of dues per treatment package.
- Created billing router in `backend/src/kalyan_api/routers/billing.py`:
  - `POST /api/payments`: records consultation and treatment plan payments with row locking (`with_for_update()`) and explicit relationship decoupling (`lazyload`) to prevent PostgreSQL nullable outer join errors; generates sequential receipt; records audit event.
  - `GET /api/payments/{id}`: retrieves single payment transaction with full patient, plan, and reversal metadata.
  - `GET /api/patients/{patient_id}/payments`: lists full chronological payment ledger for a patient.
  - `GET /api/billing/pending-dues`: dynamically queries active treatment plans and calculates `agreed_price_paise - sum(payments)` to return outstanding dues.
  - `POST /api/payments/{id}/reverse`: Admin-only endpoint enforcing transition to reversed status, persisting mandatory reason, and logging audit trail.
- Registered billing router in `backend/src/kalyan_api/main.py` under `/api`.
- Verified with 5 comprehensive automated tests in `backend/tests/test_billing_api.py`:
  - Reception records consultation payment with receipt number and audit log.
  - Reception records treatment package instalment, and overpayment exceeding remaining balance is rejected (422 `overpayment_rejected`).
  - Doctor role cannot record or reverse payments (403 Forbidden).
  - Dynamic pending dues ledger accurately reflects partial payments, remaining balances, and zero-balance completions.
  - Admin payment reversal restores pending package balance, marks transaction reversed with reason and timestamp, and blocks non-admin callers.

