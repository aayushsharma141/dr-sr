# Implementation Tasks Breakdown
## Kalyan Hospital — Offline Patient & Physiotherapy Management System

**Strategy:** One testable task at a time. Each stage concludes with a runnable, working application and passing automated tests.

---

## Stage A: App Shell & Dashboard Foundation

- [x] **TASK-A01: Virtual Environment & Dependency Setup**
  - Initialize Python virtual environment (`.venv`).
  - Install dependencies: `PySide6`, `pytest`.
  - Create project `.gitignore` and pinned `requirements.txt`.
  - *Verification:* `pytest` runs and exits cleanly.

- [x] **TASK-A02: Application Config & Theme Stylesheet**
  - Implement `app/config.py` defining paths for `data/`, `photos/`, `backups/`, and app constants.
  - Implement `app/ui/styles.py` with the professional hospital design system (QSS tokens, accessible contrasts, Segoe UI typography).
  - *Verification:* Stylesheet imports without syntax errors.

- [x] **TASK-A03: Navigation Sidebar & Shell Layout**
  - Implement `app/ui/sidebar.py` with hospital branding ("KALYAN HOSPITAL", "श्री वशिष्ठ कल्याण ट्रस्ट").
  - Implement `app/ui/main_window.py` with `QStackedWidget` for view switching.
  - Create placeholder views for Patients, Treatments, Billing, and Backup.
  - *Verification:* Window opens cleanly, sidebar buttons switch active placeholder pages without crash.

- [x] **TASK-A04: Live Database-Backed Dashboard View**
  - Implement `app/ui/views/dashboard_view.py`.
  - Connect dashboard stat cards (Total Patients, Today's Registrations, Active Cases, Balance) to query the database layer (showing `0` on empty DB, never hardcoded numbers).
  - *Verification:* Automated smoke test launching `MainWindow` and checking widget counts.

---

## Stage B: SQLite Layer & Patient Registration

- [x] **TASK-B01: Database Connection Factory & Schema DDL**
  - Implement `app/db/connection.py` ensuring `foreign_keys = ON` and `WAL` journal mode.
  - Implement `app/db/schema.sql` with table definitions and indexes.
  - Create automated schema migration / initialization logic on first startup.
  - *Verification:* Test that schema creates all tables and enforces foreign key constraints.

- [x] **TASK-B02: Patient Repository & Unique ID Sequence Generator**
  - Implement `app/repositories/patient_repository.py`.
  - Implement sequential ID generator `KH-YYYY-XXXX` backed by an atomic sequence table.
  - Implement CRUD: Insert, Fetch by ID, Update, Filter/Search (by ID, Name, Mobile).
  - *Verification:* Unit tests for ID uniqueness, search matching, and constraint rejection.

- [x] **TASK-B03: Patient Service & Input Validation**
  - Implement `app/services/patient_service.py`.
  - Add validation: valid age (0–125), mobile format (10 digits), sanitized names, non-empty conditions.
  - Photo manager: Copy uploaded patient photo to `data/photos/{patient_id}.{ext}`.
  - *Verification:* Unit tests for valid/invalid patient records and photo file handling.

- [x] **TASK-B04: Patient Registration Form View**
  - Implement `app/ui/views/patient_form_view.py`.
  - Fields: Name, Age, Sex dropdown, Mobile, Address, Referred By, Condition, Photo selector.
  - Clear, Save, and Reset actions with descriptive inline validation errors.
  - *Verification:* Manual & automated UI tests saving a patient record and verifying DB entry.

- [x] **TASK-B05: Patient Registry & Search View**
  - Implement `app/ui/views/patient_list_view.py`.
  - Real-time search bar filtering across ID, Name, and Mobile.
  - Action buttons: "Edit Profile", "Open Treatment", "Print Card".
  - *Verification:* Verify search filters results instantly and persistence survives app restart.

---

## Stage C: Treatment Cases, Sessions & Currency-Safe Billing

- [x] **TASK-C01: Treatment Cases & Sessions Data Layer**
  - Implement `app/repositories/treatment_repository.py`.
  - Methods to create a treatment case, fetch cases by patient, append dated sessions, and list session history.
  - *Verification:* Test that adding new sessions preserves all previous session notes chronologically.

- [x] **TASK-C02: Payments Ledger & Currency-Safe Billing Service**
  - Implement `app/repositories/payment_repository.py`.
  - Implement `app/services/billing_service.py` using integer paise arithmetic.
  - Calculate balance: $\text{Agreed Fee} - \sum(\text{Payments})$.
  - Validation: reject negative payments, check for overpayment conditions.
  - *Verification:* Unit tests covering rounding edge cases, multiple partial payments, and balance calculations.

- [x] **TASK-C03: Treatment History & Session Management UI**
  - Implement `app/ui/views/treatment_view.py`.
  - Display patient case summary, session history list, pain scores, and treatment modalities.
  - Dialog to log a new treatment session.
  - *Verification:* Add 3 sessions to a fictional patient and verify all 3 render in order.

- [x] **TASK-C04: Payment & Balance UI**
  - Implement `app/ui/views/payment_view.py` and payment recording dialog.
  - Prominent summary banner: Total Fee, Paid to Date, Outstanding Balance.
  - Payment ledger table showing timestamp, mode (Cash/UPI), reference, and amount.
  - *Verification:* Record ₹1,000 against a ₹5,000 case and verify ₹4,000 balance updates dynamically.

---

## Stage D: Standard A4 Printout, PDF Export & Local Backup

- [x] **TASK-D01: Hospital A4 Registration Record Template**
  - Implement `app/printing/document_builder.py`.
  - Layout: Replicate Kalyan Hospital physical prescription header (deep maroon banner, dual clinic branches in Ara and Gadhani, Dr. Madan Mohan Dwivedi, Dr. Chandan Kr. Dwivedi, central winged Caduceus emblem).
  - Body: Patient Picture box, canonical 12 numbered fields, and dual signatures (`Patient / Attendant Signature`, `Authorized Signature`, and `Date`).
  - *Verification:* Generate HTML/QTextDocument and verify formatting on A4 boundary.

- [x] **TASK-D02: Print Preview & PDF Export Dialogs**
  - Implement `app/printing/print_manager.py`.
  - Integrate `QPrintPreviewDialog` with zoom and print controls.
  - Direct "Save as PDF" file dialog.
  - *Verification:* Verify generated PDF renders properly on standard Windows PDF readers.

- [x] **TASK-D03: SQLite Hot Backup Engine**
  - Implement `app/services/backup_service.py` using `sqlite3.Connection.backup()`.
  - Store timestamped backups in `data/backups/`.
  - Expose backup action in `app/ui/views/backup_view.py` with visual feedback.
  - *Verification:* Test backup creation while database is actively reading/writing.

- [x] **TASK-D04: Verified Database Restoration Pipeline**
  - Implement backup verification routine: opens backup file in isolated scratch DB, runs `PRAGMA integrity_check`, verifies record counts.
  - Safe restoration workflow: create safety snapshot of live DB before swapping.
  - *Verification:* Automated test restoring backup into temporary DB and verifying exact row equality.

---

## Stage E: Demo Hardening & Client Walkthrough Preparation

- [x] **TASK-E01: Local Authentication & Permission Guard**
  - Implement `app/services/auth_service.py` with PBKDF2-HMAC-SHA256 password hashing.
  - Protect sensitive operations (Database Restore, System Settings) behind admin prompt.
  - Provide fallback bypass if single-user mode is approved.
  - *Verification:* Unit test validating password hash verification and brute-force resistance.

- [x] **TASK-E02: Network Isolation & Error Recovery Validation**
  - Verify complete offline operation by executing full test suite with network adapters disabled.
  - Friendly error handling for missing photos, corrupted backup files, or disk full scenarios.
  - *Verification:* App launches and operates 100% without internet connection.

- [x] **TASK-E03: Fictional Demo Dataset & Reset Utility**
  - Create `app/db/seed_demo.py` to populate 5 realistic fictional patient records with treatment histories and payments.
  - Add a one-click "Reset Demo Data" utility for repeatable client demonstrations.
  - *Verification:* Script seeds database and resets to pristine demo state in < 1 second.

- [x] **TASK-E04: Client Demonstration Checklist & Documentation**
  - Finalize README with quick-start execution commands.
  - Prepare the 5-minute client demo script (Dashboard → Register → Treatment → Payment → Print → Backup).
  - *Verification:* Rehearsal of the 5-minute walkthrough without warnings or anomalies.

---
*Tasks document ready for Phase 1 execution.*
