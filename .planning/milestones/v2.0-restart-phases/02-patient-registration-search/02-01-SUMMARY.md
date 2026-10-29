---
phase: 02-patient-registration-search
plan: 01
subsystem: database-and-services
tags: [sqlite, patient-repository, atomic-id, validation, photo-storage]

requires:
  - phase: 01-app-shell-dashboard
    provides: [Database connection factory, schema.sql]
provides:
  - "Atomic sequential ID sequence generator issuing unique KH-YYYY-XXXX patient IDs"
  - "PatientRepository providing parameterized SQLite CRUD, search, and soft-delete"
  - "PatientService enforcing demographic validation rules and safe photo file management"
  - "Automated unit test suite in tests/test_patient_service.py"
affects: [02-02, 03-treatment-billing, 04-print-backup]

actuals:
  tasks: 3
  commits: 1

tech-stack:
  added: [shutil, re]
  patterns: [Atomic sequence locking via id_sequences, Parameterized SQL queries, Sanitized local photo storage]

key-files:
  created:
    - app/repositories/__init__.py
    - app/repositories/patient_repository.py
    - app/services/patient_service.py
    - tests/test_patient_service.py

key-decisions:
  - "Sequential patient URNs format as KH-YYYY-XXXX and increment atomically within transaction."
  - "Photos are copied to data/photos/ with sanitized filenames {serial_urn_no}.ext."
  - "Ordinary editing preserves original creation timestamp and URN; deletions are strictly soft-deletes."

requirements-completed:
  - PAT-01
  - PAT-02
  - PAT-03
  - PAT-05

coverage:
  - id: D1
    description: "Atomic sequential patient ID generation (KH-YYYY-XXXX)"
    requirement: PAT-01
    verification:
      - kind: unit
        ref: "tests/test_patient_service.py#test_patient_registration_valid"
        status: pass
  - id: D2
    description: "Demographic data capture and field validation"
    requirement: PAT-02
    verification:
      - kind: unit
        ref: "tests/test_patient_service.py#test_invalid_inputs_rejected"
        status: pass
  - id: D3
    description: "Safe patient photo storage in data/photos/"
    requirement: PAT-03
    verification:
      - kind: unit
        ref: "tests/test_patient_service.py#test_photo_storage_and_retrieval"
        status: pass
  - id: D4
    description: "Non-destructive patient editing preserving ID and creation date"
    requirement: PAT-05
    verification:
      - kind: unit
        ref: "tests/test_patient_service.py#test_non_destructive_update"
        status: pass
---

# Plan 02-01 Summary: Patient Data Layer & Business Logic

Implemented the patient registration repository, atomic sequence generator, and validation service:
1. **Repository Layer:** `PatientRepository` provides parameterized SQLite CRUD operations. `generate_next_urn()` atomically increments and formats sequential IDs (`KH-2026-0001`).
2. **Validation & Photo Service:** `PatientService` validates required fields, age bounds (0–125), and 10-digit mobile numbers. Manages copying uploaded photos to `data/photos/{serial_urn_no}.ext`.
3. **Automated Testing:** `tests/test_patient_service.py` validates registration, persistence across reconnects, invalid input handling, photo handling, and soft deletes.
