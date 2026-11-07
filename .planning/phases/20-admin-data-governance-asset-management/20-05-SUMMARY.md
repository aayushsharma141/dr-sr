# Phase 20 Plan 05 Summary: Patient Demographic Correction & Print Snapshots

## Overview
Phase 20 Plan 05 establishes audited administrative patient demographic correction and immutable historical print snapshot preservation per D-20-05, D-20-06, PAT-01, AUD-01, and UX-04:
- **Migration 0017** (`0017_patient_print_snapshots.py`): Adds `legacy_urn` with index `ix_patients_legacy_urn` to `patients`, adds snapshot columns (`patient_name`, `patient_urn`, `patient_mobile`, `patient_address`) to `payments`, `prescriptions`, and `clinical_encounters`, backfills historical documents from the `patients` table, and updates PostgreSQL `fn_prevent_payment_tampering()` to protect snapshot columns under payment tamper triggers.
- **Issuance Routes Snapshot Capture**: Populates snapshot columns at issuance in `backend/src/kalyan_api/routers/billing.py`, `prescriptions.py`, and `encounters.py`.
- **Backend Admin Patients Router**: Adds `GET /api/admin/patients/search` and `PATCH /api/admin/patients/{id}/demographics` in `backend/src/kalyan_api/routers/admin_patients.py`, guarded by `require(Permission.PATIENT_CORRECT)`, enforcing optimistic concurrency via `require_version(patient, payload.version_id, "patient")` (HTTP 409 `version_conflict`), rejecting URN modifications, and recording `AuditAction.PATIENT_CORRECTED` with full before/after diff and mandatory reason (min 5 chars).
- **Frontend Workspace & Modal**: Built `DemographicCorrectionModal.tsx` and `PatientCorrectionPage.tsx` mounted at `/admin/patients/correct`, featuring server-side patient search, locked URN, demographic editor, read-only allergies/notes, side-by-side Before/After diff comparison with burgundy badges, mandatory reason validation, confirmation dialog, and HTTP 409 `<ConflictBanner>`.
- **Print Snapshot Rendering**: Updated `ReceiptPrint.tsx`, `PrescriptionPrint.tsx`, and `ConsultationSummaryPrint.tsx` to render stored snapshot fields with fallback, while `RegistrationCard.tsx` renders current live patient data.

---

## Tasks Completed

### Task 1: Migration 0017, Print Snapshot Columns, Tamper Trigger Protection, and Issuance Routes
- **Files Created / Modified:**
  - `backend/src/kalyan_api/migrations/versions/0017_patient_print_snapshots.py`
  - `backend/src/kalyan_api/models.py`
  - `backend/src/kalyan_api/routers/billing.py`
  - `backend/src/kalyan_api/routers/prescriptions.py`
  - `backend/src/kalyan_api/routers/encounters.py`
  - `backend/src/kalyan_api/schemas/billing.py`
  - `backend/src/kalyan_api/schemas/prescriptions.py`
  - `backend/src/kalyan_api/schemas/encounters.py`
- **Accomplishments:**
  - Authored migration `0017_patient_print_snapshots.py` (revising `0016_print_templates.py`).
  - Added `legacy_urn VARCHAR(64) NULL` with index `ix_patients_legacy_urn` to `patients`.
  - Added snapshot columns (`patient_name VARCHAR(120) NULL`, `patient_urn VARCHAR(32) NULL`, `patient_mobile VARCHAR(15) NULL`, `patient_address TEXT NULL`) to `payments`, `prescriptions`, and `clinical_encounters`.
  - Dialect-aware backfill and trigger management: in PostgreSQL, disables `trg_prevent_payment_tampering`, executes backfills from `patients`, updates `fn_prevent_payment_tampering()` to protect snapshot columns against modification, and re-enables the trigger.
  - Updated SQLAlchemy ORM models (`Patient`, `Payment`, `Prescription`, `ClinicalEncounter`) with corresponding fields.
  - Updated document issuance routes to capture patient snapshot at time of creation, ensuring historical reprints preserve original issuance context.
- **Verification:**
  - `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_migrations.py -q` passed with 3 tests.
- **Commit:** `285c4c4 feat(20-05): migration 0017 print snapshots and issuance routes`

---

### Task 2: Backend Demographic Correction Endpoint, Search, and Audit Logging
- **Files Created / Modified:**
  - `backend/src/kalyan_api/services/audit_service.py`
  - `backend/src/kalyan_api/schemas/patients.py`
  - `backend/src/kalyan_api/routers/admin_patients.py`
  - `backend/src/kalyan_api/main.py`
  - `backend/src/kalyan_api/security/permissions.py`
  - `backend/tests/test_permissions_catalogue.py`
  - `backend/tests/test_patient_demographic_correction.py`
  - `backend/tests/test_print_snapshots.py`
- **Accomplishments:**
  - Added `AuditAction.PATIENT_CORRECTED = "PATIENT_CORRECTED"` to `AuditAction`.
  - Defined `AdminPatientDemographicCorrection` schema with `reason` (min_length=5), `version_id`, and demographic fields, explicitly omitting `urn`, `allergies`, and `notes`.
  - Implemented `admin_patients_router` in `routers/admin_patients.py`:
    - `GET /api/admin/patients/search`: searches across `full_name`, `mobile`, `urn`, and `legacy_urn` with 20-result limit, guarded by `require(Permission.PATIENT_CORRECT)`.
    - `PATCH /api/admin/patients/{id}/demographics`: row locking with `with_for_update()`, optimistic concurrency validation via `require_version(patient, payload.version_id, "patient")`, rejects URN modification attempts (422), updates demographics, increments version, and logs `PATIENT_CORRECTED` with structured before/after diff and reason.
  - Mounted router at `/api/admin/patients` in `backend/src/kalyan_api/main.py`.
  - Promoted `Permission.PATIENT_CORRECT` from `RESERVED` catalog into active usage.
  - Authored comprehensive backend tests in `test_patient_demographic_correction.py` and `test_print_snapshots.py` covering search, correction lifecycle, concurrency 409s, audit logs, and tamper trigger protection.
- **Verification:**
  - `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_patient_demographic_correction.py backend/tests/test_print_snapshots.py -q` passed with 8 tests.
- **Commit:** `5d1ab9e feat(20-05): patient demographic correction endpoint and audit logging`

---

### Task 3: Frontend Correction Page, Diff Modal, and Print Snapshots
- **Files Created / Modified:**
  - `frontend/src/api/types.ts`
  - `frontend/src/api/queries.ts`
  - `frontend/src/components/ConflictBanner.tsx`
  - `frontend/src/components/ReceiptPrint.tsx`
  - `frontend/src/components/PrescriptionPrint.tsx`
  - `frontend/src/components/ConsultationSummaryPrint.tsx`
  - `frontend/src/components/admin/DemographicCorrectionModal.tsx`
  - `frontend/src/pages/admin/PatientCorrectionPage.tsx`
  - `frontend/src/router.tsx`
  - `frontend/src/pages/__tests__/patient-demographic-correction.test.tsx`
- **Accomplishments:**
  - Added types `AdminPatientDemographicCorrection`, `PatientOut.legacy_urn`, and snapshot fields on `PaymentOut`, `PrescriptionOut`, and `EncounterRead`.
  - Created React Query hooks `useAdminSearchPatients` and `useCorrectPatientDemographics`.
  - Updated `ReceiptPrint.tsx`, `PrescriptionPrint.tsx`, and `ConsultationSummaryPrint.tsx` to render snapshot fields (`patient_name`, `patient_urn`, `patient_mobile`, `patient_address`) with fallback to patient relation.
  - Ensured `RegistrationCard.tsx` renders live patient fields.
  - Built `DemographicCorrectionModal.tsx`:
    - Informational callout stating that demographic corrections update future records while historical prints retain issued snapshots.
    - Side-by-side Before/After diff table with burgundy `#8E1C3D` "Modified" badges and `break-words` overflow handling.
    - Mandatory reason field (>= 5 characters) with validation.
    - Confirmation dialog matching exact copywriting contract.
  - Built `PatientCorrectionPage.tsx` at `/admin/patients/correct`:
    - Search input for URN, mobile, name, or legacy URN with empty state handling.
    - Demographic Record Editor with locked/disabled URN, read-only legacy URN, and read-only allergies/notes alert.
    - Live Before/After comparison card updating in real time.
    - HTTP 409 concurrency error handling with `<ConflictBanner>` and "Reload Patient Record" action.
  - Tested against UX-04 legibility guards (minimum 12px font size, proper contrast) and 44px touch targets.
  - Authored unit test suite in `patient-demographic-correction.test.tsx` covering all 9 test scenarios.
- **Verification:**
  - `npm.cmd test -- patient-demographic-correction.test.tsx guards.test.ts --run` passed with 24/24 tests.
  - `npm.cmd run typecheck` passed with 0 TypeScript errors.
  - Full frontend suite passed with 50 test files and 256 tests.
- **Commit:** `f0403c3 feat(20-05): demographic correction UI, diff modal, and print snapshots`

---

## Verification Summary Table

| Test Suite | Commands Executed | Result |
|------------|-------------------|--------|
| Database Migrations | `pytest backend/tests/test_migrations.py -q` | 3 passed |
| Patient Demographic Correction API | `pytest backend/tests/test_patient_demographic_correction.py -q` | 5 passed |
| Print Snapshots & Tamper Protection | `pytest backend/tests/test_print_snapshots.py -q` | 3 passed |
| Quality, Legibility & Guard Suite | `npm test -- guards.test.ts --run` | 7 passed |
| Auth Guards Suite | `npm test -- src/auth/__tests__/guards.test.tsx --run` | 8 passed |
| Demographic Correction Frontend | `npm test -- patient-demographic-correction.test.tsx --run` | 9 passed |
| Full Frontend Suite | `npm test -- --run` | 50 test files, 256 passed |
| TypeScript Typecheck | `npm run typecheck` | 0 errors |

---

## Artifacts Produced
- `backend/src/kalyan_api/migrations/versions/0017_patient_print_snapshots.py`
- `backend/src/kalyan_api/routers/admin_patients.py`
- `backend/tests/test_patient_demographic_correction.py`
- `backend/tests/test_print_snapshots.py`
- `frontend/src/components/admin/DemographicCorrectionModal.tsx`
- `frontend/src/pages/admin/PatientCorrectionPage.tsx`
- `frontend/src/pages/__tests__/patient-demographic-correction.test.tsx`
