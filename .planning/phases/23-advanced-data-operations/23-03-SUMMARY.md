# Phase 23 Plan 03 Summary: Consolidated Patient Aggregations (Timeline, Visits, Dues) & Check-In Guards

**Plan:** 23-03  
**Status:** VERIFIED (automated pytest suite passing, all must-haves met)  
**Requirements:** MERGE-05  

---

## 1. AGENTS.md Governance Report

- **Task ID:** 23-03 (MERGE-05)
- **Owned Files:**
  - `backend/src/kalyan_api/routers/timeline.py`
  - `backend/src/kalyan_api/routers/patients.py`
  - `backend/src/kalyan_api/routers/visits.py`
  - `backend/src/kalyan_api/services/billing_service.py`
  - `backend/src/kalyan_api/services/booking_service.py`
  - `backend/tests/test_phase23_patient_consolidation.py`
- **Findings:**
  - With the non-destructive alias-pointer merge model, historical clinical records and financial payments remain tied to the secondary patient row to preserve PostgreSQL immutability triggers (`trg_prevent_payment_tampering`, `trg_prevent_finalised_encounter_tampering`).
  - To present a single comprehensive medical record to clinicians, queries for the master patient record must aggregate events, visits, and outstanding dues across all merged secondary patient records via `effective_patient_ids`.
  - Operations that create new clinical or financial encounters (appointments, walk-ins, check-in desk) must strictly fail closed (HTTP 400 `patient_inactive_or_merged`) if attempted against a merged, deactivated, or archived patient file.
- **Root Cause:**
  - Downstream read queries previously filtered strictly on `patient_id == target_id`, omitting records originally booked under duplicate patient accounts prior to merge.
- **Changes:**
  - `backend/src/kalyan_api/routers/timeline.py`:
    - Resolved `effective_patient_ids` (master ID + all `Patient.merged_into_id == master.id`).
    - Aggregated appointments, clinical encounters, prescriptions, treatment plans, therapy sessions, and payments across `effective_patient_ids`.
  - `backend/src/kalyan_api/routers/patients.py`:
    - Added `merged_into_urn` population to `get_patient_by_id` and batch lookups to `list_or_search_patients` so frontends can display redirect notices.
  - `backend/src/kalyan_api/routers/visits.py`:
    - Filtered `Visit.patient_id.in_(effective_ids)` when `patient_id` parameter is provided.
  - `backend/src/kalyan_api/services/billing_service.py`:
    - Extended `patient_previous_dues` to accumulate outstanding balances from closed visits of merged records into the master patient's dues summary.
  - `backend/src/kalyan_api/services/booking_service.py`:
    - In `create_booking`: Guard against deactivated, merged (`merged_into_id is not None`), or archived patients with HTTP 400 `patient_inactive_or_merged`.
    - In `check_in`: Guard against checking in a booked appointment whose patient record was subsequently merged/deactivated with HTTP 400 `patient_inactive_or_merged`.
  - `backend/tests/test_phase23_patient_consolidation.py`:
    - Automated tests verifying timeline consolidation, visit list consolidation, master URN resolution in detail & search, advance/walk-in check-in blockage for merged records, and previous dues aggregation across merged visits.
- **Test Commands & Results:**
  - `backend\.venv\Scripts\pytest.exe backend/tests/test_phase23_patient_consolidation.py`: 4 passed in 3.34s.
  - `backend\.venv\Scripts\pytest.exe backend/tests/test_phase23_schema.py backend/tests/test_phase23_rbac.py backend/tests/test_phase23_patient_merge.py backend/tests/test_phase23_patient_consolidation.py backend/tests/test_permissions_catalogue.py`: 25 passed.
- **Dependencies:**
  - Plan 23-01 (Models & RBAC), Plan 23-02 (Merge/Unmerge Service).
- **Remaining Risks:**
  - None for Wave 2 consolidation.
