# Phase 12: Clinic Settings & Patient Registration — Research & Architecture

**Created:** 2026-11-01  
**Phase:** 12-clinic-settings-patient-registration  
**Status:** Approved for planning  

---

## 1. Executive Summary & Goals

Phase 12 builds upon the authentication, RBAC, session management, and audit foundation established in Phase 11. It implements the core administrative clinic configuration and reception patient registration workflows:
1. **Clinic Settings (`SET-01`):** Singleton configuration entity storing bilingual clinic identity (English & Hindi), contact details, print headers/footers, and financial year vs calendar year receipt numbering preferences.
2. **Doctor Profiles & Fee Schedule (`SET-02`, `SET-03`):** Doctor profiles with medical registration numbers, qualifications, and consultation fee schedules in integer paise.
3. **Patient Registration & Concurrency (`PAT-01`):** Reception patient intake with the 12 canonical fields, producing gap-free, atomic `KH-YYYY-XXXX` URNs proven under 20 parallel registrations.
4. **Fast Patient Search (`PAT-02`):** Multi-modal search by URN, 10-digit mobile number, and patient name (including Devanagari Hindi text).
5. **Patient Modification & Audit (`PAT-03`):** Optimistic concurrency protection (`version_id` + HTTP 409 ConflictBanner) with full in-transaction audit trail (`AUD-01`).
6. **Duplicate Warning (`PAT-04`):** Non-blocking duplicate detection on matching name + mobile number.
7. **Secure Patient Photo Management (`PAT-05`):** Protected filesystem storage outside the public web tree, served only through authenticated and authorized endpoints.
8. **Registration Card Print Spike (`PRN-01` prep):** Grounding the A4 print layout early with hospital header, QR/barcode, and patient/doctor dual-signature sections.

---

## 2. Requirements & Acceptance Criteria

| Req ID | Description | Acceptance Criteria |
|---|---|---|
| **SET-01** | Clinic Details Configuration | Admin can update English & Hindi clinic names, both addresses, phone, and print header/footer; settings are loaded across the app and print templates. |
| **SET-02** | Doctor Profiles | Admin maintains doctor profiles including English name, Hindi name, qualification, and council registration number. |
| **SET-03** | Consultation Fee List | Admin manages consultation fee rates stored as integer paise. |
| **PAT-01** | Canonical Registration & Atomic URN | 12 canonical demographic fields; 20 parallel registration requests generate gap-free, strictly unique `KH-YYYY-XXXX` URNs. |
| **PAT-02** | Multi-Modal Search | Reception and Doctors can search by exact URN, mobile number, or full name (English and Hindi Devanagari). |
| **PAT-03** | Demographic Modification & Audit | Demographic edits require `version_id`; stale concurrent edits return HTTP 409; all modifications produce `AUD-01` audit entries with before/after diffs. |
| **PAT-04** | Duplicate Warning | Registration proactively warns if a patient with the same normalized name and mobile exists, requiring user confirmation to proceed. |
| **PAT-05** | Secure Photo Upload & Retrieval | Patient photos uploaded as JPEG/PNG, stored in `backend/var/photos/`, and served strictly through an authenticated endpoint (`GET /api/patients/{id}/photo`). |

---

## 3. Data Architecture & Database Schema

A new Alembic migration (`0002_clinic_settings_and_patients.py`) will establish the following tables:

### 3.1 `clinic_settings` (Singleton Table, id=1)
```sql
CREATE TABLE clinic_settings (
    id BIGINT PRIMARY KEY DEFAULT 1,
    name_en VARCHAR(120) NOT NULL DEFAULT 'Kalyan Hospital',
    name_hi VARCHAR(120) NOT NULL DEFAULT 'कल्याण हॉस्पिटल',
    address_1 VARCHAR(255) NOT NULL,
    address_2 VARCHAR(255),
    phone VARCHAR(64) NOT NULL,
    email VARCHAR(120),
    receipt_sequence_cycle VARCHAR(16) NOT NULL DEFAULT 'FINANCIAL_YEAR', -- 'FINANCIAL_YEAR' or 'CALENDAR_YEAR'
    print_header_en TEXT,
    print_header_hi TEXT,
    print_footer_en TEXT,
    print_footer_hi TEXT,
    consultation_validity_days INTEGER NOT NULL DEFAULT 7,
    version_id INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_clinic_settings_singleton CHECK (id = 1),
    CONSTRAINT ck_clinic_settings_cycle CHECK (receipt_sequence_cycle IN ('FINANCIAL_YEAR', 'CALENDAR_YEAR'))
);
```

### 3.2 Additions to `doctors`
Update existing `doctors` table:
```sql
ALTER TABLE doctors ADD COLUMN name_hi VARCHAR(120);
ALTER TABLE doctors ADD COLUMN qualification VARCHAR(120);
ALTER TABLE doctors ADD COLUMN registration_number VARCHAR(64);
ALTER TABLE doctors ADD COLUMN default_fee_paise INTEGER NOT NULL DEFAULT 0;
```

### 3.3 `consultation_fees` (Fee Schedules)
```sql
CREATE TABLE consultation_fees (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    fee_paise INTEGER NOT NULL CHECK (fee_paise >= 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 3.4 `urn_sequences` (Atomic Year-Scoped Counter)
```sql
CREATE TABLE urn_sequences (
    year INTEGER PRIMARY KEY,
    last_seq INTEGER NOT NULL DEFAULT 0
);
```

### 3.5 `patients` (Demographics & Medical Alerts)
```sql
CREATE TABLE patients (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    urn VARCHAR(32) NOT NULL UNIQUE,
    full_name VARCHAR(120) NOT NULL,
    guardian_name VARCHAR(120) NOT NULL,
    gender VARCHAR(1) NOT NULL CHECK (gender IN ('M', 'F', 'O')),
    dob DATE,
    age_years INTEGER NOT NULL CHECK (age_years >= 0 AND age_years <= 150),
    mobile VARCHAR(15) NOT NULL,
    address TEXT NOT NULL,
    district VARCHAR(64) NOT NULL DEFAULT 'Bhojpur',
    state VARCHAR(64) NOT NULL DEFAULT 'Bihar',
    emergency_contact VARCHAR(120),
    allergies TEXT NOT NULL DEFAULT 'None reported',
    notes TEXT,
    photo_path VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    version_id INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Search and uniqueness indexes
CREATE INDEX ix_patients_urn ON patients(urn);
CREATE INDEX ix_patients_mobile ON patients(mobile);
CREATE INDEX ix_patients_full_name ON patients(full_name);
CREATE INDEX ix_patients_name_mobile ON patients(lower(trim(full_name)), mobile);
```

---

## 4. Key Mechanisms & Implementation Patterns

### 4.1 Atomic Gap-Free URN Generation (`KH-YYYY-XXXX`)
Under PostgreSQL, atomic sequential generation without duplicates is achieved via row-level locking on `urn_sequences`:
```python
def allocate_next_urn(session: Session, year: int) -> str:
    # Row lock for the current year counter
    seq_row = session.execute(
        select(UrnSequence)
        .where(UrnSequence.year == year)
        .with_for_update()
    ).scalar_one_or_none()
    
    if not seq_row:
        session.execute(
            insert(UrnSequence).values(year=year, last_seq=1)
        )
        next_val = 1
    else:
        next_val = seq_row.last_seq + 1
        seq_row.last_seq = next_val
        
    return f"KH-{year}-{next_val:04d}"
```
This is fully tested by spawning 20 concurrent threads attempting patient registration in parallel; all 20 must produce unique consecutive URNs.

### 4.2 Photo Storage & Streaming Endpoint
- **Upload:** `POST /api/patients/{id}/photo` (multipart form).
- Validates file signature (magic bytes for JPEG `FF D8 FF` / PNG `89 50 4E 47`).
- Writes to `backend/var/photos/{patient_id}_{uuid}.jpg`.
- Updates `patients.photo_path`.
- **Stream:** `GET /api/patients/{id}/photo`:
  - Enforces `RequireAuth` + `patients:read`.
  - Returns `FileResponse` with `Cache-Control: private, no-cache`.
  - Non-authenticated requests return 401.

### 4.3 Duplicate Warning Mechanism
A dedicated check endpoint:
`GET /api/patients/check-duplicate?name={name}&mobile={mobile}`
Returns:
```json
{
  "has_duplicate": true,
  "existing_patient": {
    "urn": "KH-2026-0001",
    "full_name": "Ramesh Kumar",
    "guardian_name": "Suresh Kumar",
    "created_at": "2026-11-01T10:00:00Z"
  }
}
```
If duplicate exists, the frontend registration form renders a warning alert with a checkbox:
`[ ] Confirm this is a new patient with identical details`
Without this checkbox checked, the registration button remains disabled when a duplicate is flagged.

### 4.4 Print Spike for Registration Card (`PRN-01` Prep)
- A dedicated printable component `RegistrationCard.tsx`.
- CSS `@media print` with:
  - `@page { size: A4; margin: 15mm; }`
  - Bilingual clinic header from `clinic_settings`
  - Barcode / QR display using SVG
  - Structured demographic table (URN, Name, Guardian, Age/Gender, Mobile, Address)
  - Medical alerts section (Allergies in high-contrast box)
  - Dual signature lines at bottom:
    `Patient / Attendant Signature` | `Authorized Hospital Signatory`

---

## 5. Security & Threat Modeling (STRIDE)

| Threat ID | Category | Component | Mitigation Plan |
|---|---|---|---|
| **T-12-01** | Information Disclosure | Patient Photos | Photos stored outside web root (`backend/var/photos/`); served only via authenticated API with session validation. |
| **T-12-02** | Elevation of Privilege | Clinic Settings | Only `ADMIN` can update clinic settings and fee schedules (`settings:write` permission). |
| **T-12-03** | Tampering | Stale Patient Updates | Optimistic locking on `patients` (`version_id`); stale update returns 409 and prompts user to reload. |
| **T-12-04** | Repudiation | Patient Modifications | `audit_service.record(...)` captures every patient registration and edit in the same transaction. |
| **T-12-05** | Denial of Service | Photo Upload Bomb | Enforce 5 MB upload limit and validate image MIME type & magic bytes before writing to disk. |
| **T-12-06** | Data Integrity | Duplicate URNs | Atomic `urn_sequences` table locking guarantees strictly zero duplicate URNs under race conditions. |

---

## 6. Suggested Plan Decomposition

1. **Plan 12-01: Alembic Migration & Core Domain Models**
   - Migration `0002_clinic_settings_and_patients.py`
   - Models: `ClinicSettings`, `Doctor` additions, `ConsultationFee`, `Patient`, `UrnSequence`
   - Schema test suite.
2. **Plan 12-02: Clinic Settings & Doctor Profiles Backend**
   - `GET /api/settings`, `PATCH /api/settings`
   - `GET /api/doctors`, `POST /api/doctors`, `PATCH /api/doctors/{id}`
   - `GET /api/fees`, `POST /api/fees`, `PATCH /api/fees/{id}`
   - RBAC & audit test coverage.
3. **Plan 12-03: Patient Registration & Atomic URN Service Backend**
   - Atomic URN generator (`KH-YYYY-XXXX`) with 20-thread concurrency test
   - `POST /api/patients` (12 canonical fields, validation)
   - `GET /api/patients/check-duplicate`
   - In-transaction audit event logging (`PATIENT_REGISTERED`).
4. **Plan 12-04: Patient Search, Retrieval, Edit & Photo Endpoints Backend**
   - `GET /api/patients` (multi-modal search by URN, mobile, name)
   - `GET /api/patients/{id}`, `PATCH /api/patients/{id}` (409 conflict on stale `version_id`)
   - `POST /api/patients/{id}/photo`, `GET /api/patients/{id}/photo` (authenticated file streaming).
5. **Plan 12-05: Frontend Clinic Settings & Doctor Management Screen**
   - `/admin/settings` page (bilingual names, addresses, receipt sequence cycle toggle)
   - `/admin/doctors` page (manage doctor profiles and consultation fees)
   - Integration with API client and permission guards.
6. **Plan 12-06: Frontend Patient Registration & Duplicate Warning**
   - `/reception/patients/new` registration form with 12 canonical fields
   - Real-time duplicate check with warning banner and override confirmation
   - Photo upload widget with local preview.
7. **Plan 12-07: Frontend Patient Search, Directory & Edit with Conflict Handling**
   - `/reception/patients` searchable directory (debounce search by URN, name, mobile)
   - Patient detail and edit modal with `ConflictBanner` integration.
8. **Plan 12-08: Registration Card Print Spike & Phase 12 Gate**
   - A4 printable registration card layout with dual signatures
   - Full test suite, coverage gate >= 85%, ruff clean, frontend build clean
   - Verification summary and state update.
