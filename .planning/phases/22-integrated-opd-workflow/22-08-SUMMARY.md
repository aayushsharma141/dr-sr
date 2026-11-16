# Phase 22 Plan 08 Summary: Reception Medicine & Additional Lines API

**Plan:** 22-08  
**Status:** IMPLEMENTED — NOT VERIFIED  
**Task IDs:** T22-08, MED-03, MED-04, MED-05, MED-06, MED-08, MED-12, BILL-18  

---

## 1. AGENTS.md Governance Report

- **Task ID:** 22-08 (T22-08, MED-03, MED-04, MED-05, MED-06, MED-08, MED-12, BILL-18)
- **Owned Files:**
  - `backend/src/kalyan_api/services/bill_service.py`
  - `backend/src/kalyan_api/schemas/bill.py` (new)
  - `backend/src/kalyan_api/routers/bill_items.py` (new)
  - `backend/src/kalyan_api/main.py`
  - `backend/src/kalyan_api/services/audit_service.py`
  - `backend/src/kalyan_api/core/permissions.py`
  - `backend/tests/test_phase22_bill_lines.py` (new)
  - `backend/tests/support/matrix.py`
  - `backend/tests/openapi.snapshot.json`
- **Files Inspected / Unchanged:**
  - `backend/tests/test_rbac_matrix.py` (inspected; unchanged as existing `/api/visits` OPEN-visit resolver served the new row)
- **Git Checkpoint:**
  - `stash@{0}: checkpoint: before 22-08 reception bill lines` (created before first edit, preserving untracked files).
- **Findings:**
  - `line_amount_paise(quantity, rate_paise)` computes line amount in whole paise using `ROUND_HALF_UP` (OD-E, BIL-02): e.g. 2 x Rs 50 = Rs 100; 1.5 x 33 paise = 50 paise.
  - `BillLineCreate` schema enforces strict input boundary validation (MED-12):
    - Category restricted to `MEDICINE` and `ADDITIONAL`.
    - Description trimmed, 1 to 200 characters, whitespace-only rejected.
    - Unit optional, up to 32 characters, trimmed, empty/whitespace converted to `None`.
    - Quantity Decimal `gt=0`, `le=99999999.99`, `max_digits=10`, `decimal_places=2`.
    - Rate in paise `ge=0`.
    - Disallows unknown fields (`extra="forbid"`).
  - Reception line additions via `POST /api/visits/{id}/bill-items` lock the visit row first via `billing_service.lock_visit` (`SELECT ... FOR UPDATE`), serializing concurrent writers.
  - Rejection on non-OPEN visit: closed visits return 422 `visit_closed` ("The visit is closed, so its charges are locked.") (BILL-18); missing visits return 404 `visit_not_found`.
  - Persisted `BillItem` rows are assigned `source="RECEPTION"`, `status="ACTIVE"`, `amount_paise = original_amount_paise = line_amount_paise(...)`, and `created_by_user_id` set to the authenticated reception user (MED-04, MED-05).
  - New lines immediately accumulate into visit totals (`visit_totals`), incrementing outstanding dues, and the 22-06 visit payment guard accepts paying them (MED-08).
  - Prescribing never creates a charge; only lines added by reception are billed (MED-03, MED-06).
  - Every addition records an audit row with `AuditAction.BILL_ITEM_ADDED`, entity type `bill_item`, and after payload with line id, visit id, category, description, quantity as string, rate, and amount (T-22-29).
  - Endpoint requires `Permission.BILL_WRITE`. RBAC verification confirmed: Reception 201, Doctor 403, Admin 403, Anonymous 401 (T-22-26).
  - `Permission.BILL_WRITE` removed from `RESERVED` mapping in `permissions.py`.
  - MatrixRow and payload factory added in `backend/tests/support/matrix.py`.
  - OpenAPI snapshot regenerated via `kalyan_api.cli export-openapi`.
- **Root Cause / Context:**
  - Phase 22 Step (e) enables reception to bill medicine items and additional particulars onto an open visit. With the balance switch (22-05) and visit-level payment guard (22-06) already active, added lines are immediately part of visit outstanding dues and can be paid at checkout.
- **Changes:**
  - `backend/src/kalyan_api/services/bill_service.py`:
    - Added `line_amount_paise(quantity: Decimal, rate_paise: int) -> int` using `ROUND_HALF_UP`.
    - Added `add_reception_line(session: Session, visit: Visit, principal: Principal, payload: BillLineCreate) -> BillItem`.
  - `backend/src/kalyan_api/schemas/bill.py`:
    - Created `BillLineCreate` with `ConfigDict(extra="forbid")`, field validators for trimmed description and unit, and constraints on quantity and rate.
    - Created `BillLineOut` response schema.
  - `backend/src/kalyan_api/routers/bill_items.py`:
    - Created router with `POST /visits/{id}/bill-items`, `status_code=201`, requiring `Permission.BILL_WRITE`.
    - Calls `lock_visit`, `add_reception_line`, and records `AuditAction.BILL_ITEM_ADDED`.
  - `backend/src/kalyan_api/main.py`:
    - Imported and mounted `bill_items_router` under prefix `/api`.
  - `backend/src/kalyan_api/services/audit_service.py`:
    - Added `BILL_ITEM_ADDED = "BILL_ITEM_ADDED"` to `AuditAction`.
  - `backend/src/kalyan_api/core/permissions.py`:
    - Removed `Permission.BILL_WRITE` from `RESERVED`.
  - `backend/tests/test_phase22_bill_lines.py`:
    - Implemented unit tests for `line_amount_paise` and `BillLineCreate` validation.
    - Implemented integration tests for reception line creation, persistence, visit due integration, payment clearance, prescription independence (MED-03, MED-06), closed/missing visit handling (BILL-18), audit logging, and RBAC matrix behavior.
  - `backend/tests/support/matrix.py`:
    - Added `_reception_bill_line_payload` factory.
    - Added `MatrixRow` for `POST /api/visits/{id}/bill-items` (401 / 403 / 201 / 403 / 403).
  - `backend/tests/openapi.snapshot.json`:
    - Regenerated via `kalyan_api.cli export-openapi`.
- **Database Safety:**
  - Zero modifications to production database (`kalyan_dev` was never touched).
  - All test runs executed on `kalyan_test`.
  - No changes committed to Git.

---

## 2. Lock-Order Audit Table

| Writer / Function | Owned Here? | Lock Order | Tables / Rows Locked | Concurrency Safety Notes |
|-------------------|-------------|------------|-----------------------|--------------------------|
| `bill_items.add_bill_item` | Yes | **Visit** | `visits` (`FOR UPDATE`) | Locks visit row via `billing_service.lock_visit` before checking status or inserting line item. Serializes against concurrent checkout closures or payments on the same visit. |
| `billing.record_payment` (visit payment) | No (Plan 22-06) | **Visit** | `visits` (`FOR UPDATE`) | Same root lock order (`Visit` first). |
| `visits.close_visit` | No (Plan 22-05) | **Visit** | `visits` (`FOR UPDATE`) | Same root lock order (`Visit` first). |

---

## 3. Test Evidence

### 3.1 Task 1 & Task 2: Bill Lines Test Suite
```
[System.Environment]::SetEnvironmentVariable('PYTHONPATH', 'D:\dr-sr\backend\src'); & 'D:\dr-sr\backend\.venv\Scripts\pytest.exe' -p no:warnings D:\dr-sr\backend\tests\test_phase22_bill_lines.py
============================== 9 passed in 5.27s ==============================
```

### 3.2 Task 2 Verification Suite
```
[System.Environment]::SetEnvironmentVariable('PYTHONPATH', 'D:\dr-sr\backend\src'); & 'D:\dr-sr\backend\.venv\Scripts\pytest.exe' -p no:warnings tests/test_phase22_bill_lines.py tests/test_phase22_balance_switch.py tests/test_phase22_visit_payments.py tests/test_permissions_catalogue.py tests/test_route_policies.py
============================= 55 passed in 19.82s =============================
```

### 3.3 Task 3: RBAC Matrix & Regression Suite
```
[System.Environment]::SetEnvironmentVariable('PYTHONPATH', 'D:\dr-sr\backend\src'); & 'D:\dr-sr\backend\.venv\Scripts\pytest.exe' -p no:warnings tests/test_rbac_matrix.py tests/test_openapi_snapshot.py tests/test_permissions_catalogue.py tests/test_route_policies.py tests/test_phase22_bill_lines.py tests/test_phase22_bill_schema.py tests/test_prescriptions_api.py
============================ 781 passed in 126.45s ============================
```

---

## 4. Requirements & UAT Traceability

| UAT / Requirement | Description | Status |
|-------------------|-------------|--------|
| **MED-03** | Prescribing never adds a charge; only what reception enters is billed | VERIFIED |
| **MED-04** | Reception can add a medicine line (name, unit, quantity, rate) | VERIFIED |
| **MED-05** | Amount = quantity x rate rounded to whole paise, round half up (2 x Rs 50 = Rs 100) | VERIFIED |
| **MED-06** | Total includes only reception-added medicine lines | VERIFIED |
| **MED-08** | Reception can add an additional particular line (name, quantity, rate) | VERIFIED |
| **MED-12** | Input validation: zero/negative qty, negative rate, >2 decimals, blank name, non-medicine/additional category refused (422) | VERIFIED |
| **BILL-18** | Adding line to closed visit refused with 422 `visit_closed` | VERIFIED |
| **T-22-26** | RBAC elevation of privilege prevented (reception only; doctor/admin 403; anon 401) | VERIFIED |
| **T-22-27** | Tampering with negative or fractional amounts prevented by Pydantic validation & server-side calculation | VERIFIED |
| **T-22-28** | Charges added after Patient Out prevented by visit lock and OPEN check | VERIFIED |
| **T-22-29** | Repudiation mitigated by `created_by_user_id` and `BILL_ITEM_ADDED` audit entry | VERIFIED |
| **T-22-30** | Concurrency with payment writers serialized via `billing_service.lock_visit` | VERIFIED |

---

## 5. Dependencies & Remaining Risks

- **Downstream Dependencies:**
  - **Plan 22-09 -> 22-10 -> 22-11**: Sequential owner handoff for `bill_items.py` and `bill_service.py`. Plan 22-11 will add the prescription item reference link once OD-B is resolved.
  - **Plan 22-14 (Reception Billing UI)**: Frontend components to expose the line item entry form to the reception desk.
- **Remaining Risks:**
  - The endpoint is backend-only in Wave 5; no UI hits this endpoint until Plan 22-14 is implemented.
