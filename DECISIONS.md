# Architecture Decision Record — Kalyan Hospital

**Current baseline:** v3.0 centralized LAN platform (Implemented & Operational).  
**Status:** Phases 11–21 implemented; Phase 22 (Integrated OPD Workflow) decisions agreed and frozen (2026-11-15).  
**Historical record:** ADR-01 through ADR-13 describe the earlier desktop application and are retained below as history, not current v3 architecture.

## Current v3 decisions

### ADR-14 — Centralized browser-based LAN application
**Status:** Implemented and Operational. One central on-premises server provides a single React 18 + TypeScript SPA and FastAPI API to 3–5 browser clients on the hospital LAN. Internet is not required at runtime.

### ADR-15 — PostgreSQL for centralized transactions
**Status:** Implemented and Operational. PostgreSQL 16 is the central database engine. It provides transactional concurrency, constraints, row-level locking, and Alembic migrations. SQLite network sharing is prohibited.

### ADR-16 — FastAPI backend and React frontend
**Status:** Implemented and Operational. The Python FastAPI backend owns all business logic, authorization, and transactional boundaries. One unified React frontend provides role-scoped views and navigation.

### ADR-17 — Fixed server-enforced role catalogue
**Status:** Implemented and Operational. Roles: `ADMIN`, `RECEPTION`, `DOCTOR`. Every protected endpoint enforces server-side route policies with 724 automated matrix tests. Doctors can read cross-doctor clinical history and edit their own assigned consultations.

### ADR-18 — One-time first administrator bootstrap
**Status:** Implemented and Operational. When no administrator exists, the server prints a cryptographically random setup code to the server console. The browser wizard consumes it atomically to create the first admin and permanently disables bootstrap routes.

### ADR-19 — Immutable finalized clinical and financial history
**Status:** Implemented and Operational. Finalized clinical records are immutable and corrected only via dated addenda. Posted payments are immutable; adjustments require authorized compensating reversals with mandatory reasons.

### ADR-20 — Transactional numbering and concurrency
**Status:** Implemented and Operational. URN and receipt allocations are transactional and unique under concurrency. Stale updates return HTTP 409 (`version_conflict`).

### ADR-21 — Database plus files backup
**Status:** Implemented and Operational. Backups bundle PostgreSQL dumps and private patient files into checksummed archives. Restoration is verified in an isolated staging database before production cutover.

### ADR-22 — Legacy desktop is reference, not v3 runtime
**Status:** Implemented and Operational. The legacy PySide6/SQLite desktop codebase is retained strictly as a reference and migration source.

### ADR-23 — Reception coverage, doctor queues and payment ownership
**Status:** User-confirmed product decision (2026-11-04). Reception handles intake and OPD routing for all configured hospital departments and specialties. Each doctor maintains an independent daily appointment/queue/token sequence. Reception is the sole payment-collection role: RECEPTION may create/post payments; ADMIN may read and perform authorized reversals but must not post collections; DOCTOR has no payment-write permission.

### ADR-24 — Department deactivation preserves doctor memberships
**Status:** Confirmed by project owner on 2026-11-06. Deactivating a department retains existing doctor-to-department memberships. Inactive departments cannot receive new doctor assignments or new appointments. Removing an existing membership is an explicit Admin action.

### ADR-25 — Inactive doctor visibility is Admin-only
**Status:** Confirmed by project owner on 2026-11-06. Only Admin may retrieve inactive/retired doctors by requesting `include_inactive=true`. Reception and Doctor users receive active doctors only.

### ADR-26 — Queue token monotonicity and permanent consumption
**Status:** Confirmed operating policy (2026-11-06). Daily tokens are generated as strictly monotonically increasing integers scoped per `(doctor_id, appointment_date)`. Once assigned to an appointment, a token number is permanently consumed. When an appointment is marked `CANCELLED` or `NO_SHOW`, its token number is never backfilled or recycled.

---

## Phase 22 Integrated OPD Workflow Decisions (Frozen 2026-11-15)

| Decision ID | Summary | Architectural Policy |
|---|---|---|
| **OD-22-01** | First Reception Tab | **Check-in & Token** is the default reception tab. Navigation order: Check-in & Token, Dashboard, Patient Records, Appointments, Waiting Room, Billing & Checkout, Receipts, Reports. |
| **OD-22-02** | Check-in Screen Layout | Two-column layout: Left column = Check-in form (New / Existing patient); Right column = Today's Bookings panel (Check in, No-show, Cancel, Reschedule). |
| **OD-22-03** | Single-Step Registration | Check-in registers new patients (permanent URN) and checks them in with an opened visit, doctor token, and triage status in one atomic action. |
| **OD-22-04** | Existing Patient URN Reuse | Existing patients searched by URN, name, or phone never receive a new URN; a new visit is opened or joined. |
| **OD-22-05** | Visit Classification (Clinical) | Visit type recorded as `NEW` or `FOLLOW_UP` for clinical and reporting purposes only; does not automatically dictate fees. |
| **OD-22-06** | 3-Tier Triage Classification | Triage status: `NORMAL`, `PRIORITY` (amber), or `EMERGENCY` (red). Non-normal status requires a mandatory reason, preserved in append-only history. |
| **OD-22-07** | Computed Queue Ordering | Queue priority: Emergency (by alert time) → Priority (by token) → Normal (by token). Monotonic token numbers never change. |
| **OD-22-08** | Doctor Calling Discretion | Doctors may call any waiting patient from the queue; reordering never interrupts an active consultation. |
| **OD-22-09** | Persistent Emergency Alerts | Emergency check-ins trigger an immediate, non-blinking alert banner on the assigned doctor's screen until explicitly acknowledged by the doctor with recorded timestamps. |
| **OD-22-10** | Consultation Fee Snapshot | At check-in, the assigned doctor's active consultation fee is snapshotted into `bill_items`. Subsequent fee edits do not affect existing bills. |
| **OD-22-11** | Doctor Fee Discretion | Doctors may reduce, discount, or waive their own consultation fees with a documented reason. |
| **OD-22-12** | Follow-up Pricing Extensibility | Future follow-up pricing rules (e.g., free revisit within N days) are accommodated by the bill-line schema but remain unconfigured for now. |
| **OD-22-13** | Dispensed Medicines Billing | Prescribing medications does not automatically bill. Reception bills medicines actually dispensed at checkout with name, quantity, unit, and rate. |
| **OD-22-14** | Itemized Bill Categories | Bill line items are categorized: Consultation, Procedures/Services, Treatment Packages, Medicines, Additional Particulars. |
| **OD-22-15** | Financial Audit Integrity | All price corrections record original value, revised value, reason, actor, and timestamp. Posted payments are never overwritten. |
| **OD-22-16** | Mandatory Referred-By | Every visit requires a referral source (default `SELF`; categories: `SELF`, `DOCTOR`, `PERSONAL`, `ORGANIZATION`, `OTHER`). |
| **OD-22-17** | Previous Dues Segregation | Prior outstanding balances are displayed beside the current visit bill, never merged into it, and collected against their own ledger entries. |
| **OD-22-18** | Patient Out with Balance | Payment is not a prerequisite to leaving; patients may be checked out (`Patient Out`) with an outstanding balance with a recorded reason. |
| **OD-22-19** | Role Boundary at Checkout | Doctors own clinical encounter completion. Reception owns checkout, billing, and payment collection. |
| **OD-22-20** | Reassign to any consulting doctor | Reassignment: reception may move a consultation to any consulting doctor on the same visit; the current department is kept when the new doctor belongs to it, otherwise reception picks one of the new doctor's departments (owner, 2026-11-15; CONTEXT Q19). |
| **OD-22-21** | Referral report admin-only | The referral report is admin-only; reception's Reports tab shows today's collection summary (owner, 2026-11-15; CONTEXT Q10). |

### Phase 22 owner answers (2026-11-15 and 2026-11-16)

| ID / Topic | Summary | Owner Decision & Policy |
|---|---|---|
| **OD-A** | Reception fee adjustments | Reception has no consultation fee adjustment rights. Consultation fee adjustments are reserved for the treating doctor (discount/waiver) and admin (correction), with mandatory reason. |
| **OD-B** | Prescribed medicine reference | Reception pharmacy reference view exposes prescribed `medicine_name` and `form` only, and reception types the quantity supplied (B2). Narrow, field-limited exception to D-04 clinical default-deny. |
| **OD-C** | Treatment package billing | Package agreed price stays on the treatment plan; doctor linking a package adds a reference line with ₹0 amount to prevent double-counting package dues. |
| **OD-D** | Checkout & payment timing | Payment collection is open once at least one consultation is completed, even if other consultations on the same visit remain in progress or waiting. |
| **OD-E** | Whole paise rounding | Line amounts are computed as `Decimal(quantity) * rate_paise` rounded half-up to integer whole paise. |
| **OD-F** | LAN status indicator | Option-b confirmed (22-02-SUMMARY): `LANStatusPill` mounted in `AppShell` header across all screen viewports, replacing legacy sidebar server indicator. |
| **OD-G** | Bill line voiding rights | Reception may void own same-day lines (`source == RECEPTION`, `created_by == me.id`, today's IST date) on open visits with reason; admin may void any non-consultation line with reason. |
| **OD-H** | Referred-By rules | Referred By required on all visits, defaulting to `SELF`; doctor, personal, and organization referrals require referrer name. |
| **OD-I** | Emergency alert persistence | Emergency alert banner on doctor workstation remains active until explicitly acknowledged by the doctor with recorded timestamps; no auto-dismissal. |
| **OQ-1** | Queue suggested ordering | Emergency first (by classification timestamp), then Priority (by token), then Normal (by token). Monotonic tokens never mutate. |
| **B2** | Supplied medicine quantity | Prescriptions store no quantities; reception types the quantity actually supplied at the billing desk. |
| **B3** | Doctor charge timing | Doctors may add procedure and package charges while consultation is `IN_CONSULTATION` or `COMPLETED` on an open visit; procedures count toward total upon completion. |
| **Q13** | Doctor charges view isolation | Doctor view (`GET /api/appointments/{id}/bill-items`) returns consultation line and doctor-recorded lines only. Strictly isolates from visit totals, payments, reception lines, and other doctors. |
| **Balance rules (i), (ii)** | Line timing rules | (i) Consultation and procedure lines count toward total once consultation is `COMPLETED`. (ii) Reception medicine and additional lines count toward total immediately. (iii) = OD-D. |
| **Line-edit rules (i), (iii), (iv), (v)** | Bill line mutation scope | (i) Reception may correct quantity/rate of own same-day lines with reason. (iii) Consultation lines not editable via line routes. (iv) Doctors do not void/correct lines. (v) Admin can void/correct any open non-consultation line. |
| **D-04 exception** | Scoped pharmacy reference | OD-B is a narrow, field-limited exception to D-04: strictly projects `prescription_item_id`, `medicine_name`, `form` without clinical notes, dosage, frequency, or diagnosis. |
| **Q17 exception** | Follow-up closure reason length | Owner-approved exception (2026-11-16): the follow-up closure reason keeps its 1000-character limit; every other reason field caps at 500. |

---

## Open Decisions

| ID | Decision | Recommendation | Status |
|---|---|---|---|
| OD-01 | Server PC, OS, RAM, storage, fixed IP, UPS | Dedicated server PC on static LAN IP with UPS protection | Implemented / LAN Ready |
| OD-02 | Doctor record visibility | Read cross-doctor records; write assigned cases only | Resolved & Implemented |
| OD-03 | Financial reversal authority | Admin only with mandatory justification | Resolved & Implemented |
| OD-04 | Receipt sequence reset | Financial year (April 1 – March 31) sequence reset | Implemented |
| OD-05 | Genuine v2 data exists? | Staging tests only; do not import unless client provides real export | Enforced in rules |
| OD-06 | Printer | Standard Epson A4 desktop printer on plain A4 sheet | Resolved & Implemented |
| OD-07 | HTTPS | Self-signed or local CA TLS proxy on LAN recommended | Pending client LAN setup |
| OD-08 | Idle timeout and lockout thresholds | 30-min idle timeout, 5 failed attempts lockout | Implemented |
| OD-09 | Backup schedule, retention and owner | Automated daily backup to secondary drive | Implemented |
| OD-10 | Fee catalogue/effective dates | Admin-managed fee catalogue with check-in snapshotting | Resolved & Implemented |
| OD-11 | Demographic edit rights | Reception edits with audit logging; medical notes locked | Resolved & Implemented |
| OD-12 | URN gap semantics | Gapless monotonic sequence with transaction lock | Resolved & Implemented |
| OD-10 | Fee catalogue/effective dates | Admin-managed and audited | Pending |
| OD-11 | Demographic edit rights | Reception edits with audit; clinical notes separate | Pending |
| OD-12 | URN gap semantics | Define rollback/void behavior before gap-free guarantee | Pending |

---

## Historical v2 desktop decisions — superseded or retained as principles

- **ADR-01 Python/PySide6/SQLite:** approved for single-workstation desktop only; superseded for v3.
- **ADR-02 Single-workstation boundary:** superseded by centralized LAN requirement.
- **ADR-03 Integer paise:** retained for v3 billing.
- **ADR-04 12-field form and dual signatures:** retained; actual printer acceptance required.
- **ADR-05 Layered service/repository architecture:** retained as separation principle; v3 adds API layer.
- **ADR-06 SQLite hot backup:** superseded by PostgreSQL + files bundle.
- **ADR-07 Five-stage desktop demo:** superseded by v3 Phases 11–17.
- **ADR-08 Synthetic demo data:** retained.
- **ADR-09 Trust-led UI palette and maroon print branding:** retained as design guidance.
- **ADR-10 QFluentWidgets licensing:** historical Qt decision only.
- **ADR-11 Dashboard activity must reflect persisted events:** retained.
- **ADR-12 Payment statuses derived from financial data:** retained.
- **ADR-13 Thermal receipt balance labeled current-at-print:** historical print rule; revalidate for v3.

Update this record whenever a client decision changes the approved v3 baseline.