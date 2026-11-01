# Phase 12 Manual Checks

## M-12-01: Registration Card Print Layout (PRN-01)
Description: In Reception, open Registration Card preview for a registered patient and check A4 print view.
Verification:
- Bilingual header (English & Hindi) matches clinic settings.
- Barcode and bold atomic URN (`KH-YYYY-XXXX`) are clearly visible.
- Demographics grid displays guardian name, gender, age, mobile, address, and district.
- Prominent allergy warning box rendered.
- Dual signature section present: `Patient / Attendant Signature` and `Authorized Signatory`.
Result: PASS

## M-12-02: Duplicate Patient Warning & Override Checkbox (PAT-04)
Description: In Reception patient registration, enter name and mobile of existing patient.
Verification:
- Real-time debounced warning alert appears displaying existing patient's URN, full name, and registration date.
- Submit button requires "Confirm this is a different patient" checkbox before allowing submission.
Result: PASS

## M-12-03: Patient Photo Upload & Authenticated Streaming (PAT-05)
Description: Upload patient photo during registration and test access control.
Verification:
- Photo thumbnail renders in directory and patient profile.
- Unauthenticated access directly to `GET /api/patients/{id}/photo` returns 401 Unauthorized.
- Reception and authorized staff sessions successfully stream photo binary.
Result: PASS
