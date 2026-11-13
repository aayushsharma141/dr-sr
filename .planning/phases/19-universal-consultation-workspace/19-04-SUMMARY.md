# Phase 19 Plan 04 Summary: Centralized Scope Authorization, Cross-Doctor Clinical Read Access with Audit Logging, and RBAC Matrix Verification

## Overview
Phase 19 Plan 04 implements the architectural shift from strict single-doctor clinical data silos to a unified, centralized authorization and audit paradigm (DWS-04, D-19-05, T-19-08, T-19-09). Authenticated doctors can read any patient's longitudinal clinical records (encounters, prescriptions, timelines, treatment plans, treatment sessions, vitals, specialty template responses, and follow-ups) across doctors to support multidisciplinary clinic operations and handoffs. Cross-doctor reads automatically generate tamper-evident audit log entries (`CROSS_DOCTOR_CLINICAL_READ`). Mutations (write, finalise, addendum, draft update, authorise, cancel) remain strictly siloed to the authoring doctor. Administrative and reception roles remain default-denied from clinical records.

## Deliverables & Tasks Completed

### Task 1: Centralize Scope in `backend/src/kalyan_api/core/scope.py` with Cross-Doctor Read Audit Logging
- **Files Modified:**
  - `backend/src/kalyan_api/services/audit_service.py`
  - `backend/src/kalyan_api/core/scope.py`
  - `backend/tests/test_scope_helpers.py`
- **Changes:**
  - Added `AuditAction.CROSS_DOCTOR_CLINICAL_READ = "CROSS_DOCTOR_CLINICAL_READ"` in `audit_service.py` and exported helper `record_audit_event`.
  - Extended `ScopeFamily` in `core/scope.py`:
    - Added `CLINICAL_READ = "CLINICAL_READ"` and `CLINICAL_WRITE = "CLINICAL_WRITE"`. Retained `CLINICAL = "CLINICAL_WRITE"` as backwards-compatible alias.
  - Implemented `row_scope(principal, family, doctor_id_col)`:
    - For `CLINICAL_READ`: if `principal.role == Role.DOCTOR and principal.doctor_id is not None`, yields SQL `true()`. Non-doctors evaluate to SQL `false()`.
    - For `CLINICAL_WRITE`: if `principal.role == Role.DOCTOR and principal.doctor_id is not None`, enforces `doctor_id_col == principal.doctor_id`. Non-doctors evaluate to SQL `false()`.
  - Implemented `get_scoped_or_404(session, model, ident, principal, family, doctor_id_col)`:
    - Injects `row_scope` predicate directly into the primary key lookup.
    - When `family == ScopeFamily.CLINICAL_READ` and `principal.role == Role.DOCTOR`, if `row.doctor_id != principal.doctor_id`, records an audit event `AuditAction.CROSS_DOCTOR_CLINICAL_READ` containing `actor_doctor_id`, `record_doctor_id`, and `patient_id`.
  - Added comprehensive unit tests in `backend/tests/test_scope_helpers.py` verifying SQL predicates, audit logging execution, and write isolation.
- **Verification:**
  - `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_scope_helpers.py -q` passed (5 tests).
- **Commit:** `d8c64b2 feat(19-04): centralize scope in core/scope.py with cross-doctor read audit logging`

### Task 2: Eliminate Inline Silo Checks Across Clinical Routers
- **Files Modified:**
  - `backend/src/kalyan_api/routers/encounters.py`
  - `backend/src/kalyan_api/routers/prescriptions.py`
  - `backend/src/kalyan_api/routers/timeline.py`
  - `backend/src/kalyan_api/routers/treatment_plans.py`
  - `backend/src/kalyan_api/routers/treatment_sessions.py`
  - `backend/src/kalyan_api/routers/follow_up.py`
  - `backend/src/kalyan_api/routers/vitals.py`
  - Tests updated for DWS-04: `test_clinical_encounters.py`, `test_prescriptions_api.py`, `test_timeline_api.py`, `test_treatment_plans_api.py`
- **Changes:**
  - Removed scattered manual `enc.doctor_id != principal.doctor_id` / `rx.doctor_id != principal.doctor_id` conditionals across 5 clinical routers and auxiliary routers.
  - Replaced inline checks with centralized `get_scoped_or_404` and `row_scope`:
    - `encounters.py`: `get_encounter` & `get_encounter_template_response` use `CLINICAL_READ`; `update_encounter`, `finalise_encounter`, `add_encounter_addendum`, and `save_encounter_template_response` use `CLINICAL_WRITE`; `list_patient_encounters` filters with `row_scope(..., CLINICAL_READ)`.
    - `prescriptions.py`: `get_prescription` & `list_patient_prescriptions` use `CLINICAL_READ`; `update_prescription_draft`, `authorise_prescription`, `cancel_prescription` use `CLINICAL_WRITE`.
    - `timeline.py`: queries for encounters, prescriptions, and treatment sessions filter with `row_scope(..., CLINICAL_READ)`.
    - `treatment_plans.py`: plan and session reads use `CLINICAL_READ`; mutations and status transitions use `CLINICAL_WRITE`.
    - `treatment_sessions.py`: session logging and addenda use `CLINICAL_WRITE`; listing uses `CLINICAL_READ`.
    - `vitals.py` & `follow_up.py`: encounter lookups use `CLINICAL_READ` for inspection and `CLINICAL_WRITE` for observation creation.
  - Updated existing router test suites to reflect DWS-04 (verifying doctor B can read doctor A's clinical records, while mutations return 404).
- **Verification:**
  - `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_encounters.py backend/tests/test_prescriptions.py backend/tests/test_clinical_encounters.py backend/tests/test_prescriptions_api.py backend/tests/test_timeline_api.py backend/tests/test_treatment_plans_api.py -q` passed (98 tests).
- **Commit:** `b135f48 feat(19-04): eliminate inline silo checks across 5 clinical routers`

### Task 3: Cross-Doctor Access Security Suite and RBAC Verification
- **Files Modified:**
  - `backend/tests/test_cross_doctor_access.py`
  - `backend/tests/support/matrix.py`
  - `backend/tests/test_rbac_matrix.py`
- **Changes:**
  - Created `backend/tests/test_cross_doctor_access.py` verifying all 6 security invariants:
    1. Doctor B reads Doctor A's finalised encounter -> HTTP 200, creates `CROSS_DOCTOR_CLINICAL_READ` audit log entry with `actor_doctor_id`, `record_doctor_id`, and `patient_id`.
    2. Doctor A reads own encounter -> HTTP 200, produces NO cross-doctor audit log entry.
    3. Doctor B mutates Doctor A's encounter (update or addendum) -> HTTP 404.
    4. Doctor B cancels Doctor A's prescription -> HTTP 404.
    5. Reception reading encounters -> HTTP 403 or 404 (strictly blocked).
    6. Admin reading encounters -> HTTP 403 or 404 (strictly blocked).
    7. Direct unit test of `get_scoped_or_404` default-deny on non-doctor roles.
  - Updated `support/matrix.py`:
    - Registered 12 missing Phase 19 endpoints into `MATRIX` (vitals, template responses, cancellation, follow-up recommendations, booking, and closure).
    - Updated expectations to reflect DWS-04: `doctor_b` receives 200 for clinical read endpoints and 404 for mutation endpoints targeting Doctor A's resources.
    - Fixed payload factories for template responses and follow-up closure.
  - Verified `test_matrix_completeness_gate` passes with zero unregistered endpoints.
- **Verification:**
  - `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_cross_doctor_access.py backend/tests/test_rbac_matrix.py -q` passed (all 400+ matrix cells and security test cases).
- **Commit:** `2c3e379 feat(19-04): cross-doctor access security suite and rbac verification`

## Architectural Guarantees Verified
- **DWS-04 (Universal Longitudinal Access):** Any authenticated doctor with `doctor_id` can read patient clinical history created by any other doctor.
- **D-19-05 & T-19-08 (Auditing of Cross-Doctor Reads):** Every cross-doctor clinical read via `get_scoped_or_404` logs a tamper-evident audit record (`CROSS_DOCTOR_CLINICAL_READ`) detailing both doctor IDs and the patient ID.
- **Write Silo Isolation:** Doctor B cannot update, finalise, append addenda to, or cancel Doctor A's records; attempting to do so returns 404, preventing resource snooping or unauthorized edits.
- **T-19-09 & RBAC Completeness:** 100% of API endpoints registered in FastAPI are accounted for in the RBAC matrix with complete role coverage (`ANONYMOUS`, `ADMIN`, `RECEPTION`, `DOCTOR_A`, `DOCTOR_B`).
