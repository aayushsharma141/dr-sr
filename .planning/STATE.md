---
gsd_state_version: '1.0'
milestone: 'v3.0'
milestone_name: 'Centralized LAN Web Platform'
status: in_progress
current_phase: 17
progress:
  total_phases: 7
  completed_phases: 6
  active_phase: 17
  percent: 95
---

# Project State: Kalyan Hospital Patient & Physiotherapy Management

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-10-31) and root `PRD.md` (v3.0 baseline).

**Core value:** Reliable, internet-free shared patient records for reception and doctors across the hospital LAN, enforced by server-side permissions, with auditable changes and a backup proven to restore.
**Current focus:** Milestone v3.0 — Phase 14 Complete; Phase 15 (Billing, Receipts & Reversals) next.

## Current Position

Phase: 16 (Audit Viewer, Backup/Restore & Integrity) — COMPLETE (7/7 plans complete)
Next Phase: 17 (LAN Deployment, Print Setup & UAT Acceptance)
Status: Phase 16 Complete & Verified
Last activity: 2026-11-02 — Phase 16 complete (Filterable audit log viewer with Before/After diffs and credential redaction, SHA-256 checksummed backup bundle generator with secondary destination support, fail-closed restore engine with automatic pre-restore safety snapshot, 5-pillar clinical/financial/file integrity diagnostic engine, REST endpoints + headless server CLI subcommands, React admin dashboards, 92.80% backend coverage across 591 tests, 339-cell RBAC matrix, 75 frontend tests passing, zero legacy v2.0 drift). (Consultation fee and package instalment collection, integer paise math, database trigger overpayment rejection, atomic sequential receipt numbering with 20-thread concurrency proof, dual 80mm thermal and A5 receipt printing with DUPLICATE watermark, dynamic pending dues ledger, admin-only reversal with mandatory justification, unified chronological patient timeline, 93.39% backend coverage across 555 tests, 314-cell RBAC matrix, 70 frontend tests passing, 0 lint/typecheck errors, legacy v2.0 untouched).

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
| 17 | LAN Deployment, Printer & Acceptance | Next up |

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
- Phase 14 complete:
  - Plan 14-01: Migration 0004 and models for prescriptions, prescription items, treatment plans, treatment sessions, and session addenda; PostgreSQL database triggers `trg_prevent_finalised_treatment_session_tampering` and `trg_sync_treatment_plan_session_progress`.
  - Plan 14-02: Prescriptions REST API with itemized medications, frequency presets, instructions, doctor silo isolation, and audit trail (`RX-01`).
  - Plan 14-03: Treatment Plans REST API with optimistic concurrency (409 Conflict), mandatory cancellation reason, and doctor silo isolation (`TRT-01`).
  - Plan 14-04: Physiotherapy Treatment Sessions & Addenda REST API with row-locking concurrency, 400 Bad Request immutability locks, and chronological dated addenda (`TRT-02`, `TRT-03`).
  - Plan 14-05: Frontend Prescriptions Workspace and Bilingual Print Slip with `@media print` styling (`PrescriptionWorkspace.tsx`, `PrescriptionPrint.tsx`).
  - Plan 14-06: Frontend Treatment Plan Workspace, Session Logger Modal with VAS 0–10 pain slider, and SVG VAS trend chart (`TreatmentPlanWorkspace.tsx`, `SessionLoggerModal.tsx`, `VasTrendChart.tsx`).
  - Plan 14-07: Phase 14 Integration Gate test (`test_phase14_gate.py`), RBAC matrix completeness (279 cells), 93.07% backend coverage (505 tests), 62 frontend tests passing, clean build, legacy isolation verified.
- Open items: confirm server hardware and LAN; plan SQLite to PostgreSQL data migration; client approval of the full feature list.
- Toolchain: Node.js LTS v26.13.0 and PostgreSQL 18.6-5 active and operational.
