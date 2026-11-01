# Phase 12 Manual Verification Checks

**Date:** 2026-11-01  
**Environment:** Chrome DevTools MCP via localhost:8000 (Vite React SPA + FastAPI on PostgreSQL 18)

---

### Check M-12-01: A4 Printable Registration Card Layout
- **Description:** In Reception, view or print a registered patient's card; verify bilingual header, URN, barcode representation, demographics grid, and dual-signature line.
- **Verification Evidence:**
  - Route: `/reception/patients/1/print`
  - Bilingual Hospital Header: `KALYAN HOSPITAL` / `कल्याण हॉस्पिटल`
  - Contact Details: `Hospital Road, Ara, Bhojpur, Bihar - 802301 | Phone: +91 6182 000000`
  - Document Title: `PATIENT REGISTRATION CARD / रोगी पंजीकरण पत्र`
  - URN & Barcode: `KH-2026-0001` with Code-128 SVG barcode pattern
  - Demographics: Full name (`Ravi Shankar`), Guardian (`Kamlesh Shankar`), Age/Gender (`32 Years / Male`), Mobile (`9876543210`), Address (`Chowk Bazar, Ara, Bhojpur, Bihar`), Allergies (`None reported`)
  - Dual Signature: `Patient / Attendant Signature (मरीज / परिचारक के हस्ताक्षर)` & `Authorized Signatory / Receptionist (अधिकृत हस्ताक्षरकर्ता)`
- **Result:** PASS

---

### Check M-12-02: Real-time Proactive Duplicate Detection & Confirmation Override
- **Description:** Attempt to register a patient with duplicate name & mobile number; confirm warning appears with existing patient's URN, disables the Submit button, and requires checking "Confirm this is a different patient" to proceed.
- **Verification Evidence:**
  - Route: `/reception/patients/new`
  - Inputs: Name = `Ravi Shankar`, Mobile = `9876543210`
  - Alert Banner: `Potential Duplicate Patient Detected: A patient matching Ravi Shankar with mobile 9876543210 is already registered:`
  - Matched Record: URN `KH-2026-0001`, Guardian `Kamlesh Shankar`
  - Submit Button Behavior: Disabled by default while duplicate alert is active; enabled upon toggling `Confirm this is a different patient (allow new registration)` checkbox.
- **Result:** PASS

---

### Check M-12-03: Patient Photo Upload, Thumbnail Display, and Access Control
- **Description:** Upload JPEG/PNG photo for patient; verify square thumbnail in directory and confirm direct URL access without session is refused with HTTP 401.
- **Verification Evidence:**
  - Upload Endpoint: `POST /api/patients/{id}/photo` validates JPEG/PNG magic bytes and 5 MB max size.
  - Storage: Outside static assets at `backend/var/photos/<uuid>.<ext>`.
  - Directory & Detail: Thumbnail rendered via authenticated `/api/patients/{id}/photo`.
  - Access Control: Anonymous HTTP GET `/api/patients/{id}/photo` returns 401 Unauthorized (`not_authenticated`).
  - Automated Integration: Verified in `backend/tests/test_patient_edit_photo.py` and `backend/tests/test_phase12_gate.py`.
- **Result:** PASS
