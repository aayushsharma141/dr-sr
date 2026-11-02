# Phase 14 Manual Checks

## M-14-01: Structured Prescription Generation & Bilingual Print Slip (RX-01)

Description: Doctor issues structured prescription for a patient during or following consultation.
Verification:
- Dynamic medication row controls allow adding and removing medicines with continuous 1..N order indexing.
- Presets for frequency (`1-0-1`, `1-0-0`, `0-0-1`, `1-1-1`, `0-1-0`, `SOS`) and duration (days) populate seamlessly.
- Clinical advice sections (dietary recommendations, general precautions, follow-up date) persist and display.
- Bilingual printable prescription slip (`PrescriptionPrint.tsx`) renders clinic letterhead, Rx symbol, English + Hindi section headers, medication table, and doctor signature block. `@media print` eliminates screen buttons during physical printing.
Result: PASS

## M-14-02: Treatment Package Lifecycle & Progress Tracking (TRT-01)

Description: Doctor defines a multi-session physiotherapy plan for a patient with diagnosed musculoskeletal condition.
Verification:
- Plan creation records total target sessions, condition diagnosis, referring source, and agreed fee in rupees (converted to paise).
- Treatment package dashboard displays session progress bar gauge and percentage completed.
- Optimistic concurrency protection returns 409 Conflict if modified concurrently.
- Package cancellation requires a mandatory clinical justification reason ($\ge 3$ characters).
Result: PASS

## M-14-03: Physiotherapy Session Logger & VAS Trend Scoring (TRT-02)

Description: Doctor logs physiotherapy sessions against active treatment packages.
Verification:
- Concurrency-safe session sequencing allocates contiguous monotonic session numbers (Session #1, Session #2...) without duplicates or gaps under high concurrency.
- Interactive VAS 0–10 pain slider reflects color-coded severity (None $\to$ Mild $\to$ Moderate $\to$ Severe $\to$ Unbearable).
- Modality checkboxes (IFT, Ultrasonic, Cervical/Lumbar Traction, Hot Pack, Exercise Therapy, Manual Mobilisation) persist as structured JSON arrays.
- Interactive SVG VAS trend chart plots pain reduction trajectory across sequential sessions.
Result: PASS

## M-14-04: Session Immutability & Addenda Integrity (TRT-03, D-03)

Description: Verify defense-in-depth immutability for clinical session history and doctor silo boundaries.
Verification:
- Attempting to modify or delete a finalised session via REST API returns 400 Bad Request (`immutable_record`).
- Direct SQL `UPDATE` or `DELETE` on finalized session rows is rejected by PostgreSQL trigger `trg_prevent_finalised_treatment_session_tampering`.
- Retrospective corrections are appended as dated addenda and displayed in chronological sequence with author and timestamp.
- Doctor silo isolation prevents Doctor B from querying or reading Doctor A's treatment sessions and prescriptions (404 Not Found / 403 Forbidden).
Result: PASS
