# Phase 22 Plan 01 Summary: PriorityBadge on Doctor Queue Dashboard

**Plan:** 22-01  
**Status:** IMPLEMENTED — NOT VERIFIED  
**Requirements:** T22-06, PRI-07, PRI-08, PRI-09  

---

## 1. AGENTS.md Governance Report

- **Task ID:** 22-01 (T22-06, PRI-07, PRI-08, PRI-09)
- **Owned Files:**
  - `frontend/src/pages/DoctorDashboard.tsx`
  - `frontend/src/pages/__tests__/doctor-kanban-dashboard.test.tsx`
- **Findings:**
  - `DoctorDashboard.tsx` previously had 0 occurrences of `PriorityBadge`. Cards used an ad-hoc heuristic (`isUrgent`) checking whether notes included "emergency" or "urgent" instead of the authoritative `priority_level` classification returned by the server.
  - When queue refetches encountered an error (`isError: true`), `DoctorDashboard.tsx` previously replaced the entire queue workspace with an error state, hiding cached queue data.
  - In consultation cards were already separated in their own section above waiting room, but needed explicit test coverage to lock in behaviour (OD-22-08).
  - Doctor workstation lacked queue freshness ("Last updated {time}") and stale-data inline alerting when refetching fails.
- **Root Cause:**
  - Missing integration of the shared `PriorityBadge` component on doctor queue cards and absence of query freshness / stale fallback indicators on the doctor queue interface.
- **Changes:**
  - `frontend/src/pages/DoctorDashboard.tsx`:
    - Imported `PriorityBadge` from `components/checkin/PriorityBadge` and `InlineAlert` from `components/InlineAlert`.
    - Rendered `<PriorityBadge level={item.priority_level} reason={item.priority_reason} />` next to token in `renderKanbanCard` for all patient card contexts (waiting, in consultation, lab hold, booked, completed).
    - Removed unused `isUrgent` heuristic that previously substituted for type badges. Retained type badges (Follow-up, Scheduled, Walk-in) and existing card colors.
    - Destructured `dataUpdatedAt` from `useDoctorQueue()` and added "Last updated {time}" formatted with Indian locale (`en-IN`) and Asia/Kolkata timezone.
    - Added stale-data `<InlineAlert tone="error">` right below header when `isError` is true while keeping cached queue items visible on screen rather than blanking the interface.
  - `frontend/src/pages/__tests__/doctor-kanban-dashboard.test.tsx`:
    - Added TDD tests for `PriorityBadge` rendering and server order preservation:
      - Emergency badge renders for `EMERGENCY` cards.
      - Priority badge renders for `PRIORITY` cards.
      - No badge renders for `NORMAL` cards.
      - Waiting cards render in exact server-provided DOM order without client-side re-sorting.
      - Reversed mock order reverses DOM order.
    - Added TDD tests for pinned consultation cards and freshness:
      - In-consultation card pinned in its own section above waiting room.
      - "Last updated" line renders with time after query data lands.
      - Stale-data `InlineAlert` renders with `role="alert"` when query has data and enters error state.
- **Test Commands & Results:**
  - Checkpoint creation:
    ```bash
    cd D:/dr-sr && W=$(git stash create "checkpoint: before 22-01")
    ```
    *Result:* Created stash object `ded4b1bc451633a419594ce9c39b7bea65bd3cb6`.
  - PriorityBadge count gate:
    ```bash
    (Select-String -Path "D:/dr-sr/frontend/src/pages/DoctorDashboard.tsx" -Pattern "PriorityBadge").Count
    ```
    *Result:* `2` (>= 2 baseline gate passed).
  - Frontend test suite (vitest):
    ```bash
    cd D:/dr-sr/frontend && npx vitest run --maxWorkers=2 src/pages/__tests__/doctor-kanban-dashboard.test.tsx src/pages/__tests__/doctor-workspace.test.tsx src/pages/__tests__/doctor-dashboard-unfinished.test.tsx src/components/__tests__/emergency-alert-banner.test.tsx src/test/guards/guards.test.ts
    ```
    *Result:* `5 passed (5)`, `37 passed (37)` in 12.92s.
  - TypeScript type check:
    ```bash
    cd D:/dr-sr/frontend && npm run typecheck
    ```
    *Result:* Passed with 0 errors (`tsc -b`).
  - Backend pytest verification:
    ```bash
    cd D:/dr-sr/backend && PYTHONPATH=D:/dr-sr/backend/src .venv/Scripts/python.exe -m pytest -p no:warnings tests/test_phase22_wave2.py
    ```
    *Result:* `10 passed in 6.34s` (verifying PRI-07 alert timestamp, PRI-08 acknowledge time, PRI-09 alert persistence).
- **Dependencies:**
  - Disjoint file ownership with 22-02 and 22-03.
- **Remaining Risks:**
  - Live visual verification on port 8000 pending Plan 22-20 deployment and human sign-off.
