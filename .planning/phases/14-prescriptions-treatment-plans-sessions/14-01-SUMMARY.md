# Plan 14-01 Summary: Database Models & Migration 0004

**Executed Date:** 2026-11-01  
**Status:** Completed  
**Branch:** `planning/phase-14-treatment-records`  

---

## 1. Work Completed
- **SQLAlchemy 2.0 ORM Models in `backend/src/kalyan_api/models.py`:**
  - Added `TreatmentPlanStatus` (`ACTIVE`, `COMPLETED`, `CANCELLED`).
  - Added `TreatmentPlan` with check constraints (`total_sessions` between 1 and 200, `completed_sessions` between 0 and `total_sessions`, `agreed_price_paise >= 0`, status enum validation, and mandatory cancellation reason).
  - Added `TreatmentSession` with check constraints (`0 <= vas_score <= 10`, `session_number >= 1`, notes length), JSONB `modalities`, unique constraint on `(treatment_plan_id, session_number)`, and `is_finalised` immutability flag.
  - Added `TreatmentSessionAddendum` for dated clinical addenda to finalized sessions.
  - Added `Prescription` and `PrescriptionItem` with item ordering, duration bounds (1–365), and unique constraint on `(prescription_id, item_order)`.
- **Alembic Migration `0004_prescriptions_and_treatment_records.py`:**
  - Created tables: `treatment_plans`, `treatment_sessions`, `treatment_session_addenda`, `prescriptions`, `prescription_items`.
  - Added PostgreSQL trigger `trg_prevent_finalised_treatment_session_tampering` with function `fn_prevent_finalised_treatment_session_tampering()` enforcing strict immutability on finalized sessions (`TRT-03`).
  - Added PostgreSQL trigger `trg_sync_treatment_plan_session_progress` with function `fn_sync_treatment_plan_session_progress()` automatically updating `completed_sessions` and marking the plan `COMPLETED` when targets are reached.
  - Granted `kalyan_app` least-privilege DML permissions and full downgrade rollback functionality.
- **Verification Tests in `backend/tests/test_treatment_models.py`:**
  - Verified persistence and relational mapping across all 5 tables.
  - Verified check constraints for total sessions, negative prices, cancellation reasons, and VAS score range (0–10).
  - Verified unique constraints on session numbers per plan and item order per prescription.
  - Verified immutability trigger rejecting UPDATE and DELETE on finalized treatment sessions.
  - Verified auto-completion trigger transitioning plan status to `COMPLETED`.
  - Verified single head linear migration in `backend/tests/test_migrations.py`.

---

## 2. Test Results
- `backend/tests/test_treatment_models.py`: 5 passed.
- `backend/tests/test_migrations.py`: 3 passed.
- `backend/tests/test_openapi_snapshot.py`: 2 passed.
- Ruff linter & formatter: 100% clean, 0 errors.
