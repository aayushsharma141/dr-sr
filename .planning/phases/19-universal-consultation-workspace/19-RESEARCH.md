# Phase 19: Universal Consultation Workspace - Research & Technical Architecture

**Date:** 2026-11-06  
**Status:** Complete  
**Scope:** Architecture, schemas, endpoints, workflows, concurrency models, and validation strategy for Phase 19 (Requirements DWS-01 through DWS-10).

---

## 1. Executive Summary & Problem Analysis

In Kalyan Hospital v3.0, clinical consultations are currently split across fragmented interfaces and limited workflows:
1. **Clinical Encounters (`/doctor/encounters`)** require all clinical text (symptoms, clinical notes, diagnosis) to be entered up front; saving an in-progress draft is impossible because columns and schemas enforce `NOT NULL` and `min_length=2`.
2. **Prescriptions (`/doctor/prescriptions/new`)** are created on a separate page detached from the encounter, issued immediately with no draft or authorisation lifecycle, and cannot be corrected except by writing a detached new prescription.
3. **Doctor Silo (D-03)** was implemented as 19 inline `doctor_id` checks across 5 routers rather than through `core/scope.py`, completely blinding doctors to previous consultations performed by colleagues in the same hospital.
4. **Specialty Variation:** Physiotherapy requires pain assessments (VAS progression), range of motion, muscle strength grading, and posture/gait evaluation; Ophthalmology requires side-by-side OD/OS visual acuity, intraocular pressure, slit-lamp anterior segment, fundus, and refraction. Neither specialty has structured form support.
5. **Session Concurrency:** Multiple concurrent logins on shared clinic workstations risk silent overwriting and credential sharing, contrary to clinic operational security requirements.

Phase 19 resolves these structural gaps by introducing a unified **Universal Consultation Workspace** uniting assessment, vitals, specialty forms, diagnosis, prescription authoring, and follow-up booking on a single auto-saving page.

---

## 2. Prerequisites & Migration Chain Architecture

### 2.1 Branch & Migration Prerequisite Status
Phase 19 relies directly on two pending pull requests:
- **PR #17 (`feature/reception-all-specialties`):**
  - Introduces `departments` and `doctor_departments` (`0008_departments.py`).
  - Introduces `appointments.department_id` (`0009_appointment_department.py`).
  - Department codes: `PHYSIOTHERAPY` and `OPHTHALMOLOGY`.
- **PR #12 (`fix/hybrid-appointment-workflow-review`):**
  - Introduces `booking_mode` (`WALK_IN`, `SCHEDULED`), `visit_type` (`UNSPECIFIED`, `NEW_CONSULTATION`, `FOLLOW_UP`, `PHYSIOTHERAPY_SESSION`), and token assignment at check-in.
  - **Collision Warning:** PR #12 includes `0006_hybrid_appointment_booking.py`, which collides with `0006_admin_panel_hardening.py` and `0007_admin_settings_and_backup_runs.py` on `main`.

### 2.2 Prescribed Migration Sequence
Before applying Phase 19 migrations:
1. Rebase PR #12 onto `main` + PR #17.
2. Renumber PR #12's migration to `0010_hybrid_appointment_booking.py` (with `down_revision = '0009'`).
3. Phase 19 migrations will chain sequentially:
   - `0011_consultation_drafts_and_encounter_uniqueness.py`: Uniqueness constraint on `clinical_encounters.appointment_id`, nullable draft text columns, `check_in_at` on appointments.
   - `0012_clinical_templates_and_vitals.py`: Tables for `clinical_templates`, `clinical_template_versions`, `clinical_template_responses`, and `vital_observations`.
   - `0013_prescription_lifecycle_and_details.py`: Prescription statuses (`DRAFT`, `AUTHORISED`, `CANCELLED`), cancellation metadata, medicine fields (`strength`, `form`, `route`).
   - `0014_follow_up_recommendations.py`: `follow_up_recommendations` table with separation between clinical reason and administrative booking.

---

## 3. Database Schema & Data Modeling

### 3.1 Encounter Integrity & Drafts (DWS-01, DWS-02, DWS-03)
- **One encounter per appointment (DWS-01):**
  ```sql
  CREATE UNIQUE INDEX uq_clinical_encounters_appointment_id 
  ON clinical_encounters (appointment_id) 
  WHERE appointment_id IS NOT NULL;
  ```
- **Draft support (DWS-02):**
  Alter `clinical_encounters` columns `symptoms`, `clinical_notes`, and `diagnosis` to allow empty/null values during draft stage.
  ```sql
  ALTER TABLE clinical_encounters ALTER COLUMN symptoms SET DEFAULT '';
  ALTER TABLE clinical_encounters ALTER COLUMN clinical_notes SET DEFAULT '';
  ALTER TABLE clinical_encounters ALTER COLUMN diagnosis SET DEFAULT '';
  ```
- **Visit Type & Check-In Tracking (DWS-03):**
  - Add `check_in_at TIMESTAMPTZ NULL` on `appointments`. When reception checks in a patient (`status` changes to `ARRIVED`), record `check_in_at = clock.utcnow()`.
  - Add `department_id BIGINT REFERENCES departments(id) NULL` on `clinical_encounters` to support consultations started without an appointment or across multi-department doctors.
- **Tamper-Prevention Trigger Adjustment:**
  Update `fn_prevent_finalised_encounter_tampering()`:
  - If `OLD.is_finalised = TRUE`, block mutations to `symptoms`, `clinical_notes`, `diagnosis`, `patient_id`, `doctor_id`, `department_id`, and `appointment_id`.
  - Allow draft updates when `OLD.is_finalised = FALSE`.

### 3.2 Vitals & Calculated BMI (DWS-06)
Table: `vital_observations`
```sql
CREATE TABLE vital_observations (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    encounter_id BIGINT NOT NULL REFERENCES clinical_encounters(id) ON DELETE CASCADE,
    patient_id BIGINT NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    height_cm NUMERIC(5, 2) NULL CHECK (height_cm IS NULL OR (height_cm > 20 AND height_cm < 280)),
    weight_kg NUMERIC(5, 2) NULL CHECK (weight_kg IS NULL OR (weight_kg > 1 AND weight_kg < 400)),
    bmi NUMERIC(4, 1) NULL CHECK (bmi IS NULL OR (bmi >= 5 AND bmi <= 100)),
    systolic_bp INT NULL CHECK (systolic_bp IS NULL OR (systolic_bp >= 40 AND systolic_bp <= 300)),
    diastolic_bp INT NULL CHECK (diastolic_bp IS NULL OR (diastolic_bp >= 20 AND diastolic_bp <= 200)),
    pulse_bpm INT NULL CHECK (pulse_bpm IS NULL OR (pulse_bpm >= 30 AND pulse_bpm <= 260)),
    temperature_f NUMERIC(4, 1) NULL CHECK (temperature_f IS NULL OR (temperature_f >= 85 AND temperature_f <= 110)),
    respiratory_rate INT NULL CHECK (respiratory_rate IS NULL OR (respiratory_rate >= 5 AND respiratory_rate <= 80)),
    spo2_percent INT NULL CHECK (spo2_percent IS NULL OR (spo2_percent >= 40 AND spo2_percent <= 100)),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CONSTRAINT uq_vital_observations_encounter UNIQUE (encounter_id)
);
```
- Server computes `bmi = round(weight_kg / ((height_cm / 100.0) ^ 2), 1)` on insert/update whenever both `height_cm` and `weight_kg` are present and valid.

### 3.3 Specialty Clinical Templates (DWS-05)
Developer-set, versioned template registry linked to departments.
```sql
CREATE TABLE clinical_templates (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    department_id BIGINT NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
    code VARCHAR(64) NOT NULL UNIQUE,
    name_en VARCHAR(128) NOT NULL,
    name_hi VARCHAR(128) NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE clinical_template_versions (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    template_id BIGINT NOT NULL REFERENCES clinical_templates(id) ON DELETE CASCADE,
    version_number INT NOT NULL,
    schema_json JSONB NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    approved_by VARCHAR(128) NOT NULL,
    approved_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CONSTRAINT uq_template_version UNIQUE (template_id, version_number)
);

CREATE TABLE clinical_template_responses (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    encounter_id BIGINT NOT NULL REFERENCES clinical_encounters(id) ON DELETE CASCADE,
    template_version_id BIGINT NOT NULL REFERENCES clinical_template_versions(id) ON DELETE RESTRICT,
    response_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CONSTRAINT uq_template_responses_encounter UNIQUE (encounter_id)
);
```

#### Template Schemas (D-19-10, D-19-11, D-19-12):
1. **Physiotherapy Template (`PHYSIOTHERAPY_V1`):**
   - **Pain Assessment:** Starting VAS score (0–10 scale), anatomical pain site, onset/duration, pain characteristics (Sharp, Dull, Throbbing, Burning), aggravating factors, relieving factors.
   - **Range of Motion (ROM):** Joint inspected (Cervical, Lumbar, Shoulder, Knee, Hip, etc.), Flexion/Extension/Rotation (Normal, Mildly restricted, Severely restricted, degrees).
   - **Strength and Function:** Manual Muscle Testing (MMT) grade (0/5 to 5/5), functional limitations, ambulation status.
   - **Posture and Gait:** Posture alignment (Normal, Kyphotic, Lordotic, Scoliotic, Pelvic tilt), Gait pattern (Normal, Antalgic, Trendelenburg, Ataxic), Assistive device (None, Cane, Walker, Crutches).
2. **Ophthalmology Template (`OPHTHALMOLOGY_V1`):**
   - Structured with **Right Eye (OD)** and **Left Eye (OS)** side-by-side columns:
   - **Visual Acuity:** Distance uncorrected (6/60, 6/36, 6/24, 6/18, 6/12, 6/9, 6/6), with pinhole, best corrected; Near vision (N6 to N36).
   - **Intraocular Pressure (IOP):** OD (mmHg), OS (mmHg), Method (Non-contact tonometry, Goldmann applanation).
   - **Anterior Segment (Slit Lamp):** Lids/adnexa, Conjunctiva, Cornea, Anterior Chamber (depth/cells), Iris/Pupil, Lens (Clear, Early cataract, Nuclear sclerosis, Pseudophakic).
   - **Fundus & Refraction:** Optic Disc (C:D ratio, margins), Macula, Retinal Vessels, Periphery. Refraction: Sphere, Cylinder, Axis, Add (OD vs OS).

### 3.4 Prescription Authorisation & Lifecycle (DWS-07)
Extend `prescriptions` and `prescription_items`:
```sql
ALTER TABLE prescriptions ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'AUTHORISED';
ALTER TABLE prescriptions ADD COLUMN authorised_at TIMESTAMPTZ NULL;
ALTER TABLE prescriptions ADD COLUMN cancelled_at TIMESTAMPTZ NULL;
ALTER TABLE prescriptions ADD COLUMN cancelled_by_user_id BIGINT REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE prescriptions ADD COLUMN cancellation_reason TEXT NULL;

ALTER TABLE prescriptions ADD CONSTRAINT ck_prescriptions_status 
CHECK (status IN ('DRAFT', 'AUTHORISED', 'CANCELLED'));

ALTER TABLE prescriptions ADD CONSTRAINT ck_prescriptions_cancellation 
CHECK (
    (status != 'CANCELLED' AND cancelled_at IS NULL AND cancellation_reason IS NULL AND cancelled_by_user_id IS NULL)
    OR (status = 'CANCELLED' AND cancelled_at IS NOT NULL AND length(trim(cancellation_reason)) >= 3 AND cancelled_by_user_id IS NOT NULL)
);

-- At most one active (DRAFT or AUTHORISED) prescription per encounter:
CREATE UNIQUE INDEX uq_prescriptions_active_per_encounter 
ON prescriptions (encounter_id) 
WHERE encounter_id IS NOT NULL AND status IN ('DRAFT', 'AUTHORISED');
```
Extend `prescription_items` with medicine delivery details:
```sql
ALTER TABLE prescription_items ADD COLUMN strength VARCHAR(64) NULL;
ALTER TABLE prescription_items ADD COLUMN form VARCHAR(32) NULL; -- Tablet, Capsule, Eye Drops, Eye Ointment, Syrup, Gel, Injection
ALTER TABLE prescription_items ADD COLUMN route VARCHAR(32) NULL; -- Oral, Right Eye (OD), Left Eye (OS), Both Eyes (OU), Topical, Inhalation
```

### 3.5 Follow-Up Recommendations (DWS-08)
Table: `follow_up_recommendations`
```sql
CREATE TABLE follow_up_recommendations (
    id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    encounter_id BIGINT NOT NULL REFERENCES clinical_encounters(id) ON DELETE CASCADE,
    patient_id BIGINT NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    doctor_id BIGINT NOT NULL REFERENCES doctors(id) ON DELETE RESTRICT,
    recommended_doctor_id BIGINT NOT NULL REFERENCES doctors(id) ON DELETE RESTRICT,
    recommended_date DATE NOT NULL,
    clinical_reason TEXT NULL, -- Doctor only! Hidden from Reception
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'BOOKED', 'CLOSED')),
    booked_appointment_id BIGINT REFERENCES appointments(id) ON DELETE SET NULL,
    closed_reason TEXT NULL,
    closed_by_user_id BIGINT REFERENCES users(id) ON DELETE RESTRICT,
    closed_at TIMESTAMPTZ NULL,
    version_id INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    CONSTRAINT uq_follow_up_encounter UNIQUE (encounter_id)
);
CREATE INDEX ix_follow_up_status_date ON follow_up_recommendations(status, recommended_date);
CREATE INDEX ix_follow_up_patient ON follow_up_recommendations(patient_id);
```

### 3.6 Single Concurrent Session Model (DWS-10)
Enforces: One active login per user at a time across all roles.
- When `POST /api/auth/login` verifies credentials:
  - Check `auth_service.list_active_sessions(session, settings, now, user_id=user.id)`.
  - If an active unexpired session exists and `takeover` flag is NOT supplied:
    - Respond with HTTP 409 Conflict:
      ```json
      {
        "code": "session_in_use",
        "message": "This account is currently active on another computer.",
        "active_session": {
          "ip": "192.168.1.104",
          "user_agent": "Chrome / Windows",
          "last_seen_at": "2026-11-06T10:14:00Z"
        }
      }
      ```
  - If `takeover=True` is provided:
    - Call `auth_service.revoke_all_user_sessions(session, user.id)`.
    - Record audit event: `AuditAction.SESSION_TAKEOVER`.
    - Issue new session token and set session cookie.

---

## 4. Centralized Access Scope & Privacy Architecture (DWS-04)

### 4.1 Transition from 19 Inline Checks to `core/scope.py`
Currently, 19 inline `doctor_id == principal.doctor_id` comparisons exist across `encounters.py`, `prescriptions.py`, `timeline.py`, `treatment_plans.py`, and `treatment_sessions.py`.

Under DWS-04 (pending sign-off):
- **Clinical Reads (`ScopeFamily.CLINICAL_READ`):**
  - Any authenticated Doctor with an assigned `doctor_id` can read encounters, prescriptions, timelines, treatment plans, and sessions.
  - Reception and Admin evaluate strictly to `false()` (denied with 404).
  - Cross-doctor read detection: When `record.doctor_id != principal.doctor_id`, an audit log entry `AuditAction.CROSS_DOCTOR_CLINICAL_READ` is automatically recorded in `audit_logs` capturing `actor_doctor_id`, `record_doctor_id`, `patient_id`, `entity_type`, and `entity_id`.
- **Clinical Writes (`ScopeFamily.CLINICAL_WRITE`):**
  - Evaluates strictly to `doctor_id_col == principal.doctor_id`.
  - Editing, finalising, cancelling, or adding addenda to another doctor's consultation or prescription is rejected with HTTP 404 (zero existence leakage).
- **Reception Access to Follow-Ups (D-19-19):**
  - Reception endpoint `GET /api/reception/follow-ups` projects only `patient_name`, `patient_urn`, `recommended_date`, `recommended_doctor_name`, and `status`.
  - `clinical_reason` is excluded from the query/schema, maintaining clinical privacy (D-04).

---

## 5. Universal Consultation Frontend Architecture

### 5.1 One-Page Layout & Jump List (D-19-06, D-19-07)
A single continuous consultation page without tabs or wizards:
- **Sticky Top Bar:** Patient Name, URN, Age/Gender, Allergy Alert Badge (Crimson), Auto-save indicator ("Saved" / "Saving..." / "Not saved - retrying"), Action buttons (Authorise Rx, Finalise Consultation, Print Summary).
- **Jump Navigation Rail (Left or Anchor Bar):**
  - 1. Chief Complaints & HPI
  - 2. Vital Signs
  - 3. Specialty Assessment (Physiotherapy or Ophthalmology form)
  - 4. Diagnosis & Clinical Impression
  - 5. Prescription & Medication Orders
  - 6. Follow-up Recommendation
- **Persistent Side Panel:**
  - Patient demographics & photo thumbnail.
  - Highlighted Allergies banner.
  - Read-only card of the patient's **most recent prior consultation** (with a "Copy Section" action to pull previous complaints, vitals, or diagnosis into the draft without automatic pre-filling).

### 5.2 Auto-Save Engine (D-19-22, D-19-23, D-19-24)
- **Debounced Save:**
  - Saves 3 seconds after typing ceases, or immediately on blur when leaving a section.
  - State indicators:
    - `SAVED` (Green text, checkmark): Confirmed by server with returned `version_id`.
    - `SAVING` (Amber text, spinner): Flight in progress.
    - `OFFLINE_ERROR` (Crimson inline alert): Retrying automatically; text remains in React state.
- **No Browser Clinical Caching:**
  - Shared workstation policy strictly prohibits writing clinical notes to `localStorage` or `sessionStorage`.
- **Dashboard Integration:**
  - In `DoctorDashboard.tsx`, add an **"Unfinished Consultations"** section listing incomplete drafts with quick "Resume Consultation" action buttons.

### 5.3 Prescription & Print Architecture (DWS-07, DWS-09)
Two distinct print documents:
1. **Prescription Slip (`PrescriptionPrint.tsx`):**
   - Issued inside workspace.
   - Requires `status == 'AUTHORISED'` to enable the "Print Prescription" button.
   - Contains clinic banner, patient strip, diagnosis, medication table with strength/form/route/instructions, static bilingual Hindi labels, doctor signature line.
   - Cancellation modal: Cancelling requires a reason, marks record `CANCELLED`, and resets the prescription block to draft a new active prescription.
2. **Consultation Summary Print (`ConsultationSummaryPrint.tsx`):**
   - Enabled ONLY after encounter finalisation (`is_finalised == true`).
   - One A4 page on approved hospital letterhead.
   - Shows: Patient Strip, Chief Complaints, Diagnosis, Treatment/Care Advice, Follow-up Recommendation date & doctor.
   - Contains **NO MEDICATIONS** (preventing conflicting paper slips).
   - If reprinted, displays `Reprinted on: DD/MM/YYYY HH:MM`.

---

## 6. Multi-Specialty Architectural Rules

| Specialty | Doctor Setup | Specialty Form Sections | Treatment Packages | Prescription Needs |
|---|---|---|---|---|
| **Physiotherapy** | 2 Doctors (Dr. M.M. Dwivedi, Dr. Chandan Kr. Dwivedi) | Pain (VAS 0-10), ROM, Muscle Strength (0-5), Posture/Gait | Full package billing, VAS session progression, package billing | Pain relievers, muscle relaxants, topical gels |
| **Ophthalmology** | 1 Doctor (Eye Specialist) | Side-by-side OD/OS: Visual Acuity, IOP, Slit-lamp anterior segment, Fundus, Refraction | None (Consultation completes without treatment plans) | Eye drops, ointments, oral medications with eye-specific routes (OD/OS/OU) |

---

## 7. Validation Architecture & Quality Gates

### 7.1 Automated Backend Test Matrix
New tests must be created in `backend/tests/`:
1. `test_consultation_drafts.py`:
   - Partial draft creation with blank text fields succeeds (201).
   - Auto-save patch updates draft and increments `version_id`.
   - Finalise rejects incomplete required fields (422) and locks completed encounter (200).
   - Post-finalisation trigger blocks modifications to encounter and template responses.
2. `test_appointment_encounter_uniqueness.py`:
   - Second encounter creation on the same appointment ID is prevented (returns existing encounter or unique constraint violation).
3. `test_vitals_and_bmi.py`:
   - Validates height/weight inputs and verifies exact server-calculated BMI.
   - Verifies physiological range check constraints.
4. `test_specialty_templates.py`:
   - Template version loading based on appointment department (`PHYSIOTHERAPY` vs `OPHTHALMOLOGY`).
   - Finalisation validation rejects missing required template fields.
   - Historical encounters preserve the exact template version schema used at consultation time.
5. `test_prescription_lifecycle.py`:
   - Draft prescription authoring and item order uniqueness.
   - Unauthorised prescription print rejection.
   - Cancellation with required reason transitions state to `CANCELLED`.
   - Reissuance allows exactly one active prescription per encounter.
6. `test_follow_up_workflow.py`:
   - Doctor creates follow-up recommendation with date and clinical reason.
   - Reception follow-up listing receives patient and date, but `clinical_reason` is strictly omitted.
   - Booking converts recommendation to `BOOKED` appointment.
   - Overdue closure requires valid reason.
7. `test_auth_single_session.py`:
   - Second login attempt for same user returns 409 `session_in_use`.
   - Login with `takeover=True` revokes previous session and records `SESSION_TAKEOVER` audit log.
   - Expired idle sessions do not block new logins.
8. `test_cross_doctor_access.py` (Gated on EG-6 sign-off):
   - Doctor B can read Doctor A's finalised encounter (200).
   - Cross-doctor read generates `CROSS_DOCTOR_CLINICAL_READ` audit entry.
   - Doctor B attempting to edit or append addendum to Doctor A's encounter receives 404.
   - Reception and Admin attempting to read clinical encounter receive 404.
9. `test_phase19_gate.py`:
   - End-to-end integration test spanning draft creation, vitals, specialty form, prescription authorisation, finalisation, summary generation, and audit trail verification with >= 85% coverage floor.

### 7.2 Automated Frontend Vitest Matrix
1. `clinical-encounter-workspace.test.tsx`:
   - Jump list navigation and scroll spy.
   - 3-second debounced auto-save behavior and network error retry state.
   - Vitals entry and live BMI category calculation.
   - Physiotherapy vs Ophthalmology form conditional rendering.
   - Prescription authorisation button gate and cancellation dialog.
   - Copy section action from previous encounter side card.
2. `doctor-dashboard-unfinished.test.tsx`:
   - Unfinished consultations section rendering and resumption link.
3. `consultation-summary-print.test.tsx`:
   - Headless print verification ensuring single-page A4 format, absence of medication table, and reprint timestamp marking.
4. `login-takeover-dialog.test.tsx`:
   - 409 session conflict modal handling and takeover confirmation submission.

### 7.3 Acceptance Criteria (DWS-01 through DWS-10)
- **AC-01 (DWS-01):** Database guarantees at most one encounter per appointment; navigating to an existing consultation re-opens the active record.
- **AC-02 (DWS-02):** In-progress consultations auto-save without requiring complete fields; "Saved" badge reflects server acknowledgment; drafts appear in the dashboard "Unfinished" list.
- **AC-03 (DWS-03):** Encounters reflect New or Follow-up visit category, and actual patient check-in timestamp is captured.
- **AC-04 (DWS-04):** Doctors can view previous encounters from all doctors with audit logging; write isolation is strictly maintained; reception/admin remain blocked.
- **AC-05 (DWS-05):** Specialty templates load dynamically based on department; responses are validated on finalisation; old encounters remain locked to their historical template version.
- **AC-06 (DWS-06):** Height and weight inputs generate validated BMI.
- **AC-07 (DWS-07):** Prescriptions follow draft -> authorised -> print lifecycle; cancellation with reason allows clean reissuance with one active prescription per visit.
- **AC-08 (DWS-08):** Follow-ups are tracked as recommendations; reception books or views them without seeing clinical notes.
- **AC-09 (DWS-09):** Finalised consultations can print a standalone patient summary without medication lists on hospital letterhead.
- **AC-10 (DWS-10):** Single session per account is enforced with takeover option and audit trail.

---

## 8. Recommendations for Phasing and Execution Waves

To minimize risk and manage dependencies smoothly, Phase 19 planning should divide execution into logical waves:

- **Plan 19-01 (Prerequisites & Base Migration):**
  - Verify PR #17 and PR #12 merges. Renumber PR #12 migration to `0010`.
  - Migration `0011`: Encounter appointment uniqueness, draft nullable text columns, appointment `check_in_at`.
  - Single active login enforcement in `auth_service.py` and `POST /auth/login` (DWS-10).
- **Plan 19-02 (Vitals & Clinical Template Engine):**
  - Migration `0012`: `clinical_templates`, `clinical_template_versions`, `clinical_template_responses`, `vital_observations`.
  - Seed templates for Physiotherapy and Ophthalmology.
  - Endpoints for template fetching, vitals recording, and response saving.
- **Plan 19-03 (Prescription Lifecycle & Follow-up Recommendations):**
  - Migration `0013` & `0014`: Prescription statuses, cancellation metadata, medicine fields (`strength`, `form`, `route`), `follow_up_recommendations`.
  - Authorise and cancel endpoints for prescriptions (DWS-07).
  - Follow-up recommendation endpoints and Reception follow-up booking (DWS-08).
- **Plan 19-04 (Centralized Scope & Cross-Doctor Reads):**
  - Refactor `core/scope.py` to support `CLINICAL_READ` vs `CLINICAL_WRITE`.
  - Replace 19 inline silo checks across routers.
  - Audit logging for cross-doctor clinical reads (DWS-04).
- **Plan 19-05 (Universal Consultation Frontend Workspace):**
  - Single-page layout with jump list, patient & prior visit side card.
  - Section copy controls (D-19-08).
  - Debounced auto-save engine (~3s + onBlur) with server confirmation badge.
  - Vitals section with live BMI calculation.
  - Dynamic specialty form (Physiotherapy vs Ophthalmology).
  - Integrated prescription authoring, authorising, and cancellation modal.
  - Follow-up recommendation widget.
- **Plan 19-06 (Dashboard Unfinished List & Print Summary):**
  - Doctor Dashboard "Unfinished Consultations" card.
  - Printable Patient Consultation Summary (`ConsultationSummaryPrint.tsx`) with Hindi labels, no medications, reprint stamp.
  - Login takeover confirmation modal on 409 session conflict.
- **Plan 19-07 (Integration Gate & Verification):**
  - `test_phase19_gate.py` integration suite.
  - Frontend Vitest suite passing.
  - Coverage floor verification (>= 85%).
  - RBAC matrix and OpenAPI snapshot verification.

---
*End of Phase 19 Research Document.*
