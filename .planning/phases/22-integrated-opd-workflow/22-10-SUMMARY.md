# Phase 22 Plan 10 Summary: Bill Line Void API, Admin Void Route, Adjustment History

**Plan:** 22-10  
**Status:** IMPLEMENTED — NOT VERIFIED  
**Task IDs:** T22-08, BILL-06, OD-G, OD-22-15  

---

## 1. AGENTS.md Governance Report

- **Task ID:** 22-10 (T22-08, BILL-06)
- **Owned Files:**
  - `backend/src/kalyan_api/services/bill_service.py`
  - `backend/src/kalyan_api/routers/bill_items.py`
  - `backend/src/kalyan_api/schemas/bill.py`
  - `backend/src/kalyan_api/services/audit_service.py`
  - `backend/tests/test_phase22_bill_void.py` (new)
  - `backend/tests/support/matrix.py`
  - `backend/tests/test_rbac_matrix.py`
  - `backend/tests/openapi.snapshot.json`
- **Git Checkpoint:**
  - Checkpoint stash: `checkpoint: before 22-10 bill line void` (stored as `8f08fad38c8d96aaa0f6aa56ebcb7fba4de08a90`).
  - Working tree and index untouched; untracked files preserved; zero commits made to git.
  - kalyan_dev untouched; all testing executed on kalyan_test.
- **Findings:**
  - Implemented bill line voiding with strict audit history (`BillItemAdjustment` kind `VOID`) preventing silent deletion or overwriting (invariants 10 and 13).
  - Reception is permitted to void its own same-day lines (`source == RECEPTION`, `created_by_user_id == principal.user_id`, IST date of `created_at == ist_today()`) with a mandatory reason through `POST /api/bill-items/{id}/void` (`Permission.BILL_WRITE`).
  - Admin is permitted to void any non-consultation line on an open visit with a reason and history row through `POST /api/bill-items/{id}/admin-void` (`Permission.BILL_ADJUST`), built unconditionally per owner decision (v).
  - Consultation lines are refused for voiding through either route (`422 consultation_line_not_voidable`); fee adjustments continue through dedicated consultation fee adjustment routes.
  - Already voided lines are refused (`409 line_already_voided`).
  - Closed visits reject all voids (`422 visit_closed`) conforming to owner decision (iii) (no edits after Patient Out, including admin).
  - Paid guard enforced: a void that would drop visit bill total below paid is refused (`422 void_below_paid`, details `visit_paid_paise`).
  - Strict lock order maintained: visit row locked first via `billing_service.lock_visit`, then line row locked `with_for_update()`, preventing race conditions with simultaneous payment collections.
  - Voided lines remain in database with `status = 'VOIDED'`, preserving original `amount_paise` and satisfying database check constraint `void_integrity`.
  - Audit action `BILL_ITEM_VOIDED` logged with previous amount, reason, and line ID.
  - OpenAPI snapshot regenerated; route policy, permissions catalogue, and RBAC matrix fully verified.
- **Root Cause:**
  - Step (e) void slice: without a void route, erroneously entered medicine or additional particular charges could not be removed without overwriting historical database records, violating hospital invariant 10.
- **Changes:**
  - `backend/src/kalyan_api/services/bill_service.py`:
    - Implemented `void_line(session, line, principal, *, reason, own_same_day_only)` with reason validation (3-500 chars), consultation line rejection (422), non-active line rejection (409), reception own/same-day checks (403), closed visit check (422), paid threshold validation (422), `BillItemAdjustment` record insertion, and line status update.
  - `backend/src/kalyan_api/schemas/bill.py`:
    - Added `BillLineVoidRequest` schema with reason length validation (3-500 characters, whitespace trimming, `extra="forbid"`).
  - `backend/src/kalyan_api/services/audit_service.py`:
    - Added `BILL_ITEM_VOIDED = "BILL_ITEM_VOIDED"` to `AuditAction`.
  - `backend/src/kalyan_api/routers/bill_items.py`:
    - Implemented `POST /bill-items/{id}/void` with `require(Permission.BILL_WRITE)` calling `void_line` with `own_same_day_only=True`.
    - Implemented `POST /bill-items/{id}/admin-void` with `require(Permission.BILL_ADJUST)` calling `void_line` with `own_same_day_only=False`.
    - Implemented visit-first lock ordering and `BILL_ITEM_VOIDED` audit logging.
  - `backend/tests/test_phase22_bill_void.py`:
    - 13 comprehensive tests covering successful reception void, database row persistence, `BillItemAdjustment` history, `void_integrity` check, visit total reduction (BILL-06), bill view voided lines reporting, scope refusals (other user, earlier day), consultation refusal, already voided refusal, reason validation, paid guard, closed visit rejection, admin-void route and RBAC isolation, missing item 404, and direct service unit tests.
  - `backend/tests/support/matrix.py`:
    - Added `_bill_line_void_payload`.
    - Added MatrixRows for `POST /api/bill-items/{id}/void` (anon 401, admin 403, reception 200, doc_a 403, doc_b 403) and `POST /api/bill-items/{id}/admin-void` (anon 401, admin 200, reception 403, doc_a 403, doc_b 403).
  - `backend/tests/test_rbac_matrix.py`:
    - Added `/api/bill-items` resolver branch provisioning an open visit with a completed consultation and reception medicine line.
  - `backend/tests/openapi.snapshot.json`:
    - Regenerated via `kalyan_api.cli export-openapi`.
- **Test Commands & Results:**
  - Void feature suite:
    `$env:PYTHONPATH="D:/dr-sr/backend/src"; backend/.venv/Scripts/python.exe -m pytest -p no:warnings backend/tests/test_phase22_bill_void.py`
    -> **13 passed in 6.15s**
  - Verification test suite (Plan 10 Task 2 verify):
    `$env:PYTHONPATH="D:/dr-sr/backend/src"; backend/.venv/Scripts/python.exe -m pytest -p no:warnings backend/tests/test_phase22_bill_void.py backend/tests/test_phase22_bill_view.py backend/tests/test_phase22_bill_lines.py backend/tests/test_phase22_balance_switch.py backend/tests/test_phase22_bill_schema.py`
    -> **65 passed in 18.55s**
  - Full verification suite (Plan 10 verification block):
    `$env:PYTHONPATH="D:/dr-sr/backend/src"; backend/.venv/Scripts/python.exe -m pytest -p no:warnings backend/tests/test_phase22_bill_void.py backend/tests/test_phase22_bill_view.py backend/tests/test_phase22_bill_lines.py backend/tests/test_phase22_balance_switch.py backend/tests/test_phase22_visit_payments.py backend/tests/test_openapi_snapshot.py backend/tests/test_route_policies.py backend/tests/test_permissions_catalogue.py`
    -> **80 passed in 20.36s**
  - RBAC bill-items matrix cells:
    `$env:PYTHONPATH="D:/dr-sr/backend/src"; backend/.venv/Scripts/python.exe -m pytest -p no:warnings backend/tests/test_rbac_matrix.py -k "bill-items"`
    -> **15 passed in 6.07s**
  - RBAC completeness gate:
    `$env:PYTHONPATH="D:/dr-sr/backend/src"; backend/.venv/Scripts/python.exe -m pytest -p no:warnings backend/tests/test_rbac_matrix.py -k "test_matrix"`
    -> **3 passed in 2.19s**
- **Dependencies:**
  - Upstream: 22-08 (bill line creation), 22-09 (visit bill view).
  - Downstream: 22-11 (line correction route), 22-13 (Billing & Checkout void action UI).
- **Remaining Risks:**
  - Frontend UI for voiding lines will be integrated in Plan 22-13; backend API contracts and authorization boundaries are verified.

---

## 2. Recorded Decision (Task 1)

- **Selected Option:** Option A (owner, 2026-11-16)
- **Decision Contract:**
  1. **(i)** In-place correction with `CORRECTION` history row, open visit, never below paid.
  2. **(iii)** No edits after Patient Out, including admin (`422 visit_closed`).
  3. **(iv)** Doctors cannot void or correct charges.
  4. **(v)** Admin may void and change any non-consultation line on an open visit with a reason and history row through separate `bill:adjust` routes.
- **Execution:**
  - Reception void route: `POST /api/bill-items/{id}/void` (`bill:write`, OD-G).
  - Admin void route: `POST /api/bill-items/{id}/admin-void` (`bill:adjust`, owner decision (v)).

---

## 3. UAT Requirement Satisfied

- **BILL-06:** Total is the sum of active charges; a voided line is excluded from the visit total and section subtotals, appearing under `voided_lines` in `GET /api/visits/{id}/bill`.
