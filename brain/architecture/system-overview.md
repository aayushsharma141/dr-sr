# System Overview

## Product direction

The active product direction is v3: a centralized, fully offline-capable web application used over the hospital's local area network (LAN). It is not a cloud-hosted SaaS application and must not require internet access for normal clinic operation.

## Runtime topology

- One designated central server PC hosts the API, PostgreSQL database, and private patient-photo storage.
- Approximately 3–5 clinic PCs access the application through a browser over the trusted clinic LAN.
- Browser clients do not connect directly to PostgreSQL or shared database files.
- The server is the authoritative location for data, authentication, authorization, audit events, and backups.

## Technology baseline

| Layer | Current baseline |
|---|---|
| Frontend | React 19, TypeScript, Vite |
| Backend | Python FastAPI |
| Database | PostgreSQL 18 |
| ORM and migrations | SQLAlchemy 2, Alembic |
| Authentication | Server-managed cookie sessions |
| Password hashing | Argon2id |
| Browser protections | CSRF protections and server-side permission checks |
| Patient images | Private server-side file storage, served through an authorized API |

Exact dependency versions are maintained in `backend/pyproject.toml` and `frontend/package.json`. Verify those files before changing versions.

## Implemented functional boundary

According to the project state ledger, Phases 11–13 are recorded complete:

- Foundation, authentication, fixed roles, permission checks, optimistic concurrency, first-admin bootstrap, and audit-event writing.
- Clinic settings, doctor profiles, fee catalogue, patient registry, URN allocation, search, demographic edits, duplicate warning, photo streaming, and registration print spike.
- Appointments, per-doctor token queues, appointment status transitions, doctor queue, clinical encounters, finalization, and addenda.

Phase 14 (prescriptions, treatment plans/packages, physiotherapy sessions and VAS) is next. Phases 15–17 (billing, receipts and reversals; audit viewer and backup/restore/integrity; LAN deployment and final acceptance) remain planned. Permission enum values or roadmap entries do not prove those modules are implemented.

## Historical boundary

The older PySide6 + SQLite desktop application is retained as historical reference. Do not treat it as the v3 runtime architecture. In particular, do not place a SQLite database on a network share for concurrent clinic use.

## Operational constraints

- Normal application workflows must work without internet connectivity.
- All clients use the central API; no client-side direct database access.
- Patient photos and clinical data are sensitive and must remain within the controlled server environment.
- Deployment and production acceptance require real LAN, power-recovery, printer, and restore testing; a passing unit-test suite alone is insufficient.
