# Feature Research

**Domain:** Small outpatient physiotherapy clinic management (Kalyan Hospital, Ara, Bihar) - central-server LAN web app, 3 roles, 2 consultants
**Researched:** 2026-10-30
**Confidence:** MEDIUM (existing codebase/schema read directly; module structure of OpenEMR / Open Hospital / ICTHospital / GNU Health from domain knowledge, no live browsing. Indian regulatory points are general knowledge and should be confirmed with the client or an advisor.)

Role key: **A** = Admin, **R** = Reception, **D** = Doctor. "Carry-over" = rule already proven in the v2.0 desktop app (see `app/db/schema.sql`, `app/services/*`); re-implement, do not re-research.

Baseline in v2.0 schema (what v3.0 starts from): `doctors`, `patients` (12-field form + photo + doctor_id + status), `treatment_cases` (sessions count, total_amount_paise, status), `treatment_sessions` (notes, modalities, VAS 0-10), `payments` (paise, CASH/UPI/CARD/OTHER), `users` (3 roles), `id_sequences`, `audit_logs`. There is NO appointment, encounter, prescription, receipt-number, permission or settings table yet - these are the genuinely new v3.0 domain objects.

## Feature Landscape

### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Owner | Notes |
|---------|--------------|------------|-------|-------|
| Individual login, logout, password change, role-routed landing (`/admin` `/reception` `/doctor`) | Replaces shared desktop login; every comparable system has per-user accounts | MEDIUM | A (manage), all (use) | Argon2/bcrypt hashing (v2.0 uses salted hash - migrate on first login or re-create users). Session cookie or short JWT; idle timeout. Lockout after N failures is cheap and worth it on a shared LAN. |
| Server-side permission check on every endpoint | Core Value; OpenEMR ACL and GNU Health access groups both enforce at service layer | MEDIUM | A | Role -> permission-set table (see Permissions below). One FastAPI dependency `require(perm)` applied per route; test matrix of role x endpoint. |
| Patient registration with URN `KH-YYYY-XXXX` and the 12-field form | Carry-over, client approved | MEDIUM | R | URN generation must be concurrency-safe in PostgreSQL (row lock on `id_sequences` or a sequence per year) - this is the main new risk vs SQLite single user. |
| Patient search (URN, name, mobile) + patient list with paging | Daily reception use; all four reference systems lead with a patient finder | LOW | R, D, A | Indexes on URN/mobile; `pg_trgm` or ILIKE on name. Hindi (Devanagari) names must search correctly - use UTF-8 collation, no transliteration. |
| Patient profile view/edit with change audit | Standard demographics maintenance | LOW | R (edit), D (view) | Field-level before/after in audit. Doctors read-only on demographics. |
| Patient photo capture/upload, stored on server filesystem | Carry-over; in PROJECT.md target | MEDIUM | R | Validate type/size, re-encode to JPEG, resize (e.g. 600px), store outside web root, serve through authenticated endpoint. Webcam capture via browser `getUserMedia` needs HTTPS or localhost - on plain-HTTP LAN it is BLOCKED; plan on file upload (phone/USB) first, LAN HTTPS with a local cert as an option. Important constraint to flag. |
| Duplicate-patient warning (same name + mobile) | Small clinics re-register returning patients constantly | LOW | R | Soft warning on registration, not a hard block. Cheap, prevents split ledgers. |
| Appointment booking (date, time or token, doctor, patient, status) | In plan; OpenEMR calendar / ICTHospital / Open Hospital all have it | MEDIUM | R (book), D (view own) | Keep it a simple day list per doctor with statuses Booked / Arrived / In consultation / Done / Cancelled / No-show. NOT a drag-drop calendar. Token/serial number per doctor per day matches how Indian OPDs actually work. |
| Doctor assignment per patient and per visit | Carry-over (`doctor_id`); two consultants share one patient record and one ledger | LOW | R | Assignment is per encounter; patient has a "primary doctor" default only. |
| Today's queue / waiting list for doctor | Doctors need "who is here now" | LOW | D | Derived from appointments + arrival status. Auto-refresh by polling every 15-30 s is enough; no websockets. |
| Clinical encounter (visit) record: date, doctor, chief complaint, history, examination, diagnosis | Core of the clinical module in all four reference systems (OpenEMR "encounter", GNU Health "evaluation", Open Hospital "visit") | MEDIUM | D | One encounter row ties together notes, prescription, treatment plan and bill line. Free-text fields with a few structured ones (diagnosis, body region, pain VAS). |
| Consultation notes, editable until signed/locked, then immutable (addendum only) | Medico-legal expectation; v2.0 already makes session history immutable | MEDIUM | D | Carry the immutability rule over to encounters: lock after a short window or on "finalise"; later changes are dated addenda. |
| Prescription (medicines + dose + frequency + duration + advice) with printable A4/half-A4 | Every patient leaves with one; GNU Health and OpenEMR both have it | MEDIUM | D | Free-text medicine name with type-ahead from a small local list (no drug-DB licensing). Print layout with clinic header, doctor name/registration no., Rx symbol. English plus Hindi advice/instructions (see India section). |
| Treatment plan per patient: condition, modalities, planned session count, frequency, goals | Matches v2.0 `treatment_cases` (title, no_of_sessions, total, status) | MEDIUM | D (clinical), R (view) | Carry-over entity. Plan status IN_PROGRESS / COMPLETED / SUSPENDED. Plan total feeds the package price. |
| Physiotherapy session log: date, therapist, modalities, notes, VAS 0-10, session number; immutable, chronological | Carry-over, validated | LOW | D | Session number auto-increments within plan; cannot exceed planned sessions without an explicit plan extension. Corrections by addendum row, never UPDATE. |
| Patient timeline (encounters + sessions + payments in one chronological view) | What doctors actually open first | MEDIUM | D, R | Read-only union query; no new tables. High clinical value for low cost. |
| Billing: consultation charge per encounter | In plan | LOW | R | Fee comes from a small price list (consultation fee per doctor, editable by admin). |
| Payments: partial/instalment payments, mode (cash/UPI/card/other), reference, who recorded | Carry-over; physio is paid in instalments | MEDIUM | R | Integer paise end to end (DB column, API JSON as integer, UI formats only for display). Reject negatives and overpayment (carry-over). Do the overpayment check inside a transaction with a row lock on the plan/bill to stop two reception PCs overpaying concurrently. |
| Outstanding balance per patient and a "pending dues" list | Core reason clinics buy billing | LOW | R, A | Computed: charges minus payments; never stored as an editable number. |
| Receipt with sequential receipt number, print-ready (A4 and/or A5/thermal-friendly) | Indian clinics always issue a paper receipt; patient asks for it | MEDIUM | R | Gap-free `RCPT-YYYY-NNNNN` per financial year (Indian FY Apr-Mar is common for receipts - confirm with client; URN stays calendar year as approved). Receipt shows paid-now, paid-to-date, balance, mode, cashier. Reprint is marked "DUPLICATE COPY" and audited. |
| Session packages (e.g. 10 sessions for Rs X) with sessions-used / remaining | In plan; this IS the physio business model | MEDIUM | R (sell/collect), D (consume via session log) | Package = plan with a price. Remaining = planned - logged sessions. Warn at 1 session left. Refund/transfer = out of scope; handle by Admin adjustment entry with reason. |
| Void / correction of a payment via reversing entry (never delete) | Money records must be append-only | MEDIUM | A (authorise), R (request) | Reversal row linked to original with mandatory reason; both audited. Keeps ledger arithmetic honest. |
| Audit log viewer with filters (user, action, entity, date) | Carry-over; admin needs to answer "who changed this" | MEDIUM | A | Append-only table; no UPDATE/DELETE grant to the app DB role. Log: login/fail, patient create/edit/archive, encounter finalise/addendum, payment/reversal, receipt reprint, user/permission change, backup/restore, report export. |
| User management: create, deactivate (never delete), reset password, assign role | Required for individual accounts | LOW | A | Deactivate instead of delete so audit history keeps names. Force password change on first login. |
| Permissions model (role -> permission list), admin-editable | In plan: "users and permissions" | MEDIUM | A | Keep to a fixed catalogue of ~20 permission codes grouped into 3 default roles; Admin can toggle per-role, per-user overrides are NOT needed (see anti-features). |
| Hospital settings: name (English + Hindi), two clinic addresses, phone, header/logo for prints, fee list, receipt/prescription footer text | Print headers must not be hard-coded | LOW | A | Single settings table. Two clinics: store clinic as a lookup and tag encounters/receipts with clinic_id so both addresses print correctly. |
| Doctor profiles (name English/Hindi, qualification, registration no., signature image optional) | Needed on prescriptions and receipts | LOW | A | Extends existing `doctors` table. Medical council registration number is expected on Indian prescriptions. |
| Backup: create bundle (DB dump + photos + documents) on demand and on schedule; list backups | Carry-over; Core Value | MEDIUM | A | `pg_dump` + file copy zipped with manifest + SHA-256. Scheduled by Windows Task Scheduler on the server. Write to a second drive/USB. |
| Tested restore with integrity verification | Core Value "backup proven to restore" | HIGH | A | Verify checksum, restore into a scratch database first, run integrity checks, then swap. Doing this in-app is the riskiest admin feature; consider an offline CLI restore script plus an in-app "verify backup" button as the budget-safe version. |
| Integrity checks: orphan photos/records, balance vs ledger sums, URN gaps/duplicates, session count vs plan | In plan | MEDIUM | A | A read-only report page running SQL assertions. Re-uses the same checks as the restore verification. |
| Printed registration card with dual-signature pad layout | Carry-over, client approved | MEDIUM | R | Browser print CSS (A4, `@page`) or server-side PDF. Must match the approved layout exactly; test on the actual hospital printer. Devanagari fonts must be bundled locally (no CDN). |
| Dashboard summaries per role | Landing pages should show something useful | LOW | all | R: today's appointments, today's collection. D: my queue, my active plans. A: user count, last backup, pending alerts. Counts and sums only. |
| Offline operation: all fonts, JS, CSS bundled; no external calls | Hard constraint | LOW | - | Build-time check: grep built assets for http(s) URLs; test with network cable pulled. |
| Concurrency safety (optimistic locking / version column on editable records) | New with multi-PC; two receptionists may edit same patient | MEDIUM | - | `updated_at`/version check on PATCH, return 409 on stale write. Not needed in single-PC v2.0, so easy to forget. |
| Session timeout and auto-logout on shared PCs | Reception PCs are shared and public-facing | LOW | - | 15-30 min idle timeout, configurable. |

### Differentiators (Competitive Advantage)

Aligned with Core Value (reliable shared records, enforced permissions, proven backup). Few and cheap; pick from this list only after table stakes are done.

| Feature | Value Proposition | Complexity | Owner | Notes |
|---------|-------------------|------------|-------|-------|
| VAS pain trend chart per treatment plan | Doctor and patient see progress at a glance; unusual for a Rs 22k system | LOW | D | Small SVG/Chart line from existing session rows; no extra data. Highest value-per-effort differentiator. |
| Bilingual (English/Hindi) prescription advice and receipt labels | Patients read Hindi; clinic identity is already bilingual | MEDIUM | D, R | Template-level: bilingual static labels plus a library of ~30 canned Hindi advice snippets (hot fomentation, exercise, rest) the doctor ticks. Avoid free-form translation. |
| Canned exercise/advice library with printed home-exercise sheet | Physio-specific; patients forget exercises | MEDIUM | D | Text-only list first (no images/video). Admin-editable. |
| Daily collection report (cash vs UPI, by cashier) with day-close total | Owner/trust needs cash reconciliation; reduces leakage | LOW | A, R | Single query + print. Strong trust value. |
| Dues follow-up list with printable reminder slip (no SMS) | Recovers outstanding balances without telecom cost | LOW | R | Filter by balance and last-payment age; print/hand over. Complies with SMS/WhatsApp out-of-scope. |
| Missed-session / lapsed-patient list | Package patients who stop attending = lost revenue | LOW | R, D | Plans IN_PROGRESS with no session in N days. Pure query. |
| Backup health on admin dashboard (last backup age, last verified restore, disk free) | Makes Core Value visible; admin sees it before disaster | LOW | A | Reads backup manifest and `shutil.disk_usage`. Red banner if backup older than 24 h. |
| Printable patient summary / discharge note (diagnosis, sessions done, VAS start vs end, advice) | Referral letters and insurance/employer requests | MEDIUM | D | One template reading existing data. |
| Treatment-plan templates (e.g. "Lumbar spondylosis - 10 sessions") | Faster plan creation for the doctors | LOW | D, A | Simple prefill rows; admin-editable. |
| Monthly summary report (patients registered, sessions, collection) | Trust/management reporting | LOW | A | Counts and sums; CSV export of the same view. |
| CSV export of reports (not of full patient database) | Accountant handoff | LOW | A | Permission-gated and audited. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Storing Aadhaar number (or photo of Aadhaar card) | "ID proof" habit in Indian clinics | Aadhaar Act and DPDP Act 2023 expose the clinic to liability for collecting/storing without lawful need; not needed for outpatient physio; a leak of a plain-text database is severe | Do not add a field. Identify patients by URN + mobile + photo. If a client ever insists, store only last 4 digits, masked, behind an admin permission and with consent text. Make this a written decision in PROJECT.md. |
| SMS / WhatsApp reminders and receipts | Common in modern clinic software | Already out of scope; needs internet and telecom contracts | Printed reminder slips and the dues follow-up list. |
| Inpatient/bed management, OT, pharmacy stock, lab/radiology orders (the bulk of OpenEMR, Open Hospital, ICTHospital, GNU Health) | Reference systems have them, so they look "standard" | They account for most of those systems' size; outpatient physio does not need them; each is a mini-product | Free-text investigation notes and an "attach scan/report" upload only if time remains. |
| Drug-interaction checker and licensed drug database | Looks clinically safe | Licensing cost, maintenance, false-alarm risk, and the doctors prescribe few drugs | Local editable medicine name list; doctor responsibility. |
| ICD-10 / SNOMED coding, HL7 / FHIR, ABDM (ABHA ID) integration | "Interoperability", government push | Large effort, requires internet and registration; not in budget or in the signed scope | Free-text diagnosis with a small suggestion list; revisit ABDM as a separate paid milestone. |
| Insurance / TPA claims and GST invoicing | Appear in commercial hospital software | Complex rules; trust-run physio OPD receipts are normally non-GST and cash/UPI | Plain receipts. Confirm GST/80G status with the trust before launch; 80G donation receipts would be a separate template. |
| Per-user custom permission toggles (OpenEMR-style ACL tree) | Fine-grained control | Large test surface and easy to misconfigure; two consultants and a few staff do not need it | Three fixed roles, admin-editable permission list per role. |
| Editing or deleting past sessions, notes, payments | "Fix a typo" | Destroys audit trail and balance integrity (violates carry-over immutability) | Addendum / reversal entries with reason. |
| Real-time updates (websockets) everywhere | Feels modern | Extra moving parts on a Windows server; marginal value for 3-6 users | Polling every 15-30 s on the queue page only. |
| Online appointment booking portal / patient portal | Patient convenience | Needs internet exposure; out of scope (LAN only) | Reception books by phone/walk-in. |
| Biometric / fingerprint attendance or login | Anti-fraud | Out of scope (hardware) | Individual passwords and audit log. |
| Webcam capture directly in browser | Convenient photo capture | `getUserMedia` is blocked on non-HTTPS non-localhost origins; fragile across PCs | File upload from camera/phone/USB first; add LAN HTTPS only if client insists. |
| Automatic cloud/remote backup | Safety | Needs internet | Backup to a second local disk or USB, plus an operational checklist for the trust to carry a copy offsite. |
| Drag-and-drop multi-resource calendar | Looks polished | Disproportionate frontend effort | Per-doctor day list with token numbers. |
| Multi-branch separate databases for the two clinics | Two addresses exist | Splits ledger and patient identity; contradicts central-server premise | Single DB, `clinic_id` tag on visits and receipts. |
| Free-form Hindi machine translation | Hindi UI wanted | Wrong clinical wording risk | Static bilingual labels and curated Hindi snippets only. |

## Feature Dependencies

```
Users + Roles + Permission checks (API)
    └──required by──> everything below (every endpoint gated)

Hospital settings + Doctor profiles
    └──required by──> Print headers (registration card, prescription, receipt)

Patient registration (URN, 12 fields)
    ├──requires──> id sequence safe under concurrency
    ├──requires──> Doctor profiles (assignment)
    └──enables──> Photos, Appointments, Encounters, Billing

Appointments ──enhances──> Doctor queue ──enhances──> Encounter

Encounter (visit)
    ├──requires──> Patient + Doctor
    ├──contains──> Consultation notes (lockable, addenda)
    ├──contains──> Prescription ──requires──> Doctor registration no. on print
    └──may open──> Treatment plan (package)

Treatment plan / session package
    ├──requires──> Encounter or Patient
    ├──contains──> Physio sessions (immutable, VAS)
    └──requires──> Billing ledger (price, payments)

Billing ledger (integer paise)
    ├──requires──> Fee list (settings)
    ├──produces──> Receipts (sequential number)
    ├──produces──> Outstanding balance, dues list
    └──requires──> Reversal entries (no edits)

Audit log ──required by──> payments, reversals, reprints, permission changes, backup/restore
Backup bundle ──requires──> Photo/document storage layout fixed early
Restore verification ──requires──> Integrity checks (shared SQL assertions)

VAS trend chart ──enhances──> Physio sessions
Daily collection report ──enhances──> Receipts/payments
Canned Hindi advice library ──enhances──> Prescription print
```

### Dependency Notes

- **Permissions must be first.** Retro-fitting the `require(perm)` dependency across endpoints is far costlier than building each endpoint behind it from day one.
- **Settings and doctor profiles before any print template.** Receipts, prescriptions and registration card all read clinic and doctor data; building templates with hard-coded headers causes rework.
- **Storage layout before photos and backup.** Fix the photo/document directory structure and DB-path-only-in-DB rule early so backup bundle and integrity checks (orphan files) are straightforward.
- **Encounters before prescriptions and plans.** Prescription and plan hang off an encounter; creating them standalone invites orphan data.
- **Billing before packages.** A package is a priced plan; payment, balance and receipt logic must exist first and stay unchanged by packages.
- **Integrity checks before restore verification.** The restore flow reuses the same assertions; build once, use twice.
- **Reversal entries conflict with edit/delete of payments.** Do not offer both; choose append-only.
- **Webcam capture conflicts with plain-HTTP LAN.** Pick upload-only or commit to LAN HTTPS (a deployment decision, not a feature).

## MVP Definition

Scope is a fixed contract, so "MVP" here means "must exist for handover"; everything else is explicitly optional against the 4-6 week / Rs 22,000 limit.

### Launch With (v3.0 handover)

- [ ] Users, 3 roles, per-endpoint permission enforcement, password policy, idle timeout - Core Value
- [ ] Settings (clinic names/addresses, fee list) and doctor profiles - prerequisites for prints
- [ ] Patient registration with URN, search, profile edit with audit, duplicate warning - carry-over
- [ ] Patient photo upload (file-based) stored on server - in plan
- [ ] Appointments as per-doctor day list with token and status, doctor assignment - in plan
- [ ] Encounter with consultation notes (finalise + addendum) - clinical core
- [ ] Prescription with print (English + static Hindi labels) - daily need
- [ ] Treatment plan/package with immutable session log and VAS - carry-over
- [ ] Billing: consultation fee, instalment payments, balance, sequential receipts with print, reversal entry - carry-over + India need
- [ ] Registration card with dual-signature layout print - client approved
- [ ] Audit viewer, backup create + verify, restore (documented and rehearsed on clean machine), integrity check page - Core Value
- [ ] Role dashboards (counts only) - landing pages
- [ ] Concurrency guards (URN sequence, overpayment lock, optimistic update check) - multi-PC correctness
- [ ] Offline/LAN verification, restore rehearsal - handover gate

### Add After Validation (v3.x)

- [ ] VAS trend chart - once real session data exists
- [ ] Daily collection report and dues follow-up list - first month of cash reconciliation pain
- [ ] Missed-session list - after packages are in real use
- [ ] Canned Hindi advice library and home-exercise sheet - once doctors say which advice they repeat
- [ ] Treatment-plan templates - when doctors complain about retyping
- [ ] Printable patient summary - first referral/employer request
- [ ] Backup health banner - small, add if time at end of build

### Future Consideration (v4+)

- [ ] LAN HTTPS with webcam capture - only if client wants in-browser photo capture
- [ ] Document/report attachments (scans, X-ray images) - needs storage sizing and backup growth plan
- [ ] ABDM/ABHA, insurance, GST/80G receipts - separate scoped milestone and trust confirmation
- [ ] Exercise images/videos library - content effort larger than software effort
- [ ] Second-site replication - only if the two clinics are to run separate servers

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Auth + role permissions on API | HIGH | MEDIUM | P1 |
| Settings + doctor profiles | HIGH | LOW | P1 |
| Registration + URN + search | HIGH | MEDIUM | P1 |
| Photo upload | MEDIUM | MEDIUM | P1 |
| Appointment day list + tokens | HIGH | MEDIUM | P1 |
| Encounter + consultation notes | HIGH | MEDIUM | P1 |
| Prescription + print | HIGH | MEDIUM | P1 |
| Treatment plan + session log + VAS | HIGH | MEDIUM | P1 |
| Payments + balance + sequential receipts | HIGH | MEDIUM | P1 |
| Payment reversal entries | HIGH | MEDIUM | P1 |
| Audit log viewer | HIGH | MEDIUM | P1 |
| Backup + verified restore | HIGH | HIGH | P1 |
| Integrity checks | MEDIUM | MEDIUM | P1 |
| Registration card print (dual signature) | HIGH | MEDIUM | P1 |
| Concurrency guards | HIGH | MEDIUM | P1 |
| Patient timeline | HIGH | MEDIUM | P2 |
| Duplicate-patient warning | MEDIUM | LOW | P2 |
| VAS trend chart | MEDIUM | LOW | P2 |
| Daily collection report | HIGH | LOW | P2 |
| Dues follow-up list | MEDIUM | LOW | P2 |
| Bilingual advice snippets | MEDIUM | MEDIUM | P2 |
| Missed-session list | MEDIUM | LOW | P3 |
| Treatment-plan templates | LOW | LOW | P3 |
| Patient summary print | MEDIUM | MEDIUM | P3 |
| Exercise library | LOW | MEDIUM | P3 |
| CSV exports | LOW | LOW | P3 |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add when possible
- P3: Nice to have, future consideration

## Suggested Role Permission Catalogue (starting point)

| Permission | Admin | Reception | Doctor |
|-----------|:----:|:--------:|:-----:|
| user.manage, permission.manage, settings.manage, doctor.manage | Y | - | - |
| audit.view, backup.manage, restore.run, integrity.run | Y | - | - |
| patient.register, patient.edit, patient.photo | Y | Y | - |
| patient.view | Y | Y | Y |
| patient.archive | Y | - | - |
| appointment.manage | Y | Y | view own |
| encounter.create/edit/finalise, prescription.write, plan.manage, session.log | - (view only) | - | Y |
| clinical.view | Y | limited (plan name, sessions left) | Y |
| payment.record, receipt.print | Y | Y | - |
| payment.reverse, fee.manage | Y | - | - |
| report.daily_collection | Y | Y (own day) | - |
| report.dues | Y | Y | - |

Doctors should not see payment amounts beyond "package paid / balance exists" unless the trust wants it; confirm with client. Admin should not write clinical notes (keeps clinical authorship clean).

## Indian Small-Clinic Specifics

- **Receipts:** sequential, gap-free numbers; clinic name and address in English + Hindi; show amount in figures and words ("Rupees ... only"); mode of payment; balance after payment; cashier name; "DUPLICATE" mark on reprints. Display with Indian digit grouping (12,34,567) via `en-IN` formatting, while storing integer paise. Confirm whether the trust issues GST-exempt/non-GST receipts and whether 80G applies; do not guess.
- **Prescriptions:** doctor name, qualification, medical council registration number (Bihar), clinic address, date, patient name/age/sex/URN, Rx body, advice, signature space. Doctors commonly write advice in Hindi; support Devanagari input in text fields and ship local Devanagari fonts (e.g. Noto Sans Devanagari) with the app so print works offline. Tokens/serial numbers rather than timed slots for OPD.
- **Aadhaar:** do NOT store Aadhaar numbers or card images. Consider also not collecting other government IDs. If a field for "ID proof" is demanded, make it a free-text "ID type seen" tick without the number. Under DPDP Act 2023, collect only what the stated purpose needs, protect it, and be able to delete/export on request - supported by archive status plus backups, but note backups contain all data, so physically protect the backup media.
- **Mobile number:** primary secondary-identifier in India; validate 10 digits starting 6-9; allow a second contact (relative) since many patients share family phones; treat as non-unique.
- **Age vs DOB:** v2.0 stores integer age. Elderly rural patients often do not know DOB. Keep age as the entry field; optionally store `age_recorded_on` so age can be shown as recorded, not silently stale.
- **Name handling:** relation field ("S/o, W/o, D/o") is customary; the 12-field form is client-approved so do not alter it, but a profile-only optional "guardian name" is a low-risk addition if the client asks.
- **Dates and numbers:** DD/MM/YYYY display, 12-hour time on prints, IST fixed on the server (store timestamptz, render in Asia/Kolkata).
- **Power and hardware reality:** frequent power cuts - PostgreSQL on a UPS-backed server, fsync on, auto-start services on boot, backup to a second physical drive. Treat "server restarted unexpectedly" as a normal event and test it.
- **Printers:** likely a plain inkjet/laser A4 and maybe a thermal receipt printer; design receipts to work on A5/half-A4 first. Browser print dialog is acceptable; silent printing is not worth the effort.

## Competitor Feature Analysis

Structure observed (study only, no code to be copied; licences GPL/AGPL-family would apply to any reuse):

| Feature | OpenEMR | Open Hospital | ICTHospital | GNU Health | Our Approach |
|---------|---------|---------------|-------------|------------|--------------|
| Patient identity | Pubpid + demographics, many optional fields, Aadhaar-like IDs configurable | Patient with code, ward-centric | Registration with hospital ID | Party/Person with PUID, rich demographics | URN + 12 approved fields only; no government ID |
| Scheduling | Full calendar with categories, recurring slots | Basic admissions/OPD; no rich calendar | Token / appointment modules | Appointment object, calendar | Per-doctor day list with token and status |
| Clinical record | Encounter -> forms (SOAP, vitals, issues) | OPD visit and admission records | Consultation notes | Patient evaluation, health conditions, ICD coded | Encounter with simple structured fields + free text, finalise/addendum |
| Prescriptions | e-Rx, drug DB, interactions | Basic therapy records | Prescription print | Prescription with medicament DB | Free-text with local suggestion list, bilingual print |
| Billing | Fee sheet, billing codes, claims | Bills with items, payments, price lists | Billing and receipts | Invoice via accounting module | Integer-paise ledger, instalments, sequential receipts, reversal entries |
| Physio specific | Generic or none | None | None | Rehabilitation/physiotherapy sub-module (sessions, evaluations) | Plan/package + immutable session log + VAS (already proven) |
| Users / ACL | Phpgacl fine-grained | Profile-based groups | Role-based | Access groups per model | 3 roles, ~20 permission codes, API-enforced |
| Audit | Event log and ATNA | Minimal | Minimal | Via Tryton history | Append-only audit table with admin viewer |
| Backup | Documented manual dump | Manual | Manual | Manual database dump | Integrated bundle + verified restore (our differentiator in Core Value) |
| Weight | Very large | Mid-large | Mid | Very large | Deliberately small |

Takeaway: all four are broad and heavy; none give a small physio clinic a proven restore or a package-centred billing flow. Winning in this budget means doing the above narrow set correctly rather than matching their breadth.

## Sources

- Local project: `D:\dr-sr\.planning\PROJECT.md`; `D:\dr-sr\app\db\schema.sql`; `D:\dr-sr\app\services\` (patient, treatment, billing, auth, backup, doctor services - function signatures skimmed) for carry-over rules.
- Reference systems studied by domain knowledge of their module structure (no code read, no live fetch this session): OpenEMR, Open Hospital, ICTHospital, GNU Health. Verify details against current documentation before citing externally.
- Indian regulatory context (DPDP Act 2023, Aadhaar Act restrictions on private-entity storage, medical council registration on prescriptions, receipt practice): general knowledge, MEDIUM-LOW confidence; confirm with the trust's accountant/legal advisor, especially GST/80G status.

---
*Feature research for: small outpatient physiotherapy clinic management (LAN web app)*
*Researched: 2026-10-30*
