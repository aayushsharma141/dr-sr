# Project Changelog

This is a concise project-level history. Detailed implementation commits and phase plans remain in Git history and `.planning/`.

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
