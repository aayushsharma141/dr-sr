# Security Policy — Hospital OPD Management System

This security policy defines the architectural defenses, threat model, authorization contracts, and vulnerability disclosure procedures for the Hospital OPD Management System.

---

## 1. Objectives & Threat Model

The primary security objectives of the platform are to **guarantee patient confidentiality**, **prevent unauthorized clinical and financial manipulation**, **maintain an immutable audit trail**, and **ensure resilience against hardware or electrical failures**.

Because the system operates on an on-premises Local Area Network (LAN), physical access and workstation sharing are common. The security architecture explicitly accounts for the following threat vectors:

- **Shared / Unattended Terminals:** Terminals left unlocked at reception or doctor cabins. Defended by idle timeouts, session revocation, and non-overlapping role privileges.
- **Direct Network API Probing:** Malicious or misconfigured network devices on the hospital subnet crafting unauthorized HTTP requests. Defended by strict server-side authentication, origin verification, and route-level authorization.
- **Concurrent Ledger Modification:** Multiple counters attempting simultaneous payments, check-ins, or fee adjustments. Defended by database row-level locking (`SELECT ... FOR UPDATE`), transaction isolation, and integer-paise arithmetic.
- **Tampering with Historical Records:** Malicious or accidental edits to past encounters or billing. Defended by append-only ledger designs, dated addenda, and administrative approval gates.
- **Hardware & Power Disruption:** Central host sudden shutdown. Defended by pre-flight durability startup checks (PostgreSQL `fsync` validation), automatic WAL write-ahead logging, and verified backup archives.

---

## 2. Authentication & Session Security

- **Individual Staff Credentials:** Every employee (Administrators, Doctors, Receptionists) holds an individual account. Shared generic accounts are strictly prohibited.
- **Argon2id Cryptographic Hashing:** Passwords are never stored in plaintext or reversible formats. All authentication uses Argon2id with memory-hard work factors.
- **First-Run Ephemeral Setup Token:** Fresh installations have **zero default accounts**. The server generates an ephemeral, cryptographically random one-time token printed exclusively to the physical server console to bootstrap the master administrator. The setup API endpoint is permanently locked upon completion.
- **Session Governance:** Server-issued session tokens with idle timeouts, explicit logout invalidation, and rate limiting on failed attempts to mitigate brute-force threats.
- **Staff Deactivation:** Deactivating an employee immediately terminates all active sessions while permanently preserving their identity on historical clinical and financial records for legal attribution.

---

## 3. Server-Side Authorization & Role-Based Access Control (RBAC)

All authorization checks are executed strictly on the backend API layer. Client-side route guards serve solely as user-interface navigation hints and are never relied upon for security enforcement.

### Authoritative Role-Based Access Matrix

| System Capability | Administrator | Reception Desk | Doctor / Clinician |
|---|:---:|:---:|:---:|
| **User & Staff Account Administration** | **Full Access** | Denied | Denied |
| **Hospital Profiles & Clinical Configurations** | **Full Access** | Denied | Denied |
| **Patient Registration & Demographic Edits** | Yes | **Full Access** | Read-Only |
| **Patient Search & Identity Photo Viewing** | Yes | Yes | Yes |
| **Appointment Booking & Token Desk Queue** | Yes | **Full Access** | Own Queue Only |
| **OPD Clinical Consultation & Encounter Notes** | Read-Only (Audit) | Denied | **Authoring / Assigned** |
| **Prescription (Rx) & Diagnostic Template Authoring** | Read-Only (Audit) | Denied | **Authoring / Assigned** |
| **Routine Fee & Payment Collection (`payment:create`)** | **Denied** *(Duty Separation)* | **Full Access** | **Denied** |
| **Fee Concession / Adjustment Authorization** | Read-Only (Review) | Denied | **Authoring (Signed)** |
| **Financial Reversal Execution (`payment:reverse`)** | **Authorized (With Reason)** | Denied | Denied |
| **Cryptographic Security Audit Log Access** | **Full Access** | Denied | Denied |
| **Database Backup, Integrity Check & Restore** | **Full Access** | Denied | Denied |

> **Separation of Duties Guarantee:** Routine payment collection is owned exclusively by Reception. To prevent financial conflicts of interest, Administrators cannot collect routine payments (`payment:create` returns `HTTP 403 Forbidden`), and Doctors possess zero billing permissions. Payment reversals require Administrator credentials and mandatory written justification.

---

## 4. Clinical & Financial Record Integrity

- **Append-Only Financial Ledger:** Payment records cannot be modified or deleted. Errors are corrected exclusively through compensating reversal transactions carrying the authorizing administrator's ID and timestamp.
- **Integer-Paise Precision:** All financial values are calculated and persisted as exact integer paise ($1\text{ INR} = 100\text{ paise}$), completely avoiding IEEE-754 floating-point rounding bugs.
- **Immutable Clinical Finalization:** Once a clinical encounter or prescription is signed, the original record cannot be altered. Corrections must be attached as dated clinical addenda.
- **Optimistic Concurrency Control:** Patient demographic and clinical updates require version tokens; stale submissions return `HTTP 409 Conflict` to prevent silent overwrites.

---

## 5. Security Audit Logging

The platform maintains an immutable audit trail capturing all critical actions:
- Authentication events (successful login, failed attempts, account lockouts, password changes).
- Administrative actions (user creation, role changes, configuration updates).
- Patient identity events (new registration, demographic modifications with before/after diffs).
- Clinical events (encounter finalization, dated addenda attachments, prescription signatures).
- Financial transactions (payment collections, concession applications, authorized reversals, receipt reprints).
- System operations (backup generation, integrity verifications, recovery execution).

Audit records are append-only. Standard users have no mechanism to modify, truncate, or suppress audit log entries. Passwords, setup tokens, and session secrets are strictly excluded from audit payloads.

---

## 6. Network & Environment Security

- **Local Area Network Binding:** Services bind to the hospital's private LAN interface (`0.0.0.0` or designated subnet IP). No external port forwarding or cloud bridging is permitted.
- **Zero Cloud / CDN Dependencies:** All frontend assets, scripts, fonts, and styles are self-hosted. The system operates autonomously with zero external network connectivity.
- **Transport Security:** Client workstations communicate across the dedicated LAN segment. HTTPS is strongly recommended for all production deployments.
- **Secure File Storage:** Patient identity photographs and clinical attachments are stored outside the public document root using opaque UUIDs. Downloads require active session authentication with path traversal (`../`) prevention.

---

## 7. Backup Integrity & Disaster Recovery

- **Atomic Bundling:** Scheduled backups archive both the relational PostgreSQL database and all patient file assets into a unified, checksummed snapshot.
- **Pre-Restore Validation:** The restore engine validates database revision compatibility and bundle cryptographic checksums before touching live databases.
- **Safety Snapshots:** Restoring a database snapshot automatically generates a safety backup of the current state prior to executing the cutover.

---

## 8. Reporting a Vulnerability

Security issues, potential privilege escalation vectors, or data integrity flaws should be reported through responsible disclosure channels:

1. **Submit a Private Vulnerability Report:** Use the [GitHub Security Advisory](https://github.com/aayushsharma141/dr-sr/security/advisories) tab on the repository to submit a private report.
2. **Include Reproduction Steps:** Provide a clear description of the potential vulnerability, affected components/endpoints, and reproduction steps or proof-of-concept scripts.
3. **Privacy Assurance:** Never include real patient data, production database dumps, or real credentials in vulnerability reports.

Reports will be acknowledged promptly and evaluated for severity, remediation, and patch distribution.
