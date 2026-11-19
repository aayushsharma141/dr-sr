# Plan: Check-in & Token Two-Step Simplification

**Generated**: 2026-11-17

## Overview

Simplify Kalyan Hospital's **Check-in & Token** workspace (`/reception/tokens`) into a compact, above-the-fold **two-step workflow** (`01 Patient & Visit` → `02 Token & Check-in`) paired with a streamlined **Today's Appointments** queue panel that removes demographic duplication and clarifies action sequencing.

### Confirmed Product Decisions

- **New Patient Flow (`A1`)**: Keep the fast 3-field New Patient entry (Name, Age, Phone → `POST /api/opd-arrivals`) in Step 01 and transition directly into Step 02 showing the issued token, assigned doctor/department, **Print Token**, and a clear **`Complete Registration & Check In →`** CTA (`/reception/patients/new?arrival_id=<id>&doctor_id=<id>`). Existing walk-ins (`POST /appointments/walk-in`) and booked check-ins (`POST /appointments/{id}/check-in`) transition into Step 02 already marked **Checked In**.
- **Two-Step Layout (`A2`)**: Single-panel step swap inside the left card with a compact `01 Patient & Visit` → `02 Token` stepper. Step 01 fits above the fold with a compact inline next-token preview badge (removing the oversized token box and dead `Search patient` button); submitting swaps cleanly to Step 02 with a **Next patient** action to return to Step 01.
- **Print Action (`A3`)**: Add a **`Print Token`** button in Step 02 using the existing print-portal `<Modal print="receipt">` (`window.print()`). Do **not** add Billing & Receipt links here (Billing & Receipts stay in Billing & Checkout).
- **Compact Today's Appointments Panel (`A4`)**: Replace the 3 tall stat-card tabs (`All`, `To Arrive`, `Checked In`) with compact inline filter pills; narrow the 7-column `min-w-[900px]` table to **5 compact columns** (`Token`, `Patient` name only, `Doctor`, `Status`, `Action`); sequence actions clearly with `Register` (pending arrivals / unregistered arrivals) or `Check in` (unarrived bookings loading into Step 01) primary CTA and a compact controlled `More` menu for Priority / Reschedule / No-show / Cancel.

### Scope & Architecture Constraints

- Pure frontend change — no backend API, schema, permission, or database modifications required.
- Single file owner per task — zero overlapping edits across parallel tasks (`AGENTS.md`).
- Preserve existing prop contract between `TokenGenerationPage.tsx` and `TodayAppointmentsPanel.tsx` (`activeBookingId`, `canCheckIn`, `canRegister`, `canManage`, `onCheckIn`, `onRegisterArrival`, `onRegisterPatient`) so Wave 1 tasks execute safely in parallel.
- Reuse existing codebase primitives (`Modal` with `print="receipt"`, `PriorityBadge`, `formatToken`, `formatPaise`, `istToday`).
- **Strict TypeScript (`noUnusedLocals` & `noUnusedParameters`)**: Remove all dead helpers/constants (`isNewPatient`/`isNew` in T1, `REFERRAL_OPTIONS`/`useCheckInNewPatient`/`useBookAppointment` in T2) so `tsc -b` stays zero-error.
- **UX-04 Source Guard Compliance (`frontend/src/test/guards/guards.test.ts`, cap = 0)**:
  - Applies to ALL classes in `TokenGenerationPage.tsx` (including `TokenSlipModal`) and `TodayAppointmentsPanel.tsx` (neither is in `PRINT_ONLY`).
  - Never use sub-12px text (`text-[10px]`, `text-[11px]`, etc.); minimum is `text-xs` (`12px`).
  - Never use low-contrast greys (`text-neutral-300/400`, `text-slate-300/400`, even on `hover:`).
  - Never use failing white-background semantic classes (`text-red-500`, `text-emerald-600`, `text-amber-600`, `text-teal-600`); use `-700` or darker.
  - Every `<input>`, `<select>`, and `<textarea>` must have an accessible name.

## Prerequisites

- Node.js `>=22.22.2` with frontend dependencies installed (`frontend/node_modules`).
- Existing stack: React `19.3.1`, React Router `8.5.1`, TanStack Query `5.105.0`, Tailwind CSS `4.3.3`, Vitest `5.0.5`, oxlint `1.90.0`, TypeScript `7.0.2`.
- Keep `QueueTicketPreview.tsx` untouched (still covered by its standalone unit test in `token-generation.test.tsx`).

## Dependency Graph

```
T0 (Git Checkpoint) ──┬── T1 (TodayAppointmentsPanel + tests) ──┐
                      │                                         ├── T3 (TokenGenerationPage tests) ── T4 (Full Verification)
                      └── T2 (TokenGenerationPage two-step) ────┘
```

## Tasks

### T0: Record Pre-Batch Git Checkpoint

- **depends_on**: []
- **location**: Repository Git state (no source edits)
- **description**:
  - Inspect `git status` on `TokenGenerationPage.tsx`, `TodayAppointmentsPanel.tsx`, and their test files to preserve any existing user changes (`AGENTS.md`).
  - Record a non-destructive checkpoint via `git stash create "checkpoint: pre checkin-token simplification"` and pin it with `git update-ref refs/checkpoints/pre-checkin-token $sha`.
- **validation**:
  - Checkpoint SHA is recorded under `refs/checkpoints/pre-checkin-token` without modifying working tree files.
- **status**: Completed
- **log**: Captured non-destructive working-tree checkpoint via `git stash create` and pinned ref `refs/checkpoints/pre-checkin-token` -> `1733c40eadc68fbaa9375b49892e40d8db4d1441`. Noted pre-existing uncommitted edits on all 4 target files and preserved them.
- **files edited/created**: None (Git ref `refs/checkpoints/pre-checkin-token` only)

### T1: Compact `TodayAppointmentsPanel` & update its unit tests

- **depends_on**: [T0]
- **location**:
  - `frontend/src/components/checkin/TodayAppointmentsPanel.tsx`
  - `frontend/src/components/__tests__/today-appointments-panel.test.tsx`
- **description**:
  - **Compact Header & Inline Filter Pills**:
    - Keep `Today's appointments` heading, `Refresh` button, and compact subtitle: `{formatDisplayDate(today)} · {selectedDoctorName}` plus `· {counts.arrive + counts.checked} active · {counts.cancelled} cancelled` whenever `counts.cancelled > 0`.
    - Replace the 3 tall `grid-cols-3` stat-card tabs with a single compact inline segmented tablist (`role="tablist"`, `aria-label="Which appointments"`), rendering `All (N)`, `To Arrive (N)`, `Checked In (N)` on a single horizontal strip.
    - Preserve exact roving `tabIndex` (`0` on selected, `-1` on others), `aria-selected`, default active tab (`To Arrive`), and `ArrowRight` / `ArrowLeft` / `Home` / `End` keyboard navigation.
    - Keep search input (`Search name, URN, mobile or token`) and doctor filter dropdown in one compact toolbar row (`min-h-9`). Search still filters by name, URN, mobile, and token even though mobile/URN are not repeated in the Patient column.
  - **Fix `To arrive` vs `Checked In` Classification**:
    - In `isCheckedIn(a, pendingArrival)`:
      - First return `false` if `isCancelled(a) || pendingArrival != null || a.status === 'RESCHEDULED'`.
      - Next return `false` early (BEFORE checking `Boolean(a.patient_urn)` or `visit_kind`) when `(a.status === 'BOOKED' || a.status === 'NO_SHOW') && a.token_number == null && a.consultation_status == null` so unarrived phone/advance bookings (including `FOLLOW_UP` bookings) stay in `To Arrive` rather than being falsely labelled `Checked In`.
      - Preserve promotion to `Checked In` for `REGISTERED`, `ARRIVED`, `CHECKED_IN`, `WAITING`, `IN_CONSULTATION`, `DONE`, `COMPLETED`, active `consultation_status` (`WAITING` / `IN_CONSULTATION` / `COMPLETED`), and tokenized non-cancelled existing-patient entries (e.g., `TO_ARRIVE` with `visit_kind: 'FOLLOW_UP'` and `token_number != null`).
    - In `isAwaitingArrival(a, pendingArrival)`: return `false` if `isCancelled(a) || a.status === 'RESCHEDULED'`, else `!isCheckedIn(a, pendingArrival)`.
  - **Reduce Table to 5 Compact Columns & Prevent Menu Clipping**:
    - Remove `min-w-[900px]`, remove `Patient Type` column, remove unused `isNewPatient` helper and `isNew` local variable (`noUnusedLocals`), and drop Patient mobile/URN/age sub-lines.
    - Use `overflow-x-auto xl:overflow-visible` on the table wrapper (and keep vertical scrolling on the panel container without clipping a 1–2 row table's `More` menu).
    - Render 5 columns:
      1. `Token` (`#01` / `A-01` / `—`)
      2. `Patient` (patient name only — `pendingArrival?.full_name ?? a.patient_name`)
      3. `Doctor` (doctor name + subtle department sub-line if present)
      4. `Status` (compact status pill `To arrive` / `Checked In` / `Cancelled` + `<PriorityBadge level={a.priority_level} reason={a.priority_reason} />` shown only when `PRIORITY` or `EMERGENCY`, omitting noisy `Normal` badges on every row)
      5. `Action` (sequenced primary CTA + controlled `More` menu)
    - Update `colSpan` on the `PriorityModal` and inline action form `<tr>` rows from `7` to `5`.
  - **Clear, Sequenced Row Actions & Backend-Valid `More` Menu**:
    - Lift `openMenuKey: string | null` state to `TodayAppointmentsPanel` so only one row's menu can be open at once; reset `openMenuKey` (and `action`) when `view`, `doctorFilter`, or `search` changes.
    - **Locked ARIA contract for `More` menu (shared with T3)**:
      - Trigger: `<button ref={moreButtonRef} type="button" aria-haspopup="menu" aria-expanded={menuOpen} onClick={...}>More</button>`
      - Popup: `<div role="menu" ...>` (closes immediately on item selection, `Escape` returning focus to `More`, or outside `pointerdown`)
      - Menu items: `<button type="button" role="menuitem" ...>`
      - Keep the `More` trigger button mounted while `action === 'priority'` (menu closed) so `moreButtonRef.current?.focus()` reliably restores focus when `PriorityModal` closes.
    - **Primary CTA by row type**:
      - Pending arrival (`pendingArrival != null && isAwaiting`): `Register` button (when `canRegister`, calls `onRegisterArrival(pendingArrival)`).
      - Unarrived bookable appointment (`!pendingArrival && isAwaiting && (a.status === 'BOOKED' || a.status === 'NO_SHOW')`): `Check in` button (when `canCheckIn && onCheckIn`, calls `onCheckIn(a)`).
      - Non-pending unregistered `TO_ARRIVE` appointment (`!pendingArrival && isAwaiting && a.status !== 'BOOKED' && a.status !== 'NO_SHOW'`): `Register` button (when `canRegister && onRegisterPatient`, calls `onRegisterPatient(a)` — preserves `onRegisterPatient` usage).
      - Checked-in / Cancelled rows: no primary CTA button (only `More` menu when applicable, else `—`).
    - **`More` menu items strictly gated by backend `BOOKING_TRANSITIONS` (`appointment_service.py:174-187`)**:
      - `Change priority`: when `a.token_number != null && !isCancelledRow && canManage`.
      - `No-show`: when `!pendingArrival && canManage && (a.status === 'BOOKED' || a.status === 'TO_ARRIVE')`.
      - `Reschedule`: when `!pendingArrival && canManage && (a.status === 'BOOKED' || a.status === 'NO_SHOW' || a.status === 'TO_ARRIVE')`.
      - `Cancel arrival`: when `pendingArrival != null && isAwaiting && (canManage || canRegister)`.
      - `Cancel booking`: when `!pendingArrival && canManage && (a.status === 'BOOKED' || a.status === 'TO_ARRIVE' || a.status === 'REGISTERED')` *(NEVER offered on `NO_SHOW` — backend rejects with 422)*.
    - **Fix `CancelForm` copy**: Use `pendingArrival ? 'arrival' : 'booking'` for title (`Cancel ${name}'s arrival` vs `Cancel ${name}'s booking`) and submit label (`Cancel arrival` vs `Cancel booking`).
  - **Unit Tests (TDD RED → GREEN)**:
    - Update and expand `frontend/src/components/__tests__/today-appointments-panel.test.tsx`:
      - Update line 199 (remove `'Existing patient'` assertion; add negative assertions that `Patient Type` column and URN/mobile/age sub-lines are absent in table cells while search by URN/mobile still works).
      - Update line 272 (assert `'1 active · 1 cancelled'` in the header subtitle rather than inside the `All` tab button).
      - Update `Change priority` tests (open row's `More` button → click `role="menuitem"` `Change priority`; verify `PriorityModal` mandatory reason validation and focus return to `More`; verify untokened row has no `Change priority` menuitem).
      - Add tests for: unarrived `BOOKED` appointment (with `patient_urn` and `token_number: null`, including `visit_kind: 'FOLLOW_UP'`) appearing under `To Arrive` with `Check in` primary CTA calling `onCheckIn(appt)`; `NO_SHOW` row showing `Check in` and `Reschedule` in `More` without `Cancel booking`; non-pending `TO_ARRIVE` row calling `onRegisterPatient`; pending arrival showing `Register` primary CTA + `More` → `Cancel arrival`.
      - Preserve all roving-tabindex keyboard navigation (`ArrowRight`, `ArrowLeft`, `Home`, `End`), status badge colors, error-alert, and `REGISTERED` / tokenized `FOLLOW_UP` promotion tests.
- **validation**:
  - `npm --prefix frontend test -- src/components/__tests__/today-appointments-panel.test.tsx src/test/guards/guards.test.ts` passes (RED → GREEN).
  - `npm --prefix frontend exec -- oxlint src/components/checkin/TodayAppointmentsPanel.tsx src/components/__tests__/today-appointments-panel.test.tsx` exits `0`.
  - *(Repo-wide `tsc -b` runs right after Wave 1 joins before Wave 2 commit so parallel T1/T2 never race.)*
- **status**: Completed
- **log**: Compacted `TodayAppointmentsPanel.tsx` (inline filter pills keeping roving `tabIndex` & keyboard nav, active/cancelled breakdown in subtitle, 5-column table removing `Patient Type` and URN/mobile/age repetition, fixed `isCheckedIn` for unarrived `BOOKED`/`NO_SHOW` + `RESCHEDULED`, sequenced primary CTAs `Register`/`Check in` + controlled `More` menu gated by backend `BOOKING_TRANSITIONS`, `CancelForm` arrival/booking copy, non-clipping wrapper, focus restoration after `PriorityModal`). TDD RED (10 failed / 14 passed) -> GREEN (24/24 `today-appointments-panel.test.tsx`, 7/7 `guards.test.ts`, 0 `oxlint` warnings/errors, `tsc -b` exit 0 after Wave 1 join). Committed as latest Wave 1 commit.
- **files edited/created**: `frontend/src/components/checkin/TodayAppointmentsPanel.tsx`, `frontend/src/components/__tests__/today-appointments-panel.test.tsx`

### T2: Refactor `TokenGenerationPage` into compact Two-Step (`01 → 02`) workflow with printable Token Slip

- **depends_on**: [T0]
- **location**:
  - `frontend/src/pages/TokenGenerationPage.tsx`
- **description**:
  - **Cleanup & Layout**:
    - Remove dead/unused code so `tsc -b` (`noUnusedLocals`) passes cleanly: `useCheckInNewPatient`, `useBookAppointment`, `REFERRAL_OPTIONS`, and their unused references in `busy`.
    - Import `Modal` from `../components/Modal` and `IconPrinter` from `../components/icons`.
    - Keep the `xl:` 2-column breakpoint (`grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(22rem,25rem)_minmax(0,1fr)]`) so 1024–1279px screens with the `256px` sidebar do not crush `TodayAppointmentsPanel`.
    - **Preserve `location.state?.notice` banner**: Keep `locationNotice`, `notice` state, and the dismissible `role="status"` banner (used when `PatientRegister.tsx` redirects back to `/reception/tokens`); simply stop calling `setNotice(...)` inside `mode === 'new'` submit now that Step 02 shows the issued arrival token directly.
    - Change the outer left card from `<form>` to `<section aria-labelledby="check-in-form-heading">`, wrapping `<form onSubmit={handleSubmit}>` around **Step 01 (`!issued`) ONLY** so React 19 portal events from `TokenSlipModal` never bubble into `<form>`.
    - Remove the top-level `IssuedCard` banner above the grid.
  - **Compact Two-Step Stepper Header**:
    - Display a compact 2-step progress strip at the top of the left card:
      - `01 Patient & Visit` (active styling when `!issued`, completed checkmark when `issued != null`)
      - `02 Token & Check-in` (active styling when `issued != null`)
    - Keep `Clear form` button in the header when in Step 01 and any field is populated.
  - **Step 01 (`!issued`) — Compact, Above-the-Fold Registration / Selection Form**:
    - Tighten card padding (`p-4`), section spacing (`space-y-3`), label styling (`text-xs font-semibold text-slate-700 mb-1`), and input height (`min-h-10`) to reclaim vertical space so the primary submit CTA stays visible above the fold.
    - Keep `New patient` / `Existing patient` `Segmented` toggle (`aria-label="Patient type"`).
    - **New patient**: Name, Age + Phone 2-column row, duplicate alert with `Use this patient` / `Different patient with same phone number`.
    - **Existing patient**:
      - Remove the dead no-op `<button onClick={() => {}}>Search patient</button>` from `PatientSearch`; keep live search input (`aria-label="Search patient by URN, name or mobile"`), clear button, and results list.
      - Keep compact `SelectedPatientCard`, `Consultation type *` segmented toggle (`New consultation` | `Follow-up / Revisit`), and today's booked-appointments banner.
      - Preserve `missing` logic (`visitKind` required only when `booking != null`, not for walk-ins, matching existing contract).
    - **Doctor, Priority & Optional Remarks**:
      - Keep `Consulting doctor *` grouped by department `<optgroup>` + compact single-line fee summary.
      - Keep `Priority *` select (`Normal`, `High`, `Emergency`) + conditional `Reason for emergency/priority *` input when `priority !== 'NORMAL'`.
      - Keep compact optional `Remarks (optional)` input (hidden when checking in a booking).
    - **Compact Inline Next-Token Preview + Always-Visible Primary CTA**:
      - Replace the oversized `p-4` + `text-3xl` green preview box with a compact single-row inline bar (`px-3 py-2 rounded-xl border border-emerald-200 bg-emerald-50/60 flex items-center justify-between`):
        - Left: `Next available token` + `Preview only`
        - Right: `<span data-testid="next-token-preview" className="font-mono text-xl font-black text-emerald-800">...</span>`
      - Show concise `Still needed: ...` hint when `missing.length > 0`.
      - Primary submit button (`min-h-11 w-full`):
        - New patient arrival (`mode === 'new'`): `Generate Token`
        - Existing patient walk-in or booked check-in: `Check in & Generate Token`
  - **Step 02 (`issued != null`) — Automatic Token Generation & Printable Slip**:
    - Extend `Issued` discriminated union:
      - `{ kind: 'arrival'; arrival: OpdArrival; departmentName: string | null; cabinCode: string | null }` (returned by `POST /api/opd-arrivals`). Immediately clear new-patient form inputs (`fullName`, `ageYears`, `mobile`, `notDuplicate`, `priority`, `priorityReason`, `remarks`) on success so toggling back later never leaks prior demographics.
      - `{ kind: 'checked_in'; appointment: Appointment; departmentName: string | null; cabinCode: string | null }` (returned by `POST /appointments/walk-in` or `POST /appointments/{id}/check-in`).
    - Render Step 02 directly inside the left `<section>` card (outside `<form>`):
      - Status badge: `To arrive · Pending full registration` (amber) for `kind === 'arrival'`, or `Checked In · Waiting for doctor` (emerald) for `kind === 'checked_in'`.
      - Prominent token display (`data-testid="issued-token"`): formatted via `formatToken(tokenNumber, cabinCode)`.
      - Summary block: Patient name (+ URN for `checked_in`), Assigned doctor + department, `PriorityBadge` (when non-Normal), Consultation type (for `checked_in`).
      - **Actions (strictly per A1 & A3 — NO Billing/Receipt link)**:
        - For `kind === 'arrival'`:
          - Primary CTA: `<Link to={`/reception/patients/new?arrival_id=${arrival.id}&doctor_id=${arrival.doctor_id}`}>Complete Registration &amp; Check In →</Link>`
          - Secondary: `Print Token` button (opens `<TokenSlipModal>`) and `Next patient` button (calls `resetAll()` → returns to Step 01).
        - For `kind === 'checked_in'`:
          - Primary CTA: `Check in next patient` button (calls `resetAll()` → returns to Step 01).
          - Secondary: `Print Token` button (opens `<TokenSlipModal>`) and `<Link to={`/reception/patients/${a.patient_id}`}>Patient file</Link>`.
    - **State Cleanup & `takeBooking` Priority Seeding**:
      - Clear `setPrintOpen(false)` in **both** `resetAll()` and `takeBooking()`.
      - In `takeBooking(b)`: after `resetVisit()`, seed `setPriority(b.priority_level ?? 'NORMAL')` and `setPriorityReason(b.priority_reason ?? '')` so high-priority bookings are not silently downgraded.
    - **`TokenSlipModal` (Reusable Print-Portal Dialog, Rendered Outside `<form>`)**:
      - Uses `<Modal open={printOpen} onClose={() => setPrintOpen(false)} print="receipt" variant="info" title="Print OPD Token" className="max-w-sm">`.
      - Do **not** add a duplicate footer `Close` button (rely on `Modal`'s built-in `✕` Close button + Esc). Put `data-autofocus` on `Print Slip` (`onClick={() => window.print()}`).
      - Do **not** reuse `data-testid="issued-token"` inside the modal (use `data-testid="print-slip-token"`).
      - Constrain print box width with `print:mx-auto print:max-w-sm print:border print:p-6` so A4 `@page receipt` does not stretch the slip full-width.
      - Keep all classes UX-04 compliant (`>= 12px`, no `slate-400`/`neutral-400`/`emerald-600`).
    - Preserve URL preset hydration (`?patient_id=&appointment_id=`) from Appointments / Dashboard.
- **validation**:
  - `reason_not_testable`: `token-generation.test.tsx` is owned by T3 (Wave 2).
  - `npm --prefix frontend exec -- oxlint src/pages/TokenGenerationPage.tsx` exits `0`.
  - `npm --prefix frontend test -- src/test/guards/guards.test.ts` passes (UX-04 cap = 0).
  - *(Repo-wide `tsc -b` runs right after Wave 1 joins before Wave 2.)*
- **status**: Completed
- **log**: Refactored `TokenGenerationPage.tsx` into compact two-step (`01 Patient & Visit` -> `02 Token & Check-in`) workflow inside `<section>` with `<form>` around Step 01 only, removed dead `Search patient` button & unused hooks/constants, kept `xl:` 2-col grid and `location.state?.notice` banner, added compact inline `next-token-preview`, swapped left card cleanly to Step 02 (`arrival` with `Complete Registration & Check In ->` + `Print Token` + `Next patient`; `checked_in` with `Check in next patient` + `Print Token` + `Patient file`, NO Billing link), and added `TokenSlipModal` via shared `<Modal print="receipt">`. Verified via `oxlint` (0 warnings/errors), `guards.test.ts` (7/7 GREEN), and `tsc -b` (exit 0 after Wave 1 join); unit tests owned by T3 (`reason_not_testable`). Committed as latest Wave 1 commit.
- **files edited/created**: `frontend/src/pages/TokenGenerationPage.tsx`

### T3: Update and expand `TokenGenerationPage` integration tests

- **depends_on**: [T1, T2]
- **location**:
  - `frontend/src/pages/__tests__/token-generation.test.tsx`
- **description**:
  - Fix the 2 pre-existing `oxlint` `unicorn(prefer-string-starts-ends-with)` warnings on lines 146 & 148 (`url.endsWith('/api/patients/101')` and `url.endsWith('/api/appointments/501')`).
  - Keep existing `QueueTicketPreview Component` unit test passing.
  - Update and expand `Check-in & Token desk` tests to cover the full two-step workflow and compact table integration:
    1. **Two-step indicator & compact Step 01**: Step `01` active initially, `New patient` / `Existing patient` toggle works, dead `Search patient` button is absent, compact inline `next-token-preview` updates from `#--` to `#2` upon choosing doctor.
    2. **New patient (`01 → 02` arrival flow)**: Submitting 3-field new patient sends `POST /api/opd-arrivals`, swaps left card to Step `02` showing `issued-token` (`#14`), doctor/department, `To arrive` status, `Complete Registration & Check In` link (`/reception/patients/new?arrival_id=900&doctor_id=10`), `Print Token` button, and `Next patient` button that resets back to Step `01` with cleared inputs (asserting NO Billing/Receipt link).
    3. **Existing patient walk-in (`01 → 02` checked-in flow)**: Submitting walk-in sends `POST /api/appointments/walk-in`, swaps left card to Step `02` showing `Checked In`, `issued-token` (`#14`), doctor/department, `Print Token`, `Patient file`, `Check in next patient`, and NO Billing/Receipt link.
    4. **Print Token slip modal**: Spy on `window.print` (`vi.spyOn(window, 'print').mockImplementation(() => {})`); clicking `Print Token` opens `Print OPD Token` dialog with `print-slip-token`, patient & doctor details; clicking `Print Slip` invokes `window.print()`; clicking built-in `Close` dismisses the modal cleanly.
    5. **Direct `Check in` from Today's Appointments table**: Unarrived `BOOKED` appointment appears under `To Arrive` (default tab) with a `Check in` button; clicking it loads the booking into Step `01` (preserving any non-Normal priority), and submitting sends `POST /api/appointments/501/check-in` and lands in Step `02` (`Checked In`).
    6. **Emergency priority validation, duplicate patient detection, duplicate-booking 409 recovery, open-visit 409 refusal, URL preset (`?patient_id=101&appointment_id=501`), `location.state.notice` banner preservation, and `More` (`role="menuitem"`) → `No-show` action** all verified green.
- **validation**:
  - `npm --prefix frontend test -- src/pages/__tests__/token-generation.test.tsx src/components/__tests__/today-appointments-panel.test.tsx` passes 100%.
  - `npm --prefix frontend run typecheck` exits `0`.
  - `npm --prefix frontend exec -- oxlint src/pages/__tests__/token-generation.test.tsx` exits `0`.
- **status**: Completed
- **log**: Updated and expanded `token-generation.test.tsx` (13 tests total: `QueueTicketPreview` + 12 integration tests covering 2-step indicator, compact Step 01, new-patient arrival 01->02 & reset, existing walk-in 01->02, Print Token modal + `window.print()`, table `Check in` preserving priority -> Step 01 -> Step 02, `location.state.notice`, emergency/duplicate/409 flows, `More` -> `No-show`, and fixed 2 pre-existing `oxlint` warnings). Verified: `37/37` tests passed across both files, `tsc -b` exit 0, `oxlint` 0 warnings/0 errors. Committed as latest HEAD.
- **files edited/created**: `frontend/src/pages/__tests__/token-generation.test.tsx`

### T4: Full frontend verification & live browser check

- **depends_on**: [T1, T2, T3]
- **location**:
  - `frontend/` (read-only verification across all modules)
- **description**:
  - Run the complete frontend quality gate:
    - `npm --prefix frontend run typecheck`
    - `npm --prefix frontend run lint` (0 errors, 0 warnings across entire repo)
    - `npm --prefix frontend test`
    - `npm --prefix frontend run build`
  - Attempt read-only live UI check on `http://localhost:5173/reception/tokens` if Chrome remote debugging is enabled; otherwise provide concise manual visual verification checklist confirming Step 01 fits above the fold at 1366×768/1440×900, Step 02 token slip & Print Token modal work cleanly, and Today's Appointments fits without horizontal scrolling.
- **validation**:
  - All 4 npm checks (`typecheck`, `lint`, `test`, `build`) exit with code `0`.
- **status**: Partially Completed (Automated Gate Passed; Live Browser Deferred)
- **log**: Automated frontend gate exited 0 across all 4 checks: `npm --prefix frontend run typecheck` (exit 0), `npm --prefix frontend run lint` (`Found 0 warnings and 0 errors` on 197 files), `npm --prefix frontend test` (`75 passed (75)` test files, `540 passed | 5 skipped (545)` tests, including `guards.test.ts`, `today-appointments-panel.test.tsx`, `token-generation.test.tsx`), and `npm --prefix frontend run build` (`built in 4.39s`). Live Chrome browser visual check on `http://localhost:5173/reception/tokens` was deferred because Chrome remote debugging (`chrome://inspect/#remote-debugging`) is not enabled on this workstation; manual visual checklist provided in summary.
- **files edited/created**: None (verification only)

## Parallel Execution Groups

| Wave | Tasks | Can Start When |
| ------ | ------- | ---------------- |
| 0 | T0 | Immediately (Git checkpoint) |
| 1 | T1, T2 | T0 complete (non-overlapping file ownership: `TodayAppointmentsPanel.tsx`+test vs `TokenGenerationPage.tsx`; run `typecheck` once Wave 1 joins) |
| 2 | T3 | T1 and T2 complete |
| 3 | T4 | T1, T2, T3 complete |

## Testing Strategy

- **Unit & Integration Tests (Vitest + React Testing Library)**:
  - `frontend/src/components/__tests__/today-appointments-panel.test.tsx` — Compact inline tablist + keyboard navigation, 5-column non-duplicative layout, `BOOKED`/`NO_SHOW` `To Arrive` classification & `Check in` CTA, `Register` CTA (both pending arrivals and non-pending `TO_ARRIVE`), controlled `More` menu (`role="menu"`/`role="menuitem"`) gated by backend transitions, `PriorityModal` validation & focus return.
  - `frontend/src/pages/__tests__/token-generation.test.tsx` — Step 01 compact form & inline token preview, Step 01 → Step 02 transitions for new-patient arrival (`Complete Registration & Check In →`) and existing/booked check-ins (`Checked In`), `Print Token` print-portal dialog & `window.print()`, table `Check in` → Step 01 loading, `location.state.notice` banner preservation, error handling, and `QueueTicketPreview` regression.
  - `frontend/src/test/guards/guards.test.ts` — UX-04 contrast/font-size/accessible-name guard (cap = 0).
- **Static & Production Build Gate**:
  - `npm --prefix frontend run typecheck`
  - `npm --prefix frontend run lint`
  - `npm --prefix frontend test`
  - `npm --prefix frontend run build`

## Risks & Mitigations

- **Risk**: Backend `BOOKING_TRANSITIONS` rejects `CANCELLED` from `NO_SHOW` (`422 invalid_status_transition`) and `NO_SHOW`/`RESCHEDULED` from `REGISTERED`.
  - **Mitigation**: T1 gates every `More` menu action strictly to the allowed backend statuses (`appointment_service.py:174-187`).
- **Risk**: Changing `isCheckedIn` so unarrived `BOOKED` appointments with `patient_urn` stay in `To Arrive` could break `REGISTERED` or tokenized `FOLLOW_UP` promotion.
  - **Mitigation**: T1 applies the early `return false` strictly to `(BOOKED || NO_SHOW) && token_number == null && consultation_status == null` (plus `RESCHEDULED`), verified directly by `today-appointments-panel.test.tsx`.
- **Risk**: Controlled `More` menu gets vertically clipped inside an `overflow-x-auto` table wrapper on 1–2 row tables, or loses focus restoration when `PriorityModal` closes.
  - **Mitigation**: T1 uses `overflow-x-auto xl:overflow-visible`, lifts `openMenuKey` to reset on filter/tab switches, and keeps the `More` trigger mounted while `action === 'priority'` for focus return.
- **Risk**: Rendering `<TokenSlipModal>` inside `<form>` or duplicating `Close` / `data-testid="issued-token"` causes React 19 portal submit bubbling or brittle test queries; leaving `.print-portal` mounted while closed blanks other prints.
  - **Mitigation**: T2 wraps `<form>` around Step 01 only, renders `<TokenSlipModal>` via shared `<Modal print="receipt">` outside `<form>`, omits any redundant footer `Close` button, uses `data-testid="print-slip-token"`, and puts `data-autofocus` on `Print Slip`.
- **Risk**: Removing `IssuedCard`'s `setNotice` on arrival submit might accidentally remove the `location.state?.notice` banner used by `PatientRegister.tsx` redirects.
  - **Mitigation**: T2 explicitly preserves `locationNotice` / `notice` banner and T3 tests it.
