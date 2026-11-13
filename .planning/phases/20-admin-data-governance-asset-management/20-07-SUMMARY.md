# Phase 20 Plan 07 Summary: Patient Export Centre & Governance Reversal

## Overview
Phase 20 Plan 07 implements the administrative Patient Export Centre providing permission-checked, field-selective, formula-sanitized, audited dataset streaming in CSV and XLSX formats per D-20-15 through D-20-20, AUD-01, and UX-04, alongside formal documentation of the D-04 / EG-7 clinical export governance reversal:
- **Streaming Export Service** (`export_service.py`):
  - Neutralizes spreadsheet formula injection (STRIDE T-20-16) by prefixing cell values starting with `=`, `+`, `-`, or `@` with a single quote (`'`).
  - Scopes patients dynamically by registration/appointment date range, department (patients with appointments/encounters in that department per D-20-19), and patient search queries.
  - Supports full field-selection matrix covering core demographics, administrative identifiers, profile notes (unticked by default per D-20-18), and complete clinical content (unticked by default per D-20-16).
  - Streams data in CSV (UTF-8) and XLSX formats directly to browser memory via `StreamingResponse` without server disk persistence (STRIDE T-20-18 / D-20-20).
- **Export Endpoint & Audit Logging** (`routers/exports.py`):
  - `POST /api/admin/exports` guarded by `require(Permission.PATIENT_EXPORT)`.
  - Promotes `Permission.PATIENT_EXPORT` from `RESERVED` catalog into active route bindings.
  - Records single `AuditAction.PATIENT_EXPORTED` event in the database transaction containing actor, documented reason, filter scope, selected fields, and row count (D-20-17).
- **Governance Reversal Documentation**:
  - Recorded client-confirmed clinical export exception D-20-15 in `.planning/phases/11-decisions-gate-foundation-auth/11-ENTRY-GATE.md` under EG-7.
  - Updated Key Decisions table in `.planning/PROJECT.md` under D-04 to reflect the audited export path exception while keeping Admin UI screens denied direct clinical viewing.
- **Frontend Export UI** (`PatientExportDialog.tsx`, `PatientExportPage.tsx`):
  - Accessible export modal with date range pickers, department selector, and search input.
  - Grouped field-selection matrix with core demographics pre-selected and clinical fields unticked by default.
  - Prominent amber security banner callout per UI-SPEC copywriting when clinical content is selected (D-20-15).
  - Format toggle between CSV (UTF-8) and Microsoft Excel (.xlsx).
  - Mandatory justification textarea (`min_length >= 5`) with live validation.
  - Direct browser blob download trigger with `Content-Disposition` parsing.

---

## Tasks Completed

### Task 1: Backend export_service.py, formula neutralization, and streaming export endpoint
- **Files Created / Modified:**
  - `backend/src/kalyan_api/services/audit_service.py`
  - `backend/src/kalyan_api/core/permissions.py`
  - `backend/src/kalyan_api/schemas/exports.py`
  - `backend/src/kalyan_api/services/export_service.py`
  - `backend/src/kalyan_api/routers/exports.py`
  - `backend/src/kalyan_api/main.py`
  - `backend/tests/openapi.snapshot.json`
  - `backend/tests/test_patient_export_api.py`
- **Accomplishments:**
  - Added `AuditAction.PATIENT_EXPORTED` to `AuditAction` enum in `audit_service.py`.
  - Removed `Permission.PATIENT_EXPORT` from `RESERVED` catalog in `permissions.py` and bound it to active route `/api/admin/exports`.
  - Defined `ExportScope` and `PatientExportRequest` schemas with 22 allowed export fields and justification validation (`min_length=5`).
  - Implemented `export_service.py`:
    - `sanitize_cell`: prepends `'` to strings starting with `=`, `+`, `-`, `@`.
    - `query_export_rows`: scopes patients by department, date range, and search query; eager-loads clinical encounters, template responses, vitals, prescriptions, and treatment sessions when requested.
    - `generate_csv_stream`: yields UTF-8 CSV chunks.
    - `generate_xlsx_stream`: in-memory `openpyxl` workbook streaming without server disk caching (D-20-20).
  - Implemented `routers/exports.py` with `POST /api/admin/exports` streaming response and in-transaction audit logging.
  - Registered router in `main.py` and regenerated OpenAPI snapshot.
  - Authored comprehensive backend test suite in `test_patient_export_api.py` testing RBAC, validation, formula neutralization, CSV/XLSX generation, department scoping, and audit logging.
- **Verification:**
  - `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_patient_export_api.py -q` passed (6 tests).
  - `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_permissions_catalogue.py backend/tests/test_route_policies.py backend/tests/test_openapi_snapshot.py -q` passed (10 tests).
- **Commit:** `335ea06 feat(20-07): patient export service, streaming endpoints, and audit logging`

---

### Task 2: Record D-04 / EG-7 clinical export governance reversal documentation
- **Files Modified:**
  - `.planning/phases/11-decisions-gate-foundation-auth/11-ENTRY-GATE.md`
  - `.planning/PROJECT.md`
- **Accomplishments:**
  - In `11-ENTRY-GATE.md` (section EG-7): added client-confirmed exception:
    *"Phase 20 Revision (D-20-15, 2026-11-07): Clinical content is permitted for audited administrative export via POST /api/admin/exports with a mandatory documented reason. Admin UI screens remain strictly denied direct clinical record viewing."*
  - In `PROJECT.md` (Key Decisions table under D-04): updated row to reflect:
    *"Doctors read all, edit own. Reception and Admin denied clinical views. Phase 20 exception (D-20-15): Admin permitted field-selective clinical data export with mandatory justification and permanent audit event."*
  - Verified with `check-entry-gate.ps1`.
- **Verification:**
  - `git diff .planning/phases/11-decisions-gate-foundation-auth/11-ENTRY-GATE.md .planning/PROJECT.md` verified.
  - `powershell -ExecutionPolicy Bypass -File .planning/phases/11-decisions-gate-foundation-auth/check-entry-gate.ps1` returned OK.
- **Commit:** `e669e2b docs(20-07): record D-04 / EG-7 clinical export governance reversal`

---

### Task 3: Frontend PatientExportDialog component and admin export page
- **Files Created / Modified:**
  - `frontend/src/api/types.ts`
  - `frontend/src/router.tsx`
  - `frontend/src/components/admin/PatientExportDialog.tsx`
  - `frontend/src/pages/admin/PatientExportPage.tsx`
  - `frontend/src/pages/__tests__/patient-export.test.tsx`
- **Accomplishments:**
  - Added `ExportScope` and `PatientExportRequest` types to `types.ts`.
  - Built `PatientExportDialog.tsx`:
    - Scope filters: Start Date, End Date, Department selector, Patient search filter with min-44px touch targets.
    - Field selection matrix grouped into Demographics, Administrative, Profile Notes, and Clinical Content.
    - Default selection: Demographics and Administrative checked; Notes and Clinical content unchecked (D-20-16, D-20-18).
    - Amber security warning callout displayed when any clinical checkbox is checked (D-20-15).
    - Format toggle (CSV vs XLSX) and formula injection notice.
    - Mandatory justification textarea (`min_length >= 5`) with live validation prompt.
    - Streaming download trigger via `fetch` with `credentials: 'same-origin'`, CSRF headers, and automatic browser file download.
  - Built `PatientExportPage.tsx` at `/admin/exports`:
    - Overview cards describing audited extraction, formula neutralization, and zero server persistence.
    - Primary CTA button opening the export configuration dialog.
    - Dismissable success banner upon file download.
  - Mounted `PatientExportPage` in `router.tsx` replacing previous placeholder component.
  - Authored frontend unit tests in `patient-export.test.tsx` verifying dialog rendering, default checkbox states, amber warning banner appearance/disappearance, justification validation, format toggle, and download streaming trigger.
  - Verified against UX-04 legibility rules and accessibility touch targets (min-44px) passing all `guards.test.ts`.
- **Verification:**
  - `cmd /c "cd /d frontend && npm.cmd test -- patient-export.test.tsx guards.test.ts --run"` passed (21 tests).
  - `cmd /c "cd /d frontend && npm.cmd run typecheck"` passed (0 errors).
- **Commit:** `a0c28a5 feat(20-07): patient export dialog, field selection, and admin export page`

---

## Verification Summary

| Gate | Command | Result |
|------|---------|--------|
| Backend Export API Tests | `pytest backend/tests/test_patient_export_api.py -q` | Passed (6 tests) |
| Permissions Catalogue | `pytest backend/tests/test_permissions_catalogue.py -q` | Passed (6 tests) |
| Route Policies | `pytest backend/tests/test_route_policies.py -q` | Passed (2 tests) |
| OpenAPI Schema Snapshot | `pytest backend/tests/test_openapi_snapshot.py -q` | Passed (2 tests) |
| Entry Gate Consistency | `powershell -ExecutionPolicy Bypass -File .planning/phases/11-decisions-gate-foundation-auth/check-entry-gate.ps1` | OK |
| Frontend Unit Tests & Guards | `npm test -- patient-export.test.tsx guards.test.ts --run` | Passed (21 tests) |
| Frontend Typecheck | `npm run typecheck` | Passed (0 errors) |

---

## Artifacts Produced

1. `backend/src/kalyan_api/schemas/exports.py`: Pydantic models for export scope, field allowlist, and export request validation.
2. `backend/src/kalyan_api/services/export_service.py`: Query builder, formula injection sanitizer (`sanitize_cell`), and streaming generators for CSV and XLSX.
3. `backend/src/kalyan_api/routers/exports.py`: `POST /api/admin/exports` guarded by `PATIENT_EXPORT` with `PATIENT_EXPORTED` audit event logging.
4. `backend/tests/test_patient_export_api.py`: Backend integration test suite covering RBAC, formula neutralization, openpyxl parsing, department scoping, and audit logs.
5. `.planning/phases/11-decisions-gate-foundation-auth/11-ENTRY-GATE.md` & `.planning/PROJECT.md`: Updated governance records for D-04 / EG-7 clinical export exception per D-20-15.
6. `frontend/src/components/admin/PatientExportDialog.tsx`: Modal dialog for scoped export with field matrix and amber security alert.
7. `frontend/src/pages/admin/PatientExportPage.tsx`: Admin export centre workspace page at `/admin/exports`.
8. `frontend/src/pages/__tests__/patient-export.test.tsx`: Frontend unit tests.

