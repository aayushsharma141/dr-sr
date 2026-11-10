# Plan: switch Kalyan Hospital to the "workspace-dr-sr" app

**Status:** Phase 0 committed (`b770c9fc`). Phase 1 (SW-10 to SW-14) implemented and tested 2026-11-09, not yet committed. Phases 2–5 not started. Progress log in section 7.
**Decision taken:** on 2026-11-09 the user chose to **switch to the downloaded app** (Path A) instead of reshaping the current React/FastAPI app (Path B).
**New base:** `C:\Users\147ha\Downloads\workspace-dr-sr`: Node 20+, Express 5, SQLite (better-sqlite3 12.9.0) and plain JavaScript with no build step. About 12,000 lines and 54 integration tests.
**Retired to reference:** `backend/` (FastAPI + PostgreSQL) and `frontend/` (React). From now on they are the specification of Kalyan's rules, like `legacy/app/` was for v3. Nothing is deleted.

---

## 1. What the switch means in one paragraph

We keep the downloaded app's engine, look, screens and workflow: one Node process, one SQLite file, encrypted documents and backups, a hash-chained audit log, and the teal UI. Then we teach it everything Kalyan-specific that it doesn't know. It currently describes a made-up multi-speciality clinic in Maharashtra. It has a Nurse role, `KH-000001` record numbers, per-day receipts and seven payment methods. It has no physiotherapy packages, no per-doctor tokens, no departments, no Hindi or letterhead printing, and visits that can only have one doctor. It also hard-deletes clinical notes, diagnoses and prescriptions, lets the Administrator take payments and read clinical notes, and has no protection against two people editing the same record at once. All of that must change before it can hold real patients.

---

## 2. Gap list: the downloaded app against AGENTS.md and the approved decisions

| Rule | Downloaded app today | Change needed |
|---|---|---|
| Invariant 1: one permanent URN | `KH-000001` (MRN) | `KH-YYYY-XXXX`, per-year sequence, never reused |
| Invariant 3: one visit, many doctor consultations | `visits.doctor_id` (one doctor) | New `consultations` table under the visit |
| Invariant 4: independent queue per doctor | Appointments have no tokens | Per-doctor daily tokens, monotonic, never reissued (ADR-26) |
| Invariant 5: queue entry belongs to the right visit and doctor | Partly checked | Server checks that patient, visit, doctor and department all match |
| Invariants 6 and 7: Reception collects, doctors don't | Admin **and** Reception can post payments | Reception only (ADR-23); Admin gets catalogue and reversal rights |
| Invariant 8: charges accumulate within a visit | One invoice is created at once; no adding items later | "Add charge to the visit's open invoice" |
| Invariant 10: payment history never overwritten | Payment void flag with reason (row kept) | Admin-only reversal as a contra-record with reason (D-06) |
| Invariant 11: physio sessions deducted on completion | No physiotherapy at all | Treatment plans, packages and sessions |
| Invariant 12: clinical records keep their links | Hard `DELETE` on notes, diagnoses and prescriptions (`src/routes/clinical.js:448, 484, 531`) | No hard deletes. Finalise, then correct by addendum or cancel with reason. |
| D-04: Admin and Reception denied clinical views | Admin has every permission, including `clinical.read` | Remove clinical access from Admin |
| D-07: 30-min idle, 5 failures, 15-min cooldown | 20-min idle default | Change the defaults |
| D-08: edit conflicts return 409 | No version checks | `version` column and a 409 with a reload banner |
| ADR-17: three roles | Four roles, including Nurse | Admin, Reception, Doctor |
| D-05: FY receipt cycle | `RCPT-YYYYMMDD-0001` | `RCP-2026-2027-0001`, cycle configurable |
| BIL-01: Cash, UPI, Card | Seven methods | Cash, UPI and Card |
| Hospital identity | Kalyan West, Maharashtra; invented doctors | Ara, Bhojpur; trust name; two clinic addresses; English and Hindi |

---

## 3. Work breakdown

AGENTS.md rules apply throughout: one owner per file, a Git checkpoint before every batch, schema changes through one owner, and nothing marked done without the seven-point verification. Sizes are S (about a day), M (a few days) and L (a week or more).

### Phase 0: Record the decision and set up (do first)

| ID | Task | Depends on | Size |
|---|---|---|---|
| SW-00 | **Write down the reason for the switch**, since AGENTS.md requires one. Add ADR-27 to `DECISIONS.md` ("Node + SQLite single-process LAN server; supersedes ADR-15/16; the database file is never shared over the network"). Update the Mission and Architecture sections of `AGENTS.md` and the stack rows of `.planning/PROJECT.md`. Needs your go-ahead, because these files are normally edited only on request. | none | S |
| SW-01 | Park the current work. Commit the 9 in-flight audit-repair files on `audit/repair-2026-11` (only when you say so) and tag `v3-fastapi-final`. Tell the other agents and tools working on `backend/` and `frontend/` to stop, so no more effort goes into code that is being retired. | none | S |
| SW-02 | Install Node 22 LTS on the dev machine (not installed today). Create branch `switch/node-lan`. Copy the downloaded source into a new `hms/` folder. **Leave out** `data/` (it holds a live database, two encryption keys and a backup) and `node_modules/`; put `shots/` in `hms/docs/shots/`. Run `npm install` and `npm test` and record the 54/54 baseline as evidence. | SW-01 | S |
| SW-03 | Remove the invented context: seed data rewritten for Ara/Bhojpur with synthetic physio and eye doctors, Maharashtra address and "multi-speciality" wording removed, demo accounts renamed. All data stays synthetic. | SW-02 | S |

### Phase 1: Foundations (one owner; these touch every route)

| ID | Task | Depends on | Size |
|---|---|---|---|
| SW-10 | **Migration runner.** Today `schema.sql` is version 1 and is applied with `IF NOT EXISTS`, so columns can't be changed. Add numbered migrations (`hms/src/migrations/NNN-name.sql`) that run in one transaction, take an automatic backup first, bump `schema_version` and refuse to start on an unknown newer version. | SW-02 | M |
| SW-11 | **Roles and permissions.** Remove Nurse. Split billing into `payment.collect` (Reception only), `billing.catalogue` (Admin) and `payment.reverse` (Admin). Remove clinical read and write from Admin (D-04). Doctors may edit only their own consultations, notes, prescriptions and sessions (read scope depends on D2). Security defaults: 30-min idle, 5 failures, 15-min cooldown. | SW-10 | M |
| SW-12 | **No hard deletes of clinical rows.** Replace the three `DELETE` routes: drafts are cancelled with a reason, finalised records are corrected by addenda. | SW-10 | S |
| SW-13 | **Edit conflicts.** A `version` column on patients, appointments, consultations, prescriptions, treatment plans and settings; stale writes return 409; the UI shows "Someone else changed this. Reload." | SW-10 | M |
| SW-14 | **Hospital identity and settings.** Names in English and Hindi, trust name, two clinic addresses, phone, print header and footer in both languages, crest/logo upload, receipt cycle (FY by default), consultation validity days. | SW-10 | M |

### Phase 2: Kalyan domain (port the rules, not the Python code; the files named are the reference)

| ID | Task | Reference in current repo | Depends on | Size |
|---|---|---|---|---|
| SW-20 | **Patients.** URN `KH-YYYY-XXXX`. The 12-field registration: name, guardian, gender M/F/O, DOB or age, 10-digit mobile, address, district, state (default Bihar), emergency contact, allergies, notes, photo. Duplicate warning on name + mobile, double-submit guard, photo replaced without losing the old file before commit, A4 registration card with dual signature on the crimson letterhead. Keep the downloaded app's structured allergies with severity. | `services/urn_service.py`, `pages/PatientRegister.tsx`, `components/RegistrationCard.tsx` | SW-11, SW-13, SW-14 | L |
| SW-21 | **Departments and doctors.** Department code and names (EN/HI), doctor profiles (names EN/HI, qualification, registration number, default fee, linked login), membership rules from ADR-24 and ADR-25. | `models.py` Department/Doctor, `routers/departments.py`, `doctors.py` | SW-11 | M |
| SW-22 | **Visit → consultations.** New `consultations` table (visit, doctor, department, appointment, token, status, start and finish time). Vitals, notes, diagnoses, prescriptions and sessions carry `consultation_id`, and the server rejects any link to another patient's records (the BR-001 lesson). | AGENTS.md invariants 3, 5, 12 | SW-21, D3 | L |
| SW-23 | **Appointments and tokens.** Daily token per doctor (ADR-26). Statuses BOOKED → ARRIVED → IN_CONSULTATION → DONE, plus CANCELLED and NO_SHOW, with the allowed transitions. No duplicate active appointment for the same patient, doctor and day. Department and active-doctor checks. Walk-ins. Queue ticket print. The queue screen filters by doctor. | `services/token_service.py`, `appointment_service.py`, `components/QueueTicketPreview.tsx` | SW-22 | M |
| SW-24 | **Consultation.** Symptoms, notes and diagnosis; Finalise locks the record, and corrections are dated addenda. Physiotherapy and ophthalmology specialty forms (versioned templates), vitals, follow-up recommendation → booking, consultation summary print. | `routers/encounters.py`, `templates.py`, `follow_up.py`, `components/Specialty*Form.tsx`, `ConsultationSummaryPrint.tsx` | SW-22 | L |
| SW-25 | **Prescriptions.** Draft → Authorised → Cancelled; medicine lines; dietary and general advice; follow-up date; A4 print with static Hindi labels on the letterhead. | `routers/prescriptions.py`, `components/PrescriptionPrint.tsx` | SW-24 | M |
| SW-26 | **Physiotherapy plans and sessions.** Package with total sessions and agreed price; sessions with VAS score and modalities; Finalise increments `completed_sessions` (invariant 11); session addenda; VAS trend chart; a completed package keeps any unpaid balance visible in dues (the BR-003 lesson). New "Treatment" tab on the patient chart. | `routers/treatment_plans.py`, `treatment_sessions.py`, `components/SessionLoggerModal.tsx`, `VasTrendChart.tsx` | SW-24 | L |
| SW-27 | **Billing for Kalyan.** Cash, UPI and Card only. Services catalogue (consultation fee per doctor, physio session, packages). Charges added to the visit's open invoice; package invoices. Overpayment rejected. Receipt numbers `RCP-<FY>-NNNN`. Admin-only reversal as a contra-record with reason. Reprints marked DUPLICATE and audited. Pending dues, day report, A4 receipt on the letterhead. Consultation validity rule from settings. | `services/receipt_service.py`, `billing_service.py`, `components/ReceiptPrint.tsx`, `PaymentReversalModal.tsx` | SW-22, SW-26, D4 | L |
| SW-28 | **Documents.** Keep the downloaded app's encrypted uploads and audited downloads; set who may view which category (D6). | downloaded `src/routes/attachments.js` | SW-11, D6 | S |

### Phase 3: Administration and data protection

| ID | Task | Depends on | Size |
|---|---|---|---|
| SW-30 | **Backups.** Keep the encrypted `.khb` archives. Add schedule and retention settings in the UI, export to a second drive, and a restore rehearsal on a clean machine (handover gate, ADR-21). | SW-10 | M |
| SW-31 | **Integrity report.** SQLite `quick_check`, audit-chain verification, plus business checks: invoice totals equal their lines, paid equals the sum of payments, completed sessions equal finalised sessions, URN and receipt sequences have no duplicates. | SW-27 | M |
| SW-32 | **Admin extras chosen in D5.** Recommended now: patient demographic correction with diff and audit, and an audited CSV export with a stated reason. Recommended later: the 8-stage import wizard and the print-template editor. | SW-20, D5 | M |

### Phase 4: Data move and go-live

| ID | Task | Depends on | Size |
|---|---|---|---|
| SW-40 | ~~Find out whether `kalyan_prod` on the hospital server holds real patients (D1, OD-05).~~ **Resolved 2026-11-09:** the owner states there is no real patient data. | none | done |
| SW-41 | **Dropped (D1 = no).** *(Was: only if D1 = yes)* One-way move from PostgreSQL to SQLite: an exporter for the current database and an importer for the new app. Keep URNs, receipt numbers, payment and reversal history and finalised notes exactly as they are. Import the old audit rows as a sealed "before switch" log. Produce a reconciliation report (row counts and money totals per table must match). Rehearse on a backup copy first; the live PostgreSQL database is only ever read, never changed or dropped. | Phase 2, SW-40 | L |
| SW-42 | **Server install.** Node LTS from the portable bundle (`npm run portable`), firewall rule, start on boot, nightly backup to the second drive, UPS. PostgreSQL stays installed, read-only, as an archive until you decide otherwise. | SW-30 | M |
| SW-43 | After acceptance, move `backend/`, `frontend/` and `deploy/` to `legacy/v3-fastapi/` (moved, not deleted) and make `hms/` the documented app. | SW-52 | S |

### Phase 5: Verification (AGENTS.md definition of done)

| ID | Task |
|---|---|
| SW-50 | **Port the important business-rule tests as `node:test` API tests**, behaviour by behaviour: URN allocation under concurrency, token monotonicity and no reuse, Reception-only collection, Admin-only reversal, overpayment rejection, doctor edit-own, clinical redaction for Reception and Admin, cross-patient link rejection (BR-001), session deduction only on finalise, no hard delete of clinical rows, 409 on stale edits, DUPLICATE reprint audit. The old pytest names give the checklist. |
| SW-51 | **Screen checks per role** (Admin, Reception, Doctor × every screen): the action works, the API agrees, the data persists after reload, related screens update (dashboard, patient outstanding, invoice balance), and forbidden actions return 403. Optional Playwright smoke tests on the dev machine only. |
| SW-52 | **Acceptance on the real LAN:** 3–5 PCs, internet unplugged, prints on the Epson A4 (registration card, prescription, receipt, queue ticket, each on one page), and a restore on a clean machine. |

---

## 4. Decisions needed

| ID | Question | Recommendation |
|---|---|---|
| D1 | Does the hospital server's `kalyan_prod` already hold real patients? | **Answered 2026-11-09: no real patient data.** SW-41 dropped; go-live starts from a fresh install |
| D2 | Doctor clinical access: "read all, edit own" or strict silo? (EG-6 sign-off still pending) | **Answered: read all, edit own** (owner choice recorded 2026-11-05 in project memory; formal EG-6 sign-off still to be recorded in DECISIONS.md) |
| D3 | What is one visit? | One patient's arrival on one day, covering every doctor seen that day |
| D4 | What creates a charge automatically: consultation fee at check-in, package price at plan start, or manual only? | **Answered by owner 2026-11-10:** Consultation fee once and revisit fee at check-in + physio package fee at plan start. Strictly reception-only: fees are NEVER shown on doctor screens (hidden from doctor UI/endpoints). |
| D5 | Which Phase 20 admin extras come across now? | Demographic correction and audited CSV export now; import wizard and template editor later |
| D6 | Who may open lab and imaging documents? | Doctors view; Reception may upload but not view clinical categories |

Defaults used unless you say otherwise: teal screens with crimson letterhead on paper; plain HTTP on the isolated LAN (D-01), so photos are uploaded as files and webcam capture works only on the server PC itself; the code lives in `hms/` on branch `switch/node-lan`.

---

## 5. Order and critical path

```
SW-00, SW-01 ─► SW-02 ─► SW-03
                  └─► SW-10 ─► SW-11 ─► SW-12, SW-13, SW-14
                                  └─► SW-21 ─► SW-22 ─► SW-23
                                                  └─► SW-24 ─► SW-25
                                                         └─► SW-26 ─► SW-27 ─► SW-31
                        SW-14 ─► SW-20 ─► SW-32          SW-10 ─► SW-30 ─► SW-42
SW-40 resolved (no real data) — SW-41 dropped
Phase 5 runs alongside each task, then SW-52 ─► SW-43
```

- The critical path runs through SW-22 (consultations under visits). Every clinical and billing feature hangs off it, so get it right and tested before building on it.
- SW-40 costs little and should happen first, because a "yes" adds the biggest single task (SW-41).

## 6. Risks to accept or manage

- **More work than reshaping.** Most of what the current app does must be rebuilt (Phase 2 is mostly L-sized tasks). Against the Rs 22,000 fixed price, agree with the client which Phase 2–3 items are in this release.
- **Existing tests stop protecting you.** The 1,064 pytest cases no longer run against the live app. SW-50 must re-create the important ones before go-live.
- **SQLite is single-writer.** That is fine for 3–5 PCs in WAL mode with a busy timeout. Never put the `.db` file on a network share; only the Node process opens it.
- **Node on the server PC.** Use the portable bundle and the same Node major version as the dev machine (26 today). better-sqlite3 is pinned to 13.0.3, which ships prebuilt binaries for Node 22+ including 26; 12.9.0 had none for Node 26 and no compiler is installed. Don't change it casually.
- **Other agents and tools.** Anything still editing `backend/` or `frontend/` is wasted work, and the tool that rewrites repo files mid-session could touch `hms/`. Check file times before building on a file.
- **Secrets in the download.** The downloaded `data/` folder holds keys and a database. Don't copy, commit or reuse them; the new install generates its own.
- **Print fidelity.** The approved crimson SAMPLE.pdf letterhead and the Hindi labels must be re-created in HTML print CSS (Devanagari via the Windows "Nirmala UI" font, with no web fonts) and checked on the real printer.

---

## 7. Progress log

### Phase 0 (2026-11-09)

| ID | Result | Evidence |
|---|---|---|
| SW-01 | In-flight audit repairs (BR-007, BR-008, BR-010, with tests) committed on `audit/repair-2026-11` as `9e918f7c`, a checkpoint only, with test suites not re-run. Tagged `v3-fastapi-final`. The generated `.archify/*` and `.coverage` changes were left uncommitted. No other Claude session was running. | `git log -1 v3-fastapi-final` |
| SW-00 | ADR-27 added to `DECISIONS.md` (ADR-15 and ADR-16 marked superseded); Mission and Architecture in `AGENTS.md`; Stack, Runtime, Key Decisions and footer in `.planning/PROJECT.md`. | diff on branch `switch/node-lan` |
| SW-02 | Branch `switch/node-lan` created from the checkpoint. Source copied to `hms/` without `data/` (live DB, keys, backup) or `node_modules/`; screenshots in `hms/docs/shots/`. No child processes, eval or outbound URLs in the source; all 100 lockfile packages come from registry.npmjs.org. Node 26.13.0 was already installed. better-sqlite3 12.9.0 failed to install (no Node 26 prebuild, no C++ toolchain), so it was moved to **13.0.3** (prebuilt; tested in a scratch folder first) and `engines.node` raised to `>=22.0.0`. | `npm test` → 54/54 pass |
| SW-03 | Default settings now use the v3 address (Hospital Road, Ara, Bhojpur, Bihar - 802301) and the tagline "Physiotherapy Department · Sri Vashishtha Kalyan Trust"; phone, e-mail and registration number are blank, and the OPD fee default is 0. The built-in price list (lab, imaging, in-patient) is removed, so fresh installs start empty. The demo seed now uses synthetic Bhojpur patients, two physiotherapists and one eye doctor, physio/eye clinical text and a demo-only price list, with no nurse account, and visits follow their doctor's department. Patient form defaults to Bihar. Test fixtures and hms docs updated. New test: a fresh install has an empty catalogue. | `npm test` → 55/55 pass; seed run into a temp folder: 42 patients all in Bihar, 0 visits in the wrong department, roles admin 1 / doctor 3 / reception 1 |

**Not done in Phase 0 (by design):** the Nurse role still existed in code (removed in SW-11). MRN, receipt and invoice formats are unchanged (SW-20, SW-27). Committed as `b770c9fc` after the owner's go-ahead.
**Remaining risks:** the server PC must run Node 22 or newer (26 recommended, to match). The `.archify/*` and `.coverage` modifications from another tool are still uncommitted in the working tree.

### Phase 1 (2026-11-09)

Owner confirmed **D1 = no real patient data** (SW-40 resolved, SW-41 dropped, OD-05 resolved).

| ID | Result | Evidence |
|---|---|---|
| SW-10 | Migration runner in `hms/src/db.js`: `schema.sql` is the frozen v1 baseline; numbered files in `hms/src/migrations` run in order, each in its own transaction. A database that holds staff accounts gets an encrypted `pre_upgrade` backup first (recorded on the Backups screen as "Before upgrade"), and the upgrade is audited as `system.upgrade`. A failed step leaves the database at its last good version; a newer database is refused. First migration: `002-phase1-foundations.sql`. | `test/06-upgrades.test.js` 6/6 |
| SW-11 | Roles ported from the v3 matrix: Admin, Reception, Doctor (Nurse refused by trigger; old nurse accounts switched off). Billing split into `invoice.write` and `payment.collect` (Reception only), `payment.reverse` and `billing.catalogue` (Admin). Admin has no clinical, document or patient-write access; Doctors have no billing access. Doctors write only to open visits assigned to them; Admin is never a valid doctor. Visit, chart, timeline, vitals and prescription responses leave out clinical content for Admin and Reception. D-07: 30-minute idle (the admin setting is now actually enforced), lockout after 5 wrong passwords for 15 minutes. | `test/02`, `03`, `04`, `05`, `07` |
| SW-12 | No clinical or financial row can be deleted (DB triggers on notes, diagnoses, prescriptions, vitals, invoices, lines, payments). DELETE routes answer 405. Diagnoses and prescription lines are cancelled with a reason by the visit's doctor; unsigned notes by their author. Cancelled entries stay visible, struck through, and are left off printed prescriptions. Signed notes are locked by trigger. | `test/06`, `07` |
| SW-13 | `version` on patients, visits, appointments, notes, staff accounts and services, bumped by triggers on user-editable columns; one settings version. Every PATCH must send it; stale edits get `409 version_conflict`. The browser shows one "changed by someone else" dialog with Reload. | `test/07`; checked in the browser |
| SW-14 | Settings: Hindi hospital name, trust (EN/HI), location line, main and second clinic addresses (EN/HI, from PROJECT.md), print header/footer (EN/HI), receipt cycle (financial year default, D-05), consultation validity (7 days, v3 default). Per-field validation. Logo upload (PNG/JPEG/WebP, max 512 KB, stored in the database so backups include it) is served publicly for the sign-in page; it appears on the sign-in page and in the sidebar. | `test/07`; checked in the browser |

**Test run:** `npm test` in `hms/` → 7 suites, 78 tests, 0 failures. The 54 original tests were rewritten to use the role that does each job, since Admin no longer registers patients, writes notes or takes money.

**Browser check** (built-in browser, synthetic seed on port 3100):
- Doctor: no Billing menu; can cancel a diagnosis on their own visit through the reason dialog, and the entry shows struck through with name, time and reason; another doctor's open visit is read-only with an explanation.
- Reception: no clinical tabs or vitals; Bill, Edit and Add allergy available; a stale patient edit shows the conflict dialog, and Reload shows the other workstation's change; on invoices, Receive payment but no Void.
- Admin: no register, bill, edit or visit actions; Void but no Receive payment; new settings sections render the Hindi defaults; logo upload updates the sidebar; an invalid setting is flagged, a valid one saves.
- No browser console errors apart from the deliberate 409 and 400.
- Also fixed the doctor greeting ("Dr Verma" instead of "Dr").

**Not covered yet:** printed documents do not use the new header/footer/Hindi settings or the logo (SW-20, SW-25, SW-27 build the prints). Attachments access for Reception awaits D6 (SW-28). Doctor read scope awaits D2. The settings and chart screens were checked in one browser at one size, not on the clinic PCs.

### Session 2026-11-10
- Verified commit `837d615` (Phase 1). Tests then showed 4 failures at 01:40 IST: the app used SQLite 'localtime' (machine clock, returned the previous day before 05:30 IST) while 'today' was computed in JS. Fixed: all 18 date queries and `todayLocal` now use the fixed clinic offset +05:30. 78/78 pass. Fix is **not committed**.
- D2 and D4 answered as above; Phase 2 may start on SW-20.
