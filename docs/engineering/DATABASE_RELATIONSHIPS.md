# Kalyan Hospital — Database Relational Model & Entity Lifecycle

```mermaid
erDiagram
    PATIENT ||--o{ APPOINTMENT : has
    PATIENT ||--o{ ENCOUNTER : has
    PATIENT ||--o{ INVOICE : billed
    PATIENT ||--o{ TREATMENT_PLAN : prescribed

    DEPARTMENT ||--o{ DOCTOR : employs
    DOCTOR ||--o{ APPOINTMENT : assigned
    DOCTOR ||--o{ ENCOUNTER : conducts
    DOCTOR ||--o{ TREATMENT_PLAN : supervises

    APPOINTMENT ||--o| ENCOUNTER : initiates

    ENCOUNTER ||--o{ PRESCRIPTION_ITEM : contains
    ENCOUNTER ||--o{ CLINICAL_NOTE : records

    TREATMENT_PLAN ||--o{ TREATMENT_SESSION : logs

    INVOICE ||--|{ INVOICE_ITEM : itemizes
    INVOICE ||--o{ PAYMENT : collects

    USER ||--o{ USER_SESSION : authenticates
    USER ||--o{ AUDIT_LOG : actions
```

## Relational Constraints & Invariants
1. **Permanent Patient Identity**: `patients.urn` is unique and immutable.
2. **Per-Doctor Daily Token**: `appointments(doctor_id, appointment_date, token_number)` is unique.
3. **Append-Only Auditing**: `audit_logs` has trigger protections rejecting updates and deletions.
4. **Finalized Clinical Locks**: `encounters.is_finalised` triggers read-only enforcement in PostgreSQL.
5. **Session Deduction Invariant**: `treatment_plans.completed_sessions` increments strictly when a `treatment_session` is completed.

