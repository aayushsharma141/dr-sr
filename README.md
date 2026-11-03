# Kalyan Hospital — Patient & Physiotherapy Platform

**Product direction: v3.0 centralized offline LAN web platform.**

> Status: The current main branch contains the earlier PySide6 + SQLite single-workstation desktop application. The v3 React + FastAPI + PostgreSQL platform is the target architecture and has not yet been implemented. Do not deploy or describe the legacy desktop application as the v3 LAN system.

## Product goal

Shared patient records for reception and doctors across 3–5 PCs on the hospital LAN without internet dependency. One central server owns authentication, permissions, records, files, clinical history, payments, audit and backups.

## Target stack

- React + TypeScript frontend
- Python FastAPI backend
- PostgreSQL central database and Alembic migrations
- Private server-side patient file storage
- One on-premises server and browser-based LAN clients

## Documentation

- [PRD](PRD.md): requirements and acceptance gates
- [Architecture](ARCHITECTURE.md): system design and data boundaries
- [Security](SECURITY.md): threat model, bootstrap and permission tests
- [Decisions](DECISIONS.md): proposed, historical and unresolved decisions
- [Tasks](TASKS.md): v3 implementation phases
- [Deployment](DEPLOYMENT.md): server setup and handover
- [Migration](MIGRATION.md): legacy code/data policy
- [Planning state](.planning/STATE.md): current v3 planning status

## First administrator setup

No default production credentials. On a fresh server with no administrator, a one-time code is printed only to the server console. The browser setup wizard consumes it atomically to create the first administrator. Public bootstrap is permanently disabled after success. Recovery is local CLI only.

## Legacy desktop application

The existing app/ source is a Python/PySide6 desktop app backed by local SQLite. It contains patient, treatment, billing, print and local backup functionality. It remains a reference/migration source, not a centralized LAN server. Never share its SQLite database over a network drive.

## Development status

- Legacy desktop planning milestone: previously marked complete.
- v3 documentation: being baselined on a dedicated branch.
- v3 implementation: not yet evidenced in the current source tree.
- Client approval: open hardware, role, receipt, printer and HTTPS decisions remain.

A green CI run or checked planning box is not clinic acceptance. Record tests, printer validation and restore evidence before release.

## Privacy

Use synthetic patient data in tests and demos. Never commit patient records/photos, credentials, setup codes, production databases or backups.

---
Kalyan Hospital — श्री वशिष्ठ कल्याण ट्रस्ट

## License

Proprietary. All rights reserved; see [LICENSE](LICENSE). Security reporting and controls are described in [SECURITY.md](SECURITY.md).
