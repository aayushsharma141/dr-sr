# Plan: keep the approved Kalyan UI, borrow the HMS work flow

**Status:** PLAN ONLY. Nothing implemented or committed. Revised 2026-11-10 (third revision; supersedes the teal-reshape version).

**Direction (from the user, 2026-11-10):**
- **The client approved the current Kalyan screens.** The reference is the Patient Records screen as of 2026-11-10: a maroon sidebar (`#5D0B26`), the trust header with logo, Hindi and English names, date, user and Sign out, crimson actions (`#8E1C3D`), a "Patient & Clinical Workflow" section, and URN `KH-2026-0001` tables. That look stays.
- **Remove the HMS integration.** The downloaded HMS (`C:\Users\147ha\Downloads\workspace-dr-sr`) is not merged, ported or restyled into this app. Its teal palette, its shell and topbar, its login page, its branding and its code are all out.
- **Keep what the client likes in the HMS: the internal work-management flow.** Work moves from one step to the next with the action on the row where the work is, and backend state follows the same flow. We rebuild that flow inside the approved Kalyan screens, on the existing FastAPI + PostgreSQL backend.

Confirmed by the user on 2026-11-10: "remove HMS integration" means take no visual design, code or data from the HMS, and reuse only its workflow ideas.

---

## 1. What we take from the HMS, and what we leave

| Take (workflow and backend flow) | Leave (UI and integration) |
|---|---|
| One clear daily flow: book, then check in, then wait in the doctor's queue, then consult, then charge, then collect, then receipt | Teal palette, white topbar, global `/` search, "Connected" pill |
| Row-level actions where the work is: Check in, No show and Cancel on each appointment; Receive payment on each due | Its sidebar sections and its login and setup pages |
| A "today's work" dashboard: who is waiting for which doctor, what is still expected, what is unpaid | Its Node, Express and SQLite code, seed data and `data/` folder (live database and keys) |
| Status that advances automatically from the action, never typed in by hand: Scheduled, Arrived, In consultation, Done, No show | Its identity: Maharashtra address, invented doctors, Nurse role, `KH-000001` numbers, per-day receipt numbers |
| Patient file as one place: header actions (New visit, Book, Bill, Edit) and sections for visits, treatment, prescriptions, payments, timeline | Invoice tables, hash-chained audit and encrypted documents, unless decided separately (section 5) |
| Bill view: what was charged, what was paid, the balance, payments listed under it, part payments allowed | |

---

## 2. Approved UI rules (apply to every screen in this plan)

- Keep the current `AppShell.tsx` structure: the trust header, the maroon sidebar with the existing sections, breadcrumbs, the page title with subtitle, the primary crimson button at top right, and the footer line.
- Tables follow the approved Patient Records table: uppercase header row, monospace crimson URN, small text actions on the right ("View Card", "Edit").
- New controls use the existing colours and type. The current colours are hard-coded (`#5D0B26`, `#8E1C3D`, `#731631`) across many files. Optional task K-11 moves them into tokens with the **same values**, so nothing looks different.
- Navigation stays role-filtered, as in the screenshot. A Doctor sees Dashboard, Patient Records, Physiotherapy Treatment, Appointments, and Follow-up & Visits.

---

## 3. Current backend, checked 2026-11-10

| Area | Current state | Plan |
|---|---|---|
| Visit | No `visits` table. A `clinical_encounters` row links one-to-one to an `appointments` row, and the appointment carries the per-doctor daily token. | Treat appointment plus encounter as the visit. No new table. |
| Appointment status | `AppointmentStatus` with transitions in `appointment_service.py`. BR-005: it never moves to IN_CONSULTATION. BR-013: cancelling mid-consultation is allowed. | Make each workflow action drive the transition (K-20). |
| Billing | No invoice table. `payments` is the ledger, linked to a treatment plan or an appointment. `compute_pending_dues` derives balances. | Keep the ledger. Add a read-only bill view (K-23). |
| Allergies | `patients.allergies` is free text. | Optional structured allergies (K-30). |
| Audit | `audit_logs` has no hash chain. | Out of this round. |
| Migrations | Head is `0020_integrity_runs`. | Any new migration is `0021`. |
| In-flight work | Uncommitted edits on `audit/repair-2026-11`: `routers/timeline.py`, `PatientRegister.tsx`, `TokenGenerationPage.tsx` and their tests. BR-010 is done but uncommitted. | Commit or stash before touching those screens (K-00). |

---

## 4. Work breakdown

Rules from AGENTS.md apply: one owner per file, a Git checkpoint before each batch, backend and database changes through a single owner, and the seven-point definition of done before anything is marked VERIFIED.

### Phase 0: Unblock

| ID | Task | Depends on |
|---|---|---|
| K-00 | Commit or stash the in-flight audit repair, then tag a Git checkpoint. Needs your go-ahead to commit. | none |
| K-01 | Decide B2: BR-003 (package auto-completed with an unpaid balance) and BR-004 (overpayment guard on consultation payments). | none |
| K-02 | Decide what a check-in charges (BR-018: the Token Desk shows a Rs 400 placeholder that is never charged). Ask reception and the trust administrator; do not guess. | none |

### Phase 1: Backend work flow (single owner)

| ID | Task | Fixes | Depends on |
|---|---|---|---|
| K-20 | Status follows the action. Check-in sets Arrived. Opening the consultation sets In consultation. Finalising sets Done. Cancel and No show need a confirmation and a reason. Same-status changes are rejected. Decide whether a consultation can be cancelled after it has started. | BR-005, BR-013, BR-014, BR-015 | K-00 |
| K-21 | No duplicate active booking for the same patient, doctor and date (BR-006: blocked by default, allowed with >= 5 char override). Follow-up booking checks department and active doctor (BR-012). **DONE (2026-11-10).** | BR-006, BR-012 | K-00 |
| K-22 | Doctor queue counts only real consultations. Cancelled and no-show are excluded. | BR-016 | K-20 |
| K-23 | Read-only bill view endpoint per patient: charges (consultation fee, treatment package), payments under each charge, balance. Built over `payments` and `compute_pending_dues`. No new money table. | BR-003, BR-004 per K-01 | K-01 |
| K-24 | "Today's work" endpoint, role-scoped. Reception gets waiting per doctor, still expected, and unpaid today. A doctor gets their own queue plus unfinished consultations. First check whether `routers/operations.py` or `routers/areas.py` already returns this, and extend rather than duplicate. | BR-024 | K-20 |
| K-25 | Receipt reprints write an audit row and print DUPLICATE. | BR-021 | K-00 |

Each task adds pytest coverage and updates the OpenAPI snapshot and the RBAC matrix test.

### Phase 2: Screens, in the approved style (one owner per page)

| ID | Screen | Work-flow change | Depends on |
|---|---|---|---|
| K-30 | Dashboard (reception and doctor) | Replace the three link cards with today's work: queue per doctor, expected arrivals, unpaid today, each row with its next action. | K-24 |
| K-31 | Appointments and Token Desk | One list per day with a doctor filter. Row actions Check in, No show and Cancel, with confirmations. Walk-in token from the same page. Real error messages. Shown statuses reflect what is saved. | K-20, K-21, K-00 · BR-008, BR-009, BR-025, BR-026 |
| K-32 | Patient Records list (the approved screen) | Keep the layout. Add pagination. Add a "Due" column when the role can see billing. **2026-11-10: pagination done and checked on `:8000`, uncommitted. The "Due" column is not done; it needs a per-patient balance from the backend, so it moves to K-23.** | BR-029 |
| K-33 | Patient file | Header actions New visit, Book, Bill and Edit. Sections: Visits, Physiotherapy treatment, Prescriptions, Payments, Timeline. Clinical sections are hidden from Reception (D-04). | K-23 |
| K-34 | Consultation (doctor) | Opening a queued patient starts the consultation. Finalise ends it and moves the queue to the next patient. "Change patient" can be cleared. | K-20 · BR-011 |
| K-35 | Billing and pending dues | A due list in which each row has Receive payment. The bill view (K-23) shows charges, payments and balance. The appointment link is kept at checkout. Admin-only reversal with reason. | K-23 · BR-020, BR-023 |
| K-36 | Registration | No visual change. Fix double-submit and false "success". After saving, offer "Issue token now". | K-00 · BR-007, BR-008 |

### Phase 3: Optional

| ID | Task |
|---|---|
| K-11 | Move the hard-coded maroon and crimson values into Tailwind `@theme` tokens with identical values. No visible change. |
| K-40 | Migration `0021`: structured allergies with severity. Keep the text field as the summary and backfill it. Show a red flag on the patient header. Do only if the doctors ask for it. |

### Phase 4: Verification

| ID | Task |
|---|---|
| K-50 | For each screen: Vitest, API tests, database persistence, persistence after reload, related screens updating (a check-in shows in the doctor's queue; a payment clears the due and updates the dashboard), RBAC for Admin, Reception and Doctor, and the full regression run with `PYTHONPATH` pinned. |
| K-51 | Run `npm run build` and check on `:8000`. Compare each screen with the approved screenshot so the look has not drifted. |
| K-52 | Walk the whole day flow end to end with synthetic patients: register, issue token, check in, consult, finalise, charge, collect, receipt, reprint shows DUPLICATE. |
| K-53 | Print check on the Epson A4: registration card, prescription and receipt. |

---

## 5. Decisions

| ID | Question | Status |
|---|---|---|
| D1 | Screen look | **Settled:** keep the client-approved maroon UI. The earlier teal decision is withdrawn. |
| D2 | Bills | **Accepted:** read-only bill view over payments. No invoice table. |
| D3 | Structured allergies | Optional (K-40). Only if doctors ask. |
| D4 | Audit hash chain | **Accepted:** later, separate change. |
| D5 | Encrypted documents | **Accepted:** later. |
| D6 | Meaning of "remove HMS integration" | **Settled (2026-11-10):** no HMS visuals, code or data; workflow ideas only. |
| B2 | BR-003, BR-004 | **Settled (2026-11-10):** Completed package with unpaid balance remains in pending dues and can be paid down; overpayments exceeding doctor's consultation fee are blocked. |
| BR-018 | What a check-in charges | **Settled (2026-11-10):** Token desk displays doctor's configured standard consultation fee (`doctor.default_fee_paise`) (₹0 for package sessions). |
| BR-013 | May a started consultation be cancelled? | **Settled (2026-11-10):** In-consultation appointments can be cancelled while draft with mandatory reason; blocked once consultation is finalised. |
| BR-006 | Same-day duplicate booking | **Settled (2026-11-10):** Blocked by default; allowed if an override reason of at least 5 characters is provided (audited). |

---

## 6. Order

```
K-00 ─► K-20 ─► K-21, K-22, K-24 ─► K-30, K-31, K-34
K-01 ─► K-23 ─► K-33, K-35
K-02 ─► K-31
K-25, K-32, K-36 : after K-00
K-50 ─► K-51 ─► K-52 ─► K-53
```

K-32 (Patient Records pagination) is the only screen task that needs neither a decision nor backend work. It can be done first.

## 6a. Owner decisions, 2026-11-10 (binding for the work below)

**Fees and visits**
- **Consultation fee** (per doctor, e.g. ₹500): editable by Admin on the Doctors page **and** by each doctor on their own settings page.
- **First visit:** the patient pays the consultation fee.
- **Later visits (revisits):** either pay the per-day revisit charge (e.g. ₹300), or buy a **prepaid plan** that covers several days for one payment.
- **Plans** (e.g. "Essential: 10 days at ₹3,000"): a named bundle of revisit days sold for one payment. Plans are managed with full **create, read, update and deactivate** (CRUD) by Admin.
- All fee values are editable with CRUD. Nothing is hard-coded.

**Numbering**
- **Patient URN:** `KH-YY-P-MM-00001` (see open question N1). Synthetic data only, so no migration of existing numbers.
- **Receipt:** `KH-RCP-26-27-000001`, reset each Indian financial year (1 April to 31 March). Accepted.
- **Invoice:** `KH-INV-26-27-000001`, reset each financial year. Accepted. This needs a real invoice table (SC-2), so the plan includes one.
- **Doctor token:** cabin letter plus a two-digit serial, e.g. `A-01`, `B-03`, `C-02`. Each doctor has a cabin code, editable by Admin. The serial resets each day per doctor and is never reused (ADR-26 still holds). The number is the same for reception and the doctor.

**New tasks**

| ID | Task | Depends on |
|---|---|---|
| K-60 | Doctor fee and cabin code: editable on the Doctors page (Admin) and on each doctor's own settings page (Doctor). One source for consultation fee; retire the duplicate fee catalogue on the check-in screen or map it to the doctor's fee. | K-02 |
| K-61 | Revisit fee per doctor, and a visit-day rule: first visit charges consultation fee, later visit-days charge revisit fee unless covered by an active plan. | K-60, K-23 |
| K-62 | Plans with CRUD: name, number of days, price, doctor (or all doctors), active flag, validity. Plan purchase creates a charge that is paid in one go and tracks the days used. | K-61, K-63 |
| K-63 | Invoice table and invoice numbers `KH-INV-FY-000001`. Each visit charge (consultation, revisit, plan) becomes an invoice line; one invoice takes several payments. Replaces the read-only bill view (D2) because the owner now needs real invoices. | K-00 |
| K-64 | Receipt numbers `KH-RCP-FY-000001`, reset per financial year, one receipt per payment. Reprints still show DUPLICATE. | K-63 |
| K-65 | URN generator `KH-YY-P-MM-00001`, replacing `KH-YYYY-XXXX`. Concurrency-safe sequence. | none |
| K-66 | Token display `A-01`, using the doctor's cabin code and a per-doctor daily serial. Shown on the queue, appointment and print screens. | K-60 |
| K-67 | Check-in charge (closes BR-018): the banner's promise becomes true. Check-in creates the consultation or revisit charge, or uses an active plan day, as K-61 defines. | K-61, K-63 |

Each of these needs its own tests (CRUD, RBAC, concurrency for numbers) and a rebuild on `:8000`.

**Answers received (2026-11-10)**
- **N1 URN:** `P` = **Patient**. The sequence restart (monthly or yearly) is **not yet confirmed**; see open item O1.
- **Q1 Revisit fee:** **optional, editable, set per doctor.** A doctor with no revisit fee set has no per-day revisit charge.
- **Q2 Plan days:** **10 days = 10 visit-days used.** Whether a plan expires is **not yet answered**; see open item O2.
- **Q3 Plan scope:** a plan is **valid with any doctor**. Each department defines its own plans, using one **standard plan format** (same fields for every department, values set by that department).
- **Q4 Follow-up validity:** **no fixed free window.** The free window is a field on each plan, so the plan form gets an input for it.

**Resolved (2026-11-10)**
- **O1 URN restart:** the `00001` sequence restarts **each year**, not monthly. Implication: the sequence is unique per year (`KH-YY-P-`), and the `MM` part records the month of registration. K-65 may start.
- **O2 Plan expiry:** **no global rule.** Expiry is an optional input on the plan creation form, set per plan (blank = no expiry). K-62 may start.

## 7. Risks

- **Look drift.** Every screen change is checked against the approved screenshot (K-51). Do not restyle while reworking a flow.
- **Scope against the Rs 22,000 fixed price.** Phase 1 and the K-31, K-34 and K-35 flows carry most of the value. Phase 3 is the first thing to drop.
- **Concurrent editors.** Compare mtimes before each edit, and report changes rather than reverting them.
- **Parallel redesign plans.** Retire the earlier Gemini/Antigravity shadcn/ui plan, so nobody restyles the approved screens.
- **Test isolation.** Pin `PYTHONPATH`, redirect the photo and backup directories, and never run tests on the hospital server.
