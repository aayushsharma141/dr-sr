# Phase 22 Plan 02 Summary: Check-in list labels/keyboard tabs, Waiting Room copy, and LANStatusPill mount

## Status
**IMPLEMENTED — NOT VERIFIED** (Pending 22-20 :8000 human-check)

## Task ID
- Task ID: T22-05 / Plan 22-02
- Requirements: T22-05, QUE-10, AUD-08

## Owned Files
- `frontend/src/components/checkin/TodayAppointmentsPanel.tsx`
- `frontend/src/components/__tests__/today-appointments-panel.test.tsx` (new)
- `frontend/src/pages/WaitingRoom.tsx`
- `frontend/src/pages/__tests__/waiting-room.test.tsx`
- `frontend/src/components/AppShell.tsx` (shared Wave 2 owner; replaces server-link indicator with LANStatusPill)
- `frontend/src/components/__tests__/app-shell.test.tsx`

## Findings
1. Prior to this change, `TodayAppointmentsPanel` used amber badge styling (`bg-amber-50 text-amber-900`) for "Waiting", which collided with the design invariant that amber is strictly reserved for `PRIORITY`. Furthermore, cancelled appointments used red styling (`bg-red-50 text-red-800`), colliding with `EMERGENCY` / destructive action semantics.
2. The tablist in `TodayAppointmentsPanel` lacked arrow-key keyboard navigation and roving tabindex (Risk R1).
3. The row action for cancelling a booking was labelled "Cancel", which was ambiguous compared to the spec vocabulary "Cancel booking".
4. `WaitingRoom.tsx` rendered a single generic empty message ("No patients here.") across all columns instead of dedicated per-column empty states, used `text-2xl` outside the Q14 type scale, and used non-multiples of 4px spacing (`p-3`/`gap-3`).
5. `AppShell.tsx` had an ad-hoc server status indicator powered by `useServerLink` and displayed at the foot of the sidebar (and mobile-only header badge), while `LANStatusPill.tsx` remained unmounted. OD-F option-b confirmed replacing the server-link indicator with `LANStatusPill` in `AppShell` so connection status is visible across all devices and screen widths.

## Root Cause
- Gradual drift across design iterations and initial mocks prior to the Phase 22 unified design specification.
- Unmounted `LANStatusPill` component caused duplication with legacy `useServerLink` in `AppShell`.

## Changes Made
### 1. Decision OD-F (Task 1)
- Recorded decision OD-F option-b: Replaced existing server-link indicator with `LANStatusPill` in `AppShell`.

### 2. TodayAppointmentsPanel & Tests (Task 2 - TDD)
- Created `frontend/src/components/__tests__/today-appointments-panel.test.tsx` asserting status labels/colours, row button rename, and roving tabindex keyboard navigation (RED confirmed).
- In `TodayAppointmentsPanel.tsx`:
  - Updated `statusView()` to use neutral slate (`bg-slate-100 text-slate-800`) for Waiting, "In Cabin" (`bg-violet-50 text-violet-800`), "Completed" (`bg-emerald-50 text-emerald-800`), "No-show" (`bg-slate-100 text-slate-700`), and "Cancelled" (`bg-slate-100 text-slate-600` without red class).
  - Preserved `EMERGENCY` (red-600) and `PRIORITY` (amber-400) border accents.
  - Renamed the row action button from "Cancel" to "Cancel booking".
  - Implemented roving tabindex on the tablist (`tabIndex={view === t.key ? 0 : -1}`) with `onKeyDown` supporting `ArrowRight`, `ArrowLeft` (wrapping), `Home`, and `End`.

### 3. WaitingRoom & Tests (Task 3 - TDD)
- In `WaitingRoom.tsx`:
  - Updated page title to `text-base font-bold` per Q14 scale (16px heading, 700 weight).
  - Migrated card padding from `p-3` to `p-4` and headers/filters gap from `gap-3` to `gap-4`.
  - Replaced single empty text with three per-column empty copies:
    - Waiting: `"No one is waiting."`
    - In Cabin: `"No one is in a cabin."`
    - Completed: `"No consultations completed yet today."`
  - Verified Waiting card action reads "Cancel consultation" and requires >= 3 characters.
  - Verified Completed card "Open bill" link preserves `/reception/billing?appointment_id={id}&patient_id={pid}`.
- In `waiting-room.test.tsx`:
  - Added tests for per-column empty states.
  - Added test verifying doctor filter, department filter, and search text remain unchanged after reassign and cancel actions.

### 4. AppShell & LANStatusPill Mount (Task 4)
- In `AppShell.tsx`:
  - Removed `useServerLink`, `SERVER_LINK_VIEW`, and `renderConnectionStatus`.
  - Mounted `<LANStatusPill />` in the top header right section (`Location | Clock | LANStatusPill | User Pill | Sign Out`), visible across all viewports.
  - Cleaned up sidebar footer navigation without duplicate status indicators.
- In `app-shell.test.tsx`:
  - Replaced sidebar status tests with tests asserting `LANStatusPill` renders Online/Disconnected states accurately upon network events and health probes.

## Test Commands & Results
1. Frontend Vitest Verification:
   ```cmd
   cd frontend && npx vitest run --maxWorkers=2 src/components/__tests__/today-appointments-panel.test.tsx src/pages/__tests__/token-generation.test.tsx src/pages/__tests__/waiting-room.test.tsx src/components/__tests__/app-shell.test.tsx src/components/__tests__/lan-status-pill.test.tsx src/test/guards/guards.test.ts
   ```
   **Result:** 6 test files passed, 60 tests passed (100% green).
   - `src/components/__tests__/today-appointments-panel.test.tsx`: 12 passed
   - `src/pages/__tests__/token-generation.test.tsx`: 11 passed
   - `src/pages/__tests__/waiting-room.test.tsx`: 10 passed
   - `src/components/__tests__/app-shell.test.tsx`: 17 passed
   - `src/components/__tests__/lan-status-pill.test.tsx`: 3 passed
   - `src/test/guards/guards.test.ts`: 7 passed

2. TypeScript Typecheck:
   ```cmd
   cd frontend && npm run typecheck
   ```
   **Result:** `tsc -b` exited with code 0 (clean, no errors).

3. Backend Pytest Verification:
   ```cmd
   cd backend && set PYTHONPATH=src && .venv\Scripts\python.exe -m pytest -p no:warnings tests/test_phase22_wave2.py
   ```
   **Result:** 10 passed in 5.05s (verifying QUE-10 transfer history and AUD-08 audit trail).

## Dependencies
- Backend `/api/appointments/{id}/reassign` and `PATCH /api/appointments/{id}/status` already built.
- Billing link URL contract (`/reception/billing?appointment_id={id}&patient_id={pid}`) preserved for consumption in Phase 22 Wave 4 (plan 22-13).

## Remaining Risks
- Human verification on `:8000` required after plan 22-20 deployment to visually inspect LANStatusPill responsiveness and Waiting Room per-column empty states.
