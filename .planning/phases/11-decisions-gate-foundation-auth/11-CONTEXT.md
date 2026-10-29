# Phase 11: Decisions Gate, Foundation & Auth - Context

**Gathered:** 2026-10-30  
**Status:** Ready for planning  

<domain>
## Phase Boundary

Phase 11 delivers the authoritative entry gate resolution, repo scaffolding for the PostgreSQL + FastAPI backend, Alembic database migrations, RBAC role-routed authentication (`/admin`, `/reception`, `/doctor`), session security controls (rate-limiting, lockout, 409 optimistic locking), and the canonical transactional audit-event writer (`AUD-01`).

</domain>

<decisions>
## Implementation Decisions

### 1. Server Hardware, UPS & Network Security
- **D-01:** Workstations access central server via plain HTTP on a dedicated, isolated private hospital subnet (e.g., `http://192.168.1.50:8000`). This eliminates self-signed SSL certificate installation overhead and browser warnings on staff machines across the offline clinic LAN.
- **D-02:** The central server PC must be protected by a dedicated 600VA+ line-interactive UPS. PostgreSQL write transactions will run with `synchronous_commit = on` to ensure complete data integrity against sudden Bhojpur grid power failures. — **Reversibility:** costly — changing database durability config affects all subsequent write pipelines.

### 2. Access Control & Cross-Doctor Visibility
- **D-03:** Strict Silo Doctor Partitioning: Doctors can only view, search, and access patients and clinical encounters assigned directly to their `doctor_id`. A doctor cannot access another doctor's clinical records. — **Reversibility:** one-way — database query filters and RBAC scopes enforce doctor-siloed data partitioning across all future clinical tables.
- **D-04:** Strict Default-Deny on Reception Access: Reception staff accounts can access patient demographics, appointments, and billing/dues. The FastAPI backend strictly blocks reception role from reading or writing clinical SOAP notes, prescriptions, and physiotherapy session logs (`SEC-02`).

### 3. Receipt Numbering & Reversal Rules
- **D-05:** Receipt Numbering Sequence Cycle is made configurable in the Admin Panel (`SET-01`). The system supports Indian Financial Year (`RCPT-2627-XXXX`, 1 Apr – 31 Mar) and Calendar Year (`RCPT-2026-XXXX`), defaulting to Indian Financial Year to satisfy Sri Vashishtha Kalyan Trust accounting compliance. — **Reversibility:** costly — affects sequence generators in billing.
- **D-06:** Reversals and refunds are strictly restricted to the Admin role only. Every reversal requires a mandatory reason, writes a contra-record in the billing ledger, and emits an immutable event to `audit_logs` (`AUD-01`). Reception staff cannot void receipts.

### 4. Session Lifecycle & Concurrency Controls
- **D-07:** Inactivity session expiration is set to 30 minutes. Account lockout triggers after 5 consecutive failed login attempts, applying a 15-minute cooldown period unless unlocked sooner by an Administrator (`SEC-04`).
- **D-08:** Concurrency conflict resolution (`SEC-05`): Every mutable entity carries a `version_id`. Stale updates return HTTP 409 Conflict. The client interface displays a clear warning: *"Record was modified by another user"* and provides a 1-click reload to re-fetch the latest state without silent data overwrites.

### Claude's Discretion
- Scaffolding folder structure for FastAPI (`backend/app/...`) and Alembic migrations.
- JWT / HTTP-only cookie session token storage mechanism for web browser clients.
- Rate-limiting threshold implementation on `/auth/login` endpoint.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Specifications & Architecture
- `.planning/PROJECT.md` — Core hospital constraints, trust details (श्री वशिष्ठ कल्याण ट्रस्ट), and ₹22,000 budget ceiling.
- `.planning/REQUIREMENTS.md` — Full v3.0 requirement specifications (SEC-01 through SEC-06, AUD-01).
- `.planning/ROADMAP.md` § Phase 11 — Phase 11 success criteria and entry gate mandates.
- `.planning/research/ARCHITECTURE.md` — Centralized LAN FastAPI + PostgreSQL web architecture.
- `.planning/research/STACK.md` — FastAPI, SQLAlchemy 2.0, Alembic, PostgreSQL, Pydantic v2 conventions.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets & Historical Reference
- `app/db/schema.sql` (v2.0): Canonical tables and columns (patients, treatment_cases, treatment_sessions, payments, doctors, audit_logs) provide the domain model for SQLAlchemy 2.0 models and Alembic migrations.
- `app/services/audit_service.py`: Standard audit action schema (`action`, `actor`, `entity_type`, `entity_id`, `details`, `timestamp`) serves as the foundation for the async `AUD-01` writer in FastAPI.

### Established Patterns
- Integer-paise financial calculations (`amount_paise INTEGER`) must be preserved in PostgreSQL schemas.
- Explicit `try...finally` resource closure and database transaction management.

</code_context>

<specifics>
## Specific Ideas
- The admin dashboard must expose the sequence format toggle (Financial Year vs Calendar Year) under clinic settings.
- First boot of the web platform prompts the first-run admin initialization wizard (`SEC-04`) with zero hardcoded default credentials in the repository.

</specifics>

<deferred>
## Deferred Ideas
- Multi-doctor cross-case sharing (if the clinic later requests co-managing complex cases) will be considered in a post-v3.0 update.
- HTTPS local cert distribution utility deferred unless hospital network topology changes.

</deferred>

---

*Phase: 11-Decisions Gate, Foundation & Auth*
