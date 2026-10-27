---
phase: 05-demo-hardening-security
plan: 02
subsystem: demo-and-onboarding
tags: [demo-seeder, benchmark, synthetic-data, rehearsal-script, demo-hardening]

requires:
  - phase: 02-patient-registration-search
    provides: [PatientService]
  - phase: 03-treatment-cases-payments
    provides: [TreatmentService, BillingService]
  - phase: 05-demo-hardening-security
    provides: [AuthService, AdminAuthDialog]
provides:
  - "DemoSeeder populating 5 realistic fictional patients with cases, sessions, and payments"
  - "Sub-second database reset utility (< 1.0 second execution benchmark)"
  - "Guarded Reset to Demo Data trigger in BackupView"
  - "Step-by-step 5-minute client rehearsal script in DEMO_SCRIPT.md"
  - "Automated unit test suite in tests/test_demo_seeder.py"
affects: []

actuals:
  tasks: 3
  commits: 1

tech-stack:
  added: [time.time]
  patterns: [Synthetic clinical data generation, Atomic truncation and re-seeding, Scripted client demonstration]

key-files:
  created:
    - app/services/demo_seeder.py
    - DEMO_SCRIPT.md
    - tests/test_demo_seeder.py
  modified:
    - app/ui/views/backup_view.py

key-decisions:
  - "Synthetic demo dataset provides 5 varied clinical presentations (Spine, Knee, Neck, Shoulder, Sciatica)."
  - "Demo reset completes in < 1 second, allowing rapid, stress-free rehearsal before doctor presentations."
  - "DEMO_SCRIPT.md is structured as a minute-by-minute rehearsal guide tailored for Dr. Madan Mohan Dwivedi & Dr. Chandan Kr. Dwivedi."

requirements-completed:
  - SEC-01
  - SEC-02

coverage:
  - id: D1
    description: "Synthetic demo patient generation and sub-second reset benchmark"
    requirement: SEC-01, SEC-02
    verification:
      - kind: unit
        ref: "tests/test_demo_seeder.py#test_reset_demo_benchmark"
        status: pass
---

# Plan 05-02 Summary: Synthetic Demo Seeder & Walkthrough Script

Delivered the synthetic demonstration engine and executive rehearsal script:
1. **High-Fidelity Demo Seeder:** `DemoSeeder` populates 5 realistic fictional patients, active treatment cases, chronological sessions with VAS pain scores, and partial Cash/UPI installments in < 1 second.
2. **Guarded UI Reset Trigger:** Added "⚡ Reset Demo Data" button in `BackupView`, secured by `AdminAuthDialog` to prevent accidental resets while allowing 1-click preparation before meetings.
3. **5-Minute Client Demonstration Script:** Created `DEMO_SCRIPT.md` guiding the developer through an executive walkthrough for Kalyan Hospital leadership with talking points, click flows, and objection handling.
4. **Automated Testing:** `tests/test_demo_seeder.py` verifies record count accuracy, sub-second execution speed (< 1.0s), and strict fictional data compliance.
