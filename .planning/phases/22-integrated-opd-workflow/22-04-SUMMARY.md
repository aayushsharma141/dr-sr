# Phase 22 Plan 04 Summary: Migration 0029 — bill lines and visit payments

**Plan:** 22-04  
**Status:** IMPLEMENTED — NOT VERIFIED  
**Task IDs:** T22-07  

---

## 1. AGENTS.md Governance Report

- **Task ID:** 22-04 (T22-07)
- **Owned Files:**
  - `backend/src/kalyan_api/migrations/versions/0029_bill_lines_and_visit_payments.py`
  - `backend/src/kalyan_api/models.py`
  - `backend/tests/test_phase22_bill_schema.py`
  - `.planning/phases/22-integrated-opd-workflow/22-04-SUMMARY.md`
- **Findings:**
  - Alembic migration `0029_bill_lines_and_visit_payments.py` created with `revision = "0029"`, `down_revision = "0028"`.
  - Added new columns, constraints, foreign keys and indexes to `bill_items`:
    - `status`: `varchar(16) NOT NULL DEFAULT 'ACTIVE'`, CHECK `status_valid` (`status IN ('ACTIVE', 'VOIDED')`).
    - `void_reason`: `text NULL`.
    - `voided_by_user_id`: `bigint NULL` FK `users.id` ON DELETE RESTRICT (`fk_bill_items_voided_by_user_id_users`).
    - `voided_at`: `timestamptz NULL`.
    - CHECK `void_integrity`: ACTIVE rows have all 3 void fields NULL; VOIDED rows require reason (length >= 3 chars), actor, and time.
    - `unit`: `varchar(32) NULL`.
    - `prescription_item_id`: `bigint NULL` FK `prescription_items.id` ON DELETE SET NULL (`fk_bill_items_prescription_item_id_prescription_items`).
    - `treatment_plan_id`: `bigint NULL` composite FK `(treatment_plan_id, patient_id) -> treatment_plans(id, patient_id)` ON DELETE RESTRICT (`fk_bill_items_treatment_plan_patient`).
    - CHECK `package_reference`: `category <> 'PACKAGE' OR (treatment_plan_id IS NOT NULL AND rate_paise = 0 AND amount_paise = 0)` (OD-C).
    - CHECK `prescription_link_medicine_only`: `category = 'MEDICINE' OR prescription_item_id IS NULL`.
    - Index `ix_bill_items_appointment` on `appointment_id`.
    - `version_id` column intentionally omitted (row-level locking via `with_for_update` per research Pattern 3).
  - Added new column, composite foreign key, index and constraint to `payments`:
    - `visit_id`: `bigint NULL`.
    - Composite FK `(visit_id, patient_id) -> visits(id, patient_id)` named `fk_payments_visit_patient` ON DELETE RESTRICT.
    - Index `ix_payments_visit_id` on `visit_id`.
    - CHECK `single_target`: `visit_id IS NULL OR (treatment_plan_id IS NULL AND appointment_id IS NULL)` (prevents double-counting).
  - Python enums and models updated in `models.py`:
    - Added `BillItemStatus(StrEnum)` with `ACTIVE`, `VOIDED`.
    - Extended `BillItemCategory` with `PROCEDURE`, `PACKAGE`, `MEDICINE`, `ADDITIONAL` (along with existing `CONSULTATION`).
    - Extended `BillItemAdjustmentKind` with `VOID` (along with existing `DISCOUNT`, `WAIVER`, `CORRECTION`).
    - Mirrored all new columns, constraints, foreign keys, and indexes in `BillItem` and `Payment`.
    - Updated `BillItem` docstring noting append-only history moves.
  - Migration downgrade implemented to strictly refuse when any new-style bill items or visit payments exist.
  - Zero database drift: `alembic check` (`test_migrations_match_models`) passes cleanly on `kalyan_test`.
  - Database safety: `kalyan_dev` was NOT touched. All migrations and tests ran against isolated `kalyan_test`.
- **Root Cause:**
  - Migration 0027 omitted line-detail columns, status tracking, package/prescription linkage, and payment visit linkage needed for the OPD integrated billing balance switch (22-05), payment guard (22-06), and line endpoints (22-08..22-12).
- **Changes:**
  - `backend/src/kalyan_api/migrations/versions/0029_bill_lines_and_visit_payments.py`:
    - Created revision 0029 with `upgrade()` and safe guarded `downgrade()`.
  - `backend/src/kalyan_api/models.py`:
    - Added `BillItemStatus` enum.
    - Extended `BillItemCategory` (5 values) and `BillItemAdjustmentKind` (4 values).
    - Added `status`, `void_reason`, `voided_by_user_id`, `voided_at`, `unit`, `prescription_item_id`, `treatment_plan_id` to `BillItem`.
    - Added `fk_bill_items_treatment_plan_patient`, `status_valid`, `void_integrity`, `package_reference`, `prescription_link_medicine_only`, `ix_bill_items_appointment` to `BillItem.__table_args__`.
    - Added `visit_id` to `Payment`.
    - Added `fk_payments_visit_patient`, `ix_payments_visit_id`, `single_target` to `Payment.__table_args__`.
  - `backend/tests/test_phase22_bill_schema.py`:
    - Added comprehensive guard tests for all new columns, CHECK constraints, composite foreign keys, Python enums, and downgrade refusal behavior.
- **Test Commands & Results:**
  - Schema and Migration verification run:
    ```bash
    cd D:/dr-sr/backend && PYTHONPATH=D:/dr-sr/backend/src .venv/Scripts/python.exe -m pytest -p no:warnings tests/test_phase22_bill_schema.py tests/test_migrations.py
    ```
    *Result:* `15 passed in 5.07s`
  - Full suite verification run:
    ```bash
    cd D:/dr-sr/backend && PYTHONPATH=D:/dr-sr/backend/src .venv/Scripts/python.exe -m pytest -p no:warnings tests/test_phase22_bill_schema.py tests/test_migrations.py tests/test_db_guards.py tests/test_phase22_bill_snapshot.py tests/test_phase22_fee_adjustment.py tests/test_billing_models.py tests/test_permissions_catalogue.py tests/test_rbac_matrix.py tests/test_openapi_snapshot.py
    ```
    *Result:* `789 passed in 151.23s (0:02:31)`
- **Dependencies:**
  - Plan 22-05 (Balance switch & dues query) reads `payments.visit_id` and `bill_items.status = 'ACTIVE'`.
  - Plan 22-06 (Visit payment guard) reads `payments.visit_id` and enforces visit locks.
  - Plans 22-08..22-12 (Line endpoints) read and write `bill_items` columns (unit, prescription_item_id, treatment_plan_id, void fields).
- **Remaining Risks:**
  - Migration 0029 is only applied to `kalyan_test`. Applying to `kalyan_dev` remains approval-gated at plan 22-20.
