# Phase 23 Plan 01 Summary: Migration 0030, Models & RBAC Permissions Matrix

**Plan:** 23-01  
**Status:** VERIFIED (backend test suite 805/805 passing, Alembic check clean)  
**Requirements:** MIG-30, RBAC-23  

---

## 1. AGENTS.md Governance Report

- **Task ID:** 23-01 (MIG-30, RBAC-23)
- **Owned Files:**
  - `backend/src/kalyan_api/migrations/versions/0030_patient_merge_archive_and_workstations.py`
  - `backend/src/kalyan_api/models.py`
  - `backend/src/kalyan_api/core/permissions.py`
  - `backend/src/kalyan_api/routers/roles.py`
  - `backend/src/kalyan_api/services/backup_service.py`
  - `backend/tests/test_phase23_schema.py`
  - `backend/tests/test_phase23_rbac.py`
  - `backend/tests/test_permissions_catalogue.py`
- **Findings:**
  - `patients` table lacked columns for the non-destructive alias-pointer merge model (`merged_into_id`, `merged_at`, `merged_by_user_id`, `merge_reason`) and soft-archival (`is_archived`, `archived_at`, `archived_by_user_id`, `archive_reason`).
  - No database structure existed for tracking active hospital LAN terminals/workstations.
  - Permissions catalogue lacked definitions for `patient:merge`, `patient:archive`, and `workstation:read`.
- **Root Cause:**
  - Phase 23 foundational schema and RBAC requirements had not yet been declared in migrations, models, and permissions.
- **Changes:**
  - `backend/src/kalyan_api/migrations/versions/0030_patient_merge_archive_and_workstations.py`:
    - Added columns to `patients`: `merged_into_id` (FK to `patients.id` ON DELETE RESTRICT), `merged_at`, `merged_by_user_id` (FK to `users.id` ON DELETE SET NULL), `merge_reason`, `is_archived` (default FALSE), `archived_at`, `archived_by_user_id`, `archive_reason`.
    - Added indices `ix_patients_merged_into_id` and `ix_patients_is_archived`.
    - Created `workstations` table with `id`, `hostname` (unique), `ip_address`, `terminal_name`, `app_version`, `last_seen_at`, `last_user_id` (FK to `users.id`), `last_username`, `created_at`, `updated_at`.
    - Created indices `ix_workstations_hostname` and `ix_workstations_last_seen_at`.
    - Implemented safe downgrade guard preventing data loss.
  - `backend/src/kalyan_api/models.py`:
    - Added merge and archival fields to `Patient` model.
    - Defined `Workstation` SQLAlchemy model.
  - `backend/src/kalyan_api/core/permissions.py`:
    - Added `PATIENT_MERGE = "patient:merge"`, `PATIENT_ARCHIVE = "patient:archive"`, `WORKSTATION_READ = "workstation:read"`.
    - Assigned permissions strictly to `Role.ADMIN` in `ROLE_PERMISSIONS`. `Role.RECEPTION` and `Role.DOCTOR` receive none.
    - Registered entries in `RESERVED` for planned downstream phase tasks.
  - `backend/src/kalyan_api/routers/roles.py`:
    - Mapped `workstation` noun to `"System"` display group.
    - Added descriptive labels for the three new permissions in `PERMISSION_DESCRIPTIONS`.
  - `backend/src/kalyan_api/services/backup_service.py`:
    - Added `"workstations"` to `RUNTIME_TABLE_GRANTS`.
  - Tests:
    - Added `backend/tests/test_phase23_schema.py` verifying model columns and table reflection.
    - Added `backend/tests/test_phase23_rbac.py` asserting strict role matrix boundaries.
    - Updated `backend/tests/test_permissions_catalogue.py` golden snapshot.
- **Test Commands & Results:**
  - `pytest backend/tests/test_phase23_schema.py backend/tests/test_phase23_rbac.py backend/tests/test_migrations.py backend/tests/test_permissions_catalogue.py backend/tests/test_rbac_matrix.py`:
    - 805 passed in 145.37s.
    - `test_migrations_match_models` passed (0 Alembic schema drift).
- **Dependencies:**
  - `0030` revision depends on `0029`.
- **Remaining Risks:**
  - Migration 0030 is applied to `kalyan_test` in test runs. Deployment to `kalyan_dev` follows plan 23-05 after end-to-end verification.
