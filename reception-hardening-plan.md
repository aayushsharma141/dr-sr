# Plan: Reception Module End-to-End Hardening & Audit Remediation

**Generated**: 2026-11-17

## Overview

Remediate every finding from the 5-module `/review-swarm` audit (`3d2e1647..HEAD`) across Dashboard, Check-in & Token, Appointments, Waiting Room, Billing & Checkout, and their supporting backend endpoints/query layer — closing RBAC gaps, cross-patient billing risks, cross-tab count/cache drift, 403/422 UI mismatches, polling/midnight bugs, and Priority 3 visual/responsive polish.

### Confirmed Product Decisions

- **A1 (Dashboard First KPI Card)**: Count **Active Visits Today** (`allAppointments.filter((a) => !isCancelledOrClosed(a))`, excluding `CANCELLED`, `RESCHEDULED`, `NO_SHOW`, and `consultation_status === 'CANCELLED'` → `"Walk-in + booked"`), linking to `/reception/appointments` so it matches `Booked + Waiting + In Cabin + Completed`.
- **A2 (`Referred by` / `OD-22-16` on Check-in & Token)**: Restore a compact collapsible **`Referred by`** control in `TokenGenerationPage` (defaults to `SELF` / `null`, expands cleanly on demand, explicit `<label htmlFor>` + `id` for UX-06) so Admin Referral Reports continue capturing referral sources.
- **A3 (Remaining Desk Shortcuts)**: Remove the duplicate `Check-in & Token` header link from `AppointmentsReception`, while keeping `TodayAppointmentsPanel`'s compact `More` menu (`No-show`, `Reschedule`, `Cancel`, `Change priority`) with aligned `>= 3`-char validation and exact backend permission gates.
- **A4 (Pending `/opd-arrivals` on Dashboard)**: Fetch `useOpdArrivals(todayStr)` on `ReceptionDashboard` and surface unregistered `TO_ARRIVE` tokens in `Needs Attention` (linking to `/reception/tokens`) so Check-in's `To Arrive` count and Dashboard alerts agree.

### Architecture & Governance Constraints (`AGENTS.md`)

- Preserve all 15 Hospital Business Invariants, `OD-22-19` (reception cannot call/start/complete doctor consultations), `BR-013` cancel, `ADMIN` read-only ledger oversight, `get_admin_overview` contract (`test_admin_overview.py:272`), and existing maroon-and-white visual identity.
- Single file owner per task — zero overlapping file edits across any parallel wave.
- Backend tests run strictly against isolated test fixtures (`pytest`); never touch production SQLite DB or real patient data.
- Frontend UX-04 / UX-06 / IST Date Guards (`frontend/src/test/guards/guards.test.ts`, cap = 0): minimum `text-xs` (`12px`), no `text-slate-300/400` or `text-neutral-300/400`, no `text-red-500`/`text-emerald-600`/`text-amber-600`/`text-teal-600` (use `-700`/`-800`), accessible labels on every `<input>`, `<select>`, `<textarea>`, and never call `new Date().toISOString().(split|slice)`.
- Strict TypeScript (`noUnusedLocals`, `noUnusedParameters`) and `oxlint` 0 warnings / 0 errors.

## Prerequisites

- Node.js `>=22.22.2` (`frontend/node_modules` installed)
- Python virtualenv for backend `pytest`
- Current branch `fix/sidebar-daily-flow` at commit `bc2faf97`

## Dependency Graph

```
T0 (Git Checkpoint) ──┬── T1 (Backend: RBAC + matrix, Dues, Next-Token, Mobile Dup) ──┬── T4 (Dashboard) ──────────────┐
                      ├── T2 (Shared Query Invalidation & Query Options) ─────────────┼── T5 (Check-in & Panel) ───────┤
                      └── T3 (Shared StatusBadge/Helpers + DeskTabs/Receipts Admin) ──┼── T6 (Appointments & Modal) ───┼── T9 (Full Verification Gate)
                                                                                      ├── T7 (Waiting Room) ───────────┤
                                                                                      └── T8 (Billing & Checkout) ─────┘
```

*(Wave 1 runs `T1`, `T2`, `T3` in parallel with zero file overlap; Wave 2 runs `T4`, `T5`, `T6`, `T7`, `T8` in parallel with zero file overlap; Wave 3 runs full backend + frontend verification.)*

## Tasks

### T0: Record Pre-Batch Git Checkpoint

- **depends_on**: []
- **location**: Repository Git state (no source edits)
- **description**:
  - Inspect `git status --short` on all target backend and frontend files.
  - Pin a non-destructive checkpoint ref via:

    ```powershell
    $sha = git stash create "checkpoint: pre reception hardening"
    if (-not $sha) { $sha = git rev-parse HEAD }
    git update-ref refs/checkpoints/pre-reception-hardening $sha
    ```

- **validation**:
  - `git rev-parse refs/checkpoints/pre-reception-hardening` resolves cleanly without modifying the working tree.
- **status**: Completed
- **log**: Pinned pre-batch checkpoint `refs/checkpoints/pre-reception-hardening` at `7eef8fbee81eaa18baef3f00d53f6d96e736cd68`. Verified `backend\.venv\Scripts\pytest.exe`.
- **files edited/created**: None (Git ref only)

---

### T1: Backend Security (`POST /appointments` doctor silo), Overview Dues/Priority & Mobile Duplicate Check

- **depends_on**: [T0]
- **location**:
  - `backend/src/kalyan_api/routers/appointments.py`
  - `backend/src/kalyan_api/routers/areas.py`
  - `backend/src/kalyan_api/routers/patients.py`
  - `backend/tests/support/matrix.py`
  - `backend/tests/test_appointment_booking.py`
  - `backend/tests/test_reception_overview.py`
  - `backend/tests/test_patient_registration.py`
- **description**:
  - **Doctor-silo RBAC on `POST /appointments`** (`appointments.py:196-235` + `matrix.py:1239-1250`):
    - Before calling `booking_service.create_booking`, enforce: if `principal.role == Role.DOCTOR and (principal.doctor_id is None or payload.doctor_id != principal.doctor_id)`, raise `ApiError(status_code=403, code="scope_forbidden", message="Doctors can only book appointments for themselves.")`.
    - Update `backend/tests/support/matrix.py:1239-1250` (`POST /api/appointments` `"doctor_b"` expected status `201` -> `403`, since `test_rbac_matrix.py:251-265` targets `doc_a_id` as `doctor_b`).
    - Add regression tests in `test_appointment_booking.py` verifying a doctor cannot book into another doctor's queue (403 `scope_forbidden`) while Reception and self-booking still succeed.
  - **Reception Overview Dues & Priority-Ordered Next Token** (`areas.py:266-321, 835-895`):
    - **Do NOT touch `get_admin_overview` (`areas.py:511-513`)** — `test_admin_overview.py:272` asserts admin overview equals `/api/billing/pending-dues`.
    - In `get_reception_overview` (`areas.py:879-881`) and `_reception_alerts` (`areas.py:835-848`), include `billing_service.compute_visit_dues(session)` alongside `billing_service.compute_pending_dues(session)` so `outstanding_dues_paise` sums both package dues and closed-visit dues (`balance_paise > 0`), and `pending_dues` alert counts both.
    - In `_doctors_today` (`areas.py:284-299`), filter waiting candidates with `Appointment.token_number.is_not(None)` and active waiting state (`consultation_status == 'WAITING'` or `consultation_status.is_(None)` excluding `IN_CONSULTATION`/`COMPLETED`/`CANCELLED`), and order `next_token` by OD-22-07 suggested order matching `_suggested_order_key` in `appointments.py:78-84` (`EMERGENCY` -> `PRIORITY` -> `NORMAL`, then `Appointment.priority_updated_at` / `status_updated_at` with NULLs last, then `Appointment.token_number ASC`). *(ORM column is `priority_updated_at`, NOT `classified_at`, and SQLite sorts NULL first unless guarded!)*
    - Keep `registrations_today` intact on `ReceptionOverviewResponse`.
    - Add tests in `test_reception_overview.py` covering closed-visit dues in `outstanding_dues_paise`/`alerts` and `EMERGENCY` token precedence in `doctors_today.next_token`.
  - **Mobile-based Duplicate Detection** (`patients.py:91-118`):
    - In `GET /patients/check-duplicate`, keep the exact normalized `full_name` + cleaned `mobile` match first; if no exact match and `len(clean_phone) >= 10`, fall back to matching an active `Patient` on the last 10 digits (`Patient.mobile.like(f"%{clean_phone[-10:]}")`, ordered by `Patient.id.asc()`).
    - Add a test in `test_patient_registration.py` confirming a variant/shortened name with the same 10-digit mobile triggers `has_duplicate: True`.
- **validation**:
  - `pytest backend/tests/test_appointment_booking.py backend/tests/test_rbac_matrix.py backend/tests/test_reception_overview.py backend/tests/test_patient_registration.py backend/tests/test_admin_overview.py` passes 100% (TDD RED -> GREEN).
- **status**: Completed
- **log**: Enforced doctor-silo RBAC (`403 scope_forbidden`) on `POST /appointments`, updated `matrix.py` (`doctor_b: 403` + pre-existing `POST /api/opd-arrivals/{arrival_id}/cancel` row), included closed-visit dues in `get_reception_overview` & `_reception_alerts` (left `get_admin_overview` untouched), ordered `_doctors_today` `next_token` by OD-22-07 `priority_updated_at` (NULL-safe), and added 10-digit mobile fallback in `/patients/check-duplicate`. TDD RED (6 failed) -> GREEN (882 passed, 0 failed). Committed at `a2fac5c9`.
- **files edited/created**: `backend/src/kalyan_api/routers/appointments.py`, `backend/src/kalyan_api/routers/areas.py`, `backend/src/kalyan_api/routers/patients.py`, `backend/tests/support/matrix.py`, `backend/tests/test_appointment_booking.py`, `backend/tests/test_reception_overview.py`, `backend/tests/test_patient_registration.py`

---

### T2: Shared Frontend Query Cache Invalidation, Polling & Gated Fetch Options (`queries.ts`)

- **depends_on**: [T0]
- **location**:
  - `frontend/src/api/queries.ts`
- **description**:
  - Read all affected hooks in `frontend/src/api/queries.ts` first.
  - **Cross-tab cache invalidations**:
    - Add `qc.invalidateQueries({ queryKey: ['overview', 'reception'] })` to `useCreateOpdArrival`, `useUpdateOpdArrivalPriority`, `useCancelOpdArrival`, `useBookAppointment`, `useWalkIn`, `useRescheduleAppointment`, `useCheckInNewPatient`, `useReassignAppointment`, `useUpdatePriority`, `useCheckIn`, `useUpdateAppointmentStatus`, `useCloseVisit`, and `useReversePayment`.
    - Add `qc.invalidateQueries({ queryKey: ['visits'] })` and `qc.invalidateQueries({ queryKey: ['visit-bill'] })` to `useUpdateAppointmentStatus`, `useReassignAppointment`, and `useReversePayment`.
    - In `useRescheduleAppointment`, capture `( _, vars )` in `onSuccess` to invalidate `['appointment', vars.id]` and `['doctor-queue']`.
  - **Backward-compatible optional `options` parameters**:
    - `useDoctors(activeOnly = false, options?: { enabled?: boolean })`
    - `useFees(activeOnly = false, options?: { enabled?: boolean })`
    - `usePatients(q = '', limit = 20, offset = 0, options?: { enabled?: boolean })`
    - `usePendingDues(options?: { enabled?: boolean })`
    - `useVisitDues(options?: { enabled?: boolean })`
    - `useVisits(filter: VisitListFilter = {}, options?: { enabled?: boolean; refetchInterval?: number | false })`
    - `useVisit(id: number | null | undefined, options?: { enabled?: boolean; refetchInterval?: number | false | ((query: { state: { data?: VisitDetail } }) => number | false) })` *(callback form avoids TDZ when callers poll only while `status === 'OPEN'`; preserve `enabled: Boolean(id && id > 0) && (options?.enabled ?? true)`).*
- **validation**:
  - `reason_not_testable`: Shared hook signatures and invalidation behaviors are exercised by Wave 2 suites (`T4`–`T8`) and verified by repo-wide `tsc -b` right after Wave 1 joins.
  - Lint from `frontend/`: `.\node_modules\.bin\oxlint.cmd src/api/queries.ts` exits `0`.
- **status**: Completed
- **log**: Added `['overview', 'reception']`, `['visits']`, `['visit-bill']`, `['appointment', vars.id]`, and `['doctor-queue']` invalidations across Reception mutations; added backward-compatible `options` (`enabled`, callback-typed `refetchInterval`) on `useDoctors`, `useFees`, `usePatients`, `usePendingDues`, `useVisitDues`, `useVisits`, and `useVisit`. `oxlint` 0 warnings/errors, `tsc -b` exit 0. Committed at `6d04ed6d`.
- **files edited/created**: `frontend/src/api/queries.ts`

---

### T3: Shared Reception Status Badge / Helpers + Admin 403 Tab Fix (`ReceptionDeskTabs` & `ReceiptsPage`)

- **depends_on**: [T0]
- **location**:
  - `frontend/src/components/reception/AppointmentStatusBadge.tsx` *(new)*
  - `frontend/src/components/reception/__tests__/appointment-status-badge.test.tsx` *(new)*
  - `frontend/src/components/billing/ReceptionDeskTabs.tsx`
  - `frontend/src/pages/ReceiptsPage.tsx`
- **description**:
  - **Create `frontend/src/components/reception/AppointmentStatusBadge.tsx`**:
    - Export `parsePositiveIntParam(raw: string | null | undefined): number | null` strictly validating `/^[1-9]\d*$/`.
    - Export `getWaitingElapsedMinutes(appt: { check_in_at?: string | null; status_updated_at?: string | null; created_at?: string | null }, nowMs?: number): number` using consistent canonical precedence (`check_in_at ?? status_updated_at ?? created_at`).
    - Export `useIstToday(serverDate?: string | null): string` returning `serverDate || currentIstToday` and refreshing via a 60-second `setInterval` (cleaned up on unmount) so always-on monitors roll over across 00:00 IST.
    - Export `useDebouncedValue<T>(value: T, delayMs = 200): T` (cleaned up on unmount).
    - Export `<AppointmentStatusBadge status={...} label?={...} />` with ONE consistent UX-04-compliant semantic palette across all 5 Reception tabs (`BOOKED`: slate `bg-slate-100 text-slate-700 border-slate-200`, `TO_ARRIVE`: amber `bg-amber-50 text-amber-800 border-amber-200`, `CHECKED_IN`: teal `bg-teal-50 text-teal-800 border-teal-200`, `WAITING`: amber `bg-amber-50 text-amber-800 border-amber-200`, `IN_CABIN`: blue `bg-blue-50 text-blue-800 border-blue-200`, `COMPLETED`: emerald `bg-emerald-50 text-emerald-800 border-emerald-200`, `NO_SHOW`: orange `bg-orange-50 text-orange-800 border-orange-200`, `RESCHEDULED`: purple `bg-purple-50 text-purple-800 border-purple-200`, `CANCELLED`: red `bg-red-50 text-red-800 border-red-200`).
  - **Fix Admin 403 tab link**:
    - In `ReceptionDeskTabs.tsx`, hide `Daily Collection Report` (`/reception/reports`, `<RequireRole role="RECEPTION" />`) when `isAdmin` is true (`{!isAdmin && (...)}`).
    - In `ReceiptsPage.tsx:109`, pass `isAdmin={isAdmin}` to `<ReceptionDeskTabs>` so Admin users on `/reception/receipts` also never see the 403 `/reception/reports` tab.
  - **Unit tests (`appointment-status-badge.test.tsx`, TDD RED -> GREEN)**:
    - Cover `parsePositiveIntParam` (`"12"` -> `12`, `"0"`/`"-1"`/`"1.5"`/`"abc"`/`null` -> `null`), `getWaitingElapsedMinutes` (`check_in_at` precedence), semantic badge classes (`CHECKED_IN` teal vs `COMPLETED` emerald vs `CANCELLED` red), and `ReceptionDeskTabs` hiding `Daily Collection Report` when `isAdmin={true}` while showing it for reception.
- **validation**:
  - `npm --prefix frontend test -- src/components/reception/__tests__/appointment-status-badge.test.tsx src/pages/__tests__/receipts-page.test.tsx` passes 100%.
  - Lint from `frontend/`: `.\node_modules\.bin\oxlint.cmd src/components/reception/AppointmentStatusBadge.tsx src/components/reception/__tests__/appointment-status-badge.test.tsx src/components/billing/ReceptionDeskTabs.tsx src/pages/ReceiptsPage.tsx` exits `0`.
- **status**: Completed
- **log**: Created `AppointmentStatusBadge.tsx` (`parsePositiveIntParam`, `getWaitingElapsedMinutes`, `useIstToday`, `useDebouncedValue`, unified UX-04 badge), hid `/reception/reports` for `isAdmin` in `ReceptionDeskTabs.tsx`, and passed `isAdmin={isAdmin}` from `ReceiptsPage.tsx`. TDD RED -> GREEN (34/34 passed across `appointment-status-badge`, `receipts-page`, `guards`), `tsc -b` exit 0, `oxlint` 0 warnings/errors. Committed at `996cb1cd`.
- **files edited/created**: `frontend/src/components/reception/AppointmentStatusBadge.tsx`, `frontend/src/components/reception/__tests__/appointment-status-badge.test.tsx`, `frontend/src/components/billing/ReceptionDeskTabs.tsx`, `frontend/src/pages/ReceiptsPage.tsx`

---

### T4: Reception Dashboard Consistency, Rolling Date, Pending Arrivals & Tests

- **depends_on**: [T1, T2, T3]
- **location**:
  - `frontend/src/pages/ReceptionDashboard.tsx`
  - `frontend/src/pages/__tests__/reception-dashboard.test.tsx`
- **description**:
  - Read all of `ReceptionDashboard.tsx` and `reception-dashboard.test.tsx` first.
  - **Rolling business date & unfrozen delay timer**:
    - Replace `const todayStr = useMemo(() => istToday(), [])` with `useIstToday(overview?.business_date)`.
    - Track a lightweight `nowTick` (`queueUpdatedAt` + 60s interval) passed into `delayedAppts` + shared `getWaitingElapsedMinutes(...)` so waiting patients crossing 30 minutes trigger `Needs Attention` even under TanStack Query structural sharing.
  - **A1 — First KPI Card (`Active Visits Today`)**:
    - Compute active today visits using `!isCancelledOrClosed(a)` (excludes `CANCELLED`, `RESCHEDULED`, `NO_SHOW`, and `consultation_status === 'CANCELLED'`), keeping subtitle `"Walk-in + booked"` and link `/reception/appointments`.
  - **A4 — Pending `/opd-arrivals` in `Needs Attention`**:
    - Fetch `useOpdArrivals(todayStr)` (safe when errored — never throw synchronously so `login.test.tsx` stays green!) and call `refetchArrivals()` inside `handleManualRefresh`.
    - Count `TO_ARRIVE` pending arrivals and render a `Needs Attention` alert card linking to `/reception/tokens`; update the Needs Attention grid to `md:grid-cols-2 xl:grid-cols-4` so 4 cards wrap cleanly without an orphan row.
  - **Authoritative `Doctor Workload` (OD-22-07 Priority Order)**:
    - Derive `doctorWorkloadRows` directly from `doctors` + `sortedWaitingAppts` + `sortedInConsultationAppts` + `completedAppts` (using OD-22-07 suggested order for `nextToken`), falling back to `overview.doctors_today` only when `doctors` is not yet loaded.
  - Change the `queueError` banner (`ReceptionDashboard.tsx:261`) to `role="alert"` (`<InlineAlert tone="warning">` or explicit `role="alert"`) and use `<AppointmentStatusBadge />` in the Live Queue preview.
  - **Update & expand `reception-dashboard.test.tsx`**:
    - Stub `/api/opd-arrivals` across tests.
    - Update existing assertions for A1 (`Active Visits` = `9` in `mockAppointments`, replacing `'18'` at line 430-432) and OD-22-07 `Doctor Workload` (Dr. Anil `Waiting: 4`, `Next: #20` EMERGENCY Asha Devi at lines 601/603).
    - Add tests for A4 pending `/opd-arrivals` in `Needs Attention`, empty Live Queue state, hidden `Needs Attention` when 0 alerts, and `queueError` `role="alert"` banner.
- **validation**:
  - `npm --prefix frontend test -- src/pages/__tests__/reception-dashboard.test.tsx src/pages/__tests__/login.test.tsx` passes 100% (RED -> GREEN).
  - Lint from `frontend/`: `.\node_modules\.bin\oxlint.cmd src/pages/ReceptionDashboard.tsx src/pages/__tests__/reception-dashboard.test.tsx` exits `0`.
- **status**: Not Completed
- **log**:
- **files edited/created**:

---

### T5: Check-in & Token + `TodayAppointmentsPanel` Contract, Referral (`A2`), Permissions & Responsive Fixes

- **depends_on**: [T1, T2, T3]
- **location**:
  - `frontend/src/pages/TokenGenerationPage.tsx`
  - `frontend/src/components/checkin/TodayAppointmentsPanel.tsx`
  - `frontend/src/pages/__tests__/token-generation.test.tsx`
  - `frontend/src/components/__tests__/today-appointments-panel.test.tsx`
- **description**:
  - Read all 4 owned files completely before editing.
  - **`TokenGenerationPage.tsx`**:
    - Use `useIstToday()` instead of bare `istToday()`.
    - Fix `isBookable()` to include `'BOOKED'`, `'NO_SHOW'`, `'TO_ARRIVE'`, `'REGISTERED'` (guarding `a.consultation_status == null`).
    - Require `Consultation type *` (`if (!visitKind) missing.push('consultation type')`) for ALL `mode === 'existing'` submissions (walk-ins + bookings).
    - Hide `Remarks (optional)` when `mode === 'new'`.
    - **A2**: Restore compact collapsible **`Referred by`** control (`OD-22-16`, defaults to `SELF` / `null`, expands via toggle button to `<select>` + optional `<input>` with explicit `<label htmlFor>` + `id` for UX-06) and pass `referral_source` / `referrer_name` on check-in & walk-in.
    - Reset `notDuplicate` to `false` inside `fullName` and `mobile` `onChange` handlers.
    - Parse `presetPatientId` and `presetBookingId` with `parsePositiveIntParam` (`/^[1-9]\d*$/`).
    - Debounce patient search (`useDebouncedValue(searchQuery, 200)`) and gate `usePatients` on `{ enabled: mode === 'existing' && debouncedQuery.trim().length >= 2 }`.
    - Derive `patientBookings` and existing same-day active tokens from `allTodayAppointments` (eliminating duplicate 10s-polling `useAppointments({ patient_id })`); show an inline banner when the selected existing patient already has an active/checked-in token today; on `409`, only show `"Check that booking in instead"` when a matching `isBookable` booking exists, otherwise display backend `err.message`.
    - Align permission gates: `canCreateArrival = permissions.includes('patient:create') && permissions.includes('appointment:write')`, `canSubmit = mode === 'new' ? canCreateArrival : canCheckIn`, pass `canRegister={canCreateArrival}` to `TodayAppointmentsPanel`, and gate `StepTwoIssued`'s `Complete Registration & Check In` link on `canCreateArrival`.
    - Reconcile `issued` in `StepTwoIssued` / `TokenSlipModal` against live `allTodayAppointments` and `pendingArrivals` (`list_arrivals` includes `CANCELLED` rows): if `CANCELLED`, disable `Print Token` and show a `"Cancelled"` notice.
    - Use shared `<AppointmentStatusBadge />`.
  - **`TodayAppointmentsPanel.tsx`**:
    - Use `useIstToday()`.
    - Fix `isCheckedIn()` so `status === 'REGISTERED'` and URN-bearing `TO_ARRIVE` are NOT misclassified as `Checked In` (require `a.consultation_status != null || ['ARRIVED', 'CHECKED_IN', 'WAITING', 'IN_CONSULTATION', 'DONE', 'COMPLETED'].includes(a.status)`).
    - Handle `RESCHEDULED` explicitly via `<AppointmentStatusBadge status="RESCHEDULED" />` and keep tab counts mathematically consistent.
    - **A3**: Keep `More` menu (`No-show`, `Reschedule`, `Cancel`, `Change priority`) with exact backend permission & status gates:
      - `Change priority`: only when `pendingArrival?.status === 'TO_ARRIVE'` (`canManage`) OR `consultation_status === 'WAITING' || consultation_status === 'IN_CONSULTATION'` (`canCheckIn`).
      - `Cancel arrival`: gated strictly on `canManage` (`appointment:write`).
      - `PriorityModal`: enforce `reason.trim().length >= 3`.
    - Fix `More` dropdown clipping below `1280px` and table overflow at `1280px`: keep `overflow-x-auto` (remove `xl:overflow-visible`) and position the open menu with `position: fixed` anchored to the trigger button's `getBoundingClientRect()` **while staying inside the `<tr>` DOM** (closing cleanly on capture-phase `scroll`, `resize`, `Escape`, and outside `pointerdown`) so `within(existingRow).getByRole('menuitem')` keeps working cleanly! Make `RescheduleForm` responsive (`grid-cols-1 sm:grid-cols-2`).
    - Use shared `<AppointmentStatusBadge />`.
  - **Update & expand `token-generation.test.tsx` & `today-appointments-panel.test.tsx`**:
    - In `token-generation.test.tsx`, update lines 499 & 521 (`installApi({ today: [rameshBooking], bookings: [rameshBooking] })`) and lines 533-536 & 564-566 (select `New consultation` before submitting existing walk-ins); add tests for `TO_ARRIVE`/`REGISTERED` booking check-in, walk-in requiring `Consultation type`, collapsible `Referred by`, `notDuplicate` reset on edit, cancelled `issued` disabling `Print Token`, `409 duplicate_opd_arrival`, `Clear form` URL cleanup, and `!canCheckIn`/`!canCreateArrival`.
    - In `today-appointments-panel.test.tsx`, update lines 112-160 & 185-236 to match the unified semantic badge colors (`Checked In` teal, `Cancelled` red) and corrected `REGISTERED`/`TO_ARRIVE` classification (awaiting check-in, NOT checked in); hoist mutation spies and assert exact payloads for `PriorityModal` (`reason` vs `priority_reason` + min-3-char validation), `CancelForm`, `NoShowForm`, `RescheduleForm`, and `doctorFilter`.
- **validation**:
  - `npm --prefix frontend test -- src/pages/__tests__/token-generation.test.tsx src/components/__tests__/today-appointments-panel.test.tsx` passes 100% (RED -> GREEN).
  - Lint from `frontend/`: `.\node_modules\.bin\oxlint.cmd src/pages/TokenGenerationPage.tsx src/components/checkin/TodayAppointmentsPanel.tsx src/pages/__tests__/token-generation.test.tsx src/components/__tests__/today-appointments-panel.test.tsx` exits `0`.
- **status**: Not Completed
- **log**:
- **files edited/created**:

---

### T6: Appointments RBAC (`Book Appointment`), Lifecycle Validation, Modal Search & Tests

- **depends_on**: [T1, T2, T3]
- **location**:
  - `frontend/src/pages/AppointmentsReception.tsx`
  - `frontend/src/components/AppointmentBookingModal.tsx`
  - `frontend/src/pages/__tests__/appointments-reception.test.tsx`
  - `frontend/src/components/__tests__/session-dialogs.test.tsx`
- **description**:
  - Read all 4 owned files completely before editing.
  - **`AppointmentsReception.tsx`**:
    - **Security #1**: Gate both `Book Appointment` buttons (header + empty state) on `isReception && canManageAppointments`.
    - **A3**: Remove the redundant header `Check-in & Token` link.
    - Fix `RowActions.canCancel`: for checked-in rows, require `consultation_status === 'WAITING'` (not `ARRIVED` with `consultation_status == null`); enforce `>= 3` chars in `CancelModal`.
    - Disable `No-Show` while `updateStatusMutation.isPending` and guard `handleUpdateStatus` against concurrent re-entry.
    - Fix `RescheduleModal`: when `appt.status !== 'BOOKED'` and `appt.appointment_date === today`, initialize date and set `min` to tomorrow (IST, using `new Date(\`${today}T00:00:00Z\`)` date shift, NEVER `new Date().toISOString().split(...)`).
    - Reconcile `Active (N)` vs summary counts: include `No-show` count in the summary bar so visible stage counts always sum to `Active (N)`.
    - Fix Doctor pre-filter `useEffect` with a one-shot `useRef` so Doctor users can switch to `"All doctors"` without snapping back.
    - Use `useIstToday()` for `today` (syncing `selectedDate` if the user hasn't manually changed dates across midnight), pass `{ enabled: activeTab === 'today' }` to `useAppointments`, replace `localDateValue(new Date())` in `FollowUpVisits` with `istToday()` + UTC-safe date shifts, add `flex-wrap` to the date bar, and use `<AppointmentStatusBadge />`.
  - **`AppointmentBookingModal.tsx`**:
    - Debounce patient search (`useDebouncedValue(searchQuery, 200)`) and pass `{ enabled: !initialPatient && debouncedQuery.trim().length >= 2 }` to `usePatients`, while **keeping dropdown visibility gated on `searchResults && searchResults.length > 0`** (NOT `debouncedQuery.length >= 2`) so `session-dialogs.test.tsx:87-88` synchronous dropdown focus stays 100% compatible!
    - Surface clean user-friendly `409 duplicate_appointment` guidance without unactionable override-reason jargon.
  - **Update & expand `appointments-reception.test.tsx` & `session-dialogs.test.tsx`**:
    - Update `appointments-reception.test.tsx:188-191` (assert header `Check-in & Token` link is absent) and `lines 620-623` (move `C Arrived` with `consultation_status: null` to no-Cancel assertions).
    - Add tests verifying: `DOCTOR` does NOT see `Book Appointment` and can select `"All doctors"`; `No-Show` disables while pending; `RescheduleModal` defaults to tomorrow for today's `NO_SHOW`/`TO_ARRIVE`; `Active (N)` equals summary counts.
- **validation**:
  - `npm --prefix frontend test -- src/pages/__tests__/appointments-reception.test.tsx src/components/__tests__/session-dialogs.test.tsx` passes 100% (RED -> GREEN).
  - Lint from `frontend/`: `.\node_modules\.bin\oxlint.cmd src/pages/AppointmentsReception.tsx src/components/AppointmentBookingModal.tsx src/pages/__tests__/appointments-reception.test.tsx src/components/__tests__/session-dialogs.test.tsx` exits `0`.
- **status**: Not Completed
- **log**:
- **files edited/created**:

---

### T7: Waiting Room Permissions, `ReassignDialog` Safety, Completed Status & Rolling IST Date

- **depends_on**: [T2, T3]
- **location**:
  - `frontend/src/pages/WaitingRoom.tsx`
  - `frontend/src/pages/__tests__/waiting-room.test.tsx`
- **description**:
  - Read all of `WaitingRoom.tsx` and `waiting-room.test.tsx` completely before editing.
  - **Defense-in-depth permission gates**: Derive `canReassign` (`visit:write`), `canCancel` (`appointment:write`), and `canCollect` (`payment:create`) from `me?.permissions` and gate Reassign, Cancel consultation, and Collect payment accordingly (preserving `OD-22-19` and `BR-013`).
  - **Fix `ReassignDialog` (avoid TanStack Query v5 `isPending` trap!)**:
    - Disable submit on `targetId !== null && (targetDepartments.isPending || targetDepartments.isError)` (NOT bare `targetDepartments.isPending`, which is `true` when `targetId === null`!).
    - Render `<InlineAlert tone="error">` + `Retry` button (`targetDepartments.refetch()`) when `targetId !== null && targetDepartments.isError`.
  - **Accurate `CompletedCard` checkout readiness**:
    - Call `useVisits({ readyForCheckout: true }, { refetchInterval: 10_000 })` and build `readyVisitIds`.
    - When `readyVisits` is loaded and `appt.visit_id != null`:
      - If `readyVisitIds.has(appt.visit_id)` → `Ready for checkout` + `Collect payment →` (if `canCollect`).
      - Else if another appointment on the same `visit_id` in today's appointments is `WAITING` or `IN_CONSULTATION` → `Other consultation active` (subtle `Open billing →` if `canCollect`).
      - Else → `Closed / settled` (subtle `View bill →` if `canCollect`).
  - **Rolling IST date, shared helpers & mobile layout**:
    - Replace `useMemo(() => istToday(), [])` with `useIstToday()`.
    - Use shared `getWaitingElapsedMinutes` and `<AppointmentStatusBadge />`.
    - Scope column height to `lg:max-h-[70vh]`.
  - **Update & expand `waiting-room.test.tsx`**:
    - Update the `vi.mock('../../api/queries', ...)` factory (`lines 26-44`): add `permissions: ['visit:write', 'appointment:write', 'payment:create']` to default `useMe` mock, add `useVisits` mock returning ready visits matching completed test `visit_id`s, and populate `visit_id` in `appt()` helper (`lines 48-72`).
    - Add tests for: `ReassignDialog` disabled while loading & `InlineAlert` + retry on department fetch error (while remaining clickable before picking a doctor to show validation); permission gating (`!canReassign`/`!canCancel`/`!canCollect`); `CompletedCard` distinguishing ready vs closed vs multi-doctor-in-progress visits.
- **validation**:
  - `npm --prefix frontend test -- src/pages/__tests__/waiting-room.test.tsx` passes 100% (RED -> GREEN).
  - Lint from `frontend/`: `.\node_modules\.bin\oxlint.cmd src/pages/WaitingRoom.tsx src/pages/__tests__/waiting-room.test.tsx` exits `0`.
- **status**: Not Completed
- **log**:
- **files edited/created**:

---

### T8: Billing & Checkout Safety (Sticky `?patient_id=`, Double-Submit, Polling Sync, Exact Discounts, Error States)

- **depends_on**: [T2, T3]
- **location**:
  - `frontend/src/components/billing/BillPanel.tsx`
  - `frontend/src/components/billing/VisitCheckout.tsx`
  - `frontend/src/pages/ReceptionBillingPage.tsx`
  - `frontend/src/components/__tests__/bill-panel.test.tsx`
  - `frontend/src/pages/__tests__/reception-billing.test.tsx`
- **description**:
  - Read all 5 owned files completely before editing.
  - **`BillPanel.tsx` — Chronological `discountsPaise` across mixed `DISCOUNT`/`WAIVER` + `CORRECTION`**:
    - For each active line (`line.status === 'ACTIVE' && line.counts_toward_total`), walk `line.history` chronologically: start `lineDiscount = 0`; for `DISCOUNT`/`WAIVER`, `lineDiscount += Math.max(0, h.old_amount_paise - h.new_amount_paise)`; for an upward `CORRECTION` (`h.new_amount_paise > h.old_amount_paise`), reduce `lineDiscount = Math.max(0, lineDiscount - (h.new_amount_paise - h.old_amount_paise))` (so undoing a discount via upward correction clears it, while an upward/downward correction *before* a discount never corrupts the discount amount!). Sum `lineDiscount` across active counted lines.
    - Keep `Bill Total` casing, `included` sublabel, `bill.due_paise` on `Balance Due`, and `Discounts applied (included above)` row intact.
  - **`VisitCheckout.tsx` — Live Polling Sync (No TDZ!), Double-Submit Guard, Error States & URL Cleanup**:
    - Enable `refetchInterval: 10_000` on `useVisits({ readyForCheckout: true }, { refetchInterval: 10_000 })`.
    - Call `useVisit(validSelectedId, { refetchInterval: (q) => (!q.state.data || q.state.data.status === 'OPEN' ? 10_000 : false) })` *(callback avoids TS2448 TDZ!)*.
    - Validate `validSelectedId` as positive integer (`typeof rawSelectedId === 'number' && Number.isInteger(rawSelectedId) && rawSelectedId > 0`).
    - Gate `usePendingDues({ enabled: isEmptyState })` and `useVisitDues({ enabled: isEmptyState })` inside `VisitCheckout`.
    - Add optional props `onClearInitialVisit?: () => void` and `initialVisitError?: string | null`: invoke `onClearInitialVisit?.()` on `Back to queue` and after `Patient Out`, and render `<InlineAlert tone="error">` when `initialVisitError` is present.
    - Add synchronous `useRef` + `isPending` submit guards to `PaymentForm.submit` and `DueCollectForm.submit`.
    - Add `isError`/`error` `<InlineAlert tone="error">` + retry to `VisitDuesSection` (never silently render `₹0.00` on failure).
  - **`ReceptionBillingPage.tsx` — Sticky `?patient_id=` Fix, Direct Payment Guard, Gated Queries & Error States**:
    - Parse `visit_id`, `appointment_id`, `patient_id` with `parsePositiveIntParam` (`/^[1-9]\d*$/`).
    - Fix sticky `?patient_id=`:
      - Track applied `patientIdParam` in a `useRef<number | null>(null)` so `preloadedPatient` is applied **at most once**, and ONLY when there is no active `visit_id`/`appointment_id` (or if `linkedAppointment` confirms `linkedAppointment.patient_id === patientId`).
      - Provide `clearCheckoutParams()` using `setSearchParams` (`replace: true`, preserving `tab`) called on `Back to queue`, visit close, `Change` patient, and `handleResetCheckout`.
      - Pass `initialVisitError` to `VisitCheckout` when `hasValidAppointmentId && (linkedAppointmentError || (!linkedAppointmentPending && linkedAppointment && !linkedAppointment.visit_id))`.
    - Direct Payment duplicate-payment safety:
      - Add synchronous `useRef` + `recordPaymentMutation.isPending` guard in `handleCollectPayment`.
      - Hide/replace the `<form>` while `recordedPayment` is set (showing the receipt confirmation card with `Print Receipt` + `Checkout Next Patient`).
    - Error states on financial tabs: render `<InlineAlert tone="error">` on `isError` for Package Dues, Today's Receipts, and Admin Ledger (never silently show `₹0.00`).
    - Gate mount fetches: debounce `searchQuery` (`useDebouncedValue(searchQuery, 200)`), pass `{ enabled: checkoutMode === 'other' && debouncedSearch.trim().length >= 2 }` to `usePatients`, `{ enabled: checkoutMode === 'other' }` to `useDoctors` & `useFees`, and `{ enabled: activeTab === 'dues' }` to `usePendingDues`.
    - Add `flex-wrap` to the Package Dues header toolbar.
  - **Expand `bill-panel.test.tsx` & `reception-billing.test.tsx`**:
    - `bill-panel.test.tsx`: test upward `CORRECTION` then `DISCOUNT` (`₹100.00`), downward `CORRECTION` then `DISCOUNT` (`₹50.00`), `DISCOUNT` undone by upward `CORRECTION` (`₹0.00`), `counts_toward_total: false` excluded, and multi-line discount sum.
    - `reception-billing.test.tsx`: test Waiting Room `/reception/billing?appointment_id=9&patient_id=77` deep-link (loading → split workspace), `Back to queue` clearing URL params, `Change` / `Checkout Next Patient` NOT snapping back to `preloadedPatient`, Direct Payment hiding form after recording + blocking double-submit, `canCollect=false` hiding `Direct payment (no visit)`, `isError` alerts on Dues/Receipts tabs, and `ADMIN` view hiding `Daily Collection Report` tab.
- **validation**:
  - `npm --prefix frontend test -- src/components/__tests__/bill-panel.test.tsx src/components/__tests__/bill-line-actions.test.tsx src/pages/__tests__/reception-billing.test.tsx` passes 100% (RED -> GREEN).
  - Lint from `frontend/`: `.\node_modules\.bin\oxlint.cmd src/components/billing/BillPanel.tsx src/components/billing/VisitCheckout.tsx src/pages/ReceptionBillingPage.tsx src/components/__tests__/bill-panel.test.tsx src/pages/__tests__/reception-billing.test.tsx` exits `0`.
- **status**: Not Completed
- **log**:
- **files edited/created**:

---

### T9: Full Backend + Frontend Verification Gate

- **depends_on**: [T1, T2, T3, T4, T5, T6, T7, T8]
- **location**: `backend/` and `frontend/` (read-only verification)
- **description**:
  - Run backend test suites covering all touched routers, RBAC matrix, overview, billing, and arrivals:
    - `pytest backend/tests/test_appointment_booking.py backend/tests/test_rbac_matrix.py backend/tests/test_reception_overview.py backend/tests/test_patient_registration.py backend/tests/test_admin_overview.py backend/tests/test_billing_api.py backend/tests/test_opd_arrivals.py`
  - Run the full frontend quality gate:
    - `npm --prefix frontend run typecheck`
    - `npm --prefix frontend run lint` (0 warnings, 0 errors)
    - `npm --prefix frontend test` (all test files including `guards.test.ts`)
    - `npm --prefix frontend run build`
  - Produce final execution summary + concise manual browser verification checklist.
- **validation**:
  - Backend `pytest` and all 4 frontend commands exit `0`.
- **status**: Not Completed
- **log**:
- **files edited/created**:

## Parallel Execution Groups

| Wave | Tasks | Can Start When | Owned File Disjointness |
| ------ | ------- | ---------------- | ------------------------- |
| 0 | T0 | Immediately | Git ref only |
| 1 | T1, T2, T3 | T0 complete | `T1`: `backend/` · `T2`: `queries.ts` · `T3`: `AppointmentStatusBadge.tsx` + `ReceptionDeskTabs.tsx` + `ReceiptsPage.tsx` |
| 2 | T4, T5, T6, T7, T8 | Wave 1 complete (`T1`–`T3` committed + `tsc -b` clean) | `T4`: Dashboard · `T5`: Check-in + Panel · `T6`: Appointments + Modal · `T7`: Waiting Room · `T8`: Billing (`BillPanel` + `VisitCheckout` + `ReceptionBillingPage`) |
| 3 | T9 | Wave 2 complete | Read-only full backend + frontend gate |

## Testing Strategy

- **Backend (`pytest`)**: `test_appointment_booking.py` + `test_rbac_matrix.py` (doctor-silo 403), `test_reception_overview.py` (visit dues + package dues, OD-22-07 `next_token` via `priority_updated_at`), `test_patient_registration.py` (10-digit mobile fallback duplicate check), plus `test_admin_overview.py`, `test_billing_api.py`, `test_opd_arrivals.py`.
- **Frontend Unit & Integration (`vitest run`)**: New `appointment-status-badge.test.tsx`, plus updated & expanded `reception-dashboard.test.tsx`, `login.test.tsx`, `token-generation.test.tsx`, `today-appointments-panel.test.tsx`, `appointments-reception.test.tsx`, `session-dialogs.test.tsx`, `waiting-room.test.tsx`, `bill-panel.test.tsx`, `bill-line-actions.test.tsx`, `reception-billing.test.tsx`, `receipts-page.test.tsx`, and `guards.test.ts` (UX-04 / UX-06 / IST date cap = 0).
- **Static & Production Build**: `tsc -b`, repo-wide `oxlint` (0 warnings/errors), `vite build`.

## Risks & Mitigations

- **Risk**: `test_rbac_matrix.py` expects `"doctor_b": 201` on `POST /api/appointments`, and `test_admin_overview.py:272` asserts admin overview dues equal package dues only.
  - **Mitigation**: `T1` explicitly updates `backend/tests/support/matrix.py` to `"doctor_b": 403`, leaves `get_admin_overview` untouched, and runs both `test_rbac_matrix.py` and `test_admin_overview.py`.
- **Risk**: Referencing `visit?.status` inside `useVisit(...)` causes TS2448 TDZ error; `targetDepartments.isPending` in TanStack Query v5 is `true` while `targetId === null`.
  - **Mitigation**: `T2` adds callback-typed `refetchInterval` to `useVisit`, `T8` uses `(q) => (!q.state.data || q.state.data.status === 'OPEN' ? 10_000 : false)`, and `T7` gates Reassign submit on `targetId !== null && (targetDepartments.isPending || targetDepartments.isError)`.
- **Risk**: Existing frontend tests mock `../../api/queries` (`waiting-room.test.tsx` without `permissions`), assert old badge/KPI/shortcut values, or expect synchronous dropdown focus (`session-dialogs.test.tsx`).
  - **Mitigation**: `T4`–`T8` explicitly list every affected test line (`waiting-room.test.tsx` `vi.mock`, `token-generation.test.tsx:499,521,533,564`, `today-appointments-panel.test.tsx:112-236` + in-row fixed `More` menu, `reception-dashboard.test.tsx:430,601,603`, `appointments-reception.test.tsx:188,620`, and `AppointmentBookingModal` keeping dropdown visibility on `searchResults.length > 0`).
- **Risk**: Parallel Wave 2 tasks clashing on `.git/index.lock` or `tsc -b`.
  - **Mitigation**: Strictly disjoint file ownership across `T4`–`T8`; subagents do NOT run `git commit` or edit this plan file; Orchestrator serializes commits and runs repo-wide `tsc -b` + `guards.test.ts` at each wave boundary.
