---
phase: 03-treatment-cases-payments
plan: 01
subsystem: data-and-services
tags: [treatment-cases, sessions, payments, integer-paise, billing]

requires:
  - phase: 02-patient-registration-search
    provides: [PatientRepository, PatientService]
provides:
  - "TreatmentRepository providing CRUD on treatment_cases and chronological treatment_sessions"
  - "TreatmentService managing case life cycle, session logging, and pain score validation"
  - "PaymentRepository providing parameterized transaction logging and case ledger queries"
  - "BillingService enforcing integer paise arithmetic, balance deduction, and overpayment checks"
  - "Automated unit test suites in tests/test_treatment_service.py and tests/test_billing_service.py"
affects: [03-02, 04-print-backup, 05-demo-hardening]

actuals:
  tasks: 3
  commits: 1

tech-stack:
  added: [decimal.Decimal]
  patterns: [Integer paise currency handling, Chronological session ordering, Case-to-patient foreign key relational integrity]

key-files:
  created:
    - app/repositories/treatment_repository.py
    - app/repositories/payment_repository.py
    - app/services/treatment_service.py
    - app/services/billing_service.py
    - tests/test_treatment_service.py
    - tests/test_billing_service.py

key-decisions:
  - "Monetary values stored strictly in integer paise (1 INR = 100 paise) preventing IEEE 754 float drift."
  - "Sessions are sequentially numbered per case and chronologically ordered (session_number ASC, session_timestamp ASC)."
  - "Payments <= 0 are rejected; overpayments flag is_overpayment while clamping balance to 0."

requirements-completed:
  - TRT-01
  - TRT-02
  - TRT-03
  - BIL-01
  - BIL-02
  - BIL-03
  - BIL-04

coverage:
  - id: D1
    description: "Treatment case creation and chronological session logging"
    requirement: TRT-01, TRT-02, TRT-03
    verification:
      - kind: unit
        ref: "tests/test_treatment_service.py#test_log_chronological_sessions"
        status: pass
  - id: D2
    description: "Integer paise currency arithmetic and balance calculation"
    requirement: BIL-01, BIL-02, BIL-03, BIL-04
    verification:
      - kind: unit
        ref: "tests/test_billing_service.py#test_partial_installment_payments"
        status: pass
---

# Plan 03-01 Summary: Treatment & Billing Data Layer

Delivered the clinical case repository, session logger, and currency-safe financial calculations:
1. **Treatment Data Access & Service:** `TreatmentRepository` and `TreatmentService` manage multi-case tracking per patient, chronological session progression, and pain score validation (0–10).
2. **Payment & Billing Engine:** `PaymentRepository` and `BillingService` calculate outstanding balances using exact integer paise arithmetic (`total_fee_paise - sum(paid_paise)`), rejecting negative payments and flagging overpayments.
3. **Automated Testing:** 12 test assertions across `test_treatment_service.py` and `test_billing_service.py` verifying precision, bounds, and chronological sequencing.
