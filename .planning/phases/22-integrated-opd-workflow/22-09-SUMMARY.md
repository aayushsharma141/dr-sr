# Phase 22 Plan 09 Summary: Visit Bill View API, Checkout Token Numbers and Completion Time

**Plan:** 22-09  
**Status:** IMPLEMENTED — NOT VERIFIED  
**Task IDs:** T22-08, T22-09, LED-03, LED-04, LED-05, LED-06, LED-07  

---

## 1. AGENTS.md Governance Report

- **Task ID:** 22-09 (T22-08, T22-09)
- **Owned Files:**
  - `backend/src/kalyan_api/routers/bill_items.py`
  - `backend/src/kalyan_api/schemas/bill.py`
  - `backend/src/kalyan_api/services/billing_service.py`
  - `backend/src/kalyan_api/routers/visits.py`
  - `backend/src/kalyan_api/schemas/visits.py`
  - `backend/tests/test_phase22_bill_view.py`
  - `backend/tests/test_reception_visits_schema.py`
  - `backend/tests/support/matrix.py`
  - `backend/tests/openapi.snapshot.json`
- **Git Checkpoint:**
  - Checkpoint stash: `stash@{0}: checkpoint: before 22-09 bill view`
  - Working tree and index untouched; untracked files preserved; zero commits made to git.
  - kalyan_dev untouched; all tests run on kalyan_test.
- **Findings:**
  - `GET /api/visits/{id}/bill` implemented requiring `Permission.VISIT_READ` (Admin: 200, Reception: 200, Doctor: 403, Anonymous: 401, Unknown visit: 404).
  - Bill breakdown returns the five fixed OD-22-14 sections: `CONSULTATION`, `PROCEDURE`, `PACKAGE`, `MEDICINE`, `ADDITIONAL` with their active lines and counted subtotals.
  - Section subtotals and `bill_total_paise` derive from unified `billing_service.counts_toward_total`, guaranteeing that section subtotals and visit-level balances never drift (T-22-33).
  - Lines of cancelled consultations are excluded from charges (rule ii).
  - Voided lines are returned separately under `voided_lines` with void reason, staff username, and timestamp; they never count toward totals or sections.
  - History per line is loaded from `bill_item_adjustments` (oldest first, with actor username, old/new amounts, reason, kind).
  - Previous dues of closed visits with `due_paise > 0` are returned under `previous_dues` with `previous_dues_total_paise`, never added to `bill_total_paise` (OD-22-17).
  - Package summaries are returned under `packages` (LED-03..07, OD-C), tracking total, completed, and remaining sessions, agreed price, paid, and balance, with zero clinical fields exposed (D-04, T-22-32).
  - Checkout list summary (`VisitSummary`) extended with `token_numbers` (non-cancelled consultations in check-in order) and `last_completed_at` (latest `status_updated_at` among completed consultations).
  - Safety of `last_completed_at` proxy confirmed: inspected all writers of `status_updated_at` (`complete_consultation`, `validate_status_update`, `reassign_consultation`, `check_in`, `reschedule_booking`). None can modify an appointment after it reaches `consultation_status == 'COMPLETED'` because `CONSULTATION_TRANSITIONS[COMPLETED]` is an empty set, `complete_consultation` returns early on COMPLETED, reassignments require `WAITING`, and rescheduling requires `BOOKED`. Therefore `status_updated_at` on a completed consultation is frozen at the moment of completion.
- **Root Cause:**
  - Step (e) read slice: the Billing & Checkout UI panel in 22-13 requires a single consolidated bill endpoint providing sections, subtotals, adjustment history, voided items, earlier dues, and treatment package tracking, plus token numbers and completion times on visit list rows.
- **Changes:**
  - `backend/src/kalyan_api/schemas/bill.py`:
    - Defined `BillLineHistoryOut`, `BillLineOut` (enhanced with history, counts_toward_total, void metadata, computed properties), `BillSectionOut`, `BillPaymentOut`, `PreviousDueOut`, `PackageInfoOut`, and `VisitBillOut`.
  - `backend/src/kalyan_api/services/billing_service.py`:
    - Updated `counts_toward_total` to flexibly accept line objects or individual fields.
    - Added `patient_previous_dues(session, patient_id, exclude_visit_id)` querying closed visits with outstanding balance.
    - Added `patient_package_summaries(session, patient_id)` querying active/completed treatment plans, calculating session and payment balances with clinical diagnosis excluded.
  - `backend/src/kalyan_api/routers/bill_items.py`:
    - Implemented `GET /visits/{id}/bill` with `require(Permission.VISIT_READ)`.
  - `backend/src/kalyan_api/schemas/visits.py`:
    - Added `token_numbers: list[int]` and `last_completed_at: datetime | None` to `VisitSummary`.
  - `backend/src/kalyan_api/routers/visits.py`:
    - In `_to_summaries`, batched appointment queries to populate `token_numbers` and `last_completed_at`.
  - `backend/tests/support/matrix.py`:
    - Added MatrixRow for `GET /api/visits/{id}/bill` (401 / 200 / 200 / 403 / 403).
  - `backend/tests/openapi.snapshot.json`:
    - Regenerated OpenAPI snapshot matching updated schemas and endpoints.
  - Tests:
    - Added `backend/tests/test_phase22_bill_view.py` (10 tests covering grouping, subtotals, cancelled exclusion, voided items, history, previous dues, package tracking, and authorization).
    - Updated `backend/tests/test_reception_visits_schema.py` (3 tests for token numbers and completion time).
- **Test Commands & Results:**
  - Task 1 & 2 tests:
    `$env:PYTHONPATH="D:/dr-sr/backend/src"; backend/.venv/Scripts/python.exe -m pytest -p no:warnings backend/tests/test_phase22_bill_view.py backend/tests/test_phase22_balance_switch.py`
    -> **32 passed in 10.89s**
  - Task 3 schema tests:
    `$env:PYTHONPATH="D:/dr-sr/backend/src"; backend/.venv/Scripts/python.exe -m pytest -p no:warnings backend/tests/test_reception_visits_schema.py`
    -> **14 passed in 3.10s**
  - Full verification suite:
    `$env:PYTHONPATH="D:/dr-sr/backend/src"; backend/.venv/Scripts/python.exe -m pytest -p no:warnings backend/tests/test_reception_visits_schema.py backend/tests/test_visit_checkout_api.py backend/tests/test_phase22_bill_view.py backend/tests/test_rbac_matrix.py backend/tests/test_openapi_snapshot.py backend/tests/test_route_policies.py`
    -> **784 passed in 133.52s**
  - Additional related tests:
    `$env:PYTHONPATH="D:/dr-sr/backend/src"; backend/.venv/Scripts/python.exe -m pytest -p no:warnings backend/tests/test_phase22_bill_lines.py backend/tests/test_treatment_plans_api.py backend/tests/test_treatment_sessions_api.py backend/tests/test_permissions_catalogue.py`
    -> **30 passed in 7.13s**
- **Dependencies:**
  - Upstream: 22-08 (bill lines POST endpoint and schemas), 22-05 (visit_totals).
  - Downstream: 22-10 (fee adjustments), 22-13 (Billing & Checkout bill panel UI).
- **Remaining Risks:**
  - None detected for the read endpoints. Frontend integration occurs in Plan 22-13.

---

## 2. Final `VisitBillOut` Schema Field List (for Plan 22-13 UI)

```typescript
interface VisitBillOut {
  visit_id: number;
  patient_id: number;
  patient_urn?: string | null;
  patient_name?: string | null;
  status: string; // e.g. "OPEN", "CLOSED", "CANCELLED"
  visit_date: string; // YYYY-MM-DD
  closed_at?: string | null;
  close_reason?: string | null;
  locked: boolean; // true if status !== "OPEN"
  sections: BillSectionOut[]; // 5 categories in fixed order
  bill_total_paise: number;
  paid_paise: number;
  due_paise: number;
  payments: BillPaymentOut[];
  voided_lines: BillLineOut[];
  previous_dues: PreviousDueOut[];
  previous_dues_total_paise: number;
  packages: PackageInfoOut[];
}

interface BillSectionOut {
  category: "CONSULTATION" | "PROCEDURE" | "PACKAGE" | "MEDICINE" | "ADDITIONAL";
  subtotal_paise: number;
  lines: BillLineOut[];
}

interface BillLineOut {
  id: number;
  visit_id: number;
  appointment_id?: number | null;
  category: string;
  source: "DOCTOR" | "RECEPTION" | "SYSTEM";
  description: string;
  unit?: string | null;
  quantity: string | number; // Decimal formatted
  rate_paise: number;
  amount_paise: number;
  original_amount_paise: number;
  status: "ACTIVE" | "VOIDED";
  counts_toward_total: boolean;
  created_by_user_id: number;
  created_by_username?: string | null;
  created_at: string;
  history: BillLineHistoryOut[];
  void_reason?: string | null;
  voided_by_user_id?: number | null;
  voided_by_username?: string | null;
  voided_at?: string | null;
  staff?: string | null; // computed alias
  voided_by?: string | null; // computed alias
}

interface BillLineHistoryOut {
  id: number;
  bill_item_id: number;
  kind: "DISCOUNT" | "WAIVER" | "CORRECTION" | "VOID";
  old_quantity?: string | number | null;
  new_quantity?: string | number | null;
  old_rate_paise?: number | null;
  new_rate_paise?: number | null;
  old_amount_paise: number;
  new_amount_paise: number;
  reason: string;
  actor_user_id: number;
  actor_username?: string | null;
  created_at: string;
  old: number; // computed alias for old_amount_paise
  new: number; // computed alias for new_amount_paise
  actor?: string | null; // computed alias for actor_username
}

interface BillPaymentOut {
  id: number;
  visit_id?: number | null;
  appointment_id?: number | null;
  receipt_number: string;
  amount_paise: number;
  payment_method: string;
  is_reversed: boolean;
  created_at: string;
  created_by_username?: string | null;
}

interface PreviousDueOut {
  visit_id: number;
  visit_date: string;
  doctor_names: string[];
  balance_paise: number;
  balance: number; // computed alias
  due_paise: number; // computed alias
}

interface PackageInfoOut {
  treatment_plan_id: number;
  plan_name: string;
  status: string;
  total_sessions: number;
  completed_sessions: number;
  remaining_sessions: number;
  agreed_price_paise: number;
  paid_paise: number;
  balance_paise: number;
}
```

---

## 3. Checkout List Fields Added to `VisitSummary`

```typescript
interface VisitSummary extends VisitRead {
  doctors: string[];
  completed_consultations: number;
  active_consultations: number;
  outstanding_paise: number;
  token_numbers: number[]; // Check-in order, non-cancelled consultations
  last_completed_at?: string | null; // Latest completion timestamp among completed consultations
}
```
