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
| K-21 | No duplicate active booking for the same patient, doctor and date. Follow-up booking checks the department and that the doctor is active. **2026-11-10: the BR-012 half is done (follow-up booking applies the same patient, doctor and department rules as normal booking, and records the department). The BR-006 half is waiting on the owner's choice: block a second same-day booking with the same doctor, or allow it with a reason.** | BR-006, BR-012 | K-00 |
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
| B2 | BR-003, BR-004 | **Open.** |
| BR-018 | What a check-in charges | **Open.** |
| BR-013 | May a started consultation be cancelled? | **Open.** |

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

## 7. Risks

- **Look drift.** Every screen change is checked against the approved screenshot (K-51). Do not restyle while reworking a flow.
- **Scope against the Rs 22,000 fixed price.** Phase 1 and the K-31, K-34 and K-35 flows carry most of the value. Phase 3 is the first thing to drop.
- **Concurrent editors.** Compare mtimes before each edit, and report changes rather than reverting them.
- **Parallel redesign plans.** Retire the earlier Gemini/Antigravity shadcn/ui plan, so nobody restyles the approved screens.
- **Test isolation.** Pin `PYTHONPATH`, redirect the photo and backup directories, and never run tests on the hospital server.
