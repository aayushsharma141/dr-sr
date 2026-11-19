# Phase 22 Plan 12 Summary: Doctor Charges API and Doctor Read View

**Plan:** 22-12  
**Status:** IMPLEMENTED — NOT VERIFIED  
**Task IDs:** T22-08, T22-10, BILL-03  

---

## 1. AGENTS.md Governance Report

- **Task ID:** 22-12 (T22-08, T22-10, BILL-03)
- **Owned Files:**
  - `backend/tests/test_phase22_doctor_lines.py` (new)
  - `backend/src/kalyan_api/schemas/bill.py`
  - `backend/src/kalyan_api/services/bill_service.py`
  - `backend/src/kalyan_api/routers/bill_items.py`
  - `backend/tests/support/matrix.py`
  - `backend/tests/test_rbac_matrix.py`
  - `backend/tests/openapi.snapshot.json`
- **Git Checkpoint:**
  - Checkpoint stash: `checkpoint: before 22-12 doctor charges api` (stored as `stash@{0}`).
  - Tree and index untouched; no commits created; zero database resets (kalyan_dev untouched, all tests run on kalyan_test).
- **Findings:**
  - Implemented doctor charge addition endpoint: `POST /api/appointments/{id}/bill-items` protected with `require(Permission.BILL_CLINICAL)`.
  - Requires `principal.doctor_id` (returns `403 doctor_only` if missing).
  - Enforced strict locking order: visit row locked first (`billing_service.lock_visit`), then appointment row locked (`booking_service.lock_appointment`).
  - Scoped to own consultation: `appt.doctor_id != principal.doctor_id` returns `404 appointment_not_found` (T-22-42 mitigation).
  - Status rules (owner decision B3, 2026-11-16):
    - Closed visit returns `422 visit_closed` (charges lock upon Patient Out).
    - Cancelled consultation returns `422 consultation_cancelled`.
    - Both `IN_CONSULTATION` and `COMPLETED` consultations on an open visit accept charge additions.
  - Line category handling:
    - `PROCEDURE`: line amount computed via `line_amount_paise(quantity, rate_paise)` (whole paise round half up, OD-E); marked `source=DOCTOR`, `appointment_id=appt.id`.
    - `PACKAGE`: references an existing treatment plan of the same patient (`plan.patient_id == appt.patient_id`, returning `404 plan_not_found` otherwise); line carries `description=plan.plan_name`, `quantity=1`, `rate_paise=0`, `amount_paise=0`, `treatment_plan_id=plan.id` (OD-C; package money stays on the treatment plan; satisfies database constraint `package_reference`).
  - Payable timing (22-05 rule i):
    - When appointment is `IN_CONSULTATION`, procedure charges have `counts_toward_total=False` and do not count toward visit total.
    - When appointment is marked `COMPLETED`, charges have `counts_toward_total=True` and count toward visit bill total (BILL-03).
  - Audit logging:
    - Logged `BILL_ITEM_ADDED` audit entry with `appointment_id`, `category`, and line details.
  - Doctor read view:
    - Implemented `GET /api/appointments/{id}/bill-items` protected with `require(Permission.BILL_CLINICAL)`.
    - Own consultation only (`404 appointment_not_found` for other doctors; 403 for reception/admin).
    - Returns `DoctorChargesOut` containing `consultation_line` (with adjustment history) and `doctor_lines` (active and voided DOCTOR charges on that consultation).
    - Strict Q13 isolation verified: NO visit total, NO payments, NO reception lines, NO charges from other doctors.
  - Doctor void:
    - Verified owner decision (iv) option-a ("doctors do not void or correct lines"); no doctor void route built; asserted 404/405 on doctor void paths in tests.
  - RBAC matrix & OpenAPI:
    - 10 matrix cells added (POST & GET `/api/appointments/{id}/bill-items` across 5 identities: anon 401, admin 403, reception 403, doctor_a 201/200, doctor_b 404).
    - Appointments matrix resolver extended to provision an open visit with a completed/in-consultation consultation line.
    - OpenAPI snapshot regenerated with `kalyan_api.cli export-openapi`.
- **Root Cause / Motivation:**
  - OPD workflow step (e), doctor slice: doctors need to record procedures/services performed during consultation (e.g. ultrasound therapy, dressing) and link package references without double-counting money, while having a dedicated scoped view for the upcoming doctor charges UI panel (Plan 22-16).
- **Changes:**
  - `backend/src/kalyan_api/schemas/bill.py`:
    - Added `DoctorLineCreate`: `extra="forbid"`, `category: Literal["PROCEDURE", "PACKAGE"]`, validators for required PROCEDURE fields (`description`, `quantity gt=0`, `rate_paise ge=0`), optional `unit`, PACKAGE field (`treatment_plan_id`, no rate).
    - Added `DoctorChargesOut`: `consultation_line: BillLineOut | None`, `doctor_lines: list[BillLineOut]`, `extra="forbid"`.
  - `backend/src/kalyan_api/services/bill_service.py`:
    - Added `add_doctor_line(session, appt, principal, payload)` enforcing B3 status checks, PROCEDURE amount calculation, and PACKAGE plan validation/zero-amount enforcement.
  - `backend/src/kalyan_api/routers/bill_items.py`:
    - Updated `_build_line_out` to evaluate `counts_toward_total` via `billing_service.counts_toward_total(line, appt.consultation_status)`.
    - Added `POST /appointments/{id}/bill-items`: `Permission.BILL_CLINICAL`, doctor_id required, visit-then-appointment locks, own-doctor check, audit record.
    - Added `GET /appointments/{id}/bill-items`: `Permission.BILL_CLINICAL`, own-doctor check, returns `DoctorChargesOut`.
  - `backend/tests/test_phase22_doctor_lines.py`:
    - 11 unit/integration tests covering PROCEDURE addition, payable timing, BILL-03 reception bill inclusion, B3 COMPLETED consultation acceptance, B3 closed visit rejection, Doctor B 404, CANCELLED consultation rejection, RBAC refusals, PACKAGE reference line creation, other patient's plan 404, Q13 read view isolation, and absence of doctor void route.
  - `backend/tests/support/matrix.py`:
    - Added `_doctor_line_create_payload`.
    - Added MatrixRows for `POST /api/appointments/{id}/bill-items` and `GET /api/appointments/{id}/bill-items`.
  - `backend/tests/test_rbac_matrix.py`:
    - Added `/api/appointments/{id}/bill-items` resolver provisioning open visit, consultation appointment, and consultation bill item.
  - `backend/tests/openapi.snapshot.json`:
    - Regenerated via `kalyan_api.cli export-openapi`.
- **Test Commands & Results:**
  - Unit/Integration tests:
    `$env:PYTHONPATH="D:/dr-sr/backend/src"; backend/.venv/Scripts/python.exe -m pytest -p no:warnings backend/tests/test_phase22_doctor_lines.py -vv`
    -> **11 passed in 4.75s**
  - RBAC Matrix cells:
    `$env:PYTHONPATH="D:/dr-sr/backend/src"; backend/.venv/Scripts/python.exe -m pytest -p no:warnings backend/tests/test_rbac_matrix.py -k 'appointments and bill' -vv`
    -> **10 passed in 3.29s**
  - RBAC Matrix completeness:
    `$env:PYTHONPATH="D:/dr-sr/backend/src"; backend/.venv/Scripts/python.exe -m pytest -p no:warnings backend/tests/test_rbac_matrix.py -k 'test_matrix' -vv`
    -> **3 passed in 1.51s**
  - Full Wave 3 backend regression suite (Task 3 verification):
    `$env:PYTHONPATH="D:/dr-sr/backend/src"; backend/.venv/Scripts/python.exe -m pytest -p no:warnings backend/tests/test_rbac_matrix.py backend/tests/test_openapi_snapshot.py backend/tests/test_route_policies.py backend/tests/test_permissions_catalogue.py backend/tests/test_migrations.py backend/tests/test_phase22_checkin.py backend/tests/test_wave2.py backend/tests/test_phase22_bill_snapshot.py backend/tests/test_phase22_fee_adjustment.py backend/tests/test_phase22_bill_schema.py backend/tests/test_phase22_balance_switch.py backend/tests/test_phase22_visit_payments.py backend/tests/test_phase22_bill_lines.py backend/tests/test_phase22_bill_view.py backend/tests/test_phase22_bill_void.py backend/tests/test_phase22_bill_correct.py backend/tests/test_phase22_prescribed_medicines.py backend/tests/test_phase22_doctor_lines.py backend/tests/test_visit_checkout_api.py backend/tests/test_billing_api.py backend/tests/test_receipt_concurrency.py`
    -> **968 passed in 157.80s (0:02:37)**
- **Dependencies:**
  - Upstream: 22-09 (visit bill view), 22-10 (bill line void), 22-11 (bill line correction).
  - Downstream: 22-16 (Doctor charges UI panel).
- **Remaining Risks:**
  - Doctor charges panel frontend (22-16) will integrate with `GET /api/appointments/{id}/bill-items` and `POST /api/appointments/{id}/bill-items`. The API contracts, validation, and permissions are verified.

---

## 2. DoctorChargesOut Fields for Plan 22-16

Frontend contract for the doctor charges panel in Plan 22-16 (`GET /api/appointments/{id}/bill-items`):

```json
{
  "consultation_line": {
    "id": 1,
    "visit_id": 10,
    "appointment_id": 5,
    "category": "CONSULTATION",
    "source": "SYSTEM",
    "description": "Consultation Fee - Dr. Name",
    "unit": null,
    "quantity": "1.00",
    "rate_paise": 40000,
    "amount_paise": 40000,
    "original_amount_paise": 50000,
    "status": "ACTIVE",
    "prescription_item_id": null,
    "counts_toward_total": true,
    "created_by_user_id": 2,
    "created_by_username": "reception",
    "created_at": "2026-11-16T06:00:00Z",
    "history": [
      {
        "id": 1,
        "bill_item_id": 1,
        "kind": "DISCOUNT",
        "old_quantity": null,
        "new_quantity": null,
        "old_rate_paise": null,
        "new_rate_paise": null,
        "old_amount_paise": 50000,
        "new_amount_paise": 40000,
        "reason": "Discount reason",
        "actor_user_id": 3,
        "actor_username": "doctor_a",
        "created_at": "2026-11-16T06:05:00Z"
      }
    ],
    "void_reason": null,
    "voided_by_user_id": null,
    "voided_by_username": null,
    "voided_at": null
  },
  "doctor_lines": [
    {
      "id": 2,
      "visit_id": 10,
      "appointment_id": 5,
      "category": "PROCEDURE",
      "source": "DOCTOR",
      "description": "Ultrasound therapy",
      "unit": "session",
      "quantity": "1.00",
      "rate_paise": 30000,
      "amount_paise": 30000,
      "original_amount_paise": 30000,
      "status": "ACTIVE",
      "prescription_item_id": null,
      "counts_toward_total": true,
      "created_by_user_id": 3,
      "created_by_username": "doctor_a",
      "created_at": "2026-11-16T06:10:00Z",
      "history": [],
      "void_reason": null,
      "voided_by_user_id": null,
      "voided_by_username": null,
      "voided_at": null
    }
  ]
}
```

---

## 3. UAT Requirement Satisfied

- **BILL-03:** Doctor-entered procedure line (e.g. ₹300 ultrasound therapy) is stored with `source=DOCTOR`, displayed in reception's visit bill under the `PROCEDURE` section, and included in the visit total once the consultation completes.
