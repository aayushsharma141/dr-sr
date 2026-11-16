# Phase 23 Plan 02 Summary: Duplicate Candidate Detection, Open Visit Safety Guard & Alias-Pointer Merge/Unmerge

**Plan:** 23-02  
**Status:** VERIFIED (automated pytest suite passing, tamper triggers preserved)  
**Requirements:** MERGE-01, MERGE-02, MERGE-03, MERGE-04  

---

## 1. AGENTS.md Governance Report

- **Task ID:** 23-02 (MERGE-01, MERGE-02, MERGE-03, MERGE-04)
- **Owned Files:**
  - `backend/src/kalyan_api/services/patient_merge_service.py`
  - `backend/src/kalyan_api/routers/admin_patients.py`
  - `backend/src/kalyan_api/schemas/patients.py`
  - `backend/src/kalyan_api/services/audit_service.py`
  - `backend/src/kalyan_api/core/permissions.py`
  - `backend/tests/test_phase23_patient_merge.py`
- **Findings:**
  - Administrative duplicate detection required fuzzy name similarity matching while grouping on exact phone numbers to prevent cross-patient false positives.
  - Clinical safety invariant: patients with active/open visits cannot undergo merge; merging mid-consultation would corrupt active queues and active billing snapshots.
  - Immutability trigger invariant: PostgreSQL database triggers `trg_prevent_payment_tampering` and `trg_prevent_finalised_encounter_tampering` forbid rewriting `patient_id` on historical payments or encounters. The alias-pointer model (`secondary.is_active = False`, `secondary.merged_into_id = master.id`) preserves all historical rows completely untouched.
- **Root Cause:**
  - Kalyan Hospital needed a reliable, safe administrative workflow to detect duplicate registrations and merge duplicate patient files with zero historical record corruption and full audit trails.
- **Changes:**
  - `backend/src/kalyan_api/schemas/patients.py`:
    - Defined schemas: `DuplicateCandidatePair`, `PatientMergeRequest`, `PatientMergeResult`, `PatientUnmergeRequest`, `ArchivalCandidateItem`, `BulkArchiveRequest`, `BulkArchiveResult`.
    - Added merge and archive metadata fields to `PatientOut`.
  - `backend/src/kalyan_api/services/audit_service.py`:
    - Added `PATIENT_MERGED`, `PATIENT_UNMERGED`, `PATIENT_ARCHIVED`, `PATIENT_UNARCHIVED` actions to `AuditAction`.
  - `backend/src/kalyan_api/services/patient_merge_service.py`:
    - Implemented `normalize_name()` and `compute_name_similarity()` via `difflib.SequenceMatcher`.
    - Implemented `check_open_visit()` querying for visits with `closed_at IS NULL`.
    - Implemented `find_duplicate_candidates()` grouping active patients with same mobile and similarity >= 0.70.
    - Implemented `merge_patients()`:
      - Validates distinct patients and existing records.
      - Enforces strict open visit guard (`open_visit_conflict` HTTP 400).
      - Applies optional demographic overrides from secondary to master.
      - Sets secondary `is_active = False`, `merged_into_id = master.id`, `merged_at`, `merged_by_user_id`, `merge_reason`.
      - Emits `PATIENT_MERGED` audit event.
    - Implemented `unmerge_patient()`:
      - Clears merge pointer and restores secondary `is_active = True`.
      - Emits `PATIENT_UNMERGED` audit event.
  - `backend/src/kalyan_api/routers/admin_patients.py`:
    - Exposed `GET /admin/patients/duplicates` protected by `Permission.PATIENT_MERGE`.
    - Exposed `POST /admin/patients/merge` protected by `Permission.PATIENT_MERGE`.
    - Exposed `POST /admin/patients/{id}/unmerge` protected by `Permission.PATIENT_MERGE`.
  - `backend/src/kalyan_api/core/permissions.py`:
    - Removed `Permission.PATIENT_MERGE` from `RESERVED` as its endpoints are now active.
  - `backend/tests/test_phase23_patient_merge.py`:
    - Automated tests covering duplicate detection, open-visit guard fail-closed behavior, tamper trigger preservation, demographic override application, safe unmerge restoration, and strict reception RBAC boundary.
- **Test Commands & Results:**
  - `backend\.venv\Scripts\pytest.exe backend/tests/test_phase23_patient_merge.py`: 4 passed.
  - `backend\.venv\Scripts\pytest.exe backend/tests/test_permissions_catalogue.py`: 13 passed (0 orphan permissions, 0 illegal route bindings).
- **Dependencies:**
  - Plan 23-01 (Migration 0030, Models & RBAC).
- **Remaining Risks:**
  - Downstream read aggregations (timeline, visits, dues) must read through `effective_patient_ids` (handled in Plan 23-03).
