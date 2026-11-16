# Phase 22 Plan 11 Summary: Prescribed Medicines Reference and Bill Line Quantity/Rate Correction API

**Plan:** 22-11  
**Status:** IMPLEMENTED — NOT VERIFIED  
**Task IDs:** T22-08, MED-07, MED-09, MED-10, MED-11, OD-B, OD-E, OD-22-15  

---

## 1. AGENTS.md Governance Report

- **Task ID:** 22-11 (T22-08, MED-07, MED-09, MED-10, MED-11)
- **Owned Files:**
  - `backend/src/kalyan_api/services/bill_service.py`
  - `backend/src/kalyan_api/routers/bill_items.py`
  - `backend/src/kalyan_api/schemas/bill.py`
  - `backend/tests/test_phase22_bill_correct.py` (new)
  - `backend/tests/test_phase22_prescribed_medicines.py` (new)
  - `backend/tests/support/matrix.py`
  - `backend/tests/test_rbac_matrix.py`
  - `backend/tests/openapi.snapshot.json`
- **Git Checkpoint:**
  - Checkpoint stash: `checkpoint: before 22-11 line correction and prescribed medicines` (stored as `stash@{0}`).
  - Working tree and index untouched; untracked files preserved; zero commits made to git.
  - kalyan_dev untouched; all tests executed on kalyan_test.
- **Findings:**
  - Implemented in-place quantity and rate correction (`correct_line`) with `BillItemAdjustment` audit records (kind `CORRECTION`), satisfying hospital invariants 10 and 13.
  - Reception can correct its own same-day lines (`source == RECEPTION`, `created_by_user_id == principal.user_id`, IST date of `created_at == ist_today()`) with a mandatory reason through `POST /api/bill-items/{id}/correct` (`Permission.BILL_WRITE`).
  - Admin can correct any non-consultation line on an open visit with a reason and history row through `POST /api/bill-items/{id}/admin-correct` (`Permission.BILL_ADJUST`), built unconditionally per owner decision (v).
  - Consultation lines are refused for correction (`422 consultation_line_not_correctable`); fee adjustments continue through dedicated consultation fee adjustment routes.
  - Package lines are refused for correction (`422 package_line_not_correctable`).
  - Non-active (e.g. VOIDED) lines are refused (`409 line_not_active`).
  - Closed visits reject all corrections (`422 visit_closed`) conforming to owner decision (iii).
  - Paid guard enforced: a correction that would drop visit total below paid is refused (`422 correction_below_paid`, details `visit_paid_paise`).
  - No-change guard enforced: identical quantity and rate rejected (`422 no_change`).
  - Strict lock order maintained: visit row locked first via `billing_service.lock_visit`, then line row locked `with_for_update()`, preventing race conditions.
  - Implemented `GET /api/visits/{id}/prescribed-medicines` (`Permission.BILL_WRITE`), returning strictly `prescription_item_id`, `medicine_name`, and `form` from `AUTHORISED` prescriptions linked to visit consultations via `clinical_encounters.appointment_id`.
  - Proved strict clinical data isolation (D-04, B2, T-22-38): zero clinical keys (`dosage`, `frequency`, `duration_days`, `instructions`, `strength`, `route`, `diagnosis`, `advice`) and zero quantities are exposed to reception. Prescriptions store no quantities; reception types the supplied quantity on billing.
  - Implemented prescription link validation in `add_reception_line`: `prescription_item_id` must belong to an `AUTHORISED` prescription on the visit (or `422 prescription_item_not_on_visit`), permitted only for `MEDICINE` lines.
  - Verified MED-07: unlinked medicine lines accepted without prescription link.
  - Verified MED-09: reception cannot access clinical prescription mutation endpoints (`403`).
  - Verified MED-10: billing a linked medicine leaves prescription row and items byte-for-byte unchanged.
  - Both void endpoints (`POST /api/bill-items/{id}/void` and `POST /api/bill-items/{id}/admin-void`) integrated and verified.
  - OpenAPI snapshot regenerated; route policies, permissions catalogue, and 844 tests green.
- **Root Cause:**
  - Step (e) edit slice: without quantity/rate correction and prescribed medicine projection routes, reception could not adjust quantities of incorrectly entered items without database manipulation, nor safely view prescribed medications without exposing clinical notes or compromising permissions boundaries.
- **Changes:**
  - `backend/src/kalyan_api/services/bill_service.py`:
    - Updated `add_reception_line` to validate `prescription_item_id` belongs to an `AUTHORISED` prescription for this visit and enforce `category == MEDICINE`.
    - Implemented `correct_line(session, line, principal, *, quantity, rate_paise, reason, own_same_day_only)` with full validation, actor checks, paid threshold guards, `BillItemAdjustment` history, and line mutation.
  - `backend/src/kalyan_api/schemas/bill.py`:
    - Added `BillLineVoidRequest` schema (reason 3-500 chars, whitespace trimmed, extra="forbid").
    - Added `BillLineCorrectRequest` schema (optional quantity and rate_paise, at least one required, reason 3-500 chars, extra="forbid").
    - Added `PrescribedMedicineOut` schema (prescription_item_id, medicine_name, form only, extra="forbid").
    - Added optional `prescription_item_id` to `BillLineCreate` and `BillLineOut`.
  - `backend/src/kalyan_api/routers/bill_items.py`:
    - Implemented `POST /bill-items/{id}/void` (`BILL_WRITE`, own same-day).
    - Implemented `POST /bill-items/{id}/admin-void` (`BILL_ADJUST`, any line).
    - Implemented `POST /bill-items/{id}/correct` (`BILL_WRITE`, own same-day).
    - Implemented `POST /bill-items/{id}/admin-correct` (`BILL_ADJUST`, any line).
    - Implemented `GET /visits/{id}/prescribed-medicines` (`BILL_WRITE`, field-limited projection).
    - Added `_lock_item_and_visit` helper to enforce visit-first locking order.
    - Added `_build_line_out` helper for consistent response hydration and adjustment history.
  - `backend/tests/test_phase22_bill_correct.py`:
    - 13 comprehensive tests covering schema validation, reception quantity correction, rate correction, both quantity and rate correction, permission refusals (other user, earlier day), consultation refusal, package refusal, non-active refusal, closed visit refusal, paid threshold guard, no-change refusal, admin-correct route with RBAC isolation, missing item 404.
  - `backend/tests/test_phase22_prescribed_medicines.py`:
    - 7 comprehensive tests covering exact field projection (no clinical keys, no quantity), status filtering (DRAFT and CANCELLED excluded, AUTHORISED included), visit isolation, RBAC isolation, billing linked medicine line with typed supplied quantity, unlinked medicine line (MED-07), link validation guards, prescription route refusal for reception (MED-09), and prescription byte immutability after billing (MED-10).
  - `backend/tests/support/matrix.py`:
    - Added `_bill_line_correct_payload`.
    - Added MatrixRows for `POST /api/bill-items/{id}/correct`, `POST /api/bill-items/{id}/admin-correct`, and `GET /api/visits/{id}/prescribed-medicines`.
  - `backend/tests/openapi.snapshot.json`:
    - Regenerated via `kalyan_api.cli export-openapi`.
- **Test Commands & Results:**
  - Correct feature suite:
    `$env:PYTHONPATH="D:/dr-sr/backend/src"; backend/.venv/Scripts/python.exe -m pytest -p no:warnings backend/tests/test_phase22_bill_correct.py`
    -> **13 passed in 3.78s**
  - Prescribed medicines feature suite:
    `$env:PYTHONPATH="D:/dr-sr/backend/src"; backend/.venv/Scripts/python.exe -m pytest -p no:warnings backend/tests/test_phase22_prescribed_medicines.py`
    -> **7 passed in 2.78s**
  - Void feature suite:
    `$env:PYTHONPATH="D:/dr-sr/backend/src"; backend/.venv/Scripts/python.exe -m pytest -p no:warnings backend/tests/test_phase22_bill_void.py`
    -> **13 passed in 3.40s**
  - Task 1 verify suite:
    `$env:PYTHONPATH="D:/dr-sr/backend/src"; backend/.venv/Scripts/python.exe -m pytest -p no:warnings backend/tests/test_phase22_bill_correct.py backend/tests/test_phase22_bill_void.py backend/tests/test_phase22_bill_view.py backend/tests/test_phase22_balance_switch.py`
    -> **58 passed in 12.33s**
  - Task 2 verify suite:
    `$env:PYTHONPATH="D:/dr-sr/backend/src"; backend/.venv/Scripts/python.exe -m pytest -p no:warnings backend/tests/test_phase22_prescribed_medicines.py backend/tests/test_phase22_bill_lines.py backend/tests/test_prescriptions_api.py backend/tests/test_prescription_lifecycle.py backend/tests/test_permissions_catalogue.py`
    -> **37 passed in 6.11s**
  - RBAC matrix bill-items and prescribed-medicines cells:
    `$env:PYTHONPATH="D:/dr-sr/backend/src"; backend/.venv/Scripts/python.exe -m pytest -p no:warnings backend/tests/test_rbac_matrix.py -k "bill-items or prescribed-medicines"`
    -> **30 passed in 6.35s**
  - Full verification suite:
    `$env:PYTHONPATH="D:/dr-sr/backend/src"; backend/.venv/Scripts/python.exe -m pytest -p no:warnings backend/tests/test_phase22_bill_correct.py backend/tests/test_phase22_prescribed_medicines.py backend/tests/test_phase22_bill_void.py backend/tests/test_phase22_bill_lines.py backend/tests/test_phase22_bill_view.py backend/tests/test_prescriptions_api.py backend/tests/test_prescription_lifecycle.py backend/tests/test_rbac_matrix.py backend/tests/test_openapi_snapshot.py backend/tests/test_permissions_catalogue.py`
    -> **844 passed in 114.01s**
- **Dependencies:**
  - Upstream: 22-08 (bill line creation), 22-09 (visit bill view), 22-10 (void API).
  - Downstream: 22-14 (Bill line actions UI: add medicine/particular, void, change, admin fee correction).
- **Remaining Risks:**
  - Frontend UI for line correction and prescribed medicines reference selection will be integrated in Plan 22-14.
  - The least-exposure reading of "prescribed medicine" in OD-B/B2 limits the reference list to `AUTHORISED` prescriptions; `DRAFT` (not yet prescribed) and `CANCELLED` (no longer active) prescriptions are excluded.

---

## 2. Final Route Names for Plan 22-14

| Route | Method | Permission | Description |
|---|---|---|---|
| `/api/bill-items/{id}/void` | POST | `Permission.BILL_WRITE` | Reception voids own same-day bill line |
| `/api/bill-items/{id}/admin-void` | POST | `Permission.BILL_ADJUST` | Admin voids any non-consultation line |
| `/api/bill-items/{id}/correct` | POST | `Permission.BILL_WRITE` | Reception corrects quantity/rate of own same-day line |
| `/api/bill-items/{id}/admin-correct` | POST | `Permission.BILL_ADJUST` | Admin corrects quantity/rate of any non-consultation line |
| `/api/visits/{id}/prescribed-medicines` | GET | `Permission.BILL_WRITE` | Reception reads name and form of authorised prescribed items |

---

## 3. UAT Requirements Satisfied

- **MED-07:** Typed medicine line accepted without prescription link.
- **MED-09:** Reception cannot access clinical prescription mutation endpoints.
- **MED-10:** Billing a linked medicine leaves prescription and items unchanged.
- **MED-11:** Quantity/rate correction recomputes line amount and visit total, preserving history row with kind CORRECTION, old/new values, reason, actor, and time.
