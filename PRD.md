# Product Requirements Document (PRD)
## Kalyan Hospital — Offline Patient & Physiotherapy Management System

**Version:** 1.1 (Aligned with Client Physical Prescription Header & Form Layout)  
**Target Platform:** Windows 10 / 11 (Offline Single-PC Desktop)  
**Budget Ceiling:** ₹22,000  
**Target Timeline:** 4–6 Weeks  
**Hospital / Client Identity (from Official Clinic Header):**
- **Entity:** KALYAN HOSPITAL — PHYSIOTHERAPY DEPARTMENT (कल्याण हॉस्पीटल)
- **Operated by:** श्री वशिष्ठ कल्याण ट्रस्ट द्वारा संचालित
- **Clinic 1:** नवादा थाना के सामने वाली गली, आरा, जिला- भोजपुर (बिहार) - 802301
- **Clinic 2:** श्रीरामपुर रोड, गड़हनी, प्रखण्ड- उदवन्तनगर, जिला- भोजपुर (बिहार) - 802206
- **Consulting Clinicians:**
  - **Dr. Madan Mohan Dwivedi (डॉ० मदन मोहन द्विवेदी):** D.P.T (Pat.), O.C.T.M. (Delhi), O.C.S.P. (Gwaliar), M.B.S.A.P.O. (Bihar), Sr. Diploma Music (Allahabad), Senior Physiotherapist, Sports Physiotherapist, Ex Sadar Hospital, Arrah (Bhojpur), फिजियोरत्न से सम्मानित
  - **Dr. Chandan Kr. Dwivedi (डॉ० चंदन कुमार द्विवेदी):** B.P.T. (RGUHS) Bangalore, M.I.A.P., CDNT - Bangalore, CCT - Bangalore, Ex. INT. NIMHANS - Bangalore, Ex. INT. APOLLO - Bangalore, Ex. INT. RMH - Bangalore, FMATS - Varanasi, UP, फिजियोथेरेपिस्ट
- **Emblem:** Caduceus with wings emblem centered between doctor credentials

---

## 1. Executive Summary & Objective

The objective is to design and develop a robust, lightweight, and 100% offline Windows desktop application for Kalyan Hospital, Ara, Bihar. The software is purpose-built to streamline outpatient registration, maintain chronological physiotherapy treatment sessions, accurately record payments and outstanding balances, produce standardized hospital-branded A4 registration documents, and provide fail-safe local database backups.

### 1.1 Guiding Principles
1. **Offline First & Only:** Zero external dependencies, no telemetry, no cloud sync, and no mandatory internet connection.
2. **Reliability Over Complexity:** Staged implementation using Python, PySide6 (Qt), and SQLite.
3. **Financial Safety:** Accurate, currency-safe payment calculations with strict rejection of negative balances or arbitrary edits.
4. **Strict Scope Control:** Adherence to the ₹22,000 budget ceiling. High-complexity enterprise features (multi-PC LAN synchronization, SMS/WhatsApp integrations, full ERP inventory) are explicitly excluded from this phase.

---

## 2. User Roles & Personas

| Role | Primary User | Core Responsibilities & Permissions |
|---|---|---|
| **Receptionist / Front Desk** | Clinic Staff | Register new patients, capture demographic details & photo, search historical patients, schedule treatment sessions, record fee payments, print registration cards. |
| **Therapist / Doctor** | Physiotherapist | View patient history, review past clinical notes, enter dated treatment session observations and treatment modalities. |
| **Administrator** | Trust Manager / Clinic Head | Full system access: manage staff credentials, view aggregate clinic statistics, execute database backups, verify database restoration, view audit logs. |

---

## 3. Core Functional Requirements (MVP Scope)

### 3.1 Module 1: Dashboard & Clinic Overview
- **FR-DASH-01:** Display real-time key metric cards calculated from SQLite data (not mocked):
  - Total registered patients count.
  - Today's new registrations count.
  - Active treatment cases count.
  - Total pending fee balance across active cases.
- **FR-DASH-02:** Quick-access navigation bar for Patients, Treatments, Payments, Backups, and Settings.
- **FR-DASH-03:** Official hospital branding displaying "कल्याण हॉस्पीटल - PHYSIOTHERAPY DEPARTMENT" and "श्री वशिष्ठ कल्याण ट्रस्ट द्वारा संचालित".

### 3.2 Module 2: Patient Registration & Profile Management
- **FR-PAT-01 (Unique ID Generation):** Automatically generate a human-readable, unique Serial / URN No. (e.g., `KH-2026-0001` or matching current clinic serial sequence) generated at the database layer.
- **FR-PAT-02 (Patient Demographics & Form Fields):** Capture the canonical 12 form fields:
  1. Serial / URN No.
  2. Patient Name
  3. Age
  4. Sex (Male / Female / Other)
  5. Address
  6. Mobile No. (10 digits)
  7. Patient In (Date & Time)
  8. Patient Out (Date & Time)
  9. Reference / Referred By
  10. Patient Condition
  11. No. of Sessions
  12. Payment Details: Total Amount, Amount Paid, Balance Amount
- **FR-PAT-03 (Patient Photograph):**
  - Allow selecting a local photo (`.jpg`, `.png`).
  - Store photo in an application-managed data directory (`data/photos/{patient_id}.ext`).
  - Displays in the designated "Patient Picture" box on UI and printed record.
  - Graceful fallback placeholder if no photo is attached.
- **FR-PAT-04 (Patient Search & List):**
  - Instant search filter by Serial / URN No., Name, or Mobile Number.
  - Sortable patient registry table with quick action buttons (View, Edit, Open Treatment, Print).
- **FR-PAT-05 (Data Safety):** Soft-delete or archive only; ordinary edits cannot permanently delete patient history.

### 3.3 Module 3: Physiotherapy Treatment Cases & Session Tracking
- **FR-TRT-01 (Treatment Case):** Each patient record manages clinical diagnosis and planned sessions count (Field 11: No. of Sessions).
- **FR-TRT-02 (Dated Sessions):** Add individual treatment session records linked to a case:
  - Session Date & Time.
  - Session Notes (Treatment modalities applied, exercises, patient progress, pain score).
  - Attending Therapist Name.
- **FR-TRT-03 (Session History):** Full chronological view of all previous sessions; historical session entries are immutable once saved.

### 3.4 Module 4: Fees, Invoicing & Balance Calculation
- **FR-PAY-01 (Agreed Package Fee):** Record the total agreed treatment fee (Total Amount: ₹).
- **FR-PAY-02 (Payment Transactions):** Record payment installments:
  - Payment Date & Time.
  - Amount Paid (Stored in integer paise / currency-safe representation).
  - Payment Mode (Cash, UPI, Other local offline notation).
  - Receipt / Transaction Note.
- **FR-PAY-03 (Automated Balance Calculation):**
  - Formula: $\text{Balance Amount} = \text{Total Amount} - \sum(\text{Amount Paid})$.
  - Dynamically calculated by the billing service layer.
  - Total Amount, Amount Paid, and Balance Amount are never editable as arbitrary disconnected numbers.
- **FR-PAY-04 (Validation Rules):**
  - Reject negative payment amounts.
  - Flag or prevent overpayment unless explicitly authorized.

### 3.5 Module 5: Standardized A4 Registration Form & Print Preview
- **FR-PRN-01 (Approved A4 Layout & Header):**
  - Top header reproducing the exact physical clinic pad:
    - Maroon banner with "कल्याण हॉस्पीटल", "PHYSIOTHERAPY DEPARTMENT", "Sl No.", and both clinic branch addresses (Ara & Gadhani).
    - Left column: Dr. Madan Mohan Dwivedi & credentials.
    - Center: Caduceus winged medical emblem.
    - Right column: Dr. Chandan Kr. Dwivedi & credentials.
    - Trust line: "श्री वशिष्ठ कल्याण ट्रस्ट द्वारा संचालित".
- **FR-PRN-02 (Document Title & Body Grid):**
  - Title: **PATIENT REGISTRATION & TREATMENT RECORD**
  - Dedicated "Patient Picture" box.
  - Clean formatted fields 1 through 12:
    - 1. Serial / URN No.
    - 2. Patient Name
    - 3. Age & 4. Sex
    - 5. Address
    - 6. Mobile No.
    - 7. Patient In (Date & Time) & 8. Patient Out (Date & Time)
    - 9. Reference / Referred By
    - 10. Patient Condition
    - 11. No. of Sessions
    - 12. Payment Details (Total Amount, Amount Paid, Balance Amount)
- **FR-PRN-03 (Signatures & Verification):**
  - **Patient / Attendant Signature:** Dedicated signature line.
  - **Authorized Signature:** Doctor/Clinic head signature line.
  - **Date:** Printed date line.
- **FR-PRN-04 (Output Modes):** Local Qt Print Preview dialog and direct "Export to PDF" functionality.

### 3.6 Module 6: Local Backup & Verified Restore
- **FR-BAK-01 (Safe Hot Backup):** Utilize SQLite Online Backup API (`sqlite3_backup`) to generate consistent, uncorrupted backup snapshots while the database is actively connected.
- **FR-BAK-02 (Backup Destination):** Configurable local backup directory (e.g., external USB drive or designated safe folder), timestamped filename (e.g., `kalyan_backup_20261028_120000.db`).
- **FR-BAK-03 (Verified Restore):** Test restoration into an isolated temporary database path to verify schema and record counts before replacing live data.
- **FR-BAK-04 (Audit Feedback):** Explicit UI status showing exact date, size, and health status of the latest backup.

### 3.7 Module 7: Authentication & Access Control (Staged / Configurable)
- **FR-SEC-01:** Local administrator login with salted password hashing (PBKDF2-HMAC-SHA256).
- **FR-SEC-02:** Role-based gating: Restricted operations (restoring backup, modifying treatment case fee structures, viewing clinic-wide financials) require administrator authentication.
- **FR-SEC-03:** Option to run in single-user receptionist mode if client approves bypassing login screen.

---

## 4. Explicit Scope Exclusions (Anti-Features)

To protect the ₹22,000 commercial ceiling and 4–6 week timeline, the following are strictly **out of scope**:
1. **Cloud Sync / Remote Hosting:** No Firebase, AWS, Supabase, or web hosting.
2. **Multi-PC LAN Real-Time Networking:** Software runs on a single desktop workstation. Multi-user concurrent networking requires client renegotiation.
3. **SMS / WhatsApp Gateway Automation:** No third-party messaging APIs (avoids recurring SMS gateway costs and internet requirements).
4. **Full Pharmacy & ERP Inventory:** No drug stock tracking, batch numbers, or supplier PO management.
5. **Inpatient / Bed Allocation System:** Physiotherapy and outpatient focus only.
6. **Hardware-level biometric scanners:** Standard USB keyboard/mouse entry only.

---

## 5. Technical Constraints & Non-Functional Requirements

- **OS Compatibility:** Windows 10 (64-bit) & Windows 11.
- **UI Framework:** Python 3.10+ with PySide6 (Qt 6).
- **Database Engine:** SQLite 3 with `PRAGMA foreign_keys = ON;` and `PRAGMA journal_mode = WAL;`.
- **Packaging:** Standalone executable via PyInstaller or PySide6 deploy tool.
- **Network Independence:** 100% functionality when disconnected from Wi-Fi and Ethernet.
- **Performance:** App launch in < 3 seconds; search queries across 10,000 records in < 50ms.

---

## 6. Layout Agreement & Client Approvals

1. **Header & Doctor Details:** Formally adopted from Kalyan Hospital physical slip (Dr. Madan Mohan Dwivedi & Dr. Chandan Kr. Dwivedi, both branch clinics in Ara and Gadhani).
2. **Form Structure:** Adopted 12 numbered fields + Patient Picture box + Dual Signatures (Patient/Attendant & Authorized Signature) + Date.
3. **Staff Permission Enforcement:** Configurable master admin password protecting sensitive actions (backups, settings) with open front-desk access.
4. **Printer Specifications:** Standard ISO A4 Laser/Inkjet printing.

---
*PRD Version 1.1 updated with verified client layout.*
