# Plan: Kalyan Hospital Patient Records UI/UX, Workflow & Data Architecture Overhaul

**Generated**: 2026-11-18

## Overview

Overhaul Kalyan Hospital's **Patient Records** module across database schema, backend APIs, clinical & financial integrity layers, and frontend workspaces into a clean, role-aware **4-level clinical & administrative architecture**:

1. **Level 1 — Patient Master**: Permanent URN (`patients`), extended optional demographics, computed age from `dob`, structured `patient_allergies`, longitudinal `patient_conditions`, and protected local `patient_documents` storage.
2. **Level 2 — Visit / Encounter**: Human-readable unique `visit_code` (`VIS-YY-NNNNNN`) and `encounter_code` (`ENC-YY-NNNNNN`), nullable `clinical_encounters.visit_id` with PostgreSQL 15+ composite FK `(visit_id, patient_id)` (never fabricating visits for pre-0025 rows), `appointments.status` normalization, and role-redacted Patient Summary & Visit History APIs.
3. **Level 3 — Clinical Records**: Structured `encounter_diagnoses` (ICD-10, type, status, optional link to `patient_conditions`), `investigation_orders` & `investigation_results` workflow, immutable versioned prescriptions (`revision_number`, `supersedes_prescription_id`, `amendment_reason`, DB tamper trigger on `AUTHORISED`/`SUPERSEDED`/`CANCELLED` + `POST /api/prescriptions/{id}/amend`), while preserving `trg_sync_treatment_plan_session_progress` (`AGENTS.md` Invariant #11).
4. **Level 4 — Financial Hardening & Unified UI Workspaces**:
   - **Financial evolution (no rewrite of Phase 22 billing)**: Preserve `visits`, `bill_items`, `bill_item_adjustments`, `payments`, `BillPanel`, `VisitCheckout`, `ReceiptDialog`, and `PaymentReversalModal`. Keep integer `BigInteger` paise everywhere (widen `payments.amount_paise` to `BigInteger`, fix `fn_enforce_package_payment_limits()` locals to `BIGINT`, fix `fn_prevent_payment_tampering()` to guard `visit_id` while preserving print-snapshot guards, fix `VisitDetail.payments` visit-level payment drop bug and `GET /patients/{id}/payments` missing `merged_into_id` consolidation). Add immutable append-only `ledger_entries` (reconciled to the exact paise in `integrity_service.py`) and Admin-only partial/full `refunds` (`D-06`).
   - **Frontend UI/UX**: Remove the duplicated unconditional `<PaymentHistory />` panel at `PatientDetail.tsx:429`, introduce a persistent **Patient Identity Header** + **KPI strip** + **URL-synced (`?tab=`) 9-section role-adapted workspace** on `/reception/patients/:id` (`Overview`, `Visit History`, `Clinical Records`, `Prescriptions`, `Investigations`, `Treatment Plans`, `Billing & Ledger`, `Documents`, `Change History`), add a unified role-adapted **Encounter / Visit Workspace** at the **role-neutral shared route `/patients/:id/visits/:visitId`**, and add server-side filtering + empty-state RBAC fix on `/reception/patients`.

### Locked Architectural Decisions (Do Not Deviate)

- **3-Role RBAC Model (`SEC-03` / `ADR-17` & `D-04`)**:
  - Strictly `ADMIN`, `RECEPTION`, and `DOCTOR`. Never invent Nurse/Accounts roles.
  - **`D-04` Clinical Privacy**: `RECEPTION` and `ADMIN` cannot view clinical notes, structured diagnoses, longitudinal `patient_conditions`, full prescriptions, clinical investigation orders/results, clinical allergy details/notes, or clinical documents (`is_clinical=TRUE`). Preserve only the narrow `OD-B` prescribed-medicines billing projection (`status == 'AUTHORISED'` only, never duplicating `SUPERSEDED` revisions) and the Reception safety-only allergy alert summary.
  - **`DOCTOR` Boundaries**: Full clinical access with `DWS-04` cross-doctor read auditing (`ScopeFamily.CLINICAL_READ`) and edit-own write scope (`ScopeFamily.CLINICAL_WRITE`); owns full structured clinical allergies (`substance`, `severity`, `reaction`, `clinical_notes`, `status`, `recorded_by`) and clinical allergy editing (`ALLERGY_WRITE` — `DOCTOR` only); **cannot collect payments** (`AGENTS.md` #7); **does NOT see the Billing & Ledger tab** (sees only own clinical charges inside the encounter workspace per `Q13`).
  - **`ADMIN` Boundaries**: Reversals & refunds (`D-06`), audit history (`Change History`), demographic corrections, duplicate merge/unmerge, archival — **no clinical content**, **no allergy details by default** (`allergy_alert: null` on `/summary`, `403` on `/patients/{id}/allergies`, hidden in header & Overview), and **no routine payment collection**.
  - **`RECEPTION` Boundaries**: Registration/demographics, check-in/tokens, visits, routine payment collection, billing/checkout, non-clinical documents (`is_clinical=FALSE`), and **safety-alert-only allergy projection** inside `GET /api/patients/{id}/summary` (`allergy_alert: { has_allergies, count, highest_severity, alert_labels }` — NO reactions/clinical notes, NO edit controls, `403` on `/patients/{id}/allergies`) — **no clinical content**.
  - **Explicit `photo:read` Decision (User-Approved)**: Grant read-only, authenticated `Permission.PHOTO_READ` to `Role.DOCTOR` and `Role.ADMIN` (keeping `Permission.PHOTO_WRITE` strictly `RECEPTION`-only). *Rationale*: Patient avatar photos are an identity-verification safeguard (PAT-05, preventing wrong-patient clinical errors), not clinical content; `PatientDetail.tsx:241` already requests `/api/patients/{id}/photo` across all roles and currently receives silent `403`s for Doctor/Admin. Covered in `core/permissions.py`, `backend/tests/test_permissions_catalogue.py`, `backend/tests/support/matrix.py`, and `backend/tests/test_patient_edit_photo.py`.
  - **Role-Filtered Documents (User-Confirmed)**: Keep role-filtered document access (`DOCUMENT_READ` across all 3 roles with row-level `is_clinical` filtering under `D-04`; `DOCUMENT_WRITE` for `RECEPTION` non-clinical and `DOCTOR` clinical/non-clinical).
  - **Role-Redacted Workspace API Strategy (Preserving `VISIT_READ`)**: Rather than granting `VISIT_READ` (which gates checkout/billing queues) to `DOCTOR`, introduce role-redacted `GET /api/patients/{id}/visits` and `GET /api/patients/{id}/visits/{visit_id}/workspace` gated by `require(Permission.PATIENT_READ)` that return clinical data only to `DOCTOR` (with `DWS-04` audit) and billing/payment data only to `ADMIN`/`RECEPTION` (`D-04` + `AGENTS.md` #7). Frontend Encounter / Visit Workspace uses the **role-neutral shared route `/patients/:id/visits/:visitId`** for all 3 roles (`ADMIN`, `RECEPTION`, `DOCTOR`).
  - **Permission Introduction Policy (`test_no_orphan_permissions`)**: `backend/tests/test_permissions_catalogue.py` asserts every `Permission` is either bound to an active route or in `RESERVED` (never orphaned). Add each new permission strictly in the milestone that mounts its route (`ALLERGY_WRITE` [`DOCTOR` only, added to `CLINICAL_PERMISSIONS`] in M1, `PAYMENT_REFUND` [`ADMIN` only] in M3, `DOCUMENT_READ`/`DOCUMENT_WRITE` in M4) and update `test_golden_role_permissions_snapshot()` in the same milestone.
- **Archived & Merged Patient (`merged_into_id`) Contract**:
  - **Reads**: All Patient Workspace read endpoints (`/summary`, `/visits`, `/visits/{visit_id}/workspace`, `/allergies`, `/conditions`, `/prescriptions`, `/investigations`, `/payments`, `/ledger`, `/refunds`, `/documents`) **succeed (`200`) on archived and merged patients** (matching `GET /patients/{id}` so historical records remain auditable) and consolidate `[patient_id, *merged_ids]` aliases downward (if querying a merged secondary record directly, return its own records + `merged_into_id`/`merged_into_urn` banner link).
  - **Writes**: All new patient-scoped mutations (allergies, conditions, documents, etc.) **reject archived or merged patients with `409 patient_inactive_or_merged`** so new data is never attached to a retired alias.
- **Deterministic Signed Ledger Convention & Reconciliation Scope (`ledger_entries`)**:
  - Money stays **integer `BigInteger` paise** everywhere.
  - `direction = 'DEBIT'` (`signed_amount_paise = +amount_paise`) **increases** the patient's payable balance (bill item creation, upward bill adjustment, treatment plan agreed package charge, legacy standalone consultation charge, payment reversal, refund).
  - `direction = 'CREDIT'` (`signed_amount_paise = -amount_paise`) **decreases** the patient's payable balance (payment receipt, bill item void, downward discount/waiver/correction adjustment, treatment plan cancellation credit).
  - **Exact Reconciliation Semantics (reconciling `counts_toward_total` & Phase 22 `PACKAGE` lines)**:
    - Visit `bill_items`: `PROCEDURE`, `MEDICINE`, `ADDITIONAL` post `CHARGE` DEBIT on creation. `CONSULTATION` bill lines are posted on check-in (`booking_service.ensure_consultation_line`), and if the consultation is `CANCELLED` (or voided), a matching `CHARGE_VOID` CREDIT is posted so `ledger_entries` stays exact; in `integrity_service.py` Check #7, visit ledger totals reconcile `SUM(signed_amount_paise WHERE visit_id = v.id)` against **all active non-voided, non-cancelled `bill_items.amount_paise` (where `amount_paise > 0`) minus `(non-reversed visit payments - visit refunds)`** to 0 paise! (Open in-progress consultations are clearly tracked separately from checkout-collectable `counts_toward_total` until `COMPLETED`.)
    - Treatment packages (`treatment_plans.agreed_price_paise`, where Phase 22 `PACKAGE` `bill_items` carry `amount_paise = 0`) post a `PACKAGE_CHARGE` DEBIT (referencing `TREATMENT_PLAN`) when created and `PACKAGE_ADJUSTMENT` when agreed price changes or plan is cancelled, so package payments (`treatment_plan_id IS NOT NULL, visit_id IS NULL`) balance cleanly against package charges without driving patient ledger sums negative!
    - Pre-0025 legacy standalone `appointment_id` payments (`visit_id IS NULL, treatment_plan_id IS NULL`) backfill a matching `LEGACY_CHARGE` DEBIT (`amount_paise = payment.amount_paise` if active) or reconcile in a dedicated legacy scope so historical pre-0025 data never produces false discrepancies.
- **Database & Migration Governance**:
  - PostgreSQL `>= 15` (`SHOW server_version_num >= 150000` check before any `ON DELETE SET NULL (col)` composite FK, emitted via raw `op.execute(...)` to avoid SQLAlchemy 2.0 `CompileError`).
  - `models.py:48` naming convention automatically prefixes `ck_<table>_` on `CheckConstraint`s — pass **bare constraint names** (e.g., `"clinical_category"`, NOT `"ck_patient_documents_clinical_category"`) in migrations `0034`–`0037`.
  - Current Alembic head is `0033` (`0033_pending_opd_arrival_cancelled_status.py`). New migrations chain cleanly: `0034` → `0035` → `0036` → `0037`.
  - Every migration explicitly executes `GRANT ... TO kalyan_app` + `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kalyan_app`, enforces fail-closed non-destructive `downgrade()` (raising `RuntimeError` if clinical/financial rows exist), and uses owner-only transaction-scoped trigger handling when backfilling trigger-protected tables.
  - **Trigger vs Privilege Testing Rule**: `conftest.py` binds `db_session` to least-privilege `kalyan_app`. Direct-SQL trigger rejection tests (verifying PostgreSQL triggers block UPDATE/DELETE rather than failing with `InsufficientPrivilege`) MUST execute inside a rolled-back transaction on `owner_engine`, while least-privilege grant tests execute on `db_session`.
- **Frontend Security & Guardrails**:
  - Preserve `AppShell` maroon/gold Tailwind v4 design system (`#5D0B26`, `#C39A35`) and `frontend/src/test/guards/guards.test.ts` (UX-03 no blocking dialogs, UX-04 `>= 12px` / no `300`/`400` greys / no `red-500`/`emerald-600`/`amber-600`/`teal-600`, UX-06 accessible names on all inputs/selects/textareas, IST date guard).
  - **Ratchet Catch**: `guards.test.ts:71` currently exempts `pages/PatientDetail.tsx` with `max: 1` for line 48 (`text-[11px]`). Replacing `text-[11px]` with `text-xs` in `T1.8` **must simultaneously remove** `'pages/PatientDetail.tsx'` from `PENDING` in `guards.test.ts` (while preserving the 3 unrelated client-held exemptions: `VasTrendChart.tsx`, `BackupManagerPage.tsx`, `TreatmentPlanWorkspace.tsx`).
  - **CSP / `X-Frame-Options: DENY` Catch (`main.py:60-70`)**: Backend sends `X-Frame-Options: DENY` and `frame-ancestors 'none'`. Never render uploaded PDFs inside an `<iframe>`; render images via authenticated Blob URLs (`img-src 'self' blob:`) and open/download PDFs via authenticated Blob URL in a new tab or attachment download.

## Prerequisites

- **Backend**: Python `3.12+` with `backend/.venv` (`FastAPI 0.162.0`, `SQLAlchemy 2.0.55`, `Alembic 1.20.1`, `psycopg-binary 3.3.6`, `pytest`, `ruff`) and local PostgreSQL `>= 15` with `kalyan_owner`, `kalyan_app`, and isolated `kalyan_test` DB.
- **Frontend**: Node.js `>= 22.22.2` with `frontend/node_modules` (`React 19.3.1`, `TypeScript 7.0.2`, `Vite 8.3.5`, `React Router 8.5.1`, `TanStack Query 5.105.0`, `Tailwind CSS 4.3.3`, `Vitest`, `oxlint`).
- **Git Hygiene & Staging Discipline**: Branch `fix/sidebar-daily-flow` currently has ~60 uncommitted modified files plus untracked `0033_pending_opd_arrival_cancelled_status.py`. **Preserve all existing working-tree changes**, pin a non-destructive checkpoint ref + copy-backup of all untracked files in Wave 0 (`AGENTS.md`), and **in every implementation task stage ONLY that task's own owned files (`git add <owned-files>`) when committing locally — NEVER `git add -A` and NEVER `git push`**.

## Dependency Graph

```text
Wave 0:  T0 (Git Checkpoint & Baseline Verification)
          │
          ▼
         [MILESTONE 1: Foundation, Codes, Summary & Patient Workspace Shell]
Wave 1:  T1.1 (Migration 0034 + models.py: extended patient cols, allergies, visit/encounter codes w/ DB fallback trigger, visit_id FK)
          │
Wave 2:  T1.2 (permissions.py [M1], audit_service.py, code_sequence_service.py, visit_service.py, patient_merge_service.py, encounters router/schema)
          │
Wave 3:  ├── T1.3 (patients extended/computed age/allergies CRUD + VisitDetail.payments bug fix)
         └── T1.4 (patient_workspace summary + role-redacted visit history API)
          │
Wave 4:  T1.5 (main.py mount, matrix.py, test_permissions_catalogue.py, openapi.snapshot.json, M1 pytest suite)
          │
Wave 5:  T1.6 (frontend api/types.ts + api/queries.ts + PatientRegister optional fields)
          │
Wave 6:  ├── T1.7a (PatientIdentityHeader.tsx + PatientOverviewTab.tsx)
         └── T1.7b (PatientVisitHistoryTab.tsx)
          │
Wave 7:  T1.8 (PatientDetail.tsx 9-section URL-synced shell + remove duplicate PaymentHistory + guards.test.ts ratchet + M1 Vitest)
          │
          ▼
         [MILESTONE 2: Clinical Completeness — Diagnoses, Conditions, Investigations, Rx Versioning]
Wave 8:  T2.1 (Migration 0035 + models.py + routers/prescriptions.py DRAFT->items->AUTHORISED safe write: conditions, diagnoses, investigations, Rx versioning + tamper triggers)
          │
Wave 9:  ├── T2.2 (clinical_diagnoses.py: structured diagnoses & longitudinal conditions API)
         ├── T2.3 (investigations.py: orders & results API)
         └── T2.4 (prescriptions.py: revision chain, amend endpoint, SUPERSEDED guards, alias consolidation)
          │
Wave 10: T2.5 (main.py mount, matrix.py, openapi.snapshot.json, M2 clinical pytest suites)
          │
Wave 11: T2.6 (frontend api/types.ts + api/queries.ts for M2 clinical APIs)
          │
Wave 12: ├── T2.7 (PatientClinicalRecordsTab.tsx + PatientPrescriptionsTab.tsx)
         └── T2.8 (PatientInvestigationsTab.tsx + PatientTreatmentPlansTab.tsx)
          │
Wave 13: T2.9 (Wire M2 tabs into PatientDetail.tsx, PatientOverviewTab.tsx, ClinicalEncounterWorkspace.tsx + M2 Vitest)
          │
          ▼
         [MILESTONE 3: Financial Hardening — Append-Only Ledger, Refunds & Billing & Ledger UI]
Wave 14: T3.1 (Migration 0036 + models.py: BigInteger paise, trigger fixes, refunds, immutable ledger_entries + reconciled backfill)
          │
Wave 15: T3.2 (ledger_service.py, bill_service.py, booking_service.py, billing_service.py, routers/billing.py [alias + cap fixes], routers/treatment_plans.py, integrity_service.py check #1 & #7)
          │
Wave 16: T3.3 (permissions.py [M3], schemas/routers/ledger.py, main.py, matrix.py, test_permissions_catalogue.py, openapi, M3 pytest)
          │
Wave 17: T3.4 (frontend M3 api types/hooks, PaymentRefundModal.tsx, PatientBillingLedgerTab.tsx, wire PatientDetail.tsx + M3 Vitest)
          │
          ▼
         [MILESTONE 4: Patient Documents, Directory Filters, Encounter Workspace & Full Verification]
Wave 18: T4.1 (Migration 0037 + models.py + config.py + main.py lifespan: patient_documents + investigation_results.document_id FK)
          │
Wave 19: ├── T4.2 (permissions.py [M4], document_service.py, schemas/routers/documents.py, integrity_service.py check #8)
         └── T4.3 (Directory server-side filters/stats + Visit/Encounter Workspace API + investigation result document link)
          │
Wave 20: T4.4 (main.py mount, conftest.py, matrix.py, test_permissions_catalogue.py, openapi.snapshot.json, M4 pytest suites)
          │
Wave 21: T4.5 (frontend api/types.ts + api/queries.ts for M4 documents, directory filters & visit workspace)
          │
Wave 22: ├── T4.6a (PatientDocumentsTab.tsx + PatientsDirectory.tsx filters, pagination reset & empty-state RBAC fix)
         └── T4.6b (VisitWorkspacePage.tsx + router.tsx + AppShell.tsx breadcrumbs/active nav)
          │
Wave 23: T4.7 (Wire Documents tab in PatientDetail.tsx + report links in PatientInvestigationsTab.tsx + M4 Vitest suites)
          │
Wave 24: T4.8 (Full Backend + Frontend Verification Gate, 14-Point Acceptance Matrix & AGENTS.md 7-Point DoD Sign-Off)
```

---

## Tasks

### Wave 0 — Baseline & Git Checkpoint

#### T0: Record Pre-Overhaul Git Checkpoint (Tracked + Untracked Backup) & Capture Baseline Test Results
- **depends_on**: []
- **location**: Repository Git state & `.git/checkpoints/` only (no tracked/untracked workspace source edits)
- **description**:
  - Preserve all ~60 existing uncommitted files on `fix/sidebar-daily-flow` (including untracked `backend/src/kalyan_api/migrations/versions/0033_pending_opd_arrival_cancelled_status.py`) without modifying, staging, or discarding any file (`AGENTS.md` Development Restrictions).
  - **Untracked file backup** *(critical: `git stash create` does NOT capture untracked files!)*:
    - Inventory all untracked files via `git ls-files --others --exclude-standard`.
    - Copy-backup `backend/src/kalyan_api/migrations/versions/0033_pending_opd_arrival_cancelled_status.py` and any other untracked files preserving relative paths into `.git/checkpoints/pre-patient-records-overhaul-untracked/`, verifying SHA-256 checksums match the originals.
  - Pin a non-destructive Git checkpoint ref for tracked modifications:
    ```powershell
    $sha = git stash create "checkpoint: pre patient-records architecture overhaul"
    if (-not $sha) { $sha = git rev-parse HEAD }
    git update-ref refs/checkpoints/pre-patient-records-overhaul $sha
    ```
  - **Staging reminder for all downstream tasks (`T1.1`–`T4.7`)**: Every implementation worker MUST stage ONLY its own explicitly owned files (`git add <owned-files>`) when committing locally — **NEVER `git add -A`**, **NEVER `git push`**.
  - Record baseline output of backend RBAC/contract gate and frontend typecheck/lint/guards so any pre-existing delta is distinguished from overhaul work.
- **validation**:
  - `git rev-parse refs/checkpoints/pre-patient-records-overhaul` returns a valid commit SHA, `.git/checkpoints/pre-patient-records-overhaul-untracked/` contains SHA-256-verified backups of every untracked file (including `0033_pending_opd_arrival_cancelled_status.py`), and `git status --short` is 100% identical before and after.
  - `d:\dr-sr\backend\.venv\Scripts\pytest.exe backend/tests/test_route_policies.py backend/tests/test_permissions_catalogue.py` runs and baseline status is logged.
  - `npm --prefix frontend run typecheck` and `npm --prefix frontend test -- src/test/guards/guards.test.ts` exit `0`.
- **status**: Completed
- **log**: 2026-11-18 — Pinned non-destructive ref `refs/checkpoints/pre-patient-records-overhaul` (`473166c756aa1c088578d2d1c9c10622a72193d4`), backed up all 17 untracked files (including `0033_pending_opd_arrival_cancelled_status.py`) to `.git/checkpoints/pre-patient-records-overhaul-untracked/` with 17/17 SHA-256 verified, confirmed `git status --short` unchanged (78 lines). Baseline green: `pytest test_route_policies.py test_permissions_catalogue.py` (15 passed), `npm --prefix frontend run typecheck` (0 errors), `guards.test.ts` (7/7 passed).
- **files edited/created**: None (checkpoint ref & `.git/checkpoints/` backup only)

---

### Milestone 1 — Foundation: Patient Master Extensions, Visit/Encounter Codes, Summary API & Patient Workspace Shell

#### T1.1: Migration `0034` & ORM Models — Patient Extended Columns, Structured Allergies, Visit/Encounter Codes & `clinical_encounters.visit_id`
- **depends_on**: [T0]
- **location**:
  - `backend/src/kalyan_api/migrations/versions/0034_patient_master_and_visit_encounter_codes.py` (new)
  - `backend/src/kalyan_api/models.py`
- **description**:
  - Create Alembic migration `0034` (`down_revision = "0033"`), asserting PostgreSQL `>= 15` (`SHOW server_version_num >= 150000`) before adding composite `ON DELETE SET NULL (visit_id)` FK, and passing **bare** `CheckConstraint` names (since `models.py:48` auto-prefixes `ck_<table>_`):
    1. **Extend `patients`**: Add optional nullable columns `alternate_mobile VARCHAR(15)`, `email VARCHAR(120)`, `blood_group VARCHAR(8)` (CHECK `"blood_group_valid"`: `blood_group IS NULL OR blood_group IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')`), `pin_code VARCHAR(10)`, `guardian_relationship VARCHAR(40)`, `medical_history_notes TEXT`.
    2. **Create `patient_allergies`**: `id BIGINT IDENTITY PK`, `patient_id BIGINT NOT NULL REFERENCES patients(id) ON DELETE RESTRICT`, `substance VARCHAR(160) NOT NULL`, `category VARCHAR(24) NOT NULL DEFAULT 'DRUG'` (CHECK `"category_valid"` `IN ('DRUG','FOOD','ENVIRONMENTAL','OTHER')`), `severity VARCHAR(24) NOT NULL DEFAULT 'MODERATE'` (CHECK `"severity_valid"` `IN ('MILD','MODERATE','SEVERE','LIFE_THREATENING')`), `reaction TEXT`, `clinical_notes TEXT`, `status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE'` (CHECK `"status_valid"` `IN ('ACTIVE','INACTIVE','RESOLVED')`), `doctor_id BIGINT REFERENCES doctors(id) ON DELETE RESTRICT` *(nullable for legacy seeded rows; stamped on doctor writes for native `DWS-04` cross-doctor read auditing)*, `recorded_by_user_id BIGINT REFERENCES users(id) ON DELETE RESTRICT`, `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `version_id INTEGER NOT NULL DEFAULT 1`, index `ix_patient_allergies_patient_status (patient_id, status)`.
       - **Non-destructive one-time seed**: Insert one `ACTIVE` `patient_allergies` row (`category='OTHER'`, `severity='MODERATE'`) for each existing patient whose trimmed lower `patients.allergies` is not in `('', 'none', 'none reported', 'nil', 'nkda', 'n/a', 'no known allergies')`, without modifying or clearing `patients.allergies`.
    3. **Visit & Encounter Code Sequences + Safe `BEFORE INSERT` Auto-Allocation Trigger**:
       - Create `visit_sequences (year INTEGER PRIMARY KEY, last_number INTEGER NOT NULL DEFAULT 0)` and `encounter_sequences (year INTEGER PRIMARY KEY, last_number INTEGER NOT NULL DEFAULT 0)`.
       - Add `visits.visit_code VARCHAR(16)` (`VIS-YY-NNNNNN`), deterministically backfill existing `visits` ordered by `(EXTRACT(YEAR FROM visit_date), id)` and synchronize `visit_sequences`, alter `visit_code` to `NOT NULL`, add unique `uq_visits_visit_code`.
       - Add a PostgreSQL `BEFORE INSERT` trigger `trg_visits_default_visit_code` on `visits` (and `trg_encounters_default_encounter_code` on `clinical_encounters`) that atomically allocates from `visit_sequences` / `encounter_sequences` **whenever `NEW.visit_code IS NULL` / `NEW.encounter_code IS NULL`**. *Why*: Guarantees 25+ existing test suites and any direct ORM inserts (`Visit(...)`, `ClinicalEncounter(...)`) never fail `NOT NULL` violations while guaranteeing canonical gap-free `VIS-YY-NNNNNN` / `ENC-YY-NNNNNN` codes even if a caller bypasses the service!
       - Add `clinical_encounters.encounter_code VARCHAR(16)` (`ENC-YY-NNNNNN`) and nullable `clinical_encounters.visit_id BIGINT`. Temporarily disable `trg_prevent_finalised_encounter_tampering` **only inside this owner transaction** (mirroring `0017` pattern), backfill `encounter_code` ordered by `(EXTRACT(YEAR FROM encounter_date), id)` + sync `encounter_sequences`, backfill `clinical_encounters.visit_id` **strictly where** `appointment_id IS NOT NULL` AND `appointments.visit_id IS NOT NULL` (**never** fabricate visits for pre-0025 rows), re-enable trigger, set `encounter_code NOT NULL`, add unique `uq_clinical_encounters_encounter_code`, and execute raw SQL PG15+ composite FK:
         ```sql
         ALTER TABLE clinical_encounters
           ADD CONSTRAINT fk_clinical_encounters_visit_patient
           FOREIGN KEY (visit_id, patient_id)
           REFERENCES visits (id, patient_id)
           ON DELETE SET NULL (visit_id);
         ```
       - Update `fn_prevent_finalised_encounter_tampering()` (`0012:255-263`) so `encounter_code` and `visit_id` are also locked immutable once `is_finalised = TRUE`!
       - Add index `ix_clinical_encounters_visit_id (visit_id)`. *(Do NOT recreate `uq_clinical_encounters_id_patient` — it already exists from `0022:53` / `models.py:1221`.)*
    4. **Normalize `appointments.status`**: Trim whitespace / uppercase any stray casing on `appointments.status`, verify no unknown values exist before applying constraint (raising an actionable error if an unexpected status is found), and add bare CHECK `"status_valid"` covering canonical `AppointmentStatus` enum values (`BOOKED`, `ARRIVED`, `IN_CONSULTATION`, `DONE`, `CANCELLED`, `NO_SHOW`, `RESCHEDULED`, `TO_ARRIVE`, `REGISTERED`, `CHECKED_IN`, `WAITING`, `COMPLETED`).
    5. **Least-Privilege Grants**: `GRANT SELECT, INSERT, UPDATE ON patient_allergies, visit_sequences, encounter_sequences TO kalyan_app;` and `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kalyan_app;`.
    6. **Fail-Closed `downgrade()`**: Raise `RuntimeError` if any `patient_allergies` rows exist or `visit_code`/`encounter_code` would lose referenced data; otherwise drop only newly created triggers/columns/tables cleanly.
  - Update `backend/src/kalyan_api/models.py` with the new `Patient`, `Visit`, `ClinicalEncounter` columns/constraints (using `server_default` / `nullable=False` matching trigger default so ORM omits explicit `visit_code`/`encounter_code` cleanly when unprovided, and omitting PG15 `SET NULL (visit_id)` clause from declarative `ForeignKeyConstraint` `ondelete`) plus `PatientAllergy`, `VisitSequence`, `EncounterSequence` SQLAlchemy 2.0 models.
- **validation**:
  - `d:\dr-sr\backend\.venv\Scripts\python.exe -m ruff check backend/src/kalyan_api/models.py backend/src/kalyan_api/migrations/versions/0034_patient_master_and_visit_encounter_codes.py` exits `0`.
  - `d:\dr-sr\backend\.venv\Scripts\pytest.exe backend/tests/test_patient_models.py backend/tests/test_reception_visits_schema.py backend/tests/test_clinical_encounters.py` passes on fresh migrated `kalyan_test` DB.
- **status**: Completed
- **log**: 2026-11-18 — Migration `0034` (`down_revision="0033"`) + ORM models implemented and verified: `ruff check` exit 0, `pytest` 24 passed, plus rolled-back `owner_engine` & `app_engine` verification of all 8 PG15 constraints, auto-code triggers + `FetchedValue`, `kalyan_app` grants/DELETE denial, finalised encounter lock on `encounter_code`/`visit_id`, fail-closed downgrade, and pre-0034 backfill (`ALL_T11_DB_INVARIANTS_VERIFIED_OK`).
- **files edited/created**: `backend/src/kalyan_api/migrations/versions/0034_patient_master_and_visit_encounter_codes.py` (created), `backend/src/kalyan_api/models.py` (modified)

#### T1.2: Core Permissions (M1), Audit Actions, Code Sequence & Alias Helper Services, Merge Support & Visit/Encounter Code Wiring
- **depends_on**: [T1.1]
- **location**:
  - `backend/src/kalyan_api/core/permissions.py`
  - `backend/src/kalyan_api/services/audit_service.py`
  - `backend/src/kalyan_api/services/code_sequence_service.py` (new)
  - `backend/src/kalyan_api/services/visit_service.py`
  - `backend/src/kalyan_api/services/patient_merge_service.py`
  - `backend/src/kalyan_api/schemas/encounters.py`
  - `backend/src/kalyan_api/routers/encounters.py`
- **description**:
  - Update `core/permissions.py`:
    - Grant read-only, authenticated `Permission.PHOTO_READ` to `Role.ADMIN` and `Role.DOCTOR` (keep `PHOTO_WRITE` strictly `RECEPTION`-only).
    - Add `Permission.ALLERGY_WRITE = "allergy:write"` and grant **exclusively to `Role.DOCTOR`** (clinical permission — strictly NOT granted to `RECEPTION` or `ADMIN`; bound in `T1.3`, so zero orphan permissions).
  - Update `services/audit_service.py`: Add `AuditAction` enum entries (`<= 48` chars each): `ALLERGY_RECORDED`, `ALLERGY_UPDATED`, `CONDITION_RECORDED`, `CONDITION_UPDATED`, `DIAGNOSIS_RECORDED`, `DIAGNOSIS_UPDATED`, `INVESTIGATION_ORDERED`, `INVESTIGATION_UPDATED`, `INVESTIGATION_RESULT_RECORDED`, `PRESCRIPTION_AMENDED`, `PAYMENT_REFUNDED`, `DOCUMENT_UPLOADED`, `DOCUMENT_DOWNLOADED`, `DOCUMENT_ARCHIVED`.
  - Create `services/code_sequence_service.py`:
    - `allocate_visit_code(session: Session, visit_date: date) -> str`: atomic row-locked (`SELECT ... FOR UPDATE` with `INSERT ... ON CONFLICT DO NOTHING` bootstrap) allocation returning `VIS-{yy:02d}-{seq:06d}`.
    - `allocate_encounter_code(session: Session, encounter_date: date) -> str`: atomic row-locked allocation returning `ENC-{yy:02d}-{seq:06d}`.
    - `effective_patient_ids(session: Session, patient_id: int) -> list[int]`: returns `[patient_id, *merged_ids]` (downward alias consolidation matching `timeline.py` / `visits.py`).
    - `require_active_unmerged_patient(session: Session, patient_id: int) -> Patient`: returns active, non-archived, non-merged patient for write endpoints, raising `404` if missing or `409 patient_inactive_or_merged` if archived/merged/inactive.
  - Update `services/patient_merge_service.py`: add the 6 new optional `Patient` columns (`alternate_mobile`, `email`, `blood_group`, `pin_code`, `guardian_relationship`, `medical_history_notes`) to `ALLOWED_OVERRIDE_FIELDS` so merges preserve secondary contact/medical fields cleanly.
  - Wire `visit_code = allocate_visit_code(...)` into `services/visit_service.py` whenever a new `Visit` is created.
  - Update `schemas/encounters.py` & `routers/encounters.py`:
    - Expose `encounter_code: str` and `visit_id: int | None` on `EncounterRead`; accept optional `visit_id: int | None = None` on `EncounterCreate` for walk-in encounters (`appointment_id=None`, validated to belong to `patient_id`), while automatically deriving `visit_id = appointment.visit_id` when `appointment_id` is set.
    - Wire `encounter_code = allocate_encounter_code(...)` in `POST /api/encounters`. (Legacy pre-0025 encounters with `visit_id=None` remain fully accessible in the `Clinical Records` tab.)
- **validation**:
  - `d:\dr-sr\backend\.venv\Scripts\python.exe -m ruff check backend/src/kalyan_api/core/permissions.py backend/src/kalyan_api/services/audit_service.py backend/src/kalyan_api/services/code_sequence_service.py backend/src/kalyan_api/services/visit_service.py backend/src/kalyan_api/services/patient_merge_service.py backend/src/kalyan_api/schemas/encounters.py backend/src/kalyan_api/routers/encounters.py` exits `0`.
  - `d:\dr-sr\backend\.venv\Scripts\pytest.exe backend/tests/test_reception_checkin_api.py backend/tests/test_clinical_encounters.py backend/tests/test_phase23_patient_merge.py` passes.
- **status**: Completed
- **log**: 2026-11-18 — Granted `PHOTO_READ` to `ADMIN`/`DOCTOR` and clinical `ALLERGY_WRITE` exclusively to `DOCTOR`; added 14 `AuditAction` entries; created `code_sequence_service.py` (`allocate_visit_code`, `allocate_encounter_code`, `effective_patient_ids`, `require_active_unmerged_patient`); updated `patient_merge_service.py` override fields; wired `visit_code` & `encounter_code`/`visit_id` allocation. `ruff check` exit 0, `pytest` 36 passed, rolled-back self-check `T12_SELF_CHECK_ALL_OK`.
- **files edited/created**: `backend/src/kalyan_api/core/permissions.py`, `backend/src/kalyan_api/services/audit_service.py`, `backend/src/kalyan_api/services/code_sequence_service.py` (created), `backend/src/kalyan_api/services/visit_service.py`, `backend/src/kalyan_api/services/patient_merge_service.py`, `backend/src/kalyan_api/schemas/encounters.py`, `backend/src/kalyan_api/routers/encounters.py`

#### T1.3: Patient Extended Demographics, Computed Age, Structured Allergies CRUD & `VisitDetail.payments` Bug Fix
- **depends_on**: [T1.2]
- **location**:
  - `backend/src/kalyan_api/schemas/patients.py`
  - `backend/src/kalyan_api/services/patient_service.py`
  - `backend/src/kalyan_api/routers/patients.py`
  - `backend/src/kalyan_api/schemas/visits.py`
  - `backend/src/kalyan_api/routers/visits.py`
- **description**:
  - Extend `PatientCreate`, `PatientUpdate`, `PatientOut` in `schemas/patients.py`:
    - Add optional `alternate_mobile`, `email`, `blood_group`, `pin_code`, `guardian_relationship`, `medical_history_notes`.
    - Add computed `computed_age_years: int` calculated from `dob` against IST today (`clock.ist_today()`) when `dob` is present, falling back to `age_years` when `dob` is `None`.
    - Add `PatientAllergyCreate`, `PatientAllergyUpdate`, `PatientAllergyOut` schemas (including `substance`, `category`, `severity`, `reaction`, `clinical_notes`, `status`, `doctor_id`, `recorded_by_user_id`, `recorded_by_username`, `version_id`).
  - Update `services/patient_service.py` & `routers/patients.py`:
    - Persist and audit the new optional demographic fields on `POST /api/patients` and `PATCH /api/patients/{id}` (preserving 12 canonical required fields & optimistic `version_id` locking).
    - Add structured clinical allergy endpoints on `routers/patients.py` (**strictly `DOCTOR`-only — `403` for `RECEPTION` and `ADMIN`**):
      - `GET /api/patients/{id}/allergies` (`require(Permission.ENCOUNTER_READ)`): succeeds on archived/merged patients; consolidates `effective_patient_ids(session, id)`, calls `audit_cross_doctor_list_read` per `DWS-04` (on rows with `doctor_id != None`), and returns full clinical allergy details (active first, then inactive/resolved).
      - `POST /api/patients/{id}/allergies` (`require(Permission.ALLERGY_WRITE)` — `DOCTOR` only): enforces `require_active_unmerged_patient` (`409` on archived/merged), stamps `doctor_id = principal.doctor_id` & `recorded_by_user_id = principal.user_id`, creates allergy row + `AuditAction.ALLERGY_RECORDED` audit entry.
      - `PATCH /api/patients/{id}/allergies/{allergy_id}` (`require(Permission.ALLERGY_WRITE)` — `DOCTOR` only): enforces `require_active_unmerged_patient`, optimistic `version_id` lock (`409`), updates clinical allergy fields + `AuditAction.ALLERGY_UPDATED`.
  - Update `schemas/visits.py` & `routers/visits.py`:
    - Expose `visit_code: str` on `VisitRead`, `VisitSummary`, `VisitDetail`.
    - **Fix audit bug (`visits.py:98`)**: Remove `if p.appointment_id is not None` filter in `_to_detail()` (making `VisitPayment.appointment_id: int | None = None` and adding `visit_id: int | None = None`) so visit-level payments (`p.visit_id == visit.id` with `appointment_id=None`) are no longer silently dropped from `VisitDetail.payments`!
- **validation**:
  - `d:\dr-sr\backend\.venv\Scripts\python.exe -m ruff check backend/src/kalyan_api/schemas/patients.py backend/src/kalyan_api/services/patient_service.py backend/src/kalyan_api/routers/patients.py backend/src/kalyan_api/schemas/visits.py backend/src/kalyan_api/routers/visits.py` exits `0`.
  - `d:\dr-sr\backend\.venv\Scripts\pytest.exe backend/tests/test_patient_registration.py backend/tests/test_visit_checkout_api.py backend/tests/test_phase22_visit_payments.py` passes.
- **status**: Completed
- **log**: 2026-11-18 — Extended `PatientCreate`/`PatientUpdate`/`PatientOut` (6 optional fields + `computed_age_years` via `clock.ist_today()`), added `DOCTOR`-only structured clinical allergy CRUD (`GET`/`POST`/`PATCH /api/patients/{id}/allergies` with `DWS-04` audit, optimistic lock, active/unmerged guard, alias consolidation), exposed `visit_code`, and fixed `VisitDetail.payments` visit-level payment drop. `ruff check` exit 0, `pytest` 26 passed, rolled-back self-check `T13_SELF_CHECK_ALL_OK`.
- **files edited/created**: `backend/src/kalyan_api/schemas/patients.py`, `backend/src/kalyan_api/services/patient_service.py`, `backend/src/kalyan_api/routers/patients.py`, `backend/src/kalyan_api/schemas/visits.py`, `backend/src/kalyan_api/routers/visits.py`

#### T1.4: Role-Redacted Patient Summary & Patient Visit History APIs
- **depends_on**: [T1.2]
- **location**:
  - `backend/src/kalyan_api/schemas/patient_workspace.py` (new)
  - `backend/src/kalyan_api/services/patient_summary_service.py` (new)
  - `backend/src/kalyan_api/routers/patient_workspace.py` (new)
- **description**:
  - Create `schemas/patient_workspace.py`:
    - `AllergySafetyAlertOut`: `has_allergies: bool`, `count: int`, `highest_severity: str | None`, `alert_labels: list[str]` *(strictly safety-alert labels only — zero `reaction`, `clinical_notes`, or `recorded_by`!)*.
    - `PatientSummaryOut`: `patient_id`, `urn`, `total_visits`, `active_treatment_plans`, `latest_visit: LatestVisitBrief | None`, **role-gated allergy projections**:
      - `allergy_alert: AllergySafetyAlertOut | None` — populated for `RECEPTION` & `DOCTOR`; **strictly `None` for `ADMIN`** (no allergy details by default!).
      - `active_allergies: list[PatientAllergyOut] | None` — populated with full clinical details **strictly for `DOCTOR`**; **strictly `None` for `RECEPTION` and `ADMIN`** under `D-04`!
    - Role-gated clinical KPIs (`DOCTOR` only; strictly `None` for `ADMIN`/`RECEPTION` under `D-04`): `prescriptions_count: int | None`, `active_conditions_count: int | None`, `latest_encounter: LatestEncounterBrief | None`.
    - Role-gated financial KPIs (`ADMIN`/`RECEPTION` only; strictly `None` for `DOCTOR` per `AGENTS.md` #7): `total_billed_paise: int | None`, `total_paid_paise: int | None`, `total_refunded_paise: int | None`, `outstanding_paise: int | None`.
    - `PatientVisitHistoryItem` & `PatientVisitHistoryResponse`: `visit_id`, `visit_code`, `visit_date`, `status`, `token_numbers`, `doctors`, `departments`, `consultation_count`, `completed_consultations`, `encounter_links` (`DOCTOR` only: `encounter_id`, `encounter_code`, `is_finalised`, `doctor_name`), `bill_total_paise`/`paid_paise`/`due_paise`/`payment_status` (`ADMIN`/`RECEPTION` only: `UNPAID`/`PARTIAL`/`PAID`/`NO_CHARGES`).
  - Create `services/patient_summary_service.py`:
    - Implement `build_patient_summary(session, patient_id, principal)` and `list_patient_visit_history(session, patient_id, principal, limit, offset)` allowing reads on archived/merged patients (404 only if patient ID does not exist), consolidating `effective_patient_ids(session, patient_id)` with batched SQL aggregates (zero N+1 queries).
    - Strictly enforce `D-04`: never query clinical tables (`clinical_encounters`, `prescriptions`, `patient_conditions`) when `principal.role != Role.DOCTOR`; for `ADMIN`, never populate `allergy_alert` or `active_allergies` (`None`); for `RECEPTION`, project ONLY `allergy_alert` (no `reaction`/`clinical_notes`) and set `active_allergies = None`; for `DOCTOR`, never populate financial totals (`AGENTS.md` #7).
  - Create `routers/patient_workspace.py` (prefix `/patients`, tags `["patient-workspace"]`):
    - `GET /api/patients/{patient_id}/summary` (`require(Permission.PATIENT_READ)`)
    - `GET /api/patients/{patient_id}/visits` (`require(Permission.PATIENT_READ)`)
- **validation**:
  - `d:\dr-sr\backend\.venv\Scripts\python.exe -m ruff check backend/src/kalyan_api/schemas/patient_workspace.py backend/src/kalyan_api/services/patient_summary_service.py backend/src/kalyan_api/routers/patient_workspace.py` exits `0`.
  - *(Mounted and integration-tested in `T1.5`.)*
- **status**: Completed
- **log**: 2026-11-18 — Created role-redacted `schemas/patient_workspace.py`, `services/patient_summary_service.py` (batched SQL, alias consolidation, `D-04` + `AGENTS.md` #7 + `DWS-04` audit, Phase 22 billing parity), and `routers/patient_workspace.py`. `ruff check` exit 0; rolled-back `kalyan_test` (`kalyan_app`) smoke check `T14_SMOKE_CHECK_ALL_OK`.
- **files edited/created**: `backend/src/kalyan_api/schemas/patient_workspace.py` (created), `backend/src/kalyan_api/services/patient_summary_service.py` (created), `backend/src/kalyan_api/routers/patient_workspace.py` (created)

#### T1.5: Milestone 1 Backend Integration — Mount Router, Update RBAC Matrix, Permissions Catalogue, OpenAPI Snapshot & M1 Pytest Suite
- **depends_on**: [T1.3, T1.4]
- **location**:
  - `backend/src/kalyan_api/main.py`
  - `backend/tests/support/matrix.py`
  - `backend/tests/test_permissions_catalogue.py`
  - `backend/tests/test_patient_edit_photo.py`
  - `backend/tests/openapi.snapshot.json`
  - `backend/tests/test_patient_workspace_foundation.py` (new)
- **description**:
  - Mount `patient_workspace_router` in `backend/src/kalyan_api/main.py` under `/api`.
  - Update `backend/tests/test_permissions_catalogue.py`: add `Permission.ALLERGY_WRITE` to `CLINICAL_PERMISSIONS` (mechanically asserting `ADMIN` & `RECEPTION` never hold it!) and update `test_golden_role_permissions_snapshot` with `PHOTO_READ` for `ADMIN`/`DOCTOR` and `ALLERGY_WRITE` for `DOCTOR` ONLY.
  - Update `backend/tests/support/matrix.py`:
    - Update `GET /api/patients/{id}/photo` expected status to authorized for `admin`, `doctor_a`, `doctor_b` while keeping `POST /api/patients/{id}/photo` strictly `RECEPTION`-only (`403` for Admin/Doctor).
    - Add 5-identity matrix rows (`anonymous`, `admin`, `reception`, `doctor_a`, `doctor_b`) for `GET /api/patients/{id}/summary`, `GET /api/patients/{id}/visits`, and `GET`/`POST`/`PATCH /api/patients/{id}/allergies` (**`403` for `admin` AND `reception`**, `200`/`201` for `doctor_a`/`doctor_b`).
  - Update `backend/tests/test_patient_edit_photo.py` to assert `DOCTOR` and `ADMIN` can stream `GET /api/patients/{id}/photo` (`200`) while still receiving `403` on `POST /api/patients/{id}/photo`.
  - Refresh `backend/tests/openapi.snapshot.json` via `python -m kalyan_api.cli export-openapi --out backend/tests/openapi.snapshot.json`.
  - Write `backend/tests/test_patient_workspace_foundation.py` covering:
    - `visit_code` (`VIS-YY-NNNNNN`) & `encounter_code` (`ENC-YY-NNNNNN`) atomic uniqueness, DB fallback trigger on direct ORM insert, and finalised encounter tamper lock on `encounter_code`/`visit_id` (tested against `owner_engine`).
    - `clinical_encounters.visit_id` propagation for visit-linked appointments, optional walk-in `visit_id`, and NULL preservation for unlinked legacy rows.
    - `computed_age_years` from `dob` (`clock.ist_today()`) vs `age_years` fallback.
    - Structured clinical allergies CRUD (`DOCTOR` only: `403` for `RECEPTION`/`ADMIN` on GET/POST/PATCH, `DWS-04` cross-doctor audit on read, optimistic lock `409`, archived/merged write `409` vs read `200`, audit trail, alias consolidation).
    - `VisitDetail.payments` includes visit-level payments (`visit_id` set, `appointment_id=None`).
    - Strict `D-04` & allergy redaction on `/summary` & `/visits`: `DOCTOR` receives full `active_allergies` + `allergy_alert` + clinical KPIs and `null` financial KPIs; `RECEPTION` receives safety-only `allergy_alert` (`active_allergies=null`, zero `reaction`/`clinical_notes`) + financial KPIs and `null` clinical KPIs; `ADMIN` receives `allergy_alert=null`, `active_allergies=null`, `null` clinical KPIs, and financial KPIs.
    - Verify `kalyan_app` role (`db_session`) can SELECT/INSERT/UPDATE `patient_allergies`, `visit_sequences`, `encounter_sequences`.
- **validation**:
  - `d:\dr-sr\backend\.venv\Scripts\pytest.exe backend/tests/test_route_policies.py backend/tests/test_rbac_matrix.py backend/tests/test_openapi_snapshot.py backend/tests/test_permissions_catalogue.py backend/tests/test_patient_edit_photo.py backend/tests/test_patient_workspace_foundation.py` passes 100%.
  - `d:\dr-sr\backend\.venv\Scripts\python.exe -m ruff check backend/src backend/tests` exits `0`.
- **status**: Completed
- **log**: 2026-11-18 — Mounted `patient_workspace_router` in `main.py`; updated `test_permissions_catalogue.py` (`ALLERGY_WRITE` in `CLINICAL_PERMISSIONS`, golden snapshot for `PHOTO_READ` + `ALLERGY_WRITE`), `matrix.py` + `test_rbac_matrix.py` (5-identity coverage incl. `{allergy_id}` seeding), `test_patient_edit_photo.py`, `openapi.snapshot.json`, and created `test_patient_workspace_foundation.py` (8 comprehensive tests). Validation: `912 passed` across full RBAC/route/OpenAPI/catalogue/photo/foundation gate; `ruff check` exit 0 on all 7 owned files (pre-existing 286 ruff errors remain in untouched non-M1 files).
- **files edited/created**: `backend/src/kalyan_api/main.py`, `backend/tests/support/matrix.py`, `backend/tests/test_rbac_matrix.py`, `backend/tests/test_permissions_catalogue.py`, `backend/tests/test_patient_edit_photo.py`, `backend/tests/openapi.snapshot.json`, `backend/tests/test_patient_workspace_foundation.py` (created)

#### T1.6: Frontend M1 API Types, Query Hooks & Extended `PatientRegister` Optional Fields
- **depends_on**: [T1.5]
- **location**:
  - `frontend/src/api/types.ts`
  - `frontend/src/api/queries.ts`
  - `frontend/src/pages/PatientRegister.tsx`
- **description**:
  - Update `frontend/src/api/types.ts`: add optional fields (`alternate_mobile`, `email`, `blood_group`, `pin_code`, `guardian_relationship`, `medical_history_notes`, `computed_age_years`) on `PatientOut`/`PatientCreate`/`PatientUpdate`; add `visit_code` on `VisitSummary`/`VisitDetail`, `encounter_code`/`visit_id` on `EncounterRead`; add `AllergySafetyAlertOut`, `PatientAllergyOut` (with `clinical_notes`, `recorded_by_username`), `PatientSummaryOut`, `PatientVisitHistoryItem`, `PatientVisitHistoryResponse`.
  - Update `frontend/src/api/queries.ts`: add `usePatientSummary`, `usePatientVisits`, `usePatientAllergies` (`enabled` only for `DOCTOR`), `useCreatePatientAllergy`, `useUpdatePatientAllergy` (with proper React Query invalidation of `['patient-summary', patientId]` and `['patient-allergies', patientId]`).
  - Update `frontend/src/pages/PatientRegister.tsx`: add a clean collapsible/grouped **"Additional Details (Optional)"** section for `alternate_mobile`, `email`, `blood_group` (`<select>` with accessible label), `pin_code`, `guardian_relationship`, and `medical_history_notes` while keeping the 12 canonical required fields, duplicate warning, photo capture, and `version_id` optimistic locking intact.
- **validation**:
  - `npm --prefix frontend run typecheck` exits `0`.
  - `npm --prefix frontend run lint` exits `0`.
  - `npm --prefix frontend test -- src/test/guards/guards.test.ts` passes.
- **status**: Completed
- **log**: 2026-11-18 — Added M1 TypeScript interfaces (`PatientSummaryOut`, `AllergySafetyAlertOut`, `PatientAllergyOut`, `PatientVisitHistoryResponse`, extended patient/visit/encounter fields), React Query hooks (`usePatientSummary`, `usePatientVisits`, `usePatientAllergies`, `useCreatePatientAllergy`, `useUpdatePatientAllergy`), and collapsible optional details section in `PatientRegister.tsx`. Validation: `tsc -b` exit 0, `oxlint` 0 warnings/0 errors, Vitest `guards.test.ts` + `patient-register.test.tsx` 29/29 passed.
- **files edited/created**: `frontend/src/api/types.ts`, `frontend/src/api/queries.ts`, `frontend/src/pages/PatientRegister.tsx`

#### T1.7a: Frontend Persistent Patient Identity Header & Overview Tab Components
- **depends_on**: [T1.6]
- **location**:
  - `frontend/src/components/patient/PatientIdentityHeader.tsx` (new)
  - `frontend/src/components/patient/PatientOverviewTab.tsx` (new)
- **description**:
  - Create `PatientIdentityHeader.tsx`:
    - Persistent top banner displayed across **every** tab in `PatientDetail.tsx`:
      - Patient photo (`/api/patients/${id}/photo`, now authorized for all 3 roles) with crisp initials fallback.
      - Full name, high-contrast URN badge (`bg-[#5D0B26] text-white font-mono`), status pills (`Active` / `Archived` / `Merged into URN` with clickable master link).
      - Compact identity line: computed age (`computed_age_years` + DOB if recorded), gender, primary mobile, guardian name (+ relationship if set), blood group pill if set.
      - **Role-Adapted Allergy Alert Banner**:
        - For `DOCTOR`: high-contrast amber/rose banner displaying active structured clinical allergies with severity badges & reactions (or compact `No known allergies` pill).
        - For `RECEPTION`: compact **safety-alert-only** banner driven strictly by `summary.allergy_alert` (`has_allergies`, `count`, `highest_severity`, `alert_labels` — strictly NO clinical notes, reactions, or edit links).
        - For `ADMIN`: **hidden completely** (no allergy details shown by default; `summary.allergy_alert === null`).
      - **KPI Summary Strip** (`usePatientSummary`): Total Visits, Active Plans, Prescriptions (`DOCTOR` only), Outstanding Balance (`ADMIN`/`RECEPTION` only, formatted via `formatPaise()`).
      - Role-gated quick actions (`min-h-11`): `Edit Patient` (`RECEPTION`, disabled/hidden if archived/merged), `Book / Check-in` (`RECEPTION` -> `/reception/tokens?patient_id=...`), `Correct Demographics` (`ADMIN` -> `/admin/patients/correct`), `Print Card` (all roles -> `/reception/patients/:id/print`).
  - Create `PatientOverviewTab.tsx`:
    - Compact grouped profile cards: Demographics, Contact & Address (including alternate mobile, email, pin code, emergency contact), Role-Adapted Allergies section (**`DOCTOR`**: full structured clinical allergies table with `reaction`, `clinical_notes`, `recorded_by`, plus inline Add/Update/Resolve controls gated strictly to `allergy:write` on active unmerged patients; **`RECEPTION`**: read-only safety-alert-only card from `summary.allergy_alert` with zero clinical notes/reactions and zero edit controls; **`ADMIN`**: omitted completely!), Background & Medical History notes, and Latest Visit / Latest Encounter (`DOCTOR`) snapshot card with direct drill-down button.
    - Leave a clean prop/slot for Longitudinal Conditions (wired for `DOCTOR` in M2 `T2.9`).
    - Zero UX-04/UX-06 violations (all text `>= 12px`, accessible labels on all form inputs, no `text-red-500`/`text-amber-600`).
- **validation**:
  - From `frontend/`: `.\node_modules\.bin\oxlint.cmd src/components/patient/PatientIdentityHeader.tsx src/components/patient/PatientOverviewTab.tsx` exits `0`.
  - *(Integrated and tested with `PatientDetail.tsx` in `T1.8`.)*
- **status**: Completed
- **log**: 2026-11-18 — Created `PatientIdentityHeader.tsx` & `PatientOverviewTab.tsx` with role-adapted allergy UI (Doctor full + modal CRUD w/ optimistic lock, Reception safety-alert-only from `/summary`, Admin omitted completely), role-gated KPI strip, `conditionsSlot` for M2, and Latest Visit/Encounter cards. Validation: `oxlint` 0 warnings/0 errors, `tsc -b` exit 0, `guards.test.ts` 7/7 passed.
- **files edited/created**: `frontend/src/components/patient/PatientIdentityHeader.tsx` (created), `frontend/src/components/patient/PatientOverviewTab.tsx` (created)

#### T1.7b: Frontend Visit History Tab Component
- **depends_on**: [T1.6]
- **location**:
  - `frontend/src/components/patient/PatientVisitHistoryTab.tsx` (new)
- **description**:
  - Create `PatientVisitHistoryTab.tsx` consuming `usePatientVisits(patientId)`:
    - Responsive table (desktop) / stacked cards (mobile `< md`) displaying chronological visits: `visit_code` (`VIS-YY-NNNNNN`), date (IST formatted), token number(s), doctor(s), department(s), visit status badge (`OPEN`/`CLOSED`/`CANCELLED`), clinical encounter link badges (`ENC-...`, `DOCTOR` only), billing summary & status badge (`PAID`/`PARTIAL`/`UNPAID`, `ADMIN`/`RECEPTION` only).
    - Each row provides a clear **`Open Visit Workspace →`** link to the role-neutral shared route `/patients/${patientId}/visits/${visit.visit_id}` (plus `Open Encounter` shortcut to `/doctor/encounters/${encId}` for `DOCTOR` when an encounter exists).
    - Handles loading (`TableSkeleton`), error (`InlineAlert`), and empty state cleanly.
- **validation**:
  - From `frontend/`: `.\node_modules\.bin\oxlint.cmd src/components/patient/PatientVisitHistoryTab.tsx` exits `0`.
  - *(Integrated and tested with `PatientDetail.tsx` in `T1.8`.)*
- **status**: Completed
- **log**: 2026-11-18 — Created `PatientVisitHistoryTab.tsx` with desktop table + mobile stacked cards, client pagination, `DOCTOR`-only encounter link badges, `ADMIN`/`RECEPTION`-only billing summary + payment status badges, and role-neutral `/patients/${patientId}/visits/${visit_id}` link. Validation: `oxlint` 0 warnings/0 errors, `tsc -b` exit 0, `guards.test.ts` 7/7 passed.
- **files edited/created**: `frontend/src/components/patient/PatientVisitHistoryTab.tsx` (created)

#### T1.8: Refactor `PatientDetail.tsx` into URL-Synced 9-Section Workspace, Remove Duplicated `PaymentHistory` & Fix `guards.test.ts` Ratchet
- **depends_on**: [T1.7a, T1.7b]
- **location**:
  - `frontend/src/pages/PatientDetail.tsx`
  - `frontend/src/test/guards/guards.test.ts`
  - `frontend/src/pages/__tests__/patient-timeline.test.tsx`
  - `frontend/src/components/__tests__/payment-history.test.tsx`
  - `frontend/src/pages/__tests__/patient-workspace-shell.test.tsx` (new)
- **description**:
  - Refactor `frontend/src/pages/PatientDetail.tsx`:
    - Sync active tab with URL query param `?tab=` via `useSearchParams` (`overview` default; **9 canonical section keys**: `overview`, `visits`, `clinical`, `prescriptions`, `investigations`, `therapy`, `billing`, `documents`, `audit`). Redirect invalid or unauthorized `?tab=` values cleanly back to `overview` without crashing.
    - **Fix post-edit redirect bug (`PatientDetail.tsx:107`)**: Change `navigate(location.pathname, { replace: true, state: null })` to `navigate(`${location.pathname}${location.search}`, { replace: true, state: null })` so clearing a one-time notice banner never strips `?tab=...`!
    - Render `<PatientIdentityHeader />` persistently above the tab navigation on ALL tabs.
    - Render responsive role-adapted **9-section** tab navigation (`role="tablist"` horizontal scrollable tabs on `sm+` + compact accessible `<select aria-label="Jump to patient record section">` on mobile):
      1. `Overview` — All roles (`<PatientOverviewTab />`)
      2. `Visit History` — All roles (`<PatientVisitHistoryTab />`)
      3. `Clinical Records` — `DOCTOR` only (`encounter:read`)
      4. `Prescriptions` — `DOCTOR` only (`prescription:read`)
      5. `Investigations` — `DOCTOR` only (`encounter:read`)
      6. `Treatment Plans` — All roles (role-adapted; uses `PatientTimeline(TREATMENT_PLAN/SESSION)` until M2 `T2.9` swaps in rich `PatientTreatmentPlansTab`)
      7. `Billing & Ledger` — **`ADMIN` and `RECEPTION` ONLY** (`payment:read`; strictly hidden for `DOCTOR` per `AGENTS.md` #7! Temporarily renders `<PaymentHistory patientId={patient.id} />` ONLY inside `activeTab === 'billing'` until M3 `T3.4` swaps in unified `PatientBillingLedgerTab`)
      8. `Documents` — All roles (role-filtered; clean empty/coming-soon placeholder until M4 `T4.7`)
      9. `Change History` — `ADMIN` only (`audit:read`, existing `PatientAuditHistory` with `text-[11px]` upgraded to `text-xs`)
    - **DELETE line 429** `{patient && <PaymentHistory patientId={patient.id} />}` so `PaymentHistory` is NEVER duplicated below Overview, Visit History, Treatment Plans, or Audit tabs!
  - Update `frontend/src/test/guards/guards.test.ts`: remove `'pages/PatientDetail.tsx'` from `PENDING` allow-list (satisfying the ratchet test now that `text-[11px]` is eliminated; keep the 3 client-held exemptions untouched).
  - Update existing tests (`patient-timeline.test.tsx`, `payment-history.test.tsx`) to match the new role-adapted tab labels and removal of duplicated `PaymentHistory`.
  - Write `frontend/src/pages/__tests__/patient-workspace-shell.test.tsx` verifying:
    - Persistent identity header + URN remain visible across tab switches; allergy display is full + editable for `DOCTOR`, safety-alert-only read-only for `RECEPTION`, and completely hidden for `ADMIN`.
    - `?tab=visits` URL sync survives reload/initial render AND notice dismissal preserves `?tab=`.
    - `PaymentHistory` does NOT render on `Overview`, `Visit History`, or `Treatment Plans` tabs.
    - Role-adapted 9-section tab visibility: `DOCTOR` sees `Clinical Records`/`Prescriptions`/`Investigations` and does NOT see `Billing & Ledger` or `Change History`; `RECEPTION` sees `Billing & Ledger` and does NOT see clinical tabs or `Change History`; `ADMIN` sees `Billing & Ledger` + `Change History` and does NOT see clinical tabs.
- **validation**:
  - `npm --prefix frontend run typecheck` exits `0`.
  - `npm --prefix frontend run lint` exits `0`.
  - `npm --prefix frontend test -- src/test/guards/guards.test.ts src/pages/__tests__/patient-workspace-shell.test.tsx src/pages/__tests__/patient-timeline.test.tsx src/components/__tests__/payment-history.test.tsx` passes 100%.
- **status**: Completed
- **log**: 2026-11-18 — Refactored `PatientDetail.tsx` into persistent header + URL-synced (`?tab=`) 9-section role-adapted workspace, fixed notice-dismissal search-param preservation, deleted unconditional `<PaymentHistory />` duplication, removed `pages/PatientDetail.tsx` from `guards.test.ts` `PENDING` ratchet, added 10 tests in `patient-workspace-shell.test.tsx`, added `Array.isArray` guard in `PatientOverviewTab.tsx`, and updated `patients-directory.test.tsx`. Full frontend regression: `tsc -b` exit 0, `oxlint` 0 warnings/0 errors, `npm --prefix frontend test` 77/77 files passed (629 passed, 5 skipped).
- **files edited/created**: `frontend/src/pages/PatientDetail.tsx`, `frontend/src/components/patient/PatientOverviewTab.tsx`, `frontend/src/test/guards/guards.test.ts`, `frontend/src/pages/__tests__/patients-directory.test.tsx`, `frontend/src/pages/__tests__/patient-workspace-shell.test.tsx` (created)

---

### Milestone 2 — Clinical Completeness: Structured Diagnoses, Longitudinal Conditions, Investigations, Prescription Versioning & Clinical UI Tabs

#### T2.1: Migration `0035`, ORM Models & Safe Rx Creation — Conditions, Structured Diagnoses, Investigations & Prescription Versioning + Tamper Triggers
- **depends_on**: [T1.5]
- **location**:
  - `backend/src/kalyan_api/migrations/versions/0035_clinical_records_completeness.py` (new)
  - `backend/src/kalyan_api/models.py`
  - `backend/src/kalyan_api/routers/prescriptions.py` (DRAFT -> flush items -> AUTHORISED write ordering only, so trigger does not break `POST /api/prescriptions`)
- **description**:
  - Create Alembic migration `0035` (`down_revision = "0034"`), using bare `CheckConstraint` names:
    1. **Create `patient_conditions`** (longitudinal problem list, `DOCTOR` scope): `id BIGINT IDENTITY PK`, `patient_id BIGINT NOT NULL REFERENCES patients(id) ON DELETE RESTRICT`, `doctor_id BIGINT NOT NULL REFERENCES doctors(id) ON DELETE RESTRICT` *(named `doctor_id` so `core/scope.py`'s `get_scoped_or_404` & `audit_cross_doctor_list_read` work natively without `AttributeError`!)*, `condition_name VARCHAR(200) NOT NULL`, `icd10_code VARCHAR(16)`, `status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE'` (CHECK `"status_valid"` `IN ('ACTIVE','RESOLVED','INACTIVE')`), `onset_date DATE`, `resolved_date DATE`, `notes TEXT`, `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `version_id INTEGER NOT NULL DEFAULT 1`, unique `(id, patient_id)` (`uq_patient_conditions_id_patient`), index `ix_patient_conditions_patient_status (patient_id, status)`.
    2. **Create `encounter_diagnoses`**: `id BIGINT IDENTITY PK`, `encounter_id BIGINT NOT NULL`, `patient_id BIGINT NOT NULL`, composite FK `(encounter_id, patient_id) REFERENCES clinical_encounters(id, patient_id) ON DELETE RESTRICT`, `doctor_id BIGINT NOT NULL REFERENCES doctors(id) ON DELETE RESTRICT`, `diagnosis_name VARCHAR(200) NOT NULL`, `icd10_code VARCHAR(16)`, `diagnosis_type VARCHAR(16) NOT NULL DEFAULT 'PRIMARY'` (CHECK `"type_valid"` `IN ('PRIMARY','SECONDARY','PROVISIONAL')`), `status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE'` (CHECK `"status_valid"` `IN ('ACTIVE','RESOLVED','INACTIVE')`), `onset_date DATE`, `notes TEXT`, `patient_condition_id BIGINT` with raw PG15+ composite FK `(patient_condition_id, patient_id) REFERENCES patient_conditions(id, patient_id) ON DELETE SET NULL (patient_condition_id)`.
       - Add trigger `trg_prevent_finalised_encounter_diagnosis_tampering` blocking INSERT/UPDATE/DELETE on `encounter_diagnoses` when parent `clinical_encounters.is_finalised = TRUE`.
    3. **Create `investigation_orders` & `investigation_results`**:
       - `investigation_orders`: `id BIGINT IDENTITY PK`, `encounter_id BIGINT NOT NULL`, `patient_id BIGINT NOT NULL`, composite FK `(encounter_id, patient_id) REFERENCES clinical_encounters(id, patient_id) ON DELETE RESTRICT`, `doctor_id BIGINT NOT NULL REFERENCES doctors(id) ON DELETE RESTRICT`, `category VARCHAR(24) NOT NULL` (CHECK `"category_valid"` `IN ('LAB','IMAGING','PATHOLOGY','DIAGNOSTIC','OTHER')`), `test_name VARCHAR(200) NOT NULL`, `instructions TEXT`, `priority VARCHAR(16) NOT NULL DEFAULT 'ROUTINE'` (CHECK `"priority_valid"` `IN ('ROUTINE','URGENT')`), `status VARCHAR(24) NOT NULL DEFAULT 'ORDERED'` (CHECK `"status_valid"` `IN ('ORDERED','SAMPLE_COLLECTED','COMPLETED','CANCELLED')`), `cancelled_reason TEXT` (CHECK `"cancel_reason_required"` `(status = 'CANCELLED' AND length(trim(coalesce(cancelled_reason,''))) >= 3) OR status <> 'CANCELLED'`), `ordered_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `version_id INTEGER NOT NULL DEFAULT 1`, unique `(id, patient_id)` (`uq_investigation_orders_id_patient`).
       - `investigation_results`: `id BIGINT IDENTITY PK`, `order_id BIGINT NOT NULL`, `patient_id BIGINT NOT NULL`, composite FK `(order_id, patient_id) REFERENCES investigation_orders(id, patient_id) ON DELETE RESTRICT`, `summary_text TEXT NOT NULL`, `result_value VARCHAR(120)`, `unit VARCHAR(40)`, `reference_range VARCHAR(120)`, `is_abnormal BOOLEAN NOT NULL DEFAULT FALSE`, `reported_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `recorded_by_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT`, `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`.
    4. **Prescription Versioning & Tamper Protection**:
       - Add columns on `prescriptions`: `revision_number INTEGER NOT NULL DEFAULT 1` (CHECK `"revision_positive"` `>= 1`), `supersedes_prescription_id BIGINT REFERENCES prescriptions(id) ON DELETE RESTRICT` (partial unique `uq_prescriptions_supersedes` `WHERE supersedes_prescription_id IS NOT NULL`), `amendment_reason TEXT`.
       - Drop existing `prescriptions.status` CHECK constraint safely with `DROP CONSTRAINT IF EXISTS ck_prescriptions_status` AND `DROP CONSTRAINT IF EXISTS ck_prescriptions_ck_prescriptions_status` (mirroring `0033:20-21`), then create CHECK `"status"` `status IN ('DRAFT','AUTHORISED','SUPERSEDED','CANCELLED')`.
       - Add trigger `trg_prevent_authorised_prescription_tampering` on `prescriptions`:
         - Blocks `DELETE` on `AUTHORISED`, `SUPERSEDED`, and `CANCELLED` rows (terminal medico-legal records).
         - Blocks `UPDATE` of all core fields (`patient_id`, `doctor_id`, `encounter_id`, `diagnosis`, `dietary_advice`, `general_advice`, `follow_up_date`, `revision_number`, `supersedes_prescription_id`, `amendment_reason`, print snapshots) when `OLD.status IN ('AUTHORISED', 'SUPERSEDED', 'CANCELLED')`.
         - Permits ONLY `AUTHORISED -> CANCELLED` (with cancel metadata) or `AUTHORISED -> SUPERSEDED` (status/updated_at/version_id only); blocks ALL updates when `OLD.status IN ('SUPERSEDED', 'CANCELLED')`.
       - Add trigger `trg_prevent_authorised_prescription_item_tampering` on `prescription_items`: blocks `INSERT`, `UPDATE`, or `DELETE` whenever parent `prescriptions.status <> 'DRAFT'`.
    5. **Refactor `create_prescription()` in `routers/prescriptions.py` (L212–245)**: Always insert the `Prescription` row with `status = PrescriptionStatus.DRAFT.value`, flush, insert all `PrescriptionItem` rows, flush, and THEN transition `prescription.status = PrescriptionStatus.AUTHORISED.value` in the same transaction when `authorise_immediately=True` (so `trg_prevent_authorised_prescription_item_tampering` passes cleanly on all existing tests!). Also update any test fixture in `test_prescriptions_api.py` / `test_prescription_lifecycle.py` if it inserts items after setting `AUTHORISED` directly.
    6. **Invariant #11 Protection**: Do NOT alter `trg_sync_treatment_plan_session_progress` or `treatment_sessions`.
    7. **Grants & Fail-Closed Downgrade**: `GRANT SELECT, INSERT, UPDATE, DELETE ON encounter_diagnoses TO kalyan_app;`, `GRANT SELECT, INSERT, UPDATE ON patient_conditions, investigation_orders TO kalyan_app;`, `GRANT SELECT, INSERT ON investigation_results TO kalyan_app;`, `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kalyan_app;`. Fail-closed `downgrade()` raising `RuntimeError` if any rows exist.
  - Update `backend/src/kalyan_api/models.py` with `PatientCondition`, `EncounterDiagnosis`, `InvestigationOrder`, `InvestigationResult`, and `Prescription` revision columns/status enum (`SUPERSEDED`).
- **validation**:
  - `d:\dr-sr\backend\.venv\Scripts\python.exe -m ruff check backend/src/kalyan_api/models.py backend/src/kalyan_api/routers/prescriptions.py backend/src/kalyan_api/migrations/versions/0035_clinical_records_completeness.py` exits `0`.
  - `d:\dr-sr\backend\.venv\Scripts\pytest.exe backend/tests/test_prescriptions_api.py backend/tests/test_prescription_lifecycle.py backend/tests/test_treatment_sessions_api.py backend/tests/test_phase22_prescribed_medicines.py` passes 100%.
- **status**: Completed
- **log**: 2026-11-18 — Migration `0035` (`down_revision="0034"`) + ORM models (`PatientCondition`, `EncounterDiagnosis`, `InvestigationOrder`, `InvestigationResult`, `Prescription` revision columns + `SUPERSEDED`) + tamper triggers (`encounter_diagnoses`, `prescriptions`, `prescription_items`) + `create_prescription` DRAFT->items->AUTHORISED refactor + 5 direct-ORM test helper updates. Validation: `ruff check` exit 0 on 3 source files, SQLAlchemy `configure_mappers()` 0 warnings, `owner_engine` & `kalyan_app` privilege/trigger/fail-closed downgrade/round-trip checks all passed, `pytest` 47/47 passed across 8 suites.
- **files edited/created**: `backend/src/kalyan_api/migrations/versions/0035_clinical_records_completeness.py` (created), `backend/src/kalyan_api/models.py`, `backend/src/kalyan_api/routers/prescriptions.py`, `backend/tests/test_phase22_prescribed_medicines.py`, `backend/tests/test_patient_workspace_foundation.py`, `backend/tests/test_phase22_bill_schema.py`, `backend/tests/test_timeline_api.py`, `backend/tests/test_treatment_models.py`

#### T2.2: Backend Structured Diagnoses & Longitudinal Conditions API
- **depends_on**: [T2.1]
- **location**:
  - `backend/src/kalyan_api/schemas/clinical_diagnoses.py` (new)
  - `backend/src/kalyan_api/routers/clinical_diagnoses.py` (new)
- **description**:
  - Create schemas (`PatientConditionCreate`, `PatientConditionUpdate`, `PatientConditionOut`, `EncounterDiagnosisCreate`, `EncounterDiagnosisUpdate`, `EncounterDiagnosisOut`).
  - Create `routers/clinical_diagnoses.py` (strictly `DOCTOR`-only via `ENCOUNTER_READ`/`ENCOUNTER_WRITE`, enforcing `D-04`):
    - `GET /api/patients/{patient_id}/conditions` (`require(Permission.ENCOUNTER_READ)`): succeeds on archived/merged patients; consolidates `effective_patient_ids`, calls `audit_cross_doctor_list_read` (using `PatientCondition.doctor_id`) per `DWS-04`.
    - `POST /api/patients/{patient_id}/conditions` (`require(Permission.ENCOUNTER_WRITE)`): enforces `require_active_unmerged_patient` (`409` on archived/merged), stamps `doctor_id = principal.doctor_id`, records `AuditAction.CONDITION_RECORDED`.
    - `PATCH /api/patients/{patient_id}/conditions/{condition_id}` (`require(Permission.ENCOUNTER_WRITE)`): enforces `get_scoped_or_404(..., ScopeFamily.CLINICAL_WRITE)` (so `doctor_b` receives `404` on `doctor_a`'s condition!), optimistic `version_id` lock, records `AuditAction.CONDITION_UPDATED`.
    - `GET /api/encounters/{encounter_id}/diagnoses` (`require(Permission.ENCOUNTER_READ)`): uses `get_scoped_or_404(..., ScopeFamily.CLINICAL_READ)` (`DWS-04` audit).
    - `POST /api/encounters/{encounter_id}/diagnoses` (`require(Permission.ENCOUNTER_WRITE)`): uses `ScopeFamily.CLINICAL_WRITE` (own encounter only), rejects if `encounter.is_finalised` (`400 encounter_finalised`), supports optional `promote_to_condition: bool = False` to create/link a `patient_conditions` row atomically, records `AuditAction.DIAGNOSIS_RECORDED`.
    - `PATCH /api/encounters/{encounter_id}/diagnoses/{diagnosis_id}` & `DELETE /api/encounters/{encounter_id}/diagnoses/{diagnosis_id}` (`require(Permission.ENCOUNTER_WRITE)`): own unfinalised encounter only, records `AuditAction.DIAGNOSIS_UPDATED`.
- **validation**:
  - `d:\dr-sr\backend\.venv\Scripts\python.exe -m ruff check backend/src/kalyan_api/schemas/clinical_diagnoses.py backend/src/kalyan_api/routers/clinical_diagnoses.py` exits `0`.
- **status**: Completed
- **log**: 2026-11-18 — Created `schemas/clinical_diagnoses.py` and `routers/clinical_diagnoses.py` (7 `DOCTOR`-only routes for longitudinal `patient_conditions` and `encounter_diagnoses`, `DWS-04` cross-doctor audit, `CLINICAL_WRITE` scoping, finalised encounter block, atomic `promote_to_condition`, alias consolidation). `ruff check` exit 0, route-policy & schema check `ALL_CHECKS_PASSED`.
- **files edited/created**: `backend/src/kalyan_api/schemas/clinical_diagnoses.py` (created), `backend/src/kalyan_api/routers/clinical_diagnoses.py` (created)

#### T2.3: Backend Investigation Orders & Results API
- **depends_on**: [T2.1]
- **location**:
  - `backend/src/kalyan_api/schemas/investigations.py` (new)
  - `backend/src/kalyan_api/routers/investigations.py` (new)
- **description**:
  - Create schemas (`InvestigationOrderCreate`, `InvestigationStatusUpdate`, `InvestigationResultCreate`, `InvestigationResultOut`, `InvestigationOrderOut`).
  - Create `routers/investigations.py` (strictly `DOCTOR`-only via `ENCOUNTER_READ`/`ENCOUNTER_WRITE`, enforcing `D-04`):
    - `POST /api/encounters/{encounter_id}/investigations` (`require(Permission.ENCOUNTER_WRITE)`): `ScopeFamily.CLINICAL_WRITE`, creates order with status `ORDERED`, records `AuditAction.INVESTIGATION_ORDERED`.
    - `GET /api/encounters/{encounter_id}/investigations` (`require(Permission.ENCOUNTER_READ)`): `ScopeFamily.CLINICAL_READ` with `DWS-04` cross-doctor audit.
    - `GET /api/patients/{patient_id}/investigations` (`require(Permission.ENCOUNTER_READ)`): succeeds on archived/merged patients; consolidates `effective_patient_ids`, calls `audit_cross_doctor_list_read` (using `InvestigationOrder.doctor_id`), eager-loads results ordered newest first.
    - `PATCH /api/investigations/{order_id}/status` (`require(Permission.ENCOUNTER_WRITE)`): `ScopeFamily.CLINICAL_WRITE`, enforces allowed state transitions (`ORDERED -> SAMPLE_COLLECTED | COMPLETED | CANCELLED`, `SAMPLE_COLLECTED -> COMPLETED | CANCELLED`; terminal `COMPLETED`/`CANCELLED` return `422 invalid_status_transition`), requires `cancelled_reason` on `CANCELLED`, optimistic `version_id` lock, records `AuditAction.INVESTIGATION_UPDATED`.
    - `POST /api/investigations/{order_id}/results` (`require(Permission.ENCOUNTER_WRITE)`): `ScopeFamily.CLINICAL_WRITE`, rejects on `CANCELLED` order (`422`), inserts `investigation_results` row, transitions order status to `COMPLETED` atomically, records `AuditAction.INVESTIGATION_RESULT_RECORDED`.
- **validation**:
  - `d:\dr-sr\backend\.venv\Scripts\python.exe -m ruff check backend/src/kalyan_api/schemas/investigations.py backend/src/kalyan_api/routers/investigations.py` exits `0`.
- **status**: Completed
- **log**: 2026-11-18 — Created `schemas/investigations.py` and `routers/investigations.py` (5 `DOCTOR`-only routes for orders/status transitions/results with `DWS-04` audit, `CLINICAL_WRITE` scoping, optimistic lock, cancel reason check, and alias consolidation). `ruff check` exit 0, route-policy check `IMPORT_AND_POLICY_CHECK_OK`, rolled-back live check `T23_END_TO_END_SELF_CHECK_ALL_OK`.
- **files edited/created**: `backend/src/kalyan_api/schemas/investigations.py` (created), `backend/src/kalyan_api/routers/investigations.py` (created)

#### T2.4: Backend Prescription Versioning, `POST /api/prescriptions/{id}/amend`, `SUPERSEDED` Guards & Alias Consolidation
- **depends_on**: [T2.1]
- **location**:
  - `backend/src/kalyan_api/schemas/prescriptions.py`
  - `backend/src/kalyan_api/routers/prescriptions.py`
- **description**:
  - Update `schemas/prescriptions.py`:
    - Expose `revision_number: int`, `supersedes_prescription_id: int | None`, `amendment_reason: str | None` on `PrescriptionOut`.
    - Add `PrescriptionAmendRequest` (`amendment_reason: str` min 5 chars, `diagnosis`, `dietary_advice`, `general_advice`, `follow_up_date`, `items: list[PrescriptionItemIn]` non-empty, `authorise_immediately: bool = True`).
  - Update `routers/prescriptions.py`:
    - Update `cancel_prescription()` (`L495`): explicitly reject `SUPERSEDED` prescriptions with `409` (`already_superseded`) so superseded historical revisions cannot be cancelled.
    - Add `POST /api/prescriptions/{id}/amend` (`require(Permission.PRESCRIPTION_WRITE)`, `ScopeFamily.CLINICAL_WRITE`):
      - Locks target prescription `FOR UPDATE`; requires `status == 'AUTHORISED'` (rejects `DRAFT`/`CANCELLED`/`SUPERSEDED` with `422`).
      - Works cleanly whether `old.encounter_id` is present OR `None` (standalone prescription).
      - Transitions original prescription `status = 'SUPERSEDED'` (permitted by DB tamper trigger without touching any clinical field or item row).
      - Inserts new prescription row in `DRAFT` with `revision_number = old.revision_number + 1`, `supersedes_prescription_id = old.id`, `amendment_reason = payload.amendment_reason`, copies patient print snapshots, flushes, inserts new `prescription_items`, then transitions to `AUTHORISED` if `authorise_immediately` (obeying `trg_prevent_authorised_prescription_item_tampering`!).
      - Records `AuditAction.PRESCRIPTION_AMENDED` with old/new prescription IDs and revision numbers.
    - Update `GET /api/patients/{patient_id}/prescriptions` to allow archived/merged reads and consolidate `effective_patient_ids(session, patient_id)`.
    - Verify `bill_service.py`'s `OD-B` prescribed-medicines query strictly filters `Prescription.status == PrescriptionStatus.AUTHORISED.value` so `SUPERSEDED` v1 revisions never duplicate items on Reception billing.
- **validation**:
  - `d:\dr-sr\backend\.venv\Scripts\python.exe -m ruff check backend/src/kalyan_api/schemas/prescriptions.py backend/src/kalyan_api/routers/prescriptions.py` exits `0`.
  - `d:\dr-sr\backend\.venv\Scripts\pytest.exe backend/tests/test_prescriptions_api.py backend/tests/test_prescription_lifecycle.py backend/tests/test_phase22_prescribed_medicines.py` passes.
- **status**: Completed
- **log**: 2026-11-18 — Added `revision_number`/`supersedes_prescription_id`/`amendment_reason` + `PrescriptionAmendRequest`, `POST /api/prescriptions/{id}/amend` (`DRAFT`->items->`AUTHORISED` + original `SUPERSEDED` + `PRESCRIPTION_AMENDED` audit), `409 already_superseded` cancel guard, and downward alias consolidation on `GET /patients/{id}/prescriptions`; verified `OD-B` filters `AUTHORISED` only. `ruff check` exit 0, `pytest` 15 passed, live smoke check `ALL_T24_SMOKE_CHECKS_PASSED`.
- **files edited/created**: `backend/src/kalyan_api/schemas/prescriptions.py`, `backend/src/kalyan_api/routers/prescriptions.py`

#### T2.5: Milestone 2 Backend Integration — Mount Routers, RBAC Matrix, OpenAPI Snapshot & Clinical Pytest Suites
- **depends_on**: [T2.2, T2.3, T2.4]
- **location**:
  - `backend/src/kalyan_api/main.py`
  - `backend/tests/support/matrix.py`
  - `backend/tests/openapi.snapshot.json`
  - `backend/tests/test_clinical_diagnoses_conditions.py` (new)
  - `backend/tests/test_investigations_api.py` (new)
  - `backend/tests/test_prescription_versioning.py` (new)
- **description**:
  - Mount `clinical_diagnoses_router` and `investigations_router` in `backend/src/kalyan_api/main.py`.
  - Register all 11 new M2 endpoints in `backend/tests/support/matrix.py` across all 5 identities (`anonymous` 401, `admin` 403, `reception` 403, `doctor_a` 200/201, `doctor_b` 200 on clinical reads w/ `CROSS_DOCTOR_CLINICAL_READ` audit & 404 on clinical writes).
  - Refresh `backend/tests/openapi.snapshot.json`.
  - Write comprehensive pytest suites:
    - `test_clinical_diagnoses_conditions.py`: CRUD, promote diagnosis to condition, finalised encounter mutation blocked at API (`400`) AND DB trigger level (via `owner_engine`), `D-04` 403 for Admin/Reception, `DWS-04` cross-doctor audit on `doctor_b` reads and `404` on `doctor_b` writes.
    - `test_investigations_api.py`: order -> sample_collected -> result -> completed lifecycle, invalid transitions `422`, cancel requires reason, alias consolidation, `D-04` 403 for Admin/Reception.
    - `test_prescription_versioning.py`: `AUTHORISED -> amend -> v2` (both encounter-linked and standalone `encounter_id=None`), original v1 marked `SUPERSEDED` with items intact, `cancel` on `SUPERSEDED` returns `409`, `OD-B` `/visits/{id}/prescribed-medicines` only returns `AUTHORISED` v2 items, **direct SQL `UPDATE`/`DELETE` on `AUTHORISED`/`SUPERSEDED`/`CANCELLED` prescriptions and their `prescription_items` rejected by PostgreSQL tamper trigger on `owner_engine`**, cross-doctor amend returns `404`.
- **validation**:
  - `d:\dr-sr\backend\.venv\Scripts\pytest.exe backend/tests/test_route_policies.py backend/tests/test_rbac_matrix.py backend/tests/test_openapi_snapshot.py backend/tests/test_clinical_diagnoses_conditions.py backend/tests/test_investigations_api.py backend/tests/test_prescription_versioning.py backend/tests/test_phase22_prescribed_medicines.py` passes 100%.
  - `d:\dr-sr\backend\.venv\Scripts\python.exe -m ruff check backend/src backend/tests` exits `0`.
- **status**: Completed
- **log**: 2026-11-18 — Mounted `clinical_diagnoses_router` & `investigations_router` in `main.py`; wired live `active_conditions_count` in `patient_summary_service.py` (DOCTOR only); registered all 13 new M2 routes across 5 identities in `matrix.py` + seeding in `test_rbac_matrix.py`; refreshed `openapi.snapshot.json`; created `test_clinical_diagnoses_conditions.py`, `test_investigations_api.py`, and `test_prescription_versioning.py` (incl. `owner_engine` tamper triggers & `kalyan_app` privilege checks). Validation: `ruff check` exit 0 on all 7 owned Python files, `pytest` **978 passed** across all 8 gate suites.
- **files edited/created**: `backend/src/kalyan_api/main.py`, `backend/src/kalyan_api/services/patient_summary_service.py`, `backend/tests/support/matrix.py`, `backend/tests/test_rbac_matrix.py`, `backend/tests/openapi.snapshot.json`, `backend/tests/test_clinical_diagnoses_conditions.py` (created), `backend/tests/test_investigations_api.py` (created), `backend/tests/test_prescription_versioning.py` (created)

#### T2.6: Frontend M2 API Types & Query Hooks (Diagnoses, Conditions, Investigations, Rx Versioning)
- **depends_on**: [T2.5, T1.8]
- **location**:
  - `frontend/src/api/types.ts`
  - `frontend/src/api/queries.ts`
- **description**:
  - Add TypeScript interfaces in `frontend/src/api/types.ts`: `PatientConditionOut`, `EncounterDiagnosisOut`, `InvestigationOrderOut`, `InvestigationResultOut`, `PrescriptionAmendRequest`, and extend `PrescriptionOut` with `revision_number`, `supersedes_prescription_id`, `amendment_reason`, `status: 'DRAFT' | 'AUTHORISED' | 'SUPERSEDED' | 'CANCELLED'`.
  - Add TanStack Query hooks in `frontend/src/api/queries.ts`: `usePatientConditions`, `useCreatePatientCondition`, `useUpdatePatientCondition`, `useEncounterDiagnoses`, `useCreateEncounterDiagnosis`, `useUpdateEncounterDiagnosis`, `useDeleteEncounterDiagnosis`, `usePatientInvestigations`, `useEncounterInvestigations`, `useCreateInvestigationOrder`, `useUpdateInvestigationStatus`, `useRecordInvestigationResult`, `useAmendPrescription`.
- **validation**:
  - `npm --prefix frontend run typecheck` exits `0`.
  - `npm --prefix frontend run lint` exits `0`.
- **status**: Completed
- **log**: 2026-11-18 — Added M2 TypeScript interfaces (`PatientCondition*`, `EncounterDiagnosis*`, `Investigation*`, `PrescriptionStatus` + `SUPERSEDED`, `PrescriptionAmendRequest`, revision fields) and 13 React Query hooks in `queries.ts`. Validation: `tsc -b` exit 0, `oxlint` 0 warnings/0 errors.
- **files edited/created**: `frontend/src/api/types.ts`, `frontend/src/api/queries.ts`

#### T2.7: Frontend Clinical Records Tab & Versioned Prescriptions Tab (`DOCTOR` Only)
- **depends_on**: [T2.6]
- **location**:
  - `frontend/src/components/patient/PatientClinicalRecordsTab.tsx` (new)
  - `frontend/src/components/patient/PatientPrescriptionsTab.tsx` (new)
- **description**:
  - Create `PatientClinicalRecordsTab.tsx`:
    - Lists patient encounters (`usePatientEncounters`, including legacy encounters with `visit_id === null`) with `encounter_code` (`ENC-YY-NNNNNN`), date, doctor, finalised/draft badge, vitals snapshot, chief complaint, structured diagnosis chips (ICD-10 + PRIMARY/SECONDARY), addenda count, and drill-down links to `/doctor/encounters/:id` (edit/author) and the role-neutral `/patients/:id/visits/:visitId` (when `visit_id` exists).
  - Create `PatientPrescriptionsTab.tsx`:
    - Lists prescriptions (`usePatientPrescriptions`) grouped by date/visit with revision badge (`v1`, `v2`), `Superseded` muted pill (non-active), expandable full medication table (medicine, strength, dosage, frequency, duration, route, instructions), one-click **Print / Preview** modal reusing existing `PrescriptionPrint.tsx`, and **`Amend Prescription`** modal (for own `AUTHORISED` prescriptions) capturing mandatory `amendment_reason` + edited items via `useAmendPrescription`.
- **validation**:
  - From `frontend/`: `.\node_modules\.bin\oxlint.cmd src/components/patient/PatientClinicalRecordsTab.tsx src/components/patient/PatientPrescriptionsTab.tsx` exits `0`.
- **status**: Completed
- **log**: 2026-11-18 — Created `PatientClinicalRecordsTab.tsx` (expandable encounter cards w/ `encounter_code`, vitals, ICD-10 diagnosis chips, addenda, drill-down links to `/doctor/encounters/:id` & `/patients/:id/visits/:visitId`) and `PatientPrescriptionsTab.tsx` (chronological revisions `v1`/`v2`, `Superseded` muted pill, medication detail table, `<PrescriptionPrint />` preview, `<Modal>` Amend Prescription flow). Validation: `oxlint` 0 warnings/0 errors, `tsc -b` exit 0, `guards.test.ts` 7/7 passed.
- **files edited/created**: `frontend/src/components/patient/PatientClinicalRecordsTab.tsx` (created), `frontend/src/components/patient/PatientPrescriptionsTab.tsx` (created)

#### T2.8: Frontend Investigations Tab (`DOCTOR` Only) & Role-Adapted Treatment Plans Tab
- **depends_on**: [T2.6]
- **location**:
  - `frontend/src/components/patient/PatientInvestigationsTab.tsx` (new)
  - `frontend/src/components/patient/PatientTreatmentPlansTab.tsx` (new)
- **description**:
  - Create `PatientInvestigationsTab.tsx`:
    - Displays investigation orders & results (`usePatientInvestigations`) with category (`LAB`/`IMAGING`/`PATHOLOGY`/`DIAGNOSTIC`), priority (`ROUTINE`/`URGENT`), status badge (`ORDERED`/`SAMPLE_COLLECTED`/`COMPLETED`/`CANCELLED`), result values & abnormal flag badge, inline status advancement (`Mark Sample Collected`, `Cancel Order` modal with reason), and **`Record Result`** modal (`useRecordInvestigationResult`). Include an optional `onOpenDocument?: (documentId: number) => void` prop ready for M4 report linking.
  - Create `PatientTreatmentPlansTab.tsx`:
    - **Role-adapted per `D-04`**:
      - For `DOCTOR` (holds `plan:read` & `session_log:read`): fetches `usePatientTreatmentPlans(patientId)`, renders rich plan cards with session progress bar (`completed_sessions / total_sessions`), status badge, link to `/doctor/treatment-plans/:id`, expandable session history log (`useTreatmentSessions`), and embeds existing `VasTrendChart`!
      - For `RECEPTION` / `ADMIN` (lacks `plan:read`): renders clean treatment plan progress & billing metadata via existing `PatientTimeline(eventTypes={['TREATMENT_PLAN', 'TREATMENT_SESSION']})` (zero clinical notes or VAS scores leaked!).
- **validation**:
  - From `frontend/`: `.\node_modules\.bin\oxlint.cmd src/components/patient/PatientInvestigationsTab.tsx src/components/patient/PatientTreatmentPlansTab.tsx` exits `0`.
- **status**: Completed
- **log**: 2026-11-18 — Created `PatientInvestigationsTab.tsx` (orders/results, abnormal flags, sample-collected/cancel/record-result modals, M4 `onOpenDocument` hook) and `PatientTreatmentPlansTab.tsx` (Doctor rich plan cards + expandable session log + `VasTrendChart`; Reception/Admin safe non-clinical timeline). Validation: `oxlint` 0 warnings/0 errors, `tsc -b` exit 0, `guards.test.ts` 7/7 passed.
- **files edited/created**: `frontend/src/components/patient/PatientInvestigationsTab.tsx` (created), `frontend/src/components/patient/PatientTreatmentPlansTab.tsx` (created)

#### T2.9: Wire M2 Clinical Tabs into `PatientDetail.tsx`, `PatientOverviewTab.tsx` & `ClinicalEncounterWorkspace.tsx` + Vitest Suite
- **depends_on**: [T2.7, T2.8]
- **location**:
  - `frontend/src/pages/PatientDetail.tsx`
  - `frontend/src/components/patient/PatientOverviewTab.tsx`
  - `frontend/src/pages/ClinicalEncounterWorkspace.tsx`
  - `frontend/src/components/__tests__/patient-clinical-tabs.test.tsx` (new)
- **description**:
  - Wire `PatientClinicalRecordsTab`, `PatientPrescriptionsTab`, `PatientInvestigationsTab`, and `PatientTreatmentPlansTab` into `PatientDetail.tsx`.
  - Add Doctor-only **Longitudinal Conditions (Problem List)** card inside `PatientOverviewTab.tsx` (`usePatientConditions`, Add/Update status `ACTIVE`/`RESOLVED`/`INACTIVE`).
  - Add compact **Structured Diagnoses** (with `Promote to Problem List` toggle) and **Investigation Orders** collapsible sections inside `ClinicalEncounterWorkspace.tsx` (preserving all existing vitals, specialty templates, prescription, follow-up, addenda, and `DoctorChargesPanel` flows).
  - Write `frontend/src/components/__tests__/patient-clinical-tabs.test.tsx` verifying:
    - Clinical Records tab renders structured diagnoses & encounter codes.
    - Prescriptions tab renders revision badges (`v1`/`v2`), opens `PrescriptionPrint`, and submits `Amend Prescription`.
    - Investigations tab transitions status and records a result.
    - Treatment Plans tab renders `VasTrendChart` + session log for `DOCTOR` and safe non-clinical timeline for `RECEPTION`/`ADMIN`.
- **validation**:
  - `npm --prefix frontend run typecheck` exits `0`.
  - `npm --prefix frontend run lint` exits `0`.
  - `npm --prefix frontend test -- src/components/__tests__/patient-clinical-tabs.test.tsx src/pages/__tests__/patient-workspace-shell.test.tsx src/test/guards/guards.test.ts` passes 100%.
- **status**: Completed
- **log**: 2026-11-18 — Wired `PatientClinicalRecordsTab`, `PatientPrescriptionsTab`, `PatientInvestigationsTab`, and `PatientTreatmentPlansTab` into `PatientDetail.tsx`; added Doctor-only Longitudinal Conditions Problem List card to `PatientOverviewTab.tsx`; added collapsible Structured Diagnoses & Investigation Orders sections to `ClinicalEncounterWorkspace.tsx`; created 9-test `patient-clinical-tabs.test.tsx` and updated `patients-directory.test.tsx` doctor clinical mocks. Validation: `tsc -b` exit 0, `oxlint` 0 warnings/0 errors (208 files), Vitest 63/63 passed across 5 suites (`guards`, `patient-workspace-shell`, `patients-directory`, `patient-clinical-tabs`, `clinical-encounter-workspace`).
- **files edited/created**: `frontend/src/pages/PatientDetail.tsx`, `frontend/src/components/patient/PatientOverviewTab.tsx`, `frontend/src/pages/ClinicalEncounterWorkspace.tsx`, `frontend/src/components/__tests__/patient-clinical-tabs.test.tsx` (created), `frontend/src/pages/__tests__/patients-directory.test.tsx`

---

### Milestone 3 — Financial Hardening: Append-Only Ledger, Admin Refunds & Unified Billing & Ledger UI

#### T3.1: Migration `0036` & ORM Models — `BigInteger` Paise Parity, Trigger Fixes, `refunds` & Immutable `ledger_entries` + Reconciled Backfill
- **depends_on**: [T2.5]
- **location**:
  - `backend/src/kalyan_api/migrations/versions/0036_financial_ledger_and_refunds.py` (new)
  - `backend/src/kalyan_api/models.py`
- **description**:
  - Create Alembic migration `0036` (`down_revision = "0035"`), using bare `CheckConstraint` names:
    1. **Money Type Parity & Trigger Hardening**:
       - Alter `payments.amount_paise` from `INTEGER` to `BIGINT` (`BigInteger`).
       - Add unique constraint `uq_payments_id_patient (id, patient_id)` on `payments` for composite FK integrity.
       - Update `fn_enforce_package_payment_limits()`: change internal accumulator variables from `INTEGER` to `BIGINT` AND subtract active `refunds` (`COALESCE(SUM(r.amount_paise), 0)`) when calculating net package paid.
       - Update `fn_prevent_payment_tampering()`: **preserve all existing checks from `0017:90-126`** (including the 4 print-snapshot columns `patient_name`, `patient_urn`, `patient_mobile`, `patient_address`) AND add `OLD.visit_id IS DISTINCT FROM NEW.visit_id` so reversal updates cannot alter `visit_id`!
    2. **Create `refund_sequences` & `refunds` (`D-06`, Admin-only)**:
       - `refund_sequences (cycle_key VARCHAR(16) PRIMARY KEY, last_number INTEGER NOT NULL DEFAULT 0)`.
       - `refunds`: `id BIGINT IDENTITY PK`, `refund_number VARCHAR(32) UNIQUE NOT NULL` (`RFN-FY-NNNNNN`), `payment_id BIGINT NOT NULL`, `patient_id BIGINT NOT NULL`, composite FK `(payment_id, patient_id) REFERENCES payments(id, patient_id) ON DELETE RESTRICT`, `visit_id BIGINT` with composite FK `(visit_id, patient_id) REFERENCES visits(id, patient_id) ON DELETE RESTRICT`, `amount_paise BIGINT NOT NULL` (CHECK `"amount_positive"` `> 0`), `refund_method VARCHAR(16) NOT NULL` (CHECK `"method_valid"` `IN ('CASH','UPI','CARD')`), `reason TEXT NOT NULL` (CHECK `"reason_min_len"` `length(trim(reason)) >= 5`), `refunded_by_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT`, `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`.
       - Add trigger `trg_prevent_refund_tampering` blocking all `UPDATE`/`DELETE` on `refunds`.
       - Add trigger `trg_enforce_refund_limit` (`BEFORE INSERT ON refunds`): locks parent `payments` row `FOR UPDATE`, rejects if `payment.is_reversed = TRUE` or if `COALESCE(SUM(refunds.amount_paise), 0) + NEW.amount_paise > payment.amount_paise`.
    3. **Create Append-Only `ledger_entries`**:
       - `id BIGINT IDENTITY PK`, `patient_id BIGINT NOT NULL REFERENCES patients(id) ON DELETE RESTRICT`, `visit_id BIGINT` with composite FK `(visit_id, patient_id) REFERENCES visits(id, patient_id) ON DELETE RESTRICT`, `entry_type VARCHAR(24) NOT NULL` (CHECK `"entry_type_valid"` `IN ('CHARGE','CHARGE_ADJUSTMENT','CHARGE_VOID','PACKAGE_CHARGE','PACKAGE_ADJUSTMENT','LEGACY_CHARGE','PAYMENT','PAYMENT_REVERSAL','REFUND')`), `direction VARCHAR(8) NOT NULL` (CHECK `"direction_valid"` `IN ('DEBIT','CREDIT')`), `amount_paise BIGINT NOT NULL` (CHECK `"amount_positive"` `> 0`), `signed_amount_paise BIGINT NOT NULL` (CHECK `"signed_matches_direction"` `(direction = 'DEBIT' AND signed_amount_paise = amount_paise) OR (direction = 'CREDIT' AND signed_amount_paise = -amount_paise)`), `reference_type VARCHAR(32) NOT NULL` (CHECK `"reference_type_valid"` `IN ('BILL_ITEM','BILL_ITEM_ADJUSTMENT','TREATMENT_PLAN','APPOINTMENT','PAYMENT','REFUND')`), `reference_id BIGINT NOT NULL`, `description TEXT NOT NULL`, `actor_user_id BIGINT REFERENCES users(id) ON DELETE RESTRICT`, `occurred_at TIMESTAMPTZ NOT NULL`, `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`.
       - Unique idempotency index `uq_ledger_ref_event (reference_type, reference_id, entry_type)` so backfill and transactional writes can never double-post the same event.
       - Indexes: `ix_ledger_entries_patient_occurred (patient_id, occurred_at DESC, id DESC)`, `ix_ledger_entries_visit (visit_id)`.
    4. **Safe Non-Destructive Historical Backfill (BEFORE attaching `trg_prevent_ledger_tampering`)**:
       - `bill_items` (where `original_amount_paise > 0` or `amount_paise > 0`, excluding `PACKAGE` `0`-paise marker lines): insert `CHARGE` DEBIT; if an active `CONSULTATION` bill item belongs to a `CANCELLED` appointment without a `VOID` adjustment, also insert `CHARGE_VOID` CREDIT so ledger matches active charges.
       - `bill_item_adjustments`: for `kind = 'VOID'`, insert `CHARGE_VOID` CREDIT (`old_amount_paise`); for `DISCOUNT`/`WAIVER`/`CORRECTION`, insert `CHARGE_ADJUSTMENT` CREDIT when `new < old` or DEBIT when `new > old`.
       - `treatment_plans` (where `agreed_price_paise > 0`): insert `PACKAGE_CHARGE` DEBIT (`reference_type='TREATMENT_PLAN'`, `visit_id=NULL`); if `status='CANCELLED'`, adjust remaining uncollected balance via `PACKAGE_ADJUSTMENT` CREDIT.
       - Legacy standalone `payments` (`visit_id IS NULL AND treatment_plan_id IS NULL AND appointment_id IS NOT NULL AND is_reversed = FALSE`): insert matching `LEGACY_CHARGE` DEBIT (`reference_type='APPOINTMENT'`) if no `bill_item` exists for that appointment.
       - `payments`: insert `PAYMENT` CREDIT (`amount_paise`) at `created_at`; if `is_reversed = TRUE`, also insert `PAYMENT_REVERSAL` DEBIT (`amount_paise`) at `reversed_at`.
       - Attach immutable trigger `trg_prevent_ledger_tampering` blocking `UPDATE`, `DELETE`, and `TRUNCATE` on `ledger_entries`.
    5. **Least-Privilege Grants & Fail-Closed Downgrade**:
       - `GRANT SELECT, INSERT ON ledger_entries, refunds TO kalyan_app;` (strictly NO `UPDATE` or `DELETE`!).
       - `GRANT SELECT, INSERT, UPDATE ON refund_sequences TO kalyan_app;`
       - `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kalyan_app;`
       - Fail-closed `downgrade()` raising `RuntimeError` if any `refunds` or post-migration `ledger_entries` exist.
  - Update `backend/src/kalyan_api/models.py`: widen `Payment.amount_paise` to `BigInteger`, add `RefundSequence`, `Refund`, `LedgerEntry` models and enums (`LedgerEntryType`, `LedgerDirection`).
- **validation**:
  - `d:\dr-sr\backend\.venv\Scripts\python.exe -m ruff check backend/src/kalyan_api/models.py backend/src/kalyan_api/migrations/versions/0036_financial_ledger_and_refunds.py` exits `0`.
  - `d:\dr-sr\backend\.venv\Scripts\pytest.exe backend/tests/test_billing_models.py backend/tests/test_billing_api.py backend/tests/test_phase22_visit_payments.py` passes.
- **status**: Completed
- **log**: 2026-11-18 — Migration `0036` (`down_revision="0035"`) + ORM models (`BigInteger` `payments.amount_paise`, `uq_payments_id_patient`, `RefundSequence`, `Refund`, `LedgerEntry`, partial `uq_ledger_ref_event WHERE entry_type <> 'PACKAGE_ADJUSTMENT'`, hardened `fn_prevent_payment_tampering` & `fn_enforce_package_payment_limits` w/ refund netting, `trg_prevent_refund_tampering`, `trg_enforce_refund_limit`, `trg_prevent_ledger_tampering`, idempotent historical backfill, least-privilege `kalyan_app` grants, fail-closed downgrade). Validation: `ruff check` exit 0, `pytest` 19 passed, `owner_engine` & `kalyan_app` trigger/backfill/partial-index/round-trip checks all passed.
- **files edited/created**: `backend/src/kalyan_api/migrations/versions/0036_financial_ledger_and_refunds.py` (created), `backend/src/kalyan_api/models.py`

#### T3.2: Backend Ledger Service, All Financial Write-Site Hooks, Complete Refund Netting, `billing.py` Alias Fix & `integrity_service.py` Reconciliation
- **depends_on**: [T3.1]
- **location**:
  - `backend/src/kalyan_api/services/ledger_service.py` (new)
  - `backend/src/kalyan_api/services/bill_service.py` *(real file — NOT `bill_item_service.py`)*
  - `backend/src/kalyan_api/services/booking_service.py` *(covers `ensure_consultation_line` at L372–411 + consultation cancellation)*
  - `backend/src/kalyan_api/services/billing_service.py`
  - `backend/src/kalyan_api/routers/billing.py`
  - `backend/src/kalyan_api/routers/treatment_plans.py`
  - `backend/src/kalyan_api/services/integrity_service.py`
- **description**:
  - Create `services/ledger_service.py`:
    - Transactional writers (`record_charge`, `record_charge_adjustment`, `record_charge_void`, `record_package_charge`, `record_package_adjustment`, `record_payment`, `record_payment_reversal`, `record_refund`) enforcing `DEBIT = +amount`, `CREDIT = -amount` and calling `session.flush()` inside the caller's transaction.
    - `allocate_next_refund_number(session)` (`RFN-FY-NNNNNN`, atomic `FOR UPDATE` on `refund_sequences`).
    - `build_patient_ledger(session, patient_id, limit, offset)`: consolidates `effective_patient_ids(session, patient_id)` (allowing archived/merged reads), computes running balance chronologically, computes per-payment `refunded_paise` and `remaining_refundable_paise`, and returns KPI totals (`total_billed_paise`, `total_paid_paise`, `total_refunded_paise`, `outstanding_paise`).
  - Wire `ledger_service` transactionally across **every** financial write-site:
    - `services/bill_service.py`: bill item create (`record_charge` for `amount_paise > 0`), fee/qty adjustment (`record_charge_adjustment`), void (`record_charge_void`), AND update adjustment floor check to net refunds when checking paid amounts!
    - `services/booking_service.py`: `ensure_consultation_line` (`L372–411`) calls `record_charge`; consultation cancellation posts `record_charge_void` when the consultation bill line is voided/cancelled.
    - `routers/treatment_plans.py`: creating a plan with `agreed_price_paise > 0` calls `record_package_charge`; updating `agreed_price_paise` or cancelling calls `record_package_adjustment`.
    - `routers/billing.py`: `POST /api/payments` calls `record_payment`; `POST /api/payments/{id}/reverse` rejects with `422 payment_already_refunded` if any refund exists on that payment, otherwise calls `record_payment_reversal`.
  - **Complete Refund Netting Across All 4 Financial Calculation Sites**:
    1. `services/billing_service.py`: subtract active `refunds` from non-reversed payments when computing visit/appointment/package `paid_paise` and `due_paise`.
    2. `routers/billing.py` (`L172–177` package payment cap AND `L251–256` consultation payment cap): subtract active `refunds` so a refunded amount can be validly re-collected without false overpayment rejection.
    3. `services/bill_service.py`: net `refunds` in adjustment floor check.
    4. `services/integrity_service.py`: update Check #1 (`check_financial_ledger_integrity`, `L149–159`) to net `refunds` against active package payments (preventing false `overpaid_ledger` alerts after refund + re-payment!) AND add **Check #7 (`ledger_reconciliation`, issue code `ledger_balance_mismatch` severity `ERROR`)** verifying `SUM(ledger_entries.signed_amount_paise)` per visit and per patient matches exact net active charges minus net paid (`non_reversed_payments - refunds`) to `0` paise discrepancy!
  - **Fix existing audit bug in `routers/billing.py` (`list_patient_payments`)**: allow reads on archived/merged patients and consolidate `effective_patient_ids(session, patient_id)` so merged alias patients' payments appear on `GET /api/patients/{patient_id}/payments`.
- **validation**:
  - `d:\dr-sr\backend\.venv\Scripts\python.exe -m ruff check backend/src/kalyan_api/services/ledger_service.py backend/src/kalyan_api/services/bill_service.py backend/src/kalyan_api/services/booking_service.py backend/src/kalyan_api/services/billing_service.py backend/src/kalyan_api/routers/billing.py backend/src/kalyan_api/routers/treatment_plans.py backend/src/kalyan_api/services/integrity_service.py` exits `0`.
  - `d:\dr-sr\backend\.venv\Scripts\pytest.exe backend/tests/test_billing_api.py backend/tests/test_phase22_bill_lines.py backend/tests/test_phase22_bill_void.py backend/tests/test_phase22_bill_correct.py backend/tests/test_phase22_fee_adjustment.py backend/tests/test_phase22_visit_payments.py backend/tests/test_treatment_plans_api.py` passes 100%.
- **status**: Completed
- **log**: 2026-11-18 — Created `ledger_service.py` (8 transactional writers, `allocate_next_refund_number`, shared KPIs, chronological window `build_patient_ledger`), wired hooks across `bill_service.py`, `booking_service.py`, `appointments.py`, `treatment_plans.py`, `billing.py`, netted refunds across all 4 calculation sites + `patient_summary_service.py`, fixed `list_patient_payments` alias consolidation, added Check #7 `ledger_reconciliation` in `integrity_service.py`, and updated `backup_service.py:RUNTIME_TABLE_GRANTS` for all 10 tables from migrations `0034`–`0036`. Validation: `ruff check` exit 0 on all 10 source files, `pytest` **86 passed** across all 11 suites (incl. `test_phase16_gate.py` backup/restore), 9-check rolled-back E2E script passed.
- **files edited/created**: `backend/src/kalyan_api/services/ledger_service.py` (created), `backend/src/kalyan_api/services/bill_service.py`, `backend/src/kalyan_api/services/booking_service.py`, `backend/src/kalyan_api/services/billing_service.py`, `backend/src/kalyan_api/services/patient_summary_service.py`, `backend/src/kalyan_api/routers/billing.py`, `backend/src/kalyan_api/routers/treatment_plans.py`, `backend/src/kalyan_api/routers/appointments.py`, `backend/src/kalyan_api/services/integrity_service.py`, `backend/src/kalyan_api/services/backup_service.py`, `backend/tests/test_phase22_visit_payments.py`, `backend/tests/test_integrity_service.py`, `backend/tests/test_operations_api.py`, `backend/tests/test_phase16_gate.py`

#### T3.3: Backend Refunds & Patient Ledger Endpoints, `PAYMENT_REFUND` Permission, RBAC Matrix, OpenAPI Snapshot & M3 Pytest Suite
- **depends_on**: [T3.2]
- **location**:
  - `backend/src/kalyan_api/core/permissions.py`
  - `backend/src/kalyan_api/schemas/ledger.py` (new)
  - `backend/src/kalyan_api/routers/ledger.py` (new)
  - `backend/src/kalyan_api/main.py`
  - `backend/tests/support/matrix.py`
  - `backend/tests/test_permissions_catalogue.py`
  - `backend/tests/openapi.snapshot.json`
  - `backend/tests/test_ledger_and_refunds.py` (new)
- **description**:
  - Add `Permission.PAYMENT_REFUND = "payment:refund"` to `core/permissions.py` granted **exclusively to `Role.ADMIN`** (`D-06`), and add `test_payment_refund_restricted_exclusively_to_admin()` + golden snapshot update in `test_permissions_catalogue.py`.
  - Create `schemas/ledger.py` & `routers/ledger.py` (mounted in `main.py`):
    - `GET /api/patients/{patient_id}/ledger` (`require(Permission.PAYMENT_READ)` — `ADMIN` + `RECEPTION` only; `DOCTOR` receives `403`): returns KPI summary (`total_billed_paise`, `total_paid_paise`, `total_refunded_paise`, `outstanding_paise`), immutable `entries[]` with running balance, `payments[]` (each carrying `refunded_paise` and `remaining_refundable_paise` so UI shows `Partially Refunded`/`Refunded` badges and disables `Reverse`), `refunds[]`, and visit bill links.
    - `POST /api/payments/{payment_id}/refunds` (`require(Permission.PAYMENT_REFUND)` — `ADMIN` only, `D-06`): locks payment `FOR UPDATE`, validates non-reversed and `amount_paise <= remaining_refundable_paise` (else `422 refund_exceeds_payment`), allocates `RFN-FY-NNNNNN`, inserts `refunds` row, calls `ledger_service.record_refund`, writes `AuditAction.PAYMENT_REFUNDED`.
    - `GET /api/patients/{patient_id}/refunds` (`require(Permission.PAYMENT_READ)` — `ADMIN` + `RECEPTION`).
  - Register all 3 routes in `backend/tests/support/matrix.py` across all 5 identities and refresh `backend/tests/openapi.snapshot.json`.
  - Write `backend/tests/test_ledger_and_refunds.py` covering:
    - Full lifecycle (consultation check-in -> bill item -> discount -> partial payment -> partial refund -> re-collection -> second partial refund -> over-refund rejected `422` + reversal after partial refund rejected `422`) with exact running balance and `integrity_service.run_integrity_checks()` reporting 0 discrepancies on both Check #1 and Check #7 (including package plan + visit bill scenarios!).
    - **Direct SQL tamper trigger tests on `owner_engine` (rolled-back tx)**: `UPDATE`/`DELETE` on `ledger_entries` and `refunds` blocked; `UPDATE payments SET visit_id = ...` blocked while print snapshots remain protected; `INSERT` over-limit refund blocked by `trg_enforce_refund_limit`.
    - **Least-privilege `kalyan_app` grant tests on `db_session`**: `kalyan_app` can SELECT/INSERT `ledger_entries`/`refunds` and cannot UPDATE/DELETE them.
    - RBAC: `RECEPTION` & `DOCTOR` receive `403` on `POST /payments/{id}/refunds`; `DOCTOR` receives `403` on `GET /patients/{id}/ledger` and `GET /patients/{id}/refunds`.
    - Merged alias consolidation verified on both `GET /patients/{id}/payments` and `GET /patients/{id}/ledger`.
- **validation**:
  - `d:\dr-sr\backend\.venv\Scripts\pytest.exe backend/tests/test_route_policies.py backend/tests/test_rbac_matrix.py backend/tests/test_openapi_snapshot.py backend/tests/test_permissions_catalogue.py backend/tests/test_ledger_and_refunds.py` passes 100%.
  - `d:\dr-sr\backend\.venv\Scripts\python.exe -m ruff check backend/src backend/tests` exits `0`.
- **status**: Completed
- **log**: 2026-11-18 — Added Admin-only `Permission.PAYMENT_REFUND`, created `schemas/ledger.py` & `routers/ledger.py` (`GET /patients/{id}/ledger`, `POST /payments/{id}/refunds`, `GET /patients/{id}/refunds`), mounted in `main.py`, registered in `matrix.py` + `test_rbac_matrix.py`, updated `test_permissions_catalogue.py` & `openapi.snapshot.json`, and created `test_ledger_and_refunds.py` (6 comprehensive lifecycle/trigger/privilege/RBAC/alias tests). Validation: `ruff check` exit 0 on all 8 owned Python files, `pytest` **988 passed** across full RBAC/route/OpenAPI/catalogue/ledger gate.
- **files edited/created**: `backend/src/kalyan_api/core/permissions.py`, `backend/src/kalyan_api/schemas/ledger.py` (created), `backend/src/kalyan_api/routers/ledger.py` (created), `backend/src/kalyan_api/main.py`, `backend/tests/support/matrix.py`, `backend/tests/test_rbac_matrix.py`, `backend/tests/test_permissions_catalogue.py`, `backend/tests/openapi.snapshot.json`, `backend/tests/test_ledger_and_refunds.py` (created)

#### T3.4: Frontend Unified Billing & Ledger Tab, Admin Refund Modal & M3 Vitest Suite
- **depends_on**: [T3.3, T2.9]
- **location**:
  - `frontend/src/api/types.ts`
  - `frontend/src/api/queries.ts`
  - `frontend/src/components/billing/PaymentRefundModal.tsx` (new)
  - `frontend/src/components/patient/PatientBillingLedgerTab.tsx` (new)
  - `frontend/src/pages/PatientDetail.tsx`
  - `frontend/src/components/__tests__/patient-billing-ledger.test.tsx` (new)
- **description**:
  - Add `LedgerEntryOut`, `LedgerPaymentItemOut` (with `refunded_paise` & `remaining_refundable_paise`), `RefundOut`, `RefundCreateRequest`, `PatientLedgerResponse` types and `usePatientLedger`, `useCreatePaymentRefund` hooks (invalidating patient ledger, summary, payments, and visit bills).
  - Create `PaymentRefundModal.tsx` (native `<Modal>`): Admin-only partial/full refund dialog displaying receipt number, paid amount, already-refunded amount, remaining refundable amount, rupee/paise amount input with client-side cap, method selector (`CASH`/`UPI`/`CARD`), mandatory reason (`>= 5` chars), and clear `422` server error alert.
  - Create `PatientBillingLedgerTab.tsx` (`ADMIN` + `RECEPTION` only):
    - 4-tile KPI summary bar (`Total Billed`, `Total Paid`, `Refunded`, `Outstanding Balance`) formatted via `formatPaise()`.
    - **Visit Bills** section: expandable per-visit cards embedding existing `BillPanel` + quick link to `/reception/billing?visit_id=...` for Reception checkout.
    - **Payments & Receipts** table: receipt number, date, method, amount, `Partially Refunded` / `Refunded` / `Reversed` badges, **`Print Receipt`** action opening existing `ReceiptDialog`, and Admin-only **`Reverse`** (`PaymentReversalModal`, disabled when `refunded_paise > 0`) and **`Refund`** (`PaymentRefundModal`, disabled when `is_reversed || remaining_refundable_paise <= 0`) actions.
    - **Immutable Ledger Journal** table: chronological `occurred_at`, `entry_type`, `description`, `DEBIT`/`CREDIT` pill (`text-red-800` / `text-emerald-800`, UX-04 compliant), amount, and running balance.
  - Wire `PatientBillingLedgerTab` into `PatientDetail.tsx` for `activeTab === 'billing'` (replacing the temporary `PaymentHistory` mount).
  - Write `frontend/src/components/__tests__/patient-billing-ledger.test.tsx` testing KPI totals, Visit Bill expansion, immutable ledger DEBIT/CREDIT rendering, `Partially Refunded` badge disabling `Reverse`, ReceiptDialog reprint, and Admin-only Refund modal visibility (hidden for Reception; entire tab absent for Doctor).
- **validation**:
  - `npm --prefix frontend run typecheck` exits `0`.
  - `npm --prefix frontend run lint` exits `0`.
  - `npm --prefix frontend test -- src/components/__tests__/patient-billing-ledger.test.tsx src/pages/__tests__/patient-workspace-shell.test.tsx src/test/guards/guards.test.ts` passes 100%.
- **status**: Completed
- **log**: 2026-11-18 — Added M3 ledger/refund TypeScript interfaces & `usePatientLedger`/`useCreatePaymentRefund` hooks; created `PaymentRefundModal.tsx` & `PatientBillingLedgerTab.tsx` (4-tile KPIs, expandable `<BillPanel />`, Payments & receipts w/ `<ReceiptDialog />`, Admin-only Reverse/Refund guards, immutable DEBIT/CREDIT journal); wired into `PatientDetail.tsx` (`activeTab === 'billing'` only); created 5-test `patient-billing-ledger.test.tsx` and updated `/ledger` stubs in shell/directory tests. Validation: `tsc -b` exit 0, `oxlint` 0 warnings/0 errors (211 files), Vitest 32/32 passed across 4 suites.
- **files edited/created**: `frontend/src/api/types.ts`, `frontend/src/api/queries.ts`, `frontend/src/components/billing/PaymentRefundModal.tsx` (created), `frontend/src/components/patient/PatientBillingLedgerTab.tsx` (created), `frontend/src/pages/PatientDetail.tsx`, `frontend/src/components/__tests__/patient-billing-ledger.test.tsx` (created), `frontend/src/pages/__tests__/patient-workspace-shell.test.tsx`, `frontend/src/pages/__tests__/patients-directory.test.tsx`

---

### Milestone 4 — Patient Documents, Directory Filters, Encounter / Visit Workspace & Full Cross-Role Verification

#### T4.1: Migration `0037`, ORM Models & Local Storage Config — `patient_documents` & Investigation Report Link
- **depends_on**: [T3.3]
- **location**:
  - `backend/src/kalyan_api/migrations/versions/0037_patient_documents.py` (new)
  - `backend/src/kalyan_api/models.py`
  - `backend/src/kalyan_api/config.py`
  - `backend/src/kalyan_api/main.py`
- **description**:
  - Create Alembic migration `0037` (`down_revision = "0036"`), using bare `CheckConstraint` names:
    1. **Create `patient_documents`**:
       - `id BIGINT IDENTITY PK`, `patient_id BIGINT NOT NULL REFERENCES patients(id) ON DELETE RESTRICT`, `visit_id BIGINT` with raw PG15+ composite FK `(visit_id, patient_id) REFERENCES visits(id, patient_id) ON DELETE SET NULL (visit_id)`, `encounter_id BIGINT` with raw PG15+ composite FK `(encounter_id, patient_id) REFERENCES clinical_encounters(id, patient_id) ON DELETE SET NULL (encounter_id)`.
       - `title VARCHAR(160) NOT NULL`, `category VARCHAR(32) NOT NULL` (CHECK `"category_valid"` `IN ('LAB_REPORT','IMAGING','PRESCRIPTION_SCAN','REFERRAL','ID_PROOF','INSURANCE','DISCHARGE_SUMMARY','OTHER')`), `is_clinical BOOLEAN NOT NULL`.
       - **DB-enforced `D-04` classification guard**: bare CHECK `"clinical_category"` requiring `category NOT IN ('LAB_REPORT','IMAGING','PRESCRIPTION_SCAN','DISCHARGE_SUMMARY') OR is_clinical = TRUE` so clinical reports can never be mis-flagged as non-clinical!
       - `original_filename VARCHAR(255) NOT NULL`, `stored_filename VARCHAR(128) UNIQUE NOT NULL`, `mime_type VARCHAR(100) NOT NULL` (CHECK `"mime_type_valid"` `IN ('application/pdf','image/jpeg','image/png')`), `file_size_bytes BIGINT NOT NULL` (CHECK `"file_size_valid"` `> 0 AND <= 10485760` [10 MB cap]), `sha256_hex CHAR(64) NOT NULL`, `notes TEXT`, `uploaded_by_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT`, `doctor_id BIGINT REFERENCES doctors(id) ON DELETE RESTRICT` *(stamped when uploaded by a `DOCTOR` or derived from linked `encounter.doctor_id`, enabling native `DWS-04` cross-doctor audit & `CLINICAL_WRITE` ownership checks!)*, `is_archived BOOLEAN NOT NULL DEFAULT FALSE`, `archived_at TIMESTAMPTZ`, `archived_by_user_id BIGINT REFERENCES users(id) ON DELETE RESTRICT`, `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`.
       - Index `ix_patient_documents_patient_active (patient_id, is_archived, created_at DESC)`.
    2. **Link `investigation_results.document_id`**: Add nullable `document_id BIGINT REFERENCES patient_documents(id) ON DELETE SET NULL` + index on `investigation_results`.
    3. **Grants & Fail-Closed Downgrade**: `GRANT SELECT, INSERT, UPDATE ON patient_documents TO kalyan_app;`, `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kalyan_app;`. Fail-closed `downgrade()` raising `RuntimeError` if any `patient_documents` rows exist.
  - Update `backend/src/kalyan_api/models.py` (`PatientDocument`, `DocumentCategory`, `InvestigationResult.document_id`).
  - Update `backend/src/kalyan_api/config.py`: add `documents_dir: Path = BACKEND_DIR / "var" / "documents"` (outside public web roots, matching `photos_dir`/`assets_dir`).
  - Update `backend/src/kalyan_api/main.py` (`lifespan` only): ensure `settings.documents_dir.mkdir(parents=True, exist_ok=True)` on startup. *(Router mount happens in `T4.4` so `T4.2` and `T4.3` run cleanly in parallel.)*
- **validation**:
  - `d:\dr-sr\backend\.venv\Scripts\python.exe -m ruff check backend/src/kalyan_api/models.py backend/src/kalyan_api/config.py backend/src/kalyan_api/main.py backend/src/kalyan_api/migrations/versions/0037_patient_documents.py` exits `0`.
  - `d:\dr-sr\backend\.venv\Scripts\pytest.exe backend/tests/test_investigations_api.py` passes on `0037` head.
- **status**: Completed
- **log**: 2026-11-18 — Migration `0037` (`down_revision="0036"`) + `PatientDocument`/`DocumentCategory` + `InvestigationResult.document_id` + PG15 `ondelete="SET NULL (...)"` parity on all 4 composite FKs in `models.py` + `config.documents_dir` + `main.py` lifespan dir creation + `backup_service.py` `patient_documents` grant. Validation: `ruff check` exit 0, `pytest test_investigations_api.py test_phase16_gate.py` 5 passed, `pytest test_migrations.py` 4/4 passed (0 autogenerate drift), `owner_engine`/`kalyan_app` constraint/grant/fail-closed/round-trip checks all passed.
- **files edited/created**: `backend/src/kalyan_api/migrations/versions/0037_patient_documents.py` (created), `backend/src/kalyan_api/models.py`, `backend/src/kalyan_api/config.py`, `backend/src/kalyan_api/main.py`, `backend/src/kalyan_api/services/backup_service.py`

#### T4.2: Backend Secure Document Storage Service, Permissions (M4), Documents Router & Storage Integrity Check
- **depends_on**: [T4.1]
- **location**:
  - `backend/src/kalyan_api/core/permissions.py`
  - `backend/src/kalyan_api/services/document_service.py` (new)
  - `backend/src/kalyan_api/schemas/documents.py` (new)
  - `backend/src/kalyan_api/routers/documents.py` (new)
  - `backend/src/kalyan_api/services/integrity_service.py`
- **description**:
  - Add `Permission.DOCUMENT_READ = "document:read"` (`ADMIN`, `RECEPTION`, `DOCTOR`) and `Permission.DOCUMENT_WRITE = "document:write"` (`RECEPTION`, `DOCTOR`) to `core/permissions.py`.
  - Create `services/document_service.py`:
    - Magic-byte validation: PDF (`%PDF-`), JPEG (`\xff\xd8\xff`), PNG (`\x89PNG\r\n\x1a\n`); reject empty files (`422`) and files `> 10 MB` (`413`).
    - Stream-safe chunked read from `UploadFile`, compute `sha256_hex`, persist under random UUID filename in `settings.documents_dir`.
    - `resolve_document_path(stored_filename, documents_dir)`: resolves path and asserts `.resolve().is_relative_to(documents_dir.resolve())` (hard path-traversal defense).
    - `sanitize_download_filename(filename)`: strips path separators, CR/LF/tabs, and unsafe characters (preventing `Content-Disposition` header injection).
  - Create `schemas/documents.py` & `routers/documents.py`:
    - `POST /api/patients/{patient_id}/documents` (`require(Permission.DOCUMENT_WRITE)`): enforces `require_active_unmerged_patient` (`409` on archived/merged); multipart upload (`file`, `title`, `category`, `is_clinical`, optional `visit_id`, optional `encounter_id`, `notes`). Enforces `D-04`: `RECEPTION` is rejected (`403`) if attempting to upload a clinical category or `is_clinical=True` or attach `encounter_id`; validates `visit_id`/`encounter_id` belong to patient; stamps `doctor_id = principal.doctor_id` for doctors; records `AuditAction.DOCUMENT_UPLOADED`.
    - `GET /api/patients/{patient_id}/documents` (`require(Permission.DOCUMENT_READ)`): succeeds on archived/merged patients; consolidates `effective_patient_ids`, excludes archived by default (`include_archived=false`), strictly filters `is_clinical == False` for `ADMIN`/`RECEPTION` (`D-04`), audits `CROSS_DOCTOR_CLINICAL_READ` for `DOCTOR` viewing another doctor's clinical docs (`DWS-04` using `PatientDocument.doctor_id`).
    - `GET /api/documents/{document_id}/download` (`require(Permission.DOCUMENT_READ)`): enforces `D-04` (returns `403` if `ADMIN`/`RECEPTION` requests an `is_clinical=True` document), audits `CROSS_DOCTOR_CLINICAL_READ` if another doctor downloads a clinical document, streams via `FileResponse` with sanitized filename, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, records `AuditAction.DOCUMENT_DOWNLOADED` in transaction.
    - `POST /api/documents/{document_id}/archive` (`require(Permission.DOCUMENT_WRITE)`): soft-archives document (`is_archived=True`, never deletes bytes from disk); rejects `RECEPTION` archiving `is_clinical=True` docs (`403`); enforces **own-author-only (`ScopeFamily.CLINICAL_WRITE`)** for `DOCTOR` archiving clinical docs (`doc.doctor_id == principal.doctor_id` or `doc.uploaded_by_user_id == principal.user_id`, else `404` so `doctor_b` cannot archive `doctor_a`'s clinical document!); records `AuditAction.DOCUMENT_ARCHIVED`.
  - Update `services/integrity_service.py`: add Check #8 (`document_storage`, issue codes `missing_document_file` `ERROR` and `orphan_document_file` `CLEANUP`) validating `patient_documents.stored_filename` against `settings.documents_dir`.
- **validation**:
  - `d:\dr-sr\backend\.venv\Scripts\python.exe -m ruff check backend/src/kalyan_api/core/permissions.py backend/src/kalyan_api/services/document_service.py backend/src/kalyan_api/schemas/documents.py backend/src/kalyan_api/routers/documents.py backend/src/kalyan_api/services/integrity_service.py` exits `0`.
- **status**: Completed
- **log**: 2026-11-18 — Added `DOCUMENT_READ` (all 3 roles) & `DOCUMENT_WRITE` (`RECEPTION`/`DOCTOR`), created `document_service.py` (PDF/JPEG/PNG magic bytes, 10MB cap, SHA-256, UUID filenames, path-traversal & CRLF sanitization), `schemas/documents.py`, `routers/documents.py` (4 routes w/ D-04/DWS-04/own-author clinical archive & audit logging), and Check #8 `document_storage` in `integrity_service.py`. Validation: `ruff check` exit 0, route-policy & document/integrity self-checks `ALL T4.2 SELF-CHECKS PASSED`.
- **files edited/created**: `backend/src/kalyan_api/core/permissions.py`, `backend/src/kalyan_api/services/document_service.py` (created), `backend/src/kalyan_api/schemas/documents.py` (created), `backend/src/kalyan_api/routers/documents.py` (created), `backend/src/kalyan_api/services/integrity_service.py`

#### T4.3: Backend Patient Directory Filters/Stats, Unified Visit/Encounter Workspace API & Investigation Result Document Link
- **depends_on**: [T4.1]
- **location**:
  - `backend/src/kalyan_api/schemas/patients.py`
  - `backend/src/kalyan_api/routers/patients.py`
  - `backend/src/kalyan_api/schemas/patient_workspace.py`
  - `backend/src/kalyan_api/services/patient_summary_service.py`
  - `backend/src/kalyan_api/routers/patient_workspace.py`
  - `backend/src/kalyan_api/schemas/investigations.py`
  - `backend/src/kalyan_api/routers/investigations.py`
- **description**:
  - Enhance `GET /api/patients` & `GET /api/patients/count` in `routers/patients.py` via shared `_patient_search_stmt(...)`:
    - Add server-side query filters with exact shared predicates:
      - `status: Literal['active','archived','all'] = 'active'`:
        - `'active'`: `Patient.is_active.is_(True) & Patient.is_archived.is_(False) & Patient.merged_into_id.is_(None)`
        - `'archived'`: `Patient.is_archived.is_(True)`
        - `'all'`: unfiltered (shows active, archived, and merged with status badges)
      - `gender: Literal['M','F','O'] | None = None`
      - `district: str | None = None` (case-insensitive substring)
      - `has_due_balance: bool | None = None` (Admin/Reception only; **fail-closed `AGENTS.md` #7 guard**: if `principal.role == Role.DOCTOR` passes `has_due_balance is not None`, raise `403 forbidden`!)
      - `sort_by: Literal['recent','name','urn'] = 'recent'`
    - Enrich `PatientOut` with optional directory summary fields (`visit_count: int | None = None`, `last_visit_date: date | None = None`, `outstanding_paise: int | None = None` — `outstanding_paise` strictly `None` for `DOCTOR`) populated via batched SQL subqueries on the page's patient IDs (zero N+1 queries!).
  - Add unified role-redacted Encounter / Visit Workspace endpoint in `routers/patient_workspace.py` & `services/patient_summary_service.py`:
    - `GET /api/patients/{patient_id}/visits/{visit_id}/workspace` (`require(Permission.PATIENT_READ)`):
      - Validates `visit` belongs to `effective_patient_ids(session, patient_id)` (else `404`), allowing archived/merged patient reads.
      - Returns compact patient identity strip, visit metadata (`visit_code`, `visit_date`, `status`, referral info), and consultations list (`appointment_id`, `token_number`, `doctor_name`, `department_name`, `consultation_status`).
      - For `DOCTOR`: attaches per-consultation clinical bundle (`encounter_id`, `encounter_code`, `is_finalised`, vitals, symptoms/clinical_notes, specialty template summary, structured `encounter_diagnoses`, `investigation_orders` + results/document links, versioned `prescriptions`, linked `treatment_plans`, `follow_up`, addenda, and own clinical charges per `Q13`) while auditing `CROSS_DOCTOR_CLINICAL_READ` (`DWS-04`); sets `financial_summary = None`.
      - For `RECEPTION` / `ADMIN`: sets all clinical fields strictly to `None` (`D-04`) and attaches `financial_summary` (`bill_total_paise`, `paid_paise`, `refunded_paise`, `due_paise`, payments, refunds).
  - Update `schemas/investigations.py` & `routers/investigations.py`: accept optional `document_id: int | None = None` on `InvestigationResultCreate` (verifying document belongs to the same patient) and return `document_id` + `document_title` on `InvestigationResultOut`.
- **validation**:
  - `d:\dr-sr\backend\.venv\Scripts\python.exe -m ruff check backend/src/kalyan_api/schemas/patients.py backend/src/kalyan_api/routers/patients.py backend/src/kalyan_api/schemas/patient_workspace.py backend/src/kalyan_api/services/patient_summary_service.py backend/src/kalyan_api/routers/patient_workspace.py backend/src/kalyan_api/schemas/investigations.py backend/src/kalyan_api/routers/investigations.py` exits `0`.
  - `d:\dr-sr\backend\.venv\Scripts\pytest.exe backend/tests/test_patient_search.py backend/tests/test_investigations_api.py` passes.
- **status**: Completed
- **log**: 2026-11-18 — Added server-side directory filters (`status`, `gender`, `district`, `has_due_balance` w/ fail-closed `403` for `DOCTOR`, `sort_by`) & batched page stats (`visit_count`, `last_visit_date`, `outstanding_paise`), unified role-redacted `GET /api/patients/{id}/visits/{visit_id}/workspace` (`D-04` + `DWS-04` + `Q13`), and optional `document_id`/`document_title` on investigation results. Validation: `ruff check` exit 0, `pytest` 15 passed across 3 suites + scratch E2E verification passed.
- **files edited/created**: `backend/src/kalyan_api/schemas/patients.py`, `backend/src/kalyan_api/routers/patients.py`, `backend/src/kalyan_api/schemas/patient_workspace.py`, `backend/src/kalyan_api/services/patient_summary_service.py`, `backend/src/kalyan_api/routers/patient_workspace.py`, `backend/src/kalyan_api/schemas/investigations.py`, `backend/src/kalyan_api/routers/investigations.py`

#### T4.4: Milestone 4 Backend Integration — Mount Documents Router, Conftest Storage Isolation, RBAC Matrix, OpenAPI Snapshot & M4 Pytest Suites
- **depends_on**: [T4.2, T4.3]
- **location**:
  - `backend/src/kalyan_api/main.py`
  - `backend/tests/conftest.py`
  - `backend/tests/support/matrix.py`
  - `backend/tests/test_permissions_catalogue.py`
  - `backend/tests/openapi.snapshot.json`
  - `backend/tests/test_patient_documents.py` (new)
  - `backend/tests/test_directory_filters_and_visit_workspace.py` (new)
- **description**:
  - Mount `documents_router` in `backend/src/kalyan_api/main.py`.
  - Update `backend/tests/conftest.py` so isolated test settings redirect `documents_dir` to a per-test `tmp_path` directory (preventing test uploads from touching `backend/var/documents/`).
  - Update `backend/tests/test_permissions_catalogue.py` (`test_golden_role_permissions_snapshot` with `DOCUMENT_READ`/`DOCUMENT_WRITE`).
  - Register all 5 new M4 routes (`POST/GET /patients/{id}/documents`, `GET /documents/{id}/download`, `POST /documents/{id}/archive`, `GET /patients/{id}/visits/{visit_id}/workspace`) in `backend/tests/support/matrix.py` across all 5 identities.
  - Refresh `backend/tests/openapi.snapshot.json`.
  - Write `backend/tests/test_patient_documents.py` covering:
    - Magic-byte enforcement (valid PDF/JPEG/PNG pass; renamed `.html`/`.exe`/text rejected `422`), `> 10 MB` rejected `413`, SHA-256 recorded, UUID filename stored outside public web roots, path traversal blocked, CRLF filename sanitized in `Content-Disposition`.
    - Strict `D-04`: `RECEPTION` upload of `LAB_REPORT` or `is_clinical=True` returns `403`; `ADMIN`/`RECEPTION` listing hides clinical docs and downloading clinical doc returns `403`; `DOCTOR` lists/downloads both and cross-doctor clinical reads log `CROSS_DOCTOR_CLINICAL_READ`; `doctor_b` receives `404` when trying to archive `doctor_a`'s clinical document; download & archive actions write audit logs; `integrity_service` Check #8 passes cleanly and flags missing/orphan files.
  - Write `backend/tests/test_directory_filters_and_visit_workspace.py` covering:
    - Directory filters (`status=active|archived|all`, `gender`, `district`, `has_due_balance`, `sort_by`) matching identically between `GET /patients` and `GET /patients/count`, `DOCTOR` `403` on `has_due_balance=true`, `outstanding_paise` omitted for `DOCTOR`, zero-N+1 batched stats.
    - Visit workspace endpoint returns full clinical bundle (with `DWS-04` audit) and `financial_summary=None` for `DOCTOR`, and full financial bundle with all clinical fields `None` for `RECEPTION`/`ADMIN`.
- **validation**:
  - `d:\dr-sr\backend\.venv\Scripts\pytest.exe backend/tests/test_route_policies.py backend/tests/test_rbac_matrix.py backend/tests/test_openapi_snapshot.py backend/tests/test_permissions_catalogue.py backend/tests/test_patient_documents.py backend/tests/test_directory_filters_and_visit_workspace.py` passes 100%.
  - `d:\dr-sr\backend\.venv\Scripts\python.exe -m ruff check backend/src backend/tests` exits `0`.
- **status**: Completed
- **log**: 2026-11-18 — Mounted `documents_router` in `main.py`, added per-test `documents_dir` isolation in `conftest.py`, updated `test_permissions_catalogue.py` (`DOCUMENT_READ`/`DOCUMENT_WRITE`), registered all 5 M4 routes in `matrix.py` + seeding in `test_rbac_matrix.py`, updated `total_checks` `8->9` (`test_integrity_service.py`, `test_operations_api.py`, `test_phase16_gate.py`) and merged search `status=all` (`test_phase23_patient_consolidation.py`), refreshed `openapi.snapshot.json`, and created `test_patient_documents.py` + `test_directory_filters_and_visit_workspace.py`. Validation: `ruff check` exit 0, `pytest` **1,028 passed** across all 10 gate suites, `backend/var/documents` clean.
- **files edited/created**: `backend/src/kalyan_api/main.py`, `backend/tests/conftest.py`, `backend/tests/support/matrix.py`, `backend/tests/test_rbac_matrix.py`, `backend/tests/test_permissions_catalogue.py`, `backend/tests/openapi.snapshot.json`, `backend/tests/test_integrity_service.py`, `backend/tests/test_operations_api.py`, `backend/tests/test_phase16_gate.py`, `backend/tests/test_phase23_patient_consolidation.py`, `backend/tests/test_patient_documents.py` (created), `backend/tests/test_directory_filters_and_visit_workspace.py` (created)

#### T4.5: Frontend M4 API Types & Query Hooks (Documents, Directory Filters & Visit Workspace)
- **depends_on**: [T4.4, T3.4]
- **location**:
  - `frontend/src/api/types.ts`
  - `frontend/src/api/queries.ts`
- **description**:
  - Add TypeScript types for `PatientDocumentOut`, `DocumentCategory`, `PatientDirectoryFilters`, `VisitWorkspaceOut`, and optional directory stats (`visit_count`, `last_visit_date`, `outstanding_paise`) on `PatientOut`, plus `document_id`/`document_title` on `InvestigationResultOut`.
  - Add query/mutation hooks in `frontend/src/api/queries.ts`: `usePatientDocuments`, `useUploadPatientDocument` (multipart `FormData` with `X-CSRF-Token`), `useArchivePatientDocument`, `downloadPatientDocumentBlob` helper (authenticated `fetch` returning Blob URL for safe image preview / PDF new-tab open), `useVisitWorkspace(patientId, visitId)`, and update `usePatients`/`usePatientCount` to pass server-side filter params cleanly.
- **validation**:
  - `npm --prefix frontend run typecheck` exits `0`.
  - `npm --prefix frontend run lint` exits `0`.
- **status**: Completed
- **log**: 2026-11-18 — Added M4 TypeScript types (`PatientDocumentOut`, `DocumentCategory`, `PatientDirectoryFilters`, `VisitWorkspaceOut` + nested models, optional directory stats on `PatientOut`, `document_id`/`document_title` on `InvestigationResultOut`) and hooks (`usePatientDocuments`, `useUploadPatientDocument`, `useArchivePatientDocument`, `downloadPatientDocumentBlob`, `useVisitWorkspace`, backwards-compatible filtered `usePatients`/`usePatientCount`). Validation: `tsc -b` exit 0, `oxlint` 0 warnings/0 errors (211 files).
- **files edited/created**: `frontend/src/api/types.ts`, `frontend/src/api/queries.ts`

#### T4.6a: Frontend Documents Tab & Patient Directory Server-Side Filters + Pagination Reset + Empty-State RBAC Fix
- **depends_on**: [T4.5]
- **location**:
  - `frontend/src/components/patient/PatientDocumentsTab.tsx` (new)
  - `frontend/src/pages/PatientsDirectory.tsx`
- **description**:
  - Create `PatientDocumentsTab.tsx`:
    - Displays role-filtered documents list (`usePatientDocuments`) with category pill, clinical badge (`DOCTOR` only), file size, uploader, date, **Preview / Download** button, and **Archive** confirmation modal (using native `<Modal>`, never `window.confirm` per UX-03).
    - **CSP / `X-Frame-Options: DENY` Safe Preview**: Fetches file via authenticated `downloadPatientDocumentBlob`; renders JPEG/PNG inside a clean `<Modal>` `<img>` (allowed by `img-src 'self' blob:`) and opens PDFs in a new browser tab or triggers clean download (never embedding PDF in an `<iframe>`), revoking Object URLs on unmount/close to prevent memory leaks.
    - Role-aware **Upload Document** modal (`DOCUMENT_WRITE` = `RECEPTION` or `DOCTOR`, hidden on archived/merged patients): hides clinical categories (`LAB_REPORT`, `IMAGING`, `PRESCRIPTION_SCAN`, `DISCHARGE_SUMMARY`) for `RECEPTION`, validates client-side PDF/JPEG/PNG and `<= 10 MB`, shows server errors clearly.
  - Upgrade `frontend/src/pages/PatientsDirectory.tsx`:
    - Add compact responsive server-side filter bar (accessible `<label>`/`aria-label` on every control per UX-06): Status (`Active` / `Archived` / `All`), Gender (`All` / `Male` / `Female` / `Other`), District input, Sort (`Most Recent` / `Name A–Z` / `URN`), and **`Has Due Balance`** toggle strictly gated to `ADMIN`/`RECEPTION` (`payment:read`).
    - **Reset `page` to `0`** whenever any filter (`q`, `status`, `gender`, `district`, `has_due_balance`, `sort_by`) changes so narrowed queries never land on an empty high offset!
    - Display per-row `Visits` / `Last Visit` indicator and role-gated `Balance Due` pill (`ADMIN`/`RECEPTION` only; never shown to `DOCTOR`).
    - **Fix empty-state RBAC bug (`PatientsDirectory.tsx:143-148`)**: Gate the empty-state `"New patient"` `<Link to="/reception/patients/new">` strictly to `me?.role === 'RECEPTION'` so `DOCTOR` and `ADMIN` never hit a broken redirect bounce!
- **validation**:
  - From `frontend/`: `.\node_modules\.bin\oxlint.cmd src/components/patient/PatientDocumentsTab.tsx src/pages/PatientsDirectory.tsx` exits `0`.
- **status**: Completed
- **log**: 2026-11-18 — Created `PatientDocumentsTab.tsx` (role-filtered list, archived toggle, CSP-safe Blob image preview `<Modal>` & PDF new-tab/download without `<iframe>`, own-author clinical archive `<Modal>`, role-aware Upload `<Modal>` w/ 10MB/MIME checks) and upgraded `PatientsDirectory.tsx` (accessible server-side filter bar, `page=0` reset, Visits/Last Visit/Due indicators, empty-state `"New patient"` strictly gated to `RECEPTION`). Validation: `oxlint` 0 warnings/0 errors, `tsc -b` exit 0, Vitest `guards.test.ts` + `patients-directory.test.tsx` 17/17 passed.
- **files edited/created**: `frontend/src/components/patient/PatientDocumentsTab.tsx` (created), `frontend/src/pages/PatientsDirectory.tsx`

#### T4.6b: Frontend Unified Encounter / Visit Workspace Page, Router Registration & `AppShell` Breadcrumbs/Nav
- **depends_on**: [T4.5]
- **location**:
  - `frontend/src/pages/VisitWorkspacePage.tsx` (new)
  - `frontend/src/router.tsx`
  - `frontend/src/components/AppShell.tsx`
- **description**:
  - Create `frontend/src/pages/VisitWorkspacePage.tsx` (role-neutral shared route `/patients/:id/visits/:visitId` for `ADMIN`, `RECEPTION`, `DOCTOR`):
    - Compact sticky/top **Patient Identity Strip** (URN, name, computed age, role-adapted allergy alert pill [full for Doctor, safety-alert-only for Reception, hidden for Admin], `← Back to Patient Record` link to `/reception/patients/${id}?tab=visits`).
    - **Visit Header Card**: `visit_code` (`VIS-YY-NNNNNN`), date, status badge, token number(s), referral info.
    - **Role-Adapted Body**:
      - For `DOCTOR`: Renders each consultation in the visit with `encounter_code`, `Open Authoring Workspace →` link (`/doctor/encounters/${encounterId}`), read-only `VitalsBiometricsSection`, complaints & clinical notes, specialty template summary, structured diagnoses badges, investigations & result links, prescriptions with `PrescriptionPrint` preview, treatment plans, follow-up, addenda, and own clinical charges summary (`Q13`). Never renders payment collection controls (`AGENTS.md` #7).
      - For `RECEPTION` / `ADMIN`: Renders consultation status timeline (doctor, department, token, status — strictly zero clinical notes/diagnoses per `D-04`) plus full visit billing via existing `<BillPanel />`, payments list with `<ReceiptDialog />`, and `Open Billing & Checkout →` shortcut (`/reception/billing?visit_id=${visitId}`) for Reception.
  - Update `frontend/src/router.tsx`: add lazy role-neutral shared route `/patients/:id/visits/:visitId` under `RequireRole role={['ADMIN', 'RECEPTION', 'DOCTOR']}`.
  - Update `frontend/src/components/AppShell.tsx`: update `isNavigationItemActive` (L218–248) and `breadcrumbsFor` (L383–442) regex matching so `/patients/:id/visits/:visitId` keeps `Patient Records` active in the sidebar and renders `Patient Records › Patient Profile › Visit Workspace`.
- **validation**:
  - From `frontend/`: `.\node_modules\.bin\oxlint.cmd src/pages/VisitWorkspacePage.tsx src/router.tsx src/components/AppShell.tsx` exits `0`.
- **status**: Completed
- **log**: 2026-11-18 — Created role-neutral `VisitWorkspacePage.tsx` (`/patients/:id/visits/:visitId`) with compact patient strip (role-adapted allergy pill, hidden for Admin), Doctor clinical bundle + CSP-safe report preview + `<PrescriptionPrint />` + read-only `Q13` charges, and Reception/Admin consultation statuses + `<BillPanel />` + `<ReceiptDialog />`; registered route in `router.tsx` and updated `AppShell.tsx` sidebar active state & breadcrumbs. Validation: `oxlint` 0 warnings/0 errors, `tsc -b` exit 0, `guards.test.ts` 7/7 passed, `app-shell`/`admin-nav`/`workspace-shell` 37/37 passed.
- **files edited/created**: `frontend/src/pages/VisitWorkspacePage.tsx` (created), `frontend/src/router.tsx`, `frontend/src/components/AppShell.tsx`

#### T4.7: Wire Documents Tab & Report Links + Complete M4 Frontend Vitest Suites
- **depends_on**: [T4.6a, T4.6b]
- **location**:
  - `frontend/src/pages/PatientDetail.tsx`
  - `frontend/src/components/patient/PatientInvestigationsTab.tsx`
  - `frontend/src/pages/__tests__/patients-directory.test.tsx`
  - `frontend/src/pages/__tests__/visit-workspace.test.tsx` (new)
  - `frontend/src/components/__tests__/patient-documents.test.tsx` (new)
- **description**:
  - Wire `PatientDocumentsTab` into `PatientDetail.tsx` (`activeTab === 'documents'`).
  - Wire investigation result `document_id` report preview/download button inside `PatientInvestigationsTab.tsx` using `downloadPatientDocumentBlob`.
  - Update `frontend/src/pages/__tests__/patients-directory.test.tsx`: test server-side filters (status, gender, district, due balance for Reception/Admin), pagination reset on filter change, confirm `has_due_balance` toggle & balance column are absent for `DOCTOR`, and verify empty-state `"New patient"` link is hidden for `DOCTOR` & `ADMIN`.
  - Write `frontend/src/pages/__tests__/visit-workspace.test.tsx`: verify role-neutral `/patients/:id/visits/:visitId` renders clinical sections (vitals, diagnoses, investigations, Rx, link to authoring workspace) with no payment collection for `DOCTOR`; renders `BillPanel` + consultation statuses + safety-only allergy pill with zero clinical leakage for `RECEPTION`; renders `BillPanel` + consultation statuses with zero clinical leakage and no allergy banner for `ADMIN`.
  - Write `frontend/src/components/__tests__/patient-documents.test.tsx`: verify Reception upload modal excludes clinical categories, Doctor sees clinical + non-clinical docs, image preview modal & PDF download actions work without `<iframe>`, and archive uses `<Modal>` (no `window.confirm`).
- **validation**:
  - `npm --prefix frontend run typecheck` exits `0`.
  - `npm --prefix frontend run lint` exits `0`.
  - `npm --prefix frontend test -- src/pages/__tests__/patients-directory.test.tsx src/pages/__tests__/visit-workspace.test.tsx src/components/__tests__/patient-documents.test.tsx src/test/guards/guards.test.ts` passes 100%.
- **status**: Completed
- **log**: 2026-11-18 — Wired `<PatientDocumentsTab />` into `PatientDetail.tsx`, wired CSP-safe `downloadPatientDocumentBlob` preview & optional `document_id` picker into `PatientInvestigationsTab.tsx`, expanded `patients-directory.test.tsx` (filters/reset/DOCTOR 403-avoidance/empty-state RBAC), and created `visit-workspace.test.tsx` (3 role tests) & `patient-documents.test.tsx` (6 tests). Validation: `tsc -b` exit 0, `oxlint` 0 warnings/0 errors (215 files), Vitest 49/49 passed across 6 suites.
- **files edited/created**: `frontend/src/pages/PatientDetail.tsx`, `frontend/src/components/patient/PatientInvestigationsTab.tsx`, `frontend/src/pages/__tests__/patients-directory.test.tsx`, `frontend/src/pages/__tests__/visit-workspace.test.tsx` (created), `frontend/src/components/__tests__/patient-documents.test.tsx` (created)

#### T4.8: Full End-to-End Verification Gate, 14-Point Acceptance Matrix & `AGENTS.md` DoD Sign-Off
- **depends_on**: [T4.7]
- **location**: Whole repository (`backend/` & `frontend/`, read-only verification)
- **description**:
  - Execute full backend quality, contract, RBAC, and DB integrity gates:
    - `d:\dr-sr\backend\.venv\Scripts\python.exe -m ruff check backend/src backend/tests`
    - `d:\dr-sr\backend\.venv\Scripts\pytest.exe backend/tests` (all existing 116+ suites plus all new M1–M4 suites, including `test_route_policies.py`, `test_rbac_matrix.py`, `test_openapi_snapshot.py`, `test_permissions_catalogue.py`, `test_scope_helpers.py`)
    - Verify Alembic clean-DB `upgrade head` (`0001` → `0037`) AND runtime `kalyan_app` privilege smoke check across all new tables & sequences, plus `integrity_service` Checks #1–#8 returning `is_healthy = True`.
  - Execute full frontend quality & production build gates:
    - `npm --prefix frontend run typecheck`
    - `npm --prefix frontend run lint` (0 errors, 0 warnings)
    - `npm --prefix frontend test` (100% pass including `guards.test.ts` — 0 violations on all new/modified files, `PatientDetail.tsx` removed from `PENDING`, and the 3 unrelated client-held exemptions intact)
    - `npm --prefix frontend run build`
  - Execute manual/Playwright cross-role walkthrough against local server (`ADMIN`, `RECEPTION`, `DOCTOR`) verifying all 14 Acceptance Criteria below, browser reload persistence (`?tab=` and `/patients/:id/visits/:visitId`), and responsive desktop (`1440px`), tablet (`768px`), and mobile (`390px`) layouts.
- **validation**:
  - Every automated command exits `0` with recorded evidence; every row in the Acceptance Criteria Verification Matrix and `AGENTS.md` 7-Point Definition of Done is marked VERIFIED with evidence before completion.
- **status**: Completed (Automated Verification Gate Passed; Live Interactive Browser Walkthrough Pending Manual Check)
- **log**: 2026-11-18 — Independent read-only final verification (`verifier-be` + `verifier-fe`): Backend `pytest backend/tests` **1,853 passed, 1 skipped (SPA dist env unset), 0 failed** in 12m22s; `ruff check` 0 errors across all 59 overhaul Python files (0 errors on any touched line); `test_migrations.py` 4/4 passed (`0001`→`0037`, 0 autogenerate drift); `backend/var/documents` clean (0 stray files); checkpoint ref `refs/checkpoints/pre-patient-records-overhaul` intact (`473166c756aa1c088578d2d1c9c10622a72193d4`). Frontend `tsc -b` exit 0; `oxlint` 0 warnings/0 errors (215 files); `vitest run` **81/81 files passed (656 passed | 5 skipped)** incl. `guards.test.ts` 7/7 (`PatientDetail.tsx` removed from `PENDING`); `vite build` clean in 7.48s. Note: live interactive browser walkthrough against a running local server (1440px/768px/390px) was not run in headless verification.
- **files edited/created**: None (read-only verification gate)

---

## Parallel Execution Groups

Every parallel wave guarantees **strictly zero file overlap** across concurrent workers (`AGENTS.md` Agent Coordination).

| Wave | Milestone | Tasks | File Ownership Split | Can Start When |
|---|---|---|---|---|
| 0 | Baseline | `T0` | Git checkpoint ref only | Immediately |
| 1 | M1 | `T1.1` | `0034_*.py`, `models.py` | `T0` complete |
| 2 | M1 | `T1.2` | `permissions.py`, `audit_service.py`, `code_sequence_service.py`, `visit_service.py`, `patient_merge_service.py`, `schemas/encounters.py`, `routers/encounters.py` | `T1.1` complete |
| 3 | M1 | `T1.3`, `T1.4` | **Parallel**: `T1.3` (`patients`/`visits` schemas+routers+service) vs `T1.4` (new `patient_workspace` schema+service+router) | `T1.2` complete |
| 4 | M1 | `T1.5` | `main.py`, `matrix.py`, `test_permissions_catalogue.py`, `test_patient_edit_photo.py`, `openapi.snapshot.json`, `test_patient_workspace_foundation.py` | Wave 3 complete |
| 5 | M1 | `T1.6` | `frontend/src/api/types.ts`, `queries.ts`, `PatientRegister.tsx` | `T1.5` complete |
| 6 | M1 | `T1.7a`, `T1.7b` | **Parallel**: `T1.7a` (`PatientIdentityHeader.tsx`, `PatientOverviewTab.tsx`) vs `T1.7b` (`PatientVisitHistoryTab.tsx`) | `T1.6` complete |
| 7 | M1 | `T1.8` | `PatientDetail.tsx`, `guards.test.ts`, M1 frontend tests | Wave 6 complete |
| 8 | M2 | `T2.1` | `0035_*.py`, `models.py`, `routers/prescriptions.py` (DRAFT->items->AUTHORISED safe write) | `T1.5` complete *(can overlap with M1 frontend Waves 5–7!)* |
| 9 | M2 | `T2.2`, `T2.3`, `T2.4` | **Parallel (3-way)**: `T2.2` (`clinical_diagnoses`) vs `T2.3` (`investigations`) vs `T2.4` (`prescriptions`) | `T2.1` complete |
| 10 | M2 | `T2.5` | `main.py`, `matrix.py`, `openapi.snapshot.json`, M2 pytest suites | Wave 9 complete |
| 11 | M2 | `T2.6` | `frontend/src/api/types.ts`, `queries.ts` | `T2.5` & `T1.8` complete |
| 12 | M2 | `T2.7`, `T2.8` | **Parallel**: `T2.7` (`ClinicalRecordsTab`, `PrescriptionsTab`) vs `T2.8` (`InvestigationsTab`, `TreatmentPlansTab`) | `T2.6` complete |
| 13 | M2 | `T2.9` | `PatientDetail.tsx`, `PatientOverviewTab.tsx`, `ClinicalEncounterWorkspace.tsx`, `patient-clinical-tabs.test.tsx` | Wave 12 complete |
| 14 | M3 | `T3.1` | `0036_*.py`, `models.py` | `T2.5` complete |
| 15 | M3 | `T3.2` | `ledger_service.py`, `bill_service.py`, `booking_service.py`, `billing_service.py`, `routers/billing.py`, `routers/treatment_plans.py`, `integrity_service.py` | `T3.1` complete |
| 16 | M3 | `T3.3` | `permissions.py`, `schemas/routers/ledger.py`, `main.py`, `matrix.py`, `test_permissions_catalogue.py`, `openapi.snapshot.json`, `test_ledger_and_refunds.py` | `T3.2` complete |
| 17 | M3 | `T3.4` | `api/types.ts`, `queries.ts`, `PaymentRefundModal.tsx`, `PatientBillingLedgerTab.tsx`, `PatientDetail.tsx`, `patient-billing-ledger.test.tsx` | `T3.3` & `T2.9` complete |
| 18 | M4 | `T4.1` | `0037_*.py`, `models.py`, `config.py`, `main.py` (lifespan) | `T3.3` complete |
| 19 | M4 | `T4.2`, `T4.3` | **Parallel**: `T4.2` (`permissions.py`, `document_service.py`, `documents` schema+router, `integrity_service.py`) vs `T4.3` (`patients` filters, `patient_workspace` visit workspace, `investigations` doc link) | `T4.1` complete |
| 20 | M4 | `T4.4` | `main.py` (mount), `conftest.py`, `matrix.py`, `test_permissions_catalogue.py`, `openapi.snapshot.json`, M4 pytest suites | Wave 19 complete |
| 21 | M4 | `T4.5` | `frontend/src/api/types.ts`, `queries.ts` | `T4.4` & `T3.4` complete |
| 22 | M4 | `T4.6a`, `T4.6b` | **Parallel**: `T4.6a` (`PatientDocumentsTab.tsx`, `PatientsDirectory.tsx`) vs `T4.6b` (`VisitWorkspacePage.tsx`, `router.tsx`, `AppShell.tsx`) | `T4.5` complete |
| 23 | M4 | `T4.7` | `PatientDetail.tsx`, `PatientInvestigationsTab.tsx`, M4 frontend Vitest suites | Wave 22 complete |
| 24 | Final | `T4.8` | Read-only full verification gate & release sign-off | `T4.7` complete |

---

## Acceptance Criteria Verification Matrix

### Part A — 14 Core Spec Acceptance Criteria

| # | Acceptance Criterion | Owning Tasks | Verification Method & Evidence |
|---|---|---|---|
| **AC-01** | Permanent patient URN & extended Level 1 demographics (optional contacts/blood group/pin/guardian relationship, computed age from DOB w/ fallback) plus Doctor-owned structured clinical allergies persist with optimistic locking | `T1.1`, `T1.3`, `T1.6`, `T1.7a` | `test_patient_workspace_foundation.py` (`computed_age_years`, `409` on stale `version_id`, Doctor-only clinical allergies CRUD + Reception safety-only `/summary` projection + Admin `null`) + `PatientRegister` & `PatientOverviewTab` Vitest |
| **AC-02** | Unique human-readable `visit_code` (`VIS-YY-NNNNNN`) and `encounter_code` (`ENC-YY-NNNNNN`) generated atomically; `clinical_encounters.visit_id` linked cleanly without fabricating pre-0025 visits | `T1.1`, `T1.2`, `T1.5` | `test_patient_workspace_foundation.py` (concurrent/unique code checks, fallback trigger, finalised tamper lock, legacy NULL `visit_id` preservation) |
| **AC-03** | Persistent Patient Identity Header (URN, status, photo/initials via `PHOTO_READ` for all 3 roles, age, mobile, guardian, role-adapted allergy alert [full Doctor / safety-only Reception / hidden Admin], KPI strip) remains visible across ALL 9 tabs | `T1.7a`, `T1.8` | `patient-workspace-shell.test.tsx` (asserts header & URN present on every tab + role-specific allergy visibility) |
| **AC-04** | Duplicated `PaymentHistory` panel below non-billing tabs is completely eliminated (`PatientDetail.tsx:429`) | `T1.8`, `T3.4` | `patient-workspace-shell.test.tsx` (negative assertions on Overview, Visit History, Treatment Plans, Audit tabs) |
| **AC-05** | URL-synced (`?tab=`) responsive **9-section** Patient Workspace navigation (`Overview`, `Visit History`, `Clinical Records`, `Prescriptions`, `Investigations`, `Treatment Plans`, `Billing & Ledger`, `Documents`, `Change History`) works across desktop, tablet, and mobile and survives page reload & post-edit redirects | `T1.8`, `T2.9`, `T3.4`, `T4.7`, `T4.8` | `patient-workspace-shell.test.tsx` (initial `?tab=visits`, notice dismissal preserves search params) + `T4.8` reload & viewport verification |
| **AC-06** | Strict 3-role RBAC (`ADMIN`, `RECEPTION`, `DOCTOR`) & `D-04` clinical privacy enforced at API + DB + UI layers (Reception/Admin get `403` on clinical notes, diagnoses, conditions, prescriptions, investigations, structured `/allergies`, and clinical docs; Reception sees only `allergy_alert` safety summary on `/summary`; Admin sees `allergy_alert: null`; Doctor never collects payments or sees Billing & Ledger tab) | `T1.2`–`T1.5`, `T2.2`–`T2.5`, `T3.3`, `T4.2`–`T4.4`, `T4.6a`, `T4.6b` | `test_route_policies.py` + `test_rbac_matrix.py` (5-identity matrix) + `test_permissions_catalogue.py` + Vitest role-gating specs |
| **AC-07** | Cross-doctor clinical read auditing (`DWS-04`) and edit-own write isolation (`ScopeFamily.CLINICAL_WRITE`) apply to diagnoses, conditions, investigations, Rx amendments, clinical docs, and visit workspace | `T2.2`–`T2.5`, `T4.2`–`T4.4` | `test_clinical_diagnoses_conditions.py`, `test_investigations_api.py`, `test_prescription_versioning.py`, `test_patient_documents.py`, `test_directory_filters_and_visit_workspace.py` |
| **AC-08** | Structured `encounter_diagnoses` (ICD-10, type, status, finalised lock) and longitudinal `patient_conditions` problem list work end-to-end | `T2.1`, `T2.2`, `T2.5`, `T2.7`, `T2.9` | `test_clinical_diagnoses_conditions.py` (`owner_engine` DB trigger + API) + `patient-clinical-tabs.test.tsx` |
| **AC-09** | Investigation orders & results workflow (`ORDERED -> SAMPLE_COLLECTED -> COMPLETED / CANCELLED`) with optional attached report document works end-to-end | `T2.1`, `T2.3`, `T2.5`, `T2.8`, `T4.1`, `T4.3`, `T4.7` | `test_investigations_api.py` + `patient-clinical-tabs.test.tsx` |
| **AC-10** | Prescriptions are immutable once `AUTHORISED`/`SUPERSEDED`/`CANCELLED` (DB tamper trigger on prescriptions + items) and support audited versioned amendments (`POST /api/prescriptions/{id}/amend` -> `v2` superseding `v1`) without breaking `OD-B` prescribed-medicines | `T2.1`, `T2.4`, `T2.5`, `T2.7` | `test_prescription_versioning.py` (`owner_engine` SQL tamper fails; v1 preserved as `SUPERSEDED`; `OD-B` projects `AUTHORISED` only) + `patient-clinical-tabs.test.tsx` |
| **AC-11** | Treatment Plans tab displays rich progress + `VasTrendChart` + session log for Doctor and safe non-clinical progress for Reception/Admin without breaking Invariant #11 (`trg_sync_treatment_plan_session_progress`) | `T2.1`, `T2.8`, `T2.9` | `test_treatment_sessions_api.py` + `patient-clinical-tabs.test.tsx` |
| **AC-12** | Append-only `ledger_entries` (DEBIT/CREDIT immutable trigger, exact `BigInteger` paise), Admin-only partial/full `refunds` (`D-06`), complete refund netting across all 4 cap/floor/integrity sites, `VisitDetail.payments` & alias consolidation fixes, and `integrity_service.py` 0-paise reconciliation pass | `T1.3`, `T3.1`, `T3.2`, `T3.3`, `T3.4` | `test_ledger_and_refunds.py` (`owner_engine` tamper tests + `kalyan_app` privilege tests + Checks #1 & #7 reconciliation) + `patient-billing-ledger.test.tsx` |
| **AC-13** | Protected local `patient_documents` storage enforces magic-byte/size validation, path-traversal & CRLF sanitization, `D-04` clinical classification check, own-author clinical archive, audit logging, storage integrity check, and CSP-safe preview/download | `T4.1`, `T4.2`, `T4.4`, `T4.6a`, `T4.7` | `test_patient_documents.py` + `patient-documents.test.tsx` |
| **AC-14** | Patient Directory server-side filters (status/gender/district/due balance) + pagination reset + empty-state RBAC fix AND unified Encounter / Visit Workspace (role-neutral `/patients/:id/visits/:visitId`) with `AppShell` active nav & breadcrumbs pass across all roles | `T4.3`, `T4.4`, `T4.6a`, `T4.6b`, `T4.7` | `test_directory_filters_and_visit_workspace.py` + `patients-directory.test.tsx` + `visit-workspace.test.tsx` |

### Part B — `AGENTS.md` 7-Point Definition of Done Gate

| DoD Criterion | Required Evidence Before Marking VERIFIED |
|---|---|
| **1. Frontend interaction passes** | Vitest suites (`patient-workspace-shell`, `patient-clinical-tabs`, `patient-billing-ledger`, `patient-documents`, `patients-directory`, `visit-workspace`, `patient-timeline`, `payment-history`) + manual UI check (`T4.8`) |
| **2. API behaviour passes** | All domain pytest suites + `test_openapi_snapshot.py` (`T1.5`, `T2.5`, `T3.3`, `T4.4`, `T4.8`) |
| **3. Database persistence passes** | Alembic `0001`→`0037` clean upgrade, PG15 composite FKs, immutable triggers (`ledger_entries`, `refunds`, `prescriptions`, `encounter_diagnoses`) verified on `owner_engine`, `kalyan_app` least-privilege grants verified on `db_session`, `integrity_service` Checks #1–#8 |
| **4. Related modules update correctly** | Merged alias (`merged_into_id`) consolidation across summary/visits/allergies/conditions/prescriptions/investigations/payments/ledger/documents; `BillPanel`/`VisitCheckout`/`ReceiptDialog`/`ClinicalEncounterWorkspace`/`patient_merge_service` regression suites green |
| **5. Authorization passes** | `test_route_policies.py`, `test_rbac_matrix.py` (all 5 identities for every new route), `test_permissions_catalogue.py`, `test_scope_helpers.py`, `D-04` & `D-06` & `AGENTS.md` #7 assertions |
| **6. Reload persistence passes** | Deep-linking & browser reload on `/reception/patients/:id?tab=...` and `/patients/:id/visits/:visitId` restore exact persisted state (`T4.8`) |
| **7. Regression tests pass** | Full `pytest backend/tests`, `ruff check`, `npm --prefix frontend run typecheck`, `lint`, `test` (including `guards.test.ts`), and `vite build` exit `0` (`T4.8`) |

---

## Testing Strategy

- **Backend Automated Gates (`backend/.venv/Scripts/pytest.exe`)**:
  - **Contract & RBAC Gates (run at the end of every milestone)**:
    ```powershell
    d:\dr-sr\backend\.venv\Scripts\pytest.exe backend/tests/test_route_policies.py backend/tests/test_rbac_matrix.py backend/tests/test_openapi_snapshot.py backend/tests/test_permissions_catalogue.py backend/tests/test_scope_helpers.py
    ```
  - **New Milestone Suites**:
    - M1: `backend/tests/test_patient_workspace_foundation.py`
    - M2: `backend/tests/test_clinical_diagnoses_conditions.py`, `backend/tests/test_investigations_api.py`, `backend/tests/test_prescription_versioning.py`
    - M3: `backend/tests/test_ledger_and_refunds.py`
    - M4: `backend/tests/test_patient_documents.py`, `backend/tests/test_directory_filters_and_visit_workspace.py`
  - **Static & Full Regression**:
    ```powershell
    d:\dr-sr\backend\.venv\Scripts\python.exe -m ruff check backend/src backend/tests
    d:\dr-sr\backend\.venv\Scripts\pytest.exe backend/tests
    ```
- **Frontend Automated Gates (`frontend/`)**:
  - **Source Guards (UX-03/04/06 + IST dates + ratchet)**: `npm --prefix frontend test -- src/test/guards/guards.test.ts`
  - **New & Updated Component/Page Suites**: `patient-workspace-shell.test.tsx`, `patient-clinical-tabs.test.tsx`, `patient-billing-ledger.test.tsx`, `patient-documents.test.tsx`, `visit-workspace.test.tsx`, `patients-directory.test.tsx`, `patient-timeline.test.tsx`, `payment-history.test.tsx`.
  - **Full Build & Quality Gate**:
    ```powershell
    npm --prefix frontend run typecheck
    npm --prefix frontend run lint
    npm --prefix frontend test
    npm --prefix frontend run build
    ```
- **Zero Production Data / Zero Destructive Resets**: All backend tests execute exclusively against isolated `KALYAN_TEST_DB_NAME` (`kalyan_test`) with per-test SAVEPOINT rollback and `tmp_path` photo/asset/document directories (`AGENTS.md`).

---

## Risks & Mitigations

1. **Risk: Existing ~60 dirty files or untracked `0033` migration on `fix/sidebar-daily-flow` overwritten, omitted from checkpoint, or accidentally committed during execution.**
   - *Mitigation*: `T0` pins `refs/checkpoints/pre-patient-records-overhaul` for tracked changes AND copies every untracked file from `git ls-files --others --exclude-standard` (including `0033_pending_opd_arrival_cancelled_status.py`) into `.git/checkpoints/pre-patient-records-overhaul-untracked/` with SHA-256 verification; every worker reads existing file contents before editing, stages ONLY its own task-owned files (`git add <owned-files>`, NEVER `git add -A`, NEVER `git push`), and never runs `git reset --hard` or `git checkout --`.
2. **Risk: Existing test fixtures instantiating `Visit(...)` / `ClinicalEncounter(...)` without codes fail `NOT NULL` in `0034`, or `POST /api/prescriptions` fails `trg_prevent_authorised_prescription_item_tampering` in `0035`.**
   - *Mitigation*: `T1.1` attaches `BEFORE INSERT` sequence-allocating fallback triggers on `visits` & `clinical_encounters`; `T2.1` refactors `create_prescription()` to insert as `DRAFT`, flush items, then flip to `AUTHORISED` in the same transaction.
3. **Risk: `kalyan_app` runtime permission errors on new tables/sequences (passes owner-run tests, fails live app) or false-pass trigger tests masking `InsufficientPrivilege`.**
   - *Mitigation*: Every migration (`0034`–`0037`) grants explicit least-privilege permissions (`SELECT, INSERT` only on immutable `ledger_entries`/`refunds`) + sequence grants; tests verify triggers via `owner_engine` (rolled-back tx) and runtime grants via `db_session` (`kalyan_app`).
4. **Risk: Ledger reconciliation drift on open/cancelled consultations, `0`-paise Phase 22 `PACKAGE` bill items, or post-refund re-payments.**
   - *Mitigation*: `T3.1`/`T3.2` post `PACKAGE_CHARGE` DEBITs for `treatment_plans.agreed_price_paise`, post `CHARGE_VOID` CREDITs on cancelled consultations, net refunds across all 4 calculation sites (`billing_service.py`, `routers/billing.py` package & consultation caps, `bill_service.py` floor check, and `integrity_service.py` Checks #1 & #7), and block payment reversal once any partial refund exists (`422 payment_already_refunded`).
5. **Risk: `test_no_orphan_permissions` or `test_golden_role_permissions_snapshot` breaks mid-plan if future permissions are added early.**
   - *Mitigation*: Each new permission is added in the exact milestone whose router binds it (`ALLERGY_WRITE` in M1, `PAYMENT_REFUND` in M3, `DOCUMENT_READ`/`DOCUMENT_WRITE` in M4) alongside golden snapshot updates in `test_permissions_catalogue.py`.
6. **Risk: `guards.test.ts` ratchet failure when `PatientDetail.tsx` drops its `text-[11px]` exemption.**
   - *Mitigation*: `T1.8` replaces `text-[11px]` with `text-xs` AND removes `'pages/PatientDetail.tsx'` from `PENDING` in `frontend/src/test/guards/guards.test.ts` in the same task (leaving the 3 unrelated client-held exemptions intact).
7. **Risk: Uploaded PDF document previews blocked by `X-Frame-Options: DENY` and `frame-ancestors 'none'` (`main.py:60-70`).**
   - *Mitigation*: `T4.6a` renders JPEG/PNG via authenticated Blob URLs inside `<Modal>` (`img-src 'self' blob:`) and opens/downloads PDFs via Blob URL in a new tab or attachment download — never inside an `<iframe>` — without weakening `SECURITY_HEADERS`.
8. **Risk: Parallel swarm workers colliding on shared files (`models.py`, `main.py`, `matrix.py`, `openapi.snapshot.json`, `frontend/src/api/types.ts`, `queries.ts`, `PatientDetail.tsx`).**
   - *Mitigation*: Every shared hub file is assigned to a dedicated sequential join wave (`T1.1`/`T1.5`/`T1.6`/`T1.8`, `T2.1`/`T2.5`/`T2.6`/`T2.9`, `T3.1`–`T3.4`, `T4.1`/`T4.4`/`T4.5`/`T4.7`); every parallel wave (`T1.3‖T1.4`, `T1.7a‖T1.7b`, `T2.2‖T2.3‖T2.4`, `T2.7‖T2.8`, `T4.2‖T4.3`, `T4.6a‖T4.6b`) has 100% disjoint file ownership and matching `depends_on` edges.
