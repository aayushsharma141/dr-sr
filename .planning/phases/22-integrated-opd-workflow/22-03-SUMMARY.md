# Phase 22 Plan 03 Summary: Permissions Catalogue — bill:write and report:referral

**Plan:** 22-03  
**Status:** IMPLEMENTED — NOT VERIFIED  
**Task IDs:** T22-08, T22-11  

---

## 1. AGENTS.md Governance Report

- **Task ID:** 22-03 (T22-08, T22-11)
- **Owned Files:**
  - `backend/src/kalyan_api/core/permissions.py`
  - `backend/tests/test_permissions_catalogue.py`
  - `backend/tests/openapi.snapshot.json`
- **Findings:**
  - Baseline pytest run of uncommitted Wave 3 slice-2 passed cleanly on `kalyan_test` (44 passed in 13.24s).
  - Added `BILL_WRITE = "bill:write"` to `Permission` enum, granted exclusively to `Role.RECEPTION`.
  - Added `REPORT_REFERRAL = "report:referral"` to `Permission` enum, granted exclusively to `Role.ADMIN`.
  - Added both permissions to `RESERVED` dict with reasons:
    - `Permission.BILL_WRITE: "bill line endpoints, plan 22-08"`
    - `Permission.REPORT_REFERRAL: "admin referral report, plan 22-17"`
  - Preserved security boundaries: `bill:adjust` remains ADMIN-only (OD-A), `bill:clinical` remains DOCTOR-only (OD-22-11), `prescription:read`/`write` are denied to RECEPTION (D-04).
  - Added 5 invariant tests in `test_permissions_catalogue.py`.
  - Regenerated `backend/tests/openapi.snapshot.json` using CLI exporter (+189 lines).
- **Root Cause:**
  - Catalogue bootstrap required ahead of downstream line-item endpoints (22-08..22-12) and admin referral reporting (22-17) to prevent route orphan check regressions.
- **Changes:**
  - `backend/src/kalyan_api/core/permissions.py`:
    - Declared `BILL_WRITE` and `REPORT_REFERRAL` in `Permission`.
    - Updated `ROLE_PERMISSIONS` role grants.
    - Updated `RESERVED` map.
    - Updated comment citing OD-A.
  - `backend/tests/test_permissions_catalogue.py`:
    - Updated golden snapshot in `test_golden_role_permissions_snapshot`.
    - Added invariant tests:
      - `test_bill_write_restricted_exclusively_to_reception`
      - `test_bill_adjust_restricted_exclusively_to_admin`
      - `test_bill_clinical_restricted_exclusively_to_doctor`
      - `test_report_referral_restricted_exclusively_to_admin`
      - `test_reception_has_no_prescription_permissions`
  - `backend/tests/openapi.snapshot.json`:
    - Regenerated via `kalyan_api.cli export-openapi`.
- **Test Commands & Results:**
  - Baseline run:
    ```bash
    cd D:/dr-sr/backend && PYTHONPATH=D:/dr-sr/backend/src .venv/Scripts/python.exe -m pytest -p no:warnings tests/test_phase22_checkin.py tests/test_phase22_wave2.py tests/test_phase22_bill_snapshot.py tests/test_phase22_fee_adjustment.py tests/test_migrations.py
    ```
    *Result:* `44 passed in 13.24s`
  - Task 1 verify run:
    ```bash
    cd D:/dr-sr/backend && PYTHONPATH=D:/dr-sr/backend/src .venv/Scripts/python.exe -m pytest -p no:warnings tests/test_permissions_catalogue.py tests/test_route_policies.py
    ```
    *Result:* `15 passed in 0.75s`
  - OpenAPI snapshot generation:
    ```bash
    cd D:/dr-sr && PYTHONPATH=D:/dr-sr/backend/src backend/.venv/Scripts/python.exe -m kalyan_api.cli export-openapi --out backend/tests/openapi.snapshot.json
    ```
    *Result:* Success (`backend/tests/openapi.snapshot.json | 189 ++++++++++++++++++++++++++++++++++++`)
  - Final full verification run:
    ```bash
    cd D:/dr-sr/backend && PYTHONPATH=D:/dr-sr/backend/src .venv/Scripts/python.exe -m pytest -p no:warnings tests/test_permissions_catalogue.py tests/test_openapi_snapshot.py tests/test_rbac_matrix.py tests/test_route_policies.py tests/test_phase22_fee_adjustment.py
    ```
    *Result:* `762 passed in 134.04s`
- **Dependencies:**
  - Plan 22-08 will remove `Permission.BILL_WRITE` from `RESERVED` when routes land.
  - Plan 22-17 will remove `Permission.REPORT_REFERRAL` from `RESERVED` when route lands.
- **Remaining Risks:**
  - Both permissions reside in `RESERVED` until the corresponding router endpoints are implemented and wired into route policies.
