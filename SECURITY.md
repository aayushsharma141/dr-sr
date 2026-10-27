# Security Policy & Practical Controls
## Kalyan Hospital — Offline Patient & Physiotherapy Management System

**Scope:** Standalone Windows 10/11 Desktop Installation  
**Deployment Model:** 100% Offline, Single Clinic PC  

---

## 1. Threat Model & Environment Constraints

In a local clinic environment with an offline desktop PC, the primary security threats are:
1. **Unauthorized Local Physical Access:** Walk-up access by unauthorized individuals or patients when staff leave the workstation unattended.
2. **Accidental / Malicious Data Overwrite or Corruption:** Accidental file deletion, improper system shutdowns/power outages during database writes, or tampering with database files.
3. **Improper Financial Record Alteration:** Staff altering past payment records or changing total fees to conceal missing cash collections.
4. **Data Loss via Hardware Failure:** Hard drive crash or ransomware affecting the local PC without an off-machine copy.

---

## 2. Practical Security Controls

### 2.1 Credential & Authentication Management
- **Zero Plaintext Passwords:** User passwords are never stored in plaintext. They are hashed using `PBKDF2-HMAC-SHA256` with a unique 16-byte cryptographically secure random salt (`os.urandom(16)`) and a minimum of 200,000 iterations.
- **No Hardcoded Passwords:** The system does not ship with hardcoded default production passwords. On first startup, if no administrator account exists, an administrative onboarding dialog prompts the creation of the master clinic password.
- **Role Separation:**
  - `ADMIN`: User management, database backup/restore, financial corrections, and clinic settings.
  - `RECEPTIONIST`: Patient registration, treatment logging, standard payment entry, and form printing.

### 2.2 SQL Injection Prevention & Data Access Control
- **100% Parameterized Queries:** All database interactions in the repository layer use parameterized queries (`cursor.execute("SELECT ... WHERE id = ?", (patient_id,))`). Dynamic SQL string concatenation or f-strings for SQL statements are strictly forbidden.
- **Foreign Key Enforcement:** `PRAGMA foreign_keys = ON;` is enforced to prevent orphan records or inconsistent state.
- **Immutable Financial Transactions:** Payments are recorded as ledger entries. Modifying or deleting an existing payment requires administrative authorization and creates an audit entry.

### 2.3 Safe File Handling & Path Traversal Protection
- **Restricted Directories:** Photos and backups are restricted to designated application paths (`data/photos/` and `data/backups/`).
- **Filename Sanitization:** When a user selects a photo, the file is copied using a freshly generated filename based solely on the sanitized `patient_id` (e.g. `KH-2026-0001.jpg`). File extensions are strictly whitelisted to `.jpg`, `.jpeg`, and `.png`. Raw user-supplied filenames are never used as file paths.
- **Backup Path Traversal Guards:** Backup restoration checks that candidate files are validated SQLite files before any interaction.

### 2.4 Integrity & Power-Loss Resilience
- **Write-Ahead Logging (WAL Mode):** The database operates in `PRAGMA journal_mode = WAL;` with `PRAGMA synchronous = NORMAL;`, offering high resistance to corruption during abrupt power failures or unexpected shutdowns.
- **Pre-Restoration Snapshot:** Before executing any restore operation, the active live database is automatically cloned into a safety backup (`kalyan_pre_restore_safety.db.bak`).

---

## 3. Honest Security Disclosures & Known Limitations

1. **At-Rest Database Encryption:**
   - The standard SQLite library does not encrypt database files on disk. Anyone with physical access to the hard drive and a generic SQLite viewer could inspect records unless operating system-level encryption (e.g., Windows BitLocker) is enabled.
   - *Recommendation:* We explicitly recommend that the clinic PC have Windows BitLocker enabled on the drive. We do not claim the database is encrypted at the application level unless SQLCipher is explicitly funded and integrated in a future milestone.
2. **Offline Hardware Theft:**
   - Physical security of the clinic computer and external USB backup drives remains the responsibility of Kalyan Hospital staff.
3. **No Network Telemetry:**
   - The application makes zero outgoing network calls. There are no tracking pixels, analytics, remote crash loggers, or automatic update checks.

---
*Security policy approved for implementation.*
