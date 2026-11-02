# Plan 14-04 Summary: Physiotherapy Sessions & Addenda REST API

**Executed Date:** 2026-11-02  
**Status:** Completed  
**Branch:** `planning/phase-14-treatment-records`  

---

## 1. Work Completed
- **Service Layer in `backend/src/kalyan_api/services/session_service.py`:**
  - `allocate_next_session_number()`: Atomic `SELECT ... FOR UPDATE` row-level lock on `treatment_plans` ensuring contiguous 1..N session numbering with zero gaps and zero duplicates even under heavy concurrency.
  - Validates plan is `ACTIVE` and not already `COMPLETED`.
- **Pydantic Schemas in `backend/src/kalyan_api/schemas/treatment_sessions.py`:**
  - `TreatmentSessionCreate`: `session_date`, `vas_score` (0..10), `modalities` (list of strings), and `clinical_notes`.
  - `TreatmentSessionOut`: full session view with allocated `session_number`, audit fields, and nested `addenda`.
  - `TreatmentSessionAddendumCreate` and `TreatmentSessionAddendumOut`: retrospective clinical observations/corrections.
- **FastAPI Router in `backend/src/kalyan_api/routers/treatment_sessions.py`:**
  - `POST /api/treatment-plans/{plan_id}/sessions`: Concurrency-safe session logging (`SESSION_LOG_WRITE`).
  - `GET /api/treatment-plans/{plan_id}/sessions`: Chronological session list with VAS pain history and nested addenda (`SESSION_LOG_READ`).
  - `PATCH /api/treatment-sessions/{id}` & `DELETE /api/treatment-sessions/{id}`: Defense-in-depth immutability lock returning HTTP 400 Bad Request (`TRT-03`).
  - `POST /api/treatment-sessions/{id}/addenda`: Append dated addenda to finalized sessions (`SESSION_LOG_WRITE`).
- **Permissions & Audit:**
  - Activated `SESSION_LOG_READ` and `SESSION_LOG_WRITE` in RBAC catalog.
  - Enforced doctor silo (`D-03`) and reception default-deny (`D-04`).
  - In-transaction audit trail for `TREATMENT_SESSION_LOGGED` and `TREATMENT_SESSION_ADDENDUM_ADDED`.
- **Automated Verification:**
  - `backend/tests/test_treatment_sessions_api.py`: Validates session logging, VAS score boundaries, immutability defense, and addenda workflow.
  - `backend/tests/test_session_concurrency.py`: 20 parallel threads concurrently logging sessions against real PostgreSQL verify strictly contiguous numbering 1..20 with zero duplicates, zero gaps, and automatic plan completion.

---

## 2. Test Results
- `backend/tests/test_treatment_sessions_api.py`: 4 passed.
- `backend/tests/test_session_concurrency.py`: 1 passed (20-thread concurrency verified).
- Full Phase 14 regression suite (25 tests): 100% passing.
- Ruff linter & formatter: 100% clean, 0 errors.
