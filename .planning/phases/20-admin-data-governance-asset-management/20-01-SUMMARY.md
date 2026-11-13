# Phase 20 Plan 01 Summary: Admin Inventory Freeze and Permissions Tracer

## Overview
Phase 20 Plan 01 establishes the foundational administration inventory freeze, OpenAPI contract baseline, and RBAC permissions extension per decision **D-20-01**. It registers `patient:correct`, `patient:import`, and `patient:export` in the permission catalogue strictly for `Role.ADMIN`, enforces that `Role.RECEPTION` and `Role.DOCTOR` remain unchanged and `Role.ADMIN` does NOT have `patient:update`, documents and freezes all 33 active administration endpoints, schemas, and triggers, and updates the OpenAPI contract snapshot.

---

## Deliverables & Tasks Completed

### Task 1: Permissions tracer — register `patient:correct`, `patient:import`, `patient:export` in Permission enum and `Role.ADMIN`
- **Files Modified:**
  - `backend/src/kalyan_api/core/permissions.py`
  - `backend/src/kalyan_api/routers/roles.py`
  - `backend/tests/test_permissions_catalogue.py`
  - `backend/tests/test_roles_api.py`
- **Changes:**
  - Added new enum members to `Permission(StrEnum)`:
    - `PATIENT_CORRECT = "patient:correct"`
    - `PATIENT_IMPORT = "patient:import"`
    - `PATIENT_EXPORT = "patient:export"`
  - Added all three new permissions to `ROLE_PERMISSIONS[Role.ADMIN]`.
  - Added human-readable labels to `PERMISSION_LABELS` in `routers/roles.py` ("Correct patient demographics", "Import patients", "Export patient data").
  - Registered the 3 permissions in `RESERVED` mapping in `permissions.py` and allowlisted them in `test_no_orphan_permissions()`.
  - Verified that `Role.RECEPTION` and `Role.DOCTOR` remain strictly unchanged.
  - Verified that `Role.ADMIN` does NOT possess `Permission.PATIENT_UPDATE`, guaranteeing reception's operational demographic editing route remains closed to Admin.
  - Updated `test_golden_role_permissions_snapshot()` in `test_permissions_catalogue.py`.
  - Added `test_admin_does_not_have_patient_update()` in `test_permissions_catalogue.py` and `test_admin_grants_include_phase20_data_governance_permissions()` in `test_roles_api.py`.
- **Verification:**
  - `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_permissions_catalogue.py backend/tests/test_roles_api.py -q` passed (11 tests).
- **Commit:** `d13d025 feat(20-01): register patient:correct, patient:import, patient:export permissions in Role.ADMIN`

---

### Task 2: Inventory freeze documentation and OpenAPI snapshot baseline
- **Files Created / Modified:**
  - `.planning/phases/20-admin-data-governance-asset-management/20-ADMIN-INVENTORY-FREEZE.md` (Created)
  - `backend/tests/openapi.snapshot.json` (Updated)
- **Changes:**
  - Authored comprehensive inventory freeze document `20-ADMIN-INVENTORY-FREEZE.md` capturing:
    - All 33 active administration endpoints with their source routers and policy markers (`require(Permission.X)`).
    - Core database schemas and tables (`clinic_settings`, `users`, `audit_logs`, `payments`, `doctors`, `consultation_fees`).
    - PostgreSQL tamper-prevention triggers (`trg_prevent_payment_tampering`, `trg_audit_logs_no_update_delete`).
    - Frontend module registry baseline (`modules.ts`) and plan for the 5-section navigation reorganization (D-20-21 / D-20-22).
    - Phase 20 target gap additions (`/api/admin/patients/{id}/demographics`, `/api/admin/templates`, `/api/admin/assets`, `/api/admin/imports`, `/api/admin/exports`).
  - Exported clean OpenAPI contract baseline via `python -m kalyan_api.cli export-openapi --out backend/tests/openapi.snapshot.json`.
  - Verified that all route policy invariants and OpenAPI structural tests pass cleanly.
- **Verification:**
  - `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_route_policies.py backend/tests/test_openapi_snapshot.py -q` passed (4 tests).
- **Commit:** `a29ef3b docs(20-01): freeze admin inventory and establish OpenAPI snapshot baseline`

---

## Verification Summary

All verification suites specified in `20-01-PLAN.md` passed with zero errors:

1. `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_permissions_catalogue.py -q` &rarr; 6 passed
2. `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_roles_api.py -q` &rarr; 5 passed
3. `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_route_policies.py -q` &rarr; 2 passed
4. `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_openapi_snapshot.py -q` &rarr; 2 passed

Total: **15 passed, 0 failures, 0 warnings**.

---

## Success Criteria Verification

- [x] All 3 new permissions (`patient:correct`, `patient:import`, `patient:export`) added to `Permission` and `Role.ADMIN` per D-20-01.
- [x] `Role.RECEPTION` and `Role.DOCTOR` remain untouched.
- [x] `Role.ADMIN` does NOT have `patient:update`.
- [x] Admin inventory freeze documentation (`20-ADMIN-INVENTORY-FREEZE.md`) is committed.
- [x] All backend permission, role, route policy, and OpenAPI snapshot tests pass.
