# Kalyan Hospital — Patient & Physiotherapy Platform

**Product direction: v3.0 centralized offline LAN web platform.**

<badge>Cannot be rendered in Markdown</badge>

## Current implementation status

The current `main` branch contains both the legacy PySide6 + SQLite desktop application and the v3 centralized LAN web platform.

- **v2 desktop:** retained as historical reference; do not share its SQLite database over a network drive.
- **v3 Phase 11:** foundation, authentication, fixed roles, server-side permission checks, optimistic concurrency, first-admin bootstrap and audit-event writing implemented. Phase gate evidence is recorded in `.planning/STATE.md`.
- **v3 Phase 12:** clinic settings, doctor profiles, fee catalogue, patient registry, atomic URN allocation, search, demographic edits, duplicate warning, photo streaming and A4 registration print spike implemented.
- **v3 Phase 13:** appointments, per-doctor token queues, appointment status transitions, doctor queue, clinical encounters, finalization and addenda implemented.
- **Next:** Phase 14 — prescriptions, treatment plans/packages and physiotherapy sessions with VAS.
- **Not yet delivered:** Phase 15 billing/receipts/reversals; Phase 16 audit viewer/backup/restore/integrity; Phase 17 LAN deployment and final acceptance.

Phase completion is not equivalent to client production acceptance. Review the recorded test evidence and unresolved permission findings before deployment.

## Architecture

- React 19 + TypeScript + Vite single-page application
- Python FastAPI backend
- PostgreSQL 18, SQLAlchemy 2 and Alembic migrations
- Cookie-based sessions, Argon2id password hashing and CSRF protections
- One central server with browser clients over the clinic LAN; runtime does not require internet

Exact dependency pins are maintained in `backend/pyproject.toml` and `frontend/package.json`.

## Documentation

- [Product requirements](PRD.md)
- [Architecture](ARCHITECTURE.md)
- [Security policy and permission findings](SECURITY.md)
- [Architecture decisions](DECISIONS.md)
- [Implementation roadmap](TASKS.md)
- [Test and acceptance plan](TEST_PLAN.md)
- [Deployment plan](DEPLOYMENT.md)
- [Legacy migration policy](MIGRATION.md)
- [Detailed phase roadmap](.planning/ROADMAP.md)
- [Requirement traceability](.planning/REQUIREMENTS.md)
- [Current project state](.planning/STATE.md)
- [Project knowledge base](brain/README.md)

## First administrator setup

The first administrator is created through the one-time server-console-code setup flow. No default production credentials are intended. Public bootstrap is disabled after successful creation; recovery is through the local administrative CLI procedure. See `SECURITY.md` and the Phase 11 plan/evidence.

## Known permission follow-up

The current role catalogue grants `PHOTO_READ` to Reception but not Admin or Doctor, while the patient-photo download endpoint requires `PHOTO_READ`. This is tracked as a permission-matrix finding; do not assume Admin/Doctor photo access. The role policy also needs client review before production acceptance. See `SECURITY.md`.

## Development and verification

The current Phase 13 state record reports 422 backend tests, 92.51% backend coverage and 58 frontend tests passing at the Phase 13 gate. These are recorded project results, not a fresh test run in this documentation pass. Re-run CI against the target commit before release.

Use synthetic patient data in tests and demos. Never commit real patient records/photos, credentials, setup codes, production databases or backups.

---

Kalyan Hospital — श्री वशिष्ठ कल्याण ट्रस्ट
