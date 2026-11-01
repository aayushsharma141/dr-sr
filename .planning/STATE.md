---
gsd_state_version: '1.0'
milestone: 'v3.0'
milestone_name: 'Centralized LAN Web Platform'
status: in_progress
current_phase: 14
progress:
  total_phases: 7
  completed_phases: 3
  active_phase: 14
  percent: 57
---

# Project State: Kalyan Hospital Patient & Physiotherapy Management

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-10-31) and root `PRD.md` (v3.0 baseline).

**Core value:** Reliable, internet-free shared patient records for reception and doctors across the hospital LAN, enforced by server-side permissions, with auditable changes and a backup proven to restore.
**Current focus:** Milestone v3.0 — Phase 13 Complete; Phase 14 (Prescriptions, Treatment Plans & Sessions) next.

## Current Position

Phase: 13 (Appointments & Clinical Encounters) — COMPLETE (7/7 plans complete)
Next Phase: 14 (Prescriptions, Treatment Plans & Sessions)
Status: Phase 13 Complete & Verified
Last activity: 2026-11-01 — Phase 13 Plan 07 complete (Daily per-doctor token service, appointment state machine, doctor consultation queue, encounter workspace, finalized clinical note immutability with addenda, doctor silo security, 92.51% backend coverage across 422 tests, 58 frontend tests passing, 0 lint errors, legacy v2.0 untouched).

## Phase Overview

Phases 11-17 (continuing from v2.0, which ended at Phase 10). See `.planning/ROADMAP.md` and `TASKS.md`.

| Phase | Name | Status |
|-------|------|--------|
| 11 | Decisions Gate, Foundation & Auth | Complete (16/16 plans) |
| 12 | Clinic Settings & Patient Registration | Complete (8/8 plans) |
| 13 | Appointments & Clinical Encounters | Complete (7/7 plans) |
| 14 | Prescriptions, Treatment Plans & Sessions | Next up |
| 15 | Billing, Receipts & Reversals | Not started |
| 16 | Audit Viewer, Backup/Restore & Integrity | Not started |
| 17 | LAN Deployment, Printer & Acceptance | Not started |

## Accumulated Context

- v2.0 PySide6 + SQLite desktop app (phases 1–10) is complete and archived at `.planning/milestones/v2.0-restart-phases/`. It is the reference for domain rules only.
- Phase 11 complete: offline LAN PostgreSQL 18.6 + sync SQLAlchemy 2.0.55 + FastAPI 0.162.0 backend, Vite 8.3.5 / React 19.3.1 SPA with Argon2id auth, HttpOnly session cookies, CSRF protection, optimistic locking with 409 ConflictBanner, first-run console setup wizard, and append-only audit trail.
- Phase 12 complete: Clinic settings, doctor profiles, fee catalogue, atomic gap-free URN service (`KH-YYYY-XXXX`), duplicate warning banner, multi-modal search, demographic modification with 409 conflict handling, photo service with authenticated streaming, printable A4 registration card.
- Phase 13 complete:
  - Plan 13-01: Migration 0003 and models for appointments, encounters, addenda, and token sequences; database trigger for finalized note immutability.
  - Plan 13-02: Daily token allocation service with `SELECT ... FOR UPDATE` isolation and appointment booking REST API.
  - Plan 13-03: Appointment state machine (`BOOKED` -> `ARRIVED` -> `IN_CONSULTATION` -> `DONE` / `CANCELLED` / `NO_SHOW`) with cancellation reason tracking and doctor queue endpoints.
  - Plan 13-04: Clinical encounter and addenda REST API with doctor silo isolation (`D-03`, `D-04`) and reception default-deny (403).
  - Plan 13-05: Reception appointments booking modal and queue status board in React.
  - Plan 13-06: Doctor consultation queue and clinical encounter workspace with draft saving, finalization lock, and addenda recording.
  - Plan 13-07: Integration gate test (`test_phase13_gate.py`), 92.51% backend coverage across 422 tests, 58 frontend unit tests passing, clean build, and manual verification records.
- Open items: confirm server hardware and LAN; plan SQLite to PostgreSQL data migration; client approval of the full feature list.
- Toolchain: Node.js LTS v26.13.0 and PostgreSQL 18.6-5 active and operational.
