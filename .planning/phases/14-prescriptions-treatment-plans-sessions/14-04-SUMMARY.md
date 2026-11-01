# Plan 14-04 Summary: Physiotherapy Sessions & Addenda REST API

**Executed Date:** 2026-11-02  
**Status:** Completed  
**Branch:** `planning/phase-14-treatment-records`  

---

## 1. Work Completed
- **Atomic Session Sequence Allocation (`backend/src/kalyan_api/services/session_service.py`):**
  - `allocate_next_session_number(session, treatment_plan_id)` uses `SELECT ... FOR UPDATE` row lock on `treatment_plans`.
  - Verifies plan is in `ACTIVE` state.
  - Verifies `completed_sessions < total_sessions` (raises HTTP 422 if package session limit already reached).
  - Guarantees sequential, gap-free, atomic session numbering even under high-concurrency race conditions.
- **Pydantic Schemas (`backend/src/kalyan_api/schemas/treatment_sessions.py`):**
  - `TreatmentSessionCreate`: `doctor_id`, `session_date`, `vas_score` ($0 \le \text{VAS} \le 10$), `modalities` (list of strings), `clinical_notes`.
  - `TreatmentSessionOut`: full session representation with nested `addenda`.
  - `TreatmentSessionAddendumCreate`: `note` ($\ge 3$ characters).
  - `TreatmentSessionAddendumOut`: addendum attributes with author user attribution and ISO timestamp.
- **FastAPI Endpoints (`backend/src/kalyan_api/routers/treatment_sessions.py`):**
  - `POST /api/treatment-plans/{plan_id}/sessions`: Log new session (`SESSION_LOG_WRITE`).
  - `GET /api/treatment-plans/{plan_id}/sessions`: Retrieve sessions in chronological order (`SESSION_LOG_READ`).
  - `PATCH /api/treatment-sessions/{id}` & `DELETE /api/treatment-sessions/{id}`: Return `400 Bad Request` (`immutable_record`) protecting finalised clinical records.
  - `POST /api/treatment-sessions/{id}/addenda`: Append retrospective amendment note (`SESSION_LOG_WRITE`).
- **Audit Logging:**
  - Audited events: `TREATMENT_SESSION_LOGGED` and `TREATMENT_SESSION_ADDENDUM_ADDED`.
- **RBAC Permissions:**
  - `SESSION_LOG_READ` and `SESSION_LOG_WRITE` assigned to DOCTOR role; denied to RECEPTION role (`D-03`, `D-04`).

---

## 2. Test Results & Concurrency Proof
- `backend/tests/test_treatment_sessions_api.py`: 4 passed.
  - `test_session_logging_and_addenda_lifecycle`: verified end-to-end logging, progress trigger sync, addenda creation, and package session limit enforcement (HTTP 422).
  - `test_session_immutability_defense`: verified HTTP 400 rejection for PATCH and DELETE attempts.
  - `test_vas_score_bounds_validation`: verified rejection of VAS scores $< 0$ or $> 10$ with HTTP 422.
  - `test_doctor_silo_and_role_access`: verified doctor silo isolation and reception default-deny (HTTP 403).
- `backend/tests/test_session_concurrency.py`: 1 passed.
  - `test_parallel_session_allocation_no_duplicates_or_gaps`: 20 parallel threads concurrently logged sessions on a single treatment plan with zero duplicates, zero gaps, and exact sequence allocation $1 \dots 20$.
- `backend/tests/test_permissions_catalogue.py`: 5 passed.
- `backend/tests/test_openapi_snapshot.py`: 2 passed.
- Ruff linter: 100% clean, 0 errors.
