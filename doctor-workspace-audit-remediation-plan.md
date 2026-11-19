# Plan: Doctor Workspace Audit Remediation & Hardening (Ponytail Audit #1–#15)

**Generated**: 2026-11-18  
**Reviewed & Revised**: 2026-11-18 (Independent `Audit Plan Reviewer` subagent audit passed — autogenerate-safe dual partial indexes, `ConsultationSummaryPrint` fallback leak, `Ctrl+P` print watermark, `conftest.py` fixture preservation, `MyAccount.tsx:78,97` guards, `isOtherDoctorRef` autosave lock, and strict Wave 1 single-writer ownership resolved)  
**Source Audit**: `/ponytail-audit` findings #1–#15 + `/build-fix` live dev `404` diagnosis  
**Workspace**: `d:\dr-sr` (FastAPI + SQLAlchemy/Alembic + PostgreSQL + React 19 + React Router 7 + TanStack Query + Vitest/pytest)

---

## Overview

Minimum-diff remediation plan resolving all **8 Must-Fix**, **5 Should-Fix**, and **2 Nice-to-Have** findings from the Doctor Workspace Ponytail Audit without rebuilding existing modules or altering visual identity.

**Hard Engineering Constraints (`AGENTS.md` + Ponytail Rules)**:
1. **Smallest safe diff**: Prefer deletion/simplification over adding layers or speculative config.
2. **Preserve existing working workflows**: Both Physiotherapy and Ophthalmology flows, plus Reception billing/registration/check-in flows, must remain green.
3. **Atomic Backend Contract Rule**: Every backend task that modifies routes, schemas, permissions, or migrations updates `backend/tests/support/matrix.py`, `backend/tests/openapi.snapshot.json` (if schema changed), and its pytest suite in the **same atomic task** so `check_matrix_completeness` (`matrix.py:3146`) never breaks across parallel waves.
4. **UX-04 Legibility Guard (`src/test/guards/guards.test.ts`)**: All non-exempt `.tsx` files (including newly extracted `EncounterStructuredDiagnosesPanel.tsx` and `EncounterInvestigationOrdersPanel.tsx`) must contain **zero** `text-[11px]` or `text-slate-400` violations.
5. **No concurrent file editing**: Every wave strictly partitions owned files across parallel tasks (`queries.ts` is owned solely by `A4` in Wave 1; `A5` must NOT edit `queries.ts`).
6. **Do NOT commit/push** automatically while pre-existing uncommitted user changes sit in the working tree; take a non-destructive `git stash create` checkpoint before execution.

---

## Prerequisites & Operational Step (Before Live Browser Testing)

- **Operational Prereq (`OP0` — Live Dev Runtime Fix for Screenshot `404 Not Found`)**:
  - Local dev DB `kalyan_dev` is currently at revision `0037` (expected head `0039`), and running `uvicorn` (`PID 16668`, started 05:34 without `--reload`) is serving stale routes without `/api/quick-phrases`.
  - Before live browser testing, stop the stale `uvicorn` process, run `backend/.venv/Scripts/python.exe -m kalyan_api.cli migrate`, and restart `uvicorn` with `--reload`.
- **Tooling**:
  - Backend: `backend/.venv/Scripts/python.exe` (`pytest`, `ruff`, `kalyan_api.cli`).
  - Frontend: `d:\dr-sr\frontend` (`npx tsc --noEmit`, `npx vitest run`, `npm run build`).
  - Current Alembic head: `0039_clinical_quick_phrases.py`.

---

## Dependency Graph

```text
=== WAVE 1 (4 Parallel Disjoint Tracks — 0 Shared Files) ===
A1 (BE Atomic: #3 OPD Arrivals RBAC, #5 Merged Aliases, #6-BE Physio Specialty Guard + Matrix + Pytest)
   │
   ▼
A2 (BE Atomic: #9 Migration 0040 Dual Partial Indexes + Seeder + #11-BE Queue/Encounter selectinload + Pytest) ──┐
                                                                                                                  │
A3 (FE: #1 Rx Print Watermark/Columns/Letterhead + #2 Summary Print Addenda/No clinical_notes Fallback) ──┐       │
                                                                                                          ├──► A6 (FE: #2 Caller + #4 Encounter Read-Only + #13 Split Sub-Panels) ──┤
A4 (FE: #7 Unfinished Error State, #8 Queue 3-Zone/Transitions, #10 Queue Hold, #11-FE Polling Dedup, #15 plan) ─────────────────────────────────────────────────────────────────────┼──► A7 (Full BE + FE + Build Gate)
                                                                                                                                                                                    │
A5 (FE: #4 Conditions Owner Check, #6-FE Fail-Closed Nav, #10 Settings Dead localStorage, #12 Draft Rx & MyAccount 403, #14 Settings Address, #15 Clinical Chart) ──────────────────┘
```

---

## Tasks

### Wave 1 — Parallel Core Security, Print Safety, Queue & Patient Records

#### A1: Backend Atomic — OPD Arrivals RBAC (#3), Merged Patient Aliases (#5) & Physiotherapy Specialty Guard (#6-BE)
- **depends_on**: `[]`
- **location**:
  - `backend/src/kalyan_api/routers/opd_arrivals.py`
  - `backend/src/kalyan_api/services/opd_arrival_service.py`
  - `backend/src/kalyan_api/routers/encounters.py`
  - `backend/src/kalyan_api/routers/treatment_plans.py`
  - `backend/src/kalyan_api/routers/treatment_sessions.py`
  - `backend/src/kalyan_api/routers/patients.py`
  - `backend/src/kalyan_api/routers/clinical_diagnoses.py`
  - `backend/tests/support/matrix.py`
  - `backend/tests/test_opd_arrivals.py`
  - `backend/tests/test_treatment_plans_api.py`
  - `backend/tests/test_treatment_sessions_api.py`
  - `backend/tests/test_phase23_patient_consolidation.py`
- **description**:
  1. **Finding #3 (OPD Arrivals RBAC)**:
     - `GET /api/opd-arrivals` (`opd_arrivals.py:53-75`): inject `principal: Principal = Depends(current_principal)`. When `principal.role == Role.DOCTOR`, fail closed (`0` results) if `principal.doctor_id is None`; reject cross-doctor `doctor_id` filter with `403 scope_forbidden` and default to `doctor_id = principal.doctor_id`.
     - `GET /api/opd-arrivals/{arrival_id}` (`opd_arrivals.py:78-84`): inject `principal`; when `principal.role == Role.DOCTOR`, deny cross-doctor arrival with `404` or `403 scope_forbidden` (align exact status with `matrix.py:2853`!).
     - `PATCH /api/opd-arrivals/{arrival_id}/priority` & `POST /api/opd-arrivals/{arrival_id}/cancel` (`opd_arrivals.py:87-128`): require Reception-only authorization (`Permission.VISIT_WRITE` or explicit `principal.role != Role.RECEPTION -> 403 reception_only`), matching `PATCH /api/appointments/{id}/priority`.
     - **Atomic `matrix.py` update**: Update rows `2853` (`GET /{arrival_id}` -> `doctor_b: 403` or `404`), `2866` (`PATCH /{arrival_id}/priority` -> `doctor_a: 403, doctor_b: 403`), and `2878` (`POST /{arrival_id}/cancel` -> `doctor_a: 403, doctor_b: 403`) in the exact same task!
  2. **Finding #5 (Merged Patient Alias Consolidation — Invariant #1)**:
     - `encounters.py:349` (`GET /patients/{patient_id}/encounters`): use `ClinicalEncounter.patient_id.in_(effective_patient_ids(session, patient_id))`.
     - `treatment_plans.py:203` (`GET /patients/{patient_id}/treatment-plans`): use `TreatmentPlan.patient_id.in_(effective_patient_ids(session, patient_id))`.
     - `patients.py:898` (`PATCH /patients/{patient_id}/allergies/{allergy_id}`): verify `allergy.patient_id in effective_patient_ids(session, patient_id)`.
     - `clinical_diagnoses.py:281` (`PATCH /patients/{patient_id}/conditions/{condition_id}`): verify `condition.patient_id in effective_patient_ids(session, patient_id)`.
     - Add consolidation tests in `test_phase23_patient_consolidation.py` proving master patient lists merged-child encounters/plans and returns `200` when editing a migrated allergy or condition.
  3. **Finding #6-BE (Physiotherapy Specialty Enforcement)**:
     - Add a shared helper `_require_physiotherapy_doctor(session, principal)` checking that the doctor has an assigned department whose normalized code contains `'PHYSIO'` (returning `403 specialty_required` otherwise).
     - Enforce in `create_treatment_plan` (`treatment_plans.py:76`) and `log_treatment_session` (`treatment_sessions.py:84`).
     - **Do NOT alter `doctor_a_user` / `doctor_b_user` globally in `conftest.py`** (they already link to `PHYSIOTHERAPY_GENERAL_OPD`, so existing tests remain green). Instead, provision a dedicated Ophthalmology doctor inside `test_treatment_plans_api.py` and `test_treatment_sessions_api.py` asserting `403 specialty_required` on both endpoints!
  4. Do NOT edit `models.py` (reserved for `A2`). Run `ruff check` + pytest gate (`test_opd_arrivals`, `test_treatment_plans_api`, `test_treatment_sessions_api`, `test_phase23_patient_consolidation`, `test_route_policies`, `test_rbac_matrix`, `test_openapi_snapshot`).
- **validation**: `ruff check` clean; all 7 backend test suites pass with 0 failures; new tests prove Doctor B blocked on OPD arrivals, Ophthalmology doctor gets `403 specialty_required` on Physio plan/session writes, and merged-child records read & patch cleanly on master patient.
- **status**: Completed (VERIFIED)
- **log**: Scoped `GET /opd-arrivals` & `GET /opd-arrivals/{id}` for doctors (`403 scope_forbidden`), switched `/priority` & `/cancel` to `Permission.VISIT_WRITE` (Reception-only), updated `matrix.py` atomically, added `effective_patient_ids` consolidation across encounters/treatment-plans/allergies/conditions, enforced `_require_physiotherapy_doctor` (`403 specialty_required`) on `create_treatment_plan` & `log_treatment_session`, and added +4 tests. `ruff check` clean; full 1019-test `test_rbac_matrix.py` + 6 suites passed.
- **files edited/created**: `backend/src/kalyan_api/routers/opd_arrivals.py`, `backend/src/kalyan_api/routers/encounters.py`, `backend/src/kalyan_api/routers/treatment_plans.py`, `backend/src/kalyan_api/routers/treatment_sessions.py`, `backend/src/kalyan_api/routers/patients.py`, `backend/src/kalyan_api/routers/clinical_diagnoses.py`, `backend/tests/support/matrix.py`, `backend/tests/test_opd_arrivals.py`, `backend/tests/test_treatment_plans_api.py`, `backend/tests/test_treatment_sessions_api.py`, `backend/tests/test_phase23_patient_consolidation.py` 

#### A3: Frontend Print Safety, Native `Ctrl+P` Watermark & Dynamic Letterhead (#1, #2-Print)
- **depends_on**: `[]`
- **location**:
  - `frontend/src/components/PrintLetterhead.tsx`
  - `frontend/src/components/PrescriptionPrint.tsx`
  - `frontend/src/components/ConsultationSummaryPrint.tsx`
  - `frontend/src/pages/PrescriptionWorkspace.tsx`
  - `frontend/src/pages/VisitWorkspacePage.tsx`
  - `frontend/src/components/__tests__/prescription-print.test.tsx`
  - `frontend/src/pages/__tests__/consultation-summary-print.test.tsx`
  - `frontend/src/pages/__tests__/visit-workspace.test.tsx`
  - `frontend/src/pages/__tests__/prescription-workspace.test.tsx`
- **description**:
  1. **Finding #1 (Prescription Print Safety, `Ctrl+P` Watermark, Columns & Letterhead)**:
     - In `PrintLetterhead.tsx`: add optional `departmentName?: string | null` prop to `LetterheadBanner` (falling back to `'Physiotherapy Department'` ONLY when omitted so `RegistrationCard` stays backwards-compatible) and optional `authoringDoctor?: { name: string; qualification?: string | null; registrationNumber?: string | null } | null` prop to `LetterheadDoctors` (rendering that doctor's credentials when supplied for a non-Physiotherapy doctor instead of the hardcoded two physiotherapists).
     - In `PrescriptionPrint.tsx`:
       - Compute `isPrintable = prescription.is_printable ?? prescription.status === 'AUTHORISED'`. Disable the on-screen Print button when `!isPrintable` **AND** render a prominent, non-`print:hidden` status banner/watermark inside `data-testid="prescription-sheet"` (`DRAFT — NOT AUTHORISED`, `CANCELLED`, or `SUPERSEDED`) so native browser `Ctrl+P` cannot produce a valid-looking slip!
       - Display `strength`, `form`, and `route` in the medication table (e.g., `form` + `strength` with Medicine Name and `route` with Dosage/Instructions — critical for Ophthalmology `Eye Drops · 0.5% · Right Eye (OD)`).
       - Format all dates with `{ timeZone: 'Asia/Kolkata' }`, apply `withDoctorTitle(prescription.doctor_name)`, and pass optional `departmentName` / authoring doctor info (resolved from `useDoctors(false)` when available).
     - In `VisitWorkspacePage.tsx:637-664` and `PrescriptionWorkspace.tsx:448-470`: show `rx.status` badge on historical rows and restrict printable `Print` CTA to `rx.status === 'AUTHORISED'` (matching `PatientPrescriptionsTab.tsx:639`).
  2. **Finding #2-Print (Consultation Summary — Eliminate `clinical_notes` Fallback Leak & Render Addenda)**:
     - In `ConsultationSummaryPrint.tsx:102`: **remove `encounter.clinical_notes` from `careAdvice` fallback** (`const careAdvice = advice?.trim() || 'Follow prescribed advice and return as recommended.'`) so internal examination findings NEVER leak into patient `"Advice"` when `advice` is blank!
     - Render `encounter.addenda` in a dedicated chronological section (numbered, IST timestamp `{ timeZone: 'Asia/Kolkata' }`, author with `withDoctorTitle`, and `addendum_text`) whenever `encounter.addenda.length > 0`.
     - Format all summary dates with `{ timeZone: 'Asia/Kolkata' }` and accept optional `departmentName?: string | null` passed through to `LetterheadBanner`.
  3. Update & add Vitest tests verifying: non-`AUTHORISED` Rx disables Print button AND renders visible watermark inside `prescription-sheet`; `strength`/`form`/`route` render on Rx slip; Ophthalmology doctor does NOT print hardcoded Physiotherapy letterhead; `ConsultationSummaryPrint` omits `clinical_notes` when `advice` is empty and renders dated `addenda`.
- **validation**: `npx tsc --noEmit` 0 errors; `npx vitest run src/components/__tests__/prescription-print.test.tsx src/pages/__tests__/consultation-summary-print.test.tsx src/pages/__tests__/visit-workspace.test.tsx src/pages/__tests__/prescription-workspace.test.tsx src/test/guards/guards.test.ts` passes.
- **status**: Completed (VERIFIED)
- **log**: Added optional `departmentName`/`authoringDoctor` to `PrintLetterhead`, fail-closed `isPrintable` + non-`print:hidden` `rx-status-watermark` + `form`/`strength`/`route` columns + IST dates/`withDoctorTitle` in `PrescriptionPrint`, removed `encounter.clinical_notes` fallback & added chronological `summary-addenda-section` in `ConsultationSummaryPrint`, and restricted printable Rx actions to `AUTHORISED` in `VisitWorkspacePage` & `PrescriptionWorkspace`. `tsc --noEmit` 0 errors; 5 targeted Vitest suites (`34/34`) + 3 caller suites (`21/21`) passed.
- **files edited/created**: `frontend/src/components/PrintLetterhead.tsx`, `frontend/src/components/PrescriptionPrint.tsx`, `frontend/src/components/ConsultationSummaryPrint.tsx`, `frontend/src/pages/PrescriptionWorkspace.tsx`, `frontend/src/pages/VisitWorkspacePage.tsx`, `frontend/src/components/__tests__/prescription-print.test.tsx`, `frontend/src/pages/__tests__/consultation-summary-print.test.tsx`, `frontend/src/pages/__tests__/visit-workspace.test.tsx`, `frontend/src/pages/__tests__/prescription-workspace.test.tsx` 

#### A4: Frontend Queue Reliability, Unfinished Card Error State, Polling Dedup & Dead State Cleanup (#7, #8, #10-Queue, #11-FE, #15-Plan)
- **depends_on**: `[]`
- **location**:
  - `frontend/src/components/DoctorDashboardUnfinishedCard.tsx`
  - `frontend/src/pages/DoctorDashboard.tsx`
  - `frontend/src/api/alerts.ts`
  - `frontend/src/api/queries.ts` *(single-writer owner in Wave 1!)*
  - `frontend/src/pages/__tests__/doctor-dashboard-unfinished.test.tsx`
  - `frontend/src/pages/__tests__/doctor-kanban-dashboard.test.tsx`
  - `frontend/src/components/__tests__/emergency-alert-banner.test.tsx`
- **description**:
  1. **Finding #7 (`DoctorDashboardUnfinishedCard`)**: Check `queryResult.isError` and render an explicit `role="alert"` error alert with a `Retry` button instead of falling back to `[]` and showing green `"No Unfinished Consultations"`. Gate `useUnfinishedEncounters()` with `enabled: propEncounters === undefined` (updating `useUnfinishedEncounters(enabled = true)` in `queries.ts`).
  2. **Finding #8 (`DoctorDashboard` 3-Zone & Status Transitions)**:
     - Render **all** items in `queue.in_consultation` in Zone 1 (not just `in_consultation[0]`) and update the Live Queue count accurately.
     - Fix status guards: include `'WAITING'` alongside `'ARRIVED'`/`'CHECKED_IN'` in `handleCallNext` (`L321`); do NOT render `Start Consultation` / `Call` buttons on unchecked-in `'BOOKED'` cards (show `"Waiting for Reception check-in"` text instead); disable `Finish Consultation & Call Next` unless `currentChartPatient.consultation_status === 'IN_CONSULTATION'`.
     - Store auto-call `setTimeout` handle in a ref and clear it in a cleanup `useEffect` on unmount.
  3. **Finding #10-Queue (Broken `In Consultation` Lab Hold & Shared PC Isolation)**:
     - Remove the broken `"Hold"` button from `In Consultation` cards and ignore drops of `IN_CONSULTATION` cards onto the `Lab Hold` column (backend has no `IN_CONSULTATION -> WAITING` transition).
     - Namespace `localStorage` keys by doctor ID and IST date (`kh.doctor.status.${me.doctor_id}` and `kh.doctor.labHold.${me.doctor_id}.${istToday()}`) so shared workstations don't leak across doctors or stale days.
  4. **Finding #11-FE (Duplicate Queue Polling)**:
     - Update `useDoctorAlerts` (`alerts.ts`) to share `queryKey: ['doctor-queue']` with `useDoctorQueue` using TanStack Query's `select: (queue) => ...` to derive open emergencies! Because both share `['doctor-queue']`, TanStack Query deduplicates requests and `useAcknowledgeAlert` invalidating `['doctor-queue']` refreshes both the banner and dashboard in one round-trip.
  5. **Finding #15-Plan**: Delete dead `plan` property from `SoapNotesState` in `DoctorDashboard.tsx`.
- **validation**: `npx tsc --noEmit` 0 errors; `npx vitest run src/pages/__tests__/doctor-dashboard-unfinished.test.tsx src/pages/__tests__/doctor-kanban-dashboard.test.tsx src/components/__tests__/emergency-alert-banner.test.tsx src/pages/__tests__/doctor-workspace.test.tsx src/test/guards/guards.test.ts` passes.
- **status**: Completed (VERIFIED)
- **log**: Added `unfinished-consultations-error` + Retry in `DoctorDashboardUnfinishedCard`, rendered all `in_consultation` patients in Zone 1, fixed `'WAITING'`/`'BOOKED'`/`Finish` status guards + `autoCallTimerRef` unmount cleanup, removed broken `In Consultation` Hold + doctor/IST-date namespaced `localStorage`, deduplicated `useDoctorAlerts` onto shared `['doctor-queue']` cache key via `select`, and deleted dead `soapNotes.plan`. `tsc --noEmit` 0 errors; 5 Vitest suites passed (`45 passed (45)`).
- **files edited/created**: `frontend/src/components/DoctorDashboardUnfinishedCard.tsx`, `frontend/src/pages/DoctorDashboard.tsx`, `frontend/src/api/alerts.ts`, `frontend/src/api/queries.ts`, `frontend/src/pages/__tests__/doctor-dashboard-unfinished.test.tsx`, `frontend/src/pages/__tests__/doctor-kanban-dashboard.test.tsx`, `frontend/src/components/__tests__/emergency-alert-banner.test.tsx` 

#### A5: Frontend Patient Records, Settings Cleanup, Account 403 Fix & Fail-Closed Sidebar (#4-Conditions, #6-FE, #10-Settings, #12, #14, #15-Link)
- **depends_on**: `[]`
- **location**:
  - `frontend/src/components/AppShell.tsx`
  - `frontend/src/components/patient/PatientOverviewTab.tsx`
  - `frontend/src/pages/PatientDetail.tsx`
  - `frontend/src/components/patient/PatientPrescriptionsTab.tsx`
  - `frontend/src/pages/DoctorSettings.tsx`
  - `frontend/src/pages/MyAccount.tsx`
  - `frontend/src/pages/PatientsDirectory.tsx`
  - `frontend/src/components/__tests__/app-shell.test.tsx`
  - `frontend/src/pages/__tests__/doctor-settings.test.tsx`
  - `frontend/src/pages/__tests__/my-account.test.tsx`
  - `frontend/src/pages/__tests__/patients-directory.test.tsx`
  - `frontend/src/components/__tests__/patient-clinical-tabs.test.tsx`
  - `frontend/src/pages/__tests__/patient-workspace-shell.test.tsx`
  - *(STRICTLY DO NOT edit `frontend/src/api/queries.ts` — `useAuthorisePrescription()` already exists at `queries.ts:1626-1641`!)*
- **description**:
  1. **Finding #6-FE (`AppShell.tsx` + `app-shell.test.tsx`)**:
     - Change `AppShell.tsx:557` to fail closed on specialty sidebar items (`!item.specialty || codes.has(item.specialty)` — removing `codes.size === 0`).
     - Update `app-shell.test.tsx` (`L140-169`) to explicitly mock `useMyDepartments` returning Physiotherapy for existing Physio doctor nav tests, and add a new test verifying `Physiotherapy Treatment` is **omitted** when departments are empty or Ophthalmology-only.
  2. **Finding #4-Conditions (`PatientDetail.tsx` + `PatientOverviewTab.tsx`)**:
     - Pass `currentDoctorId={me?.doctor_id}` into `PatientOverviewTab`; gate inline Condition status `<select>` and `Edit` button on `canWriteConditions && (!currentDoctorId || condition.doctor_id === currentDoctorId)` so Doctor B cannot hit 404 on Doctor A's conditions.
  3. **Finding #10-Settings & #14 (`DoctorSettings.tsx`)**:
     - Delete the unused `localStorage`-only `Target Consultation Pace` (`kh_doctor_consult_pace`) and `Follow-Up Grace Validity` (`kh_doctor_followup_validity`) controls (read nowhere in the repo).
     - Replace the hardcoded wrong Satara address in the Letterhead Preview (`L145-159`) with live `useClinicSettings()` / `useClinicBranding()` + `withDoctorTitle(...)`.
  4. **Finding #12 (`MyAccount.tsx` & `PatientPrescriptionsTab.tsx`)**:
     - In `MyAccount.tsx:78` **and** `:97`: guard both `refetchSessions()` calls with `if (canSeeSessions) await refetchSessions()` so doctors/receptionists never fire a guaranteed `403 GET /api/sessions`.
     - In `PatientPrescriptionsTab.tsx`: add an `Authorise` button (calling existing `useAuthorisePrescription()`) strictly on own-doctor `DRAFT` prescriptions (`rx.status === 'DRAFT' && (!currentDoctorId || rx.doctor_id === currentDoctorId)`), with per-row busy disable (`authoriseMutation.isPending && authoriseMutation.variables === rx.id`) and success toast.
  5. **Finding #15-Link (`PatientsDirectory.tsx:465`)**: Change doctor row `"Clinical Chart"` `<Link>` from broken `/doctor?patient_id=${p.id}` to `/reception/patients/${p.id}?tab=clinical`.
- **validation**: `npx tsc --noEmit` 0 errors; `npx vitest run src/components/__tests__/app-shell.test.tsx src/pages/__tests__/doctor-settings.test.tsx src/pages/__tests__/my-account.test.tsx src/pages/__tests__/patients-directory.test.tsx src/components/__tests__/patient-clinical-tabs.test.tsx src/pages/__tests__/patient-workspace-shell.test.tsx src/test/guards/guards.test.ts` passes.
- **status**: Completed (VERIFIED)
- **log**: Implemented fail-closed Physio nav in `AppShell`, cross-doctor read-only conditions in `PatientDetail`/`PatientOverviewTab`, own-doctor `DRAFT` Authorise in `PatientPrescriptionsTab`, deleted dead `localStorage` pace/validity + wired live clinic address in `DoctorSettings`, guarded both `MyAccount` `refetchSessions()` calls (`L78, L97`), and fixed `"Clinical Chart"` link in `PatientsDirectory`. `tsc --noEmit` 0 errors; 7 Vitest suites passed (`72 passed (72)`).
- **files edited/created**: `frontend/src/components/AppShell.tsx`, `frontend/src/pages/PatientDetail.tsx`, `frontend/src/components/patient/PatientOverviewTab.tsx`, `frontend/src/components/patient/PatientPrescriptionsTab.tsx`, `frontend/src/pages/DoctorSettings.tsx`, `frontend/src/pages/MyAccount.tsx`, `frontend/src/pages/PatientsDirectory.tsx`, `frontend/src/components/__tests__/app-shell.test.tsx`, `frontend/src/pages/__tests__/doctor-settings.test.tsx`, `frontend/src/pages/__tests__/my-account.test.tsx`, `frontend/src/pages/__tests__/patients-directory.test.tsx`, `frontend/src/components/__tests__/patient-clinical-tabs.test.tsx`, `frontend/src/pages/__tests__/patient-workspace-shell.test.tsx` 

---

### Wave 2 — Scale/Concurrency Backend & Encounter Read-Only / Lean Split

#### A2: Backend Atomic — QuickPhrase Seeder Race Guard (#9) & Queue/Encounter N+1 `selectinload` (#11-BE)
- **depends_on**: `[A1]`
- **location**:
  - `backend/src/kalyan_api/migrations/versions/0040_quick_phrases_default_unique.py` (new)
  - `backend/src/kalyan_api/models.py`
  - `backend/src/kalyan_api/routers/quick_phrases.py`
  - `backend/src/kalyan_api/routers/appointments.py`
  - `backend/src/kalyan_api/routers/encounters.py`
  - `backend/tests/test_quick_phrases.py`
- **description**:
  1. **Finding #9 (`quick_phrases` concurrent seeder race & autogenerate-clean unique indexes)**:
     - Add Migration `0040_quick_phrases_default_unique.py` (chained from `0039_clinical_quick_phrases`) and matching `Index(...)` entries in `models.py` using **two plain-column partial unique indexes** (NO `COALESCE(...)` expression index, preventing `alembic.command.check` false-positive drift in `test_migrations.py`!):
       1. `Index("ix_quick_phrases_default_dept", "department_code", "section", "phrase_text", unique=True, postgresql_where=text("scope = 'HOSPITAL_DEFAULT' AND department_code IS NOT NULL"))`
       2. `Index("ix_quick_phrases_default_global", "section", "phrase_text", unique=True, postgresql_where=text("scope = 'HOSPITAL_DEFAULT' AND department_code IS NULL"))`
     - Update `ensure_default_quick_phrases_seeded` to fast-path via a single `SELECT count(*)` against `len(expected_defaults)` (skipping row hydration on every `GET` once seeded while remaining 100% safe across test DB wipes!) and use PostgreSQL `pg_insert(...).on_conflict_do_nothing()` when dialect is PostgreSQL (with existing idempotent fallback on non-PostgreSQL) so simultaneous cold-start requests can never insert duplicates or raise `IntegrityError`.
     - Add a test in `test_quick_phrases.py` verifying idempotency & DB unique constraint protection against duplicate `HOSPITAL_DEFAULT` inserts.
  2. **Finding #11-BE (Eliminate N+1 SQL Queries)**:
     - In `appointments.py:get_doctor_queue`: add `.options(selectinload(Appointment.patient))`.
     - In `encounters.py:list_unfinished_encounters` and `list_patient_encounters`: add `.options(selectinload(ClinicalEncounter.patient), selectinload(ClinicalEncounter.department), selectinload(ClinicalEncounter.doctor), selectinload(ClinicalEncounter.addenda))` matching the relationships each handler accesses.
- **validation**: `ruff check` clean; `pytest backend/tests/test_migrations.py backend/tests/test_quick_phrases.py backend/tests/test_appointments_hardening.py backend/tests/test_clinical_encounters.py backend/tests/test_consultation_drafts.py backend/tests/test_route_policies.py backend/tests/test_rbac_matrix.py backend/tests/test_openapi_snapshot.py` passes (including `test_migrations.py::test_models_match_migrations`!).
- **status**: Completed (VERIFIED)
- **log**: Added Migration `0040_quick_phrases_default_unique.py` (`down_revision = "0039"`) and matching plain-column partial unique indexes (`ix_quick_phrases_default_dept`, `ix_quick_phrases_default_global`) in `models.py`; added `SELECT count(*)` fast-path + PostgreSQL `pg_insert(...).on_conflict_do_nothing()` in `routers/quick_phrases.py`; added `selectinload` eager loading in `appointments.py:get_doctor_queue` and `encounters.py` (`list_unfinished_encounters`, `list_patient_encounters`); added conflict/unique-index pytest coverage in `test_quick_phrases.py`. `ruff check` clean; 7 pytest suites (including `test_migrations.py`, `test_route_policies.py`, `test_openapi_snapshot.py`) passed (`49 passed`).
- **files edited/created**: `backend/src/kalyan_api/migrations/versions/0040_quick_phrases_default_unique.py`, `backend/src/kalyan_api/models.py`, `backend/src/kalyan_api/routers/quick_phrases.py`, `backend/src/kalyan_api/routers/appointments.py`, `backend/src/kalyan_api/routers/encounters.py`, `backend/tests/test_quick_phrases.py`

#### A6: Frontend `ClinicalEncounterWorkspace` — Cross-Doctor Read-Only (#4-Encounter), Summary Advice Fix (#2-Caller) & Lean Sub-Panel Split (#13)
- **depends_on**: `[A3, A4]` *(disjoint from `A2` — runs in parallel with `A2`!)*
- **location**:
  - `frontend/src/components/encounter/EncounterStructuredDiagnosesPanel.tsx` (new)
  - `frontend/src/components/encounter/EncounterInvestigationOrdersPanel.tsx` (new)
  - `frontend/src/pages/ClinicalEncounterWorkspace.tsx`
  - `frontend/src/pages/__tests__/clinical-encounter-workspace.test.tsx`
- **description**:
  1. **Finding #4-Encounter (Cross-Doctor Read-Only Mode + Autosave Lock)**:
     - Compute `isOtherDoctorEncounter = Boolean(existingEncounter && me?.doctor_id != null && existingEncounter.doctor_id !== me.doctor_id)` and maintain `isOtherDoctorRef.current = isOtherDoctorEncounter`.
     - Guard `runSave`, `scheduleAutoSave`, and `handleSectionBlur` with `if (isFinalisedRef.current || isOtherDoctorRef.current) return` so viewing Doctor A's draft never triggers 404/403 `PATCH /encounters/{id}` requests!
     - Compute `isReadOnly = isFinalised || isOtherDoctorEncounter`. When `isOtherDoctorEncounter` is true: render `data-testid="encounter-readonly-banner"`, disable all clinical inputs (`symptoms`, `clinicalNotes`, `diagnosis`, `VitalsBiometricsSection`, specialty forms, `PrescriptionFormSection`, `FollowUpSection`, `QuickPhraseBar`), hide `"Needed to finalise"`, hide `Finalise Consultation`, hide the Addendum append form, and omit `<DoctorChargesPanel>`!
  2. **Finding #2-Caller (Consultation Summary Patient Advice)**:
     - In `<ConsultationSummaryPrint ... />`, pass actual patient care advice (`[generalAdvice.trim(), dietaryAdvice.trim()].filter(Boolean).join('\n\n') || undefined`) instead of internal `clinicalNotes`, and pass `departmentName={departmentName}`.
  3. **Finding #13 (Lean Split-by-Job)**:
     - Extract `EncounterStructuredDiagnosesPanel` and `EncounterInvestigationOrdersPanel` into `frontend/src/components/encounter/` with local styling constants (zero circular import back to `ClinicalEncounterWorkspace.tsx`), pass `isReadOnly={isReadOnly}` to disable Add/Remove controls for cross-doctor viewers, and verify **zero** UX-04 legibility violations (`text-[11px]` / `text-slate-400`) in the new non-exempt component files!
  4. Add Vitest tests in `clinical-encounter-workspace.test.tsx` verifying: Doctor B opening Doctor A's draft/finalised encounter sees `encounter-readonly-banner`, zero autosave `PATCH` calls, hidden `Finalise Consultation` / `"Needed to finalise"` / `<DoctorChargesPanel>` / Addendum form, and disabled structured-diagnoses/investigations actions; `ConsultationSummaryPrint` receives patient advice (never internal `clinicalNotes`) and renders addenda.
- **validation**: `npx tsc --noEmit` 0 errors; `npx vitest run src/pages/__tests__/clinical-encounter-workspace.test.tsx src/test/guards/guards.test.ts` passes.
- **status**: Completed (VERIFIED)
- **log**: Extracted `EncounterStructuredDiagnosesPanel` and `EncounterInvestigationOrdersPanel` (`ClinicalEncounterWorkspace.tsx` 2,603 -> 2,233 lines, -370 lines); implemented `isOtherDoctorEncounter` + `isOtherDoctorRef` read-only mode, `encounter-readonly-banner`, autosave/write locks, hidden Finalise/Needed-to-finalise/Billing/Addendum form for cross-doctor viewers; passed `patientCareAdvice` (`generalAdvice`/`dietaryAdvice`, never `clinicalNotes`), `departmentName`, and live `addenda` to `ConsultationSummaryPrint`; added 3 tests. `npx tsc --noEmit` 0 errors; `clinical-encounter-workspace.test.tsx` (47/47) + `guards.test.ts` (7/7) passed (`54 passed (54)`).
- **files edited/created**: `frontend/src/components/encounter/EncounterStructuredDiagnosesPanel.tsx`, `frontend/src/components/encounter/EncounterInvestigationOrdersPanel.tsx`, `frontend/src/pages/ClinicalEncounterWorkspace.tsx`, `frontend/src/pages/__tests__/clinical-encounter-workspace.test.tsx`

---

### Wave 3 — Final Full Regression & Build Gate

#### A7: Full Backend + Frontend + UX-04 Guard + Build Verification Gate
- **depends_on**: `[A2, A5, A6]`
- **location**: Read-only verification across `backend/` and `frontend/`
- **description**:
  - Backend: `ruff check` on all touched files + full clinical/RBAC/migrations/OpenAPI pytest suite (`test_migrations`, `test_route_policies`, `test_openapi_snapshot`, `test_rbac_matrix`, `test_opd_arrivals`, `test_quick_phrases`, `test_clinical_encounters`, `test_consultation_drafts`, `test_specialty_templates`, `test_prescriptions_api`, `test_follow_up_workflow`, `test_appointments_hardening`, `test_treatment_plans_api`, `test_treatment_sessions_api`, `test_phase23_patient_consolidation`, `test_cross_doctor_access`, `test_cross_doctor_read_scope`).
  - Frontend: `npx tsc --noEmit`, **full** `npx vitest run` (all 82+ files including `guards.test.ts`), and `npm run build`.
- **validation**: 0 errors, 0 failed tests, 0 UX-04 legibility violations, clean Vite production bundle.
- **status**: Completed (VERIFIED)
- **log**: Full Wave 3 verification gate passed with 0 errors. Backend (`A7-BE`): `ruff check` passed on all 15 touched backend files (`All checks passed!`; `backend/src/kalyan_api/rbac/matrix.py` also verified clean in `A1`); 17-suite pytest gate passed (`1138 passed, 1 warning in 350.53s` including `test_migrations`, `test_route_policies`, `test_openapi_snapshot`, `test_rbac_matrix`). Frontend (`A7-FE`): `npx tsc --noEmit` 0 errors; full `npx vitest run` passed (`Test Files 83 passed (83)`, `Tests 755 passed | 5 skipped (760)`, including `guards.test.ts` 7/7 with 0 UX-04 violations); `npm run build` clean (`built in 4.09s`).
- **files edited/created**: None (read-only verification gate)

---

## Parallel Execution Groups

| Wave | Tasks | Shared-File Collision Check | Can Start When |
|------|-------|-----------------------------|----------------|
| **Prereq** | `OP0` | Local dev `kalyan_dev` `migrate` (`0037→0039`) + restart `uvicorn --reload` (fixes screenshot 404) | Anytime before live browser check |
| **Wave 1** | `A1`, `A3`, `A4`, `A5` | 100% disjoint: BE (`A1`, no `models.py`) vs Print/Visit/Rx (`A3`) vs Queue/Alerts/`queries.ts` (`A4`) vs AppShell/PatientDetail/Settings/Account/Directory (`A5`, no `queries.ts`) | Immediately |
| **Wave 2** | `A2`, `A6` | 100% disjoint: BE Migration `0040` + `models.py` + `selectinload` (`A2`) vs FE `ClinicalEncounterWorkspace` + extracted sub-panels (`A6`) | `A2` after `A1`; `A6` after `A3`, `A4` |
| **Wave 3** | `A7` | Read-only full BE + FE + `guards.test.ts` + `npm run build` gate | After `A2`, `A5`, `A6` |

---

## Testing Strategy

- **Backend**: `backend/.venv/Scripts/python.exe -m ruff check ...` + `pytest` always including `test_migrations.py`, `test_route_policies.py`, `test_rbac_matrix.py`, and `test_openapi_snapshot.py`.
- **Frontend**: `npx tsc --noEmit`, `npx vitest run` (always running `src/test/guards/guards.test.ts` after any JSX edit!), and `npm run build`.
- **Dual-Department Parity**: Every print, queue, read-only, and specialty-gating change must pass tests for both **Physiotherapy** and **Ophthalmology**.

---

## Risks & Mitigations

1. **Migration `0040` Autogenerate Check (`A2`)**: `test_migrations.py` runs `alembic.command.check(cfg)`; functional expression indexes like `COALESCE(...)` fail with false-positive drift on PostgreSQL. *Mitigation*: Use two plain-column partial unique indexes (`department_code IS NOT NULL` vs `department_code IS NULL`) in both `models.py` and `0040`.
2. **Global `conftest.py` Doctor Fixtures (`A1`)**: Changing `doctor_b_user` globally in `conftest.py` would break unrelated RBAC/silo tests. *Mitigation*: Leave `conftest.py` untouched (existing doctors are already linked to `PHYSIOTHERAPY_GENERAL_OPD`) and create a test-local Ophthalmology doctor fixture for the `403 specialty_required` negative test.
3. **UX-04 Legibility Guard on Extracted Sub-Panels (`A6`)**: `EncounterStructuredDiagnosesPanel.tsx` and `EncounterInvestigationOrdersPanel.tsx` are NOT in `guards.test.ts`'s print-file allow-list. *Mitigation*: Verify zero `text-[11px]` or `text-slate-400` classes and run `guards.test.ts` directly inside `A6`.
4. **`ConsultationSummaryPrint` `clinical_notes` Leak (`A3` + `A6`)**: Removing `clinicalNotes` from the caller alone leaves `ConsultationSummaryPrint.tsx:102`'s fallback leaking `encounter.clinical_notes`. *Mitigation*: Remove `encounter.clinical_notes` inside `ConsultationSummaryPrint.tsx` in `A3` AND update the caller in `A6`.
5. **Native `Ctrl+P` Print Bypass (`A3`)**: Disabling the Print button still lets `Ctrl+P` print unwatermarked drafts/cancelled slips. *Mitigation*: Render a visible non-`print:hidden` status banner inside `prescription-sheet` whenever `!isPrintable`.
