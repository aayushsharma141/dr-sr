# Phase 8 Specification: Clinical Records & Financial Integrity

## 1. Objective
Ensure clinical records and financial transactions are rigorously validated, strictly immutable, integer-paise accurate, and fully audited.

---

## 2. Requirements & Traceability
- **TRT-01:** Physiotherapy treatment cases linked to patient records with title, target sessions count, start date, and clinician assignment.
- **TRT-02:** Dated therapy sessions logging timestamp, attending clinician, session number, treatment notes, modalities applied (e.g. IFT, TENS, Ultrasound, Traction, Exercise), and VAS pain score (0–10).
- **TRT-03:** Immutable chronological session history; historical session entries are strictly append-only and cannot be altered or removed without audited administrative oversight.
- **BIL-01:** Treatment fee packages and installment payments tracked with 100% precision in integer paise ($1\text{ INR} = 100\text{ paise}$).
- **BIL-02:** Strict dynamic balance calculation:
  $$\text{Balance} = \max(0, \text{Total Agreed Fee} - \sum\text{Paid Installments})$$
  Rejection of negative payments and explicit detection of overpayments.
- **AUD-01:** Tamper-evident audit logging for all case creations, clinical session entries, and financial installments via `AuditService`.

---

## 3. Scope Boundaries
- **In Scope:**
  - Inject `AuditService` into `TreatmentService` and `BillingService`.
  - Validate attending clinician selection and VAS pain scores (0–10).
  - Guarantee append-only session history protection in `TreatmentService`.
  - Ensure zero floating-point arithmetic errors across fee calculations and installment recording.
  - Automated tests in `tests/test_treatment_service.py` and `tests/test_billing_service.py`.
- **Out of Scope:**
  - Multi-PC network synchronization.
  - Real-time online UPI gateway or payment card terminals (prohibited by offline requirements).

---

## 4. Verification Criteria
1. Creating a case logs a `CASE_OPENED` audit event.
2. Logging a dated treatment session logs a `SESSION_LOGGED` audit event and preserves existing sessions without modification.
3. Attempting to record negative or non-numeric payments raises `ValueError`.
4. Balance calculations match exact arithmetic in paise without rounding errors.
5. All automated unit and integration tests pass cleanly.
