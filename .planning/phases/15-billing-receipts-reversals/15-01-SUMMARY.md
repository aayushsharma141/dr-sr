# Plan 15-01 Summary: Schema Migration & Core Models (0005 Billing, Receipts & Reversals)

**Executed Date:** 2026-11-02  
**Status:** Completed  
**Branch:** `planning/phase-15-billing-ledger`  

---

## 1. Work Completed
- **SQLAlchemy Models in `backend/src/kalyan_api/models.py`:**
  - Added `PaymentMethod` enum (`CASH`, `UPI`, `CARD`).
  - Added `ReceiptSequence` model mapping to `receipt_sequences` table with unique `cycle_key` index, `last_number` integer, and timestamps.
  - Added `Payment` model mapping to `payments` table with `receipt_number`, `patient_id`, optional `treatment_plan_id`, optional `appointment_id`, `amount_paise`, `payment_method`, `notes`, `is_reversed`, `reversal_reason`, `reversed_by_user_id`, `reversed_at`, `created_by_user_id`, and `created_at`.
  - Added check constraints on `payments`:
    - `ck_payments_amount_positive`: `amount_paise > 0`.
    - `ck_payments_payment_method`: `payment_method IN ('CASH', 'UPI', 'CARD')`.
    - `ck_payments_reversal_integrity`: Enforces that non-reversed payments have null reversal fields, and reversed payments must include a non-empty `reversal_reason` ($\ge 5$ characters), `reversed_by_user_id`, and `reversed_at`.
- **Alembic Migration `0005_billing_receipts_and_reversals.py`:**
  - Revision `0005` with `down_revision = "0004"`.
  - Creates tables `receipt_sequences` and `payments` with required indexes.
  - Implements PostgreSQL trigger `trg_prevent_payment_tampering`:
    - Rejects direct SQL `DELETE` with explicit error message requiring admin reversal.
    - Rejects direct SQL `UPDATE` tampering with payment details or already reversed transactions.
    - Permits strictly the transition from `is_reversed = FALSE` to `TRUE` with valid reversal metadata.
  - Implements PostgreSQL trigger `trg_enforce_package_payment_limits`:
    - Serializes concurrent payments for the same package using `SELECT ... FOR UPDATE` row locking on `treatment_plans`.
    - Computes active sum and rejects any payment that would cause total paid paise to exceed `agreed_price_paise` (`BIL-02`).
  - Granted least-privilege table and sequence access to runtime application role `kalyan_app`.
- **Automated Verification:**
  - `backend/tests/test_billing_models.py` (3 passed):
    - Verified check constraints on zero/negative amounts, invalid methods, and short/missing reversal reasons.
    - Verified tampering trigger defense against SQL update and delete.
    - Verified package payment limit trigger rejecting overpayments and accepting exact settlement.
  - `backend/tests/test_migrations.py` (3 passed):
    - Verified single linear head revision `0005` with zero model drift.
  - 100% clean `ruff check backend` (0 errors) and `ruff format` compliance.

---

## 2. Test Results
- `backend/tests/test_billing_models.py`: 3 passed.
- `backend/tests/test_migrations.py`: 3 passed.
- Total: 6 passed in 1.64s.

