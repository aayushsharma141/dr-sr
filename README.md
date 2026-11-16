# Kalyan Hospital — Patient & Physiotherapy Platform

**Product direction: v3.0 centralized offline LAN web platform.**

> **Current Status (November 2026):** The v3.0 React + FastAPI + PostgreSQL centralized offline LAN platform is fully implemented, verified, and operational. Phases 11 through 21 are complete, and Phase 22 (Integrated OPD Workflow) is actively deployed through Wave 2. All 15 core hospital modules are backed by comprehensive automated test suites and live UAT validation.

## Product goal

Shared patient records for reception, doctors, and administration across 3–5 workstations on the hospital LAN without internet dependency. One central server owns authentication, permissions, records, files, clinical history, payments, audit logs, and verified database backups.

## Technology Stack

- **Frontend:** React 18, TypeScript 5, Vite, TailwindCSS, Lucide-React, TanStack Query
- **Backend:** Python 3.12, FastAPI 0.162, SQLAlchemy 2.0, Alembic migrations, Pydantic v2
- **Database:** PostgreSQL 16 (LAN centralized, row-level locking, strict relational integrity)
- **File Storage:** Private server-side patient photo and document storage with access-controlled streaming
- **Deployment:** Single on-premises server hosting API and static SPA, serving browser-based LAN clients

## Core Implemented Capabilities

1. **Authentication & Governance:** Argon2id hashing, secure session management, single active session enforcement, one-time console bootstrap wizard, and immutable security audit logs.
2. **Patient Registry & Identity:** Permanent canonical URN generation, Devanagari/English safe search, demographic edits with before/after audit, and secure webcam photo capture.
3. **Integrated OPD Intake & Triage:** Single-step Check-in & Token desk, booking lookup, referred-by tracking (Self, Doctor, Personal, Organization), and 3-tier classification (Normal, Priority, Emergency) with doctor emergency alert banners and acknowledgment timestamps.
4. **Independent Doctor Queues:** Multi-department routing, daily monotonic token generation per `(doctor_id, date)`, waiting room live queue with same-visit doctor reassignment.
5. **Universal Consultation Workspace:** Auto-save encounter drafts, vitals with BMI, diagnoses, versioned specialty templates (General, Ophthalmology, Physiotherapy), Rx prescription pad, and dated addenda.
6. **Physiotherapy & Rehabilitation:** Treatment packages, session decrementing on completion, VAS pain scale tracking, and treatment history.
7. **Billing & Financial Ledger:** Integer-paise accounting, fee snapshotting at check-in, doctor-authorized fee adjustments, medicine billing, previous dues segregation, receipt generation with duplicate markers, and admin-only reversals with mandatory justification.
8. **Administration & Data Tools:** Hospital profile & branding, bilingual print templates (Prescription, Receipt, Registration Card), CSV/Excel patient import/export staging pipelines, and automated database backup/restore with integrity checks.

## Verification & Test Metrics

- **Backend Pytest Suite:** 1,392 tests collected across 78 test files (1,391 passed, 1 skipped, 0 failed).
- **Frontend Vitest Suite:** 427 tests across 65 suites (422 passed, 5 skipped, 0 failed).
- **Consolidated Live UAT Suite:** 182 test cases executed against live PostgreSQL (`kalyan_test`) with 160 passed (87.9%), 0 blocked, 1 known architectural defect, and 21 future Wave 3/4 scope. See [`docs/engineering/KALYAN_OPD_UAT_CONSOLIDATED_REPORT.md`](docs/engineering/KALYAN_OPD_UAT_CONSOLIDATED_REPORT.md).
- **Code Health & Safety:** Route policies enforce server-side RBAC across 100+ endpoints; no real patient data is ever used in tests or documentation.

## Documentation Index

- [PRD](PRD.md): Clinical requirements, invariants, and acceptance gates
- [Architecture](ARCHITECTURE.md): System design, network topologies, and data boundaries
- [Engineering Status](docs/engineering/PROJECT_STATUS.md): Current campaign progress, active branches, and test counts
- [Consolidated UAT Report](docs/engineering/KALYAN_OPD_UAT_CONSOLIDATED_REPORT.md): Live end-to-end UAT findings and test assertions
- [Module Inventory](docs/engineering/MODULE_INVENTORY.md): Comprehensive 15-module frontend and backend map
- [API Inventory](docs/engineering/API_INVENTORY.md): Endpoints, handlers, and RBAC permission markers
- [Decisions](DECISIONS.md): Architectural decision records (ADR-01 through ADR-26, OD-22-01 through OD-22-19)
- [Tasks & Roadmap](TASKS.md): Implementation phases and progress tracking
- [Phase 22 Design](.planning/phases/22-integrated-opd-workflow/22-DESIGN.md): Integrated OPD Workflow specification
- [Security](SECURITY.md): Threat model, bootstrap procedure, and permission matrices
- [Deployment](DEPLOYMENT.md): On-premises server setup, LAN configuration, and handover instructions

## First Administrator Setup

No default production credentials exist. On a fresh installation with an empty database:
1. The server generates a cryptographically random, short-lived one-time code printed only to the server console.
2. The browser setup wizard at `/` consumes the code atomically to create the initial administrator account.
3. The bootstrap endpoint is permanently disabled after successful execution. CLI recovery is available for break-glass scenarios.

## Legacy Reference Code

The `legacy/` directory contains the earlier single-workstation PySide6 + SQLite desktop application. It is retained strictly as historical business logic reference and migration source. It is never used or shared across the LAN.

## Privacy & Safety

Always use synthetic patient data in tests, benchmarks, and documentation. Never commit patient records, credentials, setup codes, production databases, or backups.

---
Kalyan Hospital — श्री वशिष्ठ कल्याण ट्रस्ट