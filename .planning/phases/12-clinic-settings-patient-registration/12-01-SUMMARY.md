---
phase: 12-clinic-settings-patient-registration
plan: 01
wave: 1
status: completed
date: 2026-11-01
---

# Plan 12-01: Alembic Migration 0002 & Core Domain Models Summary

## 1. Executive Summary
Plan 12-01 successfully established the database schema and declarative SQLAlchemy 2.0 models for Phase 12 (`12-clinic-settings-patient-registration`). It delivers Alembic migration `0002_clinic_settings_and_patients.py`, singleton clinic settings, enhanced doctor profiles with Hindi names and qualifications, consultation fees, year-scoped atomic URN sequence counters, and the patient entity with all 12 canonical fields.

All tests passed with 0 failures and 0 warnings.

---

## 2. Tasks Completed

### Task 1: Alembic Migration 0002 & SQLAlchemy Models
- **Models (`backend/src/kalyan_api/models.py`):**
  - `ClinicSettings`: Singleton entity (`id=1`) with bilingual names (`name_en`, `name_hi`), dual addresses, phone, receipt sequence cycle (`FINANCIAL_YEAR` vs `CALENDAR_YEAR`), print headers/footers, and `version_id`.
  - `Doctor`: Added `name_hi`, `qualification`, `registration_number`, and `default_fee_paise`.
  - `ConsultationFee`: Fee schedule entity with non-negative `fee_paise` constraint.
  - `UrnSequence`: Year-scoped counter (`year` primary key, `last_seq` integer).
  - `Patient`: 12 canonical demographic fields (`urn`, `full_name`, `guardian_name`, `gender`, `dob`, `age_years`, `mobile`, `address`, `district`, `state`, `emergency_contact`, `allergies`, `notes`), `photo_path`, and `version_id`.
- **Migration (`backend/src/kalyan_api/migrations/versions/0002_clinic_settings_and_patients.py`):**
  - Creates tables with strict naming conventions, checks, and indexes (`ix_patients_urn`, `ix_patients_mobile`, `ix_patients_full_name`).
  - Seeds initial default row for `clinic_settings` (`id=1`).
  - Grants least-privilege `SELECT, INSERT, UPDATE` on new tables and sequences to `kalyan_app`.
  - Reversible downgrade cleanly drops new tables and columns.

### Task 2: Model Constraint & Schema Tests
- Implemented `backend/tests/test_patient_models.py`:
  - `test_clinic_settings_singleton_and_defaults`: Verifies default row 1 and rejects `id=2` via CheckConstraint.
  - `test_clinic_settings_cycle_check`: Verifies invalid receipt sequence cycle string is rejected.
  - `test_doctor_enhancements`: Validates Hindi name, qualification, and fee storage.
  - `test_consultation_fee_non_negative`: Rejects negative fee amounts.
  - `test_urn_sequence_storage`: Validates atomic counter table.
  - `test_patient_constraints`: Validates gender check (`M`, `F`, `O`), age check (`0 <= age <= 150`), and unique URN constraint (`uq_patients_urn`).
- Updated `backend/tests/test_migrations.py` to assert single linear head `0002` and role grants on new tables.

---

## 3. Verification Evidence

- `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_migrations.py backend/tests/test_patient_models.py -v`: 9 passed in 0.88s.
- `backend\.venv\Scripts\python.exe -m pytest backend/tests -q -x -m "not concurrency and not slow"`: 100% passed.
- `backend\.venv\Scripts\ruff.exe check backend`: All checks passed clean.
