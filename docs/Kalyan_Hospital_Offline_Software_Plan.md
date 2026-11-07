# Kalyan Hospital Offline Patient & Physiotherapy Management Software

## Consolidated Project Plan and MVP Specification

**Project:** Kalyan Hospital --- Patient & Physiotherapy Management
System\
**Organization:** श्री वशिष्ठ कल्याण ट्रस्ट\
**Address supplied:** स्टेशन रोड, नवादा थाना के सामने वाली गली, आरा, भोजपुर,
बिहार\
**Budget ceiling:** ₹22,000\
**Target delivery:** 4--6 weeks\
**Deployment target:** Windows desktop, fully offline for normal
operation\
**Developer model:** Solo developer using AI coding tools\
**Status:** Planning specification --- features and workflow must be
approved by the client before implementation.

------------------------------------------------------------------------

## 1. Project objective

Build a clean, minimal, reliable offline desktop application for
hospital patient registration, OPD management, doctor/department-based
clinical records, physiotherapy sessions, payment tracking, printing,
and local backup/restore.

The application should be easy for reception staff and doctors to learn.
The main focus is a polished dashboard and a fast, well-organized
patient registration form. The application must not require internet
access for normal day-to-day operation.

**Important budget constraint:** ₹22,000 is a fixed ceiling, not a
reason to promise unlimited functionality. Freeze the MVP scope in
writing before coding. Advanced features and major scope changes should
be excluded or separately priced.

## 2. Hospital and form details

### Hospital identity

-   **Hospital:** KALYAN HOSPITAL
-   **Operated by:** श्री वशिष्ठ कल्याण ट्रस्ट
-   **Address:** स्टेशन रोड, नवादा थाना के सामने वाली गली, आरा, भोजपुर, बिहार
-   Obtain and use the client's real logo and confirm final spelling,
    address, contact details, and preferred application language before
    finalizing print layouts.

### Existing registration form fields

The supplied form details include:

-   Serial / URN number
-   Patient photograph
-   Patient name
-   Age and sex
-   Address and mobile number
-   Patient in date and time
-   Patient out date and time
-   Reference / referred by
-   Patient condition
-   Number of sessions
-   Total amount
-   Amount paid
-   Balance amount
-   Authorized signature and date

The patient/attendant signature field was specifically excluded from the
proposed form. Preserve this requirement unless the client changes it in
writing.

Confirm whether patient in/out fields mean OPD check-in/check-out or
something else. Do not assume that these fields represent hospital
admission/discharge.

------------------------------------------------------------------------

## 3. Core product principles

1.  **Offline first:** local database, local photos, local printing, and
    local backups.
2.  **One shared patient identity:** do not create duplicate patient
    identities merely because a patient visits two departments.
3.  **Doctor/department separation:** each doctor should have a distinct
    department-based view of their clinical cases and notes.
4.  **Shared OPD registration:** registration should be completed once,
    then linked to the relevant doctor/department.
5.  **Shared payments:** payment entry and collection reporting should
    use a common billing/payment ledger, with department and doctor
    attribution where needed.
6.  **Minimal UI:** clear hierarchy, consistent spacing, limited colors,
    readable labels, and few steps for common tasks.
7.  **Safe record handling:** no silent loss of treatment history or
    payment history when patient demographics are edited.
8.  **Tested backup and restore:** a backup feature is incomplete until
    a restore has been tested.
9.  **Scope control:** features, reports, roles, print formats, and
    acceptance tests must be agreed before development.

## 4. UI/UX direction: clean and minimal

### Visual style

-   Calm, professional clinical interface.
-   White or very light neutral backgrounds with one restrained primary
    accent color.
-   Clear typography and consistent spacing.
-   Simple icons paired with text labels.
-   Avoid excessive cards, gradients, animations, decorative charts, and
    unnecessary visual clutter.
-   Use tables for patient lists and structured sections for patient
    details.
-   Show clear save status, validation messages, and confirmation
    prompts for destructive actions.
-   Make the application usable at the hospital computer's confirmed
    screen resolution.

### Main navigation

Recommended left sidebar:

1.  Dashboard
2.  Register Patient
3.  Patients
4.  OPD / Visits
5.  Doctors & Departments
6.  Treatment Sessions
7.  Payments
8.  Reports
9.  Backup & Restore
10. Settings / Users

Only show navigation items that are actually included in the approved
MVP and available to the logged-in user's role.

### Dashboard --- primary UI priority

The dashboard should answer: what is happening today, what needs
attention, and what action should staff take next?

Recommended elements:

-   **Primary action:** `+ Register Patient`
-   Today's OPD registrations
-   Today's patients by department/doctor
-   Total active treatment cases
-   Sessions scheduled or due today, if appointment/session scheduling
    is included
-   Outstanding balances, if billing reports are included
-   Recent patient registrations
-   Recent payments
-   Quick search by patient ID/URN, name, or mobile number
-   Optional date filter for daily operational reports

Keep the dashboard compact. Use only counts that can be calculated
accurately from saved records. Avoid decorative charts unless they
support a real operational need. Dashboard totals must distinguish
unique patients, OPD visits, department cases, and payment transactions.

### Patient list

-   Search by patient ID/URN, patient name, or mobile number.
-   Filters for date, doctor/department, and active/completed status
    where relevant.
-   Show essential columns only: patient ID, name, age/sex if approved,
    mobile, visit date, department/doctor, and status.
-   Provide clear actions to open a profile, start a new visit, add a
    payment, or print the approved form.
-   Use pagination or a performant table if the record count grows.
-   Avoid deleting clinical or payment history when correcting patient
    details.

------------------------------------------------------------------------

## 5. Patient registration form

The registration form is one of the most important screens and should be
designed for quick, low-error data entry.

### Recommended form layout

#### A. Patient identity

-   Automatically generated unique patient ID / URN
-   Patient full name
-   Date of birth or age, based on the client's approved form
-   Sex, using approved options
-   Mobile number
-   Address
-   Patient photo

#### B. OPD visit details

-   Visit/OPD number, if a separate visit number is required
-   Registration date and time, automatically populated and editable
    only if authorized
-   Referring person / referred by
-   Patient condition or presenting complaint, if this is part of the
    approved workflow
-   Department
-   Doctor assigned
-   Visit status, such as registered, in progress, or completed, if
    required

#### C. Fee summary

-   Consultation / visit fee, if applicable
-   Total amount due
-   Amount paid
-   Balance, calculated automatically
-   Payment method and payment date when recording a payment
-   Receipt number if receipt printing is included

**Data design rule:** keep registration data, visit data, clinical case
data, and payment transactions as separate related records. A single
registration form may show a fee summary, but it should not overwrite
historical payments when an amount changes.

### Webcam-accessible patient photo

The registration screen should support:

1.  **Capture Photo** --- request access to the computer's webcam.
2.  Show a live camera preview.
3.  Capture a still image.
4.  Preview the captured photo.
5.  Allow Retake and Save.
6.  Allow selecting an existing photo file as a fallback.
7.  Display a clear message if no camera is connected, the camera is
    busy, or permission is denied.
8.  Save the image locally and link it to the patient's unique ID.
9.  Resize/compress photos to a sensible size so the local database and
    backups do not grow unnecessarily.
10. Keep the application usable when the webcam is unavailable.

The webcam must work without internet. Camera access should be requested
only when the user activates the camera feature. Test the actual camera
on the target Windows machine before delivery.

**Privacy:** tell staff when a photo is being captured, avoid capturing
images automatically, and obtain the hospital's approval for its
patient-photo consent and retention process. Do not store photo binaries
inside the main SQLite database unless there is a specific reason; a
managed local image folder with database references is usually simpler.

------------------------------------------------------------------------

## 6. Two doctors and two departments

The hospital has two doctors working in different departments. The exact
names, specialties, and department labels still need to be confirmed by
the client.

### Required behavior

-   Both doctors use the same hospital application and shared patient
    registration process.
-   OPD registration is completed once for a visit, not duplicated for
    each doctor.
-   The visit is assigned to the appropriate department and doctor.
-   Each doctor has a doctor-specific patient/case view.
-   Each doctor can access the clinical cases assigned to their
    department according to the agreed permissions.
-   Clinical notes, assessment, treatment plan, and sessions are
    associated with the relevant doctor/department case.
-   The same patient can attend both departments without creating a
    duplicate patient identity.
-   A patient profile should show relevant visit history across
    departments, subject to the user's permissions.
-   Shared payments can be attributed to a visit, department, or doctor
    for reporting, where required.
-   Reports should distinguish unique patients from visits and
    department cases.

### Recommended data model

Use a shared patient record and linked clinical/administrative records:

-   **Patient:** core identity and demographics; one unique patient ID.
-   **OPD Visit:** date/time, visit number if needed, department,
    assigned doctor, referral, visit status, and other visit-specific
    details.
-   **Doctor:** doctor name, specialty/department, active status, and
    access configuration.
-   **Department:** department name and active status.
-   **Clinical Case / Treatment Episode:** patient, department,
    responsible doctor, presenting complaint, assessment, plan, status,
    and related notes.
-   **Treatment Session:** linked to the relevant case, with date,
    session number, notes, and status.
-   **Payment:** amount, date/time, method, receipt reference, and link
    to the relevant patient/visit or bill.
-   **User / Role:** application login and permissions.
-   **Audit Event:** important changes, actor, timestamp, action, and
    affected record where audit logging is included.

This structure is preferable to creating two separate databases or
separate patient records for each doctor. It allows shared registration
and billing while keeping clinical workflows separated.

### Example workflow

1.  Reception searches for an existing patient or registers a new
    patient.
2.  The application generates the patient ID and records the OPD visit.
3.  Reception selects the department and assigned doctor.
4.  The doctor opens their department-specific queue or case list.
5.  The doctor adds clinical notes and treatment/session information.
6.  Reception records a payment in the shared payment module.
7.  The application updates the balance and, if included, prints a
    receipt.
8.  The patient history retains both department visits and the relevant
    clinical/payment history.

### Permissions to define

Confirm whether the doctors can see each other's clinical notes, whether
reception can view clinical details, and who can correct or void a
payment. These are policy decisions, not assumptions to hard-code.

------------------------------------------------------------------------

## 7. Payment management

### Shared payment workflow

-   One common payment module for the hospital.
-   Payment linked to the patient and, where relevant, the OPD visit or
    bill.
-   Support partial payments if approved.
-   Calculate outstanding balance from saved billing and payment
    entries.
-   Store payment date, amount, method, receipt reference, and the user
    who recorded it where appropriate.
-   Attribute payments to department/doctor when required for reports.
-   Never silently delete a payment; use an authorized correction or
    reversal workflow and retain history where audit logging is
    included.

### Possible reports

Include only those approved for the MVP:

-   Daily collection
-   Payments by date range
-   Outstanding balances
-   Payments by department/doctor
-   Receipt reprint or lookup
-   Patient payment history

A single payment must not be counted twice when reporting hospital-wide
collections and department totals.

------------------------------------------------------------------------

## 8. Clinical and treatment management

Proposed basic capabilities:

-   Department/doctor-specific clinical case view
-   Presenting complaint or patient condition
-   Assessment and treatment plan, based on the hospital's workflow
-   Treatment session dates and notes
-   Total and completed session counts
-   Next appointment/session date, if required
-   Case status such as active or completed
-   Patient's prior visit and case history, subject to permissions

Do not invent medical fields or clinical scoring systems without the
hospital's input. The application is for recording authorized staff
input, not automatically diagnosing or recommending treatment.

------------------------------------------------------------------------

## 9. Printing and reports

Potential deliverables, subject to approval:

-   Patient registration form in the hospital's approved A4 format
-   Patient profile or visit summary
-   Payment receipt
-   Daily OPD list
-   Doctor/department-wise OPD report
-   Treatment session report
-   Daily collection and outstanding balance report
-   PDF export using local software libraries

The patient/attendant signature field should remain excluded from the
registration printout unless the client explicitly changes this
requirement. Confirm logo, language, margins, paper size, and signature
placement using an approved sample before implementation.

------------------------------------------------------------------------

## 10. Offline technology proposal

This is a recommended implementation approach, not a client-approved
technical decision.

  -----------------------------------------------------------------------
  Area                                Proposed approach
  ----------------------------------- -----------------------------------
  Platform                            Windows desktop

  UI framework                        Python with PySide6

  Database                            SQLite on the local computer

  Patient images                      Managed local image folder with
                                      database references

  Webcam                              Local camera access through a
                                      suitable desktop camera library

  Printing                            Local printer integration and PDF
                                      generation

  Packaging                           Packaged Windows application with
                                      required dependencies

  Data protection                     Password hashing, application-level
                                      permissions, input validation, and
                                      appropriate file-system protections

  Backup                              Consistent local database backup to
                                      a separate drive/USB

  Network/cloud                       No cloud or internet requirement
                                      for normal use
  -----------------------------------------------------------------------

Before committing to the stack, review the selected open-source
repositories, their licenses, dependency health, and Windows packaging
constraints. Do not blindly merge entire codebases. Reuse only
components or patterns that are maintainable and appropriately licensed.

### Offline verification

Test that the installed application can, without internet access:

-   Start and log in
-   Register and search patients
-   Save and retrieve records
-   Capture photos from the connected webcam
-   Record doctor/department cases and payments
-   Print using the local printer
-   Create and restore backups
-   Reopen saved records after application restart

Webcam access requires a physically available and supported camera.
Printing requires a working local printer or PDF destination.

------------------------------------------------------------------------

## 11. Security, privacy, and reliability

Minimum implementation and test expectations:

-   Secure password hashing; never store plain-text passwords.
-   Application-level role and permission checks.
-   Separate roles or permissions for administrator, reception, and
    doctors if approved.
-   Validation of required fields and numeric payment values.
-   Protection against accidental duplicate registrations where
    practical.
-   Referential integrity between patients, visits, cases, sessions, and
    payments.
-   Clear confirmation for destructive actions.
-   A defined correction/reversal approach for important records and
    payments.
-   Audit history of important changes if included in the agreed scope.
-   Local backup and verified restore procedure.
-   Keep backups separate from the primary computer when possible.
-   Test application behavior after unexpected shutdown or interrupted
    writes.
-   Use dummy records during development and testing.

Offline operation does not itself guarantee security or prevent data
loss. Do not claim that the software is tamper-proof or certified unless
it has actually been designed, assessed, and verified to meet that
claim.

------------------------------------------------------------------------

## 12. Recommended MVP scope for ₹22,000

The following is a proposed fixed-price scope to negotiate and approve.

### Include

-   Single-computer offline Windows desktop application
-   Clean, minimal dashboard
-   Patient registration with unique ID and search
-   Webcam photo capture plus file-selection fallback
-   Shared patient profile
-   Two configurable doctors/departments
-   Shared OPD registration workflow
-   Doctor/department-based case lists and basic clinical case/session
    tracking
-   Shared payment entry and balance calculation
-   Approved registration printout
-   A limited set of agreed reports
-   Administrator login and basic role restrictions
-   Manual local backup and tested restore
-   Installation, basic user training, and handover

### Exclude unless separately agreed

-   Multi-computer networking or simultaneous multi-user access
-   Cloud sync, remote access, mobile apps, or web hosting
-   Online payments, SMS, WhatsApp, or third-party integrations
-   Pharmacy, inventory, payroll, full accounting, insurance claims, or
    laboratory modules
-   Advanced clinical decision support or outcome-scoring systems
-   Large-scale legacy-data migration and manual entry of historical
    records
-   Unlimited revisions, indefinite support, or new features after
    acceptance
-   Formal certification or guarantees of compliance that have not been
    assessed

**Scope warning:** a secure, audited, multi-user clinical system can
exceed this budget. If the client requires extensive audit controls,
advanced security, many reports, or complex cross-department
permissions, reduce the MVP or negotiate a higher price.

------------------------------------------------------------------------

## 13. Delivery plan --- 4 to 6 weeks

The schedule assumes timely client responses, a working Windows
computer/webcam/printer for testing, and prompt approval of the form and
workflow.

### Week 1 --- Requirements and design

-   Confirm both doctors' names, specialties, and department labels.
-   Confirm registration and payment rules.
-   Approve the patient form, dashboard priorities, and print format.
-   Define roles and cross-department access.
-   Review repository licenses and choose the implementation stack.
-   Approve database model and acceptance criteria.

### Week 2 --- Database and core UI

-   Build the application shell and navigation.
-   Implement login and basic permissions.
-   Implement patient registration, unique IDs, search, and patient
    profiles.
-   Build the initial dashboard.

### Week 3 --- Webcam and department workflow

-   Implement camera preview, capture, retake, and file-upload fallback.
-   Implement OPD visit assignment to doctor/department.
-   Implement doctor-specific case lists.
-   Implement basic clinical case and session records.

### Week 4 --- Payments and printouts

-   Implement shared payment entry and balance calculation.
-   Implement agreed receipt and registration print layouts.
-   Implement the agreed reports.
-   Add local backup/restore.

### Week 5 --- Testing and refinement

-   Test the dashboard and form with staff feedback.
-   Test webcam behavior on the target machine.
-   Test permissions, cross-department behavior, and payment
    calculations.
-   Test printing, offline operation, backup, and restore.
-   Fix defects within the agreed scope.

### Week 6 --- Acceptance and handover

-   Run client acceptance tests using dummy data.
-   Install the packaged application.
-   Train the designated staff.
-   Deliver usage and backup instructions.
-   Hand over the agreed deliverables and support terms.

------------------------------------------------------------------------

## 14. Acceptance tests

Before the hospital begins using real patient data, verify:

1.  A new patient receives a unique ID.
2.  Existing patients can be found and opened without creating duplicate
    profiles unnecessarily.
3.  A webcam photo can be captured, previewed, retaken, saved, and
    retrieved.
4.  Registration still works when no webcam is available.
5.  One patient can have visits in both departments without duplicate
    patient identities.
6.  Each doctor sees the appropriate department-specific cases under the
    approved permission rules.
7.  Payments entered through the shared workflow update the correct
    balance.
8.  Hospital-wide and department-wise payment reports do not
    double-count transactions.
9.  Clinical sessions and prior history remain intact after demographic
    edits.
10. Approved registration forms and receipts print correctly on the
    target setup.
11. The essential workflow works with the internet disconnected.
12. A backup can be created and restored to a test location with records
    verified.
13. Unauthorized actions are blocked by application-level permissions.
14. The application can be closed and reopened without losing saved
    data.

------------------------------------------------------------------------

## 15. Commercial proposal

**Maximum proposed fixed price:** ₹22,000, subject to the signed MVP
scope.

Illustrative payment milestones:

  Milestone                                Percentage        Amount
  -------------------------------------- ------------ -------------
  Advance after written scope approval            40%        ₹8,800
  Working MVP demonstration                       30%        ₹6,600
  Testing and user acceptance                     20%        ₹4,400
  Final installation and handover                 10%        ₹2,200
  **Total**                                  **100%**   **₹22,000**

These are proposed terms, not confirmed client commitments. Agree in
writing on acceptance criteria, revision limits, defect-fixing period,
post-delivery support, and the handling of new features.

------------------------------------------------------------------------

## 16. Client information still required

Before development starts, collect and approve:

-   Exact names and specialties of both doctors
-   Exact department names
-   Which doctors can view which clinical records
-   Whether reception staff can view clinical notes
-   Whether payments are assigned to a visit, department, or doctor for
    reporting
-   Whether the same patient can be registered in both departments on
    the same day
-   Windows version and target computer specifications
-   Webcam availability and model, if known
-   Printer model and approved print sample
-   Hospital logo, contact details, and language preference
-   Required reports and receipts
-   Existing records to migrate, if any
-   Backup destination and expected frequency
-   Required roles and permissions
-   Client-approved MVP scope, delivery date, and support terms

------------------------------------------------------------------------

## 17. Immediate next steps

1.  Send the client the requirements questionnaire.
2.  Confirm the two doctors, department names, and access rules.
3.  Obtain approval for the shared registration and payment workflow.
4.  Approve the clean dashboard and registration-form wireframes.
5.  Identify and review the three intended GitHub repositories,
    including license terms.
6.  Freeze the schema and written MVP scope.
7.  Begin implementation only after scope and initial payment are
    approved.

## Final recommendation

Build one offline desktop application with **one shared patient
identity, shared OPD registration and payment handling, and separate
doctor/department-based clinical views**. Prioritize a clean dashboard,
fast registration, reliable webcam photo capture, clear patient
profiles, correct payment calculations, and tested backup/restore.

Keep the UI minimal and the data model structured. Do not create
separate disconnected patient databases for the two doctors, and do not
promise features beyond the signed MVP scope.
