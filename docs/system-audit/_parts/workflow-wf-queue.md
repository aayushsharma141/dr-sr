# Workflow audit part: Appointments, walk-ins, tokens and doctor-wise queues (WF-003, WF-004, WF-005)

Audit date: 2026-11-09. Read-only audit of files as they are on disk (uncommitted edits included).
No backend tests, DB, server or frontend build were run. Evidence is code reading, with file:line citations.

Uncommitted-work notes for scoped files (`git diff`): `AppointmentsReception.tsx`, `DoctorDashboard.tsx`,
`TokenGenerationPage.tsx` (heading/label text only), `api/specialty.ts` (`useAppointmentDepartmentId` became
`useBookedAppointment`, consistent with its single caller), `ClinicalEncounterWorkspace.tsx` (keyed wrapper, token
header), `routers/areas.py` (large refactor; the `_doctors_today` lines cited below are unchanged by it). None of
the findings below depends on a half-finished edit. The encounter-created-only-at-finalise behaviour (Q-01) is
also in `HEAD`, not just the working copy.

## 0. Real model (verified)

| Concept | Repo entity | Evidence |
|---|---|---|
| Visit / queue entry | `Appointment` (one patient, one doctor, one date, one token) | models.py:585-643 |
| Status | `AppointmentStatus` BOOKED, ARRIVED, IN_CONSULTATION, DONE, CANCELLED, NO_SHOW | models.py:553-561 |
| Token counter | `DailyTokenSequence` PK (doctor_id, appointment_date), `last_token` | models.py:564-582 |
| Token uniqueness | `uq_appointments_doctor_date_token` (doctor_id, appointment_date, token_number) | models.py:590-595 |
| Department | `Department` (`is_active`, `version_id`) | models.py:80-112 |
| Membership | `doctor_departments` (doctor CASCADE, department RESTRICT); `appointments.department_id` nullable FK | migration 0019:62-87 |
| Per-transition timestamps | only `status_updated_at` (overwritten each change) and `check_in_at` (set once on ARRIVED) | models.py:617-620, appointments.py:286-288 |
| Optimistic lock | `version_id` + `version_id_col` mapper; `require_version` -> 409; `StaleDataError` -> 409 | appointments.py:281, core/errors.py:27-31, 87-90 |

There is no visit container, no invoice/charge entity tied to an appointment, no reschedule endpoint, no transfer
endpoint, no time slot. Status mapping to the generic spec: SCHEDULED = BOOKED; CHECKED-IN and WAITING = ARRIVED
(collapsed); IN CONSULTATION = IN_CONSULTATION; COMPLETED = DONE; plus CANCELLED and NO_SHOW (terminal).

Server transition matrix (appointment_service.py:7-26, 29-80):

| From \ To | ARRIVED | IN_CONSULTATION | DONE | CANCELLED | NO_SHOW |
|---|---|---|---|---|---|
| BOOKED | any APPOINTMENT_WRITE | - (but encounter create jumps it, encounters.py:157-160) | - | any WRITE + reason | any WRITE |
| ARRIVED | - | DOCTOR, own appt | - | any WRITE + reason | any WRITE |
| IN_CONSULTATION | - | - | DOCTOR, own appt | any WRITE + reason (Q-07) | - |
| DONE / CANCELLED / NO_SHOW | terminal | terminal | terminal | terminal | terminal |
| same -> same | allowed no-op that still bumps version, timestamp, audit, reason (Q-08) | | | | |

APPOINTMENT_WRITE = RECEPTION and DOCTOR (permissions.py:139-140, 154-155). ADMIN has APPOINTMENT_READ only (permissions.py:107). DOCTOR PATCH on another doctor's appointment returns 404 (appointments.py:270-279).

---

## WF-003 — Appointment booking (department -> doctor -> date -> token)

Starting actor: RECEPTION (Token Desk, Patient Registration) or DOCTOR (consultation workspace "Book now").
Preconditions: active patient; active department; active doctor assigned to that department; user holds `appointment:write`.

| step | UI file:line | hook (api/queries.ts) | endpoint | backend function | tables read/written | side effects | UI refresh | status |
|---|---|---|---|---|---|---|---|---|
| 1 Load active departments | TokenGenerationPage.tsx:58; AppointmentBookingModal.tsx:31; PatientRegister.tsx:86 | `useDepartments` :545-550 | GET /api/departments | departments.py:46-50 (active only) | R departments | - | staleTime 60 s | OK-by-code |
| 2 Pick department -> load its active doctors | TokenGenerationPage.tsx:59-61, 426-427; AppointmentBookingModal.tsx:32, 191-194 | `useDepartmentDoctors` :570-576 | GET /api/departments/{id}/doctors | departments.py:138-163 (404 if dept inactive; active doctors only) | R departments, doctor_departments, doctors | - | doctor reset on dept change | OK-by-code |
| 3 Choose date | Token Desk: fixed `istToday()` TokenGenerationPage.tsx:134 (visitType "appointment" still today); Modal: free `<input type=date>` no min/max AppointmentBookingModal.tsx:235-242 | - | - | - | - | - | - | BROKEN Q-14 (past dates); Token Desk cannot book a future date (MISSING advance booking from reception UI) |
| 4 Submit | TokenGenerationPage.tsx:114-136 (button disabled while pending :598); AppointmentBookingModal.tsx:43-67 (:270); PatientRegister.tsx:242-248 | `useBookAppointment` :788-801 | POST /api/appointments | appointments.py:80-165 `book_appointment` | R patients, doctors (no lock), departments FOR UPDATE, doctor_departments | - | - | OK for dept checks; BROKEN Q-02 (no duplicate check), Q-17 (doctor not locked) |
| 5 Token allocation | - | - | (same tx) | token_service.py:18-48 | UPSERT ON CONFLICT DO NOTHING + SELECT ... FOR UPDATE + UPDATE daily_token_sequences | monotonic per (doctor,date); rollback reverts increment, so no burned-but-unused numbers; unique constraint backstop | - | OK-by-code (test_token_concurrency.py:22) |
| 6 Insert appointment | - | - | (same tx) | appointments.py:133-144 | W appointments (status BOOKED, department_id, created_by) | - | - | OK-by-code |
| 7 Audit | - | - | (same tx) | appointments.py:147-163 | W audit_logs APPOINTMENT_CREATED | - | - | OK-by-code |
| 8 Commit/response | - | - | 201 AppointmentRead | db/session.py:42-52 commit before response | - | - | invalidates `['appointments']`, `['doctor-queue']`; NOT `['overview','reception']` | BROKEN Q-04 (overview stale; other workstations never notified) |
| 9 Show token | TokenGenerationPage.tsx:152-159, 228-234 "#N"; Modal success screen :94-120 is never seen because caller closes it in `onSuccess` ClinicalEncounterWorkspace.tsx:1469-1472 | - | - | - | - | - | - | BROKEN Q-16 (prefix/format mismatch) |

Alternative booking path, follow-up recommendation: POST /api/follow-ups/{id}/book (follow_up.py:304-375): token via
token_service, appointment inserted with `department_id` omitted (NULL), no patient/doctor/department active or
membership checks, audit is FOLLOW_UP_BOOKED on the recommendation, not APPOINTMENT_CREATED. No frontend caller
exists (grep of `follow-ups` in frontend/src finds only `/prescriptions/follow-ups`). Status: BROKEN Q-10, Q-11.

Dependent modules: doctor queue (`/doctor/queue`, polled 10 s) - updated within 10 s; reception boards (`useAppointments`) - only on the booking workstation (Q-04); reception overview KPIs / per-doctor panel (`/reception/overview`) - stale (Q-04); patient timeline (timeline.py:81-88 reads appointments) - read on demand; billing - no charge is created (Q-13); follow-up recommendation - not linked when booked from the doctor UI (Q-11).

Failure scenarios:
- Invalid input: patient missing/inactive 404 (appointments.py:89-95); doctor missing/inactive 404 (:98-104); dept missing 422, inactive 422, doctor not member 422 (:107-125). Shown as text in Token Desk (`errorMsg`) and modal; PatientRegister swallows it (Q-05).
- Duplicate submit: buttons disabled while pending (TokenGenerationPage.tsx:598, AppointmentBookingModal.tsx:270); but two workstations, or a second click after success, create a second active appointment for the same patient/doctor/day (Q-02).
- Permission denied: ADMIN 403 (matrix.py:962-972). DOCTOR allowed for any doctor/department (Q-12).
- 409: not applicable to create. Concurrent token requests serialize on the sequence row lock; department deactivation serializes on the department row lock (test_department_workflow.py:123-162). Doctor deactivation does not (Q-17).
- Server down: mutation rejects -> error banner; nothing persisted (single transaction).

---

## WF-004 — Walk-in token (same-day intake, auto check-in)

Starting actor: RECEPTION. Preconditions as WF-003; date forced to IST today.

| step | UI file:line | hook | endpoint | backend function | tables | side effects | UI refresh | status |
|---|---|---|---|---|---|---|---|---|
| 1 Select existing patient | TokenGenerationPage.tsx:98-101, 326-345 | `usePatients` | GET /api/patients | patients router | R patients | - | - | OK-by-code |
| 1b New patient | TokenGenerationPage.tsx:291-297 navigates to PatientRegister; PatientRegister.tsx:222-263 registers then books | `useRegisterPatient`, `useBookAppointment`, `useUpdateAppointmentStatus` | POST /api/patients, POST /api/appointments, PATCH /status | patients + appointments | W patients, urn_sequence, appointments, daily_token_sequences, audit_logs | 3 separate transactions | - | BROKEN Q-05 |
| 2 Dept/doctor/visit type | TokenGenerationPage.tsx:420-497 | as WF-003 | - | - | - | - | - | OK-by-code |
| 3 "Consultation / Service" select, fee shown | TokenGenerationPage.tsx:43, 503-528 | `useFees` | GET /api/fees | - | R consultation_fees | value never sent; no charge written | - | BROKEN Q-13 |
| 4 Book | TokenGenerationPage.tsx:129-136 | `useBookAppointment` | POST /api/appointments | WF-003 steps 4-8 | as WF-003 | APPOINTMENT_CREATED | invalidates appointments, doctor-queue | OK-by-code (tx 1) |
| 5 Auto check-in | TokenGenerationPage.tsx:138-150 | `useUpdateAppointmentStatus` :803-817 | PATCH /api/appointments/{id}/status {ARRIVED, version_id} | appointments.py:253-306 | W appointments (status, status_updated_at, check_in_at, version_id) | APPOINTMENT_STATUS_UPDATED audit | setQueryData + invalidate | BROKEN Q-05 (separate tx; failure only `console.warn`) |
| 6 Success banner "placed in queue" | TokenGenerationPage.tsx:152-159, 218-224 | - | - | - | - | - | - | BROKEN Q-05 (shown even when step 5 failed) |
| 7 Preview of next token | TokenGenerationPage.tsx:72-86 (`list.length + 1`), QueueTicketPreview.tsx:40-53 | `useAppointments` | GET /api/appointments?appointment_date&doctor_id | appointments.py:173-211 | R appointments | - | staleTime 60 s, no polling | BROKEN Q-16 (estimate; counts all doctors when none selected) |

Dependent modules: doctor queue sees the patient in "Scheduled Bookings" instead of "Waiting Room" if step 5 failed (appointments.py:369-374); reception "Booked not checked in" alert (areas.py:759-776).

Failure scenarios: duplicate click blocked only while `bookMutation.isPending` (not while the PATCH is pending, TokenGenerationPage.tsx:598); invalid/inactive selection -> 404/422 message; a 409 on step 5 (another workstation touched the row) is swallowed; server down between steps 4 and 5 leaves a BOOKED row that the UI reports as checked in.

---

## WF-005 — Queue status lifecycle and doctor-wise queues

Starting actors: RECEPTION (check-in, cancel, no-show), DOCTOR (start consultation, finish), any screen viewing the queue.
Preconditions: appointment exists; caller has `appointment:write`; doctor acts only on own appointments.

| step | UI file:line | hook | endpoint | backend function | tables | side effects | UI refresh | status |
|---|---|---|---|---|---|---|---|---|
| 1 Reception queue board | ReceptionDashboard.tsx:47-55; AppointmentsReception.tsx:197-207 | `useAppointments` :759-777, `useOverview` :194-202 | GET /api/appointments?appointment_date=today; GET /api/reception/overview | appointments.py:173-211; areas.py:237-290 | R appointments, patients, doctors | - | no refetchInterval; staleTime 60 s; UI claims "10s live queue sync" (ReceptionDashboard.tsx:224) | BROKEN Q-04 |
| 2 Check in (BOOKED->ARRIVED) | ReceptionDashboard.tsx:150-167, 723-731; AppointmentsReception.tsx:565-573 | `useUpdateAppointmentStatus` | PATCH /api/appointments/{id}/status | appointments.py:253-306 + appointment_service.py:29-80 | W appointments (status, status_updated_at, check_in_at once, version_id+1) | audit APPOINTMENT_STATUS_UPDATED before/after status+version | local invalidate appointments + doctor-queue; overview not invalidated | OK-by-code server; BROKEN Q-04 for other screens; no date guard Q-14 |
| 3 Doctor queue | DoctorDashboard.tsx:11, 56-215 | `useDoctorQueue` :819-825 (refetchInterval 10 s) | GET /api/doctor/queue (alias /api/appointments/queue/today) | appointments.py:309-389 | R appointments for principal.doctor_id, IST today, token asc | - | polls 10 s | OK-by-code for own-queue scoping (403 for non-doctors, :324-329); BROKEN Q-06 (bucketing) |
| 4 Start consultation (ARRIVED->IN_CONSULTATION) | DoctorDashboard.tsx:14-16, 149-154 navigate only | - | none | - | - | - | - | BROKEN Q-01 (no status change at start) |
| 5 Draft autosave | ClinicalEncounterWorkspace.tsx:233-234 returns when `encounterId === 0` | `useSaveEncounterDraft` | PATCH /api/encounters/{id} (never for a new consultation) | - | - | - | - | BROKEN Q-01 |
| 6 Finalise = create encounter then finalise | ClinicalEncounterWorkspace.tsx:432-447 | `useCreateEncounter` :857-866, `useFinaliseEncounter` :884-896 | POST /api/encounters then POST /api/encounters/{id}/finalise | encounters.py:117-211 (BOOKED/ARRIVED -> IN_CONSULTATION, :157-160), then finalise :463-471 (IN_CONSULTATION -> DONE) | W clinical_encounters, appointments (2 tx) | encounter audits only; no appointment audit (Q-09); no patient match check (Q-03) | invalidates doctor-queue, appointments, unfinished-encounters | BROKEN Q-01, Q-03, Q-09 |
| 7 Manual DONE via PATCH | no UI | - | PATCH status DONE | appointment_service.py:56-69 doctor-only | W appointments | audit | - | OK-by-code (DONE possible without any encounter; no UI exposes it) |
| 8 Cancel with reason | ReceptionDashboard.tsx:169-190, 755-766; AppointmentsReception.tsx:574-581, 618-662 | `useUpdateAppointmentStatus` | PATCH status CANCELLED + reason | appointment_service.py:46-54 | W appointments (+cancellation_reason) | audit with reason | as step 2 | OK-by-code for BOOKED/ARRIVED; BROKEN Q-07 (IN_CONSULTATION cancellable), Q-08 (reason overwrite) |
| 9 No-show | AppointmentsReception.tsx:582-587 (no confirmation, not disabled while pending) | same | PATCH status NO_SHOW | same | W appointments | audit (no reason required) | as step 2 | OK-by-code; ReceptionDashboard has no No-show action |
| 10 Token permanence (ADR-26) | - | - | - | token_service.py never decrements; no DELETE route for appointments | daily_token_sequences | CANCELLED/NO_SHOW keep their token_number | - | OK-by-code |
| 11 Hand-off to billing | AppointmentsReception.tsx:593-603; ReceptionDashboard.tsx:734-741 (DONE only) | - | link | - | - | - | - | BROKEN by Q-01 when DONE is never reached (cancelled/no-show mid-consultation) |

Queue ordering: doctor queue and reception list order by `token_number` asc (appointments.py:205, 344); waiting is token order, not arrival order. This matches reception spec v1.2 §3 step 4 while §6.2 lists the ordering policy as still open (see Q-19).

Counters: reception page counters are computed client-side from the date list (AppointmentsReception.tsx:251-255, "Total Booked" includes cancelled/no-show); ReceptionDashboard KPIs mix client list counts with server overview (ReceptionDashboard.tsx:91-166, 791-803); doctor counters come from server buckets (Q-06).

Dependent modules: reception overview alerts `queue_delay_30m` (areas.py:739-756) measure from `status_updated_at`, so a same-status PATCH resets the timer (Q-08) and patients in consultation look "delayed" (Q-01); admin dashboard status chips (components/admin/AdminDashboard.tsx:481); timeline (timeline.py:81-88); billing link (DONE only).

Failure scenarios:
- Invalid transition: 422 `invalid_status_transition` with allowed list (appointment_service.py:26-43). AppointmentsReception shows it as "Record was modified by another user" (Q-15); ReceptionDashboard shows the real message (ReceptionDashboard.tsx:262-268).
- Permission: reception -> IN_CONSULTATION/DONE 403 `doctor_status_forbidden`; doctor on another doctor's appointment 404 (appointments.py:270-279).
- 409: stale `version_id` -> VersionConflict 409 (core/errors.py:27-31); concurrent flush -> StaleDataError 409 (core/errors.py:87-90). Double-click on two workstations: second gets 409. Covered by test_appointment_status.py:178.
- Two patients IN_CONSULTATION for one doctor: not prevented; the doctor banner renders a list (DoctorDashboard.tsx:56-95). No repo rule found, so not raised as a finding.
- Server down: the doctor queue keeps the last data and shows an error only on first load (`isError` branch DoctorDashboard.tsx:49-52); background refetch errors are silent.

---

## Findings

### Q-01 (P1, defect) IN_CONSULTATION is never persisted during a consultation; the appointment jumps to DONE only at finalise
- `DoctorDashboard.tsx:14-16` "Start Consultation" only navigates to `/doctor/encounters/new?...`.
- `ClinicalEncounterWorkspace.tsx:233-234` `performAutoSave` returns while `encounterId === 0`, and `:432-447` creates the encounter only inside `handleFinaliseConsultation`, immediately followed by finalise. The only `useCreateEncounter` caller is this file (`:176`). Same logic in `HEAD` (lines 225, 426).
- Server side, `encounters.py:157-160` moves BOOKED/ARRIVED to IN_CONSULTATION on create and `:466-471` moves IN_CONSULTATION to DONE on finalise, so both happen within seconds at the end.
- Consequences: during the whole consultation the patient stays ARRIVED (doctor "Waiting Room", reception "Waiting", `queue_delay_30m` alert); the "Currently In Consultation" banner and "Resume Clinical Notes" are unreachable in normal use; reception sees Cancel / No-Show for the ARRIVED row (AppointmentsReception.tsx:574-588; ReceptionDashboard.tsx:755-766). If reception cancels or marks no-show while the doctor is consulting, create_encounter leaves the status as it is (`:158` only advances BOOKED/ARRIVED), finalise does not set DONE (`:468`), the encounter is linked to a CANCELLED/NO_SHOW appointment, and the "Billing" hand-off (shown only for DONE) never appears. Notes typed in a new consultation are not autosaved to the server.
- Fix: create the encounter (or PATCH IN_CONSULTATION) when the doctor starts the consultation, then let autosave run against it; make create_encounter reject CANCELLED/NO_SHOW/DONE appointments.
- Verify: Vitest for DoctorDashboard/workspace asserting POST /encounters (or PATCH IN_CONSULTATION) fires on start; backend test that encounter create on a CANCELLED appointment returns 409/422.

### Q-02 (P1, defect) Same patient can hold several active appointments with the same doctor on the same day
- Reception spec v1.2 §4 invariant: "A patient cannot have duplicate active appointments (BOOKED, ARRIVED, IN_CONSULTATION) for the same doctor on the same date."
- `book_appointment` (appointments.py:80-165) and `book_follow_up` (follow_up.py:337-353) never check; the table has only the token unique constraint and a non-unique `ix_appointments_patient_date` (models.py:590-597). No frontend guard (TokenGenerationPage.tsx:114-136).
- Repro: reception A and reception B (or one desk clicking "Register Next Patient" and re-submitting) POST /api/appointments for patient P, doctor D, today -> two BOOKED rows, tokens 5 and 6, both in D's queue.
- Fix: partial unique index on (patient_id, doctor_id, appointment_date) WHERE status IN ('BOOKED','ARRIVED','IN_CONSULTATION') plus a 409 `duplicate_active_appointment` in both booking paths.
- Verify: backend test booking twice -> second 409; concurrent test with two threads.

### Q-03 (P1, defect; P0 consequence class) Encounter may be linked to an appointment of a different patient
- `encounters.py:132-145` validates the patient and that the appointment belongs to the doctor, but never that `appt.patient_id == payload.patient_id`. Compare billing.py:148-154, which does check it.
- The workspace takes `patient_id` and `appointment_id` from two independent URL params (ClinicalEncounterWorkspace.tsx:82-87, 99, 436-438). No current UI path produces a mismatch, but any edited URL or client bug stores notes for patient Y against patient X's appointment, flips X's appointment to IN_CONSULTATION/DONE, and the partial unique index (`uq_clinical_encounters_appointment_id`, migration 0011:39-45) then blocks X's real encounter.
- Fix: 422 `appointment_patient_mismatch` when they differ (or derive patient_id from the appointment).
- Verify: backend test POST /encounters with doctor A's appointment for patient X and patient_id Y -> 422.

### Q-04 (P2, defect) Reception queue screens are not live across workstations; overview is never invalidated
- `useAppointments` (queries.ts:759-777) and `useOverview` (:194-202) have no `refetchInterval`; global `staleTime` 60 s (:107-114). ReceptionDashboard.tsx:46 comment says "Live polling ... every 10s ... 30s" and :224 tells staff "10s live queue sync"; :491 "Live data". Spec v1.2 §2 lists reception polling as "Pending (Manual)".
- `useBookAppointment` / `useUpdateAppointmentStatus` / encounter mutations invalidate `['appointments']` and `['doctor-queue']` only (queries.ts:796-799, 811-815, 859-863, 891-895), never `['overview','reception']`; the per-doctor "Live Status" panel and KPIs come from the overview (ReceptionDashboard.tsx:91-94, 791-803) and disagree with the table after any local action.
- Repro: reception PC open on dashboard; doctor finalises -> reception still shows ARRIVED until window refocus after 60 s or manual refresh.
- Fix: refetchInterval (10 s queue, 30 s overview) on the reception hooks and invalidate `['overview']` in the appointment mutations; remove the claim until it is true.
- Verify: Vitest with fake timers asserting a second GET after 10 s; mutation test asserting overview invalidation.

### Q-05 (P2, defect) Walk-in check-in is a separate request whose failure is swallowed and reported as success
- TokenGenerationPage.tsx:138-150 PATCHes ARRIVED after the booking commits; failure -> `console.warn` only; the success banner says the patient "is placed in ... queue" (:152-159, 218-224).
- PatientRegister.tsx:240-263 does the same and additionally swallows booking failures (department inactive, doctor mismatch); :369-379 shows "Checked In (Arrived)" whenever a token exists.
- Result: patient holds a slip but sits in "Scheduled Bookings" (BOOKED) on the doctor screen, or has no appointment at all, with no error on screen.
- Fix: a single server call that books and checks in atomically (e.g. `check_in: true` on POST), or surface the step-2 error and show the real status.
- Verify: Vitest that mocks PATCH 409/500 and asserts an error and no "Checked In" text.

### Q-06 (P2, defect) Doctor queue counts CANCELLED and NO_SHOW as completed consultations
- appointments.py:369-376 puts every status other than IN_CONSULTATION/ARRIVED/BOOKED into `completed`; DoctorDashboard.tsx:192-215 renders "Completed Consultations (N)" with "✓ CANCELLED"/"✓ NO_SHOW".
- Fix: separate `cancelled_no_show` bucket (schema + types.ts:761-770) or filter `completed` to DONE.
- Verify: extend test_appointment_status.py:222 with a cancelled appointment and assert it is not in `completed`.

### Q-07 (P2, defect) Reception can cancel an appointment that is IN_CONSULTATION
- appointment_service.py:19-22 allows IN_CONSULTATION -> CANCELLED for any APPOINTMENT_WRITE role (no doctor-only check, :56). Reception spec v1.2 §4: CANCELLED is "cancelled prior to consultation". The UI does not offer it, but the API accepts it.
- Consequence: an open encounter stays linked to a CANCELLED appointment; finalise does not reach DONE (encounters.py:468).
- Fix: remove the transition or restrict it to the owning doctor with reason (needs owner decision).
- Verify: backend test reception PATCH CANCELLED on IN_CONSULTATION -> 422/403.

### Q-08 (P2, defect) Same-status PATCH is accepted and can overwrite a terminal record's cancellation reason
- appointment_service.py:35-36 returns early when target == current, before the reason and doctor-only checks. appointments.py:284-291 then rewrites `status_updated_at`, bumps version and sets `cancellation_reason` whenever one is supplied (:289-290), for any target status.
- Repro: PATCH a CANCELLED appointment `{status:"CANCELLED", version_id:v, cancellation_reason:"different"}` -> 200, original reason replaced (audit `before` holds only status/version, :301). PATCH `{status:"ARRIVED", cancellation_reason:"x"}` stores a cancellation reason on a live appointment. A same-status PATCH also resets the 30-minute delay clock (areas.py:745).
- Fix: reject same-status updates (409/422) and ignore/reject `cancellation_reason` unless target is CANCELLED; include the old reason in audit `before`.

### Q-09 (P2, defect) Encounter-driven status changes and follow-up bookings write no appointment audit event
- Spec v1.2 §4: "Every status change must record an immutable audit event with actor ID, timestamp, prior state, new state".
- encounters.py:157-160 (-> IN_CONSULTATION) and :466-471 (-> DONE) change the appointment with only ENCOUNTER_CREATED / ENCOUNTER_FINALISED audits on `clinical_encounter`. follow_up.py:362-375 audits FOLLOW_UP_BOOKED on `follow_up_recommendation`; no APPOINTMENT_CREATED row exists for those appointments.
- Fix: emit APPOINTMENT_STATUS_UPDATED / APPOINTMENT_CREATED with entity_type "appointment" in those paths.

### Q-10 (P2, defect) /api/follow-ups/{id}/book bypasses ADR-23/24/25 booking rules
- follow_up.py:304-353: no check that patient is active, recommended doctor is active, or any department is active; `department_id` is not set (NULL), so the consultation template falls back to the doctor's single department or none (ClinicalEncounterWorkspace.tsx:110-114). Any doctor (APPOINTMENT_WRITE) can book any doctor's recommendation. Concurrent double-book is caught by the recommendation's `version_id_col` (models.py:1350, 1361) -> StaleDataError 409.
- Repro: deactivate Dr B; POST /api/follow-ups/{rec for Dr B}/book -> 200, BOOKED appointment and token in an inactive doctor's queue.
- Fix: reuse the WF-003 validation (patient/doctor active, department lock, membership) and require/derive `department_id`.
- Verify: backend test with inactive doctor -> 404/422.

### Q-11 (P2, defect) Doctor "Book now" follow-up bypasses the recommendation; recommendation stays PENDING/overdue
- FollowUpSection "Book now" (ClinicalEncounterWorkspace.tsx:1174) opens the generic AppointmentBookingModal (:1464-1473), which POSTs /api/appointments (AppointmentBookingModal.tsx:61-67) with no recommendation id, no prefilled recommended doctor/date. No frontend code calls /follow-ups/{id}/book. DWS-08 requires the recommendation to be "linked to that appointment" and to stay overdue until booked; it never leaves PENDING, so reception sees it as overdue while an appointment exists.
- Fix: call `/follow-ups/{id}/book` from "Book now" (prefill doctor/date), invalidate appointments + follow-up queries.

### Q-12 (P2, spec_conflict) Appointment write roles: spec v1.2 matrix vs code vs DWS-08 vs D-03
- Reception spec v1.2 §2: Book / Check-in / Cancel = Admin Yes, Reception Yes, Doctor No.
- Code: ADMIN has no APPOINTMENT_WRITE (permissions.py:92-124) -> 403; DOCTOR has it (:154-155) -> 201 on POST for any doctor and department (appointments.py:80-125 has no principal scoping) and 200 on ARRIVED/CANCELLED/NO_SHOW of own appointments. RBAC matrix codifies this (tests/support/matrix.py:962-1009: admin 403, doctor_a/doctor_b 201). `/reception/appointments` is routed to DOCTOR too (router.tsx:243-246) and shows Mark Arrived/Cancel/No-Show because `canManageAppointments` keys on `appointment:write` (AppointmentsReception.tsx:186, 563-588).
- DWS-08 says "Doctor or reception can book" follow-ups; D-03 says doctors manage only their own patients, which a doctor placing patients into another doctor's queue does not obviously satisfy. Needs owner decision; no resolution proposed.

### Q-13 (P2, defect) Token Desk shows a fee selector and promises a visit charge that is never created
- TokenGenerationPage.tsx:43, 503-521: "Consultation / Service" select with a hard-coded "OPD Consultation - ₹400.00" option; `selectedServiceId` is never sent (:130-136). :524-528 states "Consultation charge will be added to the visit billing." No charge entity or call exists (REC-05 is unchecked in REQUIREMENTS.md:96). The ₹400 figure is not from the fee catalogue.
- AGENTS.md invariant 8 ("multiple charges can accumulate within a visit") cannot be met by this flow; see Q-18.
- Fix: remove the selector/banner until REC-05 exists, or wire it to a real charge.

### Q-14 (P2, defect, medium confidence) No date validation on booking or status changes
- `AppointmentCreate.appointment_date` has no bound (schemas/appointments.py:16); book_appointment does not compare with `clock.ist_today()`. The doctor's booking modal date input has no `min` (AppointmentBookingModal.tsx:235-242). AppointmentsReception lets staff browse any date and offers Mark Arrived / No-Show on it (:405-433, 565-588); the server allows ARRIVED/NO_SHOW regardless of date.
- Repro: POST /api/appointments with yesterday's date -> 201, token allocated for a past day; mark a next-week appointment NO_SHOW today -> 200.
- No ADR states a rule; tests book past dates (test_appointment_booking.py:105, matrix.py:219 "2026-11-01"). Needs an owner rule before a fix; flagged because it lets the queue for past days change.

### Q-15 (P3, defect) Appointments page reports every failure as a version conflict
- AppointmentsReception.tsx:240-246 stores `err.message` but :307-314 renders `<ConflictBanner>` without `message`, so ConflictBanner.tsx:14 default "Record was modified by another user" is shown for 403, 422 (invalid transition, reason required) and network errors.
- Fix: pass the message and use ConflictBanner only for 409.

### Q-16 (P3, defect) Token number shown in three different formats; preview is a client-side guess
- Preview: `<first letter of department>-NNN` (TokenGenerationPage.tsx:93-96, QueueTicketPreview.tsx:40-53) with number `list.length + 1` (:81) from a 60 s-stale list that covers all doctors when no doctor is selected (:73-76). Success banner: `#N` (:233). Reception printed slip: hard-coded `P-NNN` for every department (ReceptionDashboard.tsx:1044). Reception per-doctor panel labels the department as `qualification or "Physiotherapy"` (areas.py:287; ReceptionDashboard.tsx:801, 819), not the doctor's real department.
- Two doctors' patients can both hold "P-003" slips; eye patients get "P" slips.

### Q-17 (P3, defect, medium confidence) Doctor deactivation/membership change can race a booking
- book_appointment reads the doctor with `session.get` (appointments.py:98) and its departments without a lock, while update_doctor (doctors.py:106) and assign_doctor_departments (departments.py:193) lock the doctor row. The department path was fixed with `lock_department_for_booking` (appointments.py:37-46); the doctor path was not, so a booking can commit for a doctor deactivated or removed from the department in the same instant.
- Fix: `select(Doctor).where(...).with_for_update()` (or FOR SHARE) in book_appointment; mirror test_department_workflow.py:123.

### Q-18 (P2, spec_conflict) AGENTS.md invariants 3, 5 and 8 vs the appointment-centred model; no doctor transfer
- Invariant 3 ("one visit can have multiple doctor consultations"): no visit entity; an Appointment has exactly one doctor_id (models.py:603-605) and at most one encounter (migration 0011:39-45).
- Invariant 5 ("queue entries belong to the correct visit and doctor"): satisfied for doctor (doctor_id + per-doctor token); "visit" maps to the appointment itself.
- Invariant 8 ("multiple charges ... within a visit"): no charge/invoice-item entity linked to an appointment; Q-13.
- Doctor transfer: no endpoint. The only route is cancel (with reason) + new booking, which takes a new token at the end of the receiving doctor's queue, with no link between the two appointments. REC-08 (REQUIREMENTS.md:100) is unchecked and reception spec v1.2 §6.1 lists transfer policy as open.
- Operational consequence: a referred patient loses queue priority and the two consultations are not tied together for billing or history. No resolution proposed.

### Q-19 (P3, spec_conflict) Generic scheduling features not in the repo model
- No time slots/availability (only a date and a token); no reschedule (cancel + rebook, new token; DWF-03 weekly calendar deferred); CHECKED-IN and WAITING collapsed into ARRIVED; waiting order is token order (appointments.py:344) while spec v1.2 §6.2 leaves token vs arrival order open; no emergency/priority token (§6.3 open).

### Q-20 (P3, defect, medium confidence) A deactivated doctor's existing appointments drop out of per-doctor views but stay actionable
- Deactivation does not touch future BOOKED/ARRIVED rows (doctors.py:122-129). `_doctors_today` lists active doctors only (areas.py:249-253) and the reception doctor filters use `useDoctors(false)` (AppointmentsReception.tsx:197, ReceptionDashboard.tsx:56), so those patients are counted in totals but in no doctor's panel, and reception can still check them in (no doctor-active check in appointments.py:253-306).
- ADR-24/25 cover new appointments and visibility only; handling of existing ones needs an owner decision.

### Q-21 (P2, test_gap) Untested queue behaviour
Existing: lifecycle, invalid transitions, cancel reason, 409, doctor queue (test_appointment_status.py:7-222); booking validations and inactive department (test_appointment_booking.py:6-138); token concurrency (test_token_concurrency.py:22); department deactivation race (test_department_workflow.py:123); follow-up booking (test_follow_up_workflow.py:116-196); RBAC matrix rows (matrix.py:962-1035).
Missing: duplicate active booking (Q-02); encounter/appointment patient mismatch (Q-03); IN_CONSULTATION set when a consultation starts (Q-01); cancelled/no-show bucketing in the doctor queue (Q-06); same-status PATCH and reason overwrite (Q-08); appointment audit rows from encounter paths (Q-09); follow-up booking with inactive doctor / NULL department (Q-10); walk-in check-in failure handling in Token Desk and PatientRegister (Q-05); reception polling/invalidation (Q-04); doctor-lock race (Q-17).

## Covered / not covered
Covered: routers/appointments.py, departments.py, doctors.py, services/appointment_service.py, token_service.py, models (Department, Doctor, User role constraint, AppointmentStatus, DailyTokenSequence, Appointment), migration 0019, schemas/appointments.py, core/permissions.py role map, core/errors.py 409 handling, db/session.py, routers/encounters.py (create/finalise status side effects), routers/follow_up.py (book), routers/areas.py (`_doctors_today`, reception alerts), routers/billing.py appointment check; frontend AppointmentsReception.tsx, TokenGenerationPage.tsx, ReceptionDashboard.tsx, DoctorDashboard.tsx, AppointmentBookingModal.tsx, QueueTicketPreview.tsx, DoctorDashboardUnfinishedCard.tsx, api/specialty.ts, api/queries.ts (appointment/encounter/overview hooks, QueryClient defaults), api/types.ts, PatientRegister.tsx (booking part), ClinicalEncounterWorkspace.tsx (create/autosave/booking modal), router.tsx guards, ConflictBanner.tsx; DECISIONS.md ADR-23..26, REQUIREMENTS.md APT/REC/DWS-08, reception-module-spec-v1.2.md, RBAC matrix rows.
Not covered: runtime verification (no tests or server run by rule); frontend `__tests__` contents for these pages; AdminDashboard queue chips beyond the status list; timeline rendering; full areas.py refactor (uncommitted, other agents' scope).
