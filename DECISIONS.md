# Architecture Decision Record — Kalyan Hospital

**Current baseline:** v3.0 centralized offline LAN platform.  
**Implementation snapshot:** Phases 11–13 recorded complete in `.planning/STATE.md`.  
**Important:** Code implementation does not automatically equal client approval. Open operational and policy decisions remain open until the client confirms them.

## Current v3 decisions

### ADR-14 — Centralized browser-based LAN application
**Status:** Implemented. One central server provides a React + TypeScript SPA and FastAPI API to browser clients on the clinic LAN. Runtime is designed to work without internet.

### ADR-15 — PostgreSQL for centralized transactions
**Status:** Implemented. PostgreSQL is the central database; SQLAlchemy and Alembic manage persistence and schema evolution.

### ADR-16 — FastAPI backend and React frontend
**Status:** Implemented. Backend owns business rules and authorization; one frontend contains role-specific areas.

### ADR-17 — Fixed server-enforced role catalogue
**Status:** Implemented in code; final client policy approval still required. Admin, Reception and Doctor are the fixed roles. See `backend/src/kalyan_api/core/permissions.py`. A current permission discrepancy is recorded in `SECURITY.md`: Admin and Doctor do not receive `PHOTO_READ` in the role map although the photo download endpoint requires it.

### ADR-18 — One-time first administrator bootstrap
**Status:** Implemented and included in the Phase 11 completion record. The server-console code is consumed atomically; public setup is disabled after first-admin creation; recovery is local CLI only. See Phase 11 plans and tests before release.

### ADR-19 — Immutable finalized clinical history
**Status:** Partially implemented. Phase 13 encounters support finalization lock and dated addenda. Prescriptions and physiotherapy sessions are Phase 14 scope; do not mark the entire clinical-history requirement complete yet.

### ADR-20 — Transactional numbering and concurrency
**Status:** Partially implemented. Patient URN allocation and appointment token allocation are implemented with transactional/concurrency controls. Receipt numbering and concurrent payment validation remain Phase 15. Define cancellation/void semantics before promising gap-free numbering in every business scenario.

### ADR-21 — Database plus files backup
**Status:** Planned, not implemented for v3. PostgreSQL plus patient-file bundle, checksum manifest, scheduled backup and staged/clean-machine restore belong to Phase 16/17.

### ADR-22 — Legacy desktop is reference, not v3 runtime
**Status:** Implemented as repository boundary. Preserve PySide6/SQLite code for historical reference; reuse only reviewed business rules, assets and tests. Do not share the legacy SQLite file over a network drive.

## Decision register — implementation vs client confirmation

| ID | Subject | Code/document evidence | Status / action |
|---|---|---|---|
| OD-01 | Server PC, OS, RAM, storage, fixed IP, UPS | Not established by source code | Client confirmation required |
| OD-02 | Doctor record visibility / silo | Phase 13 code scopes appointment queues and clinical encounters to the authenticated doctor; encounters are doctor-owned | Implemented as a strict doctor silo in current code; client must confirm this is the intended clinical policy before production |
| OD-03 | Financial reversal authority | Role catalogue reserves reversal for Admin; billing module not yet implemented | Proposed; confirm before Phase 15 |
| OD-04 | Receipt sequence reset | Billing/receipt module not yet implemented | Client choice required before Phase 15 |
| OD-05 | Genuine v2 data exists? | Legacy SQLite app exists; production data status unknown | Inspect with client; migrate only with approval |
| OD-06 | Printer | A4 print spike exists; physical printer acceptance is Phase 17 | Confirm actual printer and sign-off |
| OD-07 | HTTPS | LAN deployment policy not yet accepted | Client decision required; HTTP is unencrypted |
| OD-08 | Idle timeout and lockout thresholds | Phase 11 controls implemented; numeric policy must be checked against current config and approved | Verify configured values and confirm |
| OD-09 | Backup schedule, retention and owner | Phase 16 not implemented | Client decision required |
| OD-10 | Fee catalogue/effective dates | Phase 12 fee catalogue implemented | Confirm fee values and effective-date operating policy |
| OD-11 | Demographic edit rights | Current role map grants PATIENT_UPDATE to Reception, not Admin or Doctor; patient update route audits before/after | Implemented as Reception-only edit in code; confirm Admin exclusion is intended |
| OD-12 | URN gap semantics | Annual sequence uses transactional upsert in patient-registration transaction | Race-safe transactional allocation implemented; confirm void/cancel policy and gap-free business definition |

## Historical v2 desktop decisions

ADR-01 through ADR-13 describe the earlier PySide6/SQLite desktop application and remain historical, not current v3 architecture:
- Python/PySide6/SQLite: superseded for v3.
- Single-workstation boundary: superseded by centralized LAN.
- Integer-paise billing: retained principle; v3 ledger is Phase 15.
- 12-field form and dual signatures: retained; actual printer acceptance remains outstanding.
- Layered service/repository separation: retained as a design principle with an API layer.
- SQLite hot backup: superseded by PostgreSQL + files backup.
- Synthetic demo data: retained.
- Trust-led UI palette and maroon print branding: retained as design guidance.

Update this record when a client decision changes the approved baseline. Never change an implementation status to “client approved” without recorded approval.
