# Bug register — Kalyan Hospital v3 (partial audit run)

**Status of this run:** PARTIAL. The discovery workflow hit the usage limit twice. Completed: baseline test run, database audit, queue trace. Partly written to disk but not converted into findings: reception UI inventory and patient trace. Never run: architecture map, API inventories, admin UI inventory, billing / package / prescription / dashboard / security / admin / sync / offline traces, the gap critic, the register agent and the six documentation files. Nothing in this register is a runtime end-to-end result. No code was changed.

**Tree audited:** `refactor/admin-modules-ssot` working tree on 2026-11-09, with uncommitted edits from other sessions and an untracked migration `0020_integrity_runs`.

**Evidence labels**

| Label | Meaning |
|---|---|
| CODE-VERIFIED | I read the cited lines myself in this run. |
| CORROBORATED | Two or more independent agents reported it, with file references. I did not re-read every line. |
| AGENT-REPORTED | One agent reported it with file references. Not verified. |
| TEST-RUN | Result from the baseline agent's test run (not re-run by me). |

---

## 0. Status update (after checkpoint and B1)

- **Checkpoint:** commit `bcd0e511` on `refactor/admin-modules-ssot` holds the in-flight v3 work (74 files). `.coverage`, `.archify`, screenshots, raw assets and `.agents`/`.claude` were left out. Repairs are on branch `audit/repair-2026-11`.
- **B1 done (uncommitted on the branch, pending your review):**
  - **BR-001 fixed:** `encounters.py` rejects an appointment that belongs to another patient (404 `appointment_not_found`); `prescriptions.py` rejects an encounter that belongs to another patient (404 `encounter_not_found`). Tests: `backend/tests/test_patient_linkage.py`.
  - **BR-002 fixed:** `timeline.py` returns encounters and prescriptions to DOCTOR only. For ADMIN and RECEPTION it removes the plan diagnosis and the session VAS and modalities; the session rows stay so attendance still shows. Updated the three tests that asserted the leak (`test_timeline_api.py`, `test_phase15_gate.py`).
  - **Verification run on this tree:** new and related suites 665 passed; full backend 1069 passed, 1 skipped (baseline was 1063 + 1 skipped; the difference is the 6 new tests). Before the fix, 4 of the new tests failed as expected.
- **B1 committed:** `16cb067c` on `audit/repair-2026-11`.
- **BR-010 done (uncommitted):** `timeline.py` writes one `CROSS_DOCTOR_CLINICAL_READ` audit row per timeline read when a doctor reads another doctor's encounters or prescriptions. The row lists the record IDs. Tests: `test_patient_linkage.py` (2 new). Full backend suite: 1071 passed, 1 skipped.
- **B4 done (uncommitted):** registration and token desk.
  - BR-007: a second submit is refused while the saved-patient card is shown, and while a submit is in flight (ref guard covers Enter-key repeats). Submit button disabled while the card is shown.
  - BR-008: photo, visit-booking and walk-in check-in failures are shown as a warning after the patient is saved, not logged to the console. The card says "Checked In" only when check-in succeeded. The token desk shows a warning on the ticket when check-in fails.
  - Tests: `patient-register.test.tsx` (2 new), `token-generation.test.tsx` (1 new). Each new test was run against the checkpoint version of its page and failed there.
  - Frontend: typecheck and lint pass; Vitest 54 files, 291 passed, 5 skipped.
  - Not changed: the form stays filled after a successful save (the second-submit block covers the risk). BR-018 (token desk Rs 400 placeholder) is separate.
- **Sibling gap, not fixed:** `GET /api/patients/{id}/prescriptions` (`prescriptions.py`, `list_patient_prescriptions`) lists other doctors' prescriptions through a bulk query and writes no audit row. Same fix pattern as BR-010; needs a decision whether to add it to this batch.
- **Baseline frontend failures (section 1) no longer reproduce.** The 9 failing tests were in files edited after the baseline run. The full Vitest run on this tree passes: 54 files, 288 passed, 5 skipped. I did not edit those files.
- **Still open:** B2 to B6, and the decisions SC-1 to SC-8. B2 needs your decision on BR-003 and BR-004.

## 1. Baseline (TEST-RUN, by the baseline agent)

| Check | Result |
|---|---|
| Backend `pytest` (PYTHONPATH pinned to `backend/src`, test DB `kalyan_test`, scratch photo/asset/backup dirs) | 1063 passed, 0 failed, 1 skipped (1064 collected). Skipped test `test_spa_serving.py::test_real_build_served` needs `KALYAN_FRONTEND_DIST`; the agent re-ran it against a scratch build and it passed. |
| `npm run typecheck` | PASS |
| `npm run lint` (oxlint) | PASS |
| Scratch `vite build` (outside `frontend/dist`) | PASS |
| `vitest run` | 9 failed, 277 passed, 5 skipped. All 9 failures reproduce when their file runs alone, so they are not load flakes. |

**The 9 Vitest failures** come from uncommitted UI work whose tests were not updated, not from shipped behaviour:
- `app-shell.test.tsx` (2): labels renamed to "Treatment Plans", "Follow-ups", "Dashboard".
- `admin-navigation-architecture.test.tsx` (4): `ManagementOverviewDashboard.tsx` deleted and replaced by untracked `AdminDashboard.tsx`.
- `backup-manager.test.tsx` (3): tab renamed to "Schedule", modal title renamed to "Import Patients".

**Coverage gaps the baseline agent reported:** the new `AdminDashboard` has no passing test; the D-19-03 doctor-specialty sidebar tests were removed, so the reception absence checks now pass vacuously; the headless A4 print checks are skipped unless `PRINT_CHECK=1` and Edge are present.

**Process note:** the branch is red on CI's frontend job until these tests are updated or the labels reverted. This matches F-3 in `docs/AUDIT-2026-11-08.md`.

---

## 2. P0 — patient data linkage and access

### BR-001 (P0, defect) — Encounters and prescriptions can be filed against another patient's appointment or encounter — CODE-VERIFIED
- **Encounter create** `backend/src/kalyan_api/routers/encounters.py:~128-139`: `patient_id` comes from the payload and is checked only for existence. The linked appointment is checked only for `appt.doctor_id == principal.doctor_id`. Nothing compares `appt.patient_id` with `payload.patient_id`. A doctor who owns two patients' appointments can save a note on patient B under patient A's appointment.
- **Prescription create** `backend/src/kalyan_api/routers/prescriptions.py:~117-187`: the encounter is fetched through `get_scoped_or_404` (doctor scope only). The prescription is then written with `patient_id=payload.patient_id` (line 187). No check that `encounter.patient_id == payload.patient_id`. (I confirmed by grep that no such comparison exists in `prescriptions.py`.)
- **Impact:** wrong patient linkage (AGENTS.md invariant 12: clinical records must keep the correct relationships). The record shows in the wrong patient's timeline and prints.
- **Also reported:** encounter-to-appointment link in the queue trace (`ea63…`, P1) — same root cause.
- **Verification test to add:** create appointment for patient A, POST encounter with `patient_id=B` and that appointment → expect 422/404; same for prescription with an encounter of patient A and `patient_id=B`.
- **Owner batch:** B1.

### BR-002 (P0, defect) — Patient timeline sends clinical content to roles that must not see it — CODE-VERIFIED, CORROBORATED
- `backend/src/kalyan_api/routers/timeline.py:96-99` and `:143-146`: for `Role.ADMIN` the encounter and prescription scope is `true()`, so ADMIN receives full clinical content. D-04 says Admin and Reception are denied clinical views; the only Admin exception is the field-selective, justified export under D-20-15, which is not the timeline.
- `timeline.py:219`: session scope is `true()` for `ADMIN` and `RECEPTION`, so Reception receives treatment-session clinical fields (VAS, notes) in the timeline.
- Reported independently: patient trace F-PAT-01 (P0) and F-PAT-02 (P1); reception UI trace F-01 (P0).
- Also: `backend/tests` has a test that codifies F-PAT-01 (F-PAT-23). That test must change with the fix.
- **Decision needed:** confirm that Admin should lose clinical content in the timeline (the repo rule says yes). The fix removes access, so it needs sign-off, not just engineering.
- **Owner batch:** B1.

---

## 3. P1 — core workflows and money

### BR-003 (P1, defect) — Package auto-completed with an unpaid balance can't be paid and drops out of dues — CODE-VERIFIED
- DB trigger `fn_sync_treatment_plan_session_progress` (`migrations/versions/0004_prescriptions_and_treatment_records.py:~325-347`) sets `status='COMPLETED'` when `completed_sessions >= total_sessions`.
- `routers/billing.py:120-124`: payment against a plan requires `status == "ACTIVE"`, otherwise 422 `plan_not_active`.
- `services/billing_service.py:19`: pending dues list only `status == "ACTIVE"` plans.
- **Result:** a fully used package with a balance is neither payable nor listed as due. Money is lost from the collection workflow.
- **Decision needed:** should a completed package remain collectable until its balance is zero? (Business rule; not decided in the repo.)
- **Owner batch:** B2 (after the decision).

### BR-004 (P1, defect) — No overpayment or duplicate guard on appointment (consultation) payments — CODE-VERIFIED
- `routers/billing.py` `record_payment`: the overpayment check exists only for `treatment_plan_id` (step 2). The appointment branch (step 3) checks only that the appointment belongs to the patient. There is no comparison with any consultation fee (`ConsultationFee` exists in models) and no check for an existing payment for the same appointment.
- Repo rule: v2 requirement "rejects … overpayments" (`.planning/PROJECT.md`, Validated section); AGENTS.md invariants 9 and 10.
- **Decision needed:** which fee applies to an appointment (ConsultationFee snapshot at booking, or current fee), and whether a second partial payment for the same appointment is allowed.
- **Owner batch:** B2.

### BR-005 (P1, defect) — Appointment status never moves to IN_CONSULTATION during the consultation — CODE-VERIFIED
- `frontend/src/pages/DoctorDashboard.tsx:15`: "Start consultation" only navigates to `/doctor/encounters/new?…`.
- `frontend/src/pages/ClinicalEncounterWorkspace.tsx:~436-441`: the encounter is created only at finalise (`encounterId === 0`).
- `backend/.../routers/encounters.py:~147-150`: the ARRIVED → IN_CONSULTATION change happens inside encounter creation.
- **Result:** while the doctor is writing notes, reception and the queue still show ARRIVED. Cross-workstation queue state is wrong (AGENTS.md invariant 15).
- **Owner batch:** B3.

### BR-006 (P1, defect) — Duplicate active appointments for the same patient, doctor and date are allowed — CODE-VERIFIED
- `routers/appointments.py:~118-139`: token is generated and an appointment created; no check for an existing non-cancelled appointment with the same `(patient_id, doctor_id, appointment_date)`.
- `models.py:596-597`: only non-unique indexes on `(doctor_id, appointment_date, status)` and `(patient_id, appointment_date)`. No unique constraint.
- Consumes a token and pollutes the queue (AGENTS.md invariant 5 and queue rule: no duplicate active entries for the same visit).
- **Decision needed:** should a second booking for the same doctor-day be blocked, or allowed with an explicit reason? (Repo does not say.)
- **Owner batch:** B3.

### BR-007 (P1, defect) — Registration form can be submitted twice, creating a duplicate patient and URN — CORROBORATED (F-PAT-03, reception F-04)
- After success the form is not cleared and the submit button is re-enabled unless "Save and add another" is ticked (`frontend/src/pages/PatientRegister.tsx:~266-276`). A second submit creates a second patient and URN. Duplicate tokens and payments are the same pattern in the Token Desk and billing (reception F-04).
- **Owner batch:** B4.

### BR-008 (P1, defect) — Registration / token / walk-in arrival failures reported as success — CORROBORATED (F-PAT-08, reception F-03)
- Photo upload, appointment booking and the walk-in ARRIVED change are fired without awaiting their result, and their errors are swallowed. The success card still says "Checked In (Arrived)" (`PatientRegister.tsx:~251-260, 378`). AGENTS.md "never report success when the server has not confirmed it."
- **Owner batch:** B4.

### BR-009 (P1, defect) — Reception pages go stale after mutations; "live" labels are false — CORROBORATED (reception F-07, F-PAT-11, queue trace)
- `frontend/src/api/queries.ts:~107-114` (`staleTime` 60 s) and `~194` (overview never invalidated) and `~773` (queue screens not polling). The UI says it syncs every 10 s; it does not.
- Affects dashboard counts, timeline, queue, after registration, booking, status change and clinical changes.
- **Owner batch:** B5 (frontend state, after backend fixes).

### BR-010 (P1, defect) — Cross-doctor clinical reads through the timeline are not audited — CORROBORATED (F-PAT-04)
- Timeline reads of other doctors' encounters are not written to the audit log (DWS-04 requires it).
- **Owner batch:** B1 (same file as BR-002).

### BR-011 (P1, defect) — Patient "Change" and "Checkout Next Patient" can't clear a patient set in the URL — AGENT-REPORTED (reception F-06)
- With `?patient_id` in the URL the reset does not clear the patient. Frontend only.
- **Owner batch:** B5.

### BR-012 (P1, defect) — Follow-up booking bypasses department and active-doctor rules — AGENT-REPORTED (queue trace, `routers/follow_up.py:~337`)
- Reach: a follow-up booking can target an inactive department or doctor, against ADR-23/24/25. Needs a backend check before a fix.
- **Owner batch:** B3.

---

## 4. P2 — defects and drift

| ID | Title | Evidence | Status |
|---|---|---|---|
| BR-013 | IN_CONSULTATION → CANCELLED is allowed (cancelling a patient mid-consultation) | CODE-VERIFIED: `services/appointment_service.py`, `ALLOWED_TRANSITIONS[IN_CONSULTATION]` = {DONE, CANCELLED} | Decision: should cancel be allowed mid-consultation? |
| BR-014 | Same-status PATCH accepted; cancellation reason can be overwritten | AGENT-REPORTED queue trace (`appointment_service.py:35`, `appointments.py:289`) | Verify before fix |
| BR-015 | Encounter-driven status changes and follow-up bookings write no appointment audit row | AGENT-REPORTED (`encounters.py:159, 469`) | Verify |
| BR-016 | Doctor queue counts CANCELLED / NO_SHOW as completed consultations | AGENT-REPORTED (`appointments.py:375`, `DoctorDashboard.tsx:197`) | Verify |
| BR-017 | Reception queue screens not live; overview never invalidated (merged with BR-009) | see BR-009 | — |
| BR-018 | Token Desk shows a hard-coded Rs 400 service and promises a charge that is never created | CORROBORATED: queue trace (`TokenGenerationPage.tsx:515-527`), reception F-10 (placeholder) | Placeholder — needs decision on what the field should do |
| BR-019 | No date validation on booking and status transitions | AGENT-REPORTED (`schemas/appointments.py:16`) | Verify |
| BR-020 | Billing checkout drops the appointment link the API supports | AGENT-REPORTED (reception F-05) | Verify |
| BR-021 | Receipt reprints are never audited | AGENT-REPORTED (reception F-08) | Verify |
| BR-022 | Photo replacement deletes the old file before commit | AGENT-REPORTED (F-PAT-07; patient trace `photo_service`) | Verify; if confirmed, data-loss-adjacent — consider P1 |
| BR-023 | "Today's Receipts" ledger returns 403 for Reception and the page shows a false empty state | AGENT-REPORTED (reception F-02) | Verify |
| BR-024 | Dashboard hard-codes Physiotherapy in a multi-department hospital | AGENT-REPORTED (reception F-11) | Verify |
| BR-025 | Appointment status errors are hidden or mislabelled; No-Show is a one-click terminal action | AGENT-REPORTED (reception F-13); see also BR-026 | Verify |
| BR-026 | Appointments page shows every error as a version conflict | AGENT-REPORTED (queue trace, `AppointmentsReception.tsx:308`) | Verify (P3 per agent) |
| BR-027 | Clearing DOB, emergency contact or notes on edit is silently ignored | AGENT-REPORTED (F-PAT-06) | Verify |
| BR-028 | Mobile and DOB validation gaps; front and back ends differ (accepts < 10 digits) | CODE-VERIFIED in part by patient trace (`schemas/patients.py:139-155`) | Verify fully |
| BR-029 | Patient directory has no pagination (20 rows max) | AGENT-REPORTED (F-PAT-10) | Missing feature |
| BR-030 | Admin "Change History" tab always empty (entity_type case mismatch `audit.py:51-52`) | AGENT-REPORTED (F-PAT-05) | Verify |
| BR-031 | Finalisation tamper triggers bypassable by setting `is_finalised` back to false; child rows can be re-parented | AGENT-REPORTED (database audit; `0012:253`, `0004:285`) | Verify — relevant to ADR-19 |
| BR-032 | Addenda, authorised prescriptions and URN lack DB-level immutability; runtime role has UPDATE / DELETE | AGENT-REPORTED (database audit; `0003:267`, `0004:363`) | Verify — relevant to ADR-19 |
| BR-033 | Payment reversal is an in-place flag, not a contra-record | AGENT-REPORTED (database audit as doc_drift; `PROJECT.md:101`, `11-ENTRY-GATE.md:27`, EG-9 / D-06) | Decision: is the in-place flag plus reason acceptable under ADR-19, or must a contra row be written? |
| BR-034 | Runtime role `kalyan_app` over-granted DELETE on clinical and financial tables (rated P3 by agent) | AGENT-REPORTED (`0012:325`, `backup_service.py:295`) | Raise to P2 after verification; bears on ADR-19 |

### BR-048 (P1, security) — Backup bundles are unencrypted patient data — CODE-VERIFIED
- `backend/src/kalyan_api/services/backup_service.py:519`: `tarfile.open(final_archive_path, "w:gz")`. Each bundle holds the full SQL dump and every patient photo in plain text, and is copied to a second drive or approved destination.
- A lost or stolen drive, or any LAN user with read access to the backup folder, can read all patient records.
- Same finding as F-4 in `docs/AUDIT-2026-11-08.md`, which is still open.
- **Decision needed:** encryption at rest (for example a passphrase held by the admin), or BitLocker on the backup volume as a recorded acceptance gate (ADR-21).
- **Owner batch:** B6 (or a separate security batch, after the decision).

## 5. P3 — minor / hygiene (AGENT-REPORTED, not verified)

BR-035 Session-progress trigger counts non-finalised inserts (database audit). BR-036 `appointments.status` and import status columns have no CHECK constraint. BR-037 Missing indexes for dashboard date-range queries; some redundant indexes (`areas.py:304`, `patients.py:166`). BR-038 Migration hygiene: model/migration drift, broken 0013 downgrade, revision gap 0008–0010 (I confirmed the chain jumps 0007 → 0011 in the file listing). BR-039 Token number format inconsistent; preview is a client estimate. BR-040 Booking does not lock the doctor row; deactivation or membership removal can race. BR-041 Deactivated doctor's existing appointments vanish from per-doctor views but stay actionable. BR-042 Registration offers no "Other" gender (F-PAT-16, reception F-12). BR-043 Registration photo preview blocked by CSP; no photo add or replace for existing patients (F-PAT-15, reception F-09; `PhotoUploader.tsx` is used only by its test). BR-044 Visit complaint written into the permanent patient notes (F-PAT-17). BR-045 Inactive patients: timeline returns 404, duplicate probe skips them (F-PAT-18). BR-046 Timeline dates appointments and sessions by `created_at` (F-PAT-19). BR-047 Buttons shown to roles the backend will refuse (reception F-14).

## 6. Test gaps (AGENT-REPORTED)

- No test for IST year rollover in URN allocation, or rollback without a gap (F-PAT-22, P2).
- Registration failure paths and timeline role leaks untested; one test codifies F-PAT-01 (F-PAT-23).
- Untested queue behaviours: `test_appointment_status.py`, `test_appointment_booking.py` (queue trace, P2).
- New `AdminDashboard` has no passing test; reception absence checks pass vacuously (baseline).

## 7. Spec conflicts — decisions needed (not defects until decided)

| ID | Topic | Generic spec / AGENTS.md says | Repo does | Decision |
|---|---|---|---|---|
| SC-1 | Visit container | AGENTS invariants 2, 3, 5: one visit can hold several doctor consultations; queue entries belong to a visit | No visit entity. Appointment is the unit; one appointment per doctor per day (BR-006 applies) | Adopt a visit model, or accept the appointment model and record it (ADR-23 suggests appointment-centred) |
| SC-2 | Charges and invoices | AGENTS invariants 8, 9: charges accumulate per visit; one invoice, many payments | Payments link to a plan or appointment; no charge or invoice records; balance derived from plan price only | Decide whether charge/invoice records are required |
| SC-3 | Doctor transfer | REC-08 / generic WF-007 | Not implemented | Confirm it is out of scope |
| SC-4 | Appointment write roles | Spec v1.2 vs code vs DWS-08 vs D-03 disagree | `permissions.py:155` vs `tests/support/matrix.py:964` | Decide the matrix |
| SC-5 | Doctor record visibility | EG-6 silo (locked) vs "read all, edit own" (OD-02, pending) | Silo in code; patient trace F-PAT-12 | Sign-off needed before any change |
| SC-6 | Reschedule, time slots, separate check-in / waiting | Generic spec | Absent (`models.py:553`, `appointments.py:344`) | Confirm scope |
| SC-7 | URN gap-free promise | ADR-20 / code comments | OD-12 still Pending (F-PAT-21) | Decide gap semantics |
| SC-8 | Payment reversal form | ADR-19 contra-record | In-place flag (BR-033) | Decide |
| SC-9 | Timeline clinical access for Admin | D-04 denies Admin clinical views | Admin sees full encounter content (BR-002) | Confirm the rule (repo rule says deny) |

---

## 8. Proposed repair batches (NOT STARTED — need your approval)

Each batch has one owner and a disjoint file set. Batches are ordered by the dependency rules in `AGENTS.md`.

| Batch | Covers | Files (main) | Blocked on |
|---|---|---|---|
| **B1** Backend linkage and access (P0) | BR-001, BR-002, BR-010 | `routers/encounters.py`, `routers/prescriptions.py`, `routers/timeline.py`, `tests/test_timeline_api.py`, new tests | SC-9 (Admin timeline access) |
| **B2** Billing integrity (P1) | BR-003, BR-004 | `routers/billing.py`, `services/billing_service.py`, migration if needed, billing tests | Decisions on completed-package collection and fee rule |
| **B3** Queue and booking (P1) | BR-005, BR-006, BR-012, BR-013, BR-016 | `routers/appointments.py`, `services/appointment_service.py`, `routers/follow_up.py`, `routers/encounters.py` (status step only), `DoctorDashboard.tsx`, `ClinicalEncounterWorkspace.tsx` | BR-006 rule decision; SC-1 |
| **B4** Registration false success and double submit (P1) | BR-007, BR-008, BR-022, BR-027 | `PatientRegister.tsx`, `TokenGenerationPage.tsx`, `routers/patients.py` photo path | — |
| **B5** Frontend state sync (P1–P2) | BR-009, BR-011, BR-014/015 (UI side), BR-020, BR-021, BR-023, BR-024 | `api/queries.ts`, reception pages | After B1–B4 (they change the data) |
| **B6** DB immutability and grants (P2) | BR-031, BR-032, BR-034 | new migration, `0012`/`0004` trigger review | ADR-19 decision; user approval (shared schema) |
| **B7** Test repair (in-flight branch) | Nine Vitest failures in section 1 | `app-shell.test.tsx`, `admin-navigation-architecture.test.tsx`, `backup-manager.test.tsx` | Whoever owns the in-flight UI work (label renames) |

## 9. Before any repair starts

1. **Git checkpoint.** `AGENTS.md` requires one before every repair batch. The tree has about 67 modified or staged files from other work plus an untracked migration. A checkpoint commit would sweep all of them in. Say whether to commit everything, commit only the batch's files, or create a branch first.
2. **Shared schema.** B6 touches the migration chain and needs your approval.
3. **Decisions** SC-1, SC-2, SC-9 and the two money questions in BR-003 and BR-004 change business behaviour, so they need you, not me.
4. **Finish the audit?** The remaining work (API inventories, admin UI, billing/package/prescription/dashboard/security/admin/sync/offline traces, gap critic, docs) was not run. It is about the same token cost as the run that just failed twice. I recommend running it as smaller batches after the repairs for P0/P1 are done, rather than all at once.

## 10. Files

- This register: `docs/system-audit/BUG_REGISTER.md`
- Baseline test report: `docs/system-audit/_parts/baseline.md`
- Database audit: `docs/system-audit/_parts/database.md`
- Reception UI inventory: `docs/system-audit/_parts/ui-inventory-reception.md`
- Patient trace: `docs/system-audit/_parts/workflow-wf-patient.md`
- Queue trace: `docs/system-audit/_parts/workflow-wf-queue.md`
