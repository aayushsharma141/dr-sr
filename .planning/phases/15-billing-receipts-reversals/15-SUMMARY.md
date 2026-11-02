# Phase 15 Summary: Billing, Sequential Receipts, and Reversals

## Milestone Status: COMPLETE
- Phase: 15 — Billing, Sequential Receipts & Reversals
- Branch: `planning/phase-15-billing-ledger`
- Key Features Implemented:
  1. **Monetary Integrity (BIL-02):**
     - All amounts represented strictly as integer paise.
     - Database triggers (`trg_enforce_package_payment_limits`) and row-locking (`with_for_update`) prevent concurrent multi-terminal race conditions or overpayment beyond agreed package prices.
  2. **Atomic Sequential Receipts (BIL-04):**
     - `ReceiptSequence` table with row-level locks guaranteeing gap-free sequential receipts (`RCP-YYYY-XXXX` or financial year cycle).
     - Verified with 20 parallel threads generating 20 gap-free sequence numbers with zero duplicates.
     - Pixel-perfect printable slip supporting 80mm thermal receipt printer and standard A5 paper, with prominent `DUPLICATE` watermark/header on reprints.
  3. **Dynamic Pending Dues Ledger (BIL-03):**
     - Calculated dynamically on-demand from ledger records (`agreed_price_paise - sum(active payments)`). Mutable balance columns completely avoided.
     - `GET /api/billing/pending-dues` and `PendingDuesPage.tsx` providing clinic-wide outstanding fee overview.
  4. **Admin Reversals & Tamper-Proof Immutability (BIL-05):**
     - Direct SQL UPDATE or DELETE on posted payments strictly blocked by `trg_prevent_payment_tampering`.
     - Admin-authorized reversal endpoint requiring mandatory reason ($\ge 5$ characters), persisting audit logs, and automatically restoring package pending dues. Non-admin callers receive HTTP 403 Forbidden.
  5. **Unified Patient Timeline (CLN-03):**
     - `GET /api/patients/{id}/timeline` and `PatientTimeline.tsx` combining Appointments, Clinical Encounters, Prescriptions, Treatment Plans, Therapy Sessions, and Payments into a descending chronological feed.
     - Doctor silo respected: confidential clinical notes and prescriptions remain isolated per doctor, while Receptionist and Doctor see appropriate operational history.

## Verification Evidence
- Backend Tests: 555 passed, 1 skipped (frontend dist path).
- Backend Coverage: **93.39%** (enforced $\ge 85\%$).
- RBAC Matrix: 314 cells fully verified with zero orphan or missing endpoints.
- Frontend Tests: 20 test files, 70 tests passed.
- Frontend Build: Clean production bundle compiled.
- Zero Legacy Drift: 0 changes to `app/`, legacy `tests/`, or `DECISIONS.md`.
