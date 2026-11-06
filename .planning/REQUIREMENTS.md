# Requirements: Kalyan Hospital v3.0 Centralized LAN Web Platform

**Defined:** 2026-10-30
**Core Value:** Reliable, internet-free shared patient records for reception and doctors across the hospital LAN, enforced by server-side permissions, with auditable changes and a backup proven to restore.
**Scope source:** User's "Kalyan Hospital Software v3.0 — Final Plan" (2026-10-30). Proposed scope; fit within the budget and timeline is not guaranteed and acceptance criteria must be confirmed with the client.

## v1 Requirements

### Foundation and Security

- [ ] **SEC-01**: Staff member signs in with an individual account and lands on the dashboard for their role (`/admin`, `/reception` or `/doctor`) of one React + TypeScript app.
- [ ] **SEC-02**: Every API endpoint enforces permissions on the server independently of the UI, and an automated test fails if any route lacks a permission check.
- [ ] **SEC-03**: Three roles (Admin, Reception, Doctor) with a fixed permission catalogue.
- [ ] **SEC-04**: Session expires after an idle timeout, and an account is locked after repeated failed logins.
- [ ] **SEC-05**: Admin creates, deactivates (never deletes) and resets passwords for users; first login forces a password change; no default credentials ship.
- [ ] **SEC-06**: Concurrent edits are safe: stale updates are rejected with a conflict response rather than overwriting.
- [ ] **SEC-07**: The first administrator is created through a first-run web setup wizard that the server enables only while setup has never completed (verified database state, not frontend hiding), requires a one-time high-entropy code visible only on the server PC (never in API responses, browser responses or application logs, stored only as a hash), is throttled and temporarily locked against brute force, creates exactly one administrator even under simultaneous submissions (transaction, lock and database uniqueness constraint), consumes the code atomically with that creation, and stays permanently closed afterwards including after restarts and direct API calls; an authenticated console password-reset command remains for recovery.

### Clinic Setup

- [ ] **SET-01**: Admin configures clinic details (English and Hindi names, both clinic addresses, phone, print header/footer).
- [ ] **SET-02**: Admin maintains doctor profiles (names, qualification, registration number).
- [ ] **SET-03**: Admin maintains the consultation fee list.

### Reception: Patients and Appointments

- [ ] **PAT-01**: Reception registers a patient with the 12 canonical fields and receives a unique URN `KH-YYYY-XXXX`, with no duplicates or gaps under concurrent registration.
- [ ] **PAT-02**: Reception searches patients by URN, name or mobile (Devanagari names included).
- [ ] **PAT-03**: Reception edits a patient record; each change is audited with before and after values.
- [ ] **PAT-04**: Reception sees a duplicate-patient warning (same name and mobile) at registration.
- [ ] **PAT-05**: Reception uploads a patient photo, stored on the server and served only to authorised users.
- [ ] **APT-01**: Reception books a per-doctor daily appointment with a token number and assigns the doctor.
- [ ] **APT-02**: Appointment status (Booked, Arrived, In consultation, Done, Cancelled, No-show) is tracked, and the doctor sees their day's queue.
- [ ] **PRN-01**: Reception prints an A4 registration card with the approved dual-signature layout, verified on the actual hospital printer.

### Doctor and Clinical

- [ ] **CLN-01**: Doctor records an encounter with clinical notes for a patient.
- [ ] **CLN-02**: Doctor finalises a note, after which it is locked; later changes are recorded as dated addenda.
- [ ] **RX-01**: Doctor writes a prescription (medicines, dosage, advice) and prints it with English text and static Hindi labels.
- [ ] **TRT-01**: Doctor creates a treatment plan or package for a patient.
- [ ] **TRT-02**: Doctor logs physiotherapy sessions with VAS pain score; sessions are chronological and immutable, with corrections by addendum.
- [ ] **CLN-03**: Doctor and reception view one chronological patient timeline of encounters, sessions and payments.

### Billing (owned by Reception)

- [ ] **BIL-01**: Reception records consultation fees and instalment payments by cash, UPI or card.
- [ ] **BIL-02**: Money is stored and transmitted as integer paise, and overpayments and negative amounts are rejected, including under concurrent entry from two PCs.
- [ ] **BIL-03**: Outstanding balances are computed (never stored as editable) and a pending-dues list is available.
- [ ] **BIL-04**: Receipts have gap-free sequential numbers, can be printed, and reprints are marked `DUPLICATE`.
- [ ] **BIL-05**: Admin authorises a reversal with a mandatory reason; financial records are never silently deleted or edited.

### Admin and Data Protection

- [ ] **AUD-01**: Security, patient, clinical, billing and backup events are written to an append-only audit log.
- [ ] **AUD-02**: Admin views the audit log with filters (user, action, entity, date).
- [ ] **BAK-01**: Admin creates backup bundles (database and files) with checksums, manually and on a schedule, stored on a second drive.
- [ ] **BAK-02**: A backup is verified and restored on a clean machine, rehearsed as a handover gate.
- [ ] **BAK-03**: Admin runs an integrity report (balances vs ledger, URN gaps/duplicates, orphan files, session counts).

### Deployment and Acceptance

- [ ] **DEP-01**: System is installed once on the central server PC; 3 to 5 PCs use it through a browser over the LAN with no internet access.
- [ ] **DEP-02**: Server services start automatically after a power cut and recover without manual steps.
- [ ] **DEP-03**: Acceptance tests pass for offline operation, permissions, data integrity, real-printer output and backup/restore.

### UI/UX Review Hardening (post-acceptance review)

- [ ] **UX-01**: Receipts print from the app: an A4 receipt after each payment and from payment history, reprints marked DUPLICATE, header taken from clinic settings, and print page sizes defined per document (A4 receipt, A4 card and prescription). The receipt paper was changed from 80 mm to A4 by client decision on 2026-11-02 (see phases/18-ui-ux-review-hardening/18-DECISIONS.md); Phase 15 and 17 records still describe 80 mm thermal and are unchanged.
- [ ] **UX-02**: Every pop-up uses one shared native modal dialog with dialog semantics, inert background, Esc to close and focus returned to the opener.
- [ ] **UX-03**: No blocking `alert()`; failures show persistent, screen-reader-announced inline messages.
- [ ] **UX-04**: On-screen text is at least 12px and meets 4.5:1 contrast, guarded by an automated check.
- [ ] **UX-05**: Hindi text is marked `lang="hi"` and uses a bundled Devanagari font that works with no network.
- [ ] **UX-06**: Every form control has an accessible name, and validation errors are announced only after user interaction.
- [ ] **UX-07**: The HTTPS-for-webcam decision is recorded and either implemented (trusted local certificate) or documented as upload-only with a clear on-screen explanation.
- [ ] **UX-08**: Typecheck, lint, frontend tests and headless one-page print checks pass, with a manual-check sheet for printer, screen reader and display scaling.

### Doctor Workspace

Added 2026-11-05 from the exploration in `.planning/notes/doctor-workspace-direction.md`.

- [x] **DWS-01**: One appointment has at most one encounter, enforced by the database; starting a consultation again opens the existing encounter.
- [x] **DWS-02**: Doctor saves an incomplete encounter as a draft, with auto-save; the screen shows "saved" only after the server confirms, the draft reopens after an interruption, and unfinished drafts are listed on the doctor's dashboard.
- [x] **DWS-03**: Each encounter records whether it is New or Follow-up, using the appointment visit type from PR #12, and the patient's actual arrival time is stored when reception checks them in.
- [x] **DWS-04**: Doctors read all clinical records and edit only their own, with cross-doctor reads audited and the rule enforced in one central place. Reception and Admin stay denied (D-04). Blocked until the EG-6 change is signed off (see `.planning/todos/pending/doctor-access-signoff-and-eye-doctor-setup.md`).
- [x] **DWS-05**: The consultation loads a versioned, developer-set template for Physiotherapy or Ophthalmology from the appointment's department (PR #17), approved by that specialty's doctors before use; each encounter keeps the version it used, responses are validated on the server, and a new version never changes old records.
- [x] **DWS-06**: Doctor records vitals with units during the consultation, and BMI is calculated from the stored height and weight.
- [x] **DWS-07**: Doctor builds the encounter's prescription inside the consultation, as a draft that must be authorised before it prints; an authorised prescription cannot be overwritten, and a correction cancels it with a reason and reissues it, leaving one active prescription. The diagnosis is entered once for the encounter, and the printout keeps its static Hindi labels.
- [x] **DWS-08**: Doctor records a follow-up recommendation with date, reason and assigned doctor, kept separate from the appointment booked for it and linked to that appointment. Doctor or reception can book it, reception sees only the date and doctor, and an unbooked recommendation stays overdue until booked or closed with a reason.
- [x] **DWS-09**: After finalising, the doctor prints a patient-copy consultation summary on one A4 page using the approved letterhead, with static Hindi labels and no medicines listed.
- [x] **DWS-10**: An account can be logged in on one PC at a time, for all roles. A second login is refused after the password is checked, with an audited option to end the other session and log in. This changes the EG-10 default of multiple concurrent sessions.

### Reception Post-Consultation Checkout & Cross-Specialty Workflows

Added 2026-11-06 from the exploration in `.planning/notes/reception-post-consultation-hybrid-checkout.md`.

- [ ] **REC-05**: Reception operates on a post-consultation checkout model where a patient checks in and receives an OPD token slip to proceed to the doctor waiting lounge; when the doctor marks the consultation as `DONE`, the system auto-generates a pending consultation charge on the visit billing account for reception checkout.
- [ ] **REC-06**: Reception generates a single, consolidated A4 bill & payment receipt combining: (a) doctor consultation fees, (b) billable clinical procedures/services recorded by the doctor, and (c) medicines or remedies physically dispensed from the hospital counter catalogue. Clinical prescriptions do not automatically become billable line items.
- [ ] **REC-07**: System enforces department-wise follow-up and package intelligence: Physiotherapy packages decrement sessions only upon doctor-logged session completion (`DONE`), never on reception arrival; Ophthalmology and General OPD automatically detect whether visits fall within the configurable validity window (e.g., 7 days) and apply free or discounted revisit fees.
- [ ] **REC-08**: Internal doctor referral transfers allow transferring a patient between doctors/departments while keeping the same hospital visit container and consolidated visit ledger open, accumulating consultation charges and procedures from both doctors on the same bill, and minting a queue priority token for the receiving doctor.

## v2 Requirements

Deferred; tracked but not in the current roadmap.

### Reporting and Convenience (v3.x)

- **RPT-01**: VAS pain trend chart per treatment plan.
- **RPT-02**: Daily collection report and printable dues follow-up list.
- **RPT-03**: Missed-session list and treatment-plan templates.
- **RPT-04**: Canned Hindi advice library and printable patient summary.
- **RPT-05**: Backup-health banner on the admin dashboard.

### Later (v4+)

- **FUT-01**: LAN HTTPS with in-browser webcam capture.
- **FUT-02**: Document and scan attachments.
- **FUT-03**: SQLite-to-PostgreSQL import of v2.0 data, only if real data exists.

### Doctor Workspace, deferred (2026-11-05)

- **DWF-01**: Admin template editor (Phase 19 templates are developer-set).
- **DWF-02**: Treatment, investigation and referral orders.
- **DWF-03**: Weekly appointment calendar and multiple active prescriptions per encounter.
- **DWF-04**: Extra clinical history tables, clinical reports and notifications.
- **DWF-05**: Medicine catalogue.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Inpatient/IPD, pharmacy inventory, lab and other advanced modules | Excluded unless separately agreed |
| Aadhaar number or ID-card storage | Legal exposure and not needed for outpatient physiotherapy |
| SMS / WhatsApp, cloud backup, patient portal | Needs internet; system is offline and LAN-only |
| ICD/FHIR/ABDM, insurance, GST invoicing | Large separate scope; confirm trust GST/80G status first |
| Editing or deleting past sessions, notes or payments | Would break audit trail and balance integrity |
| Per-user custom permission trees | Three fixed roles are sufficient |
| Drag-drop calendar, websockets | Disproportionate effort for 3 to 5 users |
| Separate frontend per role, per-PC installs | One codebase, one central server |

## Open Decisions (confirm with client)

- Server hardware, UPS and fixed IP; whether client PCs may trust a local certificate (HTTPS).
- Whether doctors can see other doctors' patients (recommended: read yes, write only own).
- Who may authorise a reversal (plan says Admin).
- Receipt numbering year: calendar vs April to March financial year.
- Whether real v2.0 data exists to migrate.

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SEC-01 | Phase 11 | Pending |
| SEC-02 | Phase 11 | Pending |
| SEC-03 | Phase 11 | Pending |
| SEC-04 | Phase 11 | Pending |
| SEC-05 | Phase 11 | Pending |
| SEC-06 | Phase 11 | Pending |
| SEC-07 | Phase 11 | Pending |
| AUD-01 | Phase 11 | Pending |
| SET-01 | Phase 12 | Pending |
| SET-02 | Phase 12 | Pending |
| SET-03 | Phase 12 | Pending |
| PAT-01 | Phase 12 | Pending |
| PAT-02 | Phase 12 | Pending |
| PAT-03 | Phase 12 | Pending |
| PAT-04 | Phase 12 | Pending |
| PAT-05 | Phase 12 | Pending |
| APT-01 | Phase 13 | Pending |
| APT-02 | Phase 13 | Pending |
| CLN-01 | Phase 13 | Pending |
| CLN-02 | Phase 13 | Pending |
| RX-01 | Phase 14 | Pending |
| TRT-01 | Phase 14 | Pending |
| TRT-02 | Phase 14 | Pending |
| BIL-01 | Phase 15 | Pending |
| BIL-02 | Phase 15 | Pending |
| BIL-03 | Phase 15 | Pending |
| BIL-04 | Phase 15 | Pending |
| BIL-05 | Phase 15 | Pending |
| CLN-03 | Phase 15 | Pending |
| AUD-02 | Phase 16 | Pending |
| BAK-01 | Phase 16 | Pending |
| BAK-02 | Phase 16 | Pending |
| BAK-03 | Phase 16 | Pending |
| DEP-01 | Phase 17 | Pending |
| DEP-02 | Phase 17 | Pending |
| DEP-03 | Phase 17 | Pending |
| PRN-01 | Phase 17 | Pending |
| UX-01 | Phase 18 | Pending |
| UX-02 | Phase 18 | Pending |
| UX-03 | Phase 18 | Pending |
| UX-04 | Phase 18 | Pending |
| UX-05 | Phase 18 | Pending |
| UX-06 | Phase 18 | Pending |
| UX-07 | Phase 18 | Pending |
| UX-08 | Phase 18 | Pending |
| DWS-01 | Phase 19 | Complete |
| DWS-02 | Phase 19 | Complete |
| DWS-03 | Phase 19 | Complete |
| DWS-04 | Phase 19 | Complete |
| DWS-05 | Phase 19 | Complete |
| DWS-06 | Phase 19 | Complete |
| DWS-07 | Phase 19 | Complete |
| DWS-08 | Phase 19 | Complete |
| DWS-09 | Phase 19 | Complete |
| DWS-10 | Phase 19 | Complete |
| REC-05 | Phase 18 / Phase 20 | Pending |
| REC-06 | Phase 18 / Phase 20 | Pending |
| REC-07 | Phase 18 / Phase 20 | Pending |
| REC-08 | Phase 18 / Phase 20 | Pending |

**Coverage:**
- v1 requirements: 59 total
- Mapped to phases: 59
- Unmapped: 0

---
*Requirements defined: 2026-10-30*
*Last updated: 2026-11-06 after adding Reception Post-Consultation Checkout requirements (REC-05 to REC-08)*
