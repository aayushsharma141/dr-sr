# Architecture Decision Record — Kalyan Hospital

**Current baseline:** v3.0 centralized LAN platform.  
**Status:** Target decisions; unresolved items require client approval.  
**Historical record:** ADR-01 through ADR-13 describe the earlier desktop application and are retained below as history, not current v3 architecture.

## Current v3 decisions

### ADR-14 — Centralized browser-based LAN application
**Status:** Product direction agreed in project discussions. One central server provides a single React + TypeScript app and FastAPI API to 3–5 browser clients on LAN. Internet is not required at runtime.

### ADR-15 — PostgreSQL for centralized transactions
**Status:** Superseded by ADR-27 (2026-11-09). Previously: recommended target, subject to server hardware assessment. Do not share a SQLite database file over the network. PostgreSQL provides transactional concurrency, constraints and row-level locking.

### ADR-16 — FastAPI backend and React frontend
**Status:** Superseded by ADR-27 (2026-11-09). Previously: proposed target. Backend owns business rules and authorization; one frontend has role-specific routes. Separate frontend apps per role are not required.

### ADR-17 — Fixed server-enforced role catalogue
**Status:** Required scope; detailed matrix awaits client approval. Admin, Reception and Doctor. Every protected API endpoint must enforce permissions. Recommended doctor policy: read clinically relevant records, write assigned cases only.

### ADR-18 — One-time first administrator bootstrap
**Status:** Required target behavior. When no administrator exists, server prints a cryptographically random one-time code to local console. Browser wizard consumes code and creates first administrator atomically. Public setup is permanently disabled after success. Recovery is local CLI only.

### ADR-19 — Immutable finalized clinical and financial history
**Status:** Required. Finalized clinical records are corrected by dated addenda. Posted payments are corrected by authorized compensating reversal with mandatory reason. No silent deletion/edit.

### ADR-20 — Transactional numbering and concurrency
**Status:** Required. URN and receipt allocation must be unique under concurrency. Stale updates return 409. Payment validation and posting occur in one transaction. Define gap semantics for rolled-back/void records before promising gap-free numbers.

### ADR-21 — Database plus files backup
**Status:** Required. Backup PostgreSQL data and referenced files with checksums, manual/scheduled runs and second physical drive. Verify in staging before restore cutover. Clean-machine restore is a handover gate.

### ADR-22 — Legacy desktop is reference, not v3 runtime
**Status:** Proposed. Preserve PySide6/SQLite code; reuse only reviewed business rules, assets, print layouts and tests. Migration only if real data exists and client approves.

### ADR-23 — Reception coverage, doctor queues and payment ownership
**Status:** User-confirmed product decision (2026-11-04). Reception handles intake and OPD routing for all configured hospital departments and specialties. Each doctor maintains an independent daily appointment/queue/token sequence. Reception is the sole payment-collection role: RECEPTION may create/post payments; ADMIN may read and perform authorized reversals but must not post collections; DOCTOR has no payment-write permission. This does not include full IPD, pharmacy, laboratory or specialty-specific clinical modules. Department/specialty membership must be represented explicitly in clinic configuration and enforced when assigning a doctor.

### ADR-24 — Department deactivation preserves doctor memberships
**Status:** Confirmed by project owner on 2026-11-06. Deactivating a department retains existing doctor-to-department memberships. Inactive departments cannot receive new doctor assignments or new appointments. Removing an existing membership is an explicit Admin action. Historical appointment department associations remain unchanged.

### ADR-25 — Inactive doctor visibility is Admin-only
**Status:** Confirmed by project owner on 2026-11-06. Only Admin may retrieve inactive/retired doctors by requesting `include_inactive=true`. Reception and Doctor users receive active doctors only, even when they request inactive records.

### ADR-26 — Queue token monotonicity and permanent consumption
**Status:** Confirmed operating policy (2026-11-06). Daily tokens are generated as strictly monotonically increasing integers scoped per `(doctor_id, appointment_date)`. Once assigned to an appointment, a token number is permanently consumed. When an appointment is marked `CANCELLED` or `NO_SHOW`, its token number is never backfilled, recycled, or reissued to another patient. Gaps in the active waiting queue are expected, audited, and preserved in appointment history.

### ADR-27 — Replace the v3 FastAPI/React application with the Node.js LAN application
**Status:** Decided by project owner on 2026-11-09. Plan and task IDs: `docs/plans/UI-ADOPTION-PLAN-2026-11-09.md`.
**Decision:** The hospital application becomes the Node.js app in `hms/`: Node.js LTS, Express 5, SQLite through better-sqlite3 in WAL mode, and a plain ES-module browser app served by the same process, with no build step. It started from a from-scratch implementation that the owner preferred for its interface, workflow and simplicity. The v3 FastAPI + PostgreSQL backend and React frontend (tag `v3-fastapi-final`) stop receiving features and become the reference specification for Kalyan business rules until cutover, when they move to `legacy/v3-fastapi/`. Nothing is deleted.
**Supersedes:** ADR-15 (PostgreSQL) and ADR-16 (FastAPI + React). ADR-14 still holds, apart from its stack names: one central server and browsers on the LAN, with no internet at runtime.
**Conditions:** The database file is opened only by the single server process and is never placed on a network share. Every business invariant in `AGENTS.md` and ADR-17 to ADR-26 still applies and must be re-implemented in `hms/` before go-live, including three roles, Reception-only payment collection, Admin-only reversals, per-doctor tokens, immutable finalised records, 409 on stale edits and FY receipt numbering. Any real data in the v3 PostgreSQL database moves one way only, with a reconciliation report, and the source database is never modified.

## Open decisions — do not silently assume

| ID | Decision | Recommendation | Status |
|---|---|---|---|
| OD-01 | Server PC, OS, RAM, storage, fixed IP, UPS | Assess existing PC; UPS strongly recommended | Pending |
| OD-02 | Doctor record visibility | Read clinically relevant records; write assigned only | Pending |
| OD-03 | Financial reversal authority | Admin only, mandatory reason | Pending |
| OD-04 | Receipt sequence reset | Calendar or financial year; client chooses | Pending |
| OD-05 | Genuine v2 data exists? | Inspect before migration; demo data is not production data | Resolved 2026-11-09: owner states there is no real patient data; go-live starts from a fresh install (ADR-27) |
| OD-06 | Printer | Standard Epson A4 desktop printer on plain A4 sheet; thermal not used | Resolved |
| OD-07 | HTTPS | Prefer HTTPS; HTTP only by explicit approval on isolated LAN | Pending |
| OD-08 | Idle timeout and lockout thresholds | Agree during security acceptance | Pending |
| OD-09 | Backup schedule, retention and owner | Daily scheduled plus manual pre-upgrade/restore; confirm policy | Pending |
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