# Test Plan & Verification Strategy
## Kalyan Hospital — Offline Patient & Physiotherapy Management System

**Version:** 1.0  
**Test Framework:** `pytest` + `pytest-qt`  
**Philosophy:** Zero unverified features. Never claim a feature works without test evidence.

---

## 1. Test Architecture & Environment

- **Isolated Test Database:** All automated tests use temporary SQLite databases created in memory (`:memory:`) or isolated temporary directories (`tmp_path`). Never touch production or active demo database files during testing.
- **Data Policy:** 100% fictional patient names and synthetic records. No real medical or identifiable personal data in tests or repositories.
- **Offline Assurance:** Tests must pass in an environment where network interfaces are inactive.

---

## 2. Test Suites & Coverage Matrix

### 2.1 Database & Schema Integrity (`tests/test_schema.py`)
| Test ID | Objective | Expected Outcome |
|---|---|---|
| `TC-SCH-01` | Connection Pragma Enforcement | Every new connection executes `PRAGMA foreign_keys = ON;` and `PRAGMA journal_mode = WAL;`. |
| `TC-SCH-02` | Foreign Key Constraints | Attempting to insert a treatment session with a non-existent `case_id` raises `sqlite3.IntegrityError`. |
| `TC-SCH-03` | Check Constraints on Demographics | Inserting patient with age `-1` or `150` fails check constraint. |
| `TC-SCH-04` | Gender / Status Enum Validation | Inserting sex other than `'Male'`, `'Female'`, `'Other'` fails constraint. |

### 2.2 Patient Management (`tests/test_patient_service.py`)
| Test ID | Objective | Expected Outcome |
|---|---|---|
| `TC-PAT-01` | Sequential Patient ID Generation | Generated IDs follow format `KH-YYYY-XXXX` and increment atomically without collisions. |
| `TC-PAT-02` | Duplicate Patient ID Prevention | Uniqueness constraint prevents duplicate ID assignment even under simulated rapid entry. |
| `TC-PAT-03` | Valid Registration & Persistence | Record is saved, database connection is closed and reopened, and patient data matches exactly. |
| `TC-PAT-04` | Mandatory Field Validation | Empty Name, invalid mobile number, or missing condition raises structured `ValidationError`. |
| `TC-PAT-05` | Search by ID, Name, and Mobile | Fuzzy / substring search accurately returns target patient records while excluding non-matches. |
| `TC-PAT-06` | Photo Path Handling | Setting photo path properly copies image file to designated directory and handles missing file gracefully. |
| `TC-PAT-07` | Non-destructive Profile Edit | Updating patient address or mobile preserves original creation timestamp and ID. |

### 2.3 Treatment Cases & Sessions (`tests/test_treatment_service.py`)
| Test ID | Objective | Expected Outcome |
|---|---|---|
| `TC-TRT-01` | Create Case Linked to Patient | Case is successfully associated with patient record via foreign key. |
| `TC-TRT-02` | Append Session to Case | Session records date, therapist name, treatment notes, and pain score. |
| `TC-TRT-03` | Historical Session Immutability | Adding session `N+1` leaves all previous `1..N` sessions unchanged in sequence and content. |
| `TC-TRT-04` | Pain Score Range Validation | Pain score outside `0–10` is rejected by service validator. |

### 2.4 Currency & Billing Engine (`tests/test_billing_service.py`)
| Test ID | Objective | Expected Outcome |
|---|---|---|
| `TC-BIL-01` | Currency-Safe Representation | ₹500.50 is stored as integer `50050` paise; no floating point drift occurs. |
| `TC-BIL-02` | Exact Balance Calculation | Agreed Fee = ₹6,000; Payment 1 = ₹2,500; Payment 2 = ₹1,500; Calculated Balance = ₹2,000. |
| `TC-BIL-03` | Negative Payment Rejection | Attempting to log a payment of `-₹500` raises `InvalidAmountError`. |
| `TC-BIL-04` | Overpayment Guard | Payment exceeding remaining balance triggers explicit warning or blocks entry unless authorized. |
| `TC-BIL-05` | Zero Total Fee Handling | Free / charitable treatment cases (agreed fee = ₹0) calculate balance correctly as ₹0. |

### 2.5 A4 Printing & Document Generation (`tests/test_printing.py`)
| Test ID | Objective | Expected Outcome |
|---|---|---|
| `TC-PRN-01` | A4 Document Sizing | `QTextDocument` page size is configured to standard ISO A4 dimensions. |
| `TC-PRN-02` | Official Header & Branding | Document includes Kalyan Hospital maroon header, both clinic addresses (Ara & Gadhani), Dr. Madan Mohan Dwivedi & Dr. Chandan Kr. Dwivedi credentials, and central Caduceus emblem. |
| `TC-PRN-03` | 12 Fields & Dual Signatures | All 12 fields, Patient Picture box, and both `Patient / Attendant Signature` and `Authorized Signature` with `Date` render accurately. |
| `TC-PRN-04` | PDF Export File Generation | PDF file is written to disk, non-empty, and valid header (`%PDF-`). |

### 2.6 Backup & Verified Restore Pipeline (`tests/test_backup_restore.py`)
| Test ID | Objective | Expected Outcome |
|---|---|---|
| `TC-BAK-01` | Hot Online Backup Creation | Backup completes successfully using SQLite backup API without locking out active reads. |
| `TC-BAK-02` | Integrity Check on Backup | `PRAGMA integrity_check;` returns `ok` on generated backup file. |
| `TC-BAK-03` | Isolated Restoration Test | Restore is executed into a separate scratch DB; patient count and payment balances match source 100%. |
| `TC-BAK-04` | Corrupted File Detection | Supplying a truncated or corrupted DB file to the restore pipeline aborts before live DB is altered. |

### 2.7 Security & Offline Operation (`tests/test_security_offline.py`)
| Test ID | Objective | Expected Outcome |
|---|---|---|
| `TC-SEC-01` | Password Hash Verification | Passwords hashed with PBKDF2/SHA256 verify correctly; plain text is never stored. |
| `TC-SEC-02` | Role-Based Gating | Non-admin users cannot trigger database restore or credential resets. |
| `TC-OFF-01` | Network Disconnect Test | With network disabled, the app launches, searches, saves, prints, and backs up with zero socket errors. |

---

## 3. Manual Acceptance Checklist for Client Demonstration

Before presenting the software demo to the client, verify the following 8 steps:
- [ ] 1. Clean launch of the application with zero terminal traceback.
- [ ] 2. Dashboard loads and accurately reflects existing database counts.
- [ ] 3. Register fictional patient "Ramesh Kumar", Age 45, Male, Phone `9876543210`. Verify unique ID created.
- [ ] 4. Search for "Ramesh" in search bar and reopen record within 1 second.
- [ ] 5. Open Treatment tab, log a session "Cervical traction and ultrasound, pain score 6/10".
- [ ] 6. Set agreed fee ₹3,000, log payment of ₹1,000, verify displayed balance reads ₹2,000.
- [ ] 7. Click Print Preview: verify hospital letterhead, accurate details, and authorized signature line.
- [ ] 8. Click "Create Backup", confirm success message with timestamp, restart application to prove persistence.

---
*Test Plan verified for implementation execution.*
