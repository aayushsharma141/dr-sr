# Phase 12: Clinic Settings & Patient Registration - Context

**Gathered:** 2026-11-01  
**Status:** Ready for planning  

<domain>
## Phase Boundary

Phase 12 delivers clinic configuration, doctor profiles, consultation fee schedules, and full patient registration for the Kalyan Hospital LAN Platform.

Specifically:
- **Admin Settings (`SET-01`):** Bilingual clinic name (English & Hindi), dual clinic addresses, contact phone, receipt numbering sequence cycle toggle (Financial Year vs Calendar Year per D-05), and print header/footer.
- **Doctor Profiles (`SET-02`):** Doctor profiles including English name, Hindi name, qualification, and medical registration number.
- **Consultation Fees (`SET-03`):** Configurable consultation fee schedule stored as integer paise.
- **Patient Registration (`PAT-01`):** Reception registers patients with the 12 canonical demographic fields; atomic, gap-free, concurrency-safe `KH-YYYY-XXXX` URN allocation.
- **Patient Search (`PAT-02`):** Search by URN, mobile number, or name (supporting English and Hindi Devanagari text).
- **Patient Edit & Audit (`PAT-03`):** Reception edits patient demographics; optimistic concurrency control via `version_id` (409 ConflictBanner) and complete in-transaction audit trail (`AUD-01`).
- **Duplicate Warning (`PAT-04`):** Real-time duplicate warning during registration when matching name + mobile number.
- **Patient Photo Storage (`PAT-05`):** Secure photo upload, stored outside public directories, served exclusively through authenticated, authorized endpoints (`GET /api/patients/{id}/photo`).
- **Registration Card Print Spike (`PRN-01` prep):** Grounding A4 dual-signature print layout with bundled Devanagari font.

</domain>

<decisions>
## Implementation Decisions

### 1. URN Sequence & Concurrency (D-12-01)
- **Format:** `KH-YYYY-XXXX` (e.g. `KH-2026-0001`), where `YYYY` is the current calendar year and `XXXX` is a 4-digit zero-padded sequential integer restarting at 0001 each year.
- **Concurrency Guarantee:** Atomic sequence generation inside the registration transaction using `pg_advisory_xact_lock` or a year-scoped counter table with `SELECT ... FOR UPDATE`, guaranteeing strictly zero duplicate URNs and zero gaps under parallel registration.

### 2. Canonical 12 Patient Fields (D-12-02)
The registration schema enforces the canonical fields established in the clinic domain specification:
1. `urn` (string, unique, format `KH-YYYY-XXXX`)
2. `full_name` (string, 2–120 chars, Unicode Devanagari + English)
3. `guardian_name` (string, 2–120 chars, S/o, W/o, D/o)
4. `gender` (enum: `M`, `F`, `O`)
5. `dob` / `age_years` (integer age with optional date of birth)
6. `mobile` (10-digit Indian mobile number: `^[6-9]\d{9}$`)
7. `address` (street / village / mohalla)
8. `district` (string, default "Bhojpur")
9. `state` (string, default "Bihar")
10. `emergency_contact` (optional contact name and phone)
11. `allergies` (text, default "None reported")
12. `notes` (text, non-clinical registration remarks)

### 3. Patient Photo Storage & Access Control (D-12-03)
- Stored on server filesystem under `backend/var/photos/<uuid>.jpg` (never in `frontend/dist` or public web root).
- Files validated on upload (JPEG/PNG only, max 5 MB).
- Served only through `GET /api/patients/{id}/photo` which requires active session and `patients:read` permission. Direct unauthorized access returns 401/403.

### 4. Duplicate Warning Non-Blocking Flow (D-12-04)
- Duplicate detection matches normalized `full_name` (case-insensitive, whitespace-collapsed) and `mobile`.
- Warns reception proactively without hard-blocking: UI presents duplicate warning with existing patient's URN, allowing confirmation checkbox ("Confirm new registration") to proceed when justified.

### 5. Registration Card Print Spike (D-12-05)
- Standard A4 `@media print` CSS layout with mm-based positioning.
- Features bilingual hospital letterhead, patient URN, barcode/QR code representation, and dual-signature area:
  - Patient / Attendant Signature
  - Authorized Hospital Signatory

### Claude's Discretion
- Table design for `clinic_settings`, `consultation_fees`, and `patients`.
- Alembic migration `0002_clinic_settings_and_patients.py`.
- Frontend search component debouncing (300ms) and keyboard navigation.

</decisions>

<canonical_refs>
## Canonical References

### Project Specifications & Roadmap
- `.planning/PROJECT.md` — Core hospital constraints, Bhojpur/Ara local context.
- `.planning/REQUIREMENTS.md` — Requirements SET-01, SET-02, SET-03, PAT-01, PAT-02, PAT-03, PAT-04, PAT-05.
- `.planning/ROADMAP.md` § Phase 12 — Phase 12 success criteria and scope.
- `.planning/phases/11-decisions-gate-foundation-auth/11-ENTRY-GATE.md` — Locked decisions D-01 through D-08.

### Domain Reference
- `app/db/schema.sql` (v2.0): Legacy `patients` table structure, indexes, and demographic columns.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Architecture from Phase 11
- `backend/src/kalyan_api/models.py`: `Doctor` model already defined with `name_en`, `is_active`, and `version_id`.
- `backend/src/kalyan_api/services/audit_service.py`: Standard `audit_service.record(...)` available for logging `PATIENT_REGISTERED`, `PATIENT_UPDATED`, `SETTINGS_UPDATED`, `DOCTOR_UPDATED`.
- `backend/src/kalyan_api/core/scope.py`: Doctor silo scoping helper `check_doctor_patient_access`.
- `frontend/src/components/ConflictBanner.tsx`: Ready for optimistic locking 409 handling on patient and settings forms.
- `frontend/src/api/client.ts`: Automatic CSRF token injection and error handling.

</code_context>

<specifics>
## Specific Ideas
- Reception dashboard should feature a quick search bar and a "Register New Patient" primary action button.
- Doctor profiles include consultation fees in paise for integration with billing in Phase 15.
- Patient list table with pagination, sorting by registration date, and direct actions (View, Edit, Print Card).

</specifics>

<deferred>
## Deferred Ideas
- Webcam live capture in browser deferred to FUT-01 (requires HTTPS or browser flag; photo upload works offline via file selector).
- Barcode scanner hardware integration tested in Phase 17.

</deferred>

---

*Phase: 12-Clinic Settings & Patient Registration*
