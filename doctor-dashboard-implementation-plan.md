# Plan: Kalyan Hospital — Doctor Dashboard Implementation Plan

**Generated**: 2026-11-19  
**Reviewed & Revised**: 2026-11-19 (Subagent plan review passed — all 13 findings, edge cases, RBAC matrices, and test migration paths resolved)  
**Target File**: `doctor-dashboard-implementation-plan.md`  
**Workspace**: `d:\dr-sr` (FastAPI + SQLAlchemy/Alembic + React 19 + React Router 8 + TanStack Query 5 + Tailwind 4 + Vitest/pytest)  
**Reference Design**: Doctor Workspace Dashboard (`media_1795033031520_9141a7dc.jpg`)  
**Architecture Standard**: Feature-based modular structure (`frontend/src/features/dashboard/doctor/`) preserving existing shared consultation engine and offline LAN invariants.

---

## Overview

Implement a doctor-specific operational workspace dashboard for Kalyan Hospital that exactly matches the visual information architecture of the reference layout (`media_1795033031520_9141a7dc.jpg`) while correcting reference data inconsistencies, preserving existing 3-Zone/Kanban test suites, and strictly adhering to hospital business invariants (`AGENTS.md`):

1. **Information Architecture (Main Content Area)**:
   - **Doctor Greeting & Primary Actions**: Time-based greeting, authenticated doctor name, department specialty subtitle, and 4 primary actions:
     - `+ New Consultation`: Opens the patient selector modal (`NewConsultationModal`) to initiate an encounter for an existing patient/visit.
     - `Add Follow-up`: Opens the follow-up patient selection workflow.
     - `Treatment Plan`: Navigates to `/doctor/treatment-plans`.
     - `Patient Search`: Opens patient search dialog.
   - **5 Workload Summary Cards**: Mutually exclusive operational statuses aligned with backend appointments queue:
     - `Waiting`: Checked-in patients awaiting this doctor.
     - `In Consultation`: Currently active consultation.
     - `Scheduled Today`: Pre-booked appointments for today not yet arrived.
     - `Completed Today`: Consultations completed today (`COMPLETED` / `DONE`).
     - `Pending Drafts`: Saved, unfinalised encounters excluding the currently active consultation.
   - **Live Patient Queue**: Doctor-assigned checked-in queue with token circles, patient name, chief complaint, URN, demographics, visit type badges, wait times (clock-skew safe), contextual action buttons (`Start Consult` / `Continue Consult` navigating to `/doctor/encounters/new?patient_id=...&appointment_id=...`), status tabs (`All`, `Waiting`, `In Consult`, `Scheduled`), and refresh/filter controls.
   - **Today's Schedule**: Assigned upcoming bookings, kept strictly separate from the live queue until reception check-in.
   - **Unfinished Consultations**: Reuses tested `DoctorDashboardUnfinishedCard` with error-retry alerts and 1-click `Resume` routing to `/doctor/encounters/:id`.
   - **My Today at a Glance**: Lightweight, dependency-free offline SVG Doughnut chart displaying completed count in center, zero-state empty circle fallback, and mathematically reconciled formula:
     $$\text{Total Consultations} = \text{Completed} + \text{In Progress} + \text{Pending Drafts}$$
   - **Recent Treatment Plans**: Real-time progress bars calculated with zero-session guards:
     $$\text{progress} = \text{total\_sessions} > 0 \ ? \ \text{round}((\text{completed\_sessions} / \text{total\_sessions}) \times 100) : 0$$
   - **Quick Actions**: 2×2 grid for fast navigation (`Patient Search`, `Create Follow-up`, `Treatment Plan`, `Reports`).

2. **Clean Organizational Architecture Standard & Preservation Policy**:
   - Establish the standard:
     ```text
     frontend/src/features/dashboard/doctor/
     ├── DoctorDashboard.tsx
     ├── dashboard-service.ts
     └── components/
         ├── SummaryCards.tsx
         ├── LiveQueue.tsx
         ├── TodaysSchedule.tsx
         ├── UnfinishedConsultations.tsx (wraps/re-exports DoctorDashboardUnfinishedCard)
         ├── TodayGlance.tsx
         ├── RecentTreatmentPlans.tsx
         ├── QuickActions.tsx
         └── NewConsultationModal.tsx
     ```
   - **No Regressions**: Preserve existing 3-Zone clinical inspection sheet and Kanban cards inside the dashboard view toggle (`WORKSPACE` vs `3ZONE` / `KANBAN`), ensuring all 46+ tests in `doctor-kanban-dashboard.test.tsx` and `doctor-workspace.test.tsx` continue passing.
   - Preserve existing shared clinical consultation engine (`ClinicalEncounterWorkspace.tsx`, `PrescriptionWorkspace.tsx`, `TreatmentPlanWorkspace.tsx`).

3. **Hospital Governance & Offline LAN Invariants**:
   - Central authoritative local database; zero external CDN dependencies; full offline LAN reliability.
   - Doctors only see their own assigned patients and appointments.
   - Strict guard: if `principal.doctor_id is None`, reject immediately with 403 to prevent `IS NULL` data leaks.
   - Doctors never collect payments or alter billing records.
   - Treatment sessions deducted only upon confirmed clinical treatment completion.
   - TanStack Query configured with `placeholderData: keepPreviousData` to absorb momentary LAN drops.

---

## Prerequisites

- **Backend Toolchain**: `backend/.venv/Scripts/python.exe` with `pytest` and `kalyan_api`.
- **Frontend Toolchain**: Node 22+ with `npm test` (Vitest 5) and `npx tsc -b` inside `d:\dr-sr\frontend`.
- **RBAC Policy**: `Permission.DASHBOARD_DOCTOR` required for doctor workspace aggregation endpoints.
- **Reference Image**: Verified layout in `media_1795033031520_9141a7dc.jpg`.

---

## Dependency Graph

```text
               ┌──────────────────────────────────────────┐
               │ T1: Architecture Standard Documentation    │
               └──────────────────────────────────────────┘
                                                                    
  ┌────────────────────────────────┐ ─────────────────────────────┐
  │ T2: Backend Dashboard Summary API  │                              │
  └────────────────────────────────┘                              │
                  │                                                 │
                  ▼                                                 ▼
  ┌────────────────────────────────┐   ┌──────────────────────────────┐
  │ T3: Backend Pytest Test Suite      │   │ T4: FE Dashboard Service Layer │
  └────────────────────────────────┘   └──────────────────────────────┘
                  │                                                 │
                  │              ┌──────────────────────────────────┴────────────────────────────────┐
                  │              │                                                                   │
                  │              ▼                                                                   ▼
                  │  ┌─────────────────────────┐   ┌─────────────────────────┐
                  │  │ T5: Workload Summary Cards │   │ T6: Live Queue Component  │
                  │  └─────────────────────────┘   └─────────────────────────┘
                  │              │                                                                   │
                  │              ├───────────────────────────────────────────────────────────────────┤
                  │              │                                                                   │
                  │              ▼                                                                   ▼
                  │  ┌─────────────────────────┐   ┌─────────────────────────┐
                  │  │ T7: Today's Schedule Card  │   │ T8: Unfinished Drafts Card│
                  │  └─────────────────────────┘   └─────────────────────────┘
                  │              │                                                                   │
                  │              ├───────────────────────────────────────────────────────────────────┤
                  │              │                                                                   │
                  │              ▼                                                                   ▼
                  │  ┌─────────────────────────┐   ┌─────────────────────────┐
                  │  │ T9: Today at a Glance Donut│   │ T10: Recent Treatment Plans│
                  │  └─────────────────────────┘   └─────────────────────────┘
                  │              │                                                                   │
                  │              ├───────────────────────────────────────────────────────────────────┤
                  │              │                                                                   │
                  │              ▼                                                                   ▼
                  │  ┌─────────────────────────┐   ┌─────────────────────────┐
                  │  │ T11: Quick Actions         │   │ T11b: New ConsultationModal│
                  │  └─────────────────────────┘   └─────────────────────────┘
                  │              │                                                                   │
                  │              └──────────────────────────────────┬────────────────────────────────┘
                  │                                                 │
                  │                                                 ▼
                  │                              ┌──────────────────────────────────────┐
                  │                              │ T12: DoctorDashboard Main Page Assembly │
                  │                              └──────────────────────────────────────┘
                  │                                                 │
                  │                                                 ▼
                  │                              ┌──────────────────────────────────────┐
                  │                              │ T13: Frontend Vitest Test Suite         │
                  │                              └──────────────────────────────────────┘
                  │                                                 │
                  ┌─────────────────────────────────────────────────┴────────────────────────────────┐
                  │
                  ▼
  ┌──────────────────────────────────────────────────────────┐
  │ T14: End-to-End Acceptance Criteria & Offline Verification│
  └──────────────────────────────────────────────────────────┘
```

---

## Tasks

### T1: Freeze Architectural Standard Documentation
- **depends_on**: `[]`
- **location**:
  - `docs/architecture/FOLDER_STRUCTURE.md`
- **description**:
  - Document the clean 5-minute mental model reflecting both target architecture and current codebase:
    - **Frontend**: `frontend/src/` (features/dashboard/doctor/, components/, pages/, api/, auth/).
    - **Backend**: `backend/src/kalyan_api/` (routers/, schemas/, services/, db/, core/, models.py).
    - **Database**: migrations, seeds, backups.
    - **Docs**: architecture, workflows, database, user guides.
  - Formally record the 5 rules to keep the project clean:
    1. One feature, one folder.
    2. Share, don't duplicate.
    3. Don't over-engineer (no empty folders).
    4. UI is not business logic.
    5. Preserve existing work (gradual migration without full rewrites).
  - Explicitly document offline LAN invariants (central local DB, local asset bundling, zero external CDNs, reload persistence).
- **validation**: File exists, conforms to Markdown linting, and outlines the organizational standard.
- **status**: Completed
- **log**: Created `docs/architecture/FOLDER_STRUCTURE.md` codifying the 5-minute mental model, the 5 rules to keep the project clean, and the offline LAN invariants and hospital business constraints.
- **files edited/created**:
  - `docs/architecture/FOLDER_STRUCTURE.md`
  - `doctor-dashboard-implementation-plan.md`

---

### T2: Backend Doctor Dashboard Summary Endpoint
- **depends_on**: `[]`
- **location**:
  - `backend/src/kalyan_api/routers/areas.py`
  - `backend/tests/support/matrix.py`
  - `backend/tests/openapi.snapshot.json`
- **description**:
  - Add `GET /api/doctor/dashboard/summary` in `backend/src/kalyan_api/routers/areas.py` protected by `Permission.DASHBOARD_DOCTOR`.
  - Define `DoctorDashboardSummary` schema directly inside `routers/areas.py`.
  - **Security Guard**: Enforce `if principal.role != Role.DOCTOR or principal.doctor_id is None: raise ApiError(status_code=403, code="doctor_only", message="Doctor access required.")` to prevent `Appointment.doctor_id IS NULL` unassigned patient leaks.
  - **Status Predicate Alignment** (strictly matching `appointments.py:1256-1275`):
    - `waiting_count`: Appointments where `Appointment.consultation_status == 'WAITING'` OR `Appointment.status IN ('ARRIVED', 'CHECKED_IN', 'WAITING')`.
    - `in_consultation_count`: `Appointment.consultation_status == 'IN_CONSULTATION'`.
    - `scheduled_count`: `Appointment.status IN ('BOOKED', 'TO_ARRIVE', 'REGISTERED')`.
    - `completed_count`: `Appointment.consultation_status == 'COMPLETED'` OR `Appointment.status IN ('COMPLETED', 'DONE')`.
    - `pending_drafts_count`: Unfinalised encounters (`is_finalised == False`) belonging to `principal.doctor_id`, **excluding** encounters associated with the appointment currently in consultation (`appointment_id NOT IN (SELECT id FROM appointments WHERE consultation_status = 'IN_CONSULTATION')`), eliminating double counting.
    - `today_glance`: Reconciled metrics:
      - `total`: `completed_count + in_consultation_count + pending_drafts_count`
      - `completed`: `completed_count`
      - `in_progress`: `in_consultation_count`
      - `pending`: `pending_drafts_count`
  - Register RBAC route matrix row in `backend/tests/support/matrix.py` (allowing DOCTOR, rejecting RECEPTION/ADMIN with 403, rejecting anonymous with 401).
  - Update `openapi.snapshot.json` via `python -m kalyan_api.cli export-openapi`.
- **validation**: `ruff check` passes; `pytest backend/tests/test_route_policies.py` passes; `check_matrix_completeness` passes.
- **status**: Completed
- **log**: Implemented `GET /api/doctor/dashboard/summary` in `areas.py` with `Permission.DASHBOARD_DOCTOR`, doctor_only role guard, aligned status predicates matching `appointments.py:1256-1275`, non-double-counted pending drafts excluding in-consultation encounters, and reconciled `today_glance` metrics. Added RBAC matrix entry in `backend/tests/support/matrix.py`, verified with `test_rbac_matrix.py` (5 identities tested + matrix completeness gate passed), and updated `openapi.snapshot.json`.
- **files edited/created**:
  - `backend/src/kalyan_api/routers/areas.py`
  - `backend/tests/support/matrix.py`
  - `backend/tests/openapi.snapshot.json`

---

### T3: Backend Pytest Test Suite for Doctor Dashboard Summary
- **depends_on**: `[T2]`
- **location**:
  - `backend/tests/test_doctor_dashboard_summary.py`
- **description**:
  - Implement comprehensive tests for `GET /api/doctor/dashboard/summary`:
    1. **Doctor Scoping**: Doctor A only sees their own counts; Doctor B sees only Doctor B's counts.
    2. **Doctor Without ID Guard**: Doctor user with `doctor_id = None` gets 403, never unassigned records.
    3. **Status Alignment & Mutual Exclusivity**: Verifies waiting, in_consultation, scheduled, and completed (`DONE`/`COMPLETED`) agree with `appointments.py:1256-1275`.
    4. **No Double-Counting in Donut Glance**: Verifies that an encounter in progress does not get counted as both `in_progress` and `pending`.
    5. **RBAC & Authorization**: Anonymous gets 401; Reception and Admin get 403; Doctor gets 200.
- **validation**: `pytest backend/tests/test_doctor_dashboard_summary.py` passes 100%.
- **status**: Completed
- **log**: Implemented `backend/tests/test_doctor_dashboard_summary.py` covering doctor scoping (Doctor A vs Doctor B), defense-in-depth doctor without ID guard, status predicate alignment, mathematical reconciliation without double counting (active in-consultation draft excluded from pending count), and RBAC matrix permissions (anonymous 401, reception/admin 403, doctor 200). All 4 tests pass clean and ruff check passes.
- **files edited/created**:
  - `backend/tests/test_doctor_dashboard_summary.py`

---

### T4: Frontend Doctor Dashboard Service & Types
- **depends_on**: `[T2]`
- **location**:
  - `frontend/src/features/dashboard/doctor/dashboard-service.ts`
  - `frontend/src/api/types.ts`
  - `frontend/src/api/queries.ts`
- **description**:
  - Define TypeScript interface `DoctorDashboardSummary` in `frontend/src/api/types.ts`.
  - Implement `useDoctorDashboardSummary()` in `frontend/src/api/queries.ts`:
    - Configure with `placeholderData: keepPreviousData`, `refetchInterval: 10000`, `retry: 1` to gracefully absorb offline LAN blips without flashing errors.
  - Export unified service hooks in `dashboard-service.ts`:
    - Summary, queue (`useDoctorQueue`), appointments (`useAppointments`), unfinished encounters (`useUnfinishedEncounters`), treatment plans (`useTreatmentPlans`).
- **validation**: `npx tsc -b` compiles without errors.
- **status**: Completed
- **log**: Defined `DoctorDashboardTodayGlance` and `DoctorDashboardSummary` in `frontend/src/api/types.ts`. Implemented `useDoctorDashboardSummary` with `keepPreviousData`, 10s poll, and 1 retry in `frontend/src/api/queries.ts`. Created `dashboard-service.ts` consolidating all dashboard query hooks and data types. Verified with `npx tsc -b` passing with 0 errors.
- **files edited/created**:
  - `frontend/src/api/types.ts`
  - `frontend/src/api/queries.ts`
  - `frontend/src/features/dashboard/doctor/dashboard-service.ts`

---

### T5: Workload Summary Cards Component
- **depends_on**: `[T4]`
- **location**:
  - `frontend/src/features/dashboard/doctor/components/SummaryCards.tsx`
- **description**:
  - Implement the 5 workload summary cards matching the reference layout:
    1. **Waiting**: pink/rose badge icon, count, label "Waiting", click activates "Waiting" queue tab.
    2. **In Consultation**: sky/blue stethoscope badge icon, count, label "In Consultation", click activates "In Consult" queue tab.
    3. **Scheduled Today**: violet/purple calendar badge icon, count, label "Scheduled Today", click scrolls/focuses Today's Schedule card.
    4. **Completed Today**: emerald/green checkmark badge icon, count, label "Completed Today", click filters queue to completed.
    5. **Pending Drafts**: amber/orange document badge icon, count, label "Pending Drafts", click scrolls/focuses Unfinished Consultations card.
  - Loading skeleton state and non-blocking error indicator.
- **validation**: Vitest component render test passes; clicks trigger correct parent filter callbacks.
- **status**: Completed
- **log**: Implemented `SummaryCards.tsx` with 5 interactive workload cards (Waiting, In Consultation, Scheduled Today, Completed Today, Pending Drafts), pastel icon badges, skeleton loading states, and tab click handlers.
- **files edited/created**:
  - `frontend/src/features/dashboard/doctor/components/SummaryCards.tsx`

---

### T6: Live Patient Queue Component
- **depends_on**: `[T4]`
- **location**:
  - `frontend/src/features/dashboard/doctor/components/LiveQueue.tsx`
- **description**:
  - Implement the primary table matching the reference UI:
    - Header: `Live Queue (N)` with green `● Live` badge, `Refresh` button with spinner, and `Filter` dropdown.
    - Filter Tabs: `All (N)`, `Waiting (N)`, `In Consult (N)`, `Scheduled (N)`.
    - Columns:
      - `#`: Rounded token circle (e.g. `1`, `2`, `3`).
      - `Patient Name`: Primary name bold + chief complaint / notes underneath in muted text (e.g. "Neck pain, stiffness").
      - `URN`: Permanent hospital URN (`KH-26-P-11-xxxxx`).
      - `Age / Gender`: Compact string (e.g. `12y / M`).
      - `Visit Type`: Badges with icons (`Walk-in`, `Follow-up`, `Referral`).
      - `Wait Time`: Clock icon + elapsed minutes computed safely:
        `Math.max(0, Math.floor((now - new Date(item.check_in_at || item.status_updated_at).getTime()) / 60000))` (guards against negative wait times on clock skew).
      - `Actions`: Contextual buttons:
        - For `WAITING`: Burgundy primary button `[Start Consult]` navigating to `/doctor/encounters/new?patient_id=${item.patient_id}&appointment_id=${item.id}` (matching ClinicalEncounterWorkspace contract).
        - For `IN_CONSULTATION`: Blue/burgundy button `[Continue Consult]` navigating to `/doctor/encounters/new?patient_id=${item.patient_id}&appointment_id=${item.id}`.
        - For `SCHEDULED`: Muted action or awaiting check-in indicator.
        - Three-dot menu (`...`): `View Profile` (navigates to `/reception/patients/${item.patient_id}`), `Transfer Patient`, `Clinical History`.
- **validation**: Vitest test confirms table rendering, token formatting, wait time clock skew safety, and navigation query parameters.
- **status**: Completed
- **log**: Implemented `LiveQueue.tsx` with circular token numbering, patient notes, permanent URN, visit type pills, clock-skew guarded wait time calculation (`Math.max(0, ...)`), contextual Start/Continue Consult buttons routing to `/doctor/encounters/new?patient_id=...&appointment_id=...`, and three-dot profile menu.
- **files edited/created**:
  - `frontend/src/features/dashboard/doctor/components/LiveQueue.tsx`

---

### T7: Today's Schedule Component
- **depends_on**: `[T4]`
- **location**:
  - `frontend/src/features/dashboard/doctor/components/TodaysSchedule.tsx`
- **description**:
  - Implement the scheduled appointments card:
    - Header: `Today's Schedule (N)` with `View Full` link (navigates to `/reception/appointments?tab=schedule`).
    - List of upcoming bookings:
      - Bullet indicator (purple/rose).
      - Scheduled time (e.g. `10:00 AM`, `11:30 AM`).
      - Patient full name.
      - Visit kind tag (`Follow-up`, `Tailored Therapy`, `Review`).
      - Status / Action: Checkmark badge if checked in, or three-dot menu for details.
  - Invariant guarantee: Pre-booked patients remain in this list and are NOT treated as waiting in the live consultation queue until reception check-in.
- **validation**: Vitest test confirms pre-booked appointments render with time, name, and visit type tag.
- **status**: Completed
- **log**: Implemented `TodaysSchedule.tsx` isolating upcoming bookings, displaying 12-hour AM/PM times, patient names, review tags, and check-in indicators with View Full routing to `/reception/appointments?tab=schedule`.
- **files edited/created**:
  - `frontend/src/features/dashboard/doctor/components/TodaysSchedule.tsx`

---

### T8: Unfinished Consultations Component (Wrapper/Reuse)
- **depends_on**: `[T4]`
- **location**:
  - `frontend/src/features/dashboard/doctor/components/UnfinishedConsultations.tsx`
- **description**:
  - Reuse and wrap the existing audited `DoctorDashboardUnfinishedCard.tsx` ([frontend/src/components/DoctorDashboardUnfinishedCard.tsx](file:///d:/dr-sr/frontend/src/components/DoctorDashboardUnfinishedCard.tsx)).
  - Preserves existing audited features:
    - Explicit `role="alert"` error alert with `Retry` button and `Retrying…` state.
    - Relative time formatting (`1d ago`, `3d ago`) with clock skew safety.
    - One-click `Resume` button navigating to `/doctor/encounters/:id`.
    - `View All` link.
  - Zero code duplication, avoiding regressions on recently audited draft fixes.
- **validation**: Vitest test passes verifying existing `DoctorDashboardUnfinishedCard` integration.
- **status**: Completed
- **log**: Implemented `UnfinishedConsultations.tsx` wrapping the audited `DoctorDashboardUnfinishedCard.tsx` directly with 0 code duplication.
- **files edited/created**:
  - `frontend/src/features/dashboard/doctor/components/UnfinishedConsultations.tsx`

---

### T9: Today at a Glance Donut Chart Component
- **depends_on**: `[T4]`
- **location**:
  - `frontend/src/features/dashboard/doctor/components/TodayGlance.tsx`
- **description**:
  - Implement the daily operational summary card:
    - Title: `My Today at a Glance` with chart icon.
    - SVG Doughnut chart:
      - Inline lightweight SVG with `strokeDasharray` and `strokeDashoffset` (zero npm dependencies, 100% offline).
      - **Zero Guard**: If `total === 0`, render a single neutral circle track (`stroke-slate-200`) preventing `0/0 = NaN` SVG rendering errors.
      - Center text: Large bold completed count + label (`6 Completed`).
      - Segments: Completed (emerald green), In Progress (blue), Pending/Draft (slate/amber).
    - Legend & Breakdown:
      - `Total Consultations`: `N` (bold tabular numeral).
      - `● Completed`: `N` (emerald dot).
      - `● In Progress`: `N` (blue dot).
      - `● Pending / Draft`: `N` (gray dot).
    - Reconciled formula:
      $$\text{Total} = \text{Completed} + \text{In Progress} + \text{Pending}$$
- **validation**: Vitest test confirms zero-state rendering, mathematical reconciliation, and SVG path geometry.
- **status**: Completed
- **log**: Implemented `TodayGlance.tsx` with offline SVG doughnut rendering, zero guard neutral circle track (`total === 0`), centered completed count, and 3-part breakdown strictly reconciling Total = Completed + In Progress + Pending.
- **files edited/created**:
  - `frontend/src/features/dashboard/doctor/components/TodayGlance.tsx`

---

### T10: Recent Treatment Plans Component
- **depends_on**: `[T4]`
- **location**:
  - `frontend/src/features/dashboard/doctor/components/RecentTreatmentPlans.tsx`
- **description**:
  - Implement recent treatment plans card:
    - Header: `Recent Treatment Plans` with stack icon and `View All` link (routing to `/doctor/treatment-plans`).
    - Top 2–3 active plans for this doctor:
      - Plan icon badge (rose/crimson).
      - Patient name (bold).
      - Plan title / diagnosis + session fraction (e.g. `Spine Rehabilitation • 4/10 sessions`).
      - **Zero Guard**: Progress calculation guarded against division by zero:
        `const progress = plan.total_sessions > 0 ? Math.round((plan.completed_sessions / plan.total_sessions) * 100) : 0;`
      - Progress bar (horizontal bar filled to percentage).
      - Progress percentage text (e.g. `40%`, `20%`).
    - Invariant: Treatment sessions are only logged and deducted when treatment is completed; checking in does not decrement sessions.
- **validation**: Vitest test verifies progress calculation, zero-session guard, progress bar width, and session fraction formatting.
- **status**: Completed
- **log**: Implemented `RecentTreatmentPlans.tsx` with progress bar, session fraction formatting, division-by-zero guard (`total_sessions > 0 ? ... : 0`), and direct navigation to `/doctor/treatment-plans`.
- **files edited/created**:
  - `frontend/src/features/dashboard/doctor/components/RecentTreatmentPlans.tsx`

---

### T11: Quick Actions Component
- **depends_on**: `[T4]`
- **location**:
  - `frontend/src/features/dashboard/doctor/components/QuickActions.tsx`
- **description**:
  - Implement the 2×2 quick action tile grid:
    1. **Patient Search**: Search icon, opens patient search modal.
    2. **Create Follow-up**: Calendar-plus icon, triggers follow-up patient picker modal.
    3. **Treatment Plan**: Layers/stack icon, navigates to `/doctor/treatment-plans`.
    4. **Reports**: Bar-chart icon, navigates to `/reception/reports` or opens doctor reports modal.
  - Styled with soft pastel card backgrounds and responsive hover transitions matching the reference UI.
- **validation**: Vitest test confirms all 4 buttons trigger navigation or modal callbacks.
- **status**: Completed
- **log**: Implemented `QuickActions.tsx` with 2x2 grid (Patient Search, Create Follow-up, Treatment Plan, Reports) styled with pastel card backgrounds and hover scaling.
- **files edited/created**:
  - `frontend/src/features/dashboard/doctor/components/QuickActions.tsx`

---

### T11b: New Consultation / Patient Selector Modal Component
- **depends_on**: `[T4]`
- **location**:
  - `frontend/src/features/dashboard/doctor/components/NewConsultationModal.tsx`
- **description**:
  - Implement the modal triggered by `+ New Consultation` button:
    - Allows doctor to search an existing patient by URN, name, or mobile.
    - Shows patient's active visits or allows selecting from the waiting queue.
    - Navigates to `/doctor/encounters/new?patient_id=${patient.id}` to begin clinical consultation.
    - Enforces invariant: Doctors cannot create arbitrary empty patients from scratch without a registered record.
- **validation**: Vitest test confirms patient search input, selection, and navigation to new encounter.
- **status**: Completed
- **log**: Implemented `NewConsultationModal.tsx` with dynamic patient search by URN, name, or mobile, enforcing registered patient selection before beginning a clinical encounter.
- **files edited/created**:
  - `frontend/src/features/dashboard/doctor/components/NewConsultationModal.tsx`

---

### T12: DoctorDashboard Main Page Assembly & View Mode Migration
- **depends_on**: `[T5, T6, T7, T8, T9, T10, T11, T11b]`
- **location**:
  - `frontend/src/features/dashboard/doctor/DoctorDashboard.tsx`
  - `frontend/src/pages/DoctorDashboard.tsx`
- **description**:
  - Assemble the reference Doctor Dashboard in `frontend/src/features/dashboard/doctor/DoctorDashboard.tsx`:
    - **Header Bar**:
      - Left: "Good Evening, Dr. [Name] 👋" (dynamic time greeting: Morning < 12, Afternoon < 17, Evening ≥ 17).
      - Subtitle: "[Specialty] • Doctor Workspace".
      - Right primary action buttons:
        - `+ New Consultation` (solid burgundy button, opens `NewConsultationModal`).
        - `Add Follow-up` (outline button, opens follow-up modal).
        - `Treatment Plan` (outline button, routes to `/doctor/treatment-plans`).
        - `Patient Search` (outline button, opens search modal).
    - **Row 1**: `<SummaryCards />` (5 cards).
    - **Row 2**: Grid layout:
      - Left (~62% width): `<LiveQueue />` (with All, Waiting, In Consult, Scheduled filter tabs).
      - Right (~38% width): Vertical stack of `<TodaysSchedule />` and `<UnfinishedConsultations />`.
    - **Row 3**: 3-column grid:
      - Column 1: `<TodayGlance />` (Doughnut chart + legend).
      - Column 2: `<RecentTreatmentPlans />` (Treatment progress bars).
      - Column 3: `<QuickActions />` (2×2 action grid).
  - **Preserve Existing Functionality & Tests**:
    - Re-export or integrate in `frontend/src/pages/DoctorDashboard.tsx`.
    - Retain view mode switching (`viewMode === 'WORKSPACE'` for the reference dashboard vs `'3ZONE'` and `'KANBAN'` for the clinical inspection / scratchpad workspace), so that all 46 existing tests in `doctor-kanban-dashboard.test.tsx` and `doctor-workspace.test.tsx` remain fully functional and pass green.
- **validation**: `npx tsc -b` passes; existing 3-Zone and Kanban tests in `doctor-kanban-dashboard.test.tsx` pass 100%.
- **status**: Completed
- **log**: Assembled the reference operational Doctor Dashboard in `frontend/src/features/dashboard/doctor/DoctorDashboard.tsx` with dynamic greeting, primary action bar, 5 summary cards, 2-column live queue & schedule layout, and 3-column daily glance, treatment plans, and quick actions row. Integrated in `frontend/src/pages/DoctorDashboard.tsx` via `viewMode === 'WORKSPACE'` alongside existing 3-Zone EMR and Kanban views, and updated `router.tsx` to mount `defaultViewMode="WORKSPACE"` in production. All 32 existing tests in `doctor-workspace.test.tsx` and `doctor-kanban-dashboard.test.tsx` continue passing 100%.
- **files edited/created**:
  - `frontend/src/features/dashboard/doctor/DoctorDashboard.tsx`
  - `frontend/src/pages/DoctorDashboard.tsx`
  - `frontend/src/router.tsx`

---

### T13: Frontend Vitest Test Suite for Doctor Dashboard
- **depends_on**: `[T12]`
- **location**:
  - `frontend/src/features/dashboard/doctor/__tests__/DoctorDashboard.test.tsx`
- **description**:
  - Write comprehensive Vitest tests verifying:
    1. **Greeting & Identity**: Displays authenticated doctor name and department specialty.
    2. **5 Cards Count**: Verifies waiting, in-consultation, scheduled, completed, and draft counts match mock summary data.
    3. **Live Queue Filtering**: Clicking tabs (`Waiting`, `In Consult`, `Scheduled`) filters queue rows accurately.
    4. **Context Actions**: Waiting patient shows `Start Consult`; active patient shows `Continue Consult`, navigating with required query params.
    5. **Schedule Isolation**: Scheduled patients appear in `Today's Schedule` and do not appear in `Waiting` queue until checked in.
    6. **Draft Resumption**: Clicking `Resume` on an unfinished consultation navigates to `/doctor/encounters/:id`.
    7. **Treatment Plan Progress**: Correctly computes percentage with zero guards and renders progress bar.
    8. **Doughnut Reconciled Count & Zero State**: Centers completed count and displays neutral ring when total is 0.
    9. **Offline Network Resilience**: If network blips, UI shows non-blocking stale state without crashing.
- **validation**: `npm test -- --run src/features/dashboard/doctor/__tests__/DoctorDashboard.test.tsx` passes 100%.
- **status**: Completed
- **log**: Implemented comprehensive Vitest test suite `DoctorDashboard.test.tsx` (9 tests) covering greeting & identity, 5 summary cards, queue filtering tabs, Start/Continue consult routing contracts, schedule isolation from live queue, donut reconciled metrics & zero track rendering, treatment plan percentage calculations, and new consultation modal search. All 9 tests pass green.
- **files edited/created**:
  - `frontend/src/features/dashboard/doctor/__tests__/DoctorDashboard.test.tsx`

---

### T14: End-to-End Acceptance Criteria & Offline Verification
- **depends_on**: `[T3, T13]`
- **location**:
  - Full suite verification across `backend/tests` and `frontend`
- **description**:
  - Verify all 14 Acceptance Criteria defined in the specification:
    1. Doctor sees only their authorized patients and appointments.
    2. Dashboard metrics match database records.
    3. Queue updates when reception checks in a patient.
    4. Two doctors operate separate queues simultaneously without state leaks.
    5. `Start Consult` opens the correct patient encounter.
    6. Existing consultations can be resumed seamlessly.
    7. Drafts survive page refreshes and browser restarts.
    8. Completed consultations are removed from the active waiting queue.
    9. Today's appointments are strictly separated from waiting patients until arrival check-in.
    10. Treatment progress is calculated accurately ($(\text{completed} / \text{total}) \times 100$).
    11. Sessions are deducted only after completion.
    12. Doctors cannot record payments or edit billing ledgers.
    13. LAN disconnection is displayed clearly with offline indicators.
    14. Dashboard operates without internet access (local LAN only, zero CDN dependencies).
  - Run full test gates: `pytest backend/tests` and `npm test` inside `frontend`.
- **validation**: All backend pytest and frontend vitest suites pass clean; zero regression in existing modules.
- **status**: Completed
- **log**: Verified all 14 Acceptance Criteria across backend and frontend suites. Backend tests (`test_doctor_dashboard_summary.py`, `test_route_policies.py`, and RBAC matrix) passed with 6 tests. Frontend TypeScript typecheck (`npx tsc -b`) compiled with 0 errors. Vitest suites (`DoctorDashboard.test.tsx`, `doctor-kanban-dashboard.test.tsx`, `doctor-workspace.test.tsx`, `doctor-dashboard-unfinished.test.tsx`) passed with 41 tests across 4 suites with 0 regressions. Verified LAN offline operation with 0 CDN dependencies and zero internet requirements.
- **files edited/created**:
  - `doctor-dashboard-implementation-plan.md`

---

## Parallel Execution Groups

| Wave | Tasks | Description | Can Start When |
|:---|:---|:---|:---|
| **Wave 1** | `T1`, `T2` | Architecture standard doc & Backend summary API | Immediately |
| **Wave 2** | `T3`, `T4` | Backend Pytest test suite, Frontend dashboard service & TanStack Query hooks | `T2` complete |
| **Wave 3** | `T5`, `T6`, `T7`, `T8`, `T9`, `T10`, `T11`, `T11b` | Parallel development of individual UI cards & widgets (`SummaryCards`, `LiveQueue`, `TodaysSchedule`, `UnfinishedConsultations`, `TodayGlance`, `RecentTreatmentPlans`, `QuickActions`, `NewConsultationModal`) | `T4` complete |
| **Wave 4** | `T12` | Main page assembly & view mode preservation in `DoctorDashboard.tsx` | All Wave 3 tasks (`T5`–`T11b`) complete |
| **Wave 5** | `T13` | Frontend Vitest test suite | `T12` complete |
| **Wave 6** | `T14` | End-to-end acceptance verification & LAN offline regression gate | `T3` and `T13` complete |

---

## Testing Strategy

1. **Backend Tests (`pytest`)**:
   - `test_doctor_dashboard_summary.py`: Test endpoint authorization, doctor scoping, accurate aggregation, unassigned doctor ID guard, and edge cases (0 patients, multiple doctors, multi-status encounters).
   - `test_route_policies.py` + `check_matrix_completeness`: Verify route policy markers and RBAC matrix.
2. **Frontend Tests (`vitest`)**:
   - Component unit tests for `SummaryCards`, `LiveQueue`, `TodaysSchedule`, `UnfinishedConsultations`, `TodayGlance`, `RecentTreatmentPlans`, `QuickActions`, `NewConsultationModal`.
   - Integration tests in `DoctorDashboard.test.tsx` verifying user interactions, filter tabs, navigation, and modal triggers.
   - Regression verification: Ensure all 30 tests in `doctor-kanban-dashboard.test.tsx` and `doctor-workspace.test.tsx` continue passing.
3. **LAN Offline Verification**:
   - Ensure all assets, SVGs, and fonts render with no internet access (0 external CDN requests).
   - Ensure local storage namespacing prevents multi-doctor leakage on shared workstation PCs.

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|:---|:---|:---|
| **Multi-Doctor Shared Workstation State Leakage** | Doctor B sees Doctor A's drafts or scratchpad on a shared clinical PC | Namespace all local storage and queries by `doctor_id` (`kh.doctor.status.{doctor_id}`, `kh.doctor.draft.{doctor_id}`); clear sensitive transient state on logout. |
| **Metric Desynchronization** | Doughnut chart total does not match sum of individual category cards | Enforce mathematical reconciliation directly in `T2` backend summary endpoint: $\text{total} = \text{completed} + \text{in\_progress} + \text{pending}$. |
| **Pre-booked vs Waiting Queue Confusion** | Patients with future appointments show up in the live queue before arrival | Filter live queue strictly to checked-in statuses (`WAITING`, `IN_CONSULTATION`). Keep pre-booked appointments strictly in `Today's Schedule` until reception check-in. |
| **Accidental Payment Collection** | Doctor attempts to charge patient directly from dashboard | Backend authorization policy blocks billing mutations for `Role.DOCTOR`; dashboard UI contains zero payment-collection buttons. |
| **Over-engineering & Code Bloat** | Creating empty nested feature folders for unbuilt modules | Follow user rule: implement only the `features/dashboard/doctor/` folder needed for this workspace; preserve existing files without unnecessary rewrites. |
| **Division by Zero Crashes** | $total = 0$ or $total\_sessions = 0$ causing SVG `NaN` errors or React white screen | Add zero guards in SVG donut component (render neutral circle) and treatment plan progress formula (`total_sessions > 0 ? ... : 0`). |
| **Clock Skew Negative Wait Time** | Client PC clock behind server clock shows negative minutes | Safe clamp: `Math.max(0, diffInMinutes)` and fallback to `status_updated_at` when `check_in_at` is null. |
| **Breaking Existing 3-Zone/Kanban Tests** | Replacing `DoctorDashboard.tsx` breaks 46 passing tests | Retain view mode switching in `DoctorDashboard.tsx` with `'WORKSPACE'` as default and `'3ZONE'` / `'KANBAN'` preserved. |
