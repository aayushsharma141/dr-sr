# Database & Schema Integrity Audit (T04)

- **Auditor**: Database Explorer
- **Repository Scope**: `backend/src/kalyan_api/models.py`, `backend/src/kalyan_api/migrations/**`, DB triggers
- **Date**: 2026-11-09
- **Status**: AUDITED

---

## 1. Relational Entities & Schema Contracts
- **Core Models**:
  - `Patient`: Permanent URN (e.g. `KLY-YYYY-NNNNNN`), demographics, contact, emergency contact.
  - `Department`: Medical department/specialty (General Medicine, Physiotherapy, Orthopedics, Pediatrics, etc.).
  - `Doctor`: Consultation fee, department FK, room assignment, active flag.
  - `Appointment`: Date, token sequence per doctor per day, status (`SCHEDULED`, `ARRIVED`, `IN_CONSULTATION`, `COMPLETED`, `CANCELLED`).
  - `Encounter`: Clinical consultation record, vitals, diagnosis notes, doctor FK, appointment FK (optional for walk-in), immutable once finalised.
  - `PrescriptionItem`: Drug name, dosage, frequency, duration, instructions.
  - `TreatmentPlan`: Physiotherapy package, total sessions prescribed, completed sessions, status.
  - `TreatmentSession`: Completed therapy session log, treatment date, VAS pain score, therapist notes, locked on submission.
  - `Invoice`: Visit billing aggregation, items (consultation fee, procedures, packages), total amount, discount, net amount.
  - `Payment`: Transaction log, payment mode (Cash, UPI), amount paid, receipt number, immutable.
  - `AuditLog`: Append-only security and operational audit trail.

---

## 2. Integrity Guarantees & Triggers
1. **Append-Only Audit Logs**:
   - PostgreSQL DDL triggers prevent any UPDATE, DELETE, or TRUNCATE on `audit_logs`.
   - Verified by `test_audit_append_only.py`.
2. **Immutable Encounters & Sessions**:
   - Finalised encounters cannot be altered or deleted.
   - Verified by PostgreSQL triggers and tests.
3. **Session Token & URN Concurrency**:
   - Sequence generation protected by row-level locking / atomic counters to prevent duplicate tokens or URN gaps.
   - Verified by `test_urn_concurrency.py` and `test_token_concurrency.py`.

---

## 3. Database Role Separation
- `kalyan_app`: Runtime application user with SELECT, INSERT, UPDATE, DELETE only.
- `kalyan_owner`: Migration execution user with DDL privileges.

