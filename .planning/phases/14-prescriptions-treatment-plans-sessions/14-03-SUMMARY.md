# Plan 14-03 Summary: Treatment Plans & Packages REST API

**Executed Date:** 2026-11-02  
**Status:** Completed  
**Branch:** `planning/phase-14-treatment-records`  

---

## 1. Work Completed
- **Pydantic Schemas in `backend/src/kalyan_api/schemas/treatment_plans.py`:**
  - `TreatmentPlanCreate`: inputs for `patient_id`, `encounter_id`, `plan_name`, `condition_diagnosis`, `referred_by`, `total_sessions` (1–200), and `agreed_price_paise` ($\ge 0$).
  - `TreatmentPlanUpdate`: optimistic concurrency control via `version_id`, optional terms edits, and status transition with mandatory `cancellation_reason` ($\ge 3$ characters).
  - `TreatmentPlanOut`: full plan progress view including `completed_sessions`, `status`, and timestamps.
- **FastAPI Router in `backend/src/kalyan_api/routers/treatment_plans.py`:**
  - `POST /api/treatment-plans`: Doctor creates treatment package (`PLAN_WRITE`).
  - `GET /api/treatment-plans/{id}`: View plan details and progress (`PLAN_READ`).
  - `GET /api/patients/{id}/treatment-plans`: List plans for a patient (`PLAN_READ`).
  - `PATCH /api/treatment-plans/{id}`: Modify or cancel plan with optimistic locking (HTTP 409 on version conflict) and cancellation reason enforcement.
- **Permissions & Audit:**
  - Activated `PLAN_READ` and `PLAN_WRITE` in RBAC catalog.
  - Enforced doctor silo (`D-03`) and reception default-deny (`D-04`).
  - In-transaction audit trail for `TREATMENT_PLAN_CREATED`, `TREATMENT_PLAN_UPDATED`, and `TREATMENT_PLAN_CANCELLED`.
- **Verification Tests in `backend/tests/test_treatment_plans_api.py`:**
  - Verified creation and term modifications with optimistic concurrency locking.
  - Verified 409 Conflict on stale version_id.
  - Verified cancellation requirement for reason $\ge 3$ characters and immutability once cancelled.
  - Verified doctor silo isolation and role access controls.
  - Verified snapshot consistency and permissions catalogue.

---

## 2. Test Results
- `backend/tests/test_treatment_plans_api.py`: 4 passed.
- `backend/tests/test_prescriptions_api.py`: 4 passed.
- `backend/tests/test_treatment_models.py`: 5 passed.
- `backend/tests/test_permissions_catalogue.py`: 5 passed.
- `backend/tests/test_openapi_snapshot.py`: 2 passed.
- All 20 tests passed in 6.65s.
- Ruff linter & formatter: 100% clean, 0 errors.
