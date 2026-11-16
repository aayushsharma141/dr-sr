# Phase 22: Integrated OPD Workflow - Research

**Researched:** 2026-11-15
**Domain:** Brownfield completion of an existing FastAPI + SQLAlchemy + PostgreSQL / React 19 + TanStack Query hospital OPD application (offline LAN). No new technology; this is a "what is left, where does it touch, what is risky" map.
**Confidence:** HIGH for what is built and which files each remaining item touches (every claim below was read in code this session). MEDIUM for proposed endpoint and migration shapes (they are recommendations, not decisions). Items needing the owner are listed in "Owner Decisions Needed" and are NOT decided here.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

### Owner-decided (chat, 2026-11-15) — locked
- Q2: OPD workflow registered in ROADMAP.md as Phase 22; Advanced Data Operations renumbered to Phase 23.
- Q5: legacy screen-only hold renamed "ON HOLD (THIS SCREEN ONLY)".
- Q10: reception keeps the Reports tab (OD-22-01); it shows today's collection summary; referral report stays admin-only (OD-22-21).
- Q19 (reassign): any consulting doctor; current department kept when the new doctor belongs to it; otherwise reception picks one of the new doctor's departments (OD-22-20).

### Navigation and screens — auto-answered (PROPOSED)
- Q1: no component library; reuse the existing hand-built components and Tailwind tokens.
- Q9: rename "Billing & Payments" to "Billing & Checkout"; Receipts is its own tab; Dues stays reachable.
- Q11: Dashboard and Waiting Room both exist; the Waiting Room adds ordering, filters, reassign and cancel.
- Q12: "Patient Out" is the action label; show the outstanding amount before confirming.
- Q13: a doctor sees own consultation fee and own charges only; no visit total, other doctors' charges, or payment controls.

### Check-in and waiting room — auto-answered (PROPOSED)
- Q3: status labels Waiting / In Cabin / Completed; NO_SHOW displayed as "No-show" (design term).
- Q4: Waiting is neutral slate; amber means PRIORITY only; red means EMERGENCY or destructive/error. Always show a text label.
- Q6: no new emergency sound; existing Call chime unchanged.
- Q7: emergency banner in the doctor app shell on every doctor screen until acknowledged.
- Q8: no new animation on the waiting room, classification or alerts; the existing in-cabin pulse stays.
- Q15: priority examples are illustrative copy, not a clinical rule.
- Emergency banner colour: `bg-red-600` (same token as the EMERGENCY badge), replacing the spec's red-700.

### Validation and limits — auto-answered (PROPOSED)
- Q16: Patient Out with a balance needs a non-empty reason after trimming; PRIORITY/EMERGENCY reason needs at least 3 characters.
- Q17: reason fields capped at 500 characters in UI and API, with a counter. Existing exception to resolve during planning: follow-up closure reason currently caps at 1000 (`schemas/follow_up.py`).
- Q14: from Wave 2 on, only the declared type sizes (12, 14, 16, 36), weights 400 and 700, and spacing in multiples of 4px. Wave 1 drift is recorded for the auditor, not rebuilt now.
- Q18: system font stack; Nirmala UI is the Hindi-capable Windows fallback; UX-05 stays open until tested on hospital computers.

### Offline and connection — auto-answered (PROPOSED)
- Q19 (LAN status): mount `LANStatusPill` in the application shell so connection state is visible on every screen.

### Adviser UX rules — adopted as PROPOSED
- Preserve unsaved form values during a LAN drop; never show them as saved until the server confirms.
- Show "Last updated" on waiting room and queue screens; show a stale-data warning when refresh fails.
- Confirm consequential actions: reassignment, cancellation, Patient Out, fee adjustment.
- Keep filters, selected doctor and useful scroll position after successful actions.
- Never auto-retry a payment or other non-idempotent financial action after a network failure; check whether the original committed first. No idempotency key exists yet; this is new backend work and is deferred to the payment wave.

(Scope note: CONTEXT marks every item except the four "Owner-decided" ones as PROPOSED = auto-answered, not owner-confirmed.)

### Claude's Discretion
- Exact layout details within the approved UI-SPEC copy and spacing rules.
- Order of implementation within the waves in `22-DESIGN.md` §8.

### Deferred Ideas (OUT OF SCOPE)
- Cross-department referral/transfer workflow with its own record (needs its own design).
- Payment idempotency keys / transaction-status lookup (payment wave).
- Medicine and particular bill lines, bill voids, and payment-to-visit linking (Wave 3 remainder). [NOTE: this is listed as deferred in CONTEXT but is in scope of this research by the caller's instruction; see Open Question OQ-1.]
- Hindi font bundling (UX-05).
- Reception Reports page contents beyond today's collection summary (Wave 5).
- Phase 23: Advanced Data Operations.
</user_constraints>

<phase_requirements>
## Phase Requirements

No requirement IDs are registered for Phase 22 in `.planning/REQUIREMENTS.md` (confirmed: its Billing section is BIL-01..05 and UX-01..08 only). The caller instructed using design tasks T22-01..T22-11 and the UAT IDs as the requirement set. The authoritative UAT status is `docs/engineering/UAT_EXECUTION_RESULTS.json` (see Pitfall P1: the markdown report disagrees with it).

| ID | Description | Research Support |
|----|-------------|------------------|
| T22-05 / T22-06 (finish) | Waiting Room, doctor queue badges/order/Call, emergency alert + banner | Section "Wave 2 remainder" |
| T22-07 (rest) | payments.visit_id, balance switch, void/line columns | Section "Wave 3 remainder" W3-A, W3-D |
| T22-08 | Doctor charges, reception lines, void, permissions `bill:write` | W3-B, W3-C |
| T22-09 | Billing & Checkout, Receipts, financial history | "Wave 4" |
| T22-10 | Doctor charges panel | "Wave 4" |
| T22-11 | Referral report (admin) | "Wave 5" |
| FEE-03, FEE-04, FEE-05, FEE-07, AUD-04 | Built backend (migrations 0027/0028, `fee_adjustments.py`); UAT JSON still shows NOT IMPLEMENTED / FAIL, needs a re-run | W2-G, Validation |
| FEE-06 | Reception adjusts WITH permission | BLOCKED on owner decision OD-A |
| FEE-09 | Review adjustment history | No read endpoint exists yet (W3-C) |
| MED-02 | Reception sees prescription for reference | BLOCKED on owner decision OD-B (D-04 conflict) |
| MED-04..08, MED-11, MED-12, BILL-03..05 | Reception medicine / particular lines, qty x rate, negative blocked | W3-A..D |
| QUE-10, AUD-08, PRI-08 | Built backend (`/reassign`, `/acknowledge-alert`, `APPOINTMENT_REASSIGNED`); UAT JSON stale | W2-G |
| PRI-07..09 | Emergency alert, acknowledge, persists until ack | Built (backend + banner); doctor queue badge missing (W2-A) |
| SCENARIO-02 | Free follow-up via fee waiver | Waiver built; scenario needs re-run (no automatic free-window, OD-22-12) |
</phase_requirements>

## Summary

The phase is further along than the caller's brief says in one respect and behind in another. **Wave 2 UI is already committed**, not "in the working tree": commit `f4e480fc` contains `frontend/src/components/EmergencyAlertBanner.tsx`, `frontend/src/pages/WaitingRoom.tsx`, the `/reception/waiting` route, the AppShell nav item and banner mount, and their tests (`git log --stat` checked this session; `git status` shows no uncommitted frontend files). The uncommitted work is backend Wave 3 slice 2 only: migration `0028_bill_item_adjustments.py`, `routers/fee_adjustments.py`, `schemas/fee_adjustment.py`, `services/bill_service.py`, `tests/test_phase22_fee_adjustment.py`, plus edits to `models.py`, `permissions.py`, `main.py`, `audit_service.py`, `backup_service.py`, `booking_service.py`, `matrix.py`, `openapi.snapshot.json`, `test_permissions_catalogue.py` and doc files.

What remains is small for Wave 2 (doctor queue badges, label/colour clean-ups, doc sync), medium for Wave 3 (new migration, enum and permission additions, line endpoints, and the balance and payment-guard switch), large for Wave 4 (Billing & Checkout restructure, doctor charges panel, Receipts and Reports routes), and small for Wave 5 (one aggregate endpoint and an admin page). The single riskiest piece is the **balance switch**: today every balance, payment guard and fee-adjustment guard is computed per consultation from the consultation's own bill line and its appointment-linked payments. Adding medicine and particular lines is not safe until those three code paths become visit-level (Pitfall P2, P3).

Two items in the design cannot be built without an owner decision, and one auto-answered default is already satisfied by existing code: (1) "Reception may adjust only with an explicit permission" has no grant mechanism in this codebase (permissions are a static per-role catalogue), (2) reception billing medicines "from the prescription" conflicts with the D-04 default-deny on reception reading clinical records, and (3) Q19 "mount LANStatusPill in the shell" is moot because AppShell already renders a live server-link indicator.

**Primary recommendation:** Finish Wave 2 as a short UI pass, then do Wave 3 strictly in this order: permissions catalogue, migration 0029, visit-level balance and payment guard with the before/after regression test, then line endpoints. Do not expose any UI that creates medicine or particular lines until the visit-level payment guard ships. Get the owner decisions OD-A..OD-F before planning the tasks they block.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Authorisation of every bill, fee, void and payment action | API / Backend | — | AGENTS.md rule 13; routes use `require(Permission.X)` in `backend/src/kalyan_api/core/policy.py` |
| Bill total, paid, due, previous dues | API / Backend | — | Computed, never stored (design §4 balance rule; BIL-03); the UI only renders |
| Line amount = quantity x rate, rounding | API / Backend | UI (preview only) | Money is integer paise (BIL-02); the server is the authority |
| Payment concurrency / overpayment guard | API / Backend (row locks) | Database (constraints) | No DB trigger exists for overpayment (see Pitfall P6); row locks are the only guard |
| Fee snapshot, adjustment history | Database / Storage | API / Backend | `bill_items`, `bill_item_adjustments` append-only grants |
| Queue order, classification, alert | API / Backend | UI polling | `_suggested_order_key` in `routers/appointments.py`; UI polls 10 s / 5 s |
| Emergency banner | Browser / Client | API | Renders what `/doctor/queue` returns; server enforces own-consultation scope |
| Connection status | Browser / Client | `/api/health` | Already in AppShell via `useServerLink` |
| Referral report aggregation | API / Backend | Database | One GROUP BY over `visits`; UI renders |
| Receipt printing | Browser / Client | API (receipt data, DUPLICATE audit) | Existing `ReceiptDialog`, `/payments/{id}/receipt` |

## Standard Stack

No new packages are needed for any remaining item. Everything below is already pinned in the repo.

### Core (existing, verified in `backend/pyproject.toml` and `frontend/package.json`)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| FastAPI | 0.162.0 | Routers, `Depends(require(...))` policy | Existing project pattern |
| SQLAlchemy | 2.0.55 | Models, `with_for_update()` locks | Existing |
| Alembic | 1.20.1 | Migrations (next number is 0029) | Existing; single-head test in `tests/test_migrations.py` |
| pydantic | 2.14.2 | `Field(ge=, max_length=)` validation | Existing |
| psycopg | 3.3.6 | PostgreSQL driver | Existing |
| React | 19.3.1 | UI | Existing |
| @tanstack/react-query | 5.105.0 | Server state, polling | Existing |
| react-router | 8.5.1 | Routes in `frontend/src/router.tsx` | Existing |
| pytest | 9.2.0 | Backend tests | Existing |
| vitest | 5.0.5 (reported by the run) | Frontend tests | Existing |

### Alternatives Considered
None. CONTEXT Q1 locks "no component library".

**Installation:** none.

**Version verification:** versions above are the pins read from `backend/pyproject.toml` (lines 11-24, 28-34) this session; no registry lookup was needed because no package is added.

## Package Legitimacy Audit

No external packages are installed by this phase. Audit not applicable.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Verified In-Repo Values (quoted verbatim, read this session)

These are the discrete values the remaining work must reuse. Each was read from the file named.

- Permissions, `backend/src/kalyan_api/core/permissions.py:95-98` [VERIFIED: core/permissions.py:95-98]:
  `BILL_CLINICAL = "bill:clinical"` and `BILL_ADJUST = "bill:adjust"`. Granted at lines 124 (`Permission.BILL_ADJUST` inside `Role.ADMIN`) and 166 (`Permission.BILL_CLINICAL` inside `Role.DOCTOR`). There is no `bill:write` yet; `Role.RECEPTION` (lines 142-162) holds `PAYMENT_CREATE`, `PAYMENT_READ`, `RECEIPT_REPRINT`, `VISIT_READ`, `VISIT_WRITE` and none of the BILL_* values.
- Bill categories and sources, `backend/src/kalyan_api/migrations/versions/0027_bill_items.py:72-80` [VERIFIED: 0027:72-80]:
  `"category IN ('CONSULTATION', 'PROCEDURE', 'PACKAGE', 'MEDICINE', 'ADDITIONAL')"`, `"source IN ('DOCTOR', 'RECEPTION', 'SYSTEM')"`, `"quantity > 0"`, `"rate_paise >= 0 AND amount_paise >= 0"`, `"category <> 'CONSULTATION' OR appointment_id IS NOT NULL"`.
- Python enum lags the DB CHECK, `backend/src/kalyan_api/models.py:925-928` [VERIFIED: models.py:925-928]:
  `class BillItemCategory(StrEnum)` contains only `CONSULTATION = "CONSULTATION"`. `BillItemAdjustmentKind` (models.py:1005-1010) has `DISCOUNT`, `WAIVER`, `CORRECTION` but the DB CHECK in `0028_bill_item_adjustments.py:70-72` is `"kind IN ('DISCOUNT', 'WAIVER', 'CORRECTION', 'VOID')"`.
- `bill_items` columns that exist (0027 + 0028): `id, visit_id, patient_id, appointment_id, category, source, description, quantity numeric(10,2), rate_paise, amount_paise, created_by_user_id, created_at, original_amount_paise` [VERIFIED: 0027:35-52, 0028:35]. Columns in the design but NOT built: `unit`, `treatment_plan_id`, `prescription_item_id`, `status`, `void_reason`, `voided_by`, `voided_at`, `version_id`. `payments.visit_id` is not built (models.py:1525-1594 shows no `visit_id`).
- Grants: `bill_items` is `SELECT, INSERT, UPDATE` and `bill_item_adjustments` is `SELECT, INSERT` [VERIFIED: services/backup_service.py:338-342]; `payments` is `("SELECT", "INSERT", "UPDATE", "DELETE")` [VERIFIED: backup_service.py:317]. `tests/test_migrations.py` checks this table against a migrated DB (comment at backup_service.py:293-294).
- Payment methods, `models.py:1501-1506` [VERIFIED]: `CASH = "CASH"`, `UPI = "UPI"`, `CARD = "CARD"`; DB check `ck_payments_payment_method` is `payment_method IN ('CASH', 'UPI', 'CARD')`. (The markdown UAT report's "Net Banking" row is not supported by code; see P1.)
- Audit action added for Wave 3: `BILL_ITEM_ADJUSTED = "BILL_ITEM_ADJUSTED"` [VERIFIED: git diff of services/audit_service.py]. Existing: `APPOINTMENT_ALERT_ACKNOWLEDGED`, `APPOINTMENT_REASSIGNED`, `VISIT_CLOSED`, `VISIT_CANCELLED`.
- Fee-adjustment error codes in `services/bill_service.py:58-143` [VERIFIED]: `no_bill_line`, `visit_closed`, `consultation_cancelled`, `adjustment_kind_not_permitted`, `adjustment_reason_required`, `waiver_must_be_zero`, `discount_must_lower_fee`, `no_change`, `amount_negative`, `adjustment_below_paid`.
- Reassign/ack codes: `reassign_not_waiting`, `reassign_same_doctor`, `reassign_reason_required`, `visit_not_open`, `department_required`, `duplicate_appointment` (booking_service.py:501-552); `no_emergency_alert`, `alert_already_acknowledged` (booking_service.py:409-420) [VERIFIED].
- Next migration number is `0029` (head is `0028`, `down_revision: str | None = "0027"` in 0028) [VERIFIED: 0028:28-29, directory listing].

## Architecture Patterns

### System Architecture Diagram (target state after remaining waves)

```
Reception browser                 FastAPI (/api)                          PostgreSQL (kalyan_dev)
-----------------                 ---------------                         -----------------------
Check-in & Token ──POST /appointments/{id}/check-in, /walk-in/new-patient──> appointments, visits (referral),
   (built)                         booking_service.check_in                    bill_items[CONSULTATION snapshot]
Waiting Room (built) ──GET /appointments, PATCH /priority, POST /reassign──> consultation_priority_events
Doctor shell                      GET /doctor/queue (suggested order)          (append-only)
  EmergencyAlertBanner (built) ──POST /acknowledge-alert (5 s poll)──────────>
Doctor charges panel  [T22-10] ──POST /appointments/{id}/bill-items (bill:clinical, own)
                      [T22-10] ──POST /appointments/{id}/fee-adjustment (built) ──> bill_items.amount_paise + bill_item_adjustments
Billing & Checkout    [T22-09] ──GET /visits/{id}/bill  [NEW] ───────────────────> Σ ACTIVE bill_items, payments (visit_id OR appt in visit)
   add medicine/particular ─────POST /visits/{id}/bill-items (bill:write) [NEW]
   collect payment ─────────────POST /payments {visit_id} [CHANGED guard: visit level, visit row lock]
   Patient Out ─────────────────POST /visits/{id}/close (built; outstanding now = visit-level)
Receipts / Reports    [T22-09] ──GET /billing/receipts/today (built)
Admin referral report [T22-11] ──GET /reports/referrals [NEW, admin-only perm] ─> visits.referral_source, referrer_name
```

### Recommended Project Structure (additions only)
```
backend/src/kalyan_api/
├── migrations/versions/0029_bill_lines_and_visit_payments.py   # NEW (proposed name)
├── routers/bill_items.py            # NEW: add / correct / void / read lines (or extend fee_adjustments.py)
├── schemas/bill.py                  # NEW: line in/out, bill view, totals
├── services/bill_service.py         # EXTEND: add_line, correct_line, void_line, visit_bill()
├── services/billing_service.py      # CHANGE: visit_charge_lines, visit_outstanding_paise, compute_visit_dues
├── routers/reports.py               # NEW (Wave 5): referral report
frontend/src/
├── pages/ReceptionBillingPage.tsx   # RESTRUCTURE (Billing & Checkout)
├── components/billing/VisitCheckout.tsx   # EXTEND, do not fork (UI-SPEC Reuse Map)
├── components/billing/BillPanel.tsx       # NEW
├── pages/ReceiptsPage.tsx, ReceptionReportsPage.tsx   # NEW routes
├── pages/admin/ReferralReportPage.tsx     # NEW (Wave 5)
```

### Pattern 1: One route per permission, own-scope in the handler
`routers/fee_adjustments.py` is the template: two routes (`/fee-adjustment` with `Permission.BILL_CLINICAL`, `/fee-correction` with `Permission.BILL_ADJUST`), a shared `_apply(...)` that locks the appointment via `booking_service.lock_appointment`, returns 404 (not 403) for another doctor's consultation (`own_only and appt.doctor_id != principal.doctor_id`), calls the service, then writes one `audit_service.record(...)` row. New line endpoints should copy this shape. [VERIFIED: routers/fee_adjustments.py:27-114]

### Pattern 2: Append-only history written in the same transaction
`bill_service.adjust_consultation_fee` inserts a `BillItemAdjustment` row (old and new quantity, rate, amount, kind, reason, actor) and then mutates the line, flushing once. Void and correction of other lines must do the same, and must use `kind` VOID / CORRECTION. [VERIFIED: services/bill_service.py:145-161]

### Pattern 3: Optimistic locking with `version_id`
Appointments and visits carry `version_id` and `require_version(...)`; `bill_items` has no `version_id` (design lists one, 0027 omits it). For lines, use `with_for_update()` as `adjust_consultation_fee` does (bill_service.py:85-92) rather than adding a version column, unless the planner wants client-visible conflict handling (then add it in 0029).

### Anti-Patterns to Avoid
- **Computing a balance from only the CONSULTATION line.** `billing_service.visit_charge_lines` does exactly this today (billing_service.py:62-122). Any other line would be invisible to dues, to Patient Out, and to the payment guard.
- **Counting both `visit_id` and `appointment_id` payment sets by summing two queries.** Use one query with `OR`, or a payment is counted twice (design §4 balance rule says `visit_id = visit OR appointment_id in visit`).
- **Letting a UI button hide a permission rule.** The UI only hides; the route enforces (design §6, AGENTS rule 13).
- **Auto-retrying a payment POST** after a network failure (CONTEXT adviser rule; no idempotency key exists).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Permission checks | Inline role `if` statements | `Depends(require(Permission.X))` + own-scope check in handler | Route-walk tests (`test_rbac_matrix.py`) fail any route lacking a policy |
| Dialogs | New modal | `frontend/src/components/Modal.tsx` (native `<dialog>`) | UX-02; UI-SPEC Reuse Map |
| Inline errors | `alert()` or toast | `InlineAlert.tsx` (`role="alert"`) | UX-03 |
| 409 stale-write | Custom text | `ConflictBanner.tsx` | UI-SPEC |
| Receipt print / reprint | New print view | `ReceiptDialog`, `ReceiptHost`, `/payments/{id}/receipt` (writes `RECEIPT_REPRINTED` audit) | BIL-04, UX-01 |
| Receipt numbering | Own counter | `receipt_service.allocate_next_receipt_number` | Gap-free, concurrency-tested (`test_receipt_concurrency.py`) |
| Money formatting | Inline `toFixed` | `formatPaise`, `rupeesToPaise`, `paiseToRupees` | BIL-02 |
| Token / time format | Custom | `formatToken`, `formatIst`, `istToday` in `frontend/src/format.ts` | Existing |
| Classification badge | New badge | `components/checkin/PriorityBadge.tsx` | UI-SPEC: "the only classification badge" |
| Optimistic lock | Hand-rolled | `require_version(...)` | Existing |

**Key insight:** every one of these has an existing, tested implementation. The work is wiring and one real piece of domain logic (the visit-level balance).

## Wave 2 Remainder (T22-05, T22-06)

State verified this session: backend done and passing; Waiting Room page, banner, route, nav, tests committed (`f4e480fc`); 34 frontend tests in the three Wave 2 test files pass (`vitest run` this session).

| # | Item | Exact files / functions | Notes |
|---|------|-------------------------|-------|
| W2-A | Doctor queue shows the classification badge | `frontend/src/pages/DoctorDashboard.tsx`: patient card (name/URN block around lines 655-700, where Call is rendered) and the two waiting lists (~L1150, ~L1600). Import `PriorityBadge` from `components/checkin/PriorityBadge`. | `grep -n "priority\|PriorityBadge" pages/DoctorDashboard.tsx` returned nothing: badge is NOT shown. Server already sorts `waiting` by `_suggested_order_key` (`routers/appointments.py:76-82`, applied at `waiting.sort(...)` in `get_doctor_queue`), so order needs no UI sort. `DoctorQueueItem` already has `priority_level`, `priority_reason`, `emergency_alerted_at` (used by `api/alerts.ts`). |
| W2-B | In-consultation card pinned, not re-sorted | Same file; UI-SPEC S3 (PROPOSED) | Server returns `in_consultation` as a separate list already. |
| W2-C | Check-in list clean-ups (Q3, Q4, R1) | `frontend/src/components/checkin/TodayAppointmentsPanel.tsx`: `statusView()` (lines 28-50), row label "Cancel", tablist (zero `onKeyDown`) | Today: Waiting is amber (`bg-amber-50 text-amber-900`), labels "With doctor", "Seen by doctor", "Not arrived", Cancelled is `bg-red-50`. CONTEXT Q3/Q4 (PROPOSED) want slate Waiting, "In Cabin", "Completed", "No-show", slate Cancelled; Q14 type rules. Arrow-key roving tabindex (R1). |
| W2-D | Waiting Room spec deltas | `frontend/src/pages/WaitingRoom.tsx` | Built empty copy is "No patients here." (spec: per-column copy "No one is waiting." etc.); title uses `text-2xl` (24px, outside the declared 12/14/16/36 sizes, Q14); `p-3`/`gap-3` instead of the migration table; Completed "Open bill" link is `/reception/billing?appointment_id=..&patient_id=..` and depends on how Wave 4 resolves that URL (see W4-A). Cancel uses an inline reason form (spec-consistent) via `PATCH /appointments/{id}/status`. |
| W2-E | LAN status (Q19) | `frontend/src/components/AppShell.tsx`: `useServerLink()` at line 460, `SERVER_LINK_VIEW` (lines 61-92), phone badge ~L1013 and sidebar foot | **Connection state is already on every screen.** `LANStatusPill.tsx` (uses `useHealth`) is not imported anywhere except its own test. Mounting it would duplicate the indicator. Recommend closing this CONTEXT item as "already satisfied by `useServerLink`"; needs owner OK because CONTEXT auto-answered the opposite (OD-F). |
| W2-F | "Last updated" and stale warning on the doctor queue | `DoctorDashboard.tsx` / `useDoctorQueue` (queries.ts ~L1035) | Waiting Room already has both (`dataUpdatedAt`, `list.isError` InlineAlert). Doctor queue has no equivalent. |
| W2-G | Evidence and docs sync | `docs/engineering/UAT_EXECUTION_RESULTS.json`, `scripts/qa_opd_full_suite.py` (lines ~891, 1200-1225, 1247-1276, 1572, 1595 hard-code NOT IMPLEMENTED / PARTIAL / FAIL), `.planning/ROADMAP.md` (Phase 22 status line says "Wave 2 backend done (screens open); Waves 3-5 not started"), `22-DESIGN.md` §8b "Still Open for Wave 2" | Stale. Also §8b says reassign "Preserves ... emergency alerted timestamps"; code raises a fresh alert (`booking_service._set_classification`, docstring "EMERGENCY raises a fresh alert for the doctor"; `reassign_waiting` docstring "an emergency raises a fresh alert for the new doctor"). Fix the doc, not the code. |
| W2-H | Deploy to :8000 | owner action | Brief says 0027/0028 applied to `kalyan_dev`. I did NOT verify DB state or whether `frontend/dist` is rebuilt and the server restarted. A new dist against an old server breaks check-in (design §8a). |

Smaller notes: the Doctor Dashboard Lab Hold chip is amber (`bg-amber-100 ... text-amber-900`, DoctorDashboard.tsx ~L660) and AppShell's problem-state LAN badge is amber; both pre-date the "amber = PRIORITY only" rule (Q4). Record for the auditor, do not rebuild unless the owner asks. `animate-pulse` dots exist on the doctor dashboard (L492, 1171, 1671, 1768) and in AppShell's connected badge; Q8 says the in-cabin pulse stays.

## Wave 3 Remainder (T22-07 rest, T22-08)

### What exists (read this session)
- `bill_items` with a SYSTEM CONSULTATION line written at check-in by `booking_service.ensure_consultation_line` (booking_service.py:361-400) and on reassignment (`reassign_waiting` calls it for the successor).
- `billing_service.visit_charge_lines` reads the CONSULTATION line's `amount_paise` (FEE-07 fixed), still per consultation, still only COMPLETED consultations owe.
- Fee adjustment: `POST /api/appointments/{id}/fee-adjustment` (doctor, own, DISCOUNT or WAIVER) and `POST /api/appointments/{id}/fee-correction` (admin, any kind). `adjustment_below_paid` guard uses `_paid_on_consultation` = payments with `Payment.appointment_id == appointment_id` only.
- Tests: `test_phase22_bill_snapshot.py` (7 tests), `test_phase22_fee_adjustment.py` (11 tests), both in this session's run.

### Remaining work packages

| # | Package | Files / functions touched | Depends on |
|---|---------|---------------------------|------------|
| W3-A | Migration 0029 (proposed content) | New `migrations/versions/0029_*.py`; `models.py` (`BillItem`, `Payment`, `BillItemCategory`, `BillItemAdjustmentKind`) | owner decisions OD-C, OD-D |
| W3-B | Permission `bill:write` for reception | `core/permissions.py` (enum + `Role.RECEPTION` set), `tests/test_permissions_catalogue.py` golden snapshot, `tests/support/matrix.py` rows | — |
| W3-C | Line endpoints and read endpoints | new `routers/bill_items.py` + `schemas/bill.py`, `services/bill_service.py`, `main.py` (include_router), `audit_service.py` (new actions), `openapi.snapshot.json`, `matrix.py` | W3-A, W3-B |
| W3-D | Balance and payment-guard switch | `services/billing_service.py` (`visit_charge_lines`, `visit_outstanding_paise`, `compute_visit_dues`, `visit_payments`), `routers/billing.py` `record_payment` (step 3 guard), `schemas/billing.py` (`PaymentCreate.visit_id`, `PaymentOut`), `routers/visits.py` (`_to_detail`, `_to_summaries`), `schemas/visits.py` | W3-A |
| W3-E | Re-base fee-adjustment guard | `services/bill_service.py` `_paid_on_consultation` and the `adjustment_below_paid` rule | W3-D |

**W3-A proposed 0029 content (planner may adjust):**
- `bill_items`: add `status varchar(16) NOT NULL DEFAULT 'ACTIVE'` with CHECK `status IN ('ACTIVE','VOIDED')`, `void_reason text NULL`, `voided_by_user_id` FK users NULL, `voided_at timestamptz NULL`, a CHECK that VOIDED rows carry reason, actor and time (mirror `ck_payments_reversal_integrity`), `unit varchar NULL`, `prescription_item_id bigint NULL` (only if OD-B allows it), `treatment_plan_id` (only if OD-C says package lines exist).
- `payments`: add `visit_id bigint NULL` with composite FK `(visit_id, patient_id) -> visits(id, patient_id)` (same-patient rule used by `fk_appointments_visit_patient` / `fk_bill_items_visit_patient`), index `ix_payments_visit_id`.
- No back-fill of `payments.visit_id`: design §4 says legacy payments keep `appointment_id` and still count; the visit-level query uses `OR`.
- `GRANT`s: `bill_items` already has UPDATE (0028) so void needs no new grant. No new table, so `RUNTIME_TABLE_GRANTS` in `backup_service.py` only changes if a table is added (if it is, update it in the same change, `test_migrations.py` enforces it).
- Optionally a CHECK `amount_paise = round(quantity * rate_paise)` is NOT recommended for the existing rows because a fee adjustment sets `rate_paise = amount_paise` with quantity 1 (bill_service.py:158-159); enforce multiplication in the service only (OD-E on rounding).
- Python side: extend `BillItemCategory` to all five DB values and `BillItemAdjustmentKind` with `VOID`; neither change requires a schema change (the DB CHECKs already allow them).
- Downgrade must refuse when rows exist, like 0027/0028 (financial records).

**W3-B:** add `BILL_WRITE = "bill:write"` next to `BILL_CLINICAL`/`BILL_ADJUST` and add it only to `Role.RECEPTION`. The golden snapshot test in `tests/test_permissions_catalogue.py` will fail until updated; `RolesMatrixPage` derives from `ROLE_PERMISSIONS` automatically (`routers/roles.py` header comment) so no UI change is needed there.

**W3-C proposed endpoints (names are recommendations, not decisions):**

| Method and path | Permission | Behaviour |
|-----------------|------------|-----------|
| `POST /api/visits/{id}/bill-items` | `bill:write` | Reception adds MEDICINE or ADDITIONAL with description, unit, quantity, rate; server computes amount; source RECEPTION; visit must be OPEN; refuse if no consultation COMPLETED and none... (see OD-D) |
| `POST /api/appointments/{id}/bill-items` | `bill:clinical`, own consultation (404 otherwise) | Doctor adds PROCEDURE (and PACKAGE only if OD-C allows); source DOCTOR; visit OPEN |
| `PATCH /api/bill-items/{id}` | `bill:write` for RECEPTION lines, `bill:clinical` for own DOCTOR lines (owner confirm, OD-G) | Change quantity or rate with reason; writes `bill_item_adjustments` kind CORRECTION; closed visit locked; new total must not fall below paid |
| `POST /api/bill-items/{id}/void` | as above | Sets status VOIDED + reason/actor/time, writes VOID history row |
| `GET /api/visits/{id}/bill` | `visit:read` + `payment:read` (reception, admin) | Lines by category with adjustment history, totals, payments, packages |
| `GET /api/appointments/{id}/bill-items` | `bill:clinical`, own | Doctor's own consultation fee and own charges only (Q13) |
| `GET /api/patients/{id}/dues` (or inside the bill view) | `payment:read` | Previous dues for this patient only: today `compute_visit_dues` and `compute_pending_dues` are global lists with no patient filter |

Every route needs: a row in `tests/support/matrix.py`, a regenerated `backend/tests/openapi.snapshot.json` (`python -m kalyan_api.cli export-openapi --out backend/tests/openapi.snapshot.json`, from `tests/test_openapi_snapshot.py`), an `AuditAction`, and its doc row in `docs/engineering/API_INVENTORY.md`.

**FEE-09 gap:** nothing reads `bill_item_adjustments` today (grep of routers/schemas found no reader). The bill view above is the read path the UI-SPEC "Changed from ₹X · reason · staff · time" line needs.

**W3-D balance rule to implement (from design §4, quoted):** `visit total = Σ ACTIVE bill_items.amount`; `visit paid = Σ non-reversed payments with visit_id = visit OR appointment_id in visit`; `due = max(0, total − paid)`. Required refinements the design does not state (flag to planner):
1. Lines belonging to a consultation with `consultation_status = 'CANCELLED'` must not count. A reassigned or cancelled consultation keeps its SYSTEM CONSULTATION line today (`reassign_waiting` cancels the old appointment and never touches its line; `PATCH /status` cancel likewise). Either exclude by joining `appointments.consultation_status`, or void those lines with a VOID history row. Excluding by join avoids rewriting rows (recommended).
2. "Only a COMPLETED consultation owes" is today's rule (`collectable`, `balance_paise ... if completed`). Define what makes a visit collectable once non-consultation lines exist (OD-D).
3. Packages: design says package instalments stay on `treatment_plans` and are "never double-counted". `treatment_plans` has no `visit_id` and payments for plans use `treatment_plan_id`. So the bill's Packages section is a display of plans, not bill_items that add to the total, unless OD-C says otherwise.
4. Closed visits: `compute_visit_dues` lists balances of CLOSED visits per consultation line; it must become visit-level, with payments against a closed visit still allowed (existing behaviour: paying a due does not reopen the visit).
5. `record_payment` step 3 (billing.py lines 151-214) caps a payment at the single consultation's remaining fee and locks the appointment row. For visit payments: lock the `visits` row (`with_for_update`), compute `visit total − visit paid`, reject above it with the existing `overpayment_rejected` code. Lock order must be visit, then appointment, then bill_items, in every writer (add line, adjust, void, pay) to avoid deadlock. Today `fee_adjustments._apply` locks appointment then line and `bill_service` reads the visit without a lock (`session.get(Visit, ...)`).
6. The check `new_amount_paise < paid` in `adjust_consultation_fee` must become "visit total after the change must not fall below visit paid", otherwise a visit-level payment (with `appointment_id` NULL) is invisible to the guard and money can be silently over-collected (Pitfall P3).

## Wave 4 (T22-09, T22-10, Receipts, Reports)

| # | Item | Files / functions | Notes |
|---|------|-------------------|-------|
| W4-A | Rename and restructure Billing & Checkout | `frontend/src/components/AppShell.tsx` `RECEPTION_NAVIGATION` entry `key: 'billing'` (label "Billing & Payments", ~L188); `frontend/src/pages/ReceptionBillingPage.tsx` (h1 at ~L318 "Billing &amp; Payments", `TabKey = 'checkout' \| 'ledger' \| 'dues'` at L38); `frontend/src/components/billing/VisitCheckout.tsx` (`VisitCheckout` L516, `VisitDetailPanel` L412, `PaymentForm` L190, `CloseForm` L334); `router.tsx` (route `/reception/billing`, redirect `/reception/dues` -> `?tab=dues`) | Left list needs token and completion time; `VisitSummary` has neither (schemas/visits.py L64-72). Add fields to the API rather than computing in the UI. `PaymentForm` is a per-consultation picker (`payable`, `selected`, "Only {x} is due on this consultation"); it must become a visit-level payment of the remaining visit balance, default = remaining. Keep the "no visit" other-payment path (`checkoutMode`) untouched. |
| W4-B | Bill panel, totals block, previous dues, financial history | New `components/billing/BillPanel.tsx` (extend `VisitCheckout`); hooks in `api/queries.ts`; types in `api/types.ts` (no bill types exist today, grep found none) | UI-SPEC S4 totals order: bill total, paid earlier, paying now, remaining on this visit, previous dues (separate), total outstanding. Reuse `usePatientPayments`, `usePendingDues` fields `total_sessions`/`completed_sessions` for packages. Locked-bill message after close. |
| W4-C | Patient Out label and outstanding preview (Q12, Q16) | `CloseForm` in VisitCheckout.tsx ("Close Visit / Patient Out" at ~L405) | Reason non-empty after trim already enforced (`canSubmit = blocker === null && (!owes \|\| reason.trim().length > 0)`). Server cap is `max_length=500` (`VisitCloseRequest`). |
| W4-D | Receipts own tab | New route `/reception/receipts` in `router.tsx` under `RequireRole role={['ADMIN','RECEPTION']}`; new nav item in `RECEPTION_NAVIGATION` between Billing and Reports; move the `activeTab === 'ledger' && canCheckout` block (ReceptionBillingPage.tsx ~L759-790) and `ReceiptTable` (L42) out | Backend `GET /api/billing/receipts/today` (billing.py L374-396) already exists and shows reversed rows. UI-SPEC S5 wants a totals line (count, sum) and newest first (already ordered by `created_at desc, id desc`). The admin full ledger currently lives on the same tab (`hasFullLedger`) and in `/admin/billing` (`BillingAdminPage`); decide whether the admin "Receipts" is only the existing admin page (planner discretion). |
| W4-E | Reception Reports tab (Q10 decided) | New `pages/ReceptionReportsPage.tsx`, route `/reception/reports` under `RequireRole role="RECEPTION"`, nav item | Content: today's collection summary from `GET /billing/receipts/today`, reversed shown separately. The existing "Collected today" tile (ReceptionBillingPage.tsx ~L280-283, `todayCollectedPaise`) already sums non-reversed receipts; add a by-method breakdown only if the owner wants it (the design does not specify). |
| W4-F | Doctor charges panel (T22-10) | `frontend/src/pages/ClinicalEncounterWorkspace.tsx`: appointment id is `paramApptId` (L100) or `existingEncounter?.appointment_id` (L130); the `<aside>` is at ~L1283; new hooks in `queries.ts` | Production routes are `/doctor/encounters/new` and `/doctor/encounters/:id` (`router.tsx`). Panel shows the consultation fee read-only, "Add charge", "Adjust fee" (Modal with reason), no payment control. Must call `POST /appointments/{id}/fee-adjustment` (built). Doctor must not see visit total or other doctors' lines (Q13, server-enforced via the own-consultation read endpoint). |
| W4-G | Waiting Room "Open bill" link | `pages/WaitingRoom.tsx` PlainCard `billLink` | Current URL param handling is in ReceptionBillingPage.tsx L141-147 (`appointment_id` -> `useAppointment` -> `visit_id`). Keep that contract or update both sides together. |
| W4-H | Receipt content | `components/ReceiptPrint.tsx` | The design does not say receipts list bill lines. Do not add line items without the owner (OD-H). One A4 page (UX-01). |

Frontend rules that apply to every new surface: no text below 12px, no `text-slate-300/400`, no `text-red-500`/`text-emerald-600`/`text-amber-600`/`text-teal-600` (guard test `frontend/src/test/guards/guards.test.ts`, UI-SPEC Typography); only sizes 12/14/16/36, weights 400/700, 4px spacing multiples (Q14, from Wave 2 on); icons only through `components/icons/index.ts`; 44px (`min-h-11`) primary targets.

## Wave 5 (T22-11 referral report)

| Item | Files | Notes |
|------|-------|-------|
| Aggregate endpoint | New `routers/reports.py` (or inside `visits.py`), `schemas/reports.py`, `main.py` | Source columns: `visits.referral_source` and `visits.referrer_name` (models.py:729-730), date `visits.visit_date`. Filters: from, to, source, referrer name. Group by source and referrer name. |
| Admin-only permission | `core/permissions.py` | `VISIT_READ` is held by ADMIN **and** RECEPTION (permissions.py: admin line 139, reception line 159), so it cannot be the gate. A new admin-only permission is needed (name is a planner choice, e.g. `report:referral`); add to ADMIN only; update golden snapshot test and matrix. |
| Admin page | New `pages/admin/ReferralReportPage.tsx`; `frontend/src/admin/modules.ts` (group `patient-data`, label "Patient & Data Management", L9); `router.tsx` under the ADMIN `RequireRole` block | `frontend/src/pages/__tests__/admin-navigation-architecture.test.tsx` was edited in commit 4adc4784 for nav changes; expect it to need an update for a new module. |
| Data quality | — | Visits opened before phase 22 have NULL `referral_source` (migration 0026 rule, design §4). Show them as "Not recorded", do not infer. `referrer_name` is free text up to 120 chars; "Dr Sharma" and "Dr. Sharma" would group separately (OD-I). |
| Which visits count | — | CANCELLED visits (nobody seen) are not defined by the design (OD-I). |

## Runtime State Inventory

Phase 22 adds fields and tables; it does not rename anything. Not a rename/refactor phase, but the deploy has runtime state worth stating:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `kalyan_dev` (user's :8000 dev DB) needs 0029 when built; 0026-0028 applied per the brief (NOT verified by me). Existing appointments back-filled with SYSTEM consultation lines at 0027. | Apply migrations only with the owner; never reset the DB (AGENTS.md). |
| Live service config | None found. | None |
| OS-registered state | `deploy\start-server.bat` starts uvicorn from `backend/.venv` (memory note); must restart after migrations. | Owner restarts the server |
| Secrets/env vars | None new. | None |
| Build artifacts | `frontend/dist` is what :8000 serves (memory: UI served from dist). | Rebuild with `npm run build` after UI changes; verify on :8000, not only Vite :5173 |

## Common Pitfalls

### P1: The markdown UAT report is not reliable evidence
**What goes wrong:** `docs/engineering/KALYAN_OPD_UAT_CONSOLIDATED_REPORT.md` says 160 passed / 1 failed / 21 not implemented and lists PRI-08 and FEE-09 as PASS and BILL-05 as "Select Net Banking ... PASS". `docs/engineering/UAT_EXECUTION_RESULTS.json` (and the script that generates it) disagree: PRI-08 NOT IMPLEMENTED, FEE-09 NOT IMPLEMENTED, BILL-05 "Add additional service" NOT IMPLEMENTED; its non-PASS set is 22 rows (QUE-10, PRI-08, FEE-03..07, FEE-09, MED-02, MED-04..08, MED-11, MED-12, BILL-03..05, AUD-04, AUD-08, SCENARIO-02). Code supports only CASH, UPI, CARD (see Verified Values), so "Net Banking PASS" cannot be true.
**How to avoid:** use the JSON/script as the baseline; treat the markdown as a narrative. Re-run `scripts/qa_opd_full_suite.py` only against `kalyan_test` (it sets `KALYAN_DB_NAME=kalyan_test`) after updating its hard-coded NOT IMPLEMENTED rows, and report real counts.

### P2: Adding line types before the balance switch silently drops money
**What goes wrong:** `visit_charge_lines` and the `record_payment` guard only know the CONSULTATION line. A medicine line would not appear in `outstanding_paise`, would not block Patient Out, and a payment against it would be rejected (`overpayment_rejected`, guard caps at the consultation fee) or, worse, pass for the wrong reason.
**How to avoid:** ship W3-D (with the before/after regression test) before W3-C endpoints are reachable from any UI. Gate with a test that a visit with one consultation and one medicine line reports the sum.

### P3: Fee-adjustment and void guards use appointment-level payments
**What goes wrong:** `_paid_on_consultation` sums `Payment.appointment_id == appointment_id` (bill_service.py:31-40). Once visit-level payments exist (`appointment_id` NULL, `visit_id` set), a discount can drop the total below what was actually paid, creating a negative-balance state that `max(0, ...)` then hides (invariant 10: no silent overwrite).
**How to avoid:** W3-E re-bases the guard on visit totals; add a test that pays at visit level, then tries to waive.

### P4: Cancelled or reassigned consultations keep an active CONSULTATION line
**What goes wrong:** `reassign_waiting` (booking_service.py:591-597) and the generic cancel path set `consultation_status = CANCELLED` and leave the line. Today's COMPLETED-only rule hides it; a Σ ACTIVE bill_items rule would bill the patient for both doctors.
**How to avoid:** exclude lines whose appointment is CANCELLED in the total (or VOID them). Add a regression: reassign, complete the new consultation, expect a single consultation fee in the bill.

### P5: Closed-visit dues must stay collectable and must not double count
**What goes wrong:** `compute_visit_dues` lists only CLOSED visits per consultation line; `DueCollectForm` pays against an appointment. A visit-level rewrite that stops at the open visit loses the "close with a balance" ledger (owner decision 8, design OD-22-18).
**How to avoid:** keep the CLOSED visit due list, make it visit-level, keep paying against a closed visit allowed, keep the visit locked for line edits.

### P6: No database guard against overpayment
**What goes wrong:** `routers/billing.py` header says "Overpayments exceeding package fees rejected via row-lock and DB trigger (BIL-02)". I searched the migrations: the only triggers are `audit_logs_block_mutation`, finalised-encounter tampering, finalised-session tampering and treatment-plan session sync (`grep TRIGGER` over migrations/versions). There is no payment trigger. The guard is the row lock plus the application check.
**How to avoid:** the visit-level guard must lock the `visits` row and be covered by a concurrency test modelled on `tests/test_receipt_concurrency.py` (two simultaneous payments totalling more than the balance; exactly one succeeds). Do not state in new docs that a DB trigger exists.

### P7: Test and server isolation
**What goes wrong:** per memory note, an unpinned shared venv imported another worktree, and older branches wiped live `backend/var`.
**How to avoid:** run `PYTHONPATH=D:/dr-sr/backend/src` from `backend/`; `tests/conftest.py` forces `kalyan_test`. Never run on the hospital server.

### P8: Concurrent editors
Memory note: another tool rewrites repo files mid-session. Check file mtimes and `git diff` before editing shared files, report diffs, do not revert.

### P9: Shared files need one owner at a time
Files edited by several packages: `models.py`, `core/permissions.py`, `tests/support/matrix.py`, `tests/openapi.snapshot.json`, `services/audit_service.py`, `services/backup_service.py`, `frontend/src/api/queries.ts`, `frontend/src/api/types.ts`, `frontend/src/components/AppShell.tsx`, `frontend/src/router.tsx`. Serialise the packages that touch them (AGENTS.md coordination rules).

### P10: Reason-length caps are inconsistent
CONTEXT Q17 says 500. `schemas/follow_up.py` has `max_length=1000` (lines 19, 29, 41 for notes) and the appointment `notes` fields are 1000. Visit close, reassign, cancellation, fee adjustment are 500. Decide in planning whether "reason fields" covers `follow_up` closure; do not change follow-up silently.

## Code Examples

### Route skeleton (copy of the built pattern)
```python
# Source: backend/src/kalyan_api/routers/fee_adjustments.py:98-114 (verified)
@router.post(
    "/{id}/fee-correction",
    response_model=FeeAdjustmentOut,
    status_code=201,
    dependencies=[Depends(require(Permission.BILL_ADJUST))],
)
def adjust_any_consultation_fee(id: int, payload: FeeAdjustmentRequest, request: Request,
                                session: SessionDep,
                                principal: Principal = Depends(current_principal)) -> FeeAdjustmentOut:
    return _apply(session, request, principal, id, payload, may_correct=True, own_only=False)
```

### Append-only history then mutate (copy for void and correction)
```python
# Source: backend/src/kalyan_api/services/bill_service.py:145-161 (verified)
history = BillItemAdjustment(bill_item_id=line.id, old_quantity=line.quantity,
    new_quantity=line.quantity, old_rate_paise=line.rate_paise, new_rate_paise=new_amount_paise,
    old_amount_paise=old_amount, new_amount_paise=new_amount_paise, kind=kind.value,
    reason=reason_text, actor_user_id=principal.user_id)
session.add(history)
line.rate_paise = new_amount_paise
line.amount_paise = new_amount_paise
session.flush()
```

### Amount computation (recommendation; rounding is OD-E)
```python
# [ASSUMED] shape; ROUND_HALF_UP to whole paise is a recommendation, not an owner decision
from decimal import ROUND_HALF_UP, Decimal

def line_amount_paise(quantity: Decimal, rate_paise: int) -> int:
    return int((quantity * Decimal(rate_paise)).to_integral_value(rounding=ROUND_HALF_UP))
```
(Planner: write this as a small pure function with unit tests for 1.5 x 33 paise and 0.01 x rate; the exact code is not prescribed.)

### Totals block order (UI-SPEC S4, verified)
1. Bill total (this visit) 2. Paid earlier (this visit) 3. Paying now 4. Remaining on this visit 5. Previous dues (separate line) 6. Total outstanding (= 4 + 5).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Fee read live from `doctors.default_fee_paise` | Fee snapshot on `bill_items` CONSULTATION line | Migration 0027, committed `f4e480fc` | FEE-07 fixed; `visit_charge_lines` uses the line, falls back to live fee only for rows without a line |
| Cancel + new walk-in to move a patient | `POST /appointments/{id}/reassign` | Wave 2 backend | QUE-10, AUD-08 built; UAT JSON stale |
| Balance per consultation | Visit-level Σ lines | Wave 3 (not done) | The main remaining engineering risk |

**Deprecated/outdated:** `UAT_EXECUTION_RESULTS.json` statuses for the IDs in W2-G; the ROADMAP Phase 22 status line; DESIGN §8b "Still Open for Wave 2".

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `kalyan_dev` already has 0027 and 0028 applied; `frontend/dist` rebuilt and server restarted state unknown | Wave 2 W2-H, Runtime State | A plan could assume a deployed state that is not true; verify with the owner before planning deploy steps |
| A2 | Endpoint paths and the `bill:write`, admin-only report permission names | Wave 3, Wave 5 | Naming only; no business impact. Planner may rename |
| A3 | ROUND_HALF_UP to whole paise for qty x rate | Code Examples | Wrong rounding changes money by 1 paise on fractional quantities; needs owner (OD-E) |
| A4 | Excluding CANCELLED consultations' lines by join is preferable to voiding them | W3-D point 1 | If the owner wants every removal to leave a history row, void instead |
| A5 | Reception may correct or void its own reception lines on an open visit with a reason, doctor own doctor lines | W3-C PATCH/void | Design §6 says nothing about who may edit non-consultation lines; this is a permission rule (OD-G) |
| A6 | Packages section in the bill is display-only from `treatment_plans` (no PACKAGE bill_items added to the total) | W3-D point 3 | If the owner intends a doctor "package charge" to be a payable bill line, the double-counting rule in design §4 conflicts (OD-C) |
| A7 | All pytest results I report are from the files I ran this session; output was captured with `tail`, so I saw a clean run of dots and no failure marker but not the final totals line | Validation | Planner should re-run for counts before claiming numbers |
| A8 | The visit-level "collectable" condition (at least one COMPLETED and none active, as in `ready_for_checkout`) | W3-D point 2 | Wrong rule could block or allow early payment (OD-D) |

## Owner Decisions Needed (do not decide in planning)

| ID | Decision | Why it cannot be decided from code | Blocks |
|----|----------|-------------------------------------|--------|
| OD-A | How is "Reception may adjust only with an explicit permission" (OD-22-11, FEE-06) granted? | `ROLE_PERMISSIONS` is a static per-role frozenset (`core/permissions.py`, `core/principal.py:147`); no per-user grant table or admin UI exists; SEC-03 says "fixed permission catalogue". Options: add `bill:adjust` to the reception role globally; build a per-user grant (new table, admin UI, new audit); or leave reception without it. Today `/fee-correction` is admin-only and reception gets 403 (matrix row, test `test_reception_is_refused_without_the_bill_adjust_grant`). | FEE-06, reception adjust UI |
| OD-B | May reception see prescribed medicine names to bill from? | OD-22-13 says reception bills "name (from the prescription or typed)"; D-04 (`.planning/PROJECT.md:99`) denies reception clinical views; reception has no `PRESCRIPTION_READ`. The UAT script itself records "Reception clinical default-deny D-04; pharmacy reference endpoint scheduled for Phase 22 Wave 4". Minimal option: a dedicated read-only endpoint returning only medicine names, nothing else. Typed-only is the zero-exposure option. | MED-02, `prescription_item_id` column |
| OD-C | What is a PACKAGE bill line? | Design §4 lists category PACKAGE with `treatment_plan_id`, §6 lets a doctor add "package" charges, but package money lives on `treatment_plans` (`agreed_price_paise`, paid via `payments.treatment_plan_id`) and §4 says never double-count. | Doctor "Add charge" categories, Packages section |
| OD-D | When may a visit's non-consultation lines be paid, and when is it "ready for checkout"? | Current rule: only COMPLETED consultations owe; payment refused while another is WAITING/IN_CONSULTATION (`billing.py:171-184`). Medicines/particulars are entered by reception, possibly while a second doctor still consults. | W3-D, W4 payment form |
| OD-E | Rounding of quantity x rate and allowed quantity precision | `quantity` is `numeric(10,2)` (decimals allowed); design says integer paise and says nothing on rounding. | MED-05, MED-11 |
| OD-F | Close the Q19 "mount LANStatusPill" item as already satisfied by AppShell `useServerLink`? | Auto-answered opposite in CONTEXT; code already shows connection state on every screen. | W2-E |
| OD-G | Who may correct or void non-consultation lines, and after payment? | Design §6 covers consultation fee adjust only; OD-22-15 covers corrections generally. | W3-C |
| OD-H | Do receipts list line items? | Not specified; the current receipt is per payment. | W4-H |
| OD-I | Referral report grouping and counted visits | Free-text referrer names; CANCELLED visits; NULL legacy sources | W5 |

## Open Questions (RESOLVED)

1. **OQ-1 Scope conflict in CONTEXT.** CONTEXT "Deferred Ideas" lists "Medicine and particular bill lines, bill voids, and payment-to-visit linking (Wave 3 remainder)" as deferred, yet the caller says Wave 3 remainder is in scope and the design waves (T22-07, T22-08) include them. I treated the caller's instruction and the design as governing. Confirm with the owner so the planner does not exclude them.
   **RESOLVED (owner, 2026-11-15; CONTEXT OQ-1):** medicine lines, bill voids and payment-to-visit linking are in Phase 22 scope; the stale deferred entry was removed from CONTEXT on 2026-11-16. Planned in 22-04, 22-06, 22-08 and 22-10.
2. **OQ-2 Doctor visibility during consultation.** Does a doctor add charges while the consultation is IN_CONSULTATION only, or also after COMPLETED while the visit is OPEN? The built fee adjustment allows any status except CANCELLED. The design locks lines only when the visit is CLOSED.
   **RESOLVED (owner, 2026-11-16; CONTEXT B3):** a doctor may add own charges (procedure, service) to a completed consultation while the visit is OPEN; charges lock when the visit closes (Patient Out); a cancelled consultation takes no charges. Planned in 22-12 (tests: 201 on a COMPLETED consultation of an OPEN visit, 422 `visit_closed` after Patient Out) and 22-16.
3. **OQ-3 `version_id` on bill lines.** The design lists it; 0027 omitted it. Needed only if the UI must show "modified by another user" for line edits.
   **RESOLVED (planning, technical choice; no business rule involved):** no `version_id` column is added (22-04). Every line writer locks the visit row and then the line row with `with_for_update()`, as `adjust_consultation_fee` does (Pattern 3); a stale action is refused by the server (for example 409 `line_already_voided`) and the UI shows ConflictBanner (22-10, 22-11, 22-14).
4. **OQ-4 Admin "Receipts" navigation.** Admin navigation is module-based (`frontend/src/admin/modules.ts`); whether the Receipts tab also appears there is not specified.
   **RESOLVED (planning, navigation only):** no separate admin Receipts tab; the admin's full ledger stays at `/admin/billing` and the Receipts tab is reception navigation (22-15). The owner can ask for an admin entry later.
5. **OQ-5 Completion time on the checkout list.** UI-SPEC S4 wants a completion time; `VisitSummary` has none and there is no `completed_at` column on appointments (the proxy is `status_updated_at`, which also changes on other transitions). Needs a field choice.
   **RESOLVED (planning, technical field choice):** `VisitSummary.last_completed_at` = the latest `status_updated_at` among the visit's COMPLETED consultations, after 22-09 confirms that no writer changes `status_updated_at` once a consultation is COMPLETED; no new column (22-09).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| PostgreSQL | backend tests, dev DB | ✓ (`pg_isready`: ":5432 - accepting connections") | not queried | — |
| Python | backend | ✓ | 3.12.10 (system); `backend/.venv` present | — |
| Node | frontend tests/build | ✓ | v26.13.0 | — |
| vitest | frontend tests | ✓ (ran) | 5.0.5 | — |
| `gsd-tools` research seam | research caching | not used | — | Research was in-repo only; no external provider calls were needed |

**Missing dependencies with no fallback:** none found. **Not checked:** state of `kalyan_dev`, `frontend/dist`, running :8000 server.

## Validation Architecture

(`workflow.nyquist_validation` is `true` in `.planning/config.json`.)

### Test Framework
| Property | Value |
|----------|-------|
| Backend framework | pytest 9.2.0 (`backend/pyproject.toml` `[tool.pytest.ini_options]`, `timeout = 60`, `--import-mode=importlib`) |
| Frontend framework | vitest (`frontend/package.json` `"test": "vitest run"`) |
| Backend quick run | `cd D:/dr-sr/backend && PYTHONPATH=D:/dr-sr/backend/src .venv/Scripts/python.exe -m pytest tests/test_phase22_*.py -q` |
| Backend full run | same with `tests` (no path); note STATE.md reports 1,392 backend tests, 427 frontend tests green on 2026-11-15 (I did not re-run the full suites) |
| Frontend quick run | `cd D:/dr-sr/frontend && npx vitest run src/pages/__tests__/waiting-room.test.tsx src/components/__tests__/emergency-alert-banner.test.tsx src/components/__tests__/app-shell.test.tsx` |
| Frontend gates | `npm run typecheck`, `npm run lint` (oxlint), `npm run build` |

Evidence from this session: the backend files `test_phase22_checkin.py`, `test_phase22_wave2.py`, `test_phase22_bill_snapshot.py`, `test_phase22_fee_adjustment.py`, `test_rbac_matrix.py`, `test_permissions_catalogue.py`, `test_openapi_snapshot.py` ran with a clean row of passes and no failure marker (A7); the three frontend files reported "Test Files 3 passed (3), Tests 34 passed (34)".

### Phase Requirements to Test Map (proposed new tests)
| Req | Behaviour | Test type | Command / file | Exists? |
|-----|-----------|-----------|----------------|---------|
| FEE-03/04/07/AUD-04 | Doctor discount, waive, snapshot, history row, audit | API+DB | `tests/test_phase22_fee_adjustment.py`, `test_phase22_bill_snapshot.py` | ✅ built |
| FEE-05 | Reception refused | API/matrix | matrix rows + `test_reception_is_refused_without_the_bill_adjust_grant` | ✅ |
| FEE-06 | Reception with permission | API | after OD-A | ❌ blocked |
| FEE-09 | Read adjustment history | API | `tests/test_phase22_bill_lines.py::test_bill_view_shows_adjustment_history` | ❌ Wave 3 |
| MED-04/05/07/08 | Add medicine/particular, qty x rate, typed line | API+DB | `test_phase22_bill_lines.py` | ❌ |
| MED-06 | Only supplied items billed | API | same | ❌ |
| MED-11 | Change quantity recalculates, history row | API | same | ❌ |
| MED-12 | Negative or zero qty/rate rejected (422 and DB CHECK `quantity > 0`, `rate_paise >= 0`) | API + `db_guards` style | same | ❌ |
| MED-02 | Reception reference list | API/authz | after OD-B | ❌ blocked |
| BILL-03..05 | Bill view totals incl. services/medicines | API | `test_phase22_bill_view.py` | ❌ |
| Balance switch | Every existing visit's due identical before and after (design §9) | regression | `test_phase22_balance_switch.py` using fixtures from existing billing tests | ❌ |
| Visit payment guard | overpayment 422; two concurrent payments, one wins | concurrency (`@pytest.mark.concurrency`) | model on `tests/test_receipt_concurrency.py` | ❌ |
| P3/P4 | Visit-level paid blocks waive; reassigned consultation billed once | API | `test_phase22_balance_switch.py` | ❌ |
| QUE-10/AUD-08/PRI-08 | Reassign, audit, acknowledge | API | `tests/test_phase22_wave2.py` | ✅ |
| Doctor badge (W2-A) | PriorityBadge in doctor cards | component | extend `pages/__tests__/doctor-dashboard*.test.tsx` (find the existing file) | ❌ |
| Referral report | Aggregate counts, admin-only 403 for reception/doctor | API/matrix | `tests/test_phase22_referral_report.py` | ❌ |
| Migration 0029 | Single head, grants table matches | schema | `tests/test_migrations.py` | ✅ exists, will exercise |
| Permissions | Golden snapshot | catalogue | `tests/test_permissions_catalogue.py` | ✅ update |
| API drift | OpenAPI snapshot | snapshot | `tests/test_openapi_snapshot.py` (regenerate with the CLI) | ✅ update |

### Definition-of-done mapping (AGENTS.md)
For each item: (1) frontend interaction by vitest plus manual check on :8000 after `npm run build`; (2) API behaviour by pytest; (3) DB persistence by a SELECT on `kalyan_test` rows in the test and a direct row check; (4) related modules updating (queue, bill, dues, Patient Out); (5) authorisation by `matrix.py` rows; (6) reload persistence (refetch after reload, manual on :8000); (7) regression: full backend and frontend suites. Mark anything lacking one of these "IMPLEMENTED - NOT VERIFIED".

### Sampling Rate
- Per task commit: the quick commands above plus the touched test file.
- Per wave merge: full backend `pytest` and `npx vitest run`, `npm run typecheck`, `npm run lint`.
- Phase gate: full suites green, UAT script re-run on `kalyan_test` with updated rows, manual :8000 check.

### Wave 0 Gaps
- [ ] `tests/test_phase22_bill_lines.py`, `test_phase22_bill_view.py`, `test_phase22_balance_switch.py`, `test_phase22_referral_report.py`
- [ ] Doctor dashboard badge test
- [ ] Update `scripts/qa_opd_full_suite.py` rows so the UAT re-run reports real status
- [ ] Capture a pre-change snapshot of every visit's due from the seeded fixtures (needed for the before/after comparison)

## Security Domain

`security_enforcement` is not set to false in `.planning/config.json`, so this section is included.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no change | existing session/login |
| V3 Session Management | no change | existing |
| V4 Access Control | **yes** | `require(Permission.X)` per route; own-consultation scoping returning 404; matrix rows; new `bill:write` and admin-only report permission |
| V5 Input Validation | **yes** | pydantic `Field(ge=, max_length=)`; reason length 3-500; DB CHECKs (`quantity > 0`, `rate_paise >= 0`) |
| V6 Cryptography | no | none |
| V7 Error handling / logging | **yes** | `ApiError` codes, audit rows for every money-affecting action (append-only `audit_logs`) |
| V8 Data protection | **yes** | D-04: reception must not read clinical data; OD-B decision |
| V11 Business logic | **yes** | race on payment vs line edit, overpayment, no idempotency key (deferred), lock order |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Doctor edits another doctor's charges (IDOR) | Elevation | own-scope check returns 404, as `fee_adjustments._apply` |
| Reception raises a fee / voids after payment | Tampering | permission gate plus guard "total not below paid"; history row mandatory |
| Double submit of payment | Repudiation / Tampering | button disabled while pending; server row lock; never auto-retry; idempotency key deferred (CONTEXT) |
| Concurrent payment and line add | Tampering | visit row lock, fixed lock order |
| Prescription data leaking to reception | Info disclosure | OD-B; if a reference endpoint is built, return medicine name only and audit reads |
| Deleting financial history | Tampering | `bill_item_adjustments` SELECT/INSERT only; bill_items never deleted; downgrade refuses with rows. Pre-existing gap: `payments` is granted DELETE to `kalyan_app` (backup_service.py:317); outside this phase, flag to the owner |

## Ordering and Dependency Constraints

1. Take a Git checkpoint before each repair batch (AGENTS.md; design says `git stash store` because the owner commits only on request). The current uncommitted Wave 3 slice 2 files must be preserved.
2. Order for Wave 3: W3-B permissions, then W3-A migration 0029 and model/enum changes, then W3-D balance switch with the regression test, then W3-E guard re-base, then W3-C endpoints, then OpenAPI/matrix/docs. W3-C must not be reachable from UI before W3-D.
3. Migrations run 0028, 0029 in sequence, never in parallel sessions (design §9). `kalyan_dev` only with owner approval.
4. Wave 4 UI depends on W3-C read endpoints (bill view, previous dues, doctor own lines). W4-F (doctor panel) needs W3-C doctor endpoints but not the Billing page.
5. Wave 5 depends only on migration 0026 data and a new permission; it can run alongside Wave 4 if file ownership is split (shared files listed in P9).
6. W2-A..D are independent of Waves 3-5 and can go first.
7. After any frontend change, rebuild `frontend/dist` and verify on :8000.

## Sources

### Primary (HIGH confidence): in-repo files read this session
- `.planning/phases/22-integrated-opd-workflow/22-CONTEXT.md`, `22-DESIGN.md`, `22-UI-SPEC.md`
- `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md` (Phase 22 block), `.planning/STATE.md` diff, `.planning/config.json`, `.planning/PROJECT.md` (D-04 line)
- `AGENTS.md` (via system context), user memory notes (test isolation, Phase 22 direction)
- Backend: `core/permissions.py`, `core/policy.py`, `models.py` (Visit, Appointment, BillItem, BillItemAdjustment, Payment, Prescription), `migrations/versions/0027_bill_items.py`, `0028_bill_item_adjustments.py`, `services/bill_service.py`, `billing_service.py`, `booking_service.py`, `visit_service.py`, `appointment_service.py` (transitions), `backup_service.py` (grants), `routers/fee_adjustments.py`, `billing.py`, `visits.py`, `appointments.py`, `schemas/fee_adjustment.py`, `visits.py`, `tests/support/matrix.py` diff, `tests/test_permissions_catalogue.py` diff
- Frontend: `router.tsx`, `components/AppShell.tsx`, `EmergencyAlertBanner.tsx`, `LANStatusPill.tsx`, `checkin/TodayAppointmentsPanel.tsx`, `billing/VisitCheckout.tsx`, `pages/WaitingRoom.tsx`, `ReceptionBillingPage.tsx`, `DoctorDashboard.tsx` (grep and ranges), `api/alerts.ts`, `api/serverStatus.ts`, `api/queries.ts` (hook list)
- `docs/engineering/KALYAN_OPD_UAT_CONSOLIDATED_REPORT.md`, `UAT_EXECUTION_RESULTS.json`, `scripts/qa_opd_full_suite.py` (grep)
- Git: `git log --stat` for `f4e480fc`, `4adc4784`; `git status`; `git diff` of Wave 3 files
- Commands run: `pg_isready`, `pytest` (7 files), `vitest run` (3 files), `grep TRIGGER|REVOKE` over migrations

### Secondary / Tertiary
None. No web or Context7 lookups were made: the phase uses no new library, and every question was answerable from the repository.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH. No change; pins read from `pyproject.toml` and `package.json`.
- Architecture and per-item file map: HIGH. Read from code.
- Wave 3 design shapes (endpoints, 0029 columns): MEDIUM. Recommendations built on verified code; several depend on OD-A..OD-I.
- Pitfalls: HIGH for P1-P6 (each demonstrated by reading the code or running a search), MEDIUM for P9-P10.

**Research date:** 2026-11-15
**Valid until:** about 14 days, or until the next commit touching `services/billing_service.py`, `routers/billing.py`, `models.py` or `core/permissions.py` (this repo is changing daily and another tool edits files mid-session).
