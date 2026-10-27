---
phase: 03-treatment-cases-payments
plan: 02
subsystem: ui
tags: [pyside6, treatment-view, payment-view, clinical-sessions, balance-cards]

requires:
  - phase: 03-treatment-cases-payments
    provides: [TreatmentService, BillingService, TreatmentRepository, PaymentRepository]
provides:
  - "TreatmentView displaying case progress, chronological clinical session logs, and Log Session dialog"
  - "PaymentView displaying real-time balance stat cards, installment recording panel, and ledger table"
  - "MainWindow integration wiring sidebar indices 2 and 3 and linking action buttons across modules"
  - "Automated UI tests in tests/test_treatment_ui.py"
affects: [04-print-backup, 05-demo-hardening]

actuals:
  tasks: 3
  commits: 1

tech-stack:
  added: [PySide6]
  patterns: [Dynamic balance cards with state-dependent styling, Modal clinical session recording, Cross-module navigation triggers]

key-files:
  created:
    - app/ui/views/treatment_view.py
    - app/ui/views/payment_view.py
    - tests/test_treatment_ui.py
  modified:
    - app/ui/main_window.py

key-decisions:
  - "Treatment progress displays Field 11 target sessions vs completed sessions with visual progress bar."
  - "Payment balance card highlights in dark red if money is owed and vibrant green when cleared."
  - "Cross-module linking routes patients from Patient Directory directly to Treatment Cases and Billing."

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
    description: "Treatment view and clinical session logger"
    requirement: TRT-01, TRT-02, TRT-03
    verification:
      - kind: unit
        ref: "tests/test_treatment_ui.py#test_treatment_view_loads_and_displays_sessions"
        status: pass
  - id: D2
    description: "Dynamic payment recording and real-time balance calculation"
    requirement: BIL-01, BIL-02, BIL-03, BIL-04
    verification:
      - kind: unit
        ref: "tests/test_treatment_ui.py#test_payment_view_balance_updates"
        status: pass
---

# Plan 03-02 Summary: Treatment & Billing User Interfaces

Delivered interactive clinical progress tracking and installment billing screens:
1. **Physiotherapy Treatment View:** `TreatmentView` renders active case details, target session progress bar (Field 11), color-coded pain score indicators (0–10), chronological sessions table, and `LogSessionDialog`.
2. **Billing & Payment Ledger:** `PaymentView` provides real-time financial cards (Total Fee, Total Paid, Outstanding Balance), partial installment recording with mode selection (Cash, UPI, Card), and payment transaction history.
3. **Shell Integration & Testing:** `MainWindow` wires sidebar items 2 and 3 to live views. `tests/test_treatment_ui.py` confirms headless UI data population, session dialog saves, and balance updates.
