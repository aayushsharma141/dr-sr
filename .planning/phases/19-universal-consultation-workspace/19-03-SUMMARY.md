# Phase 19 Plan 03 Summary: Prescription Lifecycle, Authorisation & Cancellation Engine, and Follow-Up Recommendations with Reception Privacy Separation

## Overview
Phase 19 Plan 03 implements the complete prescription authoring and lifecycle management system (draft creation, modification gating, authorisation, print verification flag, cancellation with clinical reason, and re-issuance under a partial unique active-prescription-per-encounter constraint) alongside the follow-up recommendation engine with reception privacy isolation (strictly omitting `clinical_reason` from reception queries and schemas, supporting administrative appointment conversion and closure with reason).

## Deliverables & Tasks Completed

### Task 1: Migrations 0013 & 0014 — Prescription lifecycle, item delivery fields, and follow-up recommendations
- **Files Modified:**
  - `backend/src/kalyan_api/migrations/versions/0013_prescription_lifecycle_and_details.py`
  - `backend/src/kalyan_api/migrations/versions/0014_follow_up_recommendations.py`
  - `backend/src/kalyan_api/models.py`
- **Changes:**
  - Created Alembic migration `0013` (revises `0012`):
    - Added columns to `prescriptions`: `status` (`DRAFT`, `AUTHORISED`, `CANCELLED`), `authorised_at`, `cancelled_at`, `cancelled_by_user_id`, `cancellation_reason`.
    - Added constraints: `ck_prescriptions_status` and `ck_prescriptions_cancellation` (enforcing cancellation reason >= 3 chars, attribution, and timestamp).
    - Added partial unique index `uq_prescriptions_active_per_encounter` on `prescriptions (encounter_id) WHERE encounter_id IS NOT NULL AND status IN ('DRAFT', 'AUTHORISED')`.
    - Added columns to `prescription_items`: `strength VARCHAR(64)`, `form VARCHAR(32)`, `route VARCHAR(32)`.
  - Created Alembic migration `0014` (revises `0013`):
    - Created table `follow_up_recommendations` (`id`, `encounter_id`, `patient_id`, `doctor_id`, `recommended_doctor_id`, `recommended_date`, `clinical_reason`, `status`, `booked_appointment_id`, `closed_reason`, `closed_by_user_id`, `closed_at`, `version_id`, `created_at`, `updated_at`).
    - Added unique constraint `uq_follow_up_encounter` on `encounter_id`.
    - Added check constraints for status (`PENDING`, `BOOKED`, `CLOSED`) and closure integrity.
    - Added indexes `ix_follow_up_status_date` and `ix_follow_up_patient`.
    - Granted full table permissions to `kalyan_app` least-privileged role.
  - Updated SQLAlchemy ORM models:
    - `Prescription`: added status, cancellation columns, relationship to `cancelled_by_user`.
    - `PrescriptionItem`: added `strength`, `form`, `route`.
    - `FollowUpStatus` and `FollowUpRecommendation`: full entity model with relationships to encounter, patient, doctor, recommended doctor, and booked appointment.
- **Verification:**
  - `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_migrations.py -q` passed (3 tests).
- **Commit:** `16d7b4b feat(19-03): migrations 0013 and 0014 prescription lifecycle and follow up recommendations`

### Task 2: Prescription lifecycle backend — draft creation, authorisation, printing gate, cancellation & reissuance
- **Files Modified:**
  - `backend/src/kalyan_api/schemas/prescriptions.py`
  - `backend/src/kalyan_api/routers/prescriptions.py`
  - `backend/src/kalyan_api/services/audit_service.py`
  - `backend/tests/test_prescription_lifecycle.py`
- **Changes:**
  - Updated `schemas/prescriptions.py`:
    - Added `strength`, `form`, `route` to `PrescriptionItemCreate` and `PrescriptionItemOut`.
    - Added `PrescriptionCancelRequest` requiring `reason: str = Field(..., min_length=3)`.
    - Added `PrescriptionUpdate` schema for in-progress draft adjustments.
    - Updated `PrescriptionCreate`, `PrescriptionOut`, and `PrescriptionSummary` with lifecycle statuses and metadata.
    - Added `is_printable: bool` computed gate on `PrescriptionOut`.
  - Updated `routers/prescriptions.py`:
    - `POST /api/prescriptions`: supports creating in `DRAFT` or `AUTHORISED` status. Inherits diagnosis from encounter if omitted. Enforces partial unique active prescription constraint (rejects duplicate active prescriptions with HTTP 409).
    - `PUT /api/prescriptions/{id}`: allows updates only when `status == 'DRAFT'`. Rejects edits on `AUTHORISED` prescriptions with HTTP 409 (`prescription_locked`). Supports full medication list updates and optimistic locking.
    - `POST /api/prescriptions/{id}/authorise`: transitions `DRAFT` to `AUTHORISED`, validates at least 1 medication item and valid diagnosis, records `authorised_at = now()`, enables `is_printable`.
    - `POST /api/prescriptions/{id}/cancel`: requires `PrescriptionCancelRequest`, transitions to `CANCELLED`, records reason, timestamp, and user attribution.
    - Re-issuance: once an active prescription is cancelled, a new prescription can be created for the same encounter.
  - Added audit actions: `PRESCRIPTION_UPDATED`, `PRESCRIPTION_AUTHORISED`, `PRESCRIPTION_CANCELLED`.
- **Verification:**
  - `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_prescription_lifecycle.py -q` passed (3 tests).
  - All existing prescription tests in `backend/tests/test_prescriptions_api.py` continue to pass without regression (25 tests).
- **Commit:** `54ebf3c feat(19-03): prescription lifecycle authorisation cancellation and item delivery details`

### Task 3: Follow-up recommendations workflow and reception privacy separation
- **Files Modified:**
  - `backend/src/kalyan_api/schemas/follow_up.py`
  - `backend/src/kalyan_api/routers/follow_up.py`
  - `backend/src/kalyan_api/main.py`
  - `backend/src/kalyan_api/services/audit_service.py`
  - `backend/tests/test_follow_up_workflow.py`
- **Changes:**
  - Created `schemas/follow_up.py`:
    - `FollowUpRecommendationCreate`: target date, recommended doctor, optional clinical reason.
    - `DoctorFollowUpResponse`: includes all fields including `clinical_reason`.
    - `ReceptionFollowUpResponse`: strictly omits `clinical_reason` (D-19-19, R-3, T-19-07).
    - `FollowUpBookRequest` and `FollowUpCloseRequest`.
  - Implemented `routers/follow_up.py`:
    - `POST /api/encounters/{id}/follow-up`: doctor records recommendation, defaults target doctor to encounter doctor (D-19-20).
    - `GET /api/encounters/{id}/follow-up`: doctor retrieves recommendation with clinical reason.
    - `GET /api/reception/follow-ups`: reception lists pending/overdue recommendations. Query projects strictly reception columns without `clinical_reason`.
    - `POST /api/follow-ups/{id}/book`: converts recommendation into a booked appointment in `appointments` table with token generation, sets status to `BOOKED` (D-19-18).
    - `POST /api/follow-ups/{id}/close`: closes recommendation with recorded reason (min 3 chars), sets status to `CLOSED`, records closure attribution (D-19-21).
  - Registered `follow_up_router` in `backend/src/kalyan_api/main.py`.
  - Added audit actions: `FOLLOW_UP_RECOMMENDED`, `FOLLOW_UP_BOOKED`, `FOLLOW_UP_CLOSED`.
- **Verification:**
  - `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_follow_up_workflow.py -q` passed (4 tests).
- **Commit:** `0941ca4 feat(19-03): follow up recommendations engine with reception privacy isolation`

## Verification Summary
All 46 Phase 19 test suite test cases pass cleanly:
- `backend/tests/test_migrations.py` (3 passed)
- `backend/tests/test_appointment_encounter_uniqueness.py` (1 passed)
- `backend/tests/test_consultation_drafts.py` (4 passed)
- `backend/tests/test_auth_single_session.py` (9 passed)
- `backend/tests/test_specialty_templates.py` (5 passed)
- `backend/tests/test_vitals_and_bmi.py` (20 passed)
- `backend/tests/test_prescription_lifecycle.py` (3 passed)
- `backend/tests/test_follow_up_workflow.py` (4 passed)
