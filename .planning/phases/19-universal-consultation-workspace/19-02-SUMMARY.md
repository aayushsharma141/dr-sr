# Phase 19 Plan 02 Summary: Specialty Templates Registry, Seeds, and Vitals Observation Engine with Server-Calculated BMI

## Overview
Phase 19 Plan 02 establishes the specialty clinical templates infrastructure, database schemas and versioning immutability, default template schemas for Physiotherapy (`PHYSIOTHERAPY_V1`) and Ophthalmology (`OPHTHALMOLOGY_V1`), encounter template response persistence with mandatory field finalisation checks, and the vitals observation engine with authoritative server-side BMI calculation.

## Deliverables & Tasks Completed

### Task 1: Migration 0012 — Clinical templates, versions, responses, and vitals tables
- **Files Modified:**
  - `backend/src/kalyan_api/migrations/versions/0012_clinical_templates_and_vitals.py`
  - `backend/src/kalyan_api/models.py`
- **Changes:**
  - Created Alembic migration `0012` chained from `0011`.
  - Created `departments` table with initial seeds for `PHYSIOTHERAPY` and `OPHTHALMOLOGY`.
  - Added foreign key constraint from `clinical_encounters.department_id` to `departments(id)`.
  - Created `clinical_templates` table (`id`, `department_id`, `code`, `name_en`, `name_hi`, `is_active`, `created_at`).
  - Created `clinical_template_versions` table with unique constraint `uq_template_version` on `(template_id, version_number)`.
  - Created `clinical_template_responses` table with unique constraint `uq_template_responses_encounter` on `encounter_id`.
  - Created `vital_observations` table with unique constraint `uq_vital_observations_encounter` on `encounter_id` and CHECK constraints on physiological bounds for `height_cm`, `weight_kg`, `bmi`, `systolic_bp`, `diastolic_bp`, `pulse_bpm`, `temperature_f`, `respiratory_rate`, and `spo2_percent`.
  - Extended trigger `fn_prevent_finalised_encounter_tampering()` with triggers `trg_prevent_finalised_encounter_template_response_tampering` and `trg_prevent_finalised_encounter_vitals_tampering` to prevent modification/deletion of child template responses and vitals once the associated encounter is finalised.
  - Granted permissions on new tables and sequences to `kalyan_app` least-privilege role.
  - Updated SQLAlchemy ORM models: `Department`, `ClinicalTemplate`, `ClinicalTemplateVersion`, `ClinicalTemplateResponse`, and `VitalObservation`.
- **Verification:**
  - `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_migrations.py -q` passed (3 tests).
- **Commit:** `fd5e9f3 feat(19-02): migration 0012 clinical templates versions responses and vitals`

### Task 2: Specialty templates registry, seed data, and response management
- **Files Modified:**
  - `backend/src/kalyan_api/schemas/templates.py`
  - `backend/src/kalyan_api/routers/templates.py`
  - `backend/src/kalyan_api/routers/encounters.py`
  - `backend/src/kalyan_api/main.py`
  - `backend/tests/test_specialty_templates.py`
- **Changes:**
  - Defined seed schemas:
    - `PHYSIOTHERAPY_V1`: sections for Pain Assessment (starting VAS 0-10, site, onset/duration, characteristics, aggravating/relieving factors), Range of Motion (joint, flexion, extension, rotation, degrees), Strength & Function (MMT grade 0/5 to 5/5, functional limitations, ambulation status), Posture & Gait (alignment, gait pattern, assistive device); required: `["pain_site", "starting_vas"]`.
    - `OPHTHALMOLOGY_V1`: side-by-side OD/OS columns for Visual Acuity, IOP, Anterior Segment, Fundus & Refraction; required: `["va_distance_uncorrected_od", "va_distance_uncorrected_os"]`.
  - Created template registry endpoints:
    - `GET /api/templates/active`: list active specialty templates and current active versions.
    - `GET /api/templates/by-department/{department_id}`: retrieve active template and version by department ID.
    - `GET /api/templates/versions/{version_id}`: retrieve specific version schema.
  - Implemented encounter specialty response endpoints:
    - `GET /api/encounters/{id}/template-response`: retrieve captured responses.
    - `PUT /api/encounters/{id}/template-response`: save/update response against draft encounter. Rejects modification if encounter is finalised.
  - Implemented finalisation validation in `finalise_encounter` (`routers/encounters.py`): if template response exists, verifies that all fields listed in `schema_json["required"]` are present and non-empty, raising HTTP 422 `template_required_fields_missing` otherwise.
  - Registered `templates_router` in `backend/src/kalyan_api/main.py`.
- **Verification:**
  - `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_specialty_templates.py -q` passed (5 tests).
- **Commit:** `0ac2a74 feat(19-02): specialty templates registry seeds and response validation`

### Task 3: Vitals observation endpoints and server-side BMI calculation engine
- **Files Modified:**
  - `backend/src/kalyan_api/schemas/vitals.py`
  - `backend/src/kalyan_api/routers/vitals.py`
  - `backend/src/kalyan_api/main.py`
  - `backend/tests/test_vitals_and_bmi.py`
- **Changes:**
  - Defined `VitalObservationInput` and `VitalObservationResponse` schemas with Pydantic field validators matching physiological limits.
  - Implemented `routers/vitals.py`:
    - `GET /api/encounters/{encounter_id}/vitals`: retrieve recorded vitals and calculated BMI.
    - `PUT /api/encounters/{encounter_id}/vitals`: upsert vitals and calculate authoritative server-side BMI rounded to 1 decimal place (`round(float(weight_kg) / ((float(height_cm) / 100.0) ** 2), 1)`). If either is missing, BMI is set to None.
    - Rejects edits with HTTP 400 (`encounter_finalised`) if encounter is already finalised.
    - Encounters can be finalised with or without vitals (optionality preserved per D-19-09).
  - Registered `vitals_router` in `backend/src/kalyan_api/main.py`.
- **Verification:**
  - `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_vitals_and_bmi.py -q` passed (20 tests).
- **Commit:** `9b6590a feat(19-02): vitals observations and server calculated bmi engine`

## Verification Summary
All 32 tests across Phase 19 test modules pass:
- `backend/tests/test_migrations.py` (3 passed)
- `backend/tests/test_consultation_drafts.py` (4 passed)
- `backend/tests/test_specialty_templates.py` (5 passed)
- `backend/tests/test_vitals_and_bmi.py` (20 passed)
