# Approved and Implemented Decisions

This register separates technical decisions already represented in the implementation from client policy choices that remain open. “Implemented” does not mean the client has approved the resulting workflow or that production acceptance is complete.

| Topic | Current decision/baseline | Evidence/status |
|---|---|---|
| Product architecture | v3 centralized offline LAN web application | Implemented direction; React/TypeScript, FastAPI, PostgreSQL |
| Legacy desktop | PySide6 + SQLite is historical reference, not v3 runtime | Documented boundary |
| Authentication | Individual accounts, server-managed sessions, Argon2id | Implemented in Phase 11 record |
| Role model | Fixed Admin, Reception, Doctor roles with named permissions | Implemented; exact grants in backend permissions module |
| First administrator | One-time server-console setup code; public bootstrap closes after creation; local CLI recovery | Implemented in Phase 11 record |
| Patient URN | Annual sequence allocation through transactional PostgreSQL upsert | Implemented; race-safe allocation behavior recorded |
| Patient edits | Version-checked updates with audit before/after | Implemented |
| Doctor access | Strict doctor silo for appointment/encounter data | Implemented; client policy confirmation still required |
| Clinical finalization | Finalized content is not silently overwritten; dated addenda used for corrections where supported | Partially implemented in Phase 13 |
| Financial representation | Integer paise is the invariant for the planned financial module | Requirement; Phase 15 not yet delivered |
| Backup scope | Database and patient files must be backed up/restored as a consistent set | Requirement; Phase 16 not yet delivered |
| Release acceptance | LAN deployment, power recovery, printer, restore and integrity tests required | Planned acceptance; not yet established |

## Decision change process

A change to these decisions requires:
1. A written rationale and affected invariants.
2. Client approval when the change affects clinical, privacy, financial, or operational policy.
3. Tests covering the new behavior and denied cases.
4. Updates to this register, relevant architecture/security docs, and planning records.
