# Open Questions and Client Decisions

Do not resolve these items by assumption. Record the client's answer and update the permission map, tests, and documentation when applicable.

## Access and clinical policy

| ID | Question | Current implementation | Required next action |
|---|---|---|---|
| OQ-01 | Should Admin be able to view patient photographs? | Admin lacks PHOTO_READ; photo endpoint requires it | Obtain explicit client decision; then update role map/tests if approved |
| OQ-02 | Should Admin be able to edit patient demographics? | Admin lacks PATIENT_UPDATE; Reception has it | Obtain explicit client decision; then update role map/tests if approved |
| OQ-03 | Should doctors see only their own appointments/encounters, or may authorized doctors see cross-doctor records? | Strict doctor silo is implemented | Obtain clinical governance decision; preserve strict silo until approved otherwise |
| OQ-04 | What should happen to URN sequences when a registration is cancelled/voided? Are gaps acceptable? | Transactional annual allocator is implemented | Define void, cancellation, and gap policy before dependent workflows |

## Deployment and operations

| ID | Question | Current evidence | Required next action |
|---|---|---|---|
| OQ-05 | What LAN topology, static addressing, firewall rules, and server host are available? | Central server + browser clients is the architecture | Confirm actual clinic hardware/network and document deployment values |
| OQ-06 | Is HTTPS/TLS required on the clinic LAN, and how will certificates be managed offline? | Deployment-specific verification remains | Decide and test the selected transport configuration |
| OQ-07 | What UPS/power recovery behavior is required? | Power recovery is a Phase 17 acceptance item | Confirm UPS availability and restart expectations |
| OQ-08 | Which physical printer and paper configuration must be supported? | Registration A4 print spike recorded; final printer acceptance pending | Test on the target printer and capture acceptance |
| OQ-09 | Who owns backup media, retention, off-site handling, and restore authorization? | Database + patient-file backup/restore is planned | Agree retention, custody, schedule, and recovery responsibilities |

## Product and commercial acceptance

| ID | Question | Current evidence | Required next action |
|---|---|---|---|
| OQ-10 | What is the final signed-off scope for the remaining phases? | Phases 14–17 remain planned | Review scope, timeline, and budget separately from the earlier desktop MVP estimate |
| OQ-11 | What Hindi/English print formats and clinic identity details are final? | Clinic settings and registration print spike exist | Confirm exact print templates and content |
| OQ-12 | Who signs off clinical workflows and production acceptance? | No production acceptance is established by phase test counts | Name authorized clinical and operational approvers |
| OQ-14 | Who may authorize payment reversals? | Current permission catalogue reserves PAYMENT_REVERSE for Admin; billing is not implemented | Obtain written client approval before Phase 15; keep Admin-only as a provisional implementation baseline until confirmed |
| OQ-15 | Should receipt numbering reset by calendar year or financial year? | Receipt module is not implemented | Confirm numbering cycle before Phase 15 implementation |

## Data model and form reconciliation

| ID | Question | Current implementation | Required next action |
|---|---|---|---|
| OQ-13 | How should the client-provided registration form map to the patient API/database schema? | API currently stores full_name, guardian_name, gender, dob, age_years, mobile, address, district, state, emergency_contact, allergies and notes. The client form also includes patient in/out date-time, referred by, condition, session count and total/paid/balance amounts; these are not equivalent fields in the current PatientCreate schema. | Approve a field-by-field mapping. Decide which values belong to patient demographics, visit/encounter records, treatment plans or the future payment ledger. Do not make balance an editable patient field. |

## Status discipline

An item is closed only when the decision is recorded with its owner/date and any required code, tests, and documentation are updated. A verbal assumption or a permission enum is not closure evidence.
