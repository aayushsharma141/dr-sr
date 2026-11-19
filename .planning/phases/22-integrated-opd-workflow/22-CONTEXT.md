# Phase 22: Integrated OPD Workflow - Context

**Gathered:** 2026-11-15
**Status:** Ready for planning
**Mode:** Smart discuss, auto-answered (owner chose "auto-answer and commit"). Items marked PROPOSED take the recommended default and are NOT owner-confirmed.

<domain>
## Phase Boundary

Reception, waiting room, doctor and billing run as one OPD workflow on the existing patient, visit, consultation and payment chain: check-in with Referred By and classification, emergency acknowledgement, same-visit reassignment, fee-snapshot bill lines, fee adjustments, checkout and receipts. Source of truth: `22-DESIGN.md` (OD-22-01..21) and `22-UI-SPEC.md`.

Out of scope for this phase: cross-department referral/transfer workflow, payment idempotency keys, Phase 23 (Advanced Data Operations).

</domain>

<decisions>
## Implementation Decisions

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

### Claude's Discretion
- Exact layout details within the approved UI-SPEC copy and spacing rules.
- Order of implementation within the waves in `22-DESIGN.md` §8.

### Owner decisions on research items (answered 2026-11-15, owner choices)
- OD-A: fee adjustment permission stays admin-only; reception has no fee adjustment; doctors waive own fees.
- OD-B: reception sees prescribed medicine names, quantity and form only, no clinical detail.
- OD-C: a package bill line is information only: package sessions and money stay on the treatment plan; the visit bill shows a reference line with no amount.
- OD-D: checkout opens once the consultation is completed; any bill lines on the visit can be paid at checkout.
- OD-E: quantity x rate rounded to whole paise, round half up.
- OD-G: a reception user may void a non-consultation line they entered, on the same day, with a reason.
- OD-H: receipts show totals only, not line items.
- OD-I: referral report groups by source and referrer, with a date filter; cancelled visits are excluded.
- OQ-1: medicine lines, bill voids and payment-to-visit linking are in Phase 22 scope (supersedes the deferred entry below).
- DELETE grant on payments: keep for now; record as a known risk (not removed in this phase).

### Owner decisions on plan-check items (answered 2026-11-16, owner choices)
- B2 / OD-B quantity: prescriptions store no quantity. Reception sees the prescribed medicine name and form from the prescription and enters the quantity actually supplied when billing. No prescription schema change.
- B3 / OQ-2: a doctor may add own charges (procedure, service) to a completed consultation while the visit is OPEN; charges lock when the visit closes (Patient Out). A cancelled consultation takes no charges.
- Q13 (confirmed, no longer PROPOSED): a doctor sees own consultation fee and own charges only; no visit total, no other doctors' or reception lines, no payment controls.
- Q17 exception (confirmed): the follow-up closure reason keeps its 1000-character limit as an owner-approved exception; all other reason fields cap at 500.
- Item v (answered 2026-11-16): the administrator may void or change non-consultation bill lines, with a reason. Reception keeps OD-G (own same-day lines only).
- W4 (answered 2026-11-16): fail closed. A completed consultation with no bill line is refused (error), never billed at the doctor's current fee. Existing tests that create consultations directly must add a line.
- OD-F (answered 2026-11-16): replace the existing server-link indicator with LANStatusPill, mounted in the app shell.
- Balance edge rules (answered 2026-11-16, option-a): (i) a doctor-added charge becomes payable when its consultation is completed; (ii) lines of cancelled or reassigned-away consultations are excluded by a join on consultation status, with no rows rewritten; (iii) a visit payment is accepted once at least one consultation of the visit is completed (OD-D).
- Line edit rules (answered 2026-11-16, option-a): (i) a quantity or rate is corrected in place with a CORRECTION history row, on an open visit, never below what is paid; (iii) no edits after Patient Out, including by the admin; (iv) doctors cannot void or correct lines; (v) the admin may void and change any non-consultation line on an open visit, with a reason; reception keeps OD-G.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `frontend/src/components/Modal.tsx`, `InlineAlert.tsx`, `ConflictBanner.tsx`, `LANStatusPill.tsx` (defined, not mounted), `checkin/PriorityBadge.tsx`, `checkin/TodayAppointmentsPanel.tsx`, `billing/VisitCheckout.tsx`
- `frontend/src/format.ts` (`formatToken`, `formatIst`, `istToday`, `formatPaise`)
- `frontend/src/api/queries.ts` mutations: `useUpdatePriority`, `useAcknowledgeAlert`, `useReassignAppointment`, `useUpdateAppointmentStatus`, `useDoctorDepartments`

### Established Patterns
- Server state via TanStack Query; 10-second polling for queues; 5-second polling for the emergency alert.
- Backend: FastAPI routers with `require(Permission)` or `authenticated_only` route policies; RBAC matrix in `backend/tests/support/matrix.py`; OpenAPI snapshot regenerated with `kalyan_api.cli export-openapi`.
- Append-only history tables with SELECT/INSERT grants for the app role (migrations 0026, 0027, 0028).

### Integration Points
- Reception sidebar: `components/AppShell.tsx` `RECEPTION_NAVIGATION`; routes in `router.tsx`.
- Doctor shell: `AppShell` renders the emergency banner for role DOCTOR.
- Billing: `services/billing_service.py` (`visit_charge_lines`, `consultation_fee_paise`), `routers/billing.py` (overpayment guard), `services/bill_service.py` (fee adjustment).

</code_context>

<specifics>
## Specific Ideas

- Owner wording for the legacy hold: "On hold (this screen only)".
- Reassign copy: "Reassign & issue new token" / "Keep with current doctor"; reason required.
- Emergency banner text: "EMERGENCY · Token {token} · {patient}" with the reason on the next line and an Acknowledge button.

</specifics>

<deferred>
## Deferred Ideas

- Cross-department referral/transfer workflow with its own record (needs its own design).
- Payment idempotency keys / transaction-status lookup (payment wave).
- Hindi font bundling (UX-05).
- Reception Reports page contents beyond today's collection summary (Wave 5).
- Phase 23: Advanced Data Operations.

</deferred>
