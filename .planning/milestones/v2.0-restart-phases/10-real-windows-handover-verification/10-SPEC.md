# Phase 10 Specification: Real Windows Handover & Offline Verification

## 1. Objective
Build the standalone Windows executable (`KalyanHospital.exe`), execute an end-to-end offline operational rehearsal without internet, and confirm that all requirements from the Master Build Specification v2.0 are fulfilled within the ₹22,000 budget boundary.

---

## 2. Requirements & Traceability
- **EXE-01 (Packaging):** Self-contained Windows executable built with PyInstaller (`dist/KalyanHospital/KalyanHospital.exe`) bundling assets, fonts, icons, and SQLite schema.
- **OFF-01 (100% Offline):** Operates on standard Windows 10/11 workstation with zero network access, telemetry, or external service dependencies.
- **PRN-01 & PRN-02 (A4 Pad & Receipts):** Generation of single-page A4 registration cards reproducing the maroon letterhead, dual clinician credentials, central Caduceus emblem, 12 canonical fields, and dual signatures (*Patient / Attendant Signature* and *Authorized Signature* with Date).
- **BAK-01 & BAK-02 (Disaster Recovery Rehearsal):** Verified backup and restoration rehearsal confirming that both the SQLite database and local patient photos are 100% recovered after simulated data deletion.
- **AUD-01 (Audit Trail):** Full audit log records created for all clinical, financial, and administrative actions during the rehearsal.

---

## 3. Scope Boundaries
- **In Scope:**
  - Build executable with PyInstaller.
  - Run end-to-end automated offline simulation script covering the full hospital lifecycle (Admin -> Patient -> Therapy Session -> Payment -> Print -> Backup -> Restore).
  - Verify client handover deliverables: `run.bat`, `KalyanHospital.exe`, user documentation, and audit trail.
- **Out of Scope:**
  - Multi-PC LAN deployment (deferred to Phase 2).
  - Web or cloud hosting.

---

## 4. Verification Criteria
1. Executable builds cleanly and produces `dist/KalyanHospital/KalyanHospital.exe`.
2. End-to-end simulation script executes without network access and verifies 100% data integrity and photo recovery.
3. Full pytest regression suite passes with 100% green status.

