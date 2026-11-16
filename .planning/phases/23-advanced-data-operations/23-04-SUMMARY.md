# Phase 23 Plan 04 Summary: Filtered Bulk Archival, Hard Financial Dues Guard & Workstation Monitoring Backend

**Plan:** 23-04  
**Status:** VERIFIED (automated pytest suite passing, zero orphan permissions, all must-haves met)  
**Requirements:** ARCH-01, ARCH-02, ARCH-03, WS-01, WS-02  

---

## 1. AGENTS.md Governance Report

- **Task ID:** 23-04 (ARCH-01, ARCH-02, ARCH-03, WS-01, WS-02)
- **Owned Files:**
  - `backend/src/kalyan_api/services/patient_archive_service.py`
  - `backend/src/kalyan_api/services/workstation_service.py`
  - `backend/src/kalyan_api/routers/admin_patients.py`
  - `backend/src/kalyan_api/routers/system.py`
  - `backend/src/kalyan_api/schemas/patients.py`
  - `backend/src/kalyan_api/schemas/workstations.py`
  - `backend/src/kalyan_api/core/permissions.py`
  - `backend/src/kalyan_api/main.py`
  - `backend/src/kalyan_api/migrations/versions/0030_patient_merge_archive_and_workstations.py`
  - `backend/tests/test_phase23_patient_archive.py`
  - `backend/tests/test_phase23_workstations.py`
- **Findings:**
  - Archival safety guard: inactive patients cannot be archived if they have outstanding financial dues (>0 paise) or active open visits. Archiving an active debtor would compromise ledger auditability.
  - Runtime permissions on workstations table required explicit grant to `kalyan_app` in migration 0030.
  - Workstation status calculation uses strict thresholds: <=60s ONLINE, <=300s IDLE, >300s OFFLINE.
- **Root Cause:**
  - Hospital needed automated data lifecycle archival for patients with no visits for >=3 years, hard debt guards, and a live LAN workstation monitor.
- **Changes:**
  - `backend/src/kalyan_api/schemas/workstations.py`:
    - Defined `WorkstationHeartbeatIn` and `WorkstationOut` schemas.
  - `backend/src/kalyan_api/services/workstation_service.py`:
    - Implemented `record_heartbeat()` upserting workstation by hostname with IP, terminal name, app version, last user, and timestamp.
    - Implemented `list_workstations()` with dynamic status calculation (ONLINE, IDLE, OFFLINE).
  - `backend/src/kalyan_api/services/patient_archive_service.py`:
    - Implemented `find_archival_candidates()` filtering by inactivity years, district, zero visits, with dues and open-visit status evaluation.
    - Implemented `bulk_archive_patients()` enforcing open visit guard and hard financial dues guard (`patient_has_outstanding_dues`), setting `is_archived = True`, and logging audit records.
    - Implemented `unarchive_patient()` restoring active status and clearing archival reason.
  - `backend/src/kalyan_api/routers/admin_patients.py`:
    - Added `GET /admin/patients/archival-candidates`, `POST /admin/patients/bulk-archive`, and `POST /admin/patients/{id}/unarchive` protected by `Permission.PATIENT_ARCHIVE`.
  - `backend/src/kalyan_api/routers/system.py` & `main.py`:
    - Added `POST /api/system/heartbeat` and `GET /api/admin/workstations` (and `/api/system/workstations`) protected by `Permission.WORKSTATION_READ`.
  - `backend/src/kalyan_api/core/permissions.py`:
    - Cleared `RESERVED` mapping as all Phase 23 permissions (`patient:merge`, `patient:archive`, `workstation:read`) are now actively wired to routes.
  - `backend/src/kalyan_api/migrations/versions/0030_patient_merge_archive_and_workstations.py`:
    - Added PostgreSQL runtime permissions grant on `workstations` table and sequences to `kalyan_app`.
  - Tests:
    - Added `backend/tests/test_phase23_patient_archive.py` (5 tests passing).
    - Added `backend/tests/test_phase23_workstations.py` (3 tests passing).
- **Test Commands & Results:**
  - `backend\.venv\Scripts\pytest.exe backend/tests/test_phase23_patient_archive.py backend/tests/test_phase23_workstations.py`: 8 passed.
  - Combined suite of all Phase 23 tests: 33 passed in 7.36s.
- **Dependencies:**
  - Plans 23-01, 23-02, 23-03.
- **Remaining Risks:**
  - Frontend UI integration and verification gate (Plan 23-05).
