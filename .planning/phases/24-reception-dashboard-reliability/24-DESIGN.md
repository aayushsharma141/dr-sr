# Phase 24 — OPD Reception Dashboard Reliability & Efficiency

**Status:** Implementation partially complete; technical and receptionist acceptance gates remain open.
**Depends on:** Phase 22 integrated OPD workflow and Phase 23 advanced data operations; reconcile the current uncommitted OPD worktree before implementation.
**Goal:** Make the reception dashboard's queue, workload, attention alerts and financial summaries accurate, visibly fresh and quick to act on without changing hospital policy or redesigning unrelated modules.

## Evidence and scope

The live screen and code review identified four fix areas: queue and overview freshness are not presented distinctly; the dashboard derives a net collection figure that conflicts with the backend's activity-total contract; department fallback labels can misidentify a doctor's/appointment's department; and queue actions/layout can reduce scanning and interaction effort. The browser contained real patient details; no such information is reproduced here or used as test data.

The appointment query polls every 10 seconds, while `useOverview` has no polling policy. Dashboard update time currently follows appointment data, while the screen also contains overview-backed values. Backend `CollectionsTodayOut` describes payments made today and reversals made today as separate activity totals and expressly does not define netting. Backend workload currently derives a single department from doctor qualification or a Physiotherapy fallback. Queue entries should use the appointment's stored department when that contract is available; workload must not imply a single department for a multi-department doctor.

Reception workflow supplied by the requester and direct user feedback were blank. Therefore staff satisfaction and task-time improvement remain unmeasured; a synthetic-data staff walkthrough is a release gate for claiming UX effectiveness.

## Scope

- Separate freshness state for the appointment queue and overview metrics, including visible failures and stale data.
- Invalidate/reload overview data after relevant reception mutations.
- Display daily payment and reversal activity separately; do not invent a netting policy.
- Display an appointment's actual department; show all configured workload departments or omit a singular department label until the API supports that accurately.
- Make long-wait alerts focus the matching queue and improve action names/confirmation context.
- Remove the repeated Patient Flow chart; keep the hourly collection breakdown in Reports. Link the dashboard collection summary to Reports.
- Validate layout at common workstation sizes; retain the remaining information architecture.
- Synthetic-only automated and manual verification.

## Out of scope

- Changes to queue priority/order, emergency routing, transfer policy, payment/reversal records, permissions, patient or visit lifecycle rules, or production database state.
- New internet dependencies, new clinical content, or broad dashboard redesign.

## Interface, typography and accessibility

- Keep the queue and urgent exceptions first. Remove labels or summaries that repeat information already visible.
- Use the existing design tokens. Keep a clear type hierarchy: page title, section title, body, then secondary metadata. Aim for 14px body text and 12px metadata; do not shrink text to fit more cards.
- Use sentence case and short labels. Remove the promotional-style dashboard subtitle. Error messages should say what failed and what the receptionist can do next.
- Avoid decorative gradients, glass effects, animated entrances, extra metric cards, and AI-generated advice panels. Keep color, icons, and charts only when they help staff identify a patient state or take an action.
- Meet WCAG 2.2 AA for text contrast, keyboard access, visible focus, labels, and reflow. Use text or icons with color for status; never rely on color alone. Support 200% text resize and 320 CSS-pixel reflow. Make frequent icon actions at least 44 by 44 CSS pixels where layout allows; WCAG AA's minimum target size is 24 by 24 CSS pixels.
- Announce queue changes without interrupting active work. Respect reduced-motion settings and do not blink or animate attention alerts.

Reference: [WCAG 2.2](https://www.w3.org/TR/WCAG22/), including [contrast](https://www.w3.org/TR/WCAG22/#contrast-minimum), [reflow](https://www.w3.org/TR/WCAG22/#reflow), [resize text](https://www.w3.org/TR/WCAG22/#resize-text), and [target size](https://www.w3.org/TR/WCAG22/#target-size-minimum).

## Policy decisions

No accounting decision is required to show backend-defined payments-created-today and reversals-made-today as distinct amounts. If a single net number is requested later, obtain an owner-approved definition before implementation. For a doctor with several configured departments, show a multi-value representation only if the API can authoritatively provide it; otherwise omit the department in workload cards. Keep the existing 30-minute attention threshold unless the hospital owner changes it.

## Proposed execution waves

1. **Checkpoint and contract freeze:** Record a Git checkpoint before each repair batch, map current dirty files and merge the in-progress OPD changes first or explicitly rebase the dashboard plan onto them. Freeze overview refresh/error semantics and the amount/department contracts.
2. **Freshness and error states:** Add overview refresh/invalidation policy; separate queue and overview updated-at indicators; surface refresh failures and stale/offline state without showing failed data as current zero.
3. **Data correctness:** Render separate payments and reversals activity with paise precision; remove unsupported netting. Use authoritative appointment department data and make workload department representation truthful. Coordinate backend schema/type edits if needed.
4. **Reception interaction polish:** Route delayed-wait alert to a delayed-only queue view, give actions clear accessible names, preserve cancel reason/concurrency behavior, and make only evidence-backed responsive hierarchy changes.
5. **Verification and acceptance:** Run focused frontend and backend tests, full relevant regression suites, synthetic multi-workstation/reload checks, authorization checks, and a receptionist walkthrough. Mark implementation `IMPLEMENTED — NOT VERIFIED` until every required governance gate passes; user satisfaction requires staff feedback.

## Acceptance criteria

- Queue and overview freshness are independently observable; a failed refresh is visible and never presented as a successful current zero.
- Relevant status/check-in/billing changes refresh the appropriate summary data; the 10-second queue polling remains functional.
- Daily payment-created and reversal-created amounts match the backend response and preserve paise; no unsupported net total is shown.
- Queue and doctor-workload department labels are sourced authoritatively or omitted where the data model cannot represent them truthfully.
- Clicking a delayed-wait alert focuses the matching queue records without changing priority or queue policy.
- The dashboard no longer repeats queue counts in a Patient Flow chart. Hourly collection detail remains available in Reports, and the collection shortcut opens Reports.
- Core controls have clear accessible names and work by keyboard; layout remains usable at the target receptionist viewport sizes.
- Text follows the existing type scale, keeps routine content readable at 200% zoom, and meets AA contrast. The queue reflows at 320 CSS pixels without losing functionality.
- Frequent icon controls have generous hit areas, status does not depend on color, and live updates do not steal focus or cause disruptive announcements.
- Interface copy is short and task-specific. No decorative cards, gradients, animations, or AI advice panels are added without a demonstrated workflow need.
- Synthetic-only tests cover behavior; API, persistence, related-module, authorization, reload, and regression checks are recorded. Receptionist feedback is documented separately from code-test results.

## Risks and dependencies

- Current worktree has uncommitted edits in `ReceptionDashboard.tsx`, `queries.ts`, `types.ts`, `areas.py`, appointments/check-in workflows and related tests. The implementation owner must inspect and preserve those changes and avoid parallel edits in shared files.
- If the current Appointment API lacks department identity, backend/API and frontend type changes are coordinated as one contract task.
- No agreed accounting definition exists for a single daily net collection value; the proposed plan avoids that value.
- Satisfaction and the best visual hierarchy cannot be established by repository inspection; staff walkthrough is required.
- Do not use real patient data, reset the production database, or delete historical clinical/financial data.
