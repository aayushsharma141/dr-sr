---
gsd_state_version: '1.0'
milestone: 'v3.0'
milestone_name: 'Centralized LAN Web Platform'
status: planning
current_phase: null
progress:
  total_phases: 7
  completed_phases: 0
  active_phase: null
  percent: 0
---

# Project State: Kalyan Hospital Patient & Physiotherapy Management

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-10-30)

**Core value:** Reliable, internet-free shared patient records for reception and doctors across the hospital LAN, enforced by server-side permissions, with auditable changes and a backup proven to restore.
**Current focus:** Milestone v3.0 — defining requirements.

## Current Position

Phase: 11 (Decisions Gate, Foundation & Auth)
Plan: 0 of 16 complete
Status: Planned, ready to execute
Last activity: 2026-10-30 — Phase 11 planned (16 plans; user chose first-run web wizard, EG-17)

## Phase Overview

Phases 11-17 (continuing from v2.0, which ended at Phase 10). See `.planning/ROADMAP.md`.

| Phase | Name | Status |
|-------|------|--------|
| 11 | Decisions Gate, Foundation & Auth | Not started |
| 12 | Clinic Settings & Patient Registration | Not started |
| 13 | Appointments & Clinical Encounters | Not started |
| 14 | Prescriptions, Treatment Plans & Sessions | Not started |
| 15 | Billing, Receipts & Reversals | Not started |
| 16 | Audit Viewer, Backup/Restore & Integrity | Not started |
| 17 | LAN Deployment, Printer & Acceptance | Not started |

## Accumulated Context

- v2.0 PySide6 + SQLite desktop app (phases 1–10) is complete and archived at `.planning/milestones/v2.0-restart-phases/`. It is the reference for domain rules only.
- Open items: confirm server hardware and LAN; plan SQLite to PostgreSQL data migration; client approval of the full feature list.
- Tooling note: Node.js is not installed on the dev machine, so `gsd-tools.cjs` cannot run; GSD artifacts are being maintained by hand. Node is also required to build the React frontend.
