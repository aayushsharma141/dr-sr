# Project Changelog

This is a concise project-level history. Detailed implementation commits and phase plans remain in Git history and `.planning/`.

## 2026-11-15 — Phase 22 Integrated OPD Workflow & Comprehensive Live UAT

- Executed comprehensive live User Acceptance Test (UAT) suite against PostgreSQL staging (`kalyan_test`): 182 test cases evaluated, 160 passed (87.9%), 0 blocked, 1 known architectural defect identified in doctor transfer without department. Delivered `docs/engineering/KALYAN_OPD_UAT_CONSOLIDATED_REPORT.md` and `docs/engineering/UAT_EXECUTION_RESULTS.json`.
- Implemented Phase 22 Wave 1 (OPD Check-in & Triage): Check-in as primary reception tab, mandatory Referred By, 3-tier classification (Normal, Priority, Emergency), atomic registration and check-in.
- Implemented Phase 22 Wave 2 (Emergency Alert & Doctor Cabin / Waiting Room): Persistent doctor emergency alert banner with acknowledgment audit logging, waiting room with computed priority sorting, consultation fee snapshotting at check-in.
- Test suites verified 100% green: 1,392 backend tests (1,391 passed, 1 skipped) and 427 frontend tests (422 passed, 5 skipped across 65 suites).

## 2026-11-11 — Phase 21 Build Takeover & System Stabilization

- Resolved all frontend test regressions across admin navigation, app shell, and backup manager suites (all 65 suites passing).
- Fixed department-to-doctor memberships, doctor cabin routing, and account screen permissions.
- Merged integration PR #30 cleanly into main branch.

## 2026-11-08 — Phase 20 Admin Data Governance & Asset Management

- Built 8-stage staging pipeline for CSV/XLSX patient data import.
- Built controlled, permission-checked patient data export with field selection and audit.
- Implemented hospital identity, logo, and asset CRUD with version history.
- Implemented bilingual print template management (Prescription, Receipt, Registration Card).
- Reorganized Admin navigation into 5 logical governance sections.

## 2026-11-06 — Phase 19 Universal Consultation Workspace

- Built unified consultation workspace for Ophthalmology and Physiotherapy.
- Implemented auto-saving encounter drafts with debounce.
- Implemented versioned specialty clinical templates and vitals with automatic BMI calculation.
- Added cross-doctor read-all, edit-own permission policy.

## Through Phase 18 — Core Clinical, Billing, Audit & Deployment Baseline

- Phase 14 completed: Prescriptions Rx pad, physiotherapy treatment packages, session logger with VAS, and patient unified timeline.
- Phase 15 completed: Integer-paise billing ledger, consultation charges, payment collection, receipt generation with duplicate reprint markers, and admin-authorized payment reversals.
- Phase 16 completed: Append-only audit journal, admin audit viewer, database and file backup bundles with staging restore verification.
- Phase 17 completed: Offline LAN deployment architecture, fixed IP network boundaries, and Epson A4 print layout verification.
- Phase 18 completed: UI/UX review hardening, accessibility, native modal dialogs, and non-blocking banners.

## 2026-11-01 — Repository consistency audit

- Reconciled doctor-silo policy wording with the implemented strict scope and client decision status.
- Marked AUD-01 and PAT-01 partial where broad product requirements exceed current implementation evidence.
- Added TRT-03 to phase and requirement traceability.
- Corrected stale PostgreSQL target wording and clarified planned versus implemented backup/reversal capabilities.
- Recorded the patient registration form-to-API schema mismatch as an explicit pre-implementation decision.
- Replaced custom badge tags in GitHub Markdown with ordinary Markdown status labels.
- Documentation-only; no application code or tests changed.

## 2026-11-01 — Knowledge base and documentation hygiene

- Added the `brain/` knowledge-base structure for architecture, invariants, development rules, security, decisions, and current state.
- Recorded verified implementation boundaries through Phase 13 and kept Phases 14–17 explicitly planned/incomplete.
- Documented current permission mismatches and unresolved client policy questions.
- This change is documentation-only; it does not implement application features or constitute a fresh test run.

## Through Phase 13 — v3 implementation baseline

- Phase 11 recorded complete: application foundation, authentication, fixed roles, server-side permission checks, optimistic concurrency, first-admin bootstrap, and audit-event foundation.
- Phase 12 recorded complete: clinic settings, doctor profiles, fee catalogue, patient registry, URN allocation, search, demographic edits, duplicate warning, photo streaming, and registration print spike.
- Phase 13 recorded complete: appointments, doctor queues, clinical encounters, finalization, and addenda.
- Phase gate test counts are maintained in `.planning/STATE.md`; they should be described as historical unless freshly rerun.
