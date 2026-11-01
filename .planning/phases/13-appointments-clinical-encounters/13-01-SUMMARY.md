# Summary 13-01: Database Models & Migration 0003

**Date:** 2026-11-01  
**Status:** Complete  
**Plan:** `.planning/phases/13-appointments-clinical-encounters/13-01-PLAN.md`

## What Was Done

1. **SQLAlchemy 2.0 Models Added to `backend/src/kalyan_api/models.py`:**
   - `AppointmentStatus(StrEnum)`: `BOOKED`, `ARRIVED`, `IN_CONSULTATION`, `DONE`, `CANCELLED`, `NO_SHOW`.
   - `DailyTokenSequence`: Composite primary key `(doctor_id, appointment_date)` with atomic `last_token` counter.
   - `Appointment`: Full appointment model with unique constraint `uq_appointments_doctor_date_token`, indexes on `(doctor_id, appointment_date, status)` and `(patient_id, appointment_date)`, `version_id` optimistic locking, and relationship references.
   - `ClinicalEncounter`: Clinical encounter model with doctor silo references, `is_finalised` and `finalised_at` timestamps, `version_id` optimistic locking, and addenda relationships.
   - `ClinicalAddendum`: Chronologically ordered, dated addenda attached to finalised encounters.

2. **Alembic Migration `0003_appointments_and_clinical_encounters.py`:**
   - Creates `daily_token_sequences`, `appointments`, `clinical_encounters`, and `clinical_addenda` tables.
   - Creates PostgreSQL function `fn_prevent_finalised_encounter_tampering()` and trigger `trg_prevent_finalised_encounter_tampering` preventing updates to clinical fields and deletions once `is_finalised = True`.
   - Grants runtime permissions (`SELECT, INSERT, UPDATE, DELETE`) and sequence usage to `kalyan_app` role.
   - Successfully applied to both `kalyan_dev` and `kalyan_test`.

3. **Automated Verification:**
   - Created `backend/tests/test_appointment_models.py` with 3 test cases:
     - Model instantiation and persistence.
     - Integrity error on duplicate token number for the same doctor and date.
     - Database trigger blocking clinical field modifications or deletion on finalised encounters.
   - Verified 3/3 passed.
   - Verified `ruff check backend` 100% clean.

## Verification Run
```bash
backend\.venv\Scripts\pytest.exe backend\tests\test_appointment_models.py
3 passed, 1 warning in 0.75s
```
