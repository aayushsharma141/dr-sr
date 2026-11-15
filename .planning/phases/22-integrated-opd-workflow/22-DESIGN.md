# Phase 22 — Integrated OPD Workflow (Check-in → Queue → Consultation → Billing → Patient Out)

Status: DESIGN AGREED 2026-11-15, Wave 1 in progress. Owner decisions below are frozen.
Source: the owner's specification of 2026-11-15 (pasted in the session) and four answers on
priority, consultation fees, medicine billing and referral.

## 1. Goal

Reception, the waiting room, the doctor and billing run as ONE OPD workflow on the existing
patient → visit → consultation → payment chain. Nothing here replaces that chain; it adds the
missing fields and screens.

```
Booking (phone / walk-in) → arrival → new or existing patient → URN (new or reused)
→ visit opened (or joined) → doctor assigned → doctor-wise token → Waiting
→ doctor calls → In Cabin → doctor completes (+ charges) → Billing & Checkout
→ review bill + previous dues → full / partial payment → receipt → Patient Out → history
```

## 2. Owner decisions (frozen 2026-11-15)

| ID | Decision |
|----|----------|
| OD-22-01 | Check-in & Token is the first reception tab. Order: Check-in & Token, Dashboard, Patient Records, Appointments, Waiting Room, Billing & Checkout, Receipts, Reports. |
| OD-22-02 | Check-in page: two columns. Left = check-in form with New / Existing patient. Right = today's appointments with Check in, No-show, Cancel, Reschedule. |
| OD-22-03 | Check-in fields: Name*, Age*, Phone*, Sex* (Male / Female / Other), Guardian, Referred By*, Consulting Doctor*, Address. A new patient is registered (permanent URN) and checked in in one step. |
| OD-22-04 | Existing patients are found by URN, name or mobile; they never receive a new URN. Each arrival creates a new visit linked to the same patient. |
| OD-22-05 | Visit type per consultation: NEW (New Consultation) or FOLLOW_UP (Follow-up / Revisit). Recorded for clinical and reporting use only; it never sets the fee. |
| OD-22-06 | Classification: NORMAL / PRIORITY (amber) / EMERGENCY (red). Reception sets it; PRIORITY and EMERGENCY need a reason. Every change is kept in an append-only history. |
| OD-22-07 | Suggested queue order: EMERGENCY (by classification time), then PRIORITY (by token), then NORMAL (by token). Token numbers never change. Queue position is computed, never stored. |
| OD-22-08 | The doctor may call ANY waiting patient. Reordering never interrupts an active consultation. |
| OD-22-09 | EMERGENCY alerts the assigned doctor at once; the alert stays until the doctor acknowledges it; alert and acknowledgement times are recorded. No blinking across the waiting room. |
| OD-22-10 | Consultation fee: at check-in the doctor's current fee is saved as a bill line (snapshot). Later fee changes never alter existing bills. |
| OD-22-11 | The doctor may reduce, discount or waive the fee of their own consultation, with a reason. Reception may adjust only with an explicit permission, with a reason. Original and revised amounts are kept. |
| OD-22-12 | Follow-up pricing policies (free window, reduced fee) are NOT built now. The bill-line design must allow them later; they stay off until configured. |
| OD-22-13 | Prescribing a medicine never adds a charge. Reception bills medicines actually supplied: name (from the prescription or typed), quantity, unit, rate. No stock, batches or expiry. |
| OD-22-14 | Bill categories: Consultation, Procedures / Services, Treatment Packages, Medicines, Additional Particulars. Doctor-added and reception-added lines stay distinguishable. |
| OD-22-15 | Corrections keep the previous value, reason, staff member and time. After a payment, nothing is silently overwritten. |
| OD-22-16 | Referred By is required on every visit and defaults to Self. Categories: SELF, DOCTOR, PERSONAL, ORGANIZATION, OTHER. Name required for DOCTOR, PERSONAL and ORGANIZATION. Stored per visit, never copied from an earlier visit. |
| OD-22-17 | Previous dues are shown beside the current bill, never merged into it; they are collected against their own ledger entry. |
| OD-22-18 | Payment is not a condition for entering the queue. Patient Out with a balance is allowed with a reason (owner decision 8, already built); the balance stays in the ledger. |
| OD-22-19 | Reception never completes a consultation; the doctor owns clinical completion. Reception owns payment collection and checkout. |

## 3. What already exists (verified in code 2026-11-15)

| Need | Exists today | Where |
|------|--------------|-------|
| Permanent URN, duplicate check | Yes | `patients` (unique urn), `/patients/check-duplicate` |
| Visit per arrival, one OPEN per patient | Yes | `visits`, `visit_service.join_or_open_visit` |
| Consultation per doctor inside a visit | Yes | `appointments` (visit_id, consultation_status) |
| Doctor-wise daily token | Yes | `daily_token_sequences`, `token_service` |
| Booking sources PHONE / WALK_IN, expected time | Yes | `appointments.source`, `expected_time` |
| No-show, cancel, reschedule (history kept) | Yes | `PATCH /appointments/{id}/status`, `/reschedule` |
| Waiting / with doctor / completed | Yes | `consultation_status` WAITING / IN_CONSULTATION / COMPLETED |
| Payments as separate transactions, receipts, reversal | Yes | `payments`, `receipt_sequences` |
| Close visit with balance + reason, visit dues | Yes | `/visits/{id}/close`, `compute_visit_dues` |
| Packages with sessions and their own ledger | Yes | `treatment_plans`, `treatment_sessions`, pending dues |
| Live refresh across the LAN | Polling (10 s) | `useAppointments`, queue queries |
| Priority / emergency, alert, acknowledgement | **No** | — |
| Visit type NEW / FOLLOW_UP | **No** | — |
| Referred By per visit | **No** (only on treatment plans) | — |
| Itemised bill lines (qty × rate), doctor vs reception lines | **No** | — |
| Fee snapshot | **No — defect**: a consultation's fee is read live from `doctors.default_fee_paise` (`billing_service.visit_charge_lines`), so changing a doctor's fee changes old balances | — |
| Doctor reassignment of a waiting patient | **No** (cancel + new walk-in only) | — |
| Reception waiting-room kanban | **No** (doctor kanban exists) | — |

## 4. Data model changes

### Migration 0026 — check-in fields (Wave 1)

`appointments` (one row = one consultation):

| Column | Type | Rule |
|--------|------|------|
| `visit_kind` | varchar(16) NULL | `NEW` / `FOLLOW_UP`; NULL for rows created before this phase |
| `priority_level` | varchar(16) NOT NULL default `NORMAL` | `NORMAL` / `PRIORITY` / `EMERGENCY` |
| `priority_reason` | text NULL | required (≥ 3 chars) unless NORMAL — CHECK constraint |
| `priority_updated_at` | timestamptz NULL | last classification change |
| `priority_updated_by_user_id` | FK users NULL | |
| `emergency_alerted_at` | timestamptz NULL | set when classified EMERGENCY |
| `alert_acknowledged_at` | timestamptz NULL | doctor acknowledgement (Wave 2 endpoint) |
| `alert_acknowledged_by_user_id` | FK users NULL | |

`visits`:

| Column | Type | Rule |
|--------|------|------|
| `referral_source` | varchar(16) NULL | `SELF` / `DOCTOR` / `PERSONAL` / `ORGANIZATION` / `OTHER`; NULL only for visits opened before this phase |
| `referrer_name` | varchar(120) NULL | required for DOCTOR, PERSONAL, ORGANIZATION — CHECK constraint |
| `referral_recorded_by_user_id` | FK users NULL | |
| `referral_recorded_at` | timestamptz NULL | |

New append-only table `consultation_priority_events`:
`id, appointment_id, visit_id, patient_id, doctor_id, event (CLASSIFIED | ACKNOWLEDGED),
from_level, to_level, reason, actor_user_id, created_at`. No update or delete path exists.

Referral belongs to the visit: the check-in that opens the visit records it; a second
consultation on the same day joins the visit and leaves its referral unchanged (the screen shows
the recorded referral). No legacy row is back-filled; nothing about old visits is invented.

### Migration 0027 — bill lines (Wave 3)

New table `bill_items` (the visit's bill; the visit acts as the invoice):
`id, visit_id, patient_id, appointment_id NULL, treatment_plan_id NULL, prescription_item_id NULL,
category (CONSULTATION | PROCEDURE | PACKAGE | MEDICINE | ADDITIONAL), source (DOCTOR | RECEPTION | SYSTEM),
description, unit NULL, quantity numeric(10,2) > 0, rate_paise ≥ 0, amount_paise ≥ 0,
original_amount_paise, status (ACTIVE | VOIDED), void_reason, voided_by, voided_at,
created_by_user_id, created_at, version_id`. Same-patient composite FK to visits.

New append-only table `bill_item_adjustments`:
`id, bill_item_id, old_quantity, new_quantity, old_rate_paise, new_rate_paise, old_amount_paise,
new_amount_paise, kind (DISCOUNT | WAIVER | CORRECTION | VOID), reason, actor_user_id, created_at`.

`payments` gains `visit_id NULL` (composite FK visit + patient). A visit payment settles the visit
bill; legacy payments keep their `appointment_id` and still count toward that visit.

Back-fill (data migration, no deletion): every appointment already linked to a visit gets one
SYSTEM `CONSULTATION` line at its doctor's fee as stored at migration time, which is exactly what
the screens show today, so no visible balance changes.

Balance rule after Wave 3: `visit total = Σ ACTIVE bill_items.amount`;
`visit paid = Σ non-reversed payments with visit_id = visit OR appointment_id in visit`;
`due = max(0, total − paid)`. Package instalments stay on the package ledger
(`treatment_plans`), shown in the bill's Packages section but never double-counted.

## 5. Status transitions

Consultation (`appointments.consultation_status`), unchanged except reassignment:

```
(booked, no token) --check-in--> WAITING --doctor calls--> IN_CONSULTATION --doctor completes--> COMPLETED
WAITING --reception cancels (reason)--> CANCELLED
WAITING --reception reassigns (reason)--> CANCELLED + new WAITING consultation for the new doctor
                                           (same visit, new token from the new doctor's sequence)
```

Booking (`appointments.status`): BOOKED → ARRIVED → IN_CONSULTATION → DONE; BOOKED → NO_SHOW /
CANCELLED / RESCHEDULED. A no-show or cancellation never creates a consultation or a bill (OD-22, rule 12).

Classification: NORMAL ⇄ PRIORITY ⇄ EMERGENCY while WAITING (and IN_CONSULTATION for display);
each change writes a `consultation_priority_events` row. EMERGENCY sets `emergency_alerted_at`;
the doctor's acknowledgement sets `alert_acknowledged_at` and writes an ACKNOWLEDGED event.

Visit: OPEN → CLOSED (Patient Out; reason required when a balance remains) or CANCELLED.

Bill line: ACTIVE → (adjusted, history row) → VOIDED (reason). Lines are frozen once the visit
is CLOSED.

## 6. Permissions

| Action | Reception | Doctor | Admin |
|--------|-----------|--------|-------|
| Register patient / check in / walk-in | ✓ (`patient:create`, `visit:write`) | — | — |
| Set or change classification, reason | ✓ (`visit:write`) | — | — |
| Acknowledge emergency alert | — | own consultations | — |
| Call any waiting patient, complete consultation | — | own queue | — |
| Cancel / reassign a waiting consultation | ✓ (`visit:write`) | — | — |
| Add doctor charges (procedure, package, fee adjust / waive) | — | own consultations (new `bill:clinical`) | — |
| Add reception lines (medicines, particulars) | ✓ (new `bill:write`) | — | — |
| Adjust consultation fee | only if granted `bill:adjust` | own consultations | ✓ |
| Collect payment, print receipt, Patient Out | ✓ (`payment:create`, `visit:write`) | never | oversight only |
| Reverse payment | — | — | ✓ (`payment:reverse`) |

Every endpoint enforces these on the server (AGENTS.md rule 13). The UI only hides what the
server would refuse.

## 7. Screens

Reception sidebar (OD-22-01). Tabs appear as their pages are built; a tab's label equals its
page title.

1. **Check-in & Token** — two columns.
   *Left:* [New patient | Existing patient] → form → Visit type (existing only) → Doctor →
   Classification (+ reason) → Referred By (default Self) → **Register & issue token** /
   **Check in & issue token**. Success card: URN, doctor, token.
   *Right:* Today's appointments (time, patient, phone, doctor, status). Check in loads the
   booking into the left form (doctor fixed) so referral, visit type and classification are
   confirmed. No-show, Cancel (reason), Reschedule.
2. **Dashboard** — unchanged.
3. **Patient Records** — directory; "Register patient (full form)" for photo and full details.
4. **Appointments** — today's/any day's bookings by doctor (the former "Today's Queue" page).
5. **Waiting Room** (Wave 2) — kanban Waiting / In Cabin / Completed; filter by doctor and
   department; search name / URN / token; suggested order with red / amber badges; cancel and
   reassign. Completed cards link to Billing & Checkout.
6. **Billing & Checkout** (Wave 4) — left: patients whose consultation is completed. Right: the
   bill by category, each line marked Doctor / Reception; "Add medicine" (from the prescription
   or typed) and "Add particular" (name, qty, rate, total); beside it the patient's financial
   history (previous dues, packages with sessions used / left, payments). Payment: full or
   partial, Cash / UPI / Card; totals: bill, paid earlier, paying now, remaining on this visit,
   previous dues (separate), total outstanding. Then Print receipt and Patient Out.
7. **Receipts** (Wave 4) — today's receipts (reception), full ledger (admin).
8. **Doctor workspace** (Waves 2–3) — queue in suggested order with badges; emergency banner
   until acknowledged; "Call" on any waiting card; charges panel on the consultation page.

## 8. Waves and tasks

Each task has one owner (this session unless reassigned) and is VERIFIED only per AGENTS.md
"Definition of done". A Git checkpoint (`git stash store`, since the owner commits only on request)
is taken before each wave.

| Task | Wave | Scope | Depends on |
|------|------|-------|------------|
| T22-01 | 1 | Migration 0026; model fields; priority event table | — |
| T22-02 | 1 | Walk-in / check-in accept visit_kind, priority (+reason), referral; new-patient check-in endpoint (patient + visit + consultation + token in one transaction); `PATCH /appointments/{id}/priority` with history | T22-01 |
| T22-03 | 1 | Check-in & Token page, two columns (OD-22-02/03/04/05/06/16) | T22-02 |
| T22-04 | 1 | Sex option "Other" on registration; reception sidebar order; "Today's Queue" page retitled "Appointments" | — |
| T22-05 | 2 | Waiting Room kanban page; suggested order; reassign endpoint | T22-02 |
| T22-06 | 2 | Doctor queue: suggested order, badges, call any; emergency alert + acknowledge endpoint and banner | T22-02 |
| T22-07 | 3 | Migration 0027 bill_items + adjustments + payments.visit_id; back-fill; fee snapshot at check-in; balance switch | T22-02 |
| T22-08 | 3 | Bill endpoints: doctor charges and fee adjust / waive; reception medicines and particulars; void; permissions `bill:clinical`, `bill:write`, `bill:adjust` | T22-07 |
| T22-09 | 4 | Billing & Checkout page; Receipts page; financial history panel | T22-08 |
| T22-10 | 4 | Doctor charges panel on the consultation page | T22-08 |
| T22-11 | 5 | Referral report for admin (by source, referrer, date range) | T22-02 |

## 8a. Wave 1 status (2026-11-15)

T22-01..T22-04 implemented on branch `fix/sidebar-daily-flow` (uncommitted; checkpoint
`stash@{0}` "checkpoint: before phase 22 OPD workflow").

- Backend: migration 0026, models, `services/patient_service.py`, check-in details in
  `booking_service`, `POST /appointments/walk-in/new-patient`, `PATCH /appointments/{id}/priority`,
  referral saved in the same insert that opens the visit (`visit_service.join_or_open_visit`).
  `tests/test_phase22_checkin.py` (13 tests), RBAC matrix rows, OpenAPI snapshot regenerated.
- Frontend: `TokenGenerationPage.tsx` rewritten (two columns), `components/checkin/*`,
  Sex "Other" on the registration form, reception sidebar order, "Today's Queue" retitled
  "Appointments".
- Verified on a side server (port 8010, `kalyan_test`, scratch build): new-patient check-in
  (Emergency + doctor referral), booked check-in from the list (Follow-up + personal referral),
  priority change from the list, reload persistence, DB rows, history and audit rows.
- NOT done on the owner's :8000 server: migration 0026 is not applied to `kalyan_dev`, the
  server is not restarted and `frontend/dist` is not rebuilt. All three must happen together;
  a new dist against the old server breaks check-in.
- Known gap: the older `PATCH /appointments/{id}/status` → ARRIVED path still checks in without
  a referral (no UI uses it). Close it in Wave 2.

## 9. Risks

- The fee snapshot (T22-07) changes how balances are computed. The back-fill must reproduce
  today's numbers exactly; a test compares every visit's due before and after.
- Two migrations touch `appointments`; they run in order 0026 → 0027, never in parallel sessions.
- Live updates stay on 10-second polling (LAN, no internet). Emergency alerts poll every 5 s on
  the doctor's screen; worst-case delay is about 5 seconds.
- Reassignment issues a new token from the new doctor's sequence; the old token stays in history.
