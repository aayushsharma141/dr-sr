# UI/UX gap plan: what the reference app has that our build does not

**Status:** PLAN ONLY. Nothing implemented. Written 2026-11-11.
**Task prefix:** `UX-xx`. Builds on `UI-ADOPTION-PLAN-2026-11-09.md` (K-xx); does not replace it.
**Reference studied:** `C:\Users\147ha\Downloads\workspace-01a1c48d-4e53-7827-82c7-a387bed1f556` (Node + plain HTML/CSS/JS, 13 screens, 36 screenshots in `shots/`). Read: `public/css/app.css`, `public/index.html`, all of `public/js/views/`, README.
**Our build compared:** `frontend/src` on branch `feature/hospital-lan-v3-stabilized`, by source search. **Not compared in the running app on `:8000`**; rows marked "confirm" need a look there.

**Standing rules that still apply**
- D1/D6 (2026-11-10): the client approved the maroon screens. We take the reference's **structure, hierarchy, spacing, type scale and work flow**, not its teal colours, shell, code or data.
- Owner decisions in section 6a of the K-plan win over the reference where they differ (see section 4 below).

---

## 1. What the reference does well (the lessons)

### 1.1 Navigation and tab hierarchy
- **Three levels only.** Sidebar (5 daily items, then one "Administration" group) → page → tabs inside the patient file. Nothing deeper.
- **One place per job.** One queue page, one patient file, one dues list. The same action is never offered on three different pages.
- **Patient file is the hub.** Tabs `Overview | Visits (1) | Sessions (10) | Money (3)`, each with a **count**, and the tab is in the URL (`?tab=money`) so "Collect ₹2,300" on the header links straight to it and a reload keeps the tab.
- **Sidebar is permission-filtered**, with the same order for every role; a doctor simply sees fewer items.

### 1.2 Page layout and alignment
- Every page: back link → title (left) → one-line subtitle → actions (right, primary first). Never more than one primary button.
- Content sits in cards: card head (title + one-line explanation) → body → optional footer.
- Tables: uppercase small header; name in bold with a muted second line (URN · age · mobile) in the same cell; IDs in monospace; **money right-aligned**; status as a pill; row actions at the far right.
- Two-column page grid: work area left, 320 px summary column right (`Money today`, `System`, `Quick actions`).
- Summary numbers sit above the table they explain (`Billed | Paid | Outstanding` above Bills).

### 1.3 Typography (one scale, used everywhere)
| Use | Size / weight |
|---|---|
| Body | 14 px / 1.5, system font |
| Page title | 21 px / 650, tight tracking |
| Page subtitle, cell second line | 13 px and 12 px, muted |
| Card title | 14 px / 600 |
| Field label | 12.5 px / 600, **sentence case** |
| Field hint | 11.5 px, muted, under the field |
| Stat value | 26 px / 650 |
| IDs (URN, bill, receipt) | monospace 12.5 px |
| Controls | inputs and buttons 34 px high; small 28; large 40 |
| Radius | 7 (controls), 10 (cards), 14 (dialogs) |

### 1.4 Forms
- Two cards side by side: **Patient** (identity) | **Case & plan** + **Photo**. Two-column field grid inside; long fields span both.
- Required fields carry a red `*`; the page subtitle says what `*` means.
- Hints explain *why* ("Used to find the patient at the desk and to warn about duplicates").
- Department filters the Doctor list, so a mismatch cannot be saved.
- Duplicate check on blur (warning), and on save a blocking box with "This is a different person — register anyway".
- Server field errors are shown on the field; a stale edit shows "changed on another computer — reload".
- One action bar at the bottom: `Cancel` then the primary button, which shows "Registering…" while busy.
- Dialogs: title + one-line consequence ("A receipt is written the moment you save; it can only be reversed, never edited"), a summary strip of what is being acted on, then at most 4 fields.

### 1.5 Work flow
`Register → lands on patient file → Issue token (dialog shows the charge before saving) → Check in → Start consultation → Finish visit → Collect → Receipt (ORIGINAL, later DUPLICATE)`.
The next action is always a button on the row or the header; status is never typed. The queue row shows the visit type, the charge and the balance, so reception knows what to collect before the patient reaches the desk.

---

## 2. Gaps: what our build is missing

Evidence is from source search of `frontend/src` and `backend/src/kalyan_api/models.py`.

### A. Design consistency (the biggest gap)
| # | Gap | Evidence |
|---|---|---|
| A1 | No shared UI parts. `components/` has `Modal`, `InlineAlert`, `ConflictBanner` only; no Button, Field, Card, Table, Badge, PageHeader, EmptyState, Toast. Every page re-types its own classes. | directory listing |
| A2 | Brand colour is hard-coded. 338 raw hex uses (`#5D0B26`, `#8E1C3D`…), 151 `red-900/800`, only 30 uses of the `brand-*` tokens that already exist in `index.css`. | grep counts |
| A3 | Two grey families mixed: `slate-*` 1,738 uses, `neutral-*` 940. | grep counts |
| A4 | No type scale: 51 arbitrary `text-[Npx]` sizes; page titles at `text-xl`, `text-2xl` and `text-3xl`; 491 `font-bold` + 17 `font-black`. | grep counts |
| A5 | Five corner radii in use (`rounded` 328, `-md` 61, `-lg` 339, `-xl` 210, `-2xl` 32). | grep counts |
| A6 | Focus ring is emerald on the registration form but maroon globally. | `PatientRegister.tsx:592`, `index.css` |
| A7 | Field labels are UPPERCASE bold with wide tracking; harder to read than the reference's sentence case. No hint text under fields. | `PatientRegister.tsx:579` |
| A8 | No empty-state component; 30 plain "Loading …" strings; toasts exist on one page only. | grep |

### B. Navigation and hierarchy
| # | Gap | Evidence |
|---|---|---|
| B1 | No global patient search in the header (reference: always visible, `/` to focus, arrow keys). | no match in `AppShell.tsx` |
| B2 | Same job on several pages: live queue on Dashboard, Appointments and Token Desk; payments on Billing & Payments, Pending Dues and inside the patient file. | routes and page headings |
| B3 | Patient file tabs have no counts and are not in the URL (`useState`), so links cannot open a tab and reload resets it. | `PatientDetail.tsx:100` |
| B4 | No connection indicator in the shell. | confirm on `:8000` |

### C. Patient file
| # | Gap | Evidence |
|---|---|---|
| C1 | Header actions are only `Edit Demographics` and `Print Card`. Missing: Issue token, Collect ₹X (K-33 already asks for these). | `PatientDetail.tsx:137-150` |
| C2 | No money summary on the header (billed / paid / balance) and no "due" pill. | not present |
| C3 | Every non-profile tab is the same filtered timeline. No bills table with `Take payment`, no receipts table with `Print`, no package progress with `Log session N`. | `PatientDetail.tsx:387-413` |
| C4 | No "what will the next visit cost" card. | no `revisit`/`eligib` in frontend |

### D. Queue and tokens
| # | Gap | Evidence |
|---|---|---|
| D1 | Queue columns are Token, Patient, Doctor, Arrival, Status, Actions. No visit type, charge, or balance. | `ReceptionDashboard.tsx:600-605` |
| D2 | Issuing a token is a full page, away from the queue; the reference does it in a dialog from the queue or the patient file. | `TokenGenerationPage.tsx` |

### E. Money
| # | Gap | Evidence |
|---|---|---|
| E1 | No invoice table or screen. Already planned as K-63/K-64; not started. | no `invoice` in models or frontend |
| E2 | No revisit fee and no plans (K-61, K-62 not started). | no `revisit` in frontend; no plan-purchase table |
| E3 | Payment dialog does not show a summary strip of the bill being paid. | confirm on `:8000` |

### F. Forms
| # | Gap | Evidence |
|---|---|---|
| F1 | Registration is one long 12-column form; not grouped into side-by-side cards with a single bottom action bar. | `PatientRegister.tsx:510-1004` |
| F2 | Field-level server errors exist on admin/login forms but not on registration, booking or payment. | grep `aria-invalid` |

### G. Small safety items
| # | Gap |
|---|---|
| G1 | No "synthetic test data" banner while demo data is loaded (reference shows one on screen and on prints). |

**Not gaps (we already have these, or more):** VAS + modalities session log, addenda, optimistic-lock conflict banner, duplicate detection, receipt DUPLICATE reprint, admin reversal, audit viewer, backups + integrity, roles matrix, security centre, import/export, print templates, specialty forms, prescriptions.

---

## 3. Plan

Each task: one owner per file, Git checkpoint before the batch, definition of done from `AGENTS.md`, rebuild and check on `:8000`.

### Phase 0 — Safety blockers from the Foundational Bug Report (before any UI work)

The report (2026-11-11) audited commit `2736a8ae` on `feature/reception-all-specialties`. That commit is **153 commits behind this branch** and does not contain fix `16cb067c` (BR-001, BR-002). Status below is for this branch, by reading the code; **no test was run for this plan**.

| Report finding | State on this branch | Evidence |
|---|---|---|
| Encounter linked to another patient's appointment | Fixed in the API, with a test | `routers/encounters.py:147`, `tests/test_patient_linkage.py` |
| Prescription linked to another patient's encounter | Fixed in the API, with a test | `routers/prescriptions.py:132` |
| Treatment plan linked to another patient's encounter | **Still open** | `routers/treatment_plans.py:88-97` checks the doctor only |
| No database constraint for same-patient links | **Still open** | no composite FK or trigger in `models.py` or migrations (head `0021`) |
| Timeline: Admin/Reception see diagnoses, prescriptions, VAS, modalities | Fixed | `routers/timeline.py:99`, tests in `test_patient_linkage.py` |
| Timeline: doctors see payment amounts, receipts, reversals | **Still open** | payments query has no permission or scope check (`timeline.py`, section 6) |
| Timeline: plan price shown to every role; plans and appointments not doctor-scoped | **Still open** | `timeline.py`, sections 1 and 4 |

| ID | Task | Depends on |
|---|---|---|
| SEC-01 | Treatment-plan creation rejects an encounter of another patient, before any write. Same error style as BR-001. Negative test plus a matching-patient test. **IMPLEMENTED 2026-11-11, commit `32d24aaf` on PR #28** (`routers/treatment_plans.py`, two tests in `tests/test_patient_linkage.py`; the negative test returned 201 before the fix and 404 after). API and database behaviour tested; not exercised through the browser. | — |
| SEC-02 | Read-only audit query for existing mismatched rows in all three links. Report the count; correct nothing silently. **Script written 2026-11-11, commit `32d24aaf`** (`backend/scripts/audit_patient_links.py`, six links). Run on `kalyan_dev`: 0 mismatched rows (3 linked encounters, no other linked rows). **Not yet run on the hospital server database.** | — |
| SEC-03 | Migration `0022`: database-level same-patient enforcement for encounter→appointment, prescription→encounter, plan→encounter. Design first (existing `SET NULL` behaviour, no history deleted or re-parented). Test that a direct mismatched insert fails. **IMPLEMENTED 2026-11-11, commit `32d24aaf` on PR #28; see "SEC-03 design" below.** Not applied to `kalyan_dev` or the hospital server. | SEC-02 |
| SEC-04 | Timeline: each section checks its own domain permission and row scope (`PAYMENT_READ` for payments, `PLAN_READ` for plans, and so on); price and payment fields leave the response for roles without them. Add the test "nothing reachable through the timeline that the direct endpoint denies". | owner decision 6, 7 |
| SEC-05 | Make sure the stale branch `feature/reception-all-specialties` is never deployed or merged without `16cb067c`. | — |

**SEC-03 design (as built)**
- Parents get `UNIQUE (id, patient_id)`: `uq_appointments_id_patient`, `uq_clinical_encounters_id_patient`.
- Each link gets a composite foreign key `(link column, patient_id) → parent (id, patient_id)`: `fk_clinical_encounters_appointment_patient`, `fk_prescriptions_encounter_patient`, `fk_treatment_plans_encounter_patient`. Rows with no link are not checked.
- The old single-column foreign keys stay. On parent delete only the link column becomes NULL (`ON DELETE SET NULL (column)`, PostgreSQL 15+; dev runs 18.6). `patient_id` is never cleared; nothing is deleted or re-parented.
- A linked row's `patient_id` can no longer be changed on its own. No application code does this today.
- The upgrade refuses to run, and changes nothing, if mismatched rows exist or the server is older than PostgreSQL 15.
- Patient only. Doctor equality is **not** enforced (the report suggested it): no rule says a prescription's doctor must equal the encounter's doctor, and session takeover exists.
- Evidence (2026-11-11, `kalyan_test`, synthetic rows): four of six new database tests failed before the migration and all pass after; full backend suite 1,106 passed, 1 skipped; migration-parity test passes; a manual run showed downgrade to `0021` removes all five constraints, upgrade over a mismatched row is refused with the row and schema left untouched, and upgrade succeeds once the row is removed. Status: IMPLEMENTED — NOT VERIFIED (no browser check; not applied to `kalyan_dev` or the server).
- Not covered: session→plan, payment→plan, payment→appointment. The API checks these; the audit script reports them. Add constraints only if the owner wants them.

**Effect on the UI plan:** the patient file tabs are built on the timeline endpoint today. UX-12 (Money tab) and UX-13 (Treatment tab) must read from the billing and treatment-plan endpoints, which enforce permissions, not from the timeline. The reference lets a doctor open the Money tab; we do not copy that unless the owner decides so (decision 6).

### Phase 1 — Foundations (no visible redesign; look stays maroon)
| ID | Task | Closes | Depends on |
|---|---|---|---|
| UX-01 | Write the design rules as one page: type scale (section 1.3 mapped to Tailwind sizes), spacing, radius (pick 2), grey family (pick `slate`), control height. Owner signs off before any code. | A3-A7 | — |
| UX-02 | Tokens: replace raw maroon hex and `red-900/800` with the existing `brand-*` tokens, identical values. This is K-11. Mechanical, file by file, screenshot before/after. | A2, A6 | UX-01 |
| UX-03 | Shared parts in `components/ui/`: `Button`, `Field` (label, `*`, hint, error), `Card`, `PageHeader`, `DataTable` cell helpers (two-line cell, money cell, ID cell), `StatusPill`, `EmptyState`, `Toast`. Built to match the approved screens. | A1, A8 | UX-01 |
| UX-04 | Move pages onto the shared parts, one page per change, no behaviour change. Order: PatientsDirectory → PendingDues → PatientDetail → Appointments → Billing → Registration → admin pages. | A1-A8 | UX-03 |

### Phase 2 — Patient file as the hub
| ID | Task | Closes | Depends on |
|---|---|---|---|
| UX-10 | Tabs in the URL (`?tab=`) and counts on tab labels. | B3 | — |
| UX-11 | Header: identity line, due pill, actions `Issue token`, `Collect ₹X`, `Print card`, `Edit`. Role-filtered (doctors do not collect: invariant 7). | C1, C2 | K-23 or K-63 for the balance |
| UX-12 | Money tab: `Billed | Paid | Outstanding`, bills with `Take payment`, receipts with `Print`. | C3, E3 | K-63, K-64 |
| UX-13 | Treatment tab: plan progress bar, sessions used/left, `Log session N` for the treating doctor; session is deducted only on completion (invariant 11). | C3 | — |
| UX-14 | "Next visit" card: first visit / revisit / covered by plan, and the amount. | C4 | K-61, K-62 |

### Phase 3 — Queue and tokens
| ID | Task | Closes | Depends on |
|---|---|---|---|
| UX-20 | Add Visit & charge and Balance columns plus status count pills to the queue. | D1 | K-61, K-67 |
| UX-21 | "Issue token" as a dialog from the queue and the patient file, showing the charge before save. Keep the Token Desk page until reception confirms the dialog is enough. | D2 | K-67 |
| UX-22 | One queue: decide which page owns the live queue (Dashboard or Appointments) and make the other link to it. | B2 | owner decision |

### Phase 4 — Forms
| ID | Task | Closes | Depends on |
|---|---|---|---|
| UX-30 | Registration regrouped into cards (Patient | Visit details + Photo), sentence-case labels, hints, one bottom action bar. Same fields, same validation. Needs client approval because this screen was approved as it is. | F1, A7 | UX-03, client OK |
| UX-31 | Field-level server errors on registration, booking and payment. | F2 | UX-03 |

### Phase 5 — Shell
| ID | Task | Closes | Depends on |
|---|---|---|---|
| UX-40 | Header patient search (URN, name, mobile), `/` to focus, arrow keys, Enter opens the file. Uses the existing search endpoint. The K-plan listed global search under "leave"; needs the owner to reverse that. | B1 | owner decision |
| UX-41 | Server connection indicator in the header. | B4 | — |
| UX-42 | Synthetic-data banner driven by a setting, on screen and on prints. | G1 | — |

### Phase 6 — Verification
| ID | Task |
|---|---|
| UX-50 | Per screen: Vitest, API, DB persistence, reload, related screens, RBAC for the three roles, full regression with `PYTHONPATH` pinned. |
| UX-51 | Build, check on `:8000`, compare each screen with the approved screenshot. |
| UX-52 | Day-flow walk with synthetic patients; print check on the Epson A4. |

**Order:** Phase 0 first (`SEC-01, SEC-02 → SEC-03`; `SEC-04` after decisions 6 and 7). Then `UX-01 → UX-02, UX-03 → UX-04` runs alongside the open K-work (`K-61 → K-62 → K-63 → K-64 → K-67`). `UX-10` and `UX-13` can start now. `UX-11/12/14/20/21` wait for the K-tasks named.

---

## 4. Do not copy from the reference
| Reference feature | Why not |
|---|---|
| Teal palette, white topbar, its login and setup pages | D1: maroon screens are approved. |
| Department-level follow-up rule (free window, % discount) | Owner Q4: no fixed free window; the window is a field on each plan. |
| `KH-2026-0007` URN, `KH-INV-2026-…`, `KH-RC-2026-…` | Owner: `KH-YY-P-MM-NNNNN`, `KH-INV-26-27-…`, `KH-RCP-26-27-…` per financial year. |
| Plain token numbers | Owner: cabin letter + serial (`A-01`). |
| "Sessions agreed / total agreed fee" on registration | Our model keeps this on the treatment plan; moving it is a business-rule change nobody asked for. |
| Hash-chained audit, encrypted files | D4/D5: later, separate change. |
| "Patient out" button | No such rule in our invariants; ask before adding. |

## 5. Decisions needed from the owner
1. **UX-01 sign-off:** adopt the reference type scale and sentence-case labels inside the maroon look?
2. **UX-30:** may the approved registration screen be regrouped?
3. **UX-40:** add header search (reverses a "leave" item in the K-plan)?
4. **UX-22:** which page owns the live queue?
5. **Control height:** keep our 44 px touch-size controls, or go denser (reference is 34 px) for mouse-only desk PCs?
6. **Doctors and money (SEC-04):** may a doctor see a patient's payment amounts and receipts? Today the direct endpoints deny it and the timeline shows it.
7. **Doctors and other doctors' records (SEC-04):** the report assumes a strict silo; the 2026-11-05 direction was "read all, edit own", still waiting for sign-off from both consultants and the trust administrator. The timeline fix depends on which one holds.

## 6. Risks
- **Look drift** while moving pages to shared parts: screenshot before/after every page (UX-51).
- **Budget (Rs 22,000):** Phase 1 and Phase 2 carry most of the value; Phase 5 is the first to drop.
- **Concurrent editors:** 20 frontend files are modified and uncommitted right now; UX-02/UX-04 touch the same files, so they need a checkpoint first.
