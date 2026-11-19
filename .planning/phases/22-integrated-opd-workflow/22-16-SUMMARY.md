# Phase 22 Plan 16 Summary: Doctor Charges Panel on Consultation Page and Free Follow-Up Scenario

**Plan:** 22-16  
**Status:** IMPLEMENTED — NOT VERIFIED  
**Task IDs:** T22-10, FEE-03, FEE-04, SCENARIO-02  

---

## 1. AGENTS.md Governance Report

- **Task ID:** 22-16 (T22-10, FEE-03, FEE-04, SCENARIO-02)
- **Owned Files:**
  - `frontend/src/api/doctorCharges.ts` (new)
  - `frontend/src/components/billing/DoctorChargesPanel.tsx` (new)
  - `frontend/src/components/__tests__/doctor-charges-panel.test.tsx` (new)
  - `frontend/src/pages/ClinicalEncounterWorkspace.tsx` (modified, only Phase 22 owner)
  - `frontend/src/pages/__tests__/clinical-encounter-workspace.test.tsx` (modified)
  - `backend/tests/test_phase22_scenario02.py` (new)
- **Git Checkpoint:**
  - Checkpoint stash: `checkpoint: before 22-16 doctor charges panel` (stored in stash history).
  - Working tree and index untouched; no commits created; zero database resets (kalyan_dev untouched, all backend tests run on kalyan_test).
- **Findings:**
  - Built doctor charges panel (`DoctorChargesPanel.tsx`) matching the light consultation theme (19-UI-SPEC) and phase spacing/typography scale.
  - Consultation fee presented read-only as `"₹X.XX, billed at check-in"` (OD-22-10, S6).
  - Own doctor procedure and package lines listed with `"quantity × rate = amount"` and `"Doctor"` tag; empty copy `"No charges added for this consultation yet."` rendered when no charges exist.
  - Strict doctor view isolation (Q13, OD-22-19): NO payment or collect controls, NO visit total or dues, NO reception lines, NO lines from other doctors.
  - Locked when visit is closed (`isVisitClosed === true`): action buttons hidden, panel is read-only.
  - Fee adjustment modal built per OD-22-11 offering Discount and Waive only (no Correct for doctors per backend rules):
    - Discount requires reduced amount (less than current fee) and mandatory reason (3-500 chars).
    - Waive posts `{ kind: "WAIVER", new_amount_paise: 0, reason }` and displays `"Waived"` badge with `"₹0.00, billed at check-in"`.
    - Character counter (`X / 500`) and client-side validation enforcing 3-500 characters.
    - S6 history copy: `"Original ₹X → Revised ₹Y · {reason} · {you} · {time}"`.
    - Server errors (e.g. 422 `adjustment_below_paid`) surfaced in persistent `InlineAlert`.
  - Add charge modal built supporting two modes:
    - Procedure / Service mode: description, quantity, rate, unit with live quantity × rate preview (OD-E).
    - Package mode: lists patient's treatment plans (via `usePatientTreatmentPlans`), zero amount input, disclaims `"Package (information only)"` (OD-C).
    - Available while visit is open, including after consultation is completed (B3, owner 2026-11-16).
    - Doctor void: strictly NO doctor void or remove button rendered (Option A from Plan 22-10).
  - Mounted `DoctorChargesPanel` in the consultation page aside (`ClinicalEncounterWorkspace.tsx`) using `effectiveAppointmentId` (from existing encounter or URL param `appointment_id`).
  - Backend end-to-end scenario (SCENARIO-02, `test_phase22_scenario02.py`):
    - Existing patient checks in as `FOLLOW_UP`; consultation line is created with standard fee (FEE-02, OD-22-05: visit type does not automatically discount or zero the fee).
    - Doctor completes consultation (`COMPLETED`), then waives own fee with clinical reason.
    - Visit outstanding balance drops to 0.
    - Patient Out (`POST /api/visits/{id}/close`) succeeds without an unpaid balance reason and marks visit `CLOSED`.
    - Reception bill view shows waiver history and zero ledger dues.
- **Root Cause / Motivation:**
  - OPD workflow step (e), doctor slice: doctors need to see their own consultation fee, record clinical procedures or link treatment package references during or after consultation, and discount or waive their fee for free follow-up visits (OD-22-12, FEE-03, FEE-04, SCENARIO-02).
- **Changes:**
  - `frontend/src/api/doctorCharges.ts`:
    - Defined types: `DoctorChargesOut`, `DoctorLineCreate`, `FeeAdjustmentRequest`, `FeeAdjustmentOut`.
    - Implemented TanStack Query hooks: `useDoctorCharges(appointmentId)`, `useAdjustOwnFee(appointmentId)`, `useAddDoctorCharge(appointmentId)`.
  - `frontend/src/components/billing/DoctorChargesPanel.tsx`:
    - Implemented light-themed panel with consultation fee line, S6 adjustment history display, Waived badge, procedure and package list, and modal dialogs for Adjust Fee and Add Charge.
  - `frontend/src/pages/ClinicalEncounterWorkspace.tsx`:
    - Imported `DoctorChargesPanel` and mounted it in `<aside data-testid="persistent-side-panel">` using `effectiveAppointmentId`.
  - `frontend/src/components/__tests__/doctor-charges-panel.test.tsx`:
    - 15 comprehensive unit tests covering read-only fee, procedure listing, empty state, Q13 isolation, closed visit read-only behavior, fee discount, fee waiver, reason counter/validation, server error alerts, procedure addition with preview, package mode, and absence of doctor void control.
  - `frontend/src/pages/__tests__/clinical-encounter-workspace.test.tsx`:
    - Added tests for `DoctorChargesPanel` mounting in the aside across `/doctor/encounters/:id` and `/doctor/encounters/new?appointment_id=5&patient_id=101`.
  - `backend/tests/test_phase22_scenario02.py`:
    - End-to-end integration test executing check-in as FOLLOW_UP, fee creation, doctor waiver, visit balance clearance, Patient Out close without balance reason, bill waiver history, and ledger zero dues.
- **Test Commands & Results:**
  - Frontend component tests:
    `Set-Location -Path "frontend"; npx.cmd vitest run src/components/__tests__/doctor-charges-panel.test.tsx src/pages/__tests__/clinical-encounter-workspace.test.tsx src/test/guards/guards.test.ts`
    -> **49 passed in 8.63s**
  - Frontend typecheck & lint:
    `Set-Location -Path "frontend"; npm.cmd run typecheck; npm.cmd run lint`
    -> **0 errors**
  - Backend scenario and regression suite:
    `$env:PYTHONPATH="D:/dr-sr/backend/src"; backend/.venv/Scripts/python.exe -m pytest -p no:warnings backend/tests/test_phase22_scenario02.py backend/tests/test_phase22_fee_adjustment.py backend/tests/test_phase22_doctor_lines.py -v`
    -> **25 passed in 8.44s**
- **Dependencies:**
  - Upstream: 22-06 (fee adjustment API), 22-10 (bill line void / decision iv option-a), 22-12 (doctor lines API).
  - Downstream: 22-20 (end-to-end manual verification on `:8000`).
- **Remaining Risks:**
  - Manual UI verification on `:8000` is deferred to Phase 22 Plan 20 per wave structure; status reported as `IMPLEMENTED — NOT VERIFIED`.

---

## 2. UAT Requirements Satisfied

- **FEE-03:** Doctor reduces or discounts own consultation fee with a reason from the consultation page panel; panel displays revision history.
- **FEE-04:** Doctor waives own fee with a mandatory clinical reason; line displays ₹0.00 and Waived badge.
- **SCENARIO-02:** Free follow-up consultation verified end-to-end via check-in at standard fee, doctor waiver, 0 balance due, and Patient Out closure without balance reason.
