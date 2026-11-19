# Kalyan Hospital Doctor Workspace — Review Swarm Remediation Plan

## Overview
Remediation plan to address all 9 findings + follow-ups identified in the `/review-swarm` audit across Kalyan Hospital's Doctor Workspace.

Git Checkpoint: `a7ca38c82e7524430228185b27fafd53272b23eb` (stored in `git stash list`).

---

## Task Inventory

### Wave 1 — Backend Security, Migration Idempotency & Alias Consolidation

#### F1-BE-A: Migration 0040 Dedup & Quick Phrases Seeder In-Memory Guard
- **depends_on**: `[]`
- **location**:
  - `backend/src/kalyan_api/migrations/versions/0040_quick_phrases_default_unique.py`
  - `backend/src/kalyan_api/routers/quick_phrases.py`
  - `backend/tests/test_quick_phrases.py`
- **description**:
  1. In `0040_quick_phrases_default_unique.py:upgrade()`, add an idempotent SQL cleanup before `create_index` that deletes duplicate `HOSPITAL_DEFAULT` rows keeping the lowest `id` for each `(department_code, section, phrase_text)` tuple.
  2. In `routers/quick_phrases.py`, add a module-level in-memory flag `_DEFAULTS_SEEDED: bool = False` so `ensure_default_quick_phrases_seeded` skips the `SELECT count(*)` database roundtrip on hot paths once verified.
  3. Update `test_quick_phrases.py` to test migration idempotency with pre-existing duplicates and verify fast-path behavior.
- **validation**: `ruff check` clean; `pytest backend/tests/test_migrations.py backend/tests/test_quick_phrases.py` passes.
- **status**: Completed (VERIFIED)
- **log**: Added idempotent pre-index deduplication query in `0040_quick_phrases_default_unique.py`; added module-level `_DEFAULTS_SEEDED: bool = False` fast-path guard in `routers/quick_phrases.py`; added test coverage for zero-query fast-path and migration 0040 deduplication with lowest id retention. `ruff check` clean; `test_migrations.py` + `test_quick_phrases.py` passed (`12 passed in 6.90s`).
- **files edited/created**: `backend/src/kalyan_api/migrations/versions/0040_quick_phrases_default_unique.py`, `backend/src/kalyan_api/routers/quick_phrases.py`, `backend/tests/test_quick_phrases.py`

#### F1-BE-B: Investigation Finalisation Lock, Diagnosis Unmerged Check & Plan Alias Check
- **depends_on**: `[]`
- **location**:
  - `backend/src/kalyan_api/routers/investigations.py`
  - `backend/src/kalyan_api/routers/clinical_diagnoses.py`
  - `backend/src/kalyan_api/routers/treatment_plans.py`
  - `backend/tests/test_investigations_api.py`
  - `backend/tests/test_treatment_plans_api.py`
- **description**:
  1. In `investigations.py:create_investigation_order`, check `if enc.is_finalised:` and raise `ApiError(status_code=400, code="encounter_finalised", message="Cannot order investigations for a finalised clinical encounter.")`.
  2. In `clinical_diagnoses.py:create_encounter_diagnosis`, hoist `require_active_unmerged_patient(session, enc.patient_id)` so it executes unconditionally for all diagnosis additions.
  3. In `treatment_plans.py:create_treatment_plan`, check `if encounter.patient_id not in effective_patient_ids(session, payload.patient_id):` instead of strict equality `!= payload.patient_id`.
  4. Add tests in `test_investigations_api.py` (rejecting orders on finalised encounters) and `test_treatment_plans_api.py` (linking to pre-merge secondary patient encounter).
- **validation**: `ruff check` clean; `pytest backend/tests/test_investigations_api.py backend/tests/test_clinical_diagnoses_conditions.py backend/tests/test_treatment_plans_api.py` passes.
- **status**: Completed (VERIFIED)
- **log**: Added finalised encounter mutation lock (`400 encounter_finalised`) to `create_investigation_order`; hoisted `require_active_unmerged_patient` unconditionally in `create_encounter_diagnosis`; updated `create_treatment_plan` encounter linkage to permit encounters from merged secondary patients via `effective_patient_ids` while preserving PostgreSQL `fk_treatment_plans_encounter_patient` integrity; added test coverage in `test_investigations_api.py` and `test_treatment_plans_api.py`. `ruff check` clean; `pytest` (17 passed in 11.41s) and `test_patient_linkage.py` (21 passed in 5.58s) passed.
- **files edited/created**: `backend/src/kalyan_api/routers/investigations.py`, `backend/src/kalyan_api/routers/clinical_diagnoses.py`, `backend/src/kalyan_api/routers/treatment_plans.py`, `backend/tests/test_investigations_api.py`, `backend/tests/test_treatment_plans_api.py`

---

### Wave 2 — Frontend Consultation Workspace, Patient Records & Dashboard Fixes

#### F2-FE-A: Consultation Investigation Orders Read-Only Lock & Required Prop
- **depends_on**: `[]`
- **location**:
  - `frontend/src/pages/ClinicalEncounterWorkspace.tsx`
  - `frontend/src/components/encounter/EncounterInvestigationOrdersPanel.tsx`
  - `frontend/src/pages/__tests__/clinical-encounter-workspace.test.tsx`
- **description**:
  1. In `ClinicalEncounterWorkspace.tsx:1570`, pass `isReadOnly={isReadOnly}` (which evaluates `isFinalised || isOtherDoctorEncounter`) to `EncounterInvestigationOrdersPanel`.
  2. In `EncounterInvestigationOrdersPanel.tsx`, make `isReadOnly: boolean` a required prop in `EncounterInvestigationOrdersPanelProps` to prevent fail-open accidental omission.
  3. Add test in `clinical-encounter-workspace.test.tsx` verifying that a consultation finalised by the owning doctor disables investigation ordering forms and actions.
- **validation**: `npx tsc --noEmit` 0 errors; `npx vitest run src/pages/__tests__/clinical-encounter-workspace.test.tsx src/test/guards/guards.test.ts` passes.
- **status**: Completed (VERIFIED)
- **log**: Passed `isReadOnly={isReadOnly}` to `EncounterInvestigationOrdersPanel` at line 1570 in `ClinicalEncounterWorkspace.tsx`; made `isReadOnly: boolean` required in `EncounterInvestigationOrdersPanelProps`; added Vitest test verifying authoring doctor finalised encounter renders panel in read-only mode without order form. `tsc --noEmit` 0 errors; `clinical-encounter-workspace.test.tsx` (48/48) + `guards.test.ts` (7/7) passed (`55 passed (55)`).
- **files edited/created**: `frontend/src/pages/ClinicalEncounterWorkspace.tsx`, `frontend/src/components/encounter/EncounterInvestigationOrdersPanel.tsx`, `frontend/src/pages/__tests__/clinical-encounter-workspace.test.tsx`

#### F2-FE-B: Fail-Closed Doctor Ownership & Prescription Allergy Advisory Banner
- **depends_on**: `[]`
- **location**:
  - `frontend/src/components/patient/PatientPrescriptionsTab.tsx`
  - `frontend/src/components/patient/PatientOverviewTab.tsx`
  - `frontend/src/components/patient/PatientInvestigationsTab.tsx`
  - `frontend/src/pages/PrescriptionWorkspace.tsx`
  - `frontend/src/pages/__tests__/prescription-workspace.test.tsx`
  - `frontend/src/components/__tests__/patient-clinical-tabs.test.tsx`
- **description**:
  1. In `PatientPrescriptionsTab.tsx`, `PatientOverviewTab.tsx`, and `PatientInvestigationsTab.tsx`, replace fail-open conditions `(!currentDoctorId || ...)` with fail-closed checks `Boolean(currentDoctorId && ...)`.
  2. In `PrescriptionWorkspace.tsx`, distinguish confirmed negative allergy screening (`patient.allergies` is "None" / "NKDA") from unrecorded screening (`patient.allergies` is null, undefined, or empty). When unrecorded and structured allergies are empty, render an amber/advisory banner ("Allergy screening not recorded. Verify with patient before prescribing.") instead of the green clear badge.
  3. Update tests in `prescription-workspace.test.tsx` and `patient-clinical-tabs.test.tsx`.
- **validation**: `npx tsc --noEmit` 0 errors; `npx vitest run src/pages/__tests__/prescription-workspace.test.tsx src/components/__tests__/patient-clinical-tabs.test.tsx src/test/guards/guards.test.ts` passes.
- **status**: Completed (VERIFIED)
- **log**: Replaced fail-open ownership checks across `PatientPrescriptionsTab`, `PatientOverviewTab`, and `PatientInvestigationsTab` with fail-closed `Boolean(currentDoctorId && ...)`; added `rx-allergy-unrecorded` advisory banner in `PrescriptionWorkspace.tsx` when screening is null/empty; added 4 new unit tests covering fail-closed and unrecorded allergy states. `tsc --noEmit` 0 errors; 3 Vitest suites passed (`29 passed (29)`).
- **files edited/created**: `frontend/src/components/patient/PatientPrescriptionsTab.tsx`, `frontend/src/components/patient/PatientOverviewTab.tsx`, `frontend/src/components/patient/PatientInvestigationsTab.tsx`, `frontend/src/pages/PrescriptionWorkspace.tsx`, `frontend/src/pages/__tests__/prescription-workspace.test.tsx`, `frontend/src/components/__tests__/patient-clinical-tabs.test.tsx`

#### F2-FE-C: Dashboard Auto-Call Race, Queue Counter, Card Retry & Letterhead Non-Physio Fallback
- **depends_on**: `[]`
- **location**:
  - `frontend/src/pages/DoctorDashboard.tsx`
  - `frontend/src/components/DoctorDashboardUnfinishedCard.tsx`
  - `frontend/src/components/PrintLetterhead.tsx`
  - `frontend/src/components/PrescriptionPrint.tsx`
  - `frontend/src/pages/__tests__/doctor-kanban-dashboard.test.tsx`
  - `frontend/src/pages/__tests__/doctor-dashboard-unfinished.test.tsx`
  - `frontend/src/components/__tests__/prescription-print.test.tsx`
- **description**:
  1. In `DoctorDashboard.tsx:handleCallNext`, check and cancel pending `autoCallTimerRef.current` if not null before initiating call.
  2. In `DoctorDashboard.tsx`, adjust the Zone 1 "Live Queue" header count to count physically arrived patients (`queue.in_consultation.length + waitingPatients.length + labHoldPatients.length`) and present booked patients clearly as scheduled.
  3. In `DoctorDashboardUnfinishedCard.tsx`, add `disabled={queryResult.isFetching}` and "Retrying…" text on the retry button.
  4. In `PrintLetterhead.tsx`, do not hardcode "Physiotherapy Department" when `departmentName` is omitted on non-physiotherapy doctor letterheads; thread `departmentName` or omit department subtitle cleanly.
  5. Update associated tests.
- **validation**: `npx tsc --noEmit` 0 errors; `npx vitest run src/pages/__tests__/doctor-kanban-dashboard.test.tsx src/pages/__tests__/doctor-dashboard-unfinished.test.tsx src/components/__tests__/prescription-print.test.tsx src/test/guards/guards.test.ts` passes.
- **status**: Completed (VERIFIED)
- **log**: Cancelled pending `autoCallTimerRef.current` in `DoctorDashboard.tsx:handleCallNext` to eliminate auto-call races; adjusted Zone 1 queue badge to count physically present patients (`queue.in_consultation.length + waitingPatients.length + labHoldPatients.length`) and explicitly label scheduled bookings; added `disabled={queryResult.isFetching}` and "Retrying…" state to `DoctorDashboardUnfinishedCard.tsx` with error-retrying retention; updated `PrintLetterhead.tsx` and `PrescriptionPrint.tsx` so non-physiotherapy doctor prescriptions do not default to "Physiotherapy Department" when departmentName is omitted; updated and added tests across `doctor-kanban-dashboard.test.tsx`, `doctor-dashboard-unfinished.test.tsx`, and `prescription-print.test.tsx`; verified UX-04 legibility compliance (0 violations). `vitest` passed 4 suites (`46 passed (46)`).
- **files edited/created**: `frontend/src/pages/DoctorDashboard.tsx`, `frontend/src/components/DoctorDashboardUnfinishedCard.tsx`, `frontend/src/components/PrintLetterhead.tsx`, `frontend/src/components/PrescriptionPrint.tsx`, `frontend/src/pages/__tests__/doctor-kanban-dashboard.test.tsx`, `frontend/src/pages/__tests__/doctor-dashboard-unfinished.test.tsx`, `frontend/src/components/__tests__/prescription-print.test.tsx` 

---

### Wave 3 — Full Regression & Build Gate

#### F3-GATE: Backend Pytest, Frontend Vitest, UX-04 Guard & Production Build
- **depends_on**: `[F1-BE-A, F1-BE-B, F2-FE-A, F2-FE-B, F2-FE-C]`
- **location**: Full test suites across backend and frontend
- **description**:
  1. Backend: `ruff check` on all touched backend files + pytest suite (`test_migrations`, `test_route_policies`, `test_openapi_snapshot`, `test_rbac_matrix`, `test_investigations_api`, `test_quick_phrases`, `test_treatment_plans_api`, `test_clinical_encounters`, `test_consultation_drafts`, `test_prescriptions_api`).
  2. Frontend: `npx tsc --noEmit`, full `npx vitest run` (all 83+ files including `src/test/guards/guards.test.ts`), and `npm run build`.
- **validation**: 0 errors, 0 failing tests, 0 UX-04 legibility violations, clean production build.
- **status**: Completed (VERIFIED)
- **log**: Full Wave 3 regression and build gate verified with 0 errors. Backend: `ruff check` on all touched files clean (`All checks passed!`); 18 domain test suites (147 tests) passed (`147 passed in 41.37s`), `test_rbac_matrix.py` passed 1,014 tests after resolving outer-join `with_for_update(of=PrintTemplate)` in `templates.py`. Frontend: `tsc --noEmit` 0 errors; full Vitest run passed (`83 passed (83)`, `765 passed | 5 skipped (770)`, including `guards.test.ts` 7/7 with 0 UX-04 violations); `npm run build` clean (`built in 2.96s`).
- **files edited/created**: `backend/src/kalyan_api/routers/templates.py`, `backend/tests/test_quick_phrases.py`
