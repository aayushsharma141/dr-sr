---
gsd_state_version: '1.0'
milestone: 'v3.0'
milestone_name: 'Centralized LAN Web Platform'
status: completed
current_phase: 17
progress:
  total_phases: 7
  completed_phases: 7
  active_phase: null
  percent: 100
---

# Project State: Kalyan Hospital Patient & Physiotherapy Management

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-10-31) and root `PRD.md` (v3.0 baseline).

**Core value:** Reliable, internet-free shared patient records for reception and doctors across the hospital LAN, enforced by server-side permissions, with auditable changes and a backup proven to restore.
**Current focus:** Milestone v3.0 — COMPLETE (Phases 11-17 fully implemented, verified, and signed off).

## Current Position

Phase: 17 (LAN Deployment, Print Verification & Acceptance) — COMPLETE (5/5 plans complete)
Status: Milestone v3.0 Complete & Verified
Last activity: 2026-11-02 — Milestone v3.0 completed. Phase 17 delivered: offline LAN deployment bundle with zero Node.js on server PC (`deploy/install.ps1`, `start-server.bat`, `stop-server.bat`), auto-recovery via Windows Scheduled Tasks (`register-autostart.ps1`, `unregister-autostart.ps1`, `health-check.ps1`), real-printer layout sign-off for 80mm thermal receipts, A5 consultation slips, and A4 double-signature registration cards (`print-layouts.test.tsx`), full acceptance suite with multi-role LAN operational simulation, clean-machine disaster recovery rehearsal, and 5-point clinical/financial integrity audit (`test_phase17_acceptance.py`). Full suite: 597 backend tests passing (92.80% coverage), 339-cell RBAC matrix, 24 frontend test suites (78 tests) passing, clean production build, zero drift against legacy desktop code.

## Phase Overview

Phases 11-17 (continuing from v2.0, which ended at Phase 10). See `.planning/ROADMAP.md` and `TASKS.md`.

| Phase | Name | Status |
| ------- | ------ | -------- |
| 11 | Decisions Gate, Foundation & Auth | Complete (16/16 plans) |
| 12 | Clinic Settings & Patient Registration | Complete (8/8 plans) |
| 13 | Appointments & Clinical Encounters | Complete (7/7 plans) |
| 14 | Prescriptions, Treatment Plans & Sessions | Complete (7/7 plans) |
| 15 | Billing, Receipts & Reversals | Complete (7/7 plans) |
| 16 | Audit Viewer, Backup/Restore & Integrity | Complete (7/7 plans) |
| 17 | LAN Deployment, Printer & Acceptance | Complete (5/5 plans) |
| 18 | UI/UX Review Hardening | In progress: plans 01-05 closed (04 printer waiver; 05 criterion 4 unmet, 36 existing violations capped); 06-08 not started (no code for them on this branch); manual accessibility checks outstanding |

## Accumulated Context

- v2.0 PySide6 + SQLite desktop app (phases 1–10) is complete and archived at `.planning/milestones/v2.0-restart-phases/`. It is the reference for domain rules only.
- Phase 11 complete: offline LAN PostgreSQL 18.6 + sync SQLAlchemy 2.0.55 + FastAPI 0.162.0 backend, Vite 8.3.5 / React 19.3.1 SPA with Argon2id auth, HttpOnly session cookies, CSRF protection, optimistic locking with 409 ConflictBanner, first-run console setup wizard, and append-only audit trail.
- Phase 12 complete: Clinic settings, doctor profiles, fee catalogue, atomic gap-free URN service (`KH-YYYY-XXXX`), duplicate warning banner, multi-modal search, demographic modification with 409 conflict handling, photo service with authenticated streaming, printable A4 registration card.
- Phase 13 complete: Appointment scheduling and token queueing, 4-state lifecycle (`BOOKED`, `ARRIVED`, `IN_CONSULTATION`, `DONE`/`CANCELLED`), doctor consultation workspace, immutable clinical notes with PostgreSQL tamper-prevention triggers, chronological encounter addenda, and doctor silo privacy isolation (`D-03`, `D-04`).
- Phase 14 complete: Itemized medication prescriptions with bilingual instructions (`RX-01`), physiotherapy treatment packages with session quota tracking (`TRT-01`), immutable session logger with VAS score progression (`TRT-02`, `TRT-03`), session addenda, and DB triggers preventing session modification.
- Phase 15 complete: Billing, sequential receipt numbering with atomic year-based cycle, integer paise math, database trigger overpayment rejection, dual 80mm thermal and A5 receipt printing with DUPLICATE watermark, dynamic pending dues ledger, admin-only reversal with mandatory justification, unified chronological patient timeline.
- Phase 16 complete: Filterable audit log viewer with Before/After diffs and credential redaction, SHA-256 checksummed backup bundle generator with secondary destination support, fail-closed restore engine with automatic pre-restore safety snapshot, 5-pillar clinical/financial/file integrity diagnostic engine, REST endpoints + headless server CLI subcommands, React admin dashboards.
- Phase 17 complete: Offline production deployment scripts for Windows server PC with zero Node.js on server, pull-the-plug power cut auto-recovery via Windows scheduled tasks, watchdog health monitor, real-printer layout sign-off (80mm thermal receipt, A4 registration card, A5 slips), end-to-end acceptance suite simulating multi-role LAN operations, disaster recovery drill, and milestone v3.0 sign-off.

### Roadmap Evolution

- Phase 18 added (2026-11-02): UI/UX Review Hardening. Fixes every finding from the post-acceptance UI/UX and code review of the web frontend (receipt printing, native dialogs, non-blocking errors, text size and contrast, Hindi font and language marking, form accessibility, webcam HTTPS, print verification).
