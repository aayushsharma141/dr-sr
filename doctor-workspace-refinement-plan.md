# Plan: Doctor Workspace — Phased UX Refinement & Critical/High Bugfix

**Generated**: 2026-11-18  
**Reviewed & Revised**: 2026-11-18 (Subagent plan review passed — all wave collisions, RBAC matrix expectations, migration/seeder gotchas, and edge cases resolved)  
**Git Checkpoint (pre-Phase 1)**: `4e166a6470c649a0c1556bc6e8ea502a18ec08f3` (`git stash list`: `checkpoint: pre doctor-workspace phase 1`)  
**Workspace**: `d:\dr-sr` (FastAPI + SQLAlchemy/Alembic + React 19 + React Router 7 + TanStack Query + Tailwind + Vitest/pytest)

---

## Overview

Targeted, minimum-diff UX refinement and clinical-safety bugfix across the Doctor Workspace (`My Queue`, `Continue Consultation / ClinicalEncounterWorkspace`, `PrescriptionWorkspace`, `Follow-ups`, `Physiotherapy Treatment`, `Patient Records`), preserving the existing shared consultation engine, burgundy/slate visual identity, API contracts, and both Physiotherapy and Ophthalmology workflows.

**Hard Engineering Constraints (`AGENTS.md` + User Decisions)**:

1. **Do NOT rebuild** `ClinicalEncounterWorkspace.tsx` — refine the existing shared engine and department-loaded specialty modules (`SpecialtyPhysiotherapyForm`, `SpecialtyOphthalmologyForm`).
2. **Do NOT redesign** the application or change visual identity.
3. **Preserve existing APIs, DB schemas, permissions, and working functionality**; any new route/table is strictly additive, declares exactly 1 policy marker (`test_route_policies.py`), registers an RBAC matrix row (`backend/tests/support/matrix.py`), and updates `backend/tests/openapi.snapshot.json` in the **same atomic task** (preventing `check_matrix_completeness` failures across parallel waves).
4. **No concurrent editing of the same file** — every wave partitions file ownership strictly across parallel tasks.
5. **Verified Decisions**:
   - **C4 Allergy Safety** is included in **Phase 1** (never show green `"No known allergies"` on API error or missing data; show explicit Unknown/Unavailable state).
   - **Follow-up RBAC (`Phase 4`)** (verified against `core/permissions.py:120-165`, `follow_up.py:494-562`, `test_follow_up_workflow.py:197-242`, and `matrix.py:1505-1525`):
     - `Role.ADMIN` does **not** hold `Permission.APPOINTMENT_WRITE` (SEC-03/EG-16: Admin is operational/audit/user management, not appointment booking).
     - `POST /api/follow-ups/{id}/book`: **RECEPTION only** (`anonymous: 401`, `admin: 403`, `reception: 200`, `doctor_a: 403`, `doctor_b: 403`).
     - `POST /api/follow-ups/{id}/close`: **RECEPTION** on any `PENDING` recommendation, AND **owning/recommended DOCTOR** (`rec.doctor_id == principal.doctor_id or rec.recommended_doctor_id == principal.doctor_id`) on their own `PENDING` recommendation; cross-doctor Doctor B receives `404` (`anonymous: 401`, `admin: 403`, `reception: 200`, `doctor_a: 200`, `doctor_b: 404`).
     - `GET /api/reception/follow-ups`: RECEPTION / ADMIN see all (omitting `clinical_reason`); DOCTOR sees only own recommendations (`doctor_id` or `recommended_doctor_id == principal.doctor_id`).

> **Current Working-Tree Note**: Phase 1 implementation code (`T1.1`–`T1.5`) is already written to the working tree (cleanly aligned, not yet test-verified). Wave 1 (`T1.6` + `T1.7`) runs Phase 1 backend & frontend tests in parallel immediately upon approval before Phase 2 starts.

---

## Prerequisites

- **Backend**: `backend/.venv/Scripts/python.exe` with `pytest` and `kalyan_api.cli` (`export-openapi`).
- **Frontend**: Node + `npm test` (Vitest + Testing Library) and `npx tsc --noEmit` inside `d:\dr-sr\frontend`.
- **Migrations**: Current Alembic head is `0038_appointments_hardening.py` in `backend/src/kalyan_api/migrations/versions/`. Phase 3 adds `0039_clinical_quick_phrases.py` (DDL + constraints + indexes + PostgreSQL `kalyan_app` grants ONLY; default seeding runs idempotently at application layer like `ensure_specialty_templates_seeded` in `routers/templates.py:41` because `conftest.py:migrated_db` migrates an empty DB with 0 departments).
- **Atomic Backend Rule**: Because `check_matrix_completeness(app, MATRIX)` (`matrix.py:3146`) inspects every live FastAPI route, every backend phase updates its router + `support/matrix.py` + `openapi.snapshot.json` + pytest suite in **one atomic backend task** (never split across concurrent backend waves).

---

## Dependency Graph

```text
=== PHASE 1: Clinical Safety & Data Integrity (C5, C3, H11, C1, C2, C4) ===
[T1.1..T1.5 Code Applied]
       ├──► T1.6 (BE Phase 1 Tests & Contract Gate) ──┐
       └──► T1.7 (FE Phase 1 Tests & tsc Gate)      ──┴──► T2.1 (FE: Encounter Nav, 3-Group Sidebar, Validation, Fallback)
                                                                                  │
                                                                                  ▼
                                                            T2.2 (FE: Phase 2 Tests & Dual-Dept Gate)
                                                                                  │
                                                                                  ▼
                                                            T3.1 (BE Atomic: Migration 0039 + Seeder + Router + Matrix + OpenAPI + Tests)
                                                                       │                     │
                                      ┌────────────────────────────────┘                     └───────────────────────────────┐
                                      ▼                                                                                      ▼
        T3.2 (FE: QuickPhraseBar API + hooks + tests)                     ||                   T4.1 (BE Atomic: Follow-up RBAC + Rx Filter + Matrix + Tests)
                                      │                                                                                      │
                                      └───────────────────────────┬──────────────────────────┬───────────────────────────────┘
                                                                  ▼                          ▼                               │
                                  T4.2 (FE: Encounter Follow-up Cleanup)   ||   T4.3 (FE: AppointmentsReception Follow-ups)  ||  T5.1 (BE Atomic: Active Plans Roster + Inv #11 + Matrix + OpenAPI + Tests)
                                                                  │                          │                               │
                                                                  └──────────────────────────┼───────────────────────────────┘
                                                                                             ▼
                                                                  T5.2 (FE: TreatmentPlanWorkspace Roster + Bridge + Ownership + Tests)
                                                                                             │
                                                                                             ▼
                                                                  T6.1 (Final Full Regression & 9-Scenario Dual-Dept Gate)
```

---

## Tasks

### Phase 1 — Clinical Safety & Data Integrity

#### T1.1: Backend Prescription Encounter Hydration (C1), Appointment Linkage (C3) & Queue Structured Allergies (C4)

- **depends_on**: `[]`
- **location**:
  - `backend/src/kalyan_api/schemas/prescriptions.py`
  - `backend/src/kalyan_api/routers/prescriptions.py`
  - `backend/src/kalyan_api/routers/appointments.py`
  - `backend/tests/support/matrix.py`
  - `backend/tests/openapi.snapshot.json`
- **description**:
  - **[Verified Defect C1]**: Add `GET /api/encounters/{encounter_id}/prescription` (`Permission.PRESCRIPTION_READ`, `ScopeFamily.CLINICAL_READ`) returning the active (`AUTHORISED` or `DRAFT`) `PrescriptionOut` with ordered `items` or `None`. Register RBAC row in `support/matrix.py` and refresh `openapi.snapshot.json`.
  - **[Verified Defect C3]**: Add optional `appointment_id: int | None` to `PrescriptionCreate`. In `create_prescription`, when `encounter_id is None` and `appointment_id` is supplied, validate `(doctor_id, patient_id)` ownership, link existing `ClinicalEncounter` for that appointment (or create one for a checked-in appointment, rejecting unchecked-in with `422 not_checked_in`), and enforce single-active-Rx uniqueness (`409 active_prescription_exists`).
  - **[Verified Defect C4]**: In `get_doctor_queue`, batch-load `ACTIVE` `PatientAllergy` rows (including merged patient aliases) in 1–2 queries and merge with meaningful legacy `Patient.allergies` via `_format_queue_allergies(...)`.
- **validation**: Verified via `T1.6`.
- **status**: Completed (VERIFIED)
- **log**: Applied edits to schemas, routers, matrix, and exported `openapi.snapshot.json` on 2026-11-18; verified GREEN in `T1.6` (1047 passed, 0 failed).
- **files edited/created**: `backend/src/kalyan_api/schemas/prescriptions.py`, `backend/src/kalyan_api/routers/prescriptions.py`, `backend/src/kalyan_api/routers/appointments.py`, `backend/tests/support/matrix.py`, `backend/tests/openapi.snapshot.json`

#### T1.2: Frontend Patient-Scoped Scratchpad Isolation on My Queue (C5)

- **depends_on**: `[]`
- **location**: `frontend/src/pages/DoctorDashboard.tsx`
- **description**:
  - **[Verified Defect C5]**: Replace unkeyed `soapNotes`, `prescribedMeds`, `orderedLabs`, and `followUpDays` state with `scratchpadByPatient: Record<number, PatientScratchpad>` keyed by `currentChartPatient.patient_id`. Clear only `item.patient_id`'s scratchpad entry when finishing a consultation.
- **validation**: Verified via `T1.7`.
- **status**: Completed (VERIFIED)
- **log**: Applied patient-keyed `scratchpadByPatient` state and `clearPatientScratchpad` on 2026-11-18; verified GREEN in `T1.7` (`doctor-kanban-dashboard.test.tsx` 17/17 passed).
- **files edited/created**: `frontend/src/pages/DoctorDashboard.tsx`

#### T1.3: Frontend Allergy Safety on Patient Identity Header (C4)

- **depends_on**: `[]`
- **location**:
  - `frontend/src/pages/PatientDetail.tsx`
  - `frontend/src/components/patient/PatientIdentityHeader.tsx`
- **description**:
  - **[Verified Defect C4]**: Pass `summaryError` from `usePatientSummary` into `PatientIdentityHeader`. Never display green `"No known allergies"` when `summaryError` is true, `summary` is missing, or legacy `patient.allergies` contains a reported allergy. Display explicit amber `data-testid="allergy-status-unavailable"` (`"Allergy status unavailable"`) on summary failure and amber `data-testid="legacy-allergy-pill"` when only legacy allergy text exists.
- **validation**: Verified via `T1.7`.
- **status**: Completed (VERIFIED)
- **log**: Updated `PatientDetail.tsx`, `PatientIdentityHeader.tsx`, and aligned `hasReportedAllergies` in `UnsavedChangesGuard.tsx`; verified GREEN in `T1.7` (`patient-workspace-shell.test.tsx` 12/12 passed).
- **files edited/created**: `frontend/src/pages/PatientDetail.tsx`, `frontend/src/components/patient/PatientIdentityHeader.tsx`, `frontend/src/components/UnsavedChangesGuard.tsx`

#### T1.4: Frontend Prescription Workspace Appointment Linkage (C3) & Allergy Safety Banner (C4)

- **depends_on**: `[T1.1]`
- **location**:
  - `frontend/src/api/types.ts`
  - `frontend/src/pages/PrescriptionWorkspace.tsx`
- **description**:
  - **[Verified Defect C3]**: Add optional `appointment_id?: number | null` to `PrescriptionCreate`. Read `appointment_id` from URL search params in `PrescriptionWorkspace`, display `"Linked to Appointment #N"`, and send `appointment_id` in `POST /prescriptions`.
  - **[Verified Defect C4]**: Fetch `usePatientAllergies(patientId, patientId > 0)` alongside `usePatient(patientId)` and render clinical allergy safety strip: loading (`rx-allergy-loading`), explicit unavailable warning (`rx-allergy-unavailable`) on fetch failure, burgundy alert (`rx-allergy-alert`) for active structured or legacy allergies, and green `"No known allergies recorded"` (`rx-allergy-clear`) ONLY when both queries succeed with no allergies.
- **validation**: Verified via `T1.7`.
- **status**: Completed (VERIFIED)
- **log**: Updated `types.ts` and `PrescriptionWorkspace.tsx`; verified GREEN in `T1.7` (`prescription-workspace.test.tsx` 6/6 passed).
- **files edited/created**: `frontend/src/api/types.ts`, `frontend/src/pages/PrescriptionWorkspace.tsx`

#### T1.5: Frontend Encounter Prescription Hydration (C1), Single Validated Authorisation (H11) & Physio Default VAS 0 (C2)

- **depends_on**: `[T1.1]`
- **location**:
  - `frontend/src/api/queries.ts`
  - `frontend/src/components/PrescriptionFormSection.tsx`
  - `frontend/src/components/SpecialtyPhysiotherapyForm.tsx`
  - `frontend/src/pages/ClinicalEncounterWorkspace.tsx`
- **description**:
  - **[Verified Defect C1]**: Add `useEncounterPrescription(encounterId)` in `queries.ts` and hydrate `activeRxRecord`, `prescriptionItems` (defensively guarding `Array.isArray(rx.items)`), `dietaryAdvice`, `generalAdvice` once on mount and on conflict reload. Include `prescription: true` in first-save `hydratedRef` reset. Stop triggering encounter-text `scheduleAutoSave()` on Rx edits; include `unauthorisedRxPending` in `UnsavedChangesGuard`.
  - **[Verified Defect H11]**: Remove duplicate sticky-header `Authorise Prescription` button. Keep single authorisation control inside `PrescriptionFormSection.tsx` with diagnosis ≥2 chars validation, `authorisingRef`/`authorisingRxRef` double-submit guard, and proper error propagation.
  - **[Verified Defect C2]**: In `SpecialtyPhysiotherapyForm.tsx:updateField`, include `starting_vas: vas` (`0`) when `data.starting_vas === undefined` on any field edit so entering `pain_site` with default VAS `0` finalises cleanly without dirtying untouched forms.
- **validation**: Verified via `T1.7`.
- **status**: Completed (VERIFIED)
- **log**: Updated `queries.ts`, `PrescriptionFormSection.tsx`, `SpecialtyPhysiotherapyForm.tsx`, and `ClinicalEncounterWorkspace.tsx`; verified GREEN in `T1.7` (`clinical-encounter-workspace.test.tsx` 32/32 passed, `tsc --noEmit` 0 errors).
- **files edited/created**: `frontend/src/api/queries.ts`, `frontend/src/components/PrescriptionFormSection.tsx`, `frontend/src/components/SpecialtyPhysiotherapyForm.tsx`, `frontend/src/pages/ClinicalEncounterWorkspace.tsx`

#### T1.6: Backend Phase 1 New Tests & Full Verification Gate

- **depends_on**: `[T1.1]`
- **location**:
  - `backend/tests/test_prescriptions_api.py`
  - `backend/tests/test_appointments_hardening.py`
- **description**:
  - Add pytest coverage for:
    1. `GET /api/encounters/{id}/prescription` (returns `None` when none, returns active `AUTHORISED`/`DRAFT` with items, ignores `CANCELLED`/`SUPERSEDED`, enforces `PRESCRIPTION_READ` & cross-doctor read).
    2. `POST /api/prescriptions` with `appointment_id` resolves/links `ClinicalEncounter` (existing or created for checked-in appointment), rejects unchecked-in (`422`) and cross-doctor/cross-patient (`404`).
    3. `GET /api/doctor/queue` includes `ACTIVE` structured `PatientAllergy` substances (with severity for `SEVERE`/`LIFE_THREATENING`) even when legacy `Patient.allergies` is null, and omits `RESOLVED`/`INACTIVE` allergies.
  - Run `pytest` on `test_route_policies.py`, `test_openapi_snapshot.py`, `test_rbac_matrix.py`, `test_prescriptions_api.py`, `test_prescription_lifecycle.py`, `test_prescription_versioning.py`, `test_clinical_encounters.py`, `test_specialty_templates.py`, `test_appointments_hardening.py`.
- **validation**: All existing and new backend tests pass with 0 failures and 0 weakened assertions.
- **status**: Completed (VERIFIED)
- **log**: Added 3 comprehensive pytest suites (`test_get_encounter_prescription_lifecycle_and_rbac`, `test_create_prescription_with_appointment_id_links_or_creates_encounter`, `test_doctor_queue_merges_active_structured_allergies_with_legacy`). `ruff check` passed; 9-file pytest gate passed: `1047 passed, 1 warning in 227.79s`.
- **files edited/created**: `backend/tests/test_prescriptions_api.py`, `backend/tests/test_appointments_hardening.py`

#### T1.7: Frontend Phase 1 New Tests, Mock Alignment & Typecheck Gate

- **depends_on**: `[T1.2, T1.3, T1.4, T1.5]`
- **location**:
  - `frontend/src/pages/__tests__/doctor-kanban-dashboard.test.tsx`
  - `frontend/src/pages/__tests__/prescription-workspace.test.tsx`
  - `frontend/src/pages/__tests__/clinical-encounter-workspace.test.tsx`
  - `frontend/src/pages/__tests__/patient-workspace-shell.test.tsx`
- **description**:
  - Update fetch mocks in `clinical-encounter-workspace.test.tsx` (explicit `/prescription` route BEFORE `/api/encounters/:id` prefix match) and `prescription-workspace.test.tsx` (explicit `/allergies` route BEFORE `/api/patients/:id` prefix match) without weakening behavioral assertions.
  - Add Vitest coverage for:
    1. **C5**: Switching between Patient A and Patient B on `DoctorDashboard` isolates SOAP notes, Quick Meds, Lab Orders, and Follow-up days; finishing Patient A clears only Patient A.
    2. **C3 & C4 (`PrescriptionWorkspace`)**: `appointment_id` forwarded in `POST /prescriptions`; active structured allergies, legacy allergies, verified clear, and explicit `rx-allergy-unavailable` warning on API error.
    3. **C4 (`PatientIdentityHeader`)**: `summaryError=true` or `summary=undefined` renders `allergy-status-unavailable` (never `"No known allergies"`); legacy allergy note renders `legacy-allergy-pill`.
    4. **C1, H11, C2 (`ClinicalEncounterWorkspace`)**: Hydrates saved Rx on mount/reopen; only one `Authorise Prescription` button exists; double-click calls mutation once; unauthorised meds mark `UnsavedChangesGuard` dirty; Physio `pain_site` with default VAS `0` sends `starting_vas: 0` and finalises; Ophthalmology encounter workflow still passes.
  - Run `npx tsc --noEmit` and `npx vitest run` on all affected suites.
- **validation**: Zero TypeScript errors; all Phase 1 Vitest suites pass with 0 skipped/weakened tests.
- **status**: Completed (VERIFIED)
- **log**: Aligned prefix fetch mocks, expanded `hasReportedAllergies` in `UnsavedChangesGuard.tsx`, added +12 Vitest tests across 4 files. `npx tsc --noEmit` exited 0; 6 Vitest suites passed: `74 passed (74)`.
- **files edited/created**: `frontend/src/components/UnsavedChangesGuard.tsx`, `frontend/src/pages/__tests__/doctor-kanban-dashboard.test.tsx`, `frontend/src/pages/__tests__/prescription-workspace.test.tsx`, `frontend/src/pages/__tests__/patient-workspace-shell.test.tsx`, `frontend/src/pages/__tests__/clinical-encounter-workspace.test.tsx`

---

### Phase 2 — Consultation Workflow Refinement

#### T2.1: Refine `ClinicalEncounterWorkspace` Section Navigation, 3-Group Right Sidebar, Guided Finalisation & Specialty Fallback

- **depends_on**: `[T1.6, T1.7]`
- **location**: `frontend/src/pages/ClinicalEncounterWorkspace.tsx`
- **description**:
  - **[Verified Defect + UX Improvement — Section Navigation]**: Wrap `EncounterInvestigationOrdersPanel` in `<section id="section-investigations" data-testid="section-investigations">` and add `id="section-addenda"` to addenda section. Build dynamic `visibleSections` adding `Investigations` (when `encounterId > 0`) and `Addenda` (when `isFinalised`) with subtle section-filled indicators and updated scroll-spy.
  - **[Proposed UX Improvement — 3-Group Right Sidebar]**: Consolidate `<aside data-testid="persistent-side-panel">` into 3 compact cards:
    1. **Clinical Context**: Allergy alert/status + collapsible Patient details + `Previous Consultation` (`data-testid="prior-encounter-card"`, keeping explicit `Copy` buttons) + link to full patient clinical history (`/reception/patients/:id?tab=clinical`).
    2. **Encounter Status**: Clickable required-fields checklist + read-only Prescription status badge (`None` / `Unauthorised draft` / `Authorised`) + Follow-up status (`None` / `Pending on finalise` / `Sent to reception`). Zero duplicate Rx buttons.
    3. **Billing**: Existing `<DoctorChargesPanel>` (preserving Invariants #6/#7/#8; visually omit `VOIDED` lines if returned).
  - **[Verified Defect + UX Improvement — Guided Finalisation]**: Extend `requiredItems` to check required specialty template fields *only* when the doctor has started filling the specialty assessment (`Object.keys(specialtyData).length > 0`). Clicking `Finalise Consultation` with missing required fields highlights missing items inline and scrolls to the first missing section instead of opening the lock modal only to fail later. Handle `isVersionConflict(err)` in `handleFinaliseConsultation` to display `ConflictBanner`. Preserve all optional sections (Vitals, untouched Specialty form, Investigations, Prescription, Follow-up).
  - **[Verified Defect — Misleading Specialty Fallback]**: Distinguish 3 states in `#section-specialty`: (a) template loading placeholder when `departmentId != null && templatePending`, (b) neutral `"No structured specialty form configured for ${departmentName}"` card when `departmentId != null && !isPhysiotherapy && !isOphthalmology`, and (c) existing amber `data-testid="specialty-unknown"` ONLY when `departmentId == null`.
- **validation**: Both Physiotherapy and Ophthalmology encounters render identically structured workflows; General department shows accurate neutral notice; `Investigations` and `Addenda` jump links scroll accurately; optional empty sections never block finalisation.
- **status**: Completed (VERIFIED)
- **log**: Implemented dynamic `visibleSections` (`Investigations`, `Addenda` + filled dots + scroll-spy), 3-group right sidebar (`Clinical Context`, `Encounter Status`, `Billing` with `embedded` `DoctorChargesPanel` filtering `VOIDED` lines), guided finalisation validation (`hasMeaningfulSpecialtyData`, inline alerts, 409 `ConflictBanner`), and 3-state specialty fallback.
- **files edited/created**: `frontend/src/pages/ClinicalEncounterWorkspace.tsx`, `frontend/src/components/billing/DoctorChargesPanel.tsx`

#### T2.2: Phase 2 Tests & Dual-Department Verification

- **depends_on**: `[T2.1]`
- **location**: `frontend/src/pages/__tests__/clinical-encounter-workspace.test.tsx`
- **description**:
  - Add Vitest coverage for: dynamic `Investigations` & `Addenda` nav tabs; 3-group right sidebar headings (`Clinical Context`, `Encounter Status`, `Billing`) with no duplicate Rx button; guided finalisation blocking missing required fields while allowing empty optional sections (Physio & Ophth); 3-state specialty fallback (`loading`, General dept with ID, `departmentId === null`); Finalise 409 conflict showing `ConflictBanner`.
- **validation**: `npx tsc --noEmit` and `npx vitest run src/pages/__tests__/clinical-encounter-workspace.test.tsx src/components/__tests__/doctor-charges-panel.test.tsx` pass.
- **status**: Completed (VERIFIED)
- **log**: Added +6 Phase 2 Vitest tests (Physio + Ophth guided finalisation, dynamic tabs, 3-group sidebar, 409 conflict banner, 3-state specialty fallback). `npx tsc --noEmit` exited 0; 3 Vitest suites passed (`55 passed (55)`).
- **files edited/created**: `frontend/src/pages/__tests__/clinical-encounter-workspace.test.tsx`

---

### Phase 3 — Persistent Custom Phrase Management

#### T3.1: Backend Atomic — Migration `0039`, `ClinicalQuickPhrase` Model, Seeder, Router, Matrix, OpenAPI & Pytest Suite

- **depends_on**: `[T2.2]`
- **location**:
  - `backend/src/kalyan_api/migrations/versions/0039_clinical_quick_phrases.py` (new)
  - `backend/src/kalyan_api/models.py`
  - `backend/src/kalyan_api/schemas/quick_phrases.py` (new)
  - `backend/src/kalyan_api/routers/quick_phrases.py` (new)
  - `backend/src/kalyan_api/main.py`
  - `backend/tests/support/matrix.py`
  - `backend/tests/openapi.snapshot.json`
  - `backend/tests/test_quick_phrases.py` (new)
- **description**:
  - **[Verified Defect H10 + Proposed UX Improvement]**: Create `clinical_quick_phrases` table (`id`, `scope` `'PERSONAL'|'HOSPITAL_DEFAULT'`, `doctor_id` nullable FK → `doctors.id`, `department_id` nullable FK → `departments.id`, `department_code` nullable `String(32)`, `section` `'COMPLAINTS'|'EXAMINATION'|'DIAGNOSIS'|'ADVICE'`, `phrase_text` `String(240)`, `sort_order` `Integer`, `is_active` `Boolean`, `created_at`, `updated_at`).
  - **Migration Safety**: Migration `0039` executes DDL, check constraints, indexes, and dialect-guarded PostgreSQL grants (`GRANT SELECT, INSERT, UPDATE, DELETE ON clinical_quick_phrases TO kalyan_app; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kalyan_app;`), with **zero row inserts** so `conftest.py:migrated_db` stays clean.
  - **Idempotent Seeder**: Implement `ensure_default_quick_phrases_seeded(session)` (patterned after `ensure_specialty_templates_seeded` in `routers/templates.py:41`) called inside `GET /api/quick-phrases` to seed Physiotherapy, Ophthalmology, and General `HOSPITAL_DEFAULT` phrases idempotently by `(scope, department_code, section, phrase_text)`.
  - **Endpoints**:
    - `GET /api/quick-phrases?department_id=&section=` (`Permission.ENCOUNTER_READ`): returns `{ defaults, personal }` strictly filtered to `(department_id/code, section)` — never mixing General defaults into Physiotherapy or Ophthalmology sections; `personal` scoped to `principal.doctor_id` (never auto-deleted when a doctor changes departments).
    - `POST /api/quick-phrases` (`Permission.ENCOUNTER_WRITE`): creates `PERSONAL` phrase owned by `principal.doctor_id`.
    - `PATCH /api/quick-phrases/{id}` (`Permission.ENCOUNTER_WRITE`): updates own `PERSONAL` phrase (`doctor_id == principal.doctor_id`, 404 otherwise; `HOSPITAL_DEFAULT` read-only to doctors).
    - `DELETE /api/quick-phrases/{id}` (`Permission.ENCOUNTER_WRITE`): deletes/deactivates own `PERSONAL` phrase (`doctor_id == principal.doctor_id`, 404 otherwise).
  - **Historical Data Integrity**: Encounters store plain text only — editing/deleting a phrase never mutates saved consultations.
  - Register RBAC matrix rows in `support/matrix.py`, export `openapi.snapshot.json`, and write `test_quick_phrases.py` covering CRUD, cross-doctor 404 isolation, department/section isolation, read-only hospital defaults, and historical encounter immutability.
- **validation**: `alembic upgrade head` succeeds; `pytest backend/tests/test_quick_phrases.py backend/tests/test_route_policies.py backend/tests/test_rbac_matrix.py backend/tests/test_openapi_snapshot.py` passes.
- **status**: Completed (VERIFIED)
- **log**: Created Migration `0039_clinical_quick_phrases.py` (DDL + PG grants, zero inserts), `ClinicalQuickPhrase` model + `RUNTIME_TABLE_GRANTS` entry, idempotent seeder + `/api/quick-phrases` CRUD router, RBAC matrix rows + provisioning, OpenAPI export, and 5 integration tests. `ruff check` passed; 5-file pytest gate (`test_migrations`, `test_quick_phrases`, `test_route_policies`, `test_rbac_matrix`, `test_openapi_snapshot`) passed: `1027 passed, 1 warning in 257.67s`.
- **files edited/created**: `backend/src/kalyan_api/migrations/versions/0039_clinical_quick_phrases.py`, `backend/src/kalyan_api/models.py`, `backend/src/kalyan_api/services/backup_service.py`, `backend/src/kalyan_api/schemas/quick_phrases.py`, `backend/src/kalyan_api/routers/quick_phrases.py`, `backend/src/kalyan_api/main.py`, `backend/tests/support/matrix.py`, `backend/tests/test_rbac_matrix.py`, `backend/tests/openapi.snapshot.json`, `backend/tests/test_quick_phrases.py`

#### T3.2: Frontend Persistent `QuickPhraseBar` Upgrade & Tests

- **depends_on**: `[T3.1]`
- **location**:
  - `frontend/src/api/types.ts`
  - `frontend/src/api/queries.ts`
  - `frontend/src/components/QuickPhraseBar.tsx`
  - `frontend/src/pages/ClinicalEncounterWorkspace.tsx`
  - `frontend/src/components/__tests__/quick-phrase-bar.test.tsx` (new)
- **description**:
  - Add `useQuickPhrases`, `useCreateQuickPhrase`, `useUpdateQuickPhrase`, `useDeleteQuickPhrase` hooks.
  - Upgrade `QuickPhraseBar` to accept `departmentId: number | null` and `section: 'COMPLAINTS' | 'EXAMINATION' | 'DIAGNOSIS' | 'ADVICE'` with **zero `localStorage` usage**.
  - Visually separate **Hospital Defaults** (click-to-append) and **My Phrases** (inline add, inline edit, manual delete with confirm, compact search when >8 phrases, multi-click append without overwriting existing text, graceful inline retry on network error).
  - Wire `QuickPhraseBar` into Complaints (and optional compact toggle in Examination findings) in `ClinicalEncounterWorkspace.tsx`.
- **validation**: `npx tsc --noEmit` and `npx vitest run src/components/__tests__/quick-phrase-bar.test.tsx src/pages/__tests__/clinical-encounter-workspace.test.tsx` pass; zero `localStorage` matches in `QuickPhraseBar.tsx`.
- **status**: Completed (VERIFIED)
- **log**: Added QuickPhrase TS types & TanStack Query hooks, replaced `localStorage` in `QuickPhraseBar.tsx` with server-backed Hospital Defaults vs My Phrases (add/edit/delete+confirm/search/retry), wired Complaints & collapsible Examination findings in `ClinicalEncounterWorkspace.tsx`. Zero `localStorage` matches; `tsc --noEmit` 0 errors; 2 Vitest suites passed (`45 passed (45)`).
- **files edited/created**: `frontend/src/api/types.ts`, `frontend/src/api/queries.ts`, `frontend/src/components/QuickPhraseBar.tsx`, `frontend/src/pages/ClinicalEncounterWorkspace.tsx`, `frontend/src/components/__tests__/quick-phrase-bar.test.tsx`, `frontend/src/pages/__tests__/clinical-encounter-workspace.test.tsx`

---

### Phase 4 — Follow-up Integration

#### T4.1: Backend Atomic — Follow-up RBAC Scoping, Prescription Status Filter, Matrix & Pytest Suite

- **depends_on**: `[T3.1]` *(can run in parallel with `T3.2` — 100% disjoint BE vs FE files!)*
- **location**:
  - `backend/src/kalyan_api/routers/follow_up.py`
  - `backend/src/kalyan_api/routers/prescriptions.py`
  - `backend/tests/support/matrix.py`
  - `backend/tests/test_follow_up_workflow.py`
  - `backend/tests/test_prescriptions_api.py`
- **description**:
  - **[Verified Defect C7 — `POST /api/follow-ups/{id}/book`]**: Restrict strictly to `Role.RECEPTION` (`403 reception_only` for `Role.DOCTOR`; `Role.ADMIN` already receives `403` from `Permission.APPOINTMENT_WRITE`).
  - **[Verified Defect C7 — `POST /api/follow-ups/{id}/close`]**: Allow `Role.RECEPTION` on any `PENDING` recommendation, AND allow `Role.DOCTOR` **only** when `rec.doctor_id == principal.doctor_id or rec.recommended_doctor_id == principal.doctor_id` (`404 follow_up_not_found` for cross-doctor Doctor B; `Role.ADMIN` receives `403` from `APPOINTMENT_WRITE`).
  - **[Verified Defect C7 — `GET /api/reception/follow-ups`]**: Inject `principal`; when `principal.role == Role.DOCTOR`, scope to `(doctor_id == principal.doctor_id) | (recommended_doctor_id == principal.doctor_id)` (preserving full queue view for RECEPTION/ADMIN with `clinical_reason` strictly omitted).
  - **[Verified Defect H4/H6 — `GET /api/prescriptions/follow-ups`]**: Add `Prescription.status == PrescriptionStatus.AUTHORISED.value` filter so `DRAFT`/`CANCELLED`/`SUPERSEDED` prescriptions never leak as active follow-ups.
  - Update `support/matrix.py`:
    - `POST /api/follow-ups/{id}/book`: `{"anonymous": 401, "admin": 403, "reception": 200, "doctor_a": 403, "doctor_b": 403}`
    - `POST /api/follow-ups/{id}/close`: `{"anonymous": 401, "admin": 403, "reception": 200, "doctor_a": 200, "doctor_b": 404}`
  - Add pytest cases covering: Doctor A cannot `/book` (403); Doctor B cannot read or `/close` Doctor A's follow-up; Doctor A can `/close` own `PENDING` follow-up; Reception sees follow-up without `clinical_reason` and can `/book` & `/close`; follow-up creation on finalised encounter works; `GET /prescriptions/follow-ups` excludes `DRAFT`/`CANCELLED`/`SUPERSEDED`.
- **validation**: `pytest backend/tests/test_follow_up_workflow.py backend/tests/test_rbac_matrix.py backend/tests/test_prescriptions_api.py backend/tests/test_route_policies.py` passes.
- **status**: Completed (VERIFIED)
- **log**: Enforced Reception-only `POST /follow-ups/{id}/book` (`403 reception_only` for doctors), own-doctor/Reception scoping on `POST /follow-ups/{id}/close` (`404` cross-doctor) & `GET /reception/follow-ups`, `AUTHORISED`-only filter on `GET /prescriptions/follow-ups`, updated `support/matrix.py` (`admin: 403`), and added +5 tests (including follow-up creation on finalised encounter). `ruff check` clean; 5-file pytest gate passed: `1040 passed, 1 warning in 243.08s`.
- **files edited/created**: `backend/src/kalyan_api/routers/follow_up.py`, `backend/src/kalyan_api/routers/prescriptions.py`, `backend/tests/support/matrix.py`, `backend/tests/test_follow_up_workflow.py`, `backend/tests/test_prescriptions_api.py`

#### T4.2: Frontend Remove Broken Duplicate Booking Shortcut & Harden Finalise→Follow-up Ordering

- **depends_on**: `[T3.2, T4.1]`
- **location**:
  - `frontend/src/pages/ClinicalEncounterWorkspace.tsx`
  - `frontend/src/components/FollowUpSection.tsx`
  - `frontend/src/pages/__tests__/clinical-encounter-workspace.test.tsx`
- **description**:
  - **[Verified Defect H5 + UX Improvement]**: Remove `onBookNow={() => setShowBookingModal(true)}` and the duplicate `AppointmentBookingModal` mount from `ClinicalEncounterWorkspace.tsx`. Update `FollowUpSection` copy to clearly explain that the recommendation flows to Reception upon finalisation (with internal clinical justification hidden from Reception).
  - **[Verified Defect M10 + Review Edge Case]**:
    1. Validate pre-finalisation: if `followUpReason.trim().length > 0 && !followUpDate`, block finalisation with an explicit error/toast (`"Follow-up recommendation requires a scheduled date."`) so clinical remarks are never silently dropped.
    2. Execute `finaliseMutation` **first**, then `createFollowUpMutation`. Set `followUpRecordedRef.current = true` **only** when `createFollowUpMutation` resolves.
    3. If `finaliseMutation` succeeds but `createFollowUpMutation` fails (network blip), display a prominent `"Retry Sending Follow-up Recommendation"` button in `FollowUpSection` (keeping retry available even though `isFinalised` is true) so the doctor is never stranded.
- **validation**: `npx tsc --noEmit` and `npx vitest run src/pages/__tests__/clinical-encounter-workspace.test.tsx` pass.
- **status**: Completed (VERIFIED)
- **log**: Removed duplicate `AppointmentBookingModal`/`Book Follow-up Appointment` shortcut from `ClinicalEncounterWorkspace.tsx`, added `followUpMissingDate` pre-finalisation guard, reversed execution order to `finalise -> follow-up` with `"Retry Sending Follow-up Recommendation"` recovery banner (`followup-retry-banner`), and added +4 tests. `tsc --noEmit` 0 errors; `clinical-encounter-workspace.test.tsx` passed (`43 passed (43)`).
- **files edited/created**: `frontend/src/components/FollowUpSection.tsx`, `frontend/src/pages/ClinicalEncounterWorkspace.tsx`, `frontend/src/pages/__tests__/clinical-encounter-workspace.test.tsx`

#### T4.3: Frontend Wire Reception Follow-ups Queue & Clean Up Doctor Follow-ups Tab

- **depends_on**: `[T3.2, T4.1]` *(disjoint from `T4.2` — can run in parallel with `T4.2` and `T5.1`!)*
- **location**:
  - `frontend/src/api/types.ts`
  - `frontend/src/api/queries.ts`
  - `frontend/src/pages/AppointmentsReception.tsx`
  - `frontend/src/pages/__tests__/appointments-reception.test.tsx`
- **description**:
  - Add `useReceptionFollowUps`, `useBookFollowUp`, `useCloseFollowUp` hooks in `queries.ts` (invalidating `['reception-follow-ups']` and `['appointments']`).
  - **[Verified Defect H4 + 403 Fix]**: On `AppointmentsReception.tsx`:
    - **RECEPTION / ADMIN**: Render a **Follow-up Recommendations** tab backed **exclusively** by `useReceptionFollowUps` (`GET /api/reception/follow-ups` — NEVER calling `usePrescriptionFollowUps`, which 403s for non-DOCTOR). Show `All` / `Pending` / `Overdue` / `Booked` / `Closed` filters; for RECEPTION, provide `Book Appointment` (`POST /follow-ups/{id}/book`) and `Close` (reason modal → `POST /follow-ups/{id}/close`) actions (read-only for ADMIN since ADMIN lacks `APPOINTMENT_WRITE`). Never render `clinical_reason`.
    - **DOCTOR**: Show own clinical follow-up recommendations (`useReceptionFollowUps` scoped to self, showing `Pending` / `Booked` / `Closed` status and optional Close own pending recommendation) alongside authorised prescription return dates (`usePrescriptionFollowUps` gated strictly to `role === 'DOCTOR'`); remove non-persistent local-state `Mark to recall` button; fix broken `Cabin` `/doctor?patient_id=` link; hide/lock cross-doctor `#doctor-filter` on Doctor Schedule sub-tab to eliminate the guaranteed `403 scope_forbidden` trap.
- **validation**: `npx tsc --noEmit` and `npx vitest run src/pages/__tests__/appointments-reception.test.tsx` pass.
- **status**: Completed (VERIFIED)
- **log**: Added `useReceptionFollowUps`, `useBookFollowUp`, `useCloseFollowUp`; wired Reception/Admin Follow-ups tab (backed exclusively by `GET /reception/follow-ups` with Book/Close modals for Reception, read-only for Admin, zero `clinical_reason`); updated Doctor Follow-ups tab (Clinical Recommendations + authorised Prescription return dates, removed `Mark to recall` & broken `Cabin` link) and locked Doctor Schedule `#doctor-filter` to eliminate 403 trap. `tsc --noEmit` 0 errors; `appointments-reception.test.tsx` passed (`42 passed (42)`).
- **files edited/created**: `frontend/src/api/types.ts`, `frontend/src/api/queries.ts`, `frontend/src/pages/AppointmentsReception.tsx`, `frontend/src/pages/__tests__/appointments-reception.test.tsx`

---

### Phase 5 — Physiotherapy Treatment Workspace

#### T5.1: Backend Atomic — Active Treatment Plans Roster, Invariant #11 Guards, Matrix, OpenAPI & Pytest Suite

- **depends_on**: `[T4.1]` *(can run in parallel with `T4.2` and `T4.3` — 100% disjoint BE vs FE files!)*
- **location**:
  - `backend/src/kalyan_api/routers/treatment_plans.py`
  - `backend/src/kalyan_api/routers/treatment_sessions.py`
  - `backend/tests/support/matrix.py`
  - `backend/tests/openapi.snapshot.json`
  - `backend/tests/test_treatment_plans_api.py`
  - `backend/tests/test_treatment_sessions_api.py`
- **description**:
  - **[Proposed UX Improvement]**: Add `GET /api/treatment-plans` (`status: str | None = 'ACTIVE'`, `limit: int = Query(50, ge=1, le=200)`, `Permission.PLAN_READ`) returning `list[TreatmentPlanOut]` scoped to `principal.doctor_id` ordered by `updated_at.desc()`.
  - **[Verified Defect C6 — Invariant #11]**: In `treatment_plans.py:update_treatment_plan`, reject `payload.status == TreatmentPlanStatus.COMPLETED` when `plan.completed_sessions < plan.total_sessions` with `422 sessions_incomplete`.
  - **[Verified Defect H7/H8 — Invariant #11]**: In `treatment_sessions.py:log_treatment_session`, reject `payload.session_date > clock.ist_today()` with `422 future_session_date_not_allowed`.
  - Register `GET /api/treatment-plans` in `support/matrix.py`, regenerate `openapi.snapshot.json`, and add pytest coverage for active plans roster, `encounter_id` linkage on `POST /treatment-plans`, 422 on premature `COMPLETED`, and 422 on future session date.
- **validation**: `pytest backend/tests/test_treatment_plans_api.py backend/tests/test_treatment_sessions_api.py backend/tests/test_route_policies.py backend/tests/test_rbac_matrix.py backend/tests/test_openapi_snapshot.py` passes.
- **status**: Completed (VERIFIED)
- **log**: Added `GET /api/treatment-plans` active roster (scoped to own doctor with `selectinload` & status validation), enforced Invariant #11 premature-`COMPLETED` guard (`422 sessions_incomplete`) and future-session-date guard (`422 future_session_date_not_allowed`), registered RBAC matrix row, exported OpenAPI snapshot, and added +4 tests. `ruff check` clean; 5-file pytest gate passed (`1035 passed, 1 warning in 277.51s`).
- **files edited/created**: `backend/src/kalyan_api/routers/treatment_plans.py`, `backend/src/kalyan_api/routers/treatment_sessions.py`, `backend/tests/support/matrix.py`, `backend/tests/openapi.snapshot.json`, `backend/tests/test_treatment_plans_api.py`, `backend/tests/test_treatment_sessions_api.py`

#### T5.2: Frontend Treatment Plan Roster, `encounter_id` Bridge, Ownership Guard & Session Validation

- **depends_on**: `[T4.2, T4.3, T5.1]`
- **location**:
  - `frontend/src/api/queries.ts`
  - `frontend/src/pages/TreatmentPlanWorkspace.tsx`
  - `frontend/src/components/SessionLoggerModal.tsx`
  - `frontend/src/pages/ClinicalEncounterWorkspace.tsx`
  - `frontend/src/pages/__tests__/treatment-plan-workspace.test.tsx`
  - `frontend/src/components/__tests__/session-dialogs.test.tsx`
- **description**:
  - Add `useTreatmentPlans(status)` in `queries.ts`; invalidate `['treatment-plans']` in `useCreateTreatmentPlan`, `useUpdateTreatmentPlan`, and `useLogTreatmentSession` (plus fix `queries.ts:1868,1892` to invalidate `['treatment-plan']`, `['patient-treatment-plans']`, and `['treatment-plans']`).
  - **[Proposed UX Improvement + Verified Defect]**: On `TreatmentPlanWorkspace` launchpad, replace static protocol cards with an **Active Treatment Packages Roster** table (`Open Plan`, `Log Session`), plus explicit error banner when `/doctor/treatment-plans/:id` fails to load.
  - **[Verified Defect — `encounter_id` bridge]**: Read `encounter_id` query param in `TreatmentPlanWorkspace`, send `encounter_id` in `POST /treatment-plans`, show `"Linked to Consultation #N"` badge, reset modal fields on submit, and `navigate(`/doctor/treatment-plans/${created.id}`)` after creation. Add a compact Physiotherapy-only `"Manage Physiotherapy Treatment Plan →"` link in `ClinicalEncounterWorkspace.tsx` (`#section-specialty`) passing `?patient_id=...&encounter_id=...` (zero duplication of initial clinical assessment inside `TreatmentPlanWorkspace`).
  - **[Verified Defect H3/H8]**: Gate `Log Session`, `Cancel Package`, and `+ Addendum` on `activePlan.doctor_id === me?.doctor_id` (read-only banner for other doctors' plans); filter `activePlan` out of `"Other Treatment Packages"`; add `max={istToday()}` and `minLength={2}` validation in `SessionLoggerModal.tsx`.
- **validation**: `npx tsc --noEmit` and `npx vitest run src/pages/__tests__/treatment-plan-workspace.test.tsx src/components/__tests__/session-dialogs.test.tsx src/pages/__tests__/clinical-encounter-workspace.test.tsx` pass.
- **status**: Completed (VERIFIED)
- **log**: Added `useTreatmentPlans` + `['treatment-plans']` invalidations across plan/session/payment mutations; replaced static protocol cards with Active Treatment Packages Roster + status filters + `treatment-plan-error` banner; wired `encounter_id` linkage + post-create navigation + cross-doctor read-only guard (`treatment-plan-readonly-banner`) + filtered Other Packages; added `max={istToday()}` & `minLength={2}` validation to `SessionLoggerModal`; added Physiotherapy-only `physio-treatment-plan-link` in `ClinicalEncounterWorkspace`. `tsc --noEmit` 0 errors; 3 Vitest suites passed (`60 passed (60)`).
- **files edited/created**: `frontend/src/api/queries.ts`, `frontend/src/pages/TreatmentPlanWorkspace.tsx`, `frontend/src/components/SessionLoggerModal.tsx`, `frontend/src/pages/ClinicalEncounterWorkspace.tsx`, `frontend/src/pages/__tests__/treatment-plan-workspace.test.tsx`, `frontend/src/components/__tests__/session-dialogs.test.tsx`, `frontend/src/pages/__tests__/clinical-encounter-workspace.test.tsx`

---

### Final Verification Gate

#### T6.1: Full Backend + Frontend Regression & 9-Scenario Dual-Department Sign-off

- **depends_on**: `[T5.2]`
- **location**: Full test suites (`backend/tests/`, `frontend/src/`)
- **description**:
  - Verify `openapi.snapshot.json` matches live app schema, run full doctor/reception/RBAC backend pytest suite, run `npx tsc --noEmit` and full doctor/patient/reception frontend Vitest suite, and verify every row of the 9-scenario Physiotherapy & Ophthalmology regression checklist below.
- **validation**: Zero failing tests, zero skipped/weakened assertions, all 9 Physiotherapy & Ophthalmology checklist rows verified with verbatim output evidence.
- **status**: Not Completed
- **log**:
- **files edited/created**:

---

## Parallel Execution Groups

| Wave | Tasks | Shared-File Collision Check | Can Start When |
| ------ | ------- | ----------------------------- | ---------------- |
| **Wave 0 (Applied)** | `T1.1`–`T1.5` | Phase 1 implementation code already in working tree | Complete |
| **Wave 1 (Ready Now)** | `T1.6`, `T1.7` | 100% disjoint: BE tests vs FE tests + `tsc` | Immediately |
| **Wave 2** | `T2.1` | Owns `ClinicalEncounterWorkspace.tsx` | After Wave 1 (`Phase 1` verified) |
| **Wave 3** | `T2.2` | Owns `clinical-encounter-workspace.test.tsx` | After Wave 2 |
| **Wave 4** | `T3.1` | Atomic BE Phase 3 (Migration `0039` + seeder + router + `matrix.py` + `openapi` + tests) | After Wave 3 |
| **Wave 5** | `T3.2`, `T4.1` | 100% disjoint: FE Phase 3 (`QuickPhraseBar` + `queries`/`types` + `ClinicalEncounterWorkspace`) vs Atomic BE Phase 4 (`follow_up.py` + `prescriptions.py` + `matrix.py` + tests) | After Wave 4 |
| **Wave 6** | `T4.2`, `T4.3`, `T5.1` | 100% disjoint: FE `ClinicalEncounterWorkspace`+`FollowUpSection` vs FE `queries`/`types`+`AppointmentsReception` vs Atomic BE Phase 5 (`treatment_plans`/`sessions` + `matrix.py` + `openapi` + tests) | After Wave 5 |
| **Wave 7** | `T5.2` | Owns FE Phase 5 (`TreatmentPlanWorkspace`, `SessionLoggerModal`, `queries.ts`, `ClinicalEncounterWorkspace` bridge) | After Wave 6 |
| **Wave 8** | `T6.1` | Read-only full backend + frontend regression & 9-scenario dual-dept sign-off | After Wave 7 |

---

## Testing Strategy & Mandatory Dual-Department Regression Checklist

- **Backend**: `backend/.venv/Scripts/python.exe -m pytest <targets>` — always includes `test_route_policies.py`, `test_rbac_matrix.py`, and `test_openapi_snapshot.py` after any backend wave.
- **Frontend**: `npx tsc --noEmit` + `npx vitest run <targets>` inside `frontend/`.
- **Governance Rule**: Never silently skip failing tests or weaken assertions; report verbatim pass/fail output after every phase.

| # | Test Scenario | Physiotherapy | Ophthalmology | Verification Suites |
| --- | --------------- | --------------- | --------------- | --------------------- |
| 1 | **Start consultation** (My Queue → `/doctor/encounters/:id`, `WAITING → IN_CONSULTATION`) | Required | Required | `test_clinical_encounters.py`, `test_encounter_department.py`, `clinical-encounter-workspace.test.tsx` |
| 2 | **Save and resume draft** (autosave text/vitals/template, reload & reopen via `Continue Consultation` / unfinished card) | Required | Required | `test_consultation_drafts.py`, `clinical-encounter-workspace.test.tsx`, `doctor-dashboard-unfinished.test.tsx` |
| 3 | **Specialty template loads correctly** (`SpecialtyPhysiotherapyForm` / `SpecialtyOphthalmologyForm` / neutral General fallback) | Required | Required | `test_specialty_templates.py`, `clinical-encounter-workspace.test.tsx` |
| 4 | **Custom phrases work** (add/edit/delete personal phrase, department+section isolation, LAN persistence, historical text unchanged) | Required | Required | `test_quick_phrases.py`, `quick-phrase-bar.test.tsx` |
| 5 | **Prescriptions persist** (single validated `Authorise Prescription`, reload hydrates Rx, queue `Full RX ↗` preserves encounter linkage) | Required | Required | `test_prescriptions_api.py`, `clinical-encounter-workspace.test.tsx`, `prescription-workspace.test.tsx` |
| 6 | **Finalization works** (Physio default VAS `0` + `pain_site`, Ophth OD/OS VA, empty optional sections pass; missing required fields guided) | Required | Required | `test_clinical_encounters.py`, `test_specialty_templates.py`, `clinical-encounter-workspace.test.tsx` |
| 7 | **Follow-up reaches Reception** (finalised recommendation appears on Reception tab without `clinical_reason`; Reception books/closes; Doctor B blocked) | Required | Required | `test_follow_up_workflow.py`, `test_rbac_matrix.py`, `appointments-reception.test.tsx` |
| 8 | **Patient switching doesn't leak data** (switching patients on `My Queue` isolates scratchpad; switching encounters resets state) | Required | Required | `doctor-kanban-dashboard.test.tsx`, `clinical-encounter-workspace.test.tsx` |
| 9 | **Allergy safety verified** (`PrescriptionWorkspace` allergy strip + error state; `GET /doctor/queue` merges structured allergies; `PatientIdentityHeader` never shows green `"No known allergies"` on failure/legacy note) | Required | Required | `test_appointments_hardening.py`, `prescription-workspace.test.tsx`, `patient-workspace-shell.test.tsx` |

---

## Risks & Mitigations

1. **`check_matrix_completeness` & OpenAPI Drift**: Adding/changing any backend route while another wave runs `test_rbac_matrix.py` fails immediately. *Mitigation*: Every backend phase is bundled into a single atomic task (`T3.1`, `T4.1`, `T5.1`) that updates routes, `support/matrix.py`, `openapi.snapshot.json`, and tests together.
2. **Alembic Migration `0039` on Empty Test DB & PostgreSQL Grants**: `conftest.py:migrated_db` migrates a blank schema with 0 departments and asserts 0 setup rows, and `kalyan_app` requires explicit table/sequence grants. *Mitigation*: Keep `0039` strictly DDL + dialect-guarded `GRANT`s, and run idempotent application-level default phrase seeding (matching `templates.py:41`).
3. **Existing Vitest Prefix Fetch Mocks**: Prefix matchers like `url.includes('/api/encounters/10')` or `url.includes('/api/patients/101')` can intercept `/prescription` or `/allergies` requests. *Mitigation*: Defensive `Array.isArray(...)` guards in production code + explicit route order in Vitest mocks during `T1.7`.
4. **Finalise vs Follow-up Partial Failure (`T4.2`)**: Running `finaliseMutation` before `createFollowUpMutation` prevents premature follow-up locking on failed finalisation, while a dedicated `"Retry Sending Follow-up Recommendation"` button prevents stranding if `createFollowUpMutation` hits a network blip after finalise succeeds.
5. **Pre-Existing Dirty Working Tree**: Repository had uncommitted user changes prior to Phase 1. *Mitigation*: Non-destructive Git stash checkpoint `4e166a64` was recorded before our first edit; keep all diffs strictly scoped to declared task `location` files.
