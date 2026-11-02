# Phase 15: Billing, Receipts & Reversals — Context & Architecture Specification

## 1. Phase Mission & Value Proposition
Phase 15 implements the financial accounting ledger and receipt engine for Kalyan Hospital's Centralized LAN Web Platform.
It fulfills requirements:
- `BIL-01`: Reception records consultation fees and package instalment payments via Cash, UPI, or Card.
- `BIL-02`: All monetary values stored and transmitted strictly as integer paise ($1\text{ INR} = 100\text{ paise}$). Overpayments (> total dues) and negative amounts are rejected, including under concurrent multi-PC submission.
- `BIL-03`: Outstanding balances are dynamically computed from ledger entries (`agreed_price - sum(active_payments)`) and never stored as mutable numbers. Pending dues dashboard available for staff.
- `BIL-04`: Receipts receive atomic, gap-free sequential numbers (`RCP-YYYY-XXXX` or financial year cycle matching clinic settings). Printable thermal (80mm) and A5 receipts with duplicate reprint marking (`DUPLICATE`).
- `BIL-05`: Admin-authorized payment reversal requiring mandatory clinical/financial reason ($\ge 5$ characters). Posted transactions are append-only; silent deletion or mutation is strictly prevented.
- `CLN-03`: Unified chronological patient timeline aggregating appointments, clinical encounters, prescriptions, treatment packages, sessions, and payments into a single comprehensive ledger.

## 2. Key Architecture Invariants & Decisions
1. **Integer Paise Representation (`BIL-02`):**
   No floating-point decimals. All database columns (`amount_paise`), Pydantic schemas, and frontend calculations use integer paise. The UI formats paise to rupees ($\text{₹}X.XX$) only at the presentation boundary.
2. **Immutable Ledger & State-Safe Reversals (`BIL-05`):**
   Payments cannot be deleted or modified. To reverse a payment, an Admin executes `POST /api/payments/{id}/reverse` with a mandatory reason. The row is marked `is_reversed = true` with `reversed_by_user_id`, `reversed_at`, and `reversal_reason`. A PostgreSQL trigger prevents tampering with payment records.
3. **Dynamic Balance Computation (`BIL-03`):**
   Package balance is defined as `treatment_plan.agreed_price_paise - coalesce(sum(payments.amount_paise where not is_reversed), 0)`. It is computed on demand via SQL aggregation or trigger checks to guarantee consistency without drift.
4. **Row-Locked Receipt Sequencing (`BIL-04`):**
   Receipt numbers are generated via row-level locking (`SELECT ... FOR UPDATE`) on the `receipt_sequences` table, guaranteeing 0 gaps and 0 duplicates across concurrent reception desks.
5. **Unified Patient Timeline (`CLN-03`):**
   An aggregated view combining encounters, prescriptions, treatment plans, sessions, and payments sorted chronologically by timestamp.

