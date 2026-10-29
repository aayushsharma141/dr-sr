# Phase 2 Summary: Patient Registration & Search

**Completed:** 2026-10-28  
**Phase Status:** Complete ✓  
**Requirements Delivered:** `PAT-01`, `PAT-02`, `PAT-03`, `PAT-04`, `PAT-05`  

---

## 1. What Was Delivered

1. **Atomic Sequential Patient ID Generation (`PAT-01`):**
   - Implemented `generate_next_urn()` in `PatientRepository` backed by `id_sequences` table.
   - Atomically increments sequence per year and generates unique, human-readable IDs formatted as `KH-YYYY-XXXX` (e.g., `KH-2026-0001`).
   - Zero ID collisions under rapid concurrent intake.

2. **Patient Demographics & Business Validation (`PAT-02`):**
   - Implemented `PatientService` validating:
     - Full Name (required, non-empty, max 150 chars).
     - Age (integer, bounded between 0 and 125).
     - Sex (`Male`, `Female`, `Other`).
     - Mobile Number (strictly validates 10 digits).
     - Patient Condition / Diagnosis (required).
     - Address, Referral Source, In/Out timestamps.
   - Rejects invalid inputs with structured `ValidationError` messages.

3. **Managed Local Photo Storage (`PAT-03`):**
   - Implemented local image copying to `data/photos/{serial_urn_no}.{ext}`.
   - Whitelists safe formats (`.jpg`, `.jpeg`, `.png`) and sanitizes destination paths.
   - Resolves absolute photo path dynamically on retrieval.

4. **Instant Multi-Field Search (`PAT-04`):**
   - Implemented real-time substring search in `PatientRepository.search()`.
   - Filters records by Serial / URN, Patient Name, or Mobile Number simultaneously.
   - `PatientListView` updates table results dynamically on `textChanged`.

5. **Non-Destructive Editing & Profile Management (`PAT-05`):**
   - Supports editing existing patient details while preserving creation timestamps and original URN.
   - Deletions are strictly implemented as soft-deletes (`status = 'ARCHIVED'`).
   - `PatientModuleView` manages switching between the directory list and registration/edit form.

6. **Automated Test Matrix:**
   - `tests/test_patient_service.py`: 6 test cases verifying valid registration, persistence across reconnects, invalid input rejections, search filtering, photo file storage, and updates.
   - `tests/test_patient_ui.py`: 3 UI test cases verifying form validation, table row filtering, and module transitions.

---

## 2. Requirements Traceability

| Requirement ID | Description | Status | Verification Reference |
|---|---|---|---|
| **PAT-01** | Atomic unique patient ID generation (`KH-YYYY-XXXX`). | Complete ✓ | `tests/test_patient_service.py` |
| **PAT-02** | Patient registration capturing demographic fields 1–10. | Complete ✓ | `tests/test_patient_service.py` |
| **PAT-03** | Local managed photo storage in `data/photos/`. | Complete ✓ | `tests/test_patient_service.py` |
| **PAT-04** | Fast patient search by ID, name, or mobile number. | Complete ✓ | `tests/test_patient_ui.py` |
| **PAT-05** | Non-destructive profile editing and record persistence. | Complete ✓ | `tests/test_patient_ui.py` |

---

## 3. Next Milestone

**Phase 3: Treatment Cases & Payment Tracking (Stage C)**
- Create relational `treatment_cases`, `treatment_sessions`, and `payments` tables.
- Implement currency-safe `BillingService` operating in integer paise.
- Build Treatment Case History view and dated clinical session logger.
- Build Billing & Payment Ledger view with dynamic balance calculation.
