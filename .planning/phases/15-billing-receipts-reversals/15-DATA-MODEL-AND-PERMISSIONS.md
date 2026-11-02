# Phase 15: Data Model, Constraints & Permissions Specification

## 1. Relational Database Tables

### 1. `receipt_sequences`
Atomic sequence counter for sequential receipt numbering (`BIL-04`).
- `id` (BigInteger, PK, autoincrement)
- `cycle_key` (String(32), Unique, not null) — e.g. `'2026'` or `'2026-2027'`
- `last_number` (Integer, not null, default 0)
- `updated_at` (DateTime(timezone=True), not null, server_default=now())

### 2. `payments`
Immutable financial ledger of collections and receipts (`BIL-01`, `BIL-02`, `BIL-05`).
- `id` (BigInteger, PK, autoincrement)
- `receipt_number` (String(32), Unique, not null, indexed) — e.g. `'RCP-2026-0001'`
- `patient_id` (BigInteger, FK `patients.id`, not null, indexed)
- `treatment_plan_id` (BigInteger, FK `treatment_plans.id`, nullable, indexed)
- `appointment_id` (BigInteger, FK `appointments.id`, nullable, indexed)
- `amount_paise` (Integer, not null) — Check constraint: `amount_paise > 0`
- `payment_method` (String(16), not null) — Check constraint: `payment_method IN ('CASH', 'UPI', 'CARD')`
- `notes` (Text, nullable)
- `is_reversed` (Boolean, not null, default False)
- `reversal_reason` (Text, nullable)
- `reversed_by_user_id` (BigInteger, FK `users.id`, nullable)
- `reversed_at` (DateTime(timezone=True), nullable)
- `created_by_user_id` (BigInteger, FK `users.id`, not null)
- `created_at` (DateTime(timezone=True), not null, server_default=now())

### Check Constraints on `payments`:
1. `ck_payments_amount_positive`: `amount_paise > 0`
2. `ck_payments_payment_method`: `payment_method IN ('CASH', 'UPI', 'CARD')`
3. `ck_payments_reversal_integrity`:
   `(is_reversed = FALSE AND reversal_reason IS NULL AND reversed_by_user_id IS NULL AND reversed_at IS NULL) OR (is_reversed = TRUE AND length(trim(reversal_reason)) >= 5 AND reversed_by_user_id IS NOT NULL AND reversed_at IS NOT NULL)`

### PostgreSQL Triggers:
1. `trg_prevent_payment_tampering`:
   - `BEFORE DELETE`: Always raises exception `'Posted payments cannot be deleted. Use admin reversal.'`
   - `BEFORE UPDATE`: If `OLD.is_reversed = TRUE`, raises exception `'Reversed payments are permanently immutable.'`. If `NEW.is_reversed = TRUE` and `OLD.is_reversed = FALSE`, verifies that only reversal fields changed and other fields remained identical.
2. `trg_enforce_package_payment_limits`:
   - `BEFORE INSERT`: If `treatment_plan_id IS NOT NULL`, calculates existing active payments + new payment. If `total_paid > treatment_plan.agreed_price_paise`, raises exception `'Payment exceeds agreed treatment package price'`.

## 2. RBAC Permissions Matrix
- `Permission.BILLING_READ` (`billing:read`): Granted to `ADMIN` and `RECEPTION`.
- `Permission.BILLING_WRITE` (`billing:write`): Granted to `ADMIN` and `RECEPTION`.
- `Permission.BILLING_REVERSE` (`billing:reverse`): Granted strictly to `ADMIN`.
- `Permission.TIMELINE_READ` (`timeline:read`): Granted to `ADMIN`, `RECEPTION`, `DOCTOR`.
