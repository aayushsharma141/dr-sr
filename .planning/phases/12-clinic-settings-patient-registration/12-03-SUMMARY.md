---
phase: 12-clinic-settings-patient-registration
plan: 03
wave: 3
status: completed
date: 2026-11-01
---

# Plan 12-03: Atomic URN Generator, Patient Registration & Duplicate Detection Summary

## 1. Executive Summary
Plan 12-03 implements the atomic concurrency-safe URN sequence generator (`KH-YYYY-XXXX`), patient registration REST endpoint (`POST /api/patients`), and non-blocking duplicate detection endpoint (`GET /api/patients/check-duplicate`). All 12 canonical patient demographic fields are validated and persisted with full audit logging (`PATIENT_REGISTERED`) and optimistic locking support.

A 20-thread parallel race test against real PostgreSQL proves zero duplicates and zero gaps in the URN counter.

---

## 2. Tasks Completed

### Task 1: Atomic Concurrency-Safe URN Service & Concurrency Test
- **URN Service (`backend/src/kalyan_api/services/urn_service.py`):**
  - Formats URNs as `KH-{year}-{seq:04d}` restarting sequence at 0001 per calendar year.
  - Implements atomic increment via `INSERT INTO urn_sequences ... ON CONFLICT (year) DO UPDATE SET last_seq = urn_sequences.last_seq + 1 RETURNING last_seq;` ensuring race-free sequence allocation.
- **Concurrency Test (`backend/tests/test_urn_concurrency.py`):**
  - Spawns 20 parallel threads racing simultaneously in separate committed transactions.
  - Asserts strictly 20 distinct consecutive sequential URNs with zero collisions and zero gaps.

### Task 2: Patient Registration Endpoint & Duplicate Detection
- **Pydantic Schemas (`backend/src/kalyan_api/schemas/patients.py`):**
  - `PatientCreate`: Validates the 12 canonical demographic fields (`full_name`, `guardian_name`, `gender`, `dob`, `age_years`, `mobile`, `address`, `district`, `state`, `emergency_contact`, `allergies`, `notes`) with strict bounds and `extra="forbid"`.
  - `PatientOut`: Complete demographic response schema including `urn`, timestamps, and `version_id`.
  - `DuplicateCheckResponse`: Non-blocking duplicate indicator with optional matched patient summary.
- **REST Router (`backend/src/kalyan_api/routers/patients.py`):**
  - `POST /api/patients`: Restricted to `RECEPTION` (`patient:create`). Automatically allocates atomic URN, normalizes mobile, persists patient record, and writes `PATIENT_REGISTERED` audit log event within the same transaction. Returns 201 with `PatientOut`.
  - `GET /api/patients/check-duplicate`: Accessible to authenticated roles (`patient:read`). Matches active patients using normalized name (case-insensitive, whitespace-collapsed) and mobile phone suffix without blocking workflow.
- **RBAC & Governance (`backend/src/kalyan_api/core/permissions.py`, `backend/tests/support/matrix.py`, `backend/tests/test_rbac_matrix.py`):**
  - Graduated `PATIENT_CREATE` and `PATIENT_READ` out of `RESERVED`.
  - Added matrix entries across all 5 system identities (`anonymous`, `admin`, `reception`, `doctor_a`, `doctor_b`). Matrix test suite now covers 134 cells.
  - Updated `backend/tests/openapi.snapshot.json`.

---

## 3. Verification Evidence

- `backend/tests/test_urn_concurrency.py`: 1 passed (20 threads concurrent race, 0 duplicates, 0 gaps).
- `backend/tests/test_patient_registration.py`: 5 passed (anonymous 401, RBAC reception-only 201/403, 12-field persistence & audit, sequential URNs, validation rules 422, duplicate check normalization).
- `backend/tests/test_permissions_catalogue.py`: 5 passed (no orphan permissions, noun:verb, golden snapshot).
- `backend/tests/test_rbac_matrix.py`: 134 passed.
- `backend/tests/test_openapi_snapshot.py`: 2 passed.
- Full test suite: 318 passed, 1 skipped (frontend dist check), 0 failures.
- Linter: `ruff check backend` clean (0 errors).
