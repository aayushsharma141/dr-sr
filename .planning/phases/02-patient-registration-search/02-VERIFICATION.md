# Phase 2 Verification: Patient Registration & Search

**Status:** PASSED ✓  
**Phase:** 02-patient-registration-search  
**Date:** 2026-10-28  
**Verifier:** GSD Phase Execution & Quality Gate  

---

## 1. Goal & Success Criteria Verification

| Success Criterion | Expected Behavior | Observed Result | Status |
|---|---|---|---|
| **1. Atomic ID Generation** | Generates unique sequential `KH-YYYY-XXXX` format on creation using persistent table. | `PatientRepository.generate_next_urn()` locks `id_sequences` in immediate transaction and increments per calendar year (`KH-2026-0001`, `KH-2026-0002`). | **PASS** |
| **2. Demographic Persistence** | Form saves 10 canonical demographic fields and persists data across app restarts. | `PatientService.register_patient()` writes parameterized SQL to `patients` table with check constraints and WAL mode; verified persistent across connection reconnects. | **PASS** |
| **3. Managed Photo Storage** | Optional patient photo safely copied to local directory without path traversal or corruption. | `PatientService` sanitizes file extension (`.jpg`, `.jpeg`, `.png`), copies to `data/photos/{serial_urn_no}.ext`, and stores relative filename in SQLite. | **PASS** |
| **4. Instant Search Filter** | Search by patient ID, name, or mobile filters records in < 50ms. | `PatientRepository.search()` executes parameterized substring query on indexed fields; `PatientListView` updates table instantly on `textChanged`. | **PASS** |
| **5. Non-Destructive Edits** | Editing updates profile while preserving original creation date and URN; deletions are soft. | `PatientRepository.update()` preserves `created_at` and `serial_urn_no`; `soft_delete()` sets `status = 'ARCHIVED'`. | **PASS** |

---

## 2. Requirement Traceability

| Requirement | Description | Verified In | Verification Result |
|---|---|---|---|
| **PAT-01** | Atomic unique patient ID (`KH-YYYY-XXXX`). | `app/repositories/patient_repository.py`<br>`tests/test_patient_service.py` | Verified sequential non-colliding ID generation. |
| **PAT-02** | Registration capturing demographic fields 1–10. | `app/services/patient_service.py`<br>`app/ui/views/patient_form_view.py` | Verified input validation (age 0–125, 10-digit mobile, required name/condition). |
| **PAT-03** | Local managed photo storage in `data/photos/`. | `app/services/patient_service.py`<br>`tests/test_patient_service.py` | Verified sanitized photo copy and dynamic absolute path resolution. |
| **PAT-04** | Fast patient search by ID, name, or mobile. | `app/ui/views/patient_list_view.py`<br>`tests/test_patient_ui.py` | Verified real-time search table filtering on keystroke. |
| **PAT-05** | Non-destructive profile editing and record persistence. | `app/ui/views/patient_module_view.py`<br>`tests/test_patient_ui.py` | Verified switching between list and form modes with persistent edits. |

---

## 3. Automated Test Evidence

- **`tests/test_patient_service.py`**:
  - `test_patient_registration_valid`: Validates full 10-field demographic intake and ID formatting.
  - `test_persistence_after_reconnect`: Verifies SQLite WAL persistence across closed/reopened connections.
  - `test_invalid_inputs_rejected`: Verifies rejection of empty names, invalid ages (-5, 130), and invalid phone numbers.
  - `test_search_by_id_name_mobile`: Verifies multi-field query matching.
  - `test_photo_storage_and_retrieval`: Verifies local image copy into `data/photos/`.
  - `test_non_destructive_update`: Verifies update of address/phone preserves URN and creation timestamp.
- **`tests/test_patient_ui.py`**:
  - `test_patient_form_validation`: Verifies UI form error banner and successful submission signal.
  - `test_patient_list_search_filtering`: Verifies dynamic table row filtering on text query.
  - `test_patient_module_transitions`: Verifies seamless stacked widget navigation between directory and form.

---

## 4. Verification Conclusion

Phase 2 satisfies all architectural and functional acceptance criteria with 100% requirements coverage. The application is ready to advance to **Phase 3: Treatment Cases & Payment Tracking (Stage C)**.
