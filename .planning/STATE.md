---
gsd_state_version: '1.0'
milestone: 'v3.0'
milestone_name: 'Centralized LAN Web Platform'
status: in_progress
current_phase: 13
progress:
  total_phases: 7
  completed_phases: 2
  active_phase: 13
  percent: 43
---

# Project State: Kalyan Hospital Patient & Physiotherapy Management

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-10-31)

**Core value:** Reliable, internet-free shared patient records for reception and doctors across the hospital LAN, enforced by server-side permissions, with auditable changes and a backup proven to restore.
**Current focus:** Milestone v3.0 — Phase 12 Complete; Phase 13 (Appointments & Clinical Encounters) next.

## Current Position

Phase: 12 (Clinic Settings & Patient Registration) — COMPLETE (8/8 plans complete)
Next Phase: 13 (Appointments & Clinical Encounters)
Status: Phase 12 Complete & Verified
Last activity: 2026-11-01 — Phase 12 Plans 05–08 complete (Admin clinic settings & doctor/fee screens, reception patient registration with duplicate warning, searchable directory, demographic editing modal with ConflictBanner, printable A4 registration card, 92.01% backend coverage, 50 frontend tests, 0 lint errors, legacy v2.0 untouched).

## Phase Overview

Phases 11-17 (continuing from v2.0, which ended at Phase 10). See `.planning/ROADMAP.md`.

| Phase | Name | Status |
|-------|------|--------|
| 11 | Decisions Gate, Foundation & Auth | Complete (16/16 plans) |
| 12 | Clinic Settings & Patient Registration | Complete (8/8 plans) |
| 13 | Appointments & Clinical Encounters | Next up |
| 14 | Prescriptions, Treatment Plans & Sessions | Not started |
| 15 | Billing, Receipts & Reversals | Not started |
| 16 | Audit Viewer, Backup/Restore & Integrity | Not started |
| 17 | LAN Deployment, Printer & Acceptance | Not started |

## Accumulated Context

- v2.0 PySide6 + SQLite desktop app (phases 1–10) is complete and archived at `.planning/milestones/v2.0-restart-phases/`. It is the reference for domain rules only.
- Phase 11 complete: offline LAN PostgreSQL 18.6 + sync SQLAlchemy 2.0.55 + FastAPI 0.162.0 backend, Vite 8.3.5 / React 19.3.1 SPA with Argon2id auth, HttpOnly session cookies, CSRF protection, optimistic locking with 409 ConflictBanner, first-run console setup wizard, and append-only audit trail.
- Phase 12 complete:
  - Plan 12-01: Migration 0002 and models for clinic settings, doctor profiles, fees, URN sequences, and patients.
  - Plan 12-02: Clinic settings, doctor profiles, and fee schedule REST endpoints with optimistic locking and audit logging.
  - Plan 12-03: Atomic URN service (`KH-YYYY-XXXX`), 20-thread concurrency race proof, patient registration endpoint with 12 canonical fields, and duplicate detection endpoint.
  - Plan 12-04: Multi-modal search across URN/mobile/English/Hindi, demographic modification with 409 conflict control and audit diffs, secure photo storage and authenticated streaming.
  - Plan 12-05: Frontend Admin Settings & Doctors/Fees screens with optimistic locking and `ConflictBanner`.
  - Plan 12-06: Reception patient registration screen (`/reception/patients/new`) with canonical demographic fields, proactive duplicate warning banner, and photo upload.
  - Plan 12-07: Searchable patient directory (`/reception/patients`), patient profile detail view (`/reception/patients/:id`), and demographic edit modal with 409 conflict handling.
  - Plan 12-08: A4 printable Registration Card component, full integration gate test (`test_phase12_gate.py`), 92.01% backend coverage, 50 frontend tests, and manual verification records.
- Open items: confirm server hardware and LAN; plan SQLite to PostgreSQL data migration; client approval of the full feature list.
- Toolchain: Node.js LTS v26.13.0 and PostgreSQL 18.6-5 active and operational.
