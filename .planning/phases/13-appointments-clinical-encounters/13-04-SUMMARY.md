# Summary 13-04: Clinical Encounters & Addenda API with Doctor Silo & Note Immutability

**Date:** 2026-11-01  
**Status:** Complete  
**Plan:** `.planning/phases/13-appointments-clinical-encounters/13-04-PLAN.md`

## What Was Done

1. **Pydantic Schemas (`backend/src/kalyan_api/schemas/encounters.py`):**
   - `EncounterCreate`: chief complaints/symptoms, clinical examination, diagnosis, optional appointment linking.
   - `EncounterUpdate`: updates draft encounter note with optimistic locking `version_id`.
   - `EncounterRead`: full clinical encounter model including attached addenda.
   - `EncounterSummary`: compact record for patient historical timeline.
   - `AddendumCreate` and `AddendumRead`: dated addenda records.

2. **REST Endpoints (`backend/src/kalyan_api/routers/encounters.py`):**
   - `POST /api/encounters`: Records clinical encounter note. Enforces doctor role (`ENCOUNTER_WRITE`); reception receives HTTP 403. Advances linked appointment status to `IN_CONSULTATION`.
   - `GET /api/encounters/{id}`: Retrieves encounter details with addenda. Enforces doctor silo (`D-03`); unauthorized cross-doctor lookups return 404 Not Found to prevent ID harvesting.
   - `GET /api/patients/{patient_id}/encounters`: Returns patient clinical history scoped to the calling doctor.
   - `PATCH /api/encounters/{id}`: Modifies draft encounters with `version_id` optimistic locking. If `is_finalised` is True, rejects with HTTP 400 `encounter_finalised_immutable`.
   - `POST /api/encounters/{id}/finalise`: Permanently finalises encounter note (`is_finalised = True`). Automatically advances linked appointment to `DONE`.
   - `POST /api/encounters/{id}/addenda`: Appends dated addendum to finalised encounter. Rejects unfinalised encounters with HTTP 400.
   - Registered `encounters_router` in `main.py`.

3. **Automated Verification:**
   - Created `backend/tests/test_clinical_encounters.py`:
     - Encounter draft creation, updating, finalisation, immutable edit rejection (400), and addenda appending verified.
     - Reception clinical default-deny verified (403 on create, read, and history list).
     - Cross-doctor isolation verified (Doctor B receives 404 on Doctor A's encounters).
     - Attempt to add addenda before finalisation verified to fail with 400.
   - All 3 tests passed.
   - `ruff check backend`: 100% clean.

## Verification Run
```bash
backend\.venv\Scripts\pytest.exe backend\tests\test_clinical_encounters.py
3 passed, 1 warning in 1.79s
```
