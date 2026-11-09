# KALYAN HOSPITAL — ENGINEERING GOVERNANCE

## Mission
Maintain and stabilize the existing Kalyan Hospital offline LAN management application. Do not rebuild the application or redesign working modules without a documented reason.

Documented replacement (ADR-27, 2026-11-09): the project owner chose to replace the v3 FastAPI + React + PostgreSQL application with the Node.js application in `hms/`. The plan and task IDs (SW-xx) are in `docs/plans/UI-ADOPTION-PLAN-2026-11-09.md`. Until cutover, `backend/` and `frontend/` (tag `v3-fastapi-final`) are the reference specification for Kalyan business rules. Do not build new features in them.

## Architecture
Inspect the real codebase before assuming the stack. Preserve existing frontend, backend and database architecture unless a verified defect requires change.
- Target (ADR-27): `hms/`, built on Node.js LTS, Express 5, SQLite through better-sqlite3 (WAL), and a plain ES-module browser app with no build step, served by the same process on the LAN. Only that process opens the database file; never put it on a network share.
- Reference only: `backend/` (FastAPI + PostgreSQL), `frontend/` (React + TypeScript) and `legacy/app/` (PySide6 desktop).

## Hospital business invariants
1. One permanent patient URN across all departments.
2. One patient can have multiple visits.
3. One visit can have multiple doctor consultations.
4. Each doctor has an independent queue.
5. Queue entries belong to the correct visit and doctor.
6. Reception owns routine payment collection.
7. Doctors cannot independently collect payments.
8. Multiple charges can accumulate within a visit.
9. One invoice can have multiple payment transactions.
10. Payment history must never be silently overwritten.
11. Physiotherapy sessions are deducted only on treatment completion.
12. Clinical records must retain their correct consultation relationships.
13. Backend authorization is mandatory.
14. Normal operations must work without internet.
15. All workstations must use authoritative central data.

## Development restrictions
- Inspect before editing.
- Preserve existing user changes.
- Never reset the production database.
- Never use real patient data for testing.
- Never delete historical financial or clinical records to simplify testing.
- Never invent business rules.
- Never suppress errors to produce false success.
- Never weaken permissions to make a workflow work.
- Never claim a test passed without evidence.

## Agent coordination
- Discovery agents are read-only.
- Each implementation task has one owner.
- Never allow concurrent editing of the same file.
- Shared API and database changes require coordination.
- Maintain task IDs and dependency records.
- Review all changes before integration.
- Keep a Git checkpoint before every repair batch.

## Definition of done
A feature is VERIFIED only when:
1. Frontend interaction passes.
2. API behaviour passes.
3. Database persistence passes.
4. Related modules update correctly.
5. Authorization passes.
6. Reload persistence passes.
7. Regression tests pass.
An implementation without verification must be marked: IMPLEMENTED — NOT VERIFIED.

## Reporting
Every agent must report:
- Task ID
- Owned files
- Findings
- Root cause
- Changes
- Test commands
- Test results
- Dependencies
- Remaining risks
Never report unverified functionality as complete.

