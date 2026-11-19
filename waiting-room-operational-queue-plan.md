# Plan: Waiting Room Operational Queue Enhancements

**Generated**: 2026-11-17

## Overview

Elevate Kalyan Hospital's **Waiting Room** (`/reception/waiting`) into a crisp, high-signal operational queue workspace while strictly preserving the existing backend clinical authority rule (**`OD-22-19` / `doctor_status_forbidden`** — only the treating doctor starts or completes a consultation from `My Queue`).

### Confirmed Product Decisions

- **Preserve Backend `OD-22-19` (`A1`)**: Keep backend permissions unchanged (zero backend or RBAC weakening). Reception's Waiting Room does **not** render `Call patient` or `Mark completed` mutation buttons. Instead, each Kanban stage has a clear operational responsibility:
  - **WAITING**: True per-doctor `Position N` (computed before search/department filters so searching never fakes position #1) + **`Next up`** highlight for true position #1 (respecting independent doctor queues, Invariant #4), elapsed wait indicator (with ≥30m amber warning), **`Reassign`**, and **`Cancel consultation`**.
  - **IN CABIN**: Explicit **`Consultation in progress`** status badge + elapsed cabin duration, **`Cancel consultation`** (permitted by backend `BR-013` until the encounter is finalised, with clean `422 cannot_cancel_finalised` handling), and a clear note (`Completed by doctor`).
  - **COMPLETED**: Explicit **`Ready for checkout`** status badge + prominent primary **`Collect payment →`** CTA linking to `/reception/billing?appointment_id=<id>&patient_id=<id>`.
- **Adaptive Completed Column When Empty (`A3`)**: Keep the 3-column Kanban layout; when `completed.length === 0`, use adaptive proportions (`lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1.25fr)_minmax(15rem,0.75fr)]`) giving `Waiting` and `In Cabin` wider workspace while turning `Completed (0)` into a slim, useful rail with a `"Completed visits appear here ready for checkout."` hint and **`Open Billing & Checkout →`** link (`/reception/billing`). Expand back to equal `lg:grid-cols-3` automatically as soon as `completed.length > 0`.
- **Compact 3-Line Patient Cards (`A4`)**: Tighten card padding (`p-3`) and structure into 3 dense, scannable lines (eliminating dead whitespace):
  - **Line 1**: Monospace token pill (`formatToken(appt.token_number)`, e.g. `#1`) + truncated patient name + `PriorityBadge` (passing `reason={appt.priority_reason}`) + `Next up` pill for true per-doctor position #1 in Waiting.
  - **Line 2**: Doctor · URN · elapsed wait/cabin time (`X min waiting` or `In cabin · X min`).
  - **Line 3**: Stage status indicator + compact action strip.

### Scope & Architecture Constraints

- Pure frontend change — no backend API, permission, or database changes required (`PATCH /appointments/{id}/status` with `CANCELLED` is already authorized for `RECEPTION` on both `WAITING` and unfinalised `IN_CONSULTATION` per `appointment_service.py:352-380`, and `POST /appointments/{id}/reassign` is already wired).
- Single file owner per task (`AGENTS.md`).
- Preserve existing `?doctor_id=` deep-linking (`useSearchParams`), `departmentFilter`, search across name/URN/token, 10-second polling, `Last updated` timestamp, `ReassignDialog` cross-department validation, and error alert on refresh failure.
- Remove unused `PlainCard` (`noUnusedLocals`).
- **UX-04 / UX-06 / IST Date Guard Compliance (`frontend/src/test/guards/guards.test.ts`, cap = 0)**:
  - Minimum `text-xs` (`12px`), no `text-neutral-300/400` or `text-slate-300/400` (even on `hover:`), no `text-red-500`/`text-emerald-600`/`text-amber-600`/`text-teal-600` (use `-700`/`-800`).
  - Accessible names on every `<input>` and `<select>` (explicit `<label>` wrapping or `htmlFor` + static `id`).
  - Never call `window.alert`/`confirm`/`prompt` or `new Date().toISOString().split(...)`.

## Prerequisites

- Node.js `>=22.22.2` with frontend dependencies installed (`frontend/node_modules`).
- Existing `WaitingRoom.tsx` commit (`90930f48`, `?doctor_id=` deep-linking already committed and tested).
- Backend rules verified in `backend/src/kalyan_api/services/appointment_service.py:288-380` (`OD-22-19`, `BR-013`, `cannot_cancel_finalised`, `visit_not_open`, `409 version_conflict`).

## Dependency Graph

```
T0 (Git Checkpoint) ── T1 (WaitingRoom compact cards, In Cabin actions, adaptive Completed rail) ── T2 (WaitingRoom unit tests) ── T3 (Full Frontend Verification)
```

## Tasks

### T0: Record Pre-Batch Git Checkpoint

- **depends_on**: []
- **location**: Repository Git state (no source edits)
- **description**:
  - Inspect `git status` on `WaitingRoom.tsx` and `waiting-room.test.tsx`.
  - Record a non-destructive checkpoint via `$sha = git stash create "checkpoint: pre waiting-room enhancements"; if ($sha) { git update-ref refs/checkpoints/pre-waiting-room $sha }`.
- **validation**:
  - Checkpoint ref `refs/checkpoints/pre-waiting-room` (or clean HEAD) is logged without altering working tree files.
- **status**: Completed
- **log**: Captured non-destructive working-tree checkpoint via `git stash create` and pinned ref `refs/checkpoints/pre-waiting-room` -> `e7c6d6140580dd88ece9da2da08fc26f4e8d7337`. Confirmed `WaitingRoom.tsx` and `waiting-room.test.tsx` are clean at HEAD.
- **files edited/created**: None (Git ref `refs/checkpoints/pre-waiting-room` only)

### T1: Upgrade `WaitingRoom` cards, In Cabin actions, Completed handoff, and adaptive empty layout

- **depends_on**: [T0]
- **location**:
  - `frontend/src/pages/WaitingRoom.tsx`
- **description**:
  - **Header & Queue Guidance**:
    - Keep `Waiting Room` heading and `Last updated ...` subtitle.
    - Add a concise live summary in `<p>`/`<div>` (NOT `<h2>`, so `getByRole('heading', { name: 'Waiting' })` stays unique) derived from visible columns (`Waiting: {waiting.length} · In Cabin: {inCabin.length} · Completed: {completed.length}`) plus a subtle operational note (`"Doctors start and complete consultations from My Queue"`).
  - **Safe Priority Ordering, Column Classification & Pre-Filter Per-Doctor Positions**:
    - Harden `suggestedOrder(a, b)`: use `SUGGESTED_RANK[a.priority_level ?? 'NORMAL'] ?? 2`, parse emergency timestamps safely via `Date.parse(a.priority_updated_at ?? a.status_updated_at ?? '')` with `Number.MAX_SAFE_INTEGER` fallback on `NaN`, sort `token_number` using `(a.token_number ?? Number.MAX_SAFE_INTEGER) - (b.token_number ?? Number.MAX_SAFE_INTEGER)`, and add a final deterministic tie-breaker `a.id - b.id` so `#1` across two doctors never jitters across 10s polls.
    - Helper `isWaitingRow(a)`: `(a.status === 'ARRIVED' || a.status === 'CHECKED_IN' || a.status === 'WAITING') && a.consultation_status === 'WAITING'`.
    - Compute `positionByAppointmentId` across **all today's waiting appointments (`all.filter(isWaitingRow).sort(suggestedOrder)`) BEFORE `search` and `departmentFilter`**, counting 1-based positions independently per `doctor_id`. That way searching for a patient (e.g., Position 2 or 3) NEVER falsely promotes them to `Position 1` / `Next up`, and under `"All doctors"` each doctor's independent queue starts at `Position 1` (Invariant #4).
    - Filter `inCabin`: `visible.filter((a) => a.status !== 'CANCELLED' && a.consultation_status === 'IN_CONSULTATION').sort(compareByToken)` and `completed`: `visible.filter((a) => a.status !== 'CANCELLED' && a.consultation_status === 'COMPLETED').sort(compareByToken)` (with `a.id - b.id` tie-breaker) so cards stay stably ordered across polls.
    - Add safe `getElapsedMinutes(isoString?: string | null): number | null`: returns `null` when `!isoString` or `Number.isNaN(Date.parse(isoString))`, otherwise `Math.max(0, Math.floor((Date.now() - then) / 60000))`.
  - **Adaptive 3-Column Kanban Grid (`A3`)**:
    - Add `data-testid="waiting-room-board"` on the grid container and toggle between `lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1.25fr)_minmax(15rem,0.75fr)]` (`completed.length === 0`) and `lg:grid-cols-3` (`completed.length > 0`).
    - Keep `Column` as `<section aria-label={title}>` with `<h2>{title}</h2>` directly inside the header `<div>` (preserving landmark queries AND existing DOM structure), adding optional `emptyHint?: string` and `emptyAction?: React.ReactNode` so empty `Completed` renders `"No consultations completed yet today."`, `"Completed visits appear here ready for checkout."`, and `<Link to="/reception/billing">Open Billing &amp; Checkout →</Link>`.
    - Tighten column header & inner padding (`px-3 py-2`, `p-3`, `space-y-2.5`).
  - **Compact 3-Line `CardFrame` (`A4`) & Cleanup**:
    - Delete unused `PlainCard` (`noUnusedLocals`).
    - Tighten `CardFrame` to `p-3 rounded-lg border border-neutral-200 bg-white shadow-2xs`:
      - **Line 1**: Monospace token pill (`formatToken(appt.token_number)`) + patient name (`<p data-testid="card-patient-name" className="truncate text-sm font-bold text-neutral-900" title={appt.patient_name}>`) + right-side badges (`<PriorityBadge level={appt.priority_level} reason={appt.priority_reason} />` + optional `Next up` pill).
      - **Line 2**: Compact single-line metadata (`mt-1 text-xs text-neutral-600`): `{appt.doctor_name_en} · {appt.patient_urn}` + elapsed indicator (`{elapsed} min waiting` with `text-amber-800 font-semibold` if `>= 30` min in Waiting; `In cabin · {elapsed} min` in In Cabin).
      - **Line 3**: Stage status & compact action strip (`mt-2.5 border-t border-neutral-100 pt-2`, keeping `min-h-9` accessible button height).
  - **Shared Internal `CancelConsultationForm` (Used by Both `WaitingCard` & `InCabinCard`)**:
    - Keep toggle label `'Cancel consultation'` (with `aria-expanded={cancelOpen}`), wrapped `<label>Reason for cancelling <input ... /></label>` (wrapping directly inside `<label>` avoids UX-06 dynamic `htmlFor` regex failure and duplicate IDs across multiple open cards!), and submit label `'Cancel consultation'` (`'Cancelling…'` while pending).
    - Clear `reason` and `error` whenever the form is toggled closed (`cancelOpen` transitions to `false`).
    - On `409` (`isVersionConflict(err)` or `err.status === 409`) or `422` state conflicts (`cannot_cancel_finalised`, `visit_not_open`, `invalid_status_transition`, `status_unchanged`), call `queryClient.invalidateQueries({ queryKey: ['appointments'] })` (also in `ReassignDialog` on `409`) so `"The queue has refreshed"` is genuinely true without needing a `refetch` mock on `useAppointments`!
    - Handle backend error codes cleanly:
      - `409`: `'This patient was updated by someone else. The queue has refreshed; check it and try again.'`
      - `422` (`cannot_cancel_finalised`): `'This consultation’s clinical encounter is already finalised and cannot be cancelled.'`
      - `422` (`visit_not_open`): `'This visit is closed and can no longer be cancelled.'`
      - `422` (`invalid_status_transition` / `status_unchanged`): `'This consultation has already changed status. The queue has refreshed.'`
      - Fallback: `'Could not cancel the consultation. Try again.'`
  - **Stage-Specific Cards**:
    - **`WaitingCard`**:
      - Line 1 shows `Next up` badge (`bg-emerald-50 text-emerald-800 border border-emerald-200`) when `position === 1`.
      - Line 2 uses `appt.check_in_at ?? appt.status_updated_at ?? appt.created_at` for wait minutes (highlighted `text-amber-800 font-semibold` when `>= 30` min).
      - Line 3 keeps `Position {position}` in its own text element alongside compact `min-h-9` `Reassign` and `Cancel consultation` buttons (no `Call` or `Complete` button). Keeps `ReassignDialog` unchanged (plus `invalidateQueries` on 409).
    - **`InCabinCard`**:
      - Line 2 uses `appt.status_updated_at ?? appt.created_at` (never `check_in_at`) for `In cabin · {elapsed} min`.
      - Line 3 shows **`Consultation in progress`** status pill (`bg-consult-100 text-consult-900 border border-consult-200`), subtle `Completed by doctor` note, and `Cancel consultation` button toggling the shared `CancelConsultationForm` (no `Complete` button, preserving `OD-22-19`).
    - **`CompletedCard`**:
      - Line 3 shows **`Ready for checkout`** status pill (`bg-emerald-100 text-emerald-900 border border-emerald-200`) and a high-contrast button-styled `<Link to={`/reception/billing?appointment_id=${appt.id}&patient_id=${appt.patient_id}`}>Collect payment →</Link>` (`bg-emerald-700 text-white hover:bg-emerald-800`).
  - Preserve `?doctor_id=` deep-linking, `departmentFilter`, `search`, and UX-04/UX-06 guard compliance.
- **validation**:
  - `reason_not_testable`: `waiting-room.test.tsx` updates are owned by T2 (existing `waiting-room.test.tsx` queries `p.text-base` and `'Open bill'`, which T2 updates).
  - `npm --prefix frontend run typecheck` exits `0`.
  - Lint from `frontend/`: `.\node_modules\.bin\oxlint.cmd src/pages/WaitingRoom.tsx` exits `0`.
  - `npm --prefix frontend test -- src/test/guards/guards.test.ts` passes (`7/7` GREEN).
- **status**: Completed
- **log**: Upgraded `WaitingRoom.tsx` while strictly preserving `OD-22-19`: added visible column summary + role note in header; hardened `suggestedOrder`/`compareByToken`; computed pre-filter per-doctor `positionByAppointmentId`; compacted `CardFrame` to 3-line cards (`p-3`, `data-testid="card-patient-name"`, `PriorityBadge` with `reason`); deleted `PlainCard`; extracted shared `CancelConsultationForm` with `aria-expanded`, state reset on close, `invalidateQueries(['appointments'])`, and `409`/`cannot_cancel_finalised`/`visit_not_open`/`invalid_status_transition` error handling; added `Next up` & `>= 30 min` amber wait highlight on `WaitingCard`, `Consultation in progress` + `BR-013` cancel on `InCabinCard`, `Ready for checkout` + `Collect payment ->` on `CompletedCard`, and adaptive slim `Completed` rail with `Open Billing & Checkout ->` on `waiting-room-board`. Verified: `tsc -b` exit 0, `oxlint` 0 warnings/0 errors, `guards.test.ts` 7/7 GREEN (`reason_not_testable: waiting-room.test.tsx owned by T2`). Committed as latest HEAD.
- **files edited/created**: `frontend/src/pages/WaitingRoom.tsx`

### T2: Update and expand `WaitingRoom` unit tests

- **depends_on**: [T1]
- **location**:
  - `frontend/src/pages/__tests__/waiting-room.test.tsx`
- **description**:
  - Check `ApiError` constructor signature in `frontend/src/api/client.ts` before constructing `ApiError` instances in error tests.
  - Update the two selectors affected by the card compaction and CTA upgrade:
    - Ordering test: query `[data-testid="card-patient-name"]` instead of brittle `p.text-base`.
    - Completed card test: assert `screen.getByRole('link', { name: /Collect payment/i })` has `href="/reception/billing?appointment_id=9&patient_id=77"` and `Ready for checkout` status badge is rendered.
  - Add unit tests covering all new Waiting Room behaviors:
    1. **Per-doctor independent queue positions & `Next up` badge**: With two waiting patients for Dr. Anil and one for Dr. Bharati under `"All doctors"`, verify Dr. Anil's #1 shows `Position 1` + `Next up`, Dr. Anil's #2 shows `Position 2` (no `Next up`), and Dr. Bharati's #1 ALSO shows `Position 1` + `Next up`.
    2. **Search preserves true queue position**: Searching for Dr. Anil's 2nd waiting patient keeps `Position 2` and does **not** falsely render `Next up`.
    3. **Untokened waiting patient sorting**: A waiting appointment with `token_number: null` sorts after `#1` (never before `#1`).
    4. **In Cabin card status & `BR-013` cancellation**: Renders `Consultation in progress`, `Completed by doctor`, NO `Complete`/`Call` buttons, allows `Cancel consultation` with reason >= 3 chars sending `status: 'CANCELLED'`, and verifies `422 cannot_cancel_finalised`, `422 invalid_status_transition`, and `409 version_conflict` render their specific error alerts via `onError` (and toggling closed clears `error` and `reason`).
    5. **Adaptive empty Completed rail & wait-time highlight**: Asserts `waiting-room-board` uses the adaptive grid class when `completed.length === 0` (rendering `"No consultations completed yet today."`, `"Completed visits appear here ready for checkout."`, and `Open Billing & Checkout` link `/reception/billing`) and switches to `lg:grid-cols-3` when `completed.length > 0` (`Ready for checkout` + `Collect payment →`). Also verifies `>= 30 min` wait uses `text-amber-800` highlight (via relative timestamps).
    6. **Strict `OD-22-19` guard**: Verifies neither `Call patient` / `Call next` nor `Complete` / `Mark completed` mutation buttons appear anywhere on Waiting Room.
  - Preserve all 18 existing test behaviors (including `?doctor_id=` deep-linking, invalid/unknown/error fallbacks, `Reassign` cross-department validation, `Cancel` reason length check, and filter retention after cancel).
- **validation**:
  - `npm --prefix frontend test -- src/pages/__tests__/waiting-room.test.tsx src/test/guards/guards.test.ts` passes 100%.
  - `npm --prefix frontend run typecheck` exits `0`.
  - Lint from `frontend/`: `.\node_modules\.bin\oxlint.cmd src/pages/__tests__/waiting-room.test.tsx` exits `0`.
- **status**: Completed
- **log**: Updated 2 legacy selectors (`card-patient-name`, `Collect payment ->`) and added 8 tests in `waiting-room.test.tsx` (26 total) covering independent per-doctor `Position 1` + `Next up`, search preserving true position, untokened sort order, `In Cabin` `Consultation in progress` + `BR-013` cancel + `422 cannot_cancel_finalised`/`invalid_status_transition`/`409 version_conflict` + close reset, adaptive empty/populated `Completed` rail, `>= 30 min` amber wait highlight, and strict `OD-22-19` guard. Verified: `33/33` tests passed (`waiting-room.test.tsx` + `guards.test.ts`), `tsc -b` exit 0, `oxlint` 0 warnings/0 errors. Committed as latest HEAD.
- **files edited/created**: `frontend/src/pages/__tests__/waiting-room.test.tsx`

### T3: Full frontend verification & manual visual checklist

- **depends_on**: [T1, T2]
- **location**:
  - `frontend/` (read-only verification across all modules)
- **description**:
  - Run the complete frontend quality gate:
    - `npm --prefix frontend run typecheck`
    - `npm --prefix frontend run lint` (0 errors, 0 warnings)
    - `npm --prefix frontend test`
    - `npm --prefix frontend run build`
  - Provide a concise manual visual checklist for `http://localhost:5173/reception/waiting` confirming compact 3-line cards, true per-doctor `Position 1` + `Next up`, `Consultation in progress` + `Cancel consultation` on In Cabin cards, adaptive slim Completed rail when empty (`Open Billing & Checkout →`), and `Ready for checkout` + `Collect payment →` once completed.
- **validation**:
  - All 4 npm checks (`typecheck`, `lint`, `test`, `build`) exit with code `0`.
- **status**: Partially Completed (Automated Gate Passed; Live Browser Visual Check Deferred)
- **log**: Automated frontend gate exited 0 across all 4 checks: `npm --prefix frontend run typecheck` (exit 0), `npm --prefix frontend run lint` (`Found 0 warnings and 0 errors` on 197 files), `npm --prefix frontend test` (`75 passed (75)` test files, `556 passed | 5 skipped (561)` tests, including `guards.test.ts` and all 26 tests in `waiting-room.test.tsx`), and `npm --prefix frontend run build` (`built in 3.41s`). Manual visual verification checklist provided in Execution Summary (Chrome remote debugging not enabled on this workstation).
- **files edited/created**: None (verification only)

## Parallel Execution Groups

| Wave | Tasks | Can Start When |
| ------ | ------- | ---------------- |
| 0 | T0 | Immediately (Git checkpoint) |
| 1 | T1 | T0 complete (`WaitingRoom.tsx`) |
| 2 | T2 | T1 complete (`waiting-room.test.tsx`) |
| 3 | T3 | T1, T2 complete (Full frontend verification gate) |

## Testing Strategy

- **Unit / Component Tests (Vitest + React Testing Library)**:
  - `frontend/src/pages/__tests__/waiting-room.test.tsx` — Priority + untokened sorting, independent per-doctor `Position 1` + `Next up`, search preserving true queue position, `In Cabin` `Consultation in progress` + `BR-013` cancel + `422 cannot_cancel_finalised`, adaptive empty `Completed` rail + `Open Billing & Checkout →`, `Completed` `Ready for checkout` + `Collect payment →`, strict `OD-22-19` absence of Call/Complete buttons, `?doctor_id=` URL sync & fallbacks, and `Reassign` cross-department validation.
  - `frontend/src/test/guards/guards.test.ts` — UX-04 contrast/font-size, UX-06 accessible labels, and IST date guard (cap = 0).
- **Static & Production Build Gate**:
  - `npm --prefix frontend run typecheck`
  - `npm --prefix frontend run lint`
  - `npm --prefix frontend test`
  - `npm --prefix frontend run build`

## Risks & Mitigations

- **Risk**: Computing queue position after `search` or `departmentFilter` would falsely show `Position 1` + `Next up` on a patient who is actually further down the doctor's queue.
  - **Mitigation**: T1 computes `positionByAppointmentId` over all today's waiting rows grouped by `doctor_id` before display filtering, verified by a dedicated search test in T2.
- **Risk**: Reception clicks `Cancel consultation` on an `In Cabin` card whose doctor has already finalised the clinical encounter.
  - **Mitigation**: Backend `BR-013` rejects with `422 cannot_cancel_finalised`; T1 catches `err instanceof ApiError && err.code === 'cannot_cancel_finalised'` and displays a clear explanation rather than a generic retry message.
- **Risk**: Compacting card typography (`text-base` → `text-sm`, `p-4` → `p-3`) could introduce `<12px` or low-contrast classes failing UX-04 (`guards.test.ts`).
  - **Mitigation**: All text stays `>= text-xs` (`12px`), contrast uses `-700`/`-800`/`-900` shades, and T1 runs `guards.test.ts` immediately.
