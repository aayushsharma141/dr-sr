# Plan: Appointments Lifecycle Management Refactor

**Generated**: 2026-11-17

## Overview

Make Kalyan Hospital's **Appointments** page (`/reception/appointments`) exclusively responsible for **appointment lifecycle management** (`Booked → Arrived → Checked In → Completed`, plus `No-show`, `Rescheduled`, and `Cancelled`), removing live queue/consultation and billing overlap, eliminating repeated patient/doctor demographics, adding clear **Book** and **Reschedule** workflows, and moving **Cancelled** appointments out of the primary active list behind a dedicated filter.

### Confirmed Product Decisions

- **Header Actions (`A1`)**: Primary **`+ Book Appointment`** button (opening the existing `AppointmentBookingModal`) + secondary **`Check-in & Token`** shortcut link (reception only); remove the duplicated `New patient` button (from both header and empty state). Preserve read-only `Read-only schedule` badge for roles without `appointment:write` (e.g. `ADMIN`).
- **Appointment-Specific Statuses (`A2`)**:
  - Derive lifecycle status cleanly from both `status` and `consultation_status` (note: backend `check_in()` writes `status = 'ARRIVED'` + `consultation_status = 'WAITING'`, while `IN_CONSULTATION` and `COMPLETED` mirror consultation state):
    - `CANCELLED` → **`Cancelled`**
    - `RESCHEDULED` → **`Rescheduled`**
    - `NO_SHOW` → **`No-show`**
    - `DONE` / `COMPLETED` or `consultation_status === 'COMPLETED'` → **`Completed`**
    - `CHECKED_IN` / `WAITING` / `IN_CONSULTATION` or (`ARRIVED` with `consultation_status != null`) → **`Checked In`** *(matches backend check-in state and removes `"Waiting"` / `"With doctor"` consultation labels — owned by Waiting Room)*
    - `ARRIVED` (with `consultation_status == null`) → **`Arrived`**
    - `BOOKED` / `TO_ARRIVE` / `REGISTERED` → **`Booked`**
  - Update toolbar lifecycle summary counts over active appointments to match (`Booked`, `Arrived`, `Checked In`, `Completed`) — no `"waiting"` or `"with doctor"` counters.
- **Compact Columns & Lifecycle Actions (`A3`)**:
  - 5 columns: **`Time`** (`expected_time` `HH:MM` or `—`, replacing `Token`), **`Patient`** (clickable name + URN only, dropping mobile), **`Doctor`** (English name + department sub-line if present, dropping Hindi name), **`Status`**, **`Action`**.
  - Actions focused on appointment lifecycle and strictly aligned to backend RBAC + transitions:
    - **`Check in`** handoff link (`/reception/tokens?patient_id=...&appointment_id=...`) — reception only (`isReception`), today only (`appointment_date === today`), unarrived bookings (`BOOKED | TO_ARRIVE | REGISTERED | NO_SHOW`).
    - **`Reschedule`** button — reception only (`isReception`, since backend `RECEPTION_ONLY_BOOKING_TARGETS` rejects `DOCTOR` with 403 `reception_only`), for `BOOKED | TO_ARRIVE | NO_SHOW`.
    - **`No-Show`** button — `canManageAppointments`, on or after appointment date (`appointment_date <= today`), for `BOOKED | TO_ARRIVE`.
    - **`Cancel`** button — `canManageAppointments` for pre-arrival (`BOOKED | TO_ARRIVE | REGISTERED`), and `isReception` ONLY for checked-in waiting rows (`(ARRIVED | CHECKED_IN | WAITING)` when `consultation_status == null || consultation_status === 'WAITING'`, since backend `_require_consultation_actor` rejects `DOCTOR` with 403 and rejects `IN_CONSULTATION`/`COMPLETED` with 422). Never shown on `NO_SHOW`, `IN_CONSULTATION`, `DONE`, `COMPLETED`, `CANCELLED`, or `RESCHEDULED`.
    - Drop **`Billing →`**, **`Call Cabin`**, and **`With doctor`** queue/billing controls.
- **Separate Cancelled Filter (`A4`)**: Compact inline filter pills (`role="group"`, `aria-label="Filter appointments"`, `aria-pressed` — preserving `role="tablist"` exclusively for Doctor's `Follow-ups` / `Schedule` tabs):
  - **`Active (N)`** (default — excludes `CANCELLED` and `RESCHEDULED` rows)
  - **`Cancelled (N)`** (shows `CANCELLED` rows with cancellation reasons)
  - **`All (N)`** (shows all bookings for the selected date & doctor, including `RESCHEDULED`)

### Scope & Architecture Constraints

- Pure frontend change — no backend API, schema, permission, or database modifications required.
- Single file owner per task — zero overlapping edits across tasks (`AGENTS.md`).
- Preserve existing non-reception behaviors on `/reception/appointments`:
  - `DOCTOR` `Follow-ups` / `Schedule` tablist, `FollowUpVisits` view, and `OPD Cabin Pacing & Doctor Schedule` banner.
  - `ADMIN` read-only view (`Read-only schedule`, `View only`, no booking/status mutation buttons).
  - Keep `useDoctors(false)` on `AppointmentsReception` so staff browsing past dates can still filter by inactive doctors.
- **Strict TypeScript (`noUnusedLocals` & `noUnusedParameters`)**: Remove unused imports/props (`IconUserPlus`, `formatToken`, `showCallCabin`, old status helpers) so `tsc -b` passes cleanly.
- **UX-04 / UX-06 / IST Date Guard Compliance (`frontend/src/test/guards/guards.test.ts`, cap = 0)**:
  - No sub-12px text, no `text-slate-300/400` or `text-neutral-300/400` (even on `hover:`), no `text-red-500`/`text-emerald-600`/`text-amber-600`/`text-teal-600` (use `-700`/`-800` shades).
  - Explicit `<label htmlFor="...">` + matching static `id="..."` on every `<input>`, `<select>`, and `<textarea>` (UX-06).
  - Never use `new Date().toISOString().split(...)` in non-test `.tsx` files (use `istToday()` and `d.toISOString().slice(0, 10)` only on an already-parsed UTC date).

## Prerequisites

- Node.js `>=22.22.2` with frontend dependencies installed (`frontend/node_modules`).
- Existing hooks in `frontend/src/api/queries.ts`: `useAppointments`, `useDoctors`, `useBookAppointment`, `useRescheduleAppointment`, `useUpdateAppointmentStatus`, `usePrescriptionFollowUps`, `useMe`.
- Existing icons in `frontend/src/components/icons/index.ts`: `IconPlus`, `IconTicket`.

## Dependency Graph

```
T0 (Git Checkpoint) ── T1 (AppointmentBookingModal initialDate + test) ── T2 (AppointmentsReception refactor) ── T3 (AppointmentsReception tests) ── T4 (Full Verification)
```

*(Note: `T2` explicitly depends on `T1` because `T2` passes the new `initialDate` prop to `AppointmentBookingModal`; `T1` is a surgical 3-line edit + 1 test, so serializing `T1 → T2` allows `T2` to verify `tsc -b` immediately with zero compile-time race.)*

## Tasks

### T0: Record Pre-Batch Git Checkpoint

- **depends_on**: []
- **location**: Repository Git state (no source edits)
- **description**:
  - Inspect `git status` on `AppointmentsReception.tsx`, `AppointmentBookingModal.tsx`, `appointments-reception.test.tsx`, and `session-dialogs.test.tsx` to preserve any existing user changes (`AGENTS.md`).
  - Record a non-destructive checkpoint via `$sha = git stash create "checkpoint: pre appointments lifecycle refactor"; if ($sha) { git update-ref refs/checkpoints/pre-appointments-lifecycle $sha }`.
- **validation**:
  - Checkpoint SHA is pinned under `refs/checkpoints/pre-appointments-lifecycle` without modifying working tree files.
- **status**: Completed
- **log**: Captured non-destructive working-tree checkpoint via `git stash create` and pinned ref `refs/checkpoints/pre-appointments-lifecycle` -> `bc469e2443a72569fc24a19de415002ab30250f7`. Noted pre-existing uncommitted edits on 3 target files and preserved them.
- **files edited/created**: None (Git ref `refs/checkpoints/pre-appointments-lifecycle` only)

### T1: Add optional `initialDate` support to `AppointmentBookingModal` & unit test

- **depends_on**: [T0]
- **location**:
  - `frontend/src/components/AppointmentBookingModal.tsx`
  - `frontend/src/components/__tests__/session-dialogs.test.tsx`
- **description**:
  - Add optional `initialDate?: string` prop to `AppointmentBookingModalProps` (backward-compatible with all existing callers including `ClinicalEncounterWorkspace.tsx`).
  - Clamp and initialize `appointmentDate` lazily on mount:

    ```ts
    const [appointmentDate, setAppointmentDate] = useState(() => {
      const today = istToday()
      return initialDate && initialDate >= today ? initialDate : today
    })
    ```

  - Add `min={istToday()}` to the `#date-input` date field so users cannot book appointments in the past (clamping `initialDate` above guarantees a past `initialDate` never breaks native validation).
  - Add unit tests in `frontend/src/components/__tests__/session-dialogs.test.tsx` using `vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-17T06:00:00Z') })` verifying:
    1. `<AppointmentBookingModal isOpen initialDate="2026-11-20" onClose={vi.fn()} />` pre-fills `Appointment Date` with `'2026-11-20'` and sets `min="2026-11-17"`.
    2. A past `initialDate="2026-11-10"` clamps safely to today (`'2026-11-17'`).
    3. Existing IST midnight default and keyboard selection tests remain green.
- **validation**:
  - TDD RED → GREEN: `npm --prefix frontend test -- src/components/__tests__/session-dialogs.test.tsx src/test/guards/guards.test.ts` passes.
  - `npm --prefix frontend run typecheck` exits `0`.
  - Lint from `frontend/`: `.\node_modules\.bin\oxlint.cmd src/components/AppointmentBookingModal.tsx src/components/__tests__/session-dialogs.test.tsx` exits `0`.
- **status**: Completed
- **log**: Added optional `initialDate?: string` clamped to `>= istToday()` and `min={istToday()}` on `#date-input` in `AppointmentBookingModal.tsx`, plus 2 fake-timer tests in `session-dialogs.test.tsx`. TDD RED (2 failed / 5 passed) -> GREEN (`14/14` across `session-dialogs.test.tsx` + `guards.test.ts`, `tsc -b` exit 0, `oxlint` 0 warnings/errors). Committed as latest HEAD.
- **files edited/created**: `frontend/src/components/AppointmentBookingModal.tsx`, `frontend/src/components/__tests__/session-dialogs.test.tsx`

### T2: Refactor `AppointmentsReception` into dedicated appointment lifecycle management

- **depends_on**: [T1]
- **location**:
  - `frontend/src/pages/AppointmentsReception.tsx`
- **description**:
  - **Imports, Helpers & Cleanup**:
    - Import `AppointmentBookingModal` from `../components/AppointmentBookingModal`, `useRescheduleAppointment` from `../api/queries`, and `IconPlus` from `../components/icons`.
    - Remove unused `IconUserPlus`, `formatToken`, and `showCallCabin` (`noUnusedLocals`/`noUnusedParameters`).
    - Keep `localDateValue` (used by `FollowUpVisits`) and `useDoctors(false)` (used for historical date browsing).
    - Fix `handleDateShift(days: number)` to avoid crashing on cleared `<input type="date">` and avoid UTC/local drift:

      ```ts
      const base = selectedDate || istToday()
      const d = new Date(`${base}T00:00:00Z`)
      if (Number.isNaN(d.getTime())) return
      d.setUTCDate(d.getUTCDate() + days)
      setSelectedDate(d.toISOString().slice(0, 10))
      ```

  - **Header & Booking Modal (`A1`)**:
    - Define `isReception = me?.role === 'RECEPTION'`.
    - Update reception `pageDescription`: `'Manage bookings by date and doctor: book, reschedule, or cancel appointments. Live queue is managed in Waiting Room.'`
    - When `canManageAppointments`:
      - Primary button: `+ Book Appointment` (`type="button"`, opens `bookingOpen = true`, `<IconPlus className="h-4 w-4" />`).
      - Secondary shortcut (only when `isReception`, since `/reception/tokens` requires `RECEPTION` role): `<Link to="/reception/tokens">Check-in &amp; Token</Link>`.
      - Remove `New patient` link from both header and empty state.
    - Conditionally render `{bookingOpen && <AppointmentBookingModal isOpen initialDate={selectedDate} onClose={() => setBookingOpen(false)} />}` (do **not** close in `onSuccess`, so `AppointmentBookingModal`'s built-in `"Appointment Booked"` confirmation screen stays visible until the user clicks `Done`; `useBookAppointment` already invalidates `['appointments']`).
    - Keep `Read-only schedule` badge when `!canManageAppointments`.
  - **Appointment-Specific Lifecycle Status Mapping & Counts (`A2`)**:
    - Add a single `lifecycleStatus(appt: Appointment)` helper returning `'BOOKED' | 'ARRIVED' | 'CHECKED_IN' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED' | 'RESCHEDULED'`:
      - `appt.status === 'CANCELLED'` → `'CANCELLED'`
      - `appt.status === 'RESCHEDULED'` → `'RESCHEDULED'`
      - `appt.status === 'NO_SHOW'` → `'NO_SHOW'`
      - `appt.status === 'DONE' || appt.status === 'COMPLETED' || appt.consultation_status === 'COMPLETED'` → `'COMPLETED'`
      - `appt.status === 'CHECKED_IN' || appt.status === 'WAITING' || appt.status === 'IN_CONSULTATION' || appt.consultation_status === 'IN_CONSULTATION' || (appt.status === 'ARRIVED' && appt.consultation_status != null)` → `'CHECKED_IN'`
      - `appt.status === 'ARRIVED'` → `'ARRIVED'`
      - otherwise (`BOOKED | TO_ARRIVE | REGISTERED`) → `'BOOKED'`
    - Map lifecycle keys to display labels & UX-04 compliant badge classes (`-700`/`-800` text colors only):
      - `BOOKED`: `'Booked'` (`bg-blue-50 text-blue-800 ring-blue-200`)
      - `ARRIVED`: `'Arrived'` (`bg-amber-50 text-amber-800 ring-amber-200`)
      - `CHECKED_IN`: `'Checked In'` (`bg-teal-50 text-teal-800 ring-teal-200`)
      - `COMPLETED`: `'Completed'` (`bg-emerald-50 text-emerald-800 ring-emerald-200`)
      - `NO_SHOW`: `'No-show'` (`bg-slate-100 text-slate-700 ring-slate-200`)
      - `CANCELLED`: `'Cancelled'` (`bg-slate-100 text-slate-700 ring-slate-200`)
      - `RESCHEDULED`: `'Rescheduled'` (`bg-slate-100 text-slate-700 ring-slate-200`)
    - Toolbar lifecycle counts computed over `activeAppointments`: `Booked`, `Arrived`, `Checked In`, `Completed` (no `"waiting"` or `"with doctor"` counters).
  - **Separate Filter for Cancelled Appointments (`A4`)**:
    - Add `statusView` state (`'active' | 'cancelled' | 'all'`, default `'active'`).
    - `activeAppointments = appointments.filter((a) => a.status !== 'CANCELLED' && a.status !== 'RESCHEDULED')`
    - `cancelledAppointments = appointments.filter((a) => a.status === 'CANCELLED')`
    - `visibleAppointments = statusView === 'active' ? activeAppointments : statusView === 'cancelled' ? cancelledAppointments : appointments`
    - Render `<div role="group" aria-label="Filter appointments">` (with `aria-pressed` pills — NOT `role="tablist"`) always visible whenever `!isPending && !isError`, even when `activeAppointments.length === 0` so staff can switch to `Cancelled (N)` when only cancelled rows exist for a date:
      - `Active ({activeAppointments.length})`
      - `Cancelled ({cancelledAppointments.length})`
      - `All ({appointments.length})`
    - Check `visibleAppointments.length === 0` for the empty state; show contextual copy (`No active appointments for this date and doctor.` / `No cancelled appointments for this date and doctor.` / `No appointments for this date and doctor.`), and render `+ Book Appointment` empty-state button only when `canManageAppointments && statusView !== 'cancelled'`.
  - **Compact 5-Column Table & Backend-Aligned Row Actions (`A3`)**:
    - Columns: `Time`, `Patient`, `Doctor`, `Status`, `Action`.
    - `Time`: `appt.expected_time ? appt.expected_time.slice(0, 5) : '—'`.
    - `Patient`: `<Link to={`/reception/patients/${appt.patient_id}`}>` (`appt.patient_name`) + `appt.patient_urn` monospace sub-line (remove `appt.patient_mobile`).
    - `Doctor`: `appt.doctor_name_en` + `appt.department_name` subtle sub-line if present (remove `appt.doctor_name_hi`).
    - `Status`: lifecycle status badge + `cancellation_reason` when `CANCELLED`.
    - `Action` (`RowActions`, removing `Billing →`, `Call Cabin`, and `With doctor`):
      - `today = istToday()`
      - **`Check in`** link (exact label `'Check in'`, href `/reception/tokens?patient_id=${appt.patient_id}&appointment_id=${appt.id}`): only when `isReception && appt.appointment_date === today && (appt.status === 'BOOKED' || appt.status === 'TO_ARRIVE' || appt.status === 'REGISTERED' || appt.status === 'NO_SHOW')`.
      - **`Reschedule`** button: only when `isReception && (appt.status === 'BOOKED' || appt.status === 'TO_ARRIVE' || appt.status === 'NO_SHOW')`.
      - **`No-Show`** button: only when `canManageAppointments && appt.appointment_date <= today && (appt.status === 'BOOKED' || appt.status === 'TO_ARRIVE')`.
      - **`Cancel`** button: only when
        - `(canManageAppointments && (appt.status === 'BOOKED' || appt.status === 'TO_ARRIVE' || appt.status === 'REGISTERED'))`
        - OR `(isReception && (appt.status === 'ARRIVED' || appt.status === 'CHECKED_IN' || appt.status === 'WAITING') && (appt.consultation_status == null || appt.consultation_status === 'WAITING'))`.
      - When no buttons/links apply for a row, render `—`.
      - For read-only roles (`!canManageAppointments`), render `View only`.
  - **Reschedule Modal & Fixed Cancel Modal**:
    - **`RescheduleModal`** (opened when `reschedulingAppt != null`, rendered via `<Modal open variant="info" title="Reschedule Appointment" onClose={closeReschedule} busy={rescheduleMutation.isPending} className="max-w-md">`):
      - Wrap fields in `<form onSubmit={...}>` with explicit `<label htmlFor>` + static `id` on all 3 inputs (UX-06):
        - `#reschedule-date`: `New date *` (`type="date"`, `min={istToday()}`, `required`, `data-autofocus`, initialized to `appt.appointment_date >= istToday() ? appt.appointment_date : istToday()`)
        - `#reschedule-time`: `Expected time (optional)` (`type="time"`, initialized to `appt.expected_time?.slice(0, 5) ?? ''`)
        - `#reschedule-reason`: `Reason (optional)` (`type="text"`, placeholder `'e.g. Patient requested another day'`)
      - Show a 1-line hint when `appt.status !== 'BOOKED'` (`Choose a future date to reschedule this booking.`).
      - Normalize `expected_time`: `time ? (time.length === 5 ?`${time}:00`: time) : null`.
      - On `isVersionConflict(err)`: close modal and surface `ConflictBanner`. On 422/other error: display inline `role="alert"` inside the modal preserving input values.
      - Footer buttons: `Keep current date` (`disabled={rescheduleMutation.isPending}`) and `Confirm Reschedule` (`type="submit"`, `disabled={!date || rescheduleMutation.isPending}`).
    - **Fix existing Cancel Modal**:
      - On `isVersionConflict(err)`: close modal, clear `cancelReason` & `cancelError`, and surface `ConflictBanner`.
      - On 422/other error: render inline `role="alert"` (`cancelError`) inside the Cancel modal so errors are never hidden behind the open `<dialog>`.
      - Clear `cancelReason` & `cancelError` in `onClose` (including `Esc` / header `✕`), relabel footer dismiss button from `Close` to `Keep appointment` (eliminating duplicate `"Close"` button), disable `Keep appointment` while `updateStatusMutation.isPending`, and reference patient name + date/time in modal copy instead of `formatToken`.
  - Preserve `FollowUpVisits`, Doctor `Follow-ups`/`Schedule` tablist, and Doctor `OPD Cabin Pacing & Doctor Schedule` banner unchanged.
- **validation**:
  - `reason_not_testable`: `appointments-reception.test.tsx` is owned by T3 (Wave 2).
  - `npm --prefix frontend run typecheck` exits `0`.
  - Lint from `frontend/`: `.\node_modules\.bin\oxlint.cmd src/pages/AppointmentsReception.tsx` exits `0`.
  - `npm --prefix frontend test -- src/test/guards/guards.test.ts` passes (UX-04/UX-06/IST cap = 0).
- **status**: Completed
- **log**: Refactored `AppointmentsReception.tsx` for dedicated appointment lifecycle management (`Book Appointment` primary button mounting `AppointmentBookingModal` with `initialDate={selectedDate}`, reception-only `Check-in & Token` link, removed `New patient` link; `lifecycleStatus()` mapping `Booked -> Arrived -> Checked In -> Completed` + `No-show`/`Cancelled`/`Rescheduled` and matching toolbar counts; always-visible `role="group"` `Active | Cancelled | All` filter pills; compact 5-column table `Time`/`Patient`/`Doctor`/`Status`/`Action` without `Token`/mobile/Hindi/`Billing`/`Call Cabin`/`With doctor`; strict backend RBAC/transition guards hiding reception-only actions from `DOCTOR`; `RescheduleModal` via `useRescheduleAppointment`; fixed `Cancel` modal inline 422 errors, 409 `ConflictBanner`, and state cleanup; hardened `handleDateShift`). Verified: `tsc -b` exit 0, `oxlint` 0 warnings/0 errors, `guards.test.ts` 7/7 GREEN (`reason_not_testable: appointments-reception.test.tsx owned by T3`). Committed as latest HEAD.
- **files edited/created**: `frontend/src/pages/AppointmentsReception.tsx`

### T3: Update and expand `AppointmentsReception` unit & integration tests

- **depends_on**: [T2]
- **location**:
  - `frontend/src/pages/__tests__/appointments-reception.test.tsx`
- **description**:
  - Import `../../test/dialog-shim` and `istToday` from `../../format`; replace `new Date().toISOString().split('T')[0]` with `istToday()` (and compute past/future dates via UTC math from `istToday()`) so tests are never flaky between `00:00` and `05:30 IST`.
  - Enrich fixtures with `expected_time: '10:30:00'` and `department_name: 'Physiotherapy'`, and stub `/api/departments` and `/api/patients` in the `+ Book Appointment` modal test so `AppointmentBookingModal` fetches resolve cleanly.
  - Update and expand tests covering:
    1. **Header & Book Appointment modal**: Primary `+ Book Appointment` button and `Check-in & Token` link appear for reception; `New patient` link does NOT appear; reception has no `role="tablist"`; clicking `+ Book Appointment` opens `Book New Appointment` modal pre-filled with the selected date.
    2. **Compact 5-column layout**: Renders `Time` (`10:30` or `—` when `expected_time` is null, never `"null"`), `Patient` (name link + URN, NO mobile number), `Doctor` (English name + `Physiotherapy`, NO Hindi name), `Status`, and `Action` (NO `Token` column).
    3. **Appointment-specific statuses & counts (scoped with `within(table)`)**: Maps `BOOKED`/`TO_ARRIVE`/`REGISTERED` → `Booked`, `ARRIVED` (no consultation) → `Arrived`, `ARRIVED` (`consultation_status: 'WAITING'`) / `CHECKED_IN` / `WAITING` / `IN_CONSULTATION` → `Checked In`, `DONE`/`COMPLETED` → `Completed`, `NO_SHOW` → `No-show`; asserts `"With doctor"`, `"Waiting"`, and `"Billing →"` never appear; toolbar counts show `Booked`, `Arrived`, `Checked In`, `Completed`.
    4. **Separate Cancelled filter (`Active | Cancelled | All`)**: Default `Active` filter hides `CANCELLED` and `RESCHEDULED` rows; clicking `Cancelled` displays cancelled rows and their `cancellation_reason` (and hides `+ Book Appointment` in empty cancelled state); clicking `All` shows active + cancelled + rescheduled rows; filter pills remain visible even when `Active` has 0 rows and `Cancelled` has >0 rows.
    5. **Reschedule modal**: `Reschedule` appears on `BOOKED`, `TO_ARRIVE`, and `NO_SHOW` for reception; submitting sends `POST /api/appointments/:id/reschedule` with `{ version_id, appointment_date, expected_time, reason }`; 422 renders inline `role="alert"` inside modal keeping inputs intact; 409 closes modal and renders `ConflictBanner`.
    6. **Check in, No-Show & Cancel transition & RBAC guards**:
       - `Check in` links to `/reception/tokens?patient_id=...&appointment_id=...` for today's unarrived bookings without sending a PATCH (and is hidden on future dates).
       - `No-Show` appears only on `BOOKED`/`TO_ARRIVE` on or before today (hidden on `ARRIVED`, `REGISTERED`, `NO_SHOW`, or future dates).
       - `Cancel` modal submits `PATCH /status` with `CANCELLED` + reason, displays 422 errors inline inside the dialog, closes + shows `ConflictBanner` on 409, clears `cancelReason` on `Esc`/close, and is hidden on `NO_SHOW`, `IN_CONSULTATION`, `DONE`, `COMPLETED`, `CANCELLED`, `RESCHEDULED`.
    7. **Role preservation**:
       - `ADMIN`: `Read-only schedule`, `View only`, no `button` matching `/book appointment/i`, no mutation buttons.
       - `DOCTOR`: Keeps `Follow-ups` / `Schedule` tablist, `FollowUpVisits`, and `OPD Cabin Pacing & Doctor Schedule`; on `Schedule`, `DOCTOR` does **not** see `Check-in & Token`, row `Check in`, row `Reschedule`, or `Cancel` on checked-in waiting consultations.
- **validation**:
  - `npm --prefix frontend test -- src/pages/__tests__/appointments-reception.test.tsx src/components/__tests__/session-dialogs.test.tsx` passes 100%.
  - `npm --prefix frontend run typecheck` exits `0`.
  - Lint from `frontend/`: `.\node_modules\.bin\oxlint.cmd src/pages/__tests__/appointments-reception.test.tsx` exits `0`.
- **status**: Completed
- **log**: Updated and expanded `appointments-reception.test.tsx` (16 tests using `istToday()` and `dialog-shim`: header `+ Book Appointment` modal with date pre-fill, 5 compact columns without Token/mobile/Hindi, appointment-specific lifecycle statuses & toolbar counts without `With doctor`/`Waiting`/`Billing`, `Active | Cancelled | All` filter behavior, `Reschedule` modal happy/422/409 paths, fixed `Cancel` modal 422/409/reset & status guards, today-only `Check in` & date-guarded `No-Show`, and `ADMIN`/`DOCTOR` RBAC preservation). Verified: `23/23` tests passed across both files, `tsc -b` exit 0, `oxlint` 0 warnings/0 errors. Committed as latest HEAD.
- **files edited/created**: `frontend/src/pages/__tests__/appointments-reception.test.tsx`

### T4: Full frontend verification & manual visual checklist

- **depends_on**: [T1, T2, T3]
- **location**:
  - `frontend/` (read-only verification across all modules)
- **description**:
  - Run the complete frontend quality gate:
    - `npm --prefix frontend run typecheck`
    - `npm --prefix frontend run lint` (0 errors, 0 warnings)
    - `npm --prefix frontend test`
    - `npm --prefix frontend run build`
  - Provide a concise manual visual checklist for `http://localhost:5173/reception/appointments` confirming `+ Book Appointment`, `Reschedule`, `Active | Cancelled | All` filtering, appointment-specific statuses without `With doctor`/`Waiting`, and compact 5-column layout.
- **validation**:
  - All 4 npm checks (`typecheck`, `lint`, `test`, `build`) exit with code `0`.
- **status**: Partially Completed (Automated Gate Passed; Live Browser Visual Check Deferred)
- **log**: Automated frontend gate exited 0 across all 4 checks: `npm --prefix frontend run typecheck` (exit 0), `npm --prefix frontend run lint` (`Found 0 warnings and 0 errors` on 197 files), `npm --prefix frontend test` (`75 passed (75)` test files, `548 passed | 5 skipped (553)` tests, including `guards.test.ts`, `session-dialogs.test.tsx`, `appointments-reception.test.tsx`), and `npm --prefix frontend run build` (`built in 6.14s`). Manual visual verification checklist provided in Execution Summary (Chrome remote debugging not enabled on this workstation).
- **files edited/created**: None (verification only)

## Parallel Execution Groups

| Wave | Tasks | Can Start When |
| ------ | ------- | ---------------- |
| 0 | T0 | Immediately (Git checkpoint) |
| 1 | T1 | T0 complete (`AppointmentBookingModal.tsx` + `session-dialogs.test.tsx`) |
| 2 | T2 | T1 complete (`AppointmentsReception.tsx` — compiles directly against T1's `initialDate` prop) |
| 3 | T3 | T2 complete (`appointments-reception.test.tsx`) |
| 4 | T4 | T1, T2, T3 complete (Full frontend verification gate) |

## Testing Strategy

- **Unit & Integration Tests (Vitest + React Testing Library)**:
  - `frontend/src/components/__tests__/session-dialogs.test.tsx` — `AppointmentBookingModal` `initialDate` pre-fill, past-date clamping with fake timers, IST midnight default, keyboard selection.
  - `frontend/src/pages/__tests__/appointments-reception.test.tsx` — Header `+ Book Appointment` & `Check-in & Token`, 5 compact columns (`Time`, `Patient`, `Doctor`, `Status`, `Action`), appointment-specific status mapping & lifecycle counts, `Active | Cancelled | All` filter, `Reschedule` modal happy/422/409 paths, fixed `Cancel` modal inline error/409/reset behavior, backend-valid `Check in` / `No-Show` / `Cancel` & `DOCTOR` RBAC guards, and `ADMIN`/`DOCTOR` role preservation.
  - `frontend/src/test/guards/guards.test.ts` — UX-04 contrast/font-size, UX-06 accessible labels, and IST business date guard (cap = 0).
- **Static & Production Build Gate**:
  - `npm --prefix frontend run typecheck`
  - `npm --prefix frontend run lint`
  - `npm --prefix frontend test`
  - `npm --prefix frontend run build`

## Risks & Mitigations

- **Risk**: `DOCTOR` role has `appointment:write`, so gating `Reschedule`, `Check in`, or checked-in `Cancel` only on `canManageAppointments` would expose buttons that return 403 (`reception_only` / `consultation_actor_not_allowed`) or route to `/403`.
  - **Mitigation**: T2 explicitly gates `Check-in & Token`, row `Check in`, row `Reschedule`, and checked-in `Cancel` on `isReception` (`me?.role === 'RECEPTION'`), verified by a dedicated `DOCTOR` test in T3.
- **Risk**: Backend `check_in()` writes `status = 'ARRIVED'` + `consultation_status = 'WAITING'` rather than `status = 'CHECKED_IN'`.
  - **Mitigation**: T2's `lifecycleStatus()` maps `ARRIVED` with `consultation_status != null` to `'Checked In'` and `ARRIVED` without `consultation_status` to `'Arrived'`, keeping status badges and toolbar counts accurate against real backend data.
- **Risk**: Closing `AppointmentBookingModal` inside `onSuccess` would hide its `"Appointment Booked"` confirmation state, or passing a past `initialDate` would fail `min={istToday()}`.
  - **Mitigation**: T1 clamps `initialDate` to `>= istToday()`; T2 only passes `onClose={() => setBookingOpen(false)}` and relies on `useBookAppointment` query invalidation.
- **Risk**: Errors in `Cancel` modal could render behind the open `<dialog>` backdrop, or cleared `<input type="date">` could crash `handleDateShift`.
  - **Mitigation**: T2 handles 422 inline inside both `Cancel` and `Reschedule` modals, closes and shows `ConflictBanner` on 409, clears state on `onClose`, and guards `handleDateShift` against empty/invalid dates.
