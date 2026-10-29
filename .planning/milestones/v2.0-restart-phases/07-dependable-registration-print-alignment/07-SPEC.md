# Phase 7 Specification: Dependable Registration & Print Layout Alignment

## 1. Objective
Harden the patient intake and registration subsystem to ensure 100% dependable data entry, audit tracking, photo handling, and pixel-faithful physical form reproduction matching Kalyan Hospital's active clinical pad.

---

## 2. Requirements & Traceability
- **PAT-01:** Atomic sequential URN generation (`KH-YYYY-XXXX`) via `id_sequences` table.
- **PAT-02:** Strict validation of 12 canonical fields:
  1. Serial / URN No.
  2. Patient Name
  3. Age (0–125)
  4. Sex (Male / Female / Other)
  5. Address (Vill/Street, District, PIN)
  6. Mobile Number (10 digits, validated)
  7. Patient In (Date & Time)
  8. Patient Out (Date & Time)
  9. Reference / Referred By
  10. Patient Condition (Diagnosis / Chief Complaint)
  11. Case / Number of Sessions
  12. Payment Details (Total Fee, Paid, Balance)
- **PAT-03:** Local photo handling: 35mm x 45mm ratio, local file copy into `data/photos/{URN}.ext` with placeholder fallback.
- **PAT-04:** Instant debounced search by URN, Name, or Mobile number (<50ms).
- **PAT-05:** Patient record editing with non-destructive updates.
- **AUD-01:** Audit logging of `PATIENT_REGISTERED`, `PATIENT_UPDATED`, and `PATIENT_ARCHIVED` events via `AuditService`.
- **PRN-01 & PRN-02:** A4 Print & PDF reproduction of authentic letterhead with maroon banner, Sri Vashishtha Kalyan Trust mark, dual doctors (Dr. Madan Mohan Dwivedi & Dr. Chandan Kr. Dwivedi), central Caduceus emblem, dotted leader lines for all 12 fields, and dual bottom signatures (*Patient / Attendant Signature* and *Authorized Signature* with Date).

---

## 3. Scope Boundaries
- **In Scope:**
  - Wire `AuditService` into `PatientService` (`register_patient`, `update_patient`, `archive_patient`).
  - Strengthen demographic validation (normalize spacing, validate phone number formatting, handle timestamps).
  - Verify `DocumentBuilder.build_patient_registration_html()` conforms to all 12 canonical fields, dotted lines, and dual signatures.
  - Regression and unit tests in `tests/test_patient_service.py` and `tests/test_document_builder.py`.
- **Out of Scope:**
  - Cloud synchronization or remote tele-health (prohibited by offline requirements).
  - Multi-PC LAN sharing (deferred to Phase 2).

---

## 4. Verification Criteria
1. Registering a patient persists demographic data and creates a corresponding `PATIENT_REGISTERED` audit record.
2. Updating an existing patient updates the record and creates a `PATIENT_UPDATED` audit record.
3. Invalid mobile numbers or negative/excessive ages are rejected with clear user-friendly error messages.
4. Generated registration HTML includes all 12 numbered fields, doctor credentials, and both signature blocks.
5. All automated tests pass cleanly.

