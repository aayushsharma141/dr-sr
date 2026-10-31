---
gsd_state_version: '1.0'
milestone: 'v3.0'
milestone_name: 'Centralized LAN Web Platform'
status: in_progress
current_phase: 11
progress:
  total_phases: 7
  completed_phases: 0
  active_phase: 11
  percent: 10
---

# Project State: Kalyan Hospital Patient & Physiotherapy Management

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-10-31)

**Core value:** Reliable, internet-free shared patient records for reception and doctors across the hospital LAN, enforced by server-side permissions, with auditable changes and a backup proven to restore.
**Current focus:** Milestone v3.0 — Phase 11 execution.

## Current Position

Phase: 11 (Decisions Gate, Foundation & Auth)
Plan: 10 of 16 complete
Status: In progress
Last activity: 2026-10-31 — Phase 11 Plan 10 complete (user lifecycle operations: deactivate with session revocation, reactivate, admin reset-password with one-time temporary password issuance, admin unlock before cooldown expiration, and no-deletion enforcement)

## Phase Overview

Phases 11-17 (continuing from v2.0, which ended at Phase 10). See `.planning/ROADMAP.md`.

| Phase | Name | Status |
|-------|------|--------|
| 11 | Decisions Gate, Foundation & Auth | In progress (10/16 plans) |
| 12 | Clinic Settings & Patient Registration | Not started |
| 13 | Appointments & Clinical Encounters | Not started |
| 14 | Prescriptions, Treatment Plans & Sessions | Not started |
| 15 | Billing, Receipts & Reversals | Not started |
| 16 | Audit Viewer, Backup/Restore & Integrity | Not started |
| 17 | LAN Deployment, Printer & Acceptance | Not started |

## Accumulated Context

- v2.0 PySide6 + SQLite desktop app (phases 1–10) is complete and archived at `.planning/milestones/v2.0-restart-phases/`. It is the reference for domain rules only.
- Open items: confirm server hardware and LAN; plan SQLite to PostgreSQL data migration; client approval of the full feature list.
- Toolchain: Node.js LTS v26.13.0 and PostgreSQL 18.6-5 active and operational.
- Frontend UI Plan Proposal: Detailed architecture & design proposal drafted at `docs/plans/frontend-ui-plan.md` (uncommitted, under review). Proposes React + TypeScript (Vite, Tailwind CSS + shadcn/ui, React Router, TanStack Query & Table, React Hook Form + Zod, openapi-typescript), design tokens matching the approved crimson letterhead, role-based screens (/reception, /doctor, /admin), browser webcam capture over LAN HTTPS, A4 dual-signature print matching SAMPLE.pdf, and flags 5 open decisions (HTTPS for camera, doctor-to-doctor note visibility, department names, patient/attendant signature line, and library version/licence confirmation) before building.
