---
gsd_state_version: '1.0'
milestone: 'v3.0'
milestone_name: 'Centralized LAN Web Platform'
status: in_progress
current_phase: 11
progress:
  total_phases: 7
  completed_phases: 1
  active_phase: 12
  percent: 16
---

# Project State: Kalyan Hospital Patient & Physiotherapy Management

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-10-31)

**Core value:** Reliable, internet-free shared patient records for reception and doctors across the hospital LAN, enforced by server-side permissions, with auditable changes and a backup proven to restore.
**Current focus:** Milestone v3.0 — Phase 11 complete, ready for verification / Phase 12.

## Current Position

Phase: 11 (Decisions Gate, Foundation & Auth)
Plan: 16 of 16 complete
Status: Phase 11 Complete
Last activity: 2026-11-01 — Phase 11 Plan 16 complete (Phase 11 gate passed: boot smoke test, frozen stack, OpenAPI snapshot, 91.38% test coverage, entry-gate order verified, legacy isolation preserved, and M-1..M-6 manual checks passed).

## Phase Overview

Phases 11-17 (continuing from v2.0, which ended at Phase 10). See `.planning/ROADMAP.md`.

| Phase | Name | Status |
|-------|------|--------|
| 11 | Decisions Gate, Foundation & Auth | Complete (16/16 plans) |
| 12 | Clinic Settings & Patient Registration | Next |
| 13 | Appointments & Clinical Encounters | Not started |
| 14 | Prescriptions, Treatment Plans & Sessions | Not started |
| 15 | Billing, Receipts & Reversals | Not started |
| 16 | Audit Viewer, Backup/Restore & Integrity | Not started |
| 17 | LAN Deployment, Printer & Acceptance | Not started |

## Accumulated Context

- v2.0 PySide6 + SQLite desktop app (phases 1–10) is complete and archived at `.planning/milestones/v2.0-restart-phases/`. It is the reference for domain rules only.
- Phase 11 complete: offline LAN PostgreSQL 18.6 + sync SQLAlchemy 2.0.55 + FastAPI 0.162.0 backend, Vite 8.3.5 / React 19.3.1 SPA with Argon2id auth, HttpOnly session cookies, CSRF protection, optimistic locking with 409 ConflictBanner, first-run console setup wizard, and append-only audit trail.
- Open items: confirm server hardware and LAN; plan SQLite to PostgreSQL data migration; client approval of the full feature list.
- Toolchain: Node.js LTS v26.13.0 and PostgreSQL 18.6-5 active and operational.
