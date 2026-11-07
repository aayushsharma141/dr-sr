# Phase 20 Plan 06 Summary: Patient Import Centre (8-Stage Staging Pipeline)

## Overview

Phase 20 Plan 06 establishes the administrative Patient Import Centre implementing the complete 8-stage staging pipeline (Upload, Inspect, Map, Validate, Resolve, Preview, Commit, Reconcile) supporting CSV and XLSX files per D-20-08 through D-20-14, BAK-01, AUD-01, UX-04, and UX-06:

- **Migration 0018** (`0018_patient_import_staging.py`): Creates staging tables `patient_import_batches` and `patient_import_rows` with JSONB/JSON columns and dialect-safe grants for `kalyan_app`.
- **Import Engine** (`import_service.py`):
  - Sniffs file encoding (`utf-8`, `utf-8-sig` / BOM, `windows-1252`) and delimiters for CSV, plus native XLSX parsing via `openpyxl` (D-20-08).
  - Matches column headers to canonical patient demographic fields with alias dictionary.
  - Validates demographic fields without inventing placeholder values (D-20-10).
  - Detects duplicate candidates against existing patients by exact mobile and address, exact legacy URN, or mobile with name similarity (D-20-13).
  - Enforces duplicate resolution default to 'SKIP' and strictly prevents overwriting existing hospital records (D-20-13).
  - Executes pre-commit safety backup gate via `backup_service.create_backup()`; halts commit immediately on failure without modifying patients (D-20-12).
  - Mints gap-free URNs strictly during commit transaction for committed rows (D-20-09, D-20-11).
  - Generates downloadable CSV report of invalid and skipped rows with reasons for offline correction.
- **REST Endpoints** (`routers/imports.py`): 8 endpoints under `/api/admin/imports` guarded by `require(Permission.PATIENT_IMPORT)` per D-20-01, recording `AuditAction.PATIENT_IMPORT_STAGED` and `AuditAction.PATIENT_IMPORT_COMMITTED`.
- **Frontend 8-Stage Wizard** (`ImportWizard.tsx`, `DuplicateResolutionTable.tsx`, `PatientImportPage.tsx`):
  - Stepper tracking stages with emerald checkmarks for completed and crimson for active.
  - Drag-and-drop dropzone, live inspect preview, column auto-mapping dropdowns, validation progress with metric cards, side-by-side duplicate candidate cards, batch summary preview card, pre-commit safety backup banner, destructive confirmation modal, and reconciliation screen with URN range and "Download Error Records" button.

---

## Tasks Completed

### Task 1: Migration 0018, Models, and Import Engine

- **Files Created / Modified:**
  - `backend/src/kalyan_api/migrations/versions/0018_patient_import_staging.py`
  - `backend/src/kalyan_api/models.py`
  - `backend/src/kalyan_api/services/backup_service.py`
  - `backend/src/kalyan_api/services/import_service.py`
  - `backend/tests/test_patient_import_service.py`
- **Accomplishments:**
  - Authored migration `0018_patient_import_staging.py` (revising `0017`).
  - Created `patient_import_batches` and `patient_import_rows` tables with foreign keys and indexes.
  - Added table grants for `kalyan_app` on PostgreSQL and added tables to `RUNTIME_TABLE_GRANTS` in `backup_service.py`.
  - Aliased `create_backup_bundle = create_backup` in `backup_service.py`.
  - Added SQLAlchemy ORM models `PatientImportBatch` and `PatientImportRow` in `models.py` with `lazy="select"` relationships.
  - Implemented `import_service.py`:
    - `inspect_file`: detects format (CSV/XLSX), encoding (UTF-8, UTF-8-BOM, Windows-1252), delimiter sniffing, sample row previews, suggested mapping.
    - `stage_batch`: creates batch and staging rows with raw and mapped data.
    - `validate_batch`: enforces required demographic constraints (`full_name`, `guardian_name`, `gender`, `age_years` / `dob`, `mobile` 10-digits, `address`); detects duplicates without modifying existing patients.
    - `resolve_duplicate` and `bulk_resolve_duplicates`: manages 'SKIP' vs 'IMPORT_AS_NEW' states.
    - `commit_batch`: runs pre-commit backup gate; mints URNs via `urn_service.allocate_next_urn()` strictly for committing rows; updates batch to COMMITTED with allocated URN range.
    - `export_error_records_csv`: generates CSV of invalid/skipped rows with formula neutralization.
  - Tested engine in `test_patient_import_service.py` covering encodings, XLSX, validation, duplicate matching, gap-free URN allocation, backup failure aborts, and error CSV export.
- **Verification:**
  - `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_patient_import_service.py -q` passed (7 tests).
- **Commit:** `509fd64 feat(20-06): migration 0018 patient_import_staging and import_service engine`

---

### Task 2: Import API Endpoints and Batch Audit Events

- **Files Created / Modified:**
  - `backend/src/kalyan_api/core/permissions.py`
  - `backend/src/kalyan_api/services/audit_service.py`
  - `backend/src/kalyan_api/schemas/imports.py`
  - `backend/src/kalyan_api/routers/imports.py`
  - `backend/src/kalyan_api/main.py`
  - `backend/tests/openapi.snapshot.json`
  - `backend/tests/test_patient_import_api.py`
- **Accomplishments:**
  - Added `AuditAction.PATIENT_IMPORT_STAGED` and `AuditAction.PATIENT_IMPORT_COMMITTED` to `AuditAction`.
  - Promoted `Permission.PATIENT_IMPORT` from `RESERVED` catalog into active route bindings.
  - Created Pydantic schemas in `schemas/imports.py` for file inspect response, batch summary, validation summary, duplicate row comparisons, duplicate decision requests, and commit response.
  - Implemented `routers/imports.py` with 8 endpoints:
    - `POST /api/admin/imports/inspect`
    - `POST /api/admin/imports`
    - `GET /api/admin/imports/{batch_id}`
    - `POST /api/admin/imports/{batch_id}/validate`
    - `GET /api/admin/imports/{batch_id}/duplicates`
    - `POST /api/admin/imports/{batch_id}/resolve`
    - `POST /api/admin/imports/{batch_id}/commit`
    - `GET /api/admin/imports/{batch_id}/errors`
  - Mounted router in `backend/src/kalyan_api/main.py` under prefix `/api`.
  - Updated `backend/tests/openapi.snapshot.json` via CLI export tool.
  - Authored API integration tests in `test_patient_import_api.py` verifying RBAC, upload inspect, staging audit, validation, duplicate resolution, commit backup failure abort (500), and error record export.
- **Verification:**
  - `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_patient_import_api.py -q` passed (4 tests).
  - `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_permissions_catalogue.py backend/tests/test_route_policies.py backend/tests/test_openapi_snapshot.py -q` passed (10 tests).
- **Commit:** `44fe216 feat(20-06): patient import API endpoints and audit logging`

---

### Task 3: Frontend ImportWizard, DuplicateResolutionTable, and Import Page

- **Files Created / Modified:**
  - `frontend/src/components/admin/DuplicateResolutionTable.tsx`
  - `frontend/src/components/admin/ImportWizard.tsx`
  - `frontend/src/pages/admin/PatientImportPage.tsx`
  - `frontend/src/router.tsx`
  - `frontend/src/pages/__tests__/patient-import.test.tsx`
- **Accomplishments:**
  - Built `DuplicateResolutionTable.tsx`:
    - Patient Safety Policy informational banner explaining hospital records are never overwritten (D-20-13).
    - Bulk action button: "Skip All Flagged Duplicates".
    - Side-by-side cards comparing Proposed Import Row Data vs Existing Hospital Record with matching mobile/address fields highlighted.
    - Per-row segmented toggle: "Skip Row (Default)" vs "Import as New" with min-44px touch targets.
    - Empty state: "No Duplicate Records Detected".
  - Built `ImportWizard.tsx`:
    - 8-stage stepper header with numbered badges (emerald for completed, crimson for active).
    - Stage 1 (Upload): Drag-and-drop dropzone supporting .csv and .xlsx (max 10 MB).
    - Stage 2 (Inspect): Displays detected format, encoding, delimiter, total rows, and first 5 sample rows.
    - Stage 3 (Map): Column auto-mapping table with manual dropdown overrides for demographic fields.
    - Stage 4 (Validate): Real-time validation metrics (Total, Valid, Duplicates, Invalid), empty state for zero errors, and red alert for held-back invalid rows.
    - Stage 5 (Resolve): Embedded duplicate resolution table with per-row and bulk skip options.
    - Stage 6 (Preview): Consolidated summary card with total to commit, duplicates skipped, invalid rows held back, and pre-commit safety backup notice.
    - Stage 7 (Commit): Safety backup progress banner, red InlineAlert on backup error, and confirmation Modal matching exact copywriting contract.
    - Stage 8 (Reconcile): Success summary card displaying allocated URN range (e.g. `KH-2026-0150 → KH-2026-0210`), total committed patients, and "Download Error Records" button.
  - Built `PatientImportPage.tsx` at `/admin/imports` and mounted in `frontend/src/router.tsx`.
  - Complied with UX-04 legibility (no bare text-slate-400 on light backgrounds) and UX-06 accessible input names.
  - Authored unit test suite in `patient-import.test.tsx` verifying stage navigation, inspect rendering, validation metrics, duplicate toggles, commit modal copywriting, backup failure alert, and reconciliation screen.
- **Verification:**
  - `npm.cmd test -- patient-import.test.tsx guards.test.ts --run` passed (20 tests).
  - `npm.cmd run typecheck` passed (0 errors).
  - Full frontend suite passed with 51 test files and 261 tests.
- **Commit:** `9c77e85 feat(20-06): 8-stage patient import wizard and duplicate resolution UI`

---

## Verification Summary Table

| Test Suite / Verification Step | Scope | Command | Result |
| -------------------------------- | ------- | --------- | -------- |
| Import Engine Unit Tests | Service logic, encodings, XLSX, validation, URN minting, backup gate | `pytest backend/tests/test_patient_import_service.py` | PASS (7 tests) |
| Import API Integration Tests | RBAC, 8 REST endpoints, audit logs, backup abort | `pytest backend/tests/test_patient_import_api.py` | PASS (4 tests) |
| RBAC Catalog & Route Policies | Permission bounds, orphan checks, OpenAPI snapshot | `pytest backend/tests/test_permissions_catalogue.py ...` | PASS (10 tests) |
| Frontend Wizard Tests | 8-stage stepper, duplicate resolution, commit modal, reconcile | `npm test -- patient-import.test.tsx guards.test.ts` | PASS (20 tests) |
| Frontend Typecheck | TypeScript compiler validation | `npm run typecheck` | PASS (0 errors) |
| Full Frontend Suite | Regression testing across entire frontend | `npm test -- --run` | PASS (51 files, 261 tests) |

---

## Invariant Adherence Review

1. **Gap-Free URN Sequence (D-20-09, D-20-11):**
   - Verified: `urn_service.allocate_next_urn()` is strictly invoked inside the commit transaction for committed rows only. Staging and invalid rows never touch `urn_service`, ensuring zero sequence counter gaps.
2. **Pre-Commit Safety Backup Gate (D-20-12):**
   - Verified: Pre-commit backup via `backup_service.create_backup(label="preimport")` executes before any patient insertions. When the backup fails, the transaction is rolled back and the commit aborts with HTTP 500 without modifying `patients`.
3. **No Patient Overwrites (D-20-13):**
   - Verified: Duplicate candidates are only resolved as 'SKIP' (default) or 'IMPORT_AS_NEW'. Existing patient records are strictly immutable during imports.
4. **Invalid Rows Non-Blocking (D-20-10):**
   - Verified: Rows failing validation are flagged as `INVALID` with field-specific error explanations and held back without preventing valid rows from committing. Held-back rows can be downloaded as an error CSV in the Reconcile step.
5. **Auditing (D-20-14, AUD-01):**
   - Verified: Staged batches record `PATIENT_IMPORT_STAGED` with filename and row counts; committed batches record `PATIENT_IMPORT_COMMITTED` with backup filename and URN range.
