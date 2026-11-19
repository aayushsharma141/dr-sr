# Plan: Billing & Checkout Empty-State and Workflow Simplification

**Generated**: 2026-11-17

## Overview

Streamline Kalyan Hospital's **Billing & Checkout** workspace (`/reception/billing`) to eliminate dead empty-state space, remove sidebar navigation duplication, remove the confusing top-level `Add item` button when no visit is selected, and make the selected visit's charges, discounts, payments, balance, and visit closure immediately clear.

### Confirmed Product Decisions

- **Remove Top `Add item` Confusion (`A1`)**: Remove the prominent top `+ Add item` button above the checkout queue. Keep visit line-item additions (`Add medicine`, `Add particular`) strictly inside the selected visit's `BillPanel`, and expose standalone non-visit billing via a subtle secondary **`Direct payment (no visit)`** button.
- **Remove Redundant Header Navigation (`#4`)**: Remove the repeated `Appointments` and `Check-in & Token` links passed to `ReceptionDeskTabs` on `/reception/billing` (already pinned in the Reception left sidebar).
- **Adaptive 3-State Checkout Layout (`A2`)**:
  1. **0 Visits Ready (Empty State)**: Render a single compact empty-state card (no oversized empty right panel) displaying:
     - **`No visits awaiting checkout`**
     - **Completed consultations today** count
     - **Pending dues** count & total outstanding amount
     - Direct **`View Pending Dues →`** link (`/reception/billing?tab=dues`)
     - Subtle secondary **`Direct payment (no visit)`** action (when `canCollect`).
  2. **≥1 Visits Ready, None Selected**: Render a focused single-column `Ready for checkout` queue card (no giant blank right panel) prompting staff to pick a patient.
  3. **Visit Selected**: Expand the full 2-column layout (`lg:col-span-4` queue + `lg:col-span-8` full billing workspace) with an always-available `Back to queue` control.
- **Clear Checkout Breakdown (`A3`)**: Add a compact **Checkout Summary Strip** inside the selected visit's `BillPanel` showing **Bill Total · Discounts · Paid · Balance Due** (clarifying that `Bill Total` is already net of discounts so staff never double-deduct!), add a **`Discounts applied (included above)`** row in `Totals & Settlement` when `discountsPaise > 0`, and clarify the visit-closure heading (`Close Visit / Patient Out`) while keeping the `Patient Out` submit button and all existing billing invariants intact.

### Scope & Architecture Constraints

- Pure frontend change — no backend API, schema, permission, or database modifications required (`GET /api/visits?ready_for_checkout=true`, `GET /api/appointments?appointment_date=...`, `GET /api/billing/pending-dues`, `GET /api/billing/visit-dues`, `GET /api/visits/{id}`, `GET /api/visits/{id}/bill`, `POST /api/payments`, and `POST /api/visits/{id}/close` already exist).
- Single file owner per task — zero overlapping edits across parallel tasks (`AGENTS.md`).
- Preserve `ReceptionDeskTabs.tsx`, `ReceiptsPage.tsx`, `ReceptionReportsPage.tsx`, `ADMIN` oversight view, `Pending Dues` tab, `Receipts Desk` tab, and all `BillPanel` 5-section & `Totals & Settlement` contracts (`bill-panel.test.tsx`, `bill-line-actions.test.tsx`).
- **Strict TypeScript (`noUnusedLocals` & `noUnusedParameters`)**: Remove `Link`, `IconPlus`, `IconTicket` from `ReceptionBillingPage.tsx` while keeping `IconUser` (used in `checkoutMode === 'other'`).
- **UX-04 / UX-06 / IST Date Guard Compliance (`frontend/src/test/guards/guards.test.ts`, cap = 0)**:
  - Minimum `text-xs` (`12px`), no `text-slate-300/400` or `text-neutral-300/400` (even on `hover:`), no `text-red-500`/`text-emerald-600`/`text-amber-600`/`text-teal-600` (use `-700`/`-800`).
  - Accessible names on every `<input>`, `<select>`, and `<textarea>`; never call `new Date().toISOString().split(...)` or pass negative paise to `formatPaise()`.

## Prerequisites

- Node.js `>=22.22.2` with frontend dependencies installed (`frontend/node_modules`).
- Existing `BillPanel.tsx`, `VisitCheckout.tsx`, `ReceptionBillingPage.tsx`, `bill-panel.test.tsx`, `bill-line-actions.test.tsx`, and `reception-billing.test.tsx`.

## Dependency Graph

```
T0 (Git Checkpoint) ──┬── T1 (BillPanel summary strip + discounts + tests) ──┐
                      │                                                      ├── T3 (ReceptionBillingPage) ── T4 (reception-billing.test.tsx) ── T5 (Full Verification)
                      └── T2 (VisitCheckout adaptive 3-state layout) ────────┘
```

*(Wave 1 runs `T1` and `T2` in parallel with zero file overlap; `T3` waits for Wave 1 to join so repo-wide `tsc -b` and `guards.test.ts` never race with parallel edits.)*

## Tasks

### T0: Record Pre-Batch Git Checkpoint

- **depends_on**: []
- **location**: Repository Git state (no source edits)
- **description**:
  - Inspect `git status` on `BillPanel.tsx`, `VisitCheckout.tsx`, `ReceptionBillingPage.tsx`, `bill-panel.test.tsx`, and `reception-billing.test.tsx`.
  - Record a non-destructive checkpoint via:

    ```powershell
    $sha = git stash create "checkpoint: pre billing-checkout simplification"
    if (-not $sha) { $sha = git rev-parse HEAD }
    git update-ref refs/checkpoints/pre-billing-checkout $sha
    ```

- **validation**:
  - Checkpoint ref `refs/checkpoints/pre-billing-checkout` is pinned without modifying working tree files.
- **status**: Completed
- **log**: Pinned pre-batch checkpoint `refs/checkpoints/pre-billing-checkout` at `f0d1812020d1ed518c32871f256a2b9106e34627` (captured pre-existing dirty edits in `BillPanel.tsx`, `VisitCheckout.tsx`, `ReceptionBillingPage.tsx`, and `reception-billing.test.tsx`).
- **files edited/created**: None (Git ref only)

### T1: Add Checkout Summary Strip & Discounts breakdown to `BillPanel` + unit tests

- **depends_on**: [T0]
- **location**:
  - `frontend/src/components/billing/BillPanel.tsx`
  - `frontend/src/components/__tests__/bill-panel.test.tsx`
- **description**:
  - Read ALL of `BillPanel.tsx` and `bill-panel.test.tsx` first to preserve every existing test assertion (`bill-panel.test.tsx:284` case-sensitive `getByText('Bill total')` and `line 293` `getAllByText('₹400.00').length === 2` when `payingNowPaise={20000}`).
  - Compute `discountsPaise` across active lines that count toward total AND carry a `DISCOUNT` or `WAIVER` history entry (`line.status === 'ACTIVE' && line.counts_toward_total && line.history?.some((h) => h.kind === 'DISCOUNT' || h.kind === 'WAIVER')`), summing `Math.max(0, (line.original_amount_paise ?? line.amount_paise) - line.amount_paise)` so quantity-typo `CORRECTION`s are never mislabelled as discounts and `formatPaise()` never receives negative values.
  - Render a compact **Checkout Summary Strip** (`data-testid="checkout-summary-strip"`) at the top of `BillPanel` (below the locked-visit banner if locked, above the itemized `Visit Bill` section):
    - 4 compact KPI tiles (`grid-cols-2 sm:grid-cols-4 gap-2.5`):
      1. **Bill Total** *(exact capital `T` so `getByText('Bill total')` in `bill-panel.test.tsx:284` remains unique!)*: `{formatPaise(bill.bill_total_paise)}`
      2. **Discounts**: `{formatPaise(discountsPaise)}` (with subtle `included` sublabel when `discountsPaise > 0` so staff clearly see `Bill Total` is already net of discounts — never render `-₹X` beside net `Bill Total`!)
      3. **Paid**: `{formatPaise(bill.paid_paise)}`
      4. **Balance Due**: `{formatPaise(bill.due_paise)}` *(must use `bill.due_paise`, NOT `remainingOnVisit`, so `bill-panel.test.tsx:293` remains exact!)*
  - In `Totals & Settlement`, when `discountsPaise > 0`, render an informational row **`Discounts applied (included above)`** → `{formatPaise(discountsPaise)}` (`text-emerald-800`) right below `Bill total` while keeping all 6 existing lines (`Bill total`, `Paid earlier`, `Paying now`, `Remaining on this visit`, `Previous dues`, `Total outstanding`) in exact order.
  - Keep all 5 section headings, `Add medicine`, `Add particular`, `Adjust fee`, `Change quantity`, `Void`, `Previous dues`, `Treatment Packages`, and `Payments on this visit` behavior untouched.
  - **TDD RED → GREEN** in `frontend/src/components/__tests__/bill-panel.test.tsx`:
    - Add unit tests verifying `checkout-summary-strip` shows Bill Total, Discounts (`₹0.00` when unadjusted; `₹100.00` + `included` when a line has `kind: 'DISCOUNT'`, `original_amount_paise: 50000`, `amount_paise: 40000`), Paid, and Balance Due — AND verifies a quantity-typo `kind: 'CORRECTION'` reduction is NOT counted as a discount.
    - Verify `Discounts applied (included above)` appears in `Totals & Settlement` only when `discountsPaise > 0` and all existing `bill-panel.test.tsx` + `bill-line-actions.test.tsx` tests pass.
- **validation**:
  - `npm --prefix frontend test -- src/components/__tests__/bill-panel.test.tsx src/components/__tests__/bill-line-actions.test.tsx` passes (RED → GREEN).
  - Lint from `frontend/`: `.\node_modules\.bin\oxlint.cmd src/components/billing/BillPanel.tsx src/components/__tests__/bill-panel.test.tsx` exits `0`.
  - *(Repo-wide `tsc -b` and `guards.test.ts` run right after Wave 1 joins in T3 so parallel Wave 1 tasks never race.)*
- **status**: Completed
- **log**: Added `discountsPaise` (`DISCOUNT`/`WAIVER`-only), 4-tile `checkout-summary-strip` (`Bill Total`, `Discounts` + `included`, `Paid`, `Balance Due`), and `Discounts applied (included above)` row in `Totals & Settlement`. TDD RED (`3 failed | 11 passed`) -> GREEN (`29 passed` across `bill-panel.test.tsx` + `bill-line-actions.test.tsx`); `oxlint` 0 warnings/errors. Committed at `f961df10`.
- **files edited/created**: `frontend/src/components/billing/BillPanel.tsx`, `frontend/src/components/__tests__/bill-panel.test.tsx`

### T2: Implement adaptive 3-state layout & compact empty state in `VisitCheckout`

- **depends_on**: [T0]
- **location**:
  - `frontend/src/components/billing/VisitCheckout.tsx`
- **description**:
  - Extend `VisitCheckoutProps` with optional:
    - `onDirectPayment?: () => void`
    - `resolvingInitialVisit?: boolean` (prevents State 1 flicker & spurious `/api/appointments` fetch while `?appointment_id=` resolves `linkedAppointment`)
  - Import `Link` from `react-router`, `InlineAlert` from `../InlineAlert`, `istToday` from `../../format`, and `useAppointments` + `usePendingDues` from `../../api/queries` (`useVisitDues` is already imported).
  - Validate `selectedId` cleanly so invalid/non-positive query params (`?visit_id=abc` / `?visit_id=0`) never trap State 3 on `"Loading visit..."`:
    - `const rawSelectedId = picked === undefined ? initialVisitId : picked`
    - `const validSelectedId = typeof rawSelectedId === 'number' && Number.isFinite(rawSelectedId) && rawSelectedId > 0 ? rawSelectedId : null`
  - Handle `useVisits({ readyForCheckout: true })` error state cleanly (`isError: readyError, error: readyErr`):
    - `readyVisits = ready?.visits ?? []`
    - `isEmptyState = !resolvingInitialVisit && !readyPending && !readyError && readyVisits.length === 0 && validSelectedId == null`
    - Only fetch today's appointments when `isEmptyState` is true (`useAppointments({ appointment_date: today }, { enabled: isEmptyState, refetchInterval: false })`).
    - `completedTodayCount`: when `todayApptsData` is loaded, count rows where `a.status !== 'CANCELLED' && a.consultation_status !== 'CANCELLED' && (a.status === 'DONE' || a.status === 'COMPLETED' || a.consultation_status === 'COMPLETED')`; display `'—'` while loading or on `apptsError`.
    - Check `duesPending = pendingDuesPending || visitDuesPending` and `duesError = pendingDuesError || visitDuesError`; render `'—'` while loading or on error, and formatted count + `formatPaise(pendingDuesTotalPaise)` once both succeed (avoiding flashing `0` / `₹0.00`).
  - **Adaptive Layout States (`A2`)**:
    1. **Loading (`(resolvingInitialVisit || readyPending) && validSelectedId == null`)**: Compact single-column loading card (`Loading visits...`) — no empty 8-column right box.
    2. **Error (`readyError && validSelectedId == null`)**: Compact error card with `<InlineAlert tone="error">{errorText(readyErr, 'Could not load visits awaiting checkout. Try refreshing.')}</InlineAlert>` plus subtle `Direct payment (no visit)` button when `canCollect && onDirectPayment` (never misreporting a network drop as `"No visits awaiting checkout"`!).
    3. **State 1 — Empty (`isEmptyState`)**: Single compact card (`data-testid="checkout-empty-state"`, `max-w-2xl`):
       - Preserves any post-close `notice` status banner at top.
       - Heading: `No visits awaiting checkout` + concise subtitle (`Patients appear here when their doctor completes a consultation.`).
       - Compact 2-tile summary grid:
         - `Completed consultations today` → `{completedTodayCount}`
         - `Pending dues` → `{duesPending || duesError ? '—' : pendingDuesCount}` (with `{formatPaise(pendingDuesTotalPaise)} outstanding` when loaded)
       - Action row:
         - Primary link: `<Link to="/reception/billing?tab=dues">View Pending Dues →</Link>`
         - Subtle secondary button (when `canCollect && onDirectPayment`): `Direct payment (no visit)` (`type="button"`, calls `onDirectPayment()`).
    4. **State 2 — Visits Ready, None Selected (`readyVisits.length > 0 && validSelectedId == null`)**: Focused single-column queue card (`data-testid="checkout-queue-unselected"`, `max-w-3xl`) — no oversized blank right panel:
       - Preserves any post-close `notice` status banner.
       - Header: `Ready for checkout ({readyVisits.length})` + `"Select a patient to review charges, collect payment, and close the visit."` + subtle `Direct payment (no visit)` button (when `canCollect && onDirectPayment`).
       - Clean responsive grid (`grid-cols-1 sm:grid-cols-2 gap-2.5`) of selectable visit cards.
    5. **State 3 — Visit Selected (`validSelectedId != null`)**: Full expanded 2-column workspace (`data-testid="checkout-split-workspace"`, `grid grid-cols-1 items-start gap-5 lg:grid-cols-12`):
       - Left (`lg:col-span-4`): `Ready for checkout` queue list (shows compact empty/loading text when `readyPending` or `readyVisits.length === 0`, plus subtle `Direct payment (no visit)` button when `canCollect && onDirectPayment`).
       - Right (`lg:col-span-8`): Expanded panel showing `notice` banner if present, always-visible `Back to queue` button (`onClick={() => { setNotice(null); setPicked(null) }}` — works even when `readyVisits.length === 0` or `!visit`!), and `VisitDetailPanel` with:
         - `BillPanel`
         - `PaymentForm` (`Take payment`)
         - `CloseForm` — clarify heading to `Close Visit / Patient Out` while preserving exact submit button label `Patient Out` (`/^Patient Out$/i`).
  - Keep `VisitDuesSection` and `DueCollectForm` unchanged.
- **validation**:
  - `reason_not_testable`: `reception-billing.test.tsx` updates are owned by T4.
  - Lint from `frontend/`: `.\node_modules\.bin\oxlint.cmd src/components/billing/VisitCheckout.tsx` exits `0`.
  - *(Repo-wide `tsc -b` and `guards.test.ts` run right after Wave 1 joins in T3.)*
- **status**: Completed
- **log**: Implemented adaptive 3-state layout (`checkout-empty-state`, `checkout-queue-unselected`, `checkout-split-workspace`), loading/error states (`readyError` + `InlineAlert`), `validSelectedId > 0`, `resolvingInitialVisit`, lazy `useAppointments` only on `isEmptyState`, combined pending dues + visit dues totals (`—` while loading/error), always-visible `Back to queue`, and `Close Visit / Patient Out` heading. `oxlint` 0 warnings/errors (`reason_not_testable`: `reception-billing.test.tsx` owned by T4). Committed at `61a00dc6`.
- **files edited/created**: `frontend/src/components/billing/VisitCheckout.tsx`

### T3: Remove duplicated sidebar shortcuts & top `Add item` button from `ReceptionBillingPage`

- **depends_on**: [T1, T2]
- **location**:
  - `frontend/src/pages/ReceptionBillingPage.tsx`
- **description**:
  - Remove `actions={...}` (`Appointments` and `Check-in & Token` links) from `<ReceptionDeskTabs>` (lines 314–333).
  - Remove the top `Consultation Checkout Queue` label and prominent green `+ Add item` button (lines 345–357) from above `<VisitCheckout />`.
  - Capture `isPending: linkedAppointmentPending` from `useAppointment(appointmentIdParam ? Number(appointmentIdParam) : 0)` and pass both `onDirectPayment={canCollect ? () => setCheckoutMode('other') : undefined}` and `resolvingInitialVisit={Boolean(appointmentIdParam) && linkedAppointmentPending}` to `<VisitCheckout />`.
  - In `checkoutMode === 'other'`, update heading from `Add Item / Direct Payment` to `Direct Payment (No Visit)`.
  - Clean up unused imports (`Link`, `IconPlus`, `IconTicket`), while **keeping** `IconUser` (still used inside `checkoutMode === 'other'`).
  - Preserve `Pending Dues` tab, `Receipts` (`tab=ledger`) tab, `Admin` oversight view, and `ReceiptDialog` intact.
- **validation**:
  - `reason_not_testable`: `reception-billing.test.tsx` updates are owned by T4.
  - `npm --prefix frontend run typecheck` exits `0` (verifies T1 + T2 + T3 together).
  - Lint from `frontend/`: `.\node_modules\.bin\oxlint.cmd src/pages/ReceptionBillingPage.tsx` exits `0`.
  - `npm --prefix frontend test -- src/test/guards/guards.test.ts` passes (`7/7` GREEN across T1 + T2 + T3).
- **status**: Completed
- **log**: Removed duplicated `ReceptionDeskTabs` `actions` (`Appointments`, `Check-in & Token`) and top `+ Add item` bar, wired `onDirectPayment` and validated `hasValidAppointmentId && linkedAppointmentPending` (`resolvingInitialVisit`), renamed standalone heading to `Direct Payment (No Visit)`, and cleaned unused imports (`Link`, `IconPlus`, `IconTicket`; kept `IconUser`). `tsc -b` exit 0, `oxlint` 0 warnings/errors, `guards.test.ts` 7/7 GREEN (`reason_not_testable`: `reception-billing.test.tsx` owned by T4). Committed at `f069bd72`.
- **files edited/created**: `frontend/src/pages/ReceptionBillingPage.tsx`

### T4: Update and expand `ReceptionBillingPage` integration tests

- **depends_on**: [T1, T2, T3]
- **location**:
  - `frontend/src/pages/__tests__/reception-billing.test.tsx`
- **description**:
  - Stub `/api/appointments` in `mockApi` for **all tests that enter `isEmptyState`**:
    - Test 1 (`renders counter checkout desk...`, mounts with `visits: []`)
    - Test 2 (`takes a visit payment... then closes the visit`, transitions to `isEmptyState` after `Patient Out` closes the last ready visit!)
    - Test 6 (`renders closed visit dues...`, mounts on checkout tab with `visits: []` before clicking `Pending Dues`)
  - Fix `/Pending Dues/i` link queries in **Test 1 (line 303)** AND **Test 6 (line 620)** to match the tab cleanly (`/^Pending Dues$/i` or `within(screen.getByRole('navigation', { name: /Reception Desk Financial Tabs/i }))`) so the new `View Pending Dues →` link in `checkout-empty-state` does not cause multi-match errors.
  - Update Test 1 (`renders counter checkout desk...`):
    - Scope negative assertions to `within(screen.getByRole('main'))` confirming `Appointments` and `Check-in & Token` links are absent (not `<nav>`, which would be a false positive, and not global `screen`, which includes `<aside>`).
    - Assert top `Add item` button is NOT rendered when no visit is selected.
    - Assert `checkout-empty-state` renders `No visits awaiting checkout`, completed consultations today count, pending dues count + formatted total, and `View Pending Dues` link (`/reception/billing?tab=dues`), and `checkout-split-workspace` is absent.
    - Click `Direct payment (no visit)` to open `Direct Payment (No Visit)` and complete the existing standalone payment + receipt + Pending Dues flow.
  - Add focused tests covering:
    - **Unselected queue → expanded split workspace → Back to queue**: With 1 ready visit, renders `checkout-queue-unselected` (no `checkout-split-workspace`); clicking the visit expands `checkout-split-workspace` displaying `checkout-summary-strip`, `Visit Bill`, `Take payment`, and `Close Visit / Patient Out`; clicking `Back to queue` returns to `checkout-queue-unselected`.
    - **`Add medicine` / `Add particular` only after visit selection**: Using `{ ...mockMe, permissions: [...mockMe.permissions, 'bill:write'] }`, verify neither `Add medicine` nor `Add particular` appears before selecting a visit and both appear once the visit is selected.
    - **Queue fetch failure error state**: When `GET /api/visits` returns 500, verify `role="alert"` renders instead of falsely showing `No visits awaiting checkout`, while `Direct payment (no visit)` remains clickable.
  - Preserve all existing tests (overpayment client cap, server `422 overpayment_rejected`, network-drop form preservation with single call, closed visit dues collection, reception today-only receipts, and `ADMIN` oversight view).
- **validation**:
  - `npm --prefix frontend test -- src/pages/__tests__/reception-billing.test.tsx src/components/__tests__/bill-panel.test.tsx src/components/__tests__/bill-line-actions.test.tsx` passes 100%.
  - `npm --prefix frontend run typecheck` exits `0`.
  - Lint from `frontend/`: `.\node_modules\.bin\oxlint.cmd src/pages/__tests__/reception-billing.test.tsx` exits `0`.
- **status**: Completed
- **log**: Updated Tests 1, 2, and 6 with `/api/appointments` stubs and tab-scoped `Pending Dues` queries; added `<main>`-scoped negative checks for removed sidebar shortcuts and top `Add item` button; added 3 new integration tests (unselected queue → split workspace → `Back to queue`, `bill:write` `Add medicine`/`Add particular` visibility after visit selection, and queue HTTP 500 error alert). Scoped Vitest `40/40` passed (`reception-billing` 11, `bill-panel` 14, `bill-line-actions` 15), `tsc -b` exit 0, `oxlint` 0 warnings/errors. Committed at `bc2faf97`.
- **files edited/created**: `frontend/src/pages/__tests__/reception-billing.test.tsx`

### T5: Full frontend verification & manual visual checklist

- **depends_on**: [T1, T2, T3, T4]
- **location**:
  - `frontend/` (read-only verification across all modules)
- **description**:
  - Run the complete frontend quality gate:
    - `npm --prefix frontend run typecheck`
    - `npm --prefix frontend run lint` (0 errors, 0 warnings)
    - `npm --prefix frontend test`
    - `npm --prefix frontend run build`
  - Provide a concise manual visual checklist for `http://localhost:5173/reception/billing` confirming compact empty state (0 visits), focused single-column queue before selection, expanded 2-column billing workspace upon selection with Checkout Summary Strip & Discounts, absence of sidebar-duplicate shortcuts and top `Add item` button, and working `Direct payment (no visit)`.
- **validation**:
  - All 4 npm checks (`typecheck`, `lint`, `test`, `build`) exit with code `0`.
- **status**: Completed
- **log**: Full frontend verification gate passed cleanly: `tsc -b` exit 0; `oxlint` 0 warnings & 0 errors across 197 files; `vitest run` 75/75 files, `562 passed | 5 skipped (567)`; `vite build` ✓ built in 4.26s.
- **files edited/created**: None (read-only verification)

## Parallel Execution Groups

| Wave | Tasks | Can Start When |
| ------ | ------- | ---------------- |
| 0 | T0 | Immediately (Git checkpoint) |
| 1 | T1, T2 | T0 complete (non-overlapping file ownership: `BillPanel.tsx`+test vs `VisitCheckout.tsx`) |
| 2 | T3 | T1 and T2 complete (`ReceptionBillingPage.tsx`, runs `tsc -b` + `guards.test.ts` once Wave 1 joins) |
| 3 | T4 | T1, T2, T3 complete (`reception-billing.test.tsx`) |
| 4 | T5 | T1, T2, T3, T4 complete (Full frontend verification gate) |

## Testing Strategy

- **Unit & Integration Tests (Vitest + React Testing Library)**:
  - `frontend/src/components/__tests__/bill-panel.test.tsx` + `bill-line-actions.test.tsx` — Checkout Summary Strip (`Bill Total`, `Discounts`, `Paid`, `Balance Due`), `DISCOUNT`/`WAIVER`-only discount calculation (excluding quantity `CORRECTION`s), `Discounts applied (included above)` in `Totals & Settlement`, and full regression on existing 5-section & totals contracts.
  - `frontend/src/pages/__tests__/reception-billing.test.tsx` — Removal of redundant `Appointments`/`Check-in & Token` shortcuts (scoped to `<main>`) and top `Add item` button, compact empty state (counts + `View Pending Dues` link + `Direct payment (no visit)`), queue error handling, unselected queue vs expanded 2-column visit workspace + `Back to queue`, `bill:write` `Add medicine`/`Add particular` visibility only after visit selection, `Close Visit / Patient Out`, payment/overpayment/422/network-drop safety, visit dues, today-only receipts, and `ADMIN` oversight.
  - `frontend/src/test/guards/guards.test.ts` — UX-04 contrast/font-size, UX-06 accessible labels, and IST date guard (cap = 0).
- **Static & Production Build Gate**:
  - `npm --prefix frontend run typecheck`
  - `npm --prefix frontend run lint`
  - `npm --prefix frontend test`
  - `npm --prefix frontend run build`

## Risks & Mitigations

- **Risk**: Showing `-₹X` `Discounts` right below net `Bill total` in `BillPanel` could confuse reception into double-discounting, or counting `CORRECTION` quantity fixes as discounts.
  - **Mitigation**: T1 restricts `discountsPaise` to `DISCOUNT`/`WAIVER` history lines and explicitly labels discounts as `included` / `Discounts applied (included above)`.
- **Risk**: `GET /api/visits?ready_for_checkout=true` failing or dues still loading could falsely render `"No visits awaiting checkout"` or flash `0` pending dues.
  - **Mitigation**: T2 gates `isEmptyState` on `!readyError`, renders an `InlineAlert` on fetch failure while keeping `Direct payment (no visit)` accessible, and displays `'—'` for dues/completed counts while loading or on error.
- **Risk**: Invalid `?visit_id=abc` / `?visit_id=0` or deep-linking to a closed visit could trap State 3 on `"Loading visit..."` or hide `Back to queue`.
  - **Mitigation**: T2 validates `validSelectedId > 0`, accepts `resolvingInitialVisit` to avoid deep-link flicker, and always renders `Back to queue` in State 3.
- **Risk**: Existing `reception-billing.test.tsx` tests fail on duplicate `/Pending Dues/i` links or unmocked `GET /api/appointments` (including after closing the last visit in Test 2).
  - **Mitigation**: T4 explicitly updates Tests 1, 2, and 6 for `/api/appointments` and scopes tab link assertions cleanly.
