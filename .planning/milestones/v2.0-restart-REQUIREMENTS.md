# Requirements: Kalyan Hospital Patient & Physiotherapy Management

**Defined:** 2026-10-28  
**Core Value:** Reliable, zero-cloud offline patient registration, physiotherapy clinical history, and payment tracking on a single clinic computer with 100% data persistence and verifiable local backup.

## v1 Requirements

Requirements for initial MVP release. Each maps directly to roadmap phases.

### Dashboard & Navigation (DASH)

- [x] **DASH-01**: User sees real-time patient count, today's registrations, active cases, and pending fee balance calculated directly from SQLite.
- [x] **DASH-02**: User can navigate between Patients, Treatments, Billing, and Backup via left sidebar.
- [x] **DASH-03**: Application displays authentic hospital branding (KALYAN HOSPITAL / श्री वशिष्ठ कल्याण ट्रस्ट).

### Patient Registration & Search (PAT)

- [x] **PAT-01**: System automatically generates a unique, human-readable patient ID (`KH-YYYY-XXXX`).
- [x] **PAT-02**: User can register a patient with Name, Age, Sex, Mobile, Address, Referral Source, Condition, and Registration Timestamp.
- [x] **PAT-03**: User can attach a patient photograph stored in local application data directory.
- [x] **PAT-04**: User can search patients in real time by ID, Name, or Mobile number.
- [x] **PAT-05**: User can reopen and edit an existing patient record without data loss.

### Treatment Cases & Sessions (TRT)

- [x] **TRT-01**: User can open or create a physiotherapy treatment case for a patient.
- [x] **TRT-02**: User can log a dated treatment session with notes, therapist name, treatment modalities, and pain score.
- [x] **TRT-03**: User can view complete chronological history of past treatment sessions without modification of earlier records.

### Billing & Payments (BIL)

- [x] **BIL-01**: User can record the total agreed treatment fee for a case.
- [x] **BIL-02**: User can record partial payment installments with timestamp and payment mode (Cash, UPI).
- [x] **BIL-03**: System calculates outstanding balance automatically using integer paise arithmetic.
- [x] **BIL-04**: System prevents negative payment amounts and flags overpayment attempts.

### Printing & PDF Export (PRN)

- [x] **PRN-01**: User can preview and print an A4 patient registration card reproducing official clinic branding, maroon header, and doctor credentials.
- [x] **PRN-02**: Registration printout faithfully structures all 12 canonical fields, Patient Picture box, and dual signature lines (Patient/Attendant Signature & Authorized Signature) + Date.
- [x] **PRN-03**: User can export the registration document directly as a local PDF file.

### Data Safety & Backups (BAK)

- [x] **BAK-01**: User can create a local timestamped database backup using SQLite hot backup API.
- [x] **BAK-02**: System validates backup integrity and record counts before allowing database restoration.

### Security & Access Control (SEC)

- [x] **SEC-01**: System provides password-protected administrator access for sensitive clinic actions.
- [x] **SEC-02**: System operates 100% offline with zero external network dependencies.

## v2 Requirements

Deferred to subsequent release / commercial expansion.

### Multi-PC & Networking
- **NET-01**: LAN-based multi-terminal synchronization for front desk and doctor consulting rooms.
- **NET-02**: Concurrent database locking and conflict resolution.

### Invoicing & Communications
- **COM-01**: Offline SMS / WhatsApp receipt dispatch via local GSM dongle or optional internet bridge.
- **COM-02**: Detailed itemized pharmacy and consumables billing ledger.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Cloud Database (Firebase / AWS) | High ongoing recurring subscription cost; conflicts with zero-internet requirement. |
| Multi-PC Real-Time LAN Networking | Exceeds v1 single-workstation scope; requires separate networking/concurrency agreement. |
| Inpatient Bed & Ward Management | Project scope is strictly outpatient and physiotherapy clinical cases. |
| Full Accounting / Tax Filing ERP | Exceeds ₹22,000 budget and 4–6 week timeline; clinic uses separate accounting. |
| Biometric Fingerprint Hardware | Requires specialized USB SDKs and driver maintenance; keyboard search is sufficient. |

## Traceability

Which phases cover which requirements.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DASH-01 | Phase 1: App Shell & Dashboard | Complete ✓ |
| DASH-02 | Phase 1: App Shell & Dashboard | Complete ✓ |
| DASH-03 | Phase 1: App Shell & Dashboard | Complete ✓ |
| PAT-01 | Phase 2: Patient Registration & Search | Complete ✓ |
| PAT-02 | Phase 2: Patient Registration & Search | Complete ✓ |
| PAT-03 | Phase 2: Patient Registration & Search | Complete ✓ |
| PAT-04 | Phase 2: Patient Registration & Search | Complete ✓ |
| PAT-05 | Phase 2: Patient Registration & Search | Complete ✓ |
| TRT-01 | Phase 3: Treatment & Payment Tracking | Complete ✓ |
| TRT-02 | Phase 3: Treatment & Payment Tracking | Complete ✓ |
| TRT-03 | Phase 3: Treatment & Payment Tracking | Complete ✓ |
| BIL-01 | Phase 3: Treatment & Payment Tracking | Complete ✓ |
| BIL-02 | Phase 3: Treatment & Payment Tracking | Complete ✓ |
| BIL-03 | Phase 3: Treatment & Payment Tracking | Complete ✓ |
| BIL-04 | Phase 3: Treatment & Payment Tracking | Complete ✓ |
| PRN-01 | Phase 4: A4 Printing & Local Backup | Complete ✓ |
| PRN-02 | Phase 4: A4 Printing & Local Backup | Complete ✓ |
| PRN-03 | Phase 4: A4 Printing & Local Backup | Complete ✓ |
| BAK-01 | Phase 4: A4 Printing & Local Backup | Complete ✓ |
| BAK-02 | Phase 4: A4 Printing & Local Backup | Complete ✓ |
| SEC-01 | Phase 5: Demo Hardening & Security | Complete ✓ |
| SEC-02 | Phase 5: Demo Hardening & Security | Complete ✓ |

**Coverage:**
- v1 requirements: 22 total
- Mapped to phases: 22
- Unmapped: 0 ✓

---
*Requirements defined: 2026-10-28*
*Last updated: 2026-10-28 after initial definition*
