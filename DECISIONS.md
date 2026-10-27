# Architecture & Project Decisions Record (ADR)
## Kalyan Hospital — Offline Patient & Physiotherapy Management System

**Version:** 1.0  
**Project Budget:** ₹22,000  
**Delivery Scope:** 4–6 Weeks (Solo Developer + AI Pair)  

---

## Decision Log

### ADR-01: Desktop Technology Stack — Python, PySide6, and SQLite
- **Status:** Approved
- **Context:** The software must run 100% offline on a single Windows desktop PC with high UI responsiveness, reliable local printing, and zero ongoing licensing/hosting costs within the ₹22,000 budget.
- **Decision:** Use Python 3.10+, PySide6 (official Qt 6 bindings), and SQLite 3.
- **Rationale:** PySide6 provides native Windows look-and-feel, rock-solid printing/PDF engines, and modular widgets without requiring a web browser runtime (Electron / Chromium) which consumes high RAM. SQLite is zero-configuration and built directly into Python.

---

### ADR-02: Strictly Offline, Single-Workstation Boundary
- **Status:** Approved
- **Context:** Requests for multi-computer LAN syncing or cloud access were evaluated against the ₹22,000 budget ceiling.
- **Decision:** The initial MVP is strictly limited to a single standalone Windows PC with local storage. Cloud syncing, web portals, and multi-PC LAN databases are explicitly deferred to future commercial contracts.
- **Rationale:** Multi-master LAN synchronization or cloud API backends would introduce massive network resilience, latency, and concurrency challenges incompatible with the fixed budget and timeline.

---

### ADR-03: Currency Arithmetic Stored in Integer Paise
- **Status:** Approved
- **Context:** Medical billing and treatment fee tracking require 100% precision without IEEE 754 binary floating-point rounding errors (e.g., `0.1 + 0.2 != 0.3`).
- **Decision:** Store all monetary figures (`agreed_fee_paise`, `amount_paise`) as integers representing paise (1 INR = 100 paise). The UI handles conversion to and from decimal rupees only for display and input parsing.
- **Rationale:** Ensures exact arithmetic when summing installments and calculating remaining balances.

---

### ADR-04: Full 12-Field Form Layout with Dual Signatures (Patient/Attendant & Authorized)
- **Status:** Approved per Official Prescription Pad & Form Specification
- **Context:** The initial brief explored omitting the patient signature, but the client's physical layout and form specification provided on 2026-10-28 explicitly includes:
  1. Deep maroon Kalyan Hospital header with dual clinic branches (Ara & Gadhani) and consulting physiotherapists (Dr. Madan Mohan Dwivedi & Dr. Chandan Kr. Dwivedi).
  2. The 12 numbered fields + Patient Picture box.
  3. Dual bottom signatures: `Patient / Attendant Signature` and `Authorized Signature`, along with `Date`.
- **Decision:** The registration and print engine will faithfully implement all 12 canonical fields, the dedicated Patient Picture box, and both signature lines as specified by the client.
- **Rationale:** Aligns 100% with Kalyan Hospital's active physical workflow and legal/patient consent documentation.

---

### ADR-05: Strict Layered Service-Repository Architecture
- **Status:** Approved
- **Context:** AI coding assistants often generate tight coupling between UI button click handlers and raw SQL queries, making code brittle and difficult to test or refactor.
- **Decision:** Enforce four distinct layers:
  1. Presentation (`app/ui/`)
  2. Business Logic (`app/services/`)
  3. Data Access (`app/repositories/`)
  4. Storage (`app/db/`)
- **Rationale:** UI events only call services; services handle rules and validation; repositories execute parameterized SQL. This allows 100% automated test coverage without launching the Qt event loop for every business rule.

---

### ADR-06: Verified Restore Pipeline for Local Backups
- **Status:** Approved
- **Context:** A backup is useless if it cannot be restored or if restoring an incomplete file corrupts live clinic data.
- **Decision:** Use SQLite's native hot backup API (`Connection.backup()`). Restores are verified by testing into an isolated temporary database and verifying row counts and integrity before replacing active data.
- **Rationale:** Prevents data corruption and ensures honest, verifiable backup status in clinic operations.

---

### ADR-07: Staged 5-Phase Demo Delivery Strategy
- **Status:** Approved
- **Context:** Building the entire system in one monolithic push risks delivering an untestable application or discovering misaligned requirements at the final hour.
- **Decision:** Deconstruct the build into 5 incremental stages (Stage A: Shell & Dashboard → Stage B: Patient Registration → Stage C: Treatment & Payments → Stage D: A4 Printing & Backup → Stage E: Demo Hardening).
- **Rationale:** Enables early demonstration to the client after Stage B, validating form layouts and workflows well before final handover.

---

### ADR-08: Fictional Data Policy for Development and Demos
- **Status:** Approved
- **Context:** Patient privacy and healthcare confidentiality must be maintained during AI assistance and client demonstrations.
- **Decision:** All automated tests, sample databases, screenshots, and client walkthroughs utilize 100% synthetic fictional patient records (e.g. "Ramesh Kumar", "Sita Devi").
- **Rationale:** Eliminates any risk of exposing real patient medical data in version control, logs, or public demos.

---

### ADR-09: Separate Application Palette from Physical Prescription Branding
- **Status:** Approved for UI redesign branch
- **Context:** The earlier app shell used deep maroon across most interface surfaces because the physical prescription pad uses maroon. The supplied trust and hospital marks emphasize green, blue, and gold, and the maroon-heavy UI competed with clinical content.
- **Decision:** Use trust green (`#155B43`) for the application identity and primary actions, clinical blue (`#234B86`) for secondary actions, restrained gold (`#C39A35`) for small highlights, a neutral canvas (`#F5F7F5`), and teal (`#0D9488`) for focus/interaction. Keep the maroon prescription header in the A4 document builder.
- **Rationale:** Distinguishes the working desktop application from the printed form while grounding the UI palette in the actual trust/hospital branding.

---
*Decisions logged and baselined.*
