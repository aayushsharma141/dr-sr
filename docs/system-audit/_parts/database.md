# Database Schema & Integrity Map (audit part: database)

Audit date: 2026-11-09. Read-only audit of `backend/src/kalyan_api/models.py` and
`backend/src/kalyan_api/migrations/versions/*` as on disk (uncommitted edits included).
Nothing was executed against PostgreSQL; no pytest/alembic was run. Statements about trigger
behaviour come from reading the PL/pgSQL source, plus test files that exercise it.

Working-tree note: `IntegrityRun` (models.py:1542-1566), migration `0020_integrity_runs.py`
(untracked) and the `integrity_runs` entry in `services/backup_service.py:332` are uncommitted
in-progress work. They are consistent with each other.

## 1. Migration chain

`0001 -> 0002 -> 0003 -> 0004 -> 0005 -> 0006 -> 0007 -> 0011 -> 0012 -> ... -> 0020` (single
linear head; `down_revision` lines verified with grep). Revisions 0008-0010 are intentionally
absent: 0019's docstring (0019:7-11) says PR #17 had used 0008/0009 for a second `departments`
table and was folded into 0019. A database ever stamped at `0008`/`0009` from that branch
cannot be upgraded by this chain (Alembic cannot locate the revision).

`env.py` passes `target_metadata=Base.metadata` with `compare_type`/`compare_server_default`;
`tests/test_migrations.py:19-23` runs `alembic.command.check` (not run here).

## 2. Tables

Legend: PK = primary key; FK(x) = ondelete action; tz = `timestamptz`; all `created_at`/
`updated_at` are tz with `now()` defaults unless stated. "DB-enf" = enforced by CHECK.

| Table (migration) | Key columns / types | PK | FKs (ondelete) | Unique / partial unique | CHECKs | Indexes | Triggers |
|---|---|---|---|---|---|---|---|
| doctors (0001, +0002) | name_en, name_hi, qualification, registration_number, default_fee_paise INT default 0, is_active, version_id | id BIGINT identity | - | - | - | - | - |
| users (0001) | username, role VARCHAR16, doctor_id, password_hash, lockout cols (tz), version_id | id | doctor_id->doctors RESTRICT; created_by->users SET NULL | username; doctor_id | role IN (ADMIN,RECEPTION,DOCTOR); (role=DOCTOR)=(doctor_id NOT NULL) | - | - |
| sessions (0001) | token_hash, csrf_token, last_seen_at tz, ip INET, revoked_at | id | user_id->users CASCADE | token_hash | - | - | - |
| login_throttle (0001) | ip INET, window_start tz, attempt_count | ip | - | - | - | - | - |
| system_setup (0001) | completed_at tz, admin_user_id | id SMALLINT | admin_user_id->users RESTRICT | - | id=1 | - | BEFORE UPDATE/DELETE + TRUNCATE -> `audit_logs_block_mutation()` |
| audit_logs (0001) | occurred_at tz, actor_*, action, outcome, entity_type, entity_id TEXT, before/after JSONB, reason, request_id UUID, ip | id | actor_user_id->users RESTRICT | - | outcome IN (SUCCESS,FAILURE,DENIED) | occurred_at; action; (entity_type,entity_id); (actor_user_id,occurred_at) | BEFORE UPDATE/DELETE + TRUNCATE -> block |
| clinic_settings (0002, +0007) | names, address, phone, receipt_sequence_cycle, print header/footer, consultation_validity_days, version_id | id BIGINT (=1) | - | - | id=1; cycle IN (FINANCIAL_YEAR,CALENDAR_YEAR) | - | - |
| consultation_fees (0002, +0006) | name, fee_paise INT, is_active, version_id | id | - | - | fee_paise>=0 | - | - |
| urn_sequences (0002) | year INT, last_seq INT | year | - | - | - | - | - |
| patients (0002, +0017) | urn VARCHAR32, legacy_urn, full_name, guardian_name, gender, dob DATE, age_years, mobile, address, ..., is_active, version_id | id | - | urn | gender IN (M,F,O); 0<=age<=150 | urn (dup of unique); mobile; full_name; legacy_urn | - (URN immutability is app-only) |
| daily_token_sequences (0003) | last_token INT | (doctor_id, appointment_date) | doctor_id->doctors RESTRICT | - | - | - | - |
| appointments (0003, +0011, +0019) | patient_id, doctor_id, department_id, appointment_date DATE, token_number INT, status VARCHAR32 default BOOKED, status_updated_at tz, check_in_at tz, cancellation_reason, version_id | id BIGSERIAL | patient RESTRICT; doctor RESTRICT; department RESTRICT; created_by_user RESTRICT | (doctor_id, appointment_date, token_number) | **none (status not DB-enf)** | (doctor_id,date,status); (patient_id,date); patient_id; doctor_id; appointment_date; department_id | - |
| clinical_encounters (0003, +0011, +0017) | appointment_id, department_id, patient_id, doctor_id, encounter_date tz, symptoms/clinical_notes/diagnosis TEXT NULL default '', is_finalised, finalised_at, snapshot patient_name/urn/mobile/address, version_id | id | appointment SET NULL; department SET NULL (FK added in 0012); patient RESTRICT; doctor RESTRICT; created_by RESTRICT | partial unique (appointment_id) WHERE appointment_id IS NOT NULL | - | patient_id; doctor_id; encounter_date; appointment_id | `trg_prevent_finalised_encounter_tampering` BEFORE UPDATE/DELETE (0012 version) |
| clinical_addenda (0003) | encounter_id, doctor_id, addendum_text, created_by | id | encounter RESTRICT; doctor RESTRICT; user RESTRICT | - | **none** | encounter_id | **none** (runtime role has UPDATE+DELETE) |
| treatment_plans (0004) | patient_id, doctor_id, encounter_id, plan_name, total_sessions, completed_sessions, agreed_price_paise BIGINT, status VARCHAR32, cancellation_reason, version_id | id | patient RESTRICT; doctor RESTRICT; encounter SET NULL | - | 1<=total<=200; 0<=completed<=total; price>=0; status IN (ACTIVE,COMPLETED,CANCELLED); cancelled => reason>=3 | patient_id; doctor_id; status | (target of sync trigger) |
| treatment_sessions (0004) | plan_id, patient_id, doctor_id, session_number, session_date DATE default CURRENT_DATE, vas_score, modalities JSONB, clinical_notes, is_finalised default TRUE | id | plan RESTRICT; patient RESTRICT; doctor RESTRICT; user RESTRICT | (treatment_plan_id, session_number) | vas 0-10; number>=1; notes>=2 | plan_id; patient_id; session_date | `trg_prevent_finalised_treatment_session_tampering` BEFORE UPDATE/DELETE; `trg_sync_treatment_plan_session_progress` AFTER INSERT |
| treatment_session_addenda (0004) | session_id, author_user_id, note | id | session RESTRICT; user RESTRICT | - | note>=2 (**migration only, absent in model**) | session_id | **none** |
| prescriptions (0004, +0013, +0017) | patient_id, doctor_id, encounter_id, diagnosis, advice, follow_up_date, status, authorised_at, cancelled_*, snapshots, version_id | id | patient RESTRICT; doctor RESTRICT; encounter SET NULL; cancelled_by RESTRICT | partial unique (encounter_id) WHERE encounter_id NOT NULL AND status IN (DRAFT,AUTHORISED) | diagnosis>=2; status IN (DRAFT,AUTHORISED,CANCELLED); cancellation integrity | patient_id; doctor_id; encounter_id | **none** (AUTHORISED lock is app-only) |
| prescription_items (0004, +0013) | item_order, medicine_name, dosage, frequency, duration_days, strength/form/route | id | prescription CASCADE | (prescription_id, item_order) | 1<=duration<=365; medicine>=1 | prescription_id | - |
| receipt_sequences (0005) | cycle_key VARCHAR32, last_number INT | id | - | cycle_key | - | - | - |
| payments (0005, +0017) | receipt_number, patient_id, treatment_plan_id, appointment_id, amount_paise **INT**, payment_method, notes, is_reversed, reversal_reason, reversed_by, reversed_at tz, snapshots, created_by | id | patient RESTRICT; plan RESTRICT; appointment SET NULL; users RESTRICT | receipt_number | amount>0; method IN (CASH,UPI,CARD); reversal integrity (reason>=5) | receipt_number (dup); patient_id; plan_id; appointment_id; is_reversed. **No created_at / reversed_at index** | `trg_prevent_payment_tampering` BEFORE UPDATE/DELETE (0017 version); `trg_enforce_package_payment_limits` BEFORE INSERT/UPDATE |
| security_settings (0007) | nullable overrides, version_id | id (=1) | - | - | id=1 | - | - |
| backup_settings (0007) | schedule_enabled, frequency, run_at TIME (no tz), weekly_day, destination_dir, retention_count, version_id | id (=1) | - | - | id=1; frequency; weekly_day 0-6; weekly needs day; retention>=1 | - | - |
| backup_runs (0007) | trigger, outcome, started_at tz, finished_at, filename, size_bytes, copied_to, pruned_count, error_type | id | - | - | trigger IN (MANUAL,SCHEDULED); outcome IN (RUNNING,SUCCESS,FAILURE) | started_at | - |
| departments (0012, +0019) | code, name_en, name_hi, description, is_active, version_id | id | - | code; name_en | name_en trimmed>=2 | - | - |
| clinical_templates (0012) | department_id, code, names, is_active | id | department RESTRICT | code | - | - | - |
| clinical_template_versions (0012) | template_id, version_number, schema_json JSONB, approved_by | id | template CASCADE | (template_id, version_number) | - | - | - |
| clinical_template_responses (0012) | encounter_id, template_version_id, response_data JSONB | id | encounter CASCADE; version RESTRICT | encounter_id | - | - | BEFORE INSERT/UPDATE/DELETE -> encounter-finalised check |
| vital_observations (0012) | encounter_id, patient_id, height/weight NUMERIC(5,2), bmi/temp NUMERIC(4,1), bp/pulse/rr/spo2 INT | id | encounter CASCADE; patient RESTRICT | encounter_id | physiological ranges | - | BEFORE INSERT/UPDATE/DELETE -> encounter-finalised check |
| follow_up_recommendations (0014) | encounter_id, patient_id, doctor_id, recommended_doctor_id, recommended_date, status, booked_appointment_id, closed_*, version_id | id | encounter CASCADE; patient/doctors RESTRICT; booked_appointment SET NULL; closed_by RESTRICT | encounter_id | status IN (PENDING,BOOKED,CLOSED); closure integrity | (status, recommended_date); patient_id | - |
| hospital_assets (0015) | asset_type, filename, mime, size, is_active, version | id | uploaded_by RESTRICT | filename | asset_type IN (...) | (asset_type,is_active); uploaded_by | - |
| print_templates (0016) | document_type, header/footer en/hi, version (mapper version col) | id | updated_by RESTRICT | document_type | document_type IN (...) | updated_by | - |
| patient_import_batches (0018) | batch_id, counts, status VARCHAR32, column_mapping JSONB, safety_backup_file | id | created_by RESTRICT | unique index batch_id | **none (status not DB-enf)** | created_by | - |
| patient_import_rows (0018) | batch_id, row_index, raw/mapped JSONB, validation_status, duplicate_patient_id, duplicate_resolution, allocated_urn | id | batch_id->batches.batch_id CASCADE; duplicate_patient SET NULL | - | **none** | batch_id; duplicate_patient_id | - |
| doctor_departments (0019) | - | (doctor_id, department_id) | doctor CASCADE; department RESTRICT | - | - | - | - |
| integrity_runs (0020, uncommitted) | generated_at tz, run_by_user_id, counts, checks JSONB | id | run_by_user SET NULL | - | - | generated_at | - (grant is SELECT/INSERT only) |

Money: all `*_paise` integers. `payments.amount_paise` and `consultation_fees.fee_paise` /
`doctors.default_fee_paise` are INT; `treatment_plans.agreed_price_paise` is BIGINT while
`fn_enforce_package_payment_limits` declares `pkg_price INTEGER` (0005:161) - harmless below
Rs 2.1 crore. Timestamps: every DateTime column is `timezone=True`; date-only columns are
DATE; `backup_settings.run_at` is TIME without tz. Engine sessions run with
`-c timezone=Asia/Kolkata` (db/session.py:23-29).

Enum/status values enforced by CHECK: users.role, audit outcome, receipt cycle, plan status,
prescription status, follow-up status, payment method, asset type, print document type,
backup frequency/trigger/outcome. **Not** enforced: appointments.status (model StrEnum only,
models.py:553-617), patient_import_batches.status, patient_import_rows.validation_status /
duplicate_resolution.

## 3. Trigger functions

| Function | Fires on | What it actually guards | Gaps |
|---|---|---|---|
| `audit_logs_block_mutation()` (0001:223) | audit_logs, system_setup: BEFORE UPDATE OR DELETE (row), BEFORE TRUNCATE (stmt) | Full append-only | none |
| `fn_prevent_finalised_encounter_tampering()` (latest 0012:246-303) | clinical_encounters BEFORE UPDATE/DELETE; clinical_template_responses and vital_observations BEFORE INSERT/UPDATE/DELETE | Encounter: when OLD.is_finalised, blocks change of symptoms, clinical_notes, diagnosis, patient_id, doctor_id, department_id, appointment_id; blocks DELETE. Child tables: blocks write if the encounter named by NEW (or OLD on delete) is finalised | Does not block `is_finalised` TRUE->FALSE, after which every column and DELETE are open; finalised_at, encounter_date, created_by_user_id and patient_* snapshots not covered; child UPDATE checks only NEW.encounter_id, so a row can be re-parented off a finalised encounter |
| `fn_prevent_finalised_treatment_session_tampering()` (0004:282) | treatment_sessions BEFORE UPDATE/DELETE | When OLD.is_finalised: all clinical columns; DELETE | Same `is_finalised` TRUE->FALSE unlock (used by tests/test_phase14_gate.py:139-149 and tests/test_session_concurrency.py:127-137 to delete finalised sessions) |
| `fn_sync_treatment_plan_session_progress()` (0004:326) | treatment_sessions AFTER INSERT | completed_sessions+1 under plan row lock; status COMPLETED at quota; CHECK caps completed<=total | Counts every inserted row regardless of NEW.is_finalised and plan status; does not bump version_id; writes `updated_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC'` into a timestamptz under an IST session (stores a value 5h30m early) |
| `fn_prevent_payment_tampering()` (latest 0017:92) | payments BEFORE UPDATE/DELETE | DELETE blocked; UPDATE only for is_reversed FALSE->TRUE with every non-reversal column (incl. snapshots) unchanged; reversed rows frozen | none material; reversal is an in-place flag, not a contra row |
| `fn_enforce_package_payment_limits()` (0005:158) | payments BEFORE INSERT/UPDATE | For non-reversed plan payments: locks plan row FOR UPDATE, rejects sum > agreed_price | Package payments only; no plan-status check; consultation payments have no limit at all |

No trigger exists on: clinical_addenda, treatment_session_addenda, prescriptions,
prescription_items, follow_up_recommendations, patients (URN), clinical_template_versions.

## 4. Relationship map (as declared)

- patients 1-N appointments (RESTRICT) 1-0..1 clinical_encounters (partial unique; appointment
  FK SET NULL, so encounters may exist without appointment) 1-N clinical_addenda (RESTRICT),
  1-0..1 vital_observations / clinical_template_responses / follow_up_recommendations (CASCADE),
  0..1 active prescription (partial unique; FK SET NULL).
- patients 1-N treatment_plans (RESTRICT; encounter_id SET NULL) 1-N treatment_sessions
  (RESTRICT; unique session_number) 1-N treatment_session_addenda (RESTRICT).
- payments -> patient (RESTRICT), treatment_plan (RESTRICT), appointment (SET NULL; in practice
  blocked by the payment tamper trigger because the SET NULL action is an UPDATE).
- receipt numbers: `receipt_sequences.cycle_key` row + `payments.receipt_number` UNIQUE.
- audit_logs.actor_user_id -> users RESTRICT; users have no DELETE grant, so no orphaning.
- Child rows duplicate patient_id/doctor_id from their parent (encounter vs appointment,
  prescription/plan vs encounter, vitals vs encounter, session vs plan) with **no composite FK
  or trigger** checking that they agree.

Uniqueness required by the repo, all present at DB level: URN (`uq_patients_urn`), receipt
number, (doctor_id, appointment_date, token_number), one encounter per appointment (partial),
one template response / vitals / follow-up per encounter, one active prescription per
encounter, (plan, session_number). Allocation: URN by `INSERT ... ON CONFLICT DO UPDATE ...
RETURNING` (urn_service.py:25-31); tokens and receipts by upsert + `SELECT ... FOR UPDATE` in
the caller's transaction (token_service.py:24-47, receipt_service.py:82-99), so rolled-back
payments/bookings release their number.

## 5. Cascade-delete exposure on PHI / financial tables

- CASCADE into PHI: clinical_encounters -> vital_observations, clinical_template_responses,
  follow_up_recommendations; prescriptions -> prescription_items; patient_import_batches ->
  patient_import_rows; users -> sessions; doctors -> doctor_departments.
- The runtime role holds DELETE on clinical_encounters, clinical_addenda, treatment_*,
  prescriptions, payments, appointments, receipt_sequences, daily_token_sequences, departments,
  vitals, template tables, follow-ups and print_templates (0003:264-267, 0004:361-365,
  0005:199-200, 0012:325-329, 0014:114, 0016:99, 0019:92). Application code only deletes from
  sessions (auth_service.py:419), prescription_items (prescriptions.py:323) and
  doctor_departments (relationship reassignment, departments.py:214).
- ORM `cascade="all, delete-orphan"` on ClinicalEncounter.addenda / TreatmentPlan.sessions /
  TreatmentSession.addenda (models.py:710-733, 838-843, 895-900) would delete children before a
  parent; DB triggers stop this for finalised rows only.

## 6. Runtime role `kalyan_app` grants vs. code needs

Matches `backup_service.RUNTIME_TABLE_GRANTS` (backup_service.py:295-333). No table has
TRUNCATE. patients, users, doctors, hospital_assets have no DELETE (good). Over-grants (DELETE
never used by code): see section 5. `security_settings`/`backup_settings` are SELECT, UPDATE
only (singleton rows seeded by 0007). `integrity_runs` SELECT, INSERT (append-only by grant).
Sequences: each migration re-runs `GRANT USAGE, SELECT ON ALL SEQUENCES`; no `ALTER DEFAULT
PRIVILEGES`.

## 7. Hot-query index coverage

- Covered: appointment queue by (doctor_id, appointment_date, status); patient history by
  (patient_id, appointment_date); audit by occurred_at / action / actor; follow-ups by (status,
  recommended_date); encounters by doctor/patient.
- Not covered: `payments.created_at` range scans (areas.py:304, 600-605, 624-628, 640-644,
  707-712), `payments.reversed_at` (areas.py:313-317), `patients.created_at` counts
  (areas.py:461, 612), leading-wildcard ILIKE patient search (patients.py:166-171,
  admin_patients.py:54-59, billing.py:361-363; no pg_trgm). `compute_pending_dues` issues one
  SUM query per ACTIVE plan (billing_service.py:25-31).
- Redundant: ix_patients_urn (dup of unique), ix_payments_receipt_number (dup of unique),
  ix_encounters_appointment_id (covered by partial unique for non-null), ix_appointments_doctor_id
  and ix_appointments_patient_id (prefixes of composite indexes).

## 8. Model vs. migration drift

- `treatment_session_addenda` CHECK `ck_treatment_session_addenda_note` exists in 0004:194, not
  in the model (models.py:903-922). `alembic check` does not compare CHECK constraints.
- CHECK constraint names: model passes e.g. `users_role_valid`, migrations pass
  `ck_users_role_valid`; both go through the `ck_%(table_name)s_%(constraint_name)s`
  convention (models.py:46), so model and DB names differ. Cosmetic; not compared by autogen.
- 0013 downgrade drops FK `prescriptions_cancelled_by_user_id_fkey` (0013:102), but the FK was
  added inline under the metadata naming convention (`fk_%(table_name)s_%(column_0_name)s_...`),
  so the name will not match and the downgrade will fail (medium confidence; not executed).
- Otherwise columns, nullability, FKs and indexes declared in models.py match migrations
  0001-0020 as read (integrity_runs only exists in uncommitted files).

## 9. Candidate findings

### DB-01 (P0, defect) Child clinical records can point at a different patient than their parent
`POST /encounters` checks only `appt.doctor_id == principal.doctor_id` (encounters.py:137-145),
never `appt.patient_id == payload.patient_id`, and does not check appointment status. It then
stores `patient_id=payload.patient_id` with `appointment_id=payload.appointment_id`
(encounters.py:173-186) and moves the appointment to IN_CONSULTATION. `POST /prescriptions`
(prescriptions.py:120-130, 185-191) and `POST /treatment-plans` (treatment_plans.py:88-100)
likewise accept an `encounter_id` for patient A with `patient_id` B; prescriptions also copy
the encounter's diagnosis into B's prescription (prescriptions.py:158-160). No composite FK or
trigger catches it. Fix: validate parent.patient_id equality in each create (and appointment
status for encounters); consider composite FKs `(appointment_id, patient_id)` ->
`appointments(id, patient_id)` etc. No test covers a mismatch.

### DB-02 (P1, defect) Package that auto-completes with a balance becomes uncollectable and vanishes from dues
`fn_sync_treatment_plan_session_progress` sets status COMPLETED when the last session is
logged (0004:340-344). `record_payment` rejects any plan whose status != ACTIVE
(billing.py:120-125) and `compute_pending_dues` lists only ACTIVE plans
(billing_service.py:17-21), which also feeds the admin dashboard outstanding total
(areas.py:469-471). An unpaid or partially paid package whose sessions are done can never be
paid through the API and drops out of pending dues; an admin reversal on such a plan restores a
balance that is equally invisible. No test (test_billing_api.py has none for COMPLETED plans).

### DB-03 (P2, defect) Finalisation triggers can be bypassed by flipping is_finalised
The encounter and session tamper functions only act when `OLD.is_finalised = TRUE`
(0012:253-275, 0004:285-308) and never forbid NEW.is_finalised = FALSE. Any role with UPDATE
(runtime role included) can unlock and then edit or delete. The test suite does exactly this to
delete finalised sessions (test_phase14_gate.py:139-149, test_session_concurrency.py:127-137).
Also: child-table UPDATE checks only NEW.encounter_id (0012:278-282), so a vitals/template row
can be moved off a finalised encounter; finalised_at, encounter_date and patient snapshot
columns are unguarded. App code never does this (only encounters.py:461 sets TRUE).

### DB-04 (P2, defect) Append-only clinical rows have no DB guard while the runtime role can UPDATE/DELETE them
clinical_addenda, treatment_session_addenda (the ADR-19 correction mechanism), AUTHORISED
prescriptions and their items, and patients.urn (invariant 1) are protected only in API code
(prescriptions.py:283-288; no addendum edit routes). The runtime role holds UPDATE+DELETE on
the addenda/prescription tables (0003:267, 0004:363-365) and UPDATE on patients (0002:209).
Deleting a draft encounter would also SET NULL `prescriptions.encounter_id` /
`treatment_plans.encounter_id` (0004:43-47, 218-222), detaching an authorised prescription
from its consultation (invariant 12). Low likelihood via the app; listed as defence-in-depth.

### DB-05 (P1, defect) No guard against duplicate or excess consultation-fee payments (BIL-02)
BIL-02 (REQUIREMENTS.md:48) requires overpayments to be rejected, including from two PCs. For
consultation payments there is no amount due anywhere: `record_payment` only checks that the
appointment belongs to the patient (billing.py:148-155), the DB trigger only handles
`treatment_plan_id` payments (0005:164), and `payments.appointment_id` has no uniqueness or
sum limit. Two receptionists (or a double submit) can post the same appointment's fee twice,
each getting a valid receipt. Splitting a fee into cash plus UPI is legitimate, so a unique
constraint is not the fix; this needs a charge amount (see DB-SC-02). Owners decide.

### DB-06 (P2, doc_drift) Reversal is an in-place flag; locked decision says contra-record
PROJECT.md:101 (D-06) and 11-ENTRY-GATE.md:27 (EG-9, LOCKED) specify "contra-record in billing
ledger". Phase 15 CONTEXT (.planning/phases/15-billing-receipts-reversals/15-CONTEXT.md:16-17) and the code mark the original row
(`is_reversed`, billing.py:415-418; trigger 0017:102-121). In practice, reports that filter
`is_reversed = false` by `created_at` (areas.py:600-605, 707-712) retroactively lower past
months' or days' collections when a later reversal happens, and the reversal has no receipt
number of its own. Decision owner must reconcile; not resolved here.

### DB-07 (P3, defect) Session-progress trigger counts non-finalised rows and writes skewed updated_at
`fn_sync_treatment_plan_session_progress` increments on every INSERT regardless of
`NEW.is_finalised` (0004:332-344), while the integrity check counts only finalised sessions
(integrity_service.py:333-345). Today every session is inserted finalised
(treatment_sessions.py:128), so this is latent for AGENTS invariant 11. The same trigger writes
`CURRENT_TIMESTAMP AT TIME ZONE 'UTC'` (a naive UTC wall clock) into timestamptz under an
Asia/Kolkata session (db/session.py:25), storing `treatment_plans.updated_at` 5h30m early, and
does not bump `version_id`.

### DB-08 (P3, defect) Status columns not constrained in the database
appointments.status (models.py:612-617, 0003:70-75), patient_import_batches.status,
patient_import_rows.validation_status / duplicate_resolution have no CHECK, unlike every other
status column. A bad write would put an appointment into a state the queue code does not count.

### DB-09 (P3, defect) Missing indexes for date-range dashboard queries; redundant indexes
See section 7. Low volume makes this minor today; payments.created_at is hit by four dashboard
queries per load.

### DB-10 (P3, defect) Migration hygiene: model/migration drift and broken downgrade
See section 8 (treatment_session_addenda CHECK absent from model; 0013 downgrade FK name;
revision gap 0008-0010 for any DB stamped from PR #17). Plus 0020/IntegrityRun is uncommitted.

### DB-11 (P3, defect) Runtime role over-granted DELETE on clinical and financial tables
See sections 5-6. Triggers block DELETE for payments and finalised rows only; addenda,
prescriptions, follow-ups, vitals of draft encounters, appointments, sequences and departments
are deletable by the application credential although no code path needs it.

### Spec conflicts (repo model vs AGENTS.md invariants)
- DB-SC-01 (P2) Invariants 2, 3, 5: there is no visit entity. One appointment = one doctor,
  one token, at most one encounter (partial unique, models.py:655-660). Seeing two doctors on
  one day means two appointments with separate queues and receipts; nothing groups them.
- DB-SC-02 (P1) Invariants 8, 9: there are no charges, invoices or invoice items. Treatment plans
  behave like a single-line invoice with multiple instalments (payments.treatment_plan_id +
  limit trigger); consultations have no charge record, so dues, overpayment and duplicate
  checks for them cannot exist (see DB-05).
- Invariant 10: satisfied in the sense that posted rows cannot change except the guarded
  reversal flag (0017:92-129); see DB-06 for the contra-record disagreement.
- Invariant 11: satisfied by current code path (session inserted finalised = completed), see
  DB-07 for the latent DB-level gap.
