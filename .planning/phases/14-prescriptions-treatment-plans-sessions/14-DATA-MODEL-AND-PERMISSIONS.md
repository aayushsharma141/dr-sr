# Phase 14: Data Model & Permissions Specification

**Phase:** 14  
**Title:** Database Schema, Constraints, Triggers & Access Control Matrix  
**Branch:** `planning/phase-14-treatment-records`  
**Migration ID:** `0004_prescriptions_and_treatment_records`  

---

## 1. Relational Database Schema (PostgreSQL 18)

### Table 1: `treatment_plans`
Stores multi-session treatment packages agreed upon between the patient and the clinic.

```sql
CREATE TABLE treatment_plans (
    id BIGSERIAL PRIMARY KEY,
    patient_id BIGINT NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    doctor_id BIGINT NOT NULL REFERENCES doctors(id) ON DELETE RESTRICT,
    encounter_id BIGINT REFERENCES clinical_encounters(id) ON DELETE SET NULL,
    plan_name VARCHAR(128) NOT NULL,
    condition_diagnosis TEXT NOT NULL,
    referred_by VARCHAR(128),
    total_sessions INTEGER NOT NULL,
    completed_sessions INTEGER NOT NULL DEFAULT 0,
    agreed_price_paise BIGINT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    cancellation_reason TEXT,
    version_id INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    
    CONSTRAINT ck_treatment_plans_total_sessions 
        CHECK (total_sessions >= 1 AND total_sessions <= 200),
    CONSTRAINT ck_treatment_plans_completed_sessions 
        CHECK (completed_sessions >= 0 AND completed_sessions <= total_sessions),
    CONSTRAINT ck_treatment_plans_agreed_price 
        CHECK (agreed_price_paise >= 0),
    CONSTRAINT ck_treatment_plans_status 
        CHECK (status IN ('ACTIVE', 'COMPLETED', 'CANCELLED')),
    CONSTRAINT ck_treatment_plans_cancellation 
        CHECK (status != 'CANCELLED' OR (cancellation_reason IS NOT NULL AND length(trim(cancellation_reason)) >= 3))
);

CREATE INDEX ix_treatment_plans_patient ON treatment_plans(patient_id);
CREATE INDEX ix_treatment_plans_doctor ON treatment_plans(doctor_id);
CREATE INDEX ix_treatment_plans_status ON treatment_plans(status);
```

---

### Table 2: `treatment_sessions`
Stores individual chronological physiotherapy treatment session logs.

```sql
CREATE TABLE treatment_sessions (
    id BIGSERIAL PRIMARY KEY,
    treatment_plan_id BIGINT NOT NULL REFERENCES treatment_plans(id) ON DELETE RESTRICT,
    patient_id BIGINT NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    doctor_id BIGINT NOT NULL REFERENCES doctors(id) ON DELETE RESTRICT,
    session_number INTEGER NOT NULL,
    session_date DATE NOT NULL DEFAULT CURRENT_DATE,
    vas_score INTEGER NOT NULL,
    modalities JSONB NOT NULL DEFAULT '[]'::jsonb,
    clinical_notes TEXT NOT NULL,
    is_finalised BOOLEAN NOT NULL DEFAULT TRUE,
    created_by_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    
    CONSTRAINT uq_treatment_sessions_plan_session 
        UNIQUE (treatment_plan_id, session_number),
    CONSTRAINT ck_treatment_sessions_vas 
        CHECK (vas_score >= 0 AND vas_score <= 10),
    CONSTRAINT ck_treatment_sessions_number 
        CHECK (session_number >= 1),
    CONSTRAINT ck_treatment_sessions_notes 
        CHECK (length(trim(clinical_notes)) >= 2)
);

CREATE INDEX ix_treatment_sessions_plan ON treatment_sessions(treatment_plan_id);
CREATE INDEX ix_treatment_sessions_patient ON treatment_sessions(patient_id);
CREATE INDEX ix_treatment_sessions_date ON treatment_sessions(session_date);
```

---

### Table 3: `treatment_session_addenda`
Stores dated corrections or subsequent clinical observations attached to a finalized session.

```sql
CREATE TABLE treatment_session_addenda (
    id BIGSERIAL PRIMARY KEY,
    session_id BIGINT NOT NULL REFERENCES treatment_sessions(id) ON DELETE RESTRICT,
    author_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    note TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    
    CONSTRAINT ck_treatment_session_addenda_note 
        CHECK (length(trim(note)) >= 2)
);

CREATE INDEX ix_treatment_session_addenda_session ON treatment_session_addenda(session_id);
```

---

### Table 4: `prescriptions`
Stores doctor prescriptions with patient and clinical diagnostic linkage.

```sql
CREATE TABLE prescriptions (
    id BIGSERIAL PRIMARY KEY,
    patient_id BIGINT NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    doctor_id BIGINT NOT NULL REFERENCES doctors(id) ON DELETE RESTRICT,
    encounter_id BIGINT REFERENCES clinical_encounters(id) ON DELETE SET NULL,
    diagnosis TEXT NOT NULL,
    dietary_advice TEXT,
    general_advice TEXT,
    follow_up_date DATE,
    version_id INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    
    CONSTRAINT ck_prescriptions_diagnosis 
        CHECK (length(trim(diagnosis)) >= 2)
);

CREATE INDEX ix_prescriptions_patient ON prescriptions(patient_id);
CREATE INDEX ix_prescriptions_doctor ON prescriptions(doctor_id);
CREATE INDEX ix_prescriptions_encounter ON prescriptions(encounter_id);
```

---

### Table 5: `prescription_items`
Stores structured medication items belonging to a prescription.

```sql
CREATE TABLE prescription_items (
    id BIGSERIAL PRIMARY KEY,
    prescription_id BIGINT NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
    item_order INTEGER NOT NULL,
    medicine_name VARCHAR(128) NOT NULL,
    dosage VARCHAR(64) NOT NULL,
    frequency VARCHAR(64) NOT NULL,
    duration_days INTEGER NOT NULL,
    instructions TEXT,
    
    CONSTRAINT uq_prescription_items_order 
        UNIQUE (prescription_id, item_order),
    CONSTRAINT ck_prescription_items_duration 
        CHECK (duration_days >= 1 AND duration_days <= 365),
    CONSTRAINT ck_prescription_items_medicine 
        CHECK (length(trim(medicine_name)) >= 1)
);

CREATE INDEX ix_prescription_items_rx ON prescription_items(prescription_id);
```

---

## 2. Database Triggers & Invariant Protections

### Trigger 1: Immutable Finalized Session Protection (`TRT-03`)
Rejects any SQL `UPDATE` or `DELETE` on finalized sessions.

```sql
CREATE OR REPLACE FUNCTION prevent_finalised_treatment_session_tampering()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF OLD.is_finalised THEN
            RAISE EXCEPTION 'Cannot modify finalised treatment session #% (immutable record). Use addenda.', OLD.id
                USING ERRCODE = '23505';
        END IF;
    ELSIF TG_OP = 'DELETE' THEN
        IF OLD.is_finalised THEN
            RAISE EXCEPTION 'Cannot delete finalised treatment session #% (immutable record).', OLD.id
                USING ERRCODE = '23505';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_treatment_sessions_tamper_guard
BEFORE UPDATE OR DELETE ON treatment_sessions
FOR EACH ROW
EXECUTE FUNCTION prevent_finalised_treatment_session_tampering();
```

---

### Trigger 2: Automatic Plan Progress & Auto-Completion
Updates `completed_sessions` on `treatment_plans` when a session is recorded, and marks status `COMPLETED` when the target is reached.

```sql
CREATE OR REPLACE FUNCTION sync_treatment_plan_session_progress()
RETURNS TRIGGER AS $$
DECLARE
    plan_total INTEGER;
    plan_completed INTEGER;
BEGIN
    SELECT total_sessions, completed_sessions 
    INTO plan_total, plan_completed
    FROM treatment_plans 
    WHERE id = NEW.treatment_plan_id
    FOR UPDATE;

    plan_completed := plan_completed + 1;

    UPDATE treatment_plans
    SET completed_sessions = plan_completed,
        status = CASE WHEN plan_completed >= plan_total THEN 'COMPLETED' ELSE status END,
        updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
    WHERE id = NEW.treatment_plan_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_treatment_sessions_progress_sync
AFTER INSERT ON treatment_sessions
FOR EACH ROW
EXECUTE FUNCTION sync_treatment_plan_session_progress();
```

---

## 3. Concurrency-Safe Session Number Allocation

To ensure two clinicians or open tabs cannot race to log "Session #4" at the exact same moment:

```python
def allocate_next_session_number(session: Session, treatment_plan_id: int) -> int:
    """Locks the treatment plan row and returns the next contiguous session number."""
    plan = session.execute(
        select(TreatmentPlan)
        .where(TreatmentPlan.id == treatment_plan_id)
        .with_for_update()
    ).scalar_one_or_none()
    
    if plan is None:
        raise ApiError(status_code=404, code="plan_not_found", message="Treatment plan not found.")
        
    if plan.status != TreatmentPlanStatus.ACTIVE:
        raise ApiError(
            status_code=422, 
            code="plan_not_active", 
            message=f"Cannot log session: plan is {plan.status}."
        )
        
    if plan.completed_sessions >= plan.total_sessions:
        raise ApiError(
            status_code=422,
            code="plan_already_completed",
            message="All sessions for this plan have already been completed."
        )
        
    return plan.completed_sessions + 1
```

---

## 4. Role Permissions & Access Control Matrix

### Phase 14 Permissions Added:
1. `PRESCRIPTION_READ`: View prescriptions and generate print slips.
2. `PRESCRIPTION_WRITE`: Author and issue prescriptions.
3. `TREATMENT_PLAN_READ`: View treatment packages and progress.
4. `TREATMENT_PLAN_WRITE`: Create, modify, or cancel treatment packages.
5. `TREATMENT_SESSION_READ`: View physiotherapy session logs and VAS trend history.
6. `TREATMENT_SESSION_WRITE`: Log new physiotherapy treatment sessions with VAS score and modalities.
7. `TREATMENT_SESSION_ADDENDUM`: Append retrospective corrections to past sessions.

### Access Control Matrix:

| Permission | `ADMIN` | `RECEPTION` | `DOCTOR` | Security Rationale |
|---|:---:|:---:|:---:|---|
| `PRESCRIPTION_READ` | ✅ | ✅ | ✅ | Reception needs to print prescriptions; Doctors view clinical history; Admin audits. |
| `PRESCRIPTION_WRITE` | ❌ | ❌ | ✅ | Strictly restricted to licensed medical practitioners. |
| `TREATMENT_PLAN_READ` | ✅ | ✅ | ✅ | Reception checks package progress for desk inquiries & billing; Clinicians treat. |
| `TREATMENT_PLAN_WRITE` | ❌ | ❌ | ✅ | Treatment package terms and clinical conditions are set by clinical staff. |
| `TREATMENT_SESSION_READ`| ✅ | ✅ | ✅ | Reception views session attendance; Clinicians review pain history; Admin audits. |
| `TREATMENT_SESSION_WRITE`| ❌ | ❌ | ✅ | Session logging, VAS assessment, and therapy execution require clinical role. |
| `TREATMENT_SESSION_ADDENDUM`| ❌ | ❌ | ✅ | Clinical corrections require clinical authorship and accountability. |

*Note on Doctor Silo*: Unlike consultation encounter notes (which are strictly siloed per doctor per `D-03`/`D-04`), **physiotherapy sessions and prescriptions are shared within the clinical team** attending to the patient's physical therapy rehabilitation.
