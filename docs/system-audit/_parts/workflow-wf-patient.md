# Workflow trace: Patient registration, identity, search and history

Part file for the system audit. Scope: WF-001 (new registration), WF-002 (existing patient booked again), WF-012 (search, detail tabs, timeline), part of WF-014 (demographic edit and admin correction), registration card.

- Audited: 2026-11-09, working tree on `refactor/admin-modules-ssot`, uncommitted edits included.
- Uncommitted edits in scope: `PatientDetail.tsx`, `PatientsDirectory.tsx`, `PatientRegister.tsx` and `pages/__tests__/patients-directory.test.tsx` only change labels, headings and the page width. No in-scope file looks half-edited.
- Method: read the code only. No backend tests, server or database were run, and no frontend test was run because none of the existing tests exercises the paths behind these findings.
- Status values: OK-by-code (the code does it; not run), BROKEN #F-PAT-nn, MISSING, UNVERIFIED.

## Model facts verified (models.py)

- `Patient` (models.py:501-550): `urn` String(32) is UNIQUE and NOT NULL. Check constraints cover gender in {M, F, O} and age between 0 and 150. `mobile` String(15) has **no format check**. Soft delete is `is_active`. `version_id_col` gives optimistic locking (D-08).
- `UrnSequence` (models.py:492-498): `year` is the primary key and holds `last_seq`.
- There is no "visit" entity. An `Appointment` (one doctor, one date, one token) is the visit unit. Encounters, prescriptions, sessions and payments link to the patient and, where present, to the appointment or treatment plan.
- Print snapshots (migration 0017): `patient_name`, `patient_urn`, `patient_mobile` and `patient_address` are copied onto `payments`, `prescriptions` and `clinical_encounters` when each record is created (billing.py:167-170, encounters.py:174-181, prescriptions.py:186-191). The **registration card has no snapshot**. It renders the live patient row and live clinic settings (PatientCardPrint.tsx:10-13, RegistrationCard.tsx:44-60).
- Role grants (core/permissions.py:89-165):
  - RECEPTION: patient read/create/update and photo read/write.
  - DOCTOR: `patient:read` only. No photo or payment permission.
  - ADMIN: `patient:read` and `patient:correct`. No photo or `patient:update`.
  - All three roles have `timeline:read`.

---

## WF-001 New patient registration (with optional walk-in token)

- **Starting actor:** RECEPTION. The route `/reception/patients/new` is guarded by `RequireRole role="RECEPTION"` (router.tsx:219-231).
- **Preconditions:** the user is logged in with a CSRF token in memory (client.ts:80-82). Departments and doctors are loaded for the optional visit block.

| step | UI file:line (component/handler) | hook (api/queries.ts) | endpoint | backend function | tables read/written | side effects | UI refresh | status |
|---|---|---|---|---|---|---|---|---|
| 1 Type name and mobile; a duplicate probe runs after a 300 ms debounce | PatientRegister.tsx:104-119 | `useCheckDuplicate` :693-703 (staleTime 5 s; runs once name ≥2 and mobile ≥10 chars) | GET /api/patients/check-duplicate | patients.py:124-145 `check_duplicate_patient` | R patients (lower(trim(name)) = normalised name AND mobile LIKE '%digits', active only) | none | amber banner, checkbox override (:413-447) | OK-by-code; narrower than spec v1.2 (#F-PAT-20); inactive patients are skipped (#F-PAT-18) |
| 2 Client validation | PatientRegister.tsx:189-202, inputs :534-760 | - | - | - | - | - | inline `formError` | BROKEN #F-PAT-09 (no mobile pattern, no DOB/age check, no "Other" gender #F-PAT-16) |
| 3 Submit | PatientRegister.tsx:224 | `useRegisterPatient` :679-691 | POST /api/patients | patients.py:72-116 `register_patient`, `require(PATIENT_CREATE)` | W urn_sequences (INSERT .. ON CONFLICT DO UPDATE, urn_service.py:25-35); W patients | URN `KH-{IST year}-{seq:04d}`; row lock on urn_sequences held until commit; audit `PATIENT_REGISTERED` entity "PATIENT" (patients.py:101-114); commit in `get_session` (db/session.py:42-50) | invalidates `['patients']` only | OK-by-code for atomicity. Stale counts #F-PAT-11 |
| 4 Server validation | - | - | same | `PatientCreate` schemas/patients.py:139-155 | - | 422 `validation_error` with a generic message (core/errors.py:126-143) | shows `err.message` only | BROKEN #F-PAT-09 (mobile regex lets through values with fewer than 10 digits) |
| 5 Photo upload (if chosen) | PatientRegister.tsx:226-236 | `useUploadPatientPhoto` :738-753 | POST /api/patients/{id}/photo (multipart) | patients.py:299-332 | W patients.photo_path; W file `photos_dir/<uuid>.jpg/png` | audit `PHOTO_UPLOADED` | invalidates `['patient',id]`, `['patients']` | BROKEN #F-PAT-08 (a failure is swallowed); preview blank under CSP #F-PAT-15 |
| 6 Book a token (if department and doctor chosen) | PatientRegister.tsx:238-249 | `useBookAppointment` :789-799 | POST /api/appointments | appointments.py:80-160 (checks patient active, doctor active, department active and membership) | W daily_token_sequences, appointments | audit; token per (doctor, date) | invalidates `['appointments']`, `['doctor-queue']` | OK-by-code; a failure is swallowed (#F-PAT-08) |
| 7 Walk-in: mark ARRIVED | PatientRegister.tsx:251-260 | `useUpdateAppointmentStatus` :803-816 | PATCH /api/appointments/{id}/status | appointments router | W appointments.status | audit | as above | BROKEN #F-PAT-08 (a failure is swallowed; the card still says "Checked In (Arrived)", :378) |
| 8 Result | PatientRegister.tsx:266-276, success card :347-411 | - | - | - | - | - | the form is **not cleared** unless "Save and add another" is ticked; the submit button is enabled again | BROKEN #F-PAT-03 (a second submit creates a second patient and URN) |
| 9 Visit complaint stored on the patient | PatientRegister.tsx:219 | - | - | - | patients.notes = "Complaint: ..." | permanent; prints as "Clinical Remarks" (RegistrationCard.tsx:163-164) | - | BROKEN #F-PAT-17 |
| 10 Dependent screens | ReceptionDashboard.tsx:46-53, :293 | `useOverview('reception')` :195-203, `useAppointments` :761-777 | GET /api/reception/overview (`registrations_today`, areas.py:459-466) | - | R patients | - | **no polling, no invalidation**; staleTime 60 s (queries.ts:107-114) | BROKEN #F-PAT-11 |
| 11 Reload persistence | PatientDetail.tsx:94-96 | `usePatient` :715-721 | GET /api/patients/{id} | patients.py:185-193 | R patients | - | - | OK-by-code |

**URN concurrency, year rollover and gaps**
- Allocation runs in the same transaction as the patient INSERT. `ON CONFLICT (year) DO UPDATE` takes the row lock, so concurrent registrations queue behind it (lock_timeout 10 s, db/session.py:24-29). Duplicates are impossible, and the UNIQUE constraint on `patients.urn` backs this up.
- A rolled-back registration also rolls back the counter, so a failed request leaves no gap.
- The year comes from `clock.ist_today()` (urn_service.py:22-23), so a registration at 00:30 IST on 1 January gets the new year. **No test** checks this boundary or rollback (#F-PAT-22).
- OD-12 (gap semantics) is still Pending, but the code and PAT-01 already promise "gap-free" (#F-PAT-21).
- `{seq:04d}` produces 5 digits after 9,999 registrations in a year, which breaks the KH-YYYY-XXXX format. This is unlikely at this hospital's volume.

**Failure scenarios**

| scenario | handling | verdict |
|---|---|---|
| Invalid input, client side | Only `required` and age < 0 are checked (:194-197). No mobile pattern; a future DOB is accepted. | #F-PAT-09 |
| Invalid input, server side | 422 with the generic text "The submitted data failed validation."; field errors are not shown. | #F-PAT-09 (UX part) |
| Duplicate submit while saving | The button is disabled only while `registerMutation.isPending`. The photo and booking steps run after it resolves, so the button is enabled again during them. | #F-PAT-03 |
| Duplicate submit after success | The form keeps its values, the duplicate-probe cache (`['check-duplicate',...]`) is not invalidated, and the backend has no idempotency or blocking. A second patient and URN are created. | #F-PAT-03 |
| Permission denied | The route allows RECEPTION only. The backend returns 403 to others (policy.py:60-68). | OK |
| 409 conflict | Not applicable to create. | - |
| Server down or network error | `fetch` rejects and the catch at :277-285 shows a message. Nothing is persisted. | OK |
| Photo, booking or arrival fails after the patient is created | Logged with `console.warn` only; the success card is still shown. | #F-PAT-08 |

---

## WF-001b Photo upload, retrieval and permissions

| step | UI file:line | hook | endpoint | backend function | tables/files | side effects | UI refresh | status |
|---|---|---|---|---|---|---|---|---|
| Upload | PatientRegister.tsx:141-151 (file picker, data-URL preview :495-499) | `useUploadPatientPhoto` :738-753 | POST /api/patients/{id}/photo | patients.py:299-332; `_extract_photo_bytes` :45-63; `photo_service.save_photo` :78-87 (5 MB cap, JPEG/PNG magic bytes, uuid filename) | W file; W patients.photo_path (row locked FOR UPDATE) | **old file deleted before commit** (:319-320); audit `PHOTO_UPLOADED` | invalidates patient and patient list | BROKEN #F-PAT-07 |
| Retrieval | PatientsDirectory.tsx:181-190, PatientDetail.tsx:234-242, RegistrationCard.tsx:135-138 | none (plain `<img src=/api/patients/{id}/photo>`) | GET /api/patients/{id}/photo | patients.py:339-367, `require(PHOTO_READ)` | R patients, file | `Cache-Control: private, no-cache` (also main.py:72-73) | the image hides itself on error | OK-by-code. DOCTOR and ADMIN lack `photo:read` (403), so the photo is silently hidden for them. This matches the matrix (AUDIT-2026-11-08 line 85). |
| Replace photo on an existing patient | none | - | - | - | - | - | - | MISSING in the UI: `PhotoUploader.tsx` is used only by its own test (grep). An existing patient's photo cannot be added or replaced from any screen. Reported under #F-PAT-15. |

---

## WF-002 Existing patient booked with another department or doctor

- **Starting actor:** RECEPTION, at the Token Desk (`TokenGenerationPage.tsx:57`), the booking modal (`AppointmentBookingModal.tsx:33`) or the billing search.
- **Preconditions:** the patient already exists.

| step | UI file:line | hook | endpoint | backend function | tables | side effects | UI refresh | status |
|---|---|---|---|---|---|---|---|---|
| Search the existing patient | TokenGenerationPage.tsx:57; AppointmentBookingModal.tsx:33-41 | `usePatients(q, 8 or 5, 0)` | GET /api/patients?q= | patients.py:153-177 | R patients | - | - | OK-by-code (inactive patients are listed but cannot be booked) |
| Book with doctor B / department B | AppointmentBookingModal.tsx:43-60 | `useBookAppointment` | POST /api/appointments with `patient_id` | appointments.py:89-95 (inactive patient rejected), :99-120 (doctor and department active, membership) | W appointments FK → same patients.id | new token per doctor | invalidates appointments and doctor queue; **not** `['timeline']` | OK-by-code for identity (same URN, no new patient row). Stale timeline #F-PAT-11 |
| Earlier history reachable | PatientDetail.tsx:387-414 | `usePatientTimeline` :1280-1287 | GET /api/patients/{id}/timeline | timeline.py:52-309 | R appointments, encounters, prescriptions, plans, sessions, payments by patient_id | - | client-side filter by tab | OK-by-code for linkage. Role leaks #F-PAT-01, #F-PAT-02, #F-PAT-04 |

**Failure scenarios:**
- Inactive patient: 404/422 "Patient not found or inactive" (appointments.py:89-95).
- Doctor outside the department, or an inactive department: rejected by the server.
- A duplicate patient created earlier by #F-PAT-03 splits the history across two URNs. Nothing in the code merges patients.

---

## WF-012 Search, directory, detail tabs, timeline

- **Starting actor:** RECEPTION, DOCTOR or ADMIN. The route `/reception/patients` is guarded by `RequireRole ['ADMIN','RECEPTION','DOCTOR']` (router.tsx:243-282).

| step | UI file:line | hook | endpoint | backend function | tables | side effects | UI refresh | status |
|---|---|---|---|---|---|---|---|---|
| Search box with 300 ms debounce | PatientsDirectory.tsx:12-31 | `usePatients(q)` :705-713 (limit 20) | GET /api/patients?q=&limit=20&offset=0 | patients.py:153-177: ILIKE on urn, full_name, guardian_name; mobile LIKE when ≥3 digits; newest first | R patients | none (search not audited) | - | OK-by-code for URN, partial, case and Devanagari (tested in test_patient_search.py, see "multimodal search"). Repeated internal whitespace and `%`/`_` are not normalised or escaped (minor). **No pagination** #F-PAT-10 |
| Doctor scope on search and detail | - | - | GET /api/patients, /api/patients/{id} | `require(PATIENT_READ)` only, no row scope | R patients | - | - | spec_conflict #F-PAT-12 |
| Detail: Profile tab | PatientDetail.tsx:228-379 | `usePatient` | GET /api/patients/{id} | patients.py:185-193 | R patients | - | - | OK |
| Detail: Appointments, Treatment Plans, Payments tabs | PatientDetail.tsx:387-414 | `usePatientTimeline` (one request; filtered on the client, PatientTimeline.tsx:34-37) | GET /api/patients/{id}/timeline | timeline.py:52-309 | R 6 tables | **no cross-doctor audit** | not invalidated by appointment, encounter, plan or session mutations | BROKEN #F-PAT-01, #F-PAT-02, #F-PAT-04, #F-PAT-11, #F-PAT-19 |
| Detail: Consultations tab | PatientDetail.tsx:200-202 (shown only if `encounter:read` and `prescription:read`) | same | same | timeline.py:96-180 | R encounters, prescriptions | - | - | The UI hides the tab for ADMIN and RECEPTION, but ADMIN still receives the data (#F-PAT-01) |
| Detail: Change History tab (ADMIN) | PatientDetail.tsx:12-18, :205, :415-417 | `useAuditLogs({entity_type:'patient'})` | GET /api/audit-logs?entity_type=patient | audit.py:51-52 exact match | R audit_logs | - | - | BROKEN #F-PAT-05 (always empty) |
| Payment card | PatientDetail.tsx:424; PaymentHistory.tsx:16-21 | `usePatientPayments` | GET /api/patients/{id}/payments | billing router | R payments | - | - | OK (hidden for DOCTOR). The Payments tab still shows DOCTOR the timeline payments (#F-PAT-13) |
| Inactive patient | PatientDetail.tsx:254-262 shows the Inactive badge | - | timeline | timeline.py:58-62 returns 404 | - | - | tabs show "Failed to load patient history." | BROKEN #F-PAT-18 |

**Timeline completeness:**
- Included: appointments, encounters (with an addenda count), prescriptions, treatment plans, treatment sessions and payments (with a reversed flag).
- Not included: vitals, follow-ups, and the reversal itself as a dated event (`reversed_at` is not used).
- Dates: appointments and sessions are dated by `created_at`, not by appointment or session date (#F-PAT-19).

**Role restriction summary (timeline.py)**

| role | appointments | encounters | prescriptions | plans | sessions | payments |
|---|---|---|---|---|---|---|
| RECEPTION | yes | no | no | yes, **including the diagnosis** | yes, **including modalities and VAS** | yes |
| DOCTOR | yes | all doctors (DWS-04 read-all, **unaudited**) | all doctors (unaudited) | all doctors | all doctors | yes (no `payment:read`) |
| ADMIN | yes | **yes, full symptoms and diagnosis** | **yes, medicines** | yes | yes | yes |

---

## WF-014 (part) Demographic edit (RECEPTION) and admin correction

| step | UI file:line | hook | endpoint | backend function | tables | side effects | UI refresh | status |
|---|---|---|---|---|---|---|---|---|
| Open the edit modal from the directory row or the detail page | PatientsDirectory.tsx:217-230 / PatientDetail.tsx:139-145 | - | - | - | - | - | - | The button is shown to every role, but DOCTOR and ADMIN get 403 (#F-PAT-14) |
| Save | PatientEditModal.tsx:88-128 | `useUpdatePatient` :723-736 | PATCH /api/patients/{id} | patients.py:201-291, `require(PATIENT_UPDATE)`; SELECT .. FOR UPDATE; `require_version` (core/errors.py:27-31) | W patients (version_id++) | audit `PATIENT_UPDATED` with before and after | `setQueryData(['patient',id])`, invalidates `['patients']`; the directory also calls `refetch()` | OK-by-code for 409 and audit. Clearing DOB, emergency contact or notes is a silent no-op (#F-PAT-06) |
| 409 stale version | PatientEditModal.tsx:118-120 → ConflictBanner; reload :61-86 | - | - | VersionConflict → 409 | - | - | the user reloads with one click | OK-by-code (D-08) |
| Duplicate warning on edit | none | - | - | none | - | - | - | MISSING. PAT-04 only requires the warning at registration, so this is not reported as a defect. |
| Deactivate (`is_active`) | no UI | - | PATCH with `is_active:false` | patients.py:258-259 | W patients | audit with no reason | - | #F-PAT-18 |
| Admin correction | pages/admin/PatientCorrectionPage (not in scope; hook only) | `useCorrectPatientDemographics` :1531-1544 | PATCH /api/admin/patients/{id}/demographics | admin_patients.py:76-131, `require(PATIENT_CORRECT)`; FOR UPDATE + version check; mandatory reason | W patients | audit `PATIENT_CORRECTED` with reason | invalidates admin search and `['patient',id]`; **not `['patients']`** | OK-by-code; stale directory #F-PAT-11. Mobile here must be exactly 10 digits, which is stricter than registration (#F-PAT-09) |

---

## Registration card data source

`PatientCardPrint.tsx:10-13` reads `usePatient(id)` and `useClinicSettings()`, and `RegistrationCard.tsx:44-60` renders them live. No snapshot is stored. D-20-06 snapshots cover issued receipts, prescriptions and encounters only, so a live card is consistent with the decision. Two consequences:
- A reprinted card always shows the current demographics.
- The visit complaint injected into `notes` prints as "Clinical Remarks" (#F-PAT-17).

## Mapping notes: generic spec vs repo model

- **Visit entity.** The generic spec's "visit" spanning several doctors does not exist. A visit is one `Appointment` for one doctor. AGENTS.md invariant 2 (several visits per patient) is met through several appointments. Invariant 3 (several doctor consultations in one visit) cannot be represented, and history cannot be grouped by visit (#F-PAT-24, spec_conflict).
- **Queue statuses.** The spec's SCHEDULED/CHECKED-IN/WAITING/IN CONSULTATION/COMPLETED map to the repo's BOOKED/ARRIVED/IN_CONSULTATION/DONE/CANCELLED (models.py:553-561). Registration sets BOOKED, then ARRIVED for walk-ins.
- **Invoices and refunds.** The spec's invoices, invoice items and refunds do not exist here. The timeline shows `payments` rows, and a reversal is a flag on the same row (`is_reversed`, `reversal_reason`; models.py Payment). Billing owns this part.
- **Patient identity.** One permanent URN is enforced by the UNIQUE constraint. No merge or unmerge tool exists for duplicates created in error.

## Findings index

| ID | Sev | Kind | Title |
|---|---|---|---|
| F-PAT-01 | P0 | defect | Timeline sends ADMIN full encounter and prescription content (D-04 / EG-7) |
| F-PAT-02 | P1 | defect | Timeline sends RECEPTION the treatment-plan diagnosis and session clinical fields |
| F-PAT-03 | P1 | defect | Registration form can be submitted again after success, creating a duplicate patient and URN |
| F-PAT-04 | P1 | defect | Cross-doctor clinical reads through the timeline are not audited (DWS-04) |
| F-PAT-05 | P2 | defect | Admin "Change History" tab always empty (entity_type case mismatch) |
| F-PAT-06 | P2 | defect | Clearing DOB, emergency contact or notes on edit is silently ignored |
| F-PAT-07 | P2 | defect | Photo replacement deletes the old file before commit |
| F-PAT-08 | P2 | defect | Photo, token and arrival failures during registration are swallowed (false success) |
| F-PAT-09 | P2 | defect | Mobile and DOB validation gaps; front and back ends differ |
| F-PAT-10 | P2 | missing_feature | Patient directory has no pagination (20 rows max) |
| F-PAT-11 | P2 | defect | Stale dashboard counts, queue and timeline after registration, booking or clinical changes |
| F-PAT-12 | P2 | spec_conflict | Doctor sees all patients and all clinical rows (EG-6 locked silo vs pending OD-02) |
| F-PAT-13 | P3 | spec_conflict | Doctor sees payments through the timeline but has no `payment:read` |
| F-PAT-14 | P3 | defect | Edit buttons shown to roles without `patient:update` |
| F-PAT-15 | P3 | defect | Registration photo preview blocked by CSP; no photo add or replace for existing patients |
| F-PAT-16 | P3 | defect | Gender "Other" cannot be selected at registration |
| F-PAT-17 | P3 | defect | Visit complaint written into the permanent patient notes |
| F-PAT-18 | P3 | defect | Inactive patients: history returns 404, duplicate probe skips them, deactivation needs no reason |
| F-PAT-19 | P3 | defect | Timeline dates appointments and sessions by created_at |
| F-PAT-20 | P3 | spec_conflict | Duplicate probe narrower than reception spec v1.2 |
| F-PAT-21 | P3 | spec_conflict | Code promises gap-free URNs while OD-12 is Pending |
| F-PAT-22 | P2 | test_gap | No test for URN IST year rollover or rollback without a gap |
| F-PAT-23 | P3 | test_gap | Registration failure paths and timeline role leaks untested; one test codifies F-PAT-01 |
| F-PAT-24 | P3 | spec_conflict | AGENTS.md invariant 3: no visit grouping of consultations |

The full evidence, root cause, fix and verification test for each finding are in the structured result returned with this part.
