# Plan: Reception Dashboard Command Center Streamlining

**Generated**: 2026-11-17

## Overview

Refactor the Reception Dashboard (`/reception`) from a duplicated queue-management workspace into a compact **Reception Command Center** that answers three operational questions at a glance:

1. **What is happening right now?** — Six compact KPI cards, streamlined Doctor Workload rows, and a 5-row active-only Live Queue preview.
2. **What needs attention?** — Accurate alert count and direct action links in the Needs Attention banner.
3. **Where should I go next?** — Every KPI card, Needs Attention item, Doctor Workload row, and Live Queue preview header routes directly to its owning reception workspace (`/reception/waiting`, `/reception/tokens`, `/reception/appointments`, `/reception/billing?tab=dues`, `/reception/reports`), with `?doctor_id=` deep-linking in Waiting Room.

### Confirmed Product Decisions

- **Header CTAs**: Remove all three duplicated header CTA buttons (`+ New Patient`, `Check-in & Token`, `Counter Checkout`); keep only freshness timestamps and the manual Refresh button (all workflows already live in the left sidebar).
- **Live Queue Preview**: Show active queue only (`Waiting` + `In Cabin`), ordered by priority/token, capped at 5 rows. Exclude `CANCELLED`, `NO_SHOW`, `RESCHEDULED`, `DONE`/`COMPLETED`, and unarrived `BOOKED`/`TO_ARRIVE`/`REGISTERED` rows. Remove search, status filter tabs, doctor dropdown, row action buttons, and Print/Cancel modals. Provide an `Open Waiting Room →` link.
- **Navigation Routing**: All KPI cards, Needs Attention alerts, and Doctor Workload rows navigate directly to their owning module (including `/reception/waiting?doctor_id=<id>`).
- **Doctor Workload**: Condense into compact rows per doctor showing live load only (`Waiting`, `In Cabin`, and `Next` token), dropping the tall 3-box grid and redundant `Done` tile.

### Scope & Architecture Constraints

- Pure frontend change — no backend API, schema, permission, or database modifications required (`GET /reception/overview`, `GET /appointments`, and `GET /doctors` already provide all required fields).
- Single file owner per task — zero overlapping edits across parallel tasks (`AGENTS.md`).
- Reuse existing codebase utilities (`formatPaise` from `frontend/src/format.ts`, `PriorityBadge` from `frontend/src/components/checkin/PriorityBadge.tsx`, `useSearchParams` from `react-router`).
- **UX-04 Source Guard Compliance (`frontend/src/test/guards/guards.test.ts`, cap = 0)**:
  - Never use sub-12px text classes (`text-[10px]`, `text-[11px]`, `text-[0.7rem]`, etc.). Minimum is `text-xs` (`12px`).
  - Never use low-contrast greys (`text-neutral-300/400`, `text-slate-300/400`, etc., even on `hover:`).
  - Never use failing white-background semantic classes (`text-red-500`, `text-emerald-600`, `text-amber-600`, `text-teal-600`); use `-700` or darker.
  - Every `<input>`, `<select>`, `<textarea>` must have an accessible name.

## Prerequisites

- Node.js `>=22.22.2` with frontend dependencies installed (`frontend/node_modules`).
- Existing stack: React `19.3.1`, React Router `8.5.1`, TanStack Query `5.105.0`, Tailwind CSS `4.3.3`, Vitest `5.0.5`, oxlint `1.90.0`, TypeScript `7.0.2`.
- Local backend API + Vite dev server available with a non-production test `RECEPTION` user for T4 browser verification.

## Dependency Graph

```
T0 (Git Checkpoint) ──┬── T1 (WaitingRoom ?doctor_id= + tests) ───────────────────────┐
                      │                                                               ├── T4 (Full Verification & UI Smoke)
                      └── T2 (ReceptionDashboard refactor) ── T3 (Dashboard tests) ───┘
```

## Tasks

### T0: Record Pre-Batch Git Checkpoint

- **depends_on**: []
- **location**: Repository Git state (no source edits)
- **description**:
  - Inspect `git status` to preserve any existing user changes in the workspace (`AGENTS.md`).
  - Record a Git checkpoint commit or tag/branch reference before dispatching Wave 1 so the entire repair batch can be cleanly diffed or rolled back.
- **validation**:
  - `git status` confirms no unexpected changes in `ReceptionDashboard.tsx` or `WaitingRoom.tsx`, and checkpoint ref is logged.
- **status**: Completed
- **log**: Captured non-destructive working-tree checkpoint via `git stash create` and stored ref `refs/checkpoints/pre-reception-dashboard` -> `7efa9631593ae5e9b5712822e86244ed5769f270`. Preserved all pre-existing workspace changes.
- **files edited/created**: None (Git ref `refs/checkpoints/pre-reception-dashboard` only)

### T1: Add `?doctor_id=` URL query-parameter support to Waiting Room

- **depends_on**: [T0]
- **location**:
  - `frontend/src/pages/WaitingRoom.tsx`
  - `frontend/src/pages/__tests__/waiting-room.test.tsx`
- **description**:
  - Import `useSearchParams` from `react-router` in `WaitingRoom.tsx`.
  - Remove `useState('')` for `doctorFilter`; derive `doctorFilter` directly from `searchParams.get('doctor_id')` so browser Back/Forward and in-app navigation between `/reception/waiting?doctor_id=1` and `?doctor_id=2` always stay in sync.
  - Validate the query param against `/^[1-9]\d*$/` (rejecting `'0'`, leading zeros like `'02'`, and non-numeric strings so `String(a.doctor_id) === doctorFilter` never silently mismatches).
  - Guard unknown or failed doctor lookups without relying on `doctors.isSuccess` (the existing test mock in `waiting-room.test.tsx` returns `{ data: [...] }` without `isSuccess`):
    - If `doctors.isError && !doctors.data`, fall back to `''` (All doctors) so the user is never trapped in a desynced filter where `<select>` displays "All doctors" and `onChange` cannot clear it.
    - If `doctors.data !== undefined` and no doctor in `doctors.data` matches `rawDoctorId`, fall back to `''` (All doctors).
    - While `doctors.data === undefined && !doctors.isError` (loading), preserve the validated `rawDoctorId` to avoid an unfiltered flash.
  - When the user changes the `Doctor` `<select>`, update `searchParams` via functional updater `setSearchParams((prev) => { ... }, { replace: true })` (setting `doctor_id` when non-empty or deleting it when cleared) so reload preserves the filter without cluttering Back history.
  - Add unit tests in `frontend/src/pages/__tests__/waiting-room.test.tsx` using `MemoryRouter initialEntries={...}` covering:
    1. Pre-filtering cards and `<select>` value to Dr. Bharati when `/reception/waiting?doctor_id=2` is opened.
    2. Falling back to all doctors for invalid (`?doctor_id=abc`, `?doctor_id=0`, `?doctor_id=02`) and unknown (`?doctor_id=999`) doctor IDs.
    3. Falling back to all doctors when `useDoctors` returns `isError: true` and `data: undefined`.
    4. Changing the Doctor `<select>` updates the displayed queue and retains existing filter-persistence assertions after Cancel consultation.
- **validation**:
  - `npm --prefix frontend test -- src/pages/__tests__/waiting-room.test.tsx src/test/guards/guards.test.ts` passes.
  - `npx --prefix frontend oxlint src/pages/WaitingRoom.tsx src/pages/__tests__/waiting-room.test.tsx` exits `0`.
  - *(Repo-wide `tsc -b` runs after Wave 1 joins in T3/T4 to avoid racing with T2.)*
- **status**: Completed
- **log**: Implemented `?doctor_id=` derived state via `useSearchParams` (`/^[1-9]\d*$/` validation, `doctors.isError` & unknown-doctor fallback, `{ replace: true }` functional updater). TDD RED (3 failed / 15 passed) -> GREEN (18/18 `waiting-room.test.tsx`, 7/7 `guards.test.ts`, 0 `oxlint` warnings/errors). Committed as `90930f48`.
- **files edited/created**: `frontend/src/pages/WaitingRoom.tsx`, `frontend/src/pages/__tests__/waiting-room.test.tsx`

### T2: Refactor `ReceptionDashboard` into a compact Reception Command Center

- **depends_on**: [T0]
- **location**:
  - `frontend/src/pages/ReceptionDashboard.tsx`
- **description**:
  - **Imports, Hooks & Cleanup**:
    - Reuse `formatPaise` from `../format` instead of the local duplicate helper.
    - Import `PriorityBadge` from `../components/checkin/PriorityBadge`.
    - Change `useDoctors(false)` to `useDoctors(true)` so the Doctor Workload fallback only lists active doctors (matching `areas.py` `_doctors_today` and `WaitingRoom.tsx` `useDoctors(true)`).
    - Remove unused imports and state: `useNavigate`, `Modal`, `useUpdateAppointmentStatus`, `AppointmentStatus`, `IconSearch`, `IconPrinter`, `IconTicket`, `IconX`, `IconWallet`, `statusFilter`, `doctorFilter`, `searchQuery`, `onlyDelayed`, `cancellingAppt`, `cancelReason`, `printTokenAppt`, `conflictError`, `handleConfirmCancel`.
    - Guard `getElapsedMinutes(isoString?: string | null)`: return `0` when `!isoString` or `Number.isNaN(Date.parse(isoString))` so `"NaN min waiting"` can never render.
    - Wrap `handleManualRefresh` in `try / finally` so `setIsRefreshing(false)` always executes even if a refetch rejects unexpectedly.
  - **Status Classification & Active Queue Preview Logic**:
    - Define explicit status helpers:
      - `isCancelledOrClosed(appt)`: `status` or `consultation_status` is `CANCELLED`, `NO_SHOW`, or `RESCHEDULED`.
      - `isCompletedAppointment(appt)`: `!isCancelledOrClosed(appt)` and (`status === 'DONE' || status === 'COMPLETED' || consultation_status === 'COMPLETED'`).
      - `isInCabinAppointment(appt)`: `!isCancelledOrClosed(appt) && !isCompletedAppointment(appt)` and (`status === 'IN_CONSULTATION' || consultation_status === 'IN_CONSULTATION'`).
      - `isWaitingAppointment(appt)`: `!isCancelledOrClosed(appt) && !isCompletedAppointment(appt) && !isInCabinAppointment(appt)` and (`status === 'ARRIVED' || status === 'CHECKED_IN' || status === 'WAITING' || consultation_status === 'WAITING'`).
      - `isBookedAppointment(appt)`: `!isCancelledOrClosed(appt) && !isCompletedAppointment(appt) && !isInCabinAppointment(appt) && !isWaitingAppointment(appt)` and (`status === 'BOOKED' || status === 'TO_ARRIVE' || status === 'REGISTERED'`).
    - Compute KPI/alert lists: `waitingAppts`, `inConsultationAppts`, `doneAppts`, `bookedAppts`, and `delayedAppts` (`waitingAppts` with elapsed `>= 30` min).
    - Sort `waitingAppts` using a safe suggested-order comparator: `SUGGESTED_RANK[a.priority_level ?? 'NORMAL'] ?? 2` (`EMERGENCY: 0, PRIORITY: 1, NORMAL: 2`), for `EMERGENCY` compare `Date.parse(priority_updated_at ?? status_updated_at)` with `Number.MAX_SAFE_INTEGER` fallback on `NaN`, tie-break by `(a.token_number ?? Number.MAX_SAFE_INTEGER) - (b.token_number ?? Number.MAX_SAFE_INTEGER)`.
    - Sort `inConsultationAppts` by `(a.token_number ?? Number.MAX_SAFE_INTEGER) - (b.token_number ?? Number.MAX_SAFE_INTEGER)`.
    - Build `activeQueue = [...sortedWaitingAppts, ...sortedInConsultationAppts]` and `previewQueue = activeQueue.slice(0, 5)` (`PREVIEW_LIMIT = 5`).
  - **1. Compact Header Toolbar**:
    - Keep `Reception Dashboard` heading, `Front Desk & Reception Command Center` subtitle, `Queue updated:` & `Summary updated:` timestamps, and `Refresh queue and summary` button (`aria-label="Refresh queue and summary"`).
    - Remove `+ New Patient`, `Check-in & Token`, and `Counter Checkout` links.
    - Keep `refreshMessage` (`role="alert"` on error, `role="status"` on success), `queueError`, and `summaryRefetchError` feedback banners intact.
  - **2. Six Compact KPI Cards (All Semantic `<Link>` Elements)**:
    - Tighten spacing (`space-y-4` page layout, `gap-2.5` grid, `px-3.5 py-2.5` card padding, `mt-1 text-xl font-bold`, remove downward `hover:translate-y-1.5` jump) while honoring UX-04 rules (minimum `text-xs`, contrast `-700`+ on white).
    - Card targets:
      1. `Registrations` → `/reception/appointments` (`overview.registrations_today ?? allAppointments.length`, `Walk-in + booked`)
      2. `Waiting` → `/reception/waiting` (`waitingAppts.length`, `Awaiting consultation`)
      3. `In Cabin` → `/reception/waiting` (`inConsultationAppts.length`, `With doctors right now`)
      4. `Completed` → `/reception/waiting` (`doneAppts.length`, `Ready for checkout`)
      5. `Dues Pending` → `/reception/billing?tab=dues` (`formatPaise(overview.outstanding_dues_paise ?? 0)`, `Outstanding balances`)
      6. `Payments today` → `/reception/reports` (`formatPaise(grossPaise)`, `Reversed today: ${formatPaise(reversedPaise)}`)
  - **3. Needs Attention Banner**:
    - Fix alert badge count to match visible alert cards: `(delayedAppts.length > 0 ? 1 : 0) + ((overview.outstanding_dues_paise ?? 0) > 0 ? 1 : 0) + (bookedAppts.length > 0 ? 1 : 0)`.
    - Direct `<Link>` CTAs:
      - Delayed (>30m): `<Link to="/reception/waiting" aria-label="View delayed patients">View</Link>`
      - Pending dues: `<Link to="/reception/billing?tab=dues">Review</Link>`
      - Booked not checked in: `<Link to="/reception/tokens">Check in</Link>`
  - **4. Compact Live Queue Preview (Left Column, 8 cols on `xl`)**:
    - Header: `Live Queue` heading, `Live data` pill, active count summary (`Showing X of Y active` when `activeQueue.length > 0`, or `0 active`), and `Open Waiting Room →` `<Link to="/reception/waiting">`.
    - Remove status tabs, doctor filter dropdown, search bar, `Actions` column, Cancel modal, and Print Token modal.
    - Compact 4-column table (`colSpan={4}` for loading and empty rows):
      - `Token`
      - `Patient` (`<Link to="/reception/patients/${appt.patient_id}">` + URN + `<PriorityBadge level={appt.priority_level} reason={appt.priority_reason} />`)
      - `Doctor` (doctor name + department)
      - `Status & Wait` — driven by the same `isInCabinAppointment` / `isWaitingAppointment` helpers so an `In Cabin` row with `consultation_status === 'IN_CONSULTATION'` always renders the `In Cabin` badge and `In consultation` text.
    - Empty state copy: clear status message when no active patients are waiting or in cabin, with a single `Open Waiting Room` link (avoiding re-introducing `"Check-in & Token"` label).
    - Overflow footer when `activeQueue.length > 5`: compact `<Link to="/reception/waiting">View all {activeQueue.length} active patients in Waiting Room →</Link>`.
  - **5. Streamlined Doctor Workload (Right Column, 4 cols on `xl`)**:
    - Header: `Doctor Workload` + `Live Status` badge.
    - Compute fallback doctor rows (when `overview.doctors_today` is absent/empty) from active `doctors` + guarded/sorted `sortedWaitingAppts` and `sortedInConsultationAppts`. Show a clean empty message if neither has active doctors.
    - Render each doctor as `<Link to={`/reception/waiting?doctor_id=${doc.doctor_id}`} className="block w-full ...">`:
      - Line 1: status dot + doctor name on left; `Next: ${doc.next_token != null ?`#${String(doc.next_token).padStart(2, '0')}`: '—'}` pill on right (fixes the existing `Next: #—` bug).
      - Line 2: compact inline metrics (`Waiting: N` and `In Cabin: M`) without the tall 3-column boxed grid and without the redundant `Done` tile.
  - Preserve strict reception role separation (zero clinical notes, diagnosis, or prescription fields).
- **validation**:
  - `npx --prefix frontend oxlint src/pages/ReceptionDashboard.tsx` exits `0`.
  - `npm --prefix frontend test -- src/test/guards/guards.test.ts` passes (confirms UX-04 compliance).
  - *(Full `tsc -b` and dashboard unit tests run in T3/T4.)*
- **status**: Completed
- **log**: Refactored `ReceptionDashboard.tsx` into compact command center (removed 3 header CTAs, queue filters/search/actions, and Print/Cancel modals; converted 6 KPI cards to compact `<Link>` tiles reusing `formatPaise`; fixed Needs Attention count & direct links; added 5-row active-only Live Queue preview with priority/token ordering and terminal-status guards; streamlined Doctor Workload into compact `<Link to="/reception/waiting?doctor_id=...">` rows with `Next: —` fix and `useDoctors(true)` fallback). Verified via `oxlint` (0 warnings/errors) and `guards.test.ts` (7/7 GREEN); unit tests delegated to T3 (`reason_not_testable: reception-dashboard.test.tsx owned by T3`). Committed as `5d9bad87`.
- **files edited/created**: `frontend/src/pages/ReceptionDashboard.tsx`

### T3: Update and expand `ReceptionDashboard` unit tests

- **depends_on**: [T2]
- **location**:
  - `frontend/src/pages/__tests__/reception-dashboard.test.tsx`
- **description**:
  - Reset `mockApiState.failReceptionOverview = false` inside `beforeEach` to prevent cross-test state leakage.
  - Expand `mockAppointments` and `mockOverview.doctors_today` fixtures to include:
    - `CANCELLED` (including one with stale `consultation_status: 'WAITING'`), `NO_SHOW`, `RESCHEDULED`, `DONE`, and `BOOKED` rows.
    - 6+ active rows (`ARRIVED` with `EMERGENCY`, `PRIORITY`, and `NORMAL` levels, 2+ delayed >30m patients, plus `IN_CONSULTATION` including one with `consultation_status: 'IN_CONSULTATION'`).
    - A second doctor in `doctors_today` with `next_token: null`.
  - Cover and assert (scoping repeated labels like `Waiting`, `In Cabin`, and `Check in` via `within(...)` on section/table landmarks):
    1. **Header cleanup**: Refresh button and separate `Queue updated:` / `Summary updated:` timestamps exist; `+ New Patient`, `Check-in & Token`, and `Counter Checkout` links are absent.
    2. **Six compact KPI cards & navigation**: Separate gross/reversed payment amounts with paise precision; all 6 KPI links point to `/reception/appointments`, `/reception/waiting`, `/reception/billing?tab=dues`, and `/reception/reports`.
    3. **Needs Attention**: Alert header count matches visible alert cards (e.g., `Needs Attention (3)` even when 2 patients are delayed >30m), and CTAs link to `/reception/waiting`, `/reception/billing?tab=dues`, and `/reception/tokens`.
    4. **Live Queue preview**:
       - Caps visible rows at 5 and shows `Open Waiting Room` link (`/reception/waiting`) plus overflow link when >5 active.
       - Excludes `CANCELLED` (even with stale `consultation_status: 'WAITING'`), `NO_SHOW`, `RESCHEDULED`, `DONE`/`COMPLETED`, and `BOOKED` rows.
       - Orders `EMERGENCY` → `PRIORITY` (rendered as `"High"` badge by `PriorityBadge`) → `NORMAL` waiting patients before `In Cabin` patients by token, with untokened rows never sorting before `#01`.
       - Asserts absence of queue search input, doctor dropdown, status filter tabs, `Print token`, `Cancel appointment`, and within the Live Queue table (`within(table)`), absence of `Check In` and `Billing →` controls.
    5. **Doctor Workload**: Renders compact doctor links to `/reception/waiting?doctor_id=<id>`, displays `Waiting` and `In Cabin` counts and `Next: #14` / `Next: —` (never `Next: #—`), and omits the `Done` tile.
    6. **Error resilience & role separation**: Manual refresh failure shows `role="alert"` while preserving last overview values; clinical notes/diagnosis/Rx never appear.
- **validation**:
  - `npm --prefix frontend test -- src/pages/__tests__/reception-dashboard.test.tsx` passes with 100% green tests.
  - `npm --prefix frontend run typecheck` passes cleanly.
- **status**: Completed
- **log**: Updated and expanded `reception-dashboard.test.tsx` with 8 landmark-scoped tests covering header cleanup, 6 compact KPI links with paise precision, Needs Attention card count & routing, 5-row active-only Live Queue preview (cancelled/no-show/rescheduled/done/booked exclusion, priority & emergency-timestamp & untokened ordering, removed controls), compact Doctor Workload deep-links (`Next: —` fix), refresh error resilience, and role separation. Verified: `reception-dashboard.test.tsx` (8/8 GREEN), `typecheck` (exit 0), `oxlint` (0 warnings/errors). Committed as latest HEAD.
- **files edited/created**: `frontend/src/pages/__tests__/reception-dashboard.test.tsx`

### T4: Full frontend verification & live browser navigation check

- **depends_on**: [T1, T2, T3]
- **location**:
  - `frontend/` (read-only verification across modified modules and full test suite)
- **description**:
  - Run the complete frontend quality gate:
    - `npm --prefix frontend run typecheck`
    - `npm --prefix frontend run lint`
    - `npm --prefix frontend test`
    - `npm --prefix frontend run build`
  - Verify live UI behavior on `/reception` and `/reception/waiting` against the running local backend + Vite dev server using a non-production test `RECEPTION` account (never modifying real patient data):
    - Confirm compact 6 KPI cards, Needs Attention, 5-row active-only Live Queue preview (cancelled patients hidden), and compact Doctor Workload fit cleanly at 1366×768 / 1440×900 with reduced vertical sprawl.
    - Click a Doctor Workload row → lands on `/reception/waiting?doctor_id=<id>` with that doctor pre-selected → reload page and confirm filter persists.
    - Click KPI cards, Needs Attention links, and `Open Waiting Room →` → confirm each navigates to its intended reception module without console or network errors.
- **validation**:
  - All 4 npm checks (`typecheck`, `lint`, `test`, `build`) exit with code `0`.
  - Browser verification confirms visual layout, deep-link routing, and reload persistence.
- **status**: Partially Completed (Automated Gate Passed; Live Browser Blocked)
- **log**: Automated frontend gate exited 0 across all 4 checks: `npm --prefix frontend run typecheck` (exit 0), `npm --prefix frontend run lint` (0 errors; 2 pre-existing warnings in untouched `token-generation.test.tsx`), `npm --prefix frontend test` (`75 passed (75)` test files, `535 passed | 5 skipped (540)` tests, including `guards.test.ts`, `waiting-room.test.tsx`, `reception-dashboard.test.tsx`), and `npm --prefix frontend run build` (`built in 4.42s`). Live Chrome browser verification on `http://localhost:5173/reception` was BLOCKED: Chrome remote debugging is not enabled (`DevToolsActivePort` ENOENT at `chrome://inspect/#remote-debugging`).
- **files edited/created**: None (verification only)

## Parallel Execution Groups

| Wave | Tasks | Can Start When |
| ------ | ------- | ---------------- |
| 0 | T0 | Immediately (Git checkpoint) |
| 1 | T1, T2 | T0 complete (non-overlapping file ownership: `WaitingRoom.tsx`+test vs `ReceptionDashboard.tsx`) |
| 2 | T3 | T2 complete |
| 3 | T4 | T1, T2, T3 complete |

## Testing Strategy

- **Unit / Component Tests (Vitest + React Testing Library)**:
  - `frontend/src/pages/__tests__/waiting-room.test.tsx` — URL `?doctor_id=` pre-filter, invalid/zero/leading-zero/unknown/error fallbacks, dropdown URL sync, and regression on priority ordering / reassign / cancel.
  - `frontend/src/pages/__tests__/reception-dashboard.test.tsx` — Header CTA removal, 6 KPI links + paise formatting, Needs Attention card count & routing, 5-row active-only Live Queue preview (cancelled/no-show/done/booked exclusion, priority ordering with `"Emergency"`/`"High"` badges, removed controls), compact Doctor Workload deep-links (`Next: —` fix), manual refresh error resilience, and role separation.
  - `frontend/src/test/guards/guards.test.ts` — UX-04 font-size, contrast, and accessible-control guard verification (cap = 0).
- **Static & Build Verification**:
  - `npm --prefix frontend run typecheck`
  - `npm --prefix frontend run lint`
  - `npm --prefix frontend test`
  - `npm --prefix frontend run build`
- **Live Browser / Reload Verification**:
  - Visual density check at desktop viewport (1366×768 / 1440×900), click-through navigation from every Dashboard section to its target module, and reload persistence on `/reception/waiting?doctor_id=<id>`.

## Risks & Mitigations

- **Risk**: Reception staff accustomed to printing a token or cancelling an appointment directly from `/reception` may look for those controls in the Dashboard queue.
  - **Mitigation**: Keep `Open Waiting Room →` prominently placed in the Live Queue header (and overflow footer) so queue management (reassign/cancel) is one click away, while Check-in & Token and Patient Records remain pinned in the left sidebar.
- **Risk**: `WaitingRoom` receives an inactive, invalid, leading-zero, or nonexistent `?doctor_id=`, or `useDoctors(true)` fails to load, leaving `<select>` visually out of sync with filtered cards.
  - **Mitigation**: T1 validates `/^[1-9]\d*$/`, falls back to `''` when `doctors.isError && !doctors.data` or when `doctors.data !== undefined` lacks the ID, and derives `doctorFilter` directly from `searchParams`.
- **Risk**: Compact styling edits in `ReceptionDashboard.tsx` accidentally introduce `<12px` text or low-contrast Tailwind classes that break the UX-04 guard test (`guards.test.ts`).
  - **Mitigation**: T2 explicitly documents UX-04 rules and runs `guards.test.ts` immediately as part of T2 validation.
- **Risk**: A cancelled appointment still carrying a legacy `consultation_status: 'WAITING'` or a `null` `token_number` distorts the active queue preview.
  - **Mitigation**: T2 applies explicit terminal-status guards across both `status` and `consultation_status`, sorts `null` tokens with `Number.MAX_SAFE_INTEGER`, and T3 verifies both edge cases in unit tests.
- **Risk**: Existing tests outside `reception-dashboard.test.tsx` might depend on removed Dashboard elements.
  - **Mitigation**: Codebase grep verified only `AreaHome.tsx` and `reception-dashboard.test.tsx` import `ReceptionDashboard`, and T4 runs the full frontend Vitest suite as a regression gate.
