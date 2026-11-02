# Phase 14: Prescriptions, Treatment Plans & Sessions - Validation Criteria

## Automated Test Suites

| Category | Command | Target |
| :--- | :--- | :--- |
| Database Models & Migration | `pytest backend/tests/test_treatment_models.py` | Models, constraints, progress sync trigger, immutability trigger |
| Prescriptions API | `pytest backend/tests/test_prescriptions_api.py` | Prescription creation, structured items, doctor silo, 403 reception default-deny |
| Treatment Plans API | `pytest backend/tests/test_treatment_plans_api.py` | Treatment plan lifecycle, 409 optimistic conflict, cancellation justification |
| Treatment Sessions & Addenda API | `pytest backend/tests/test_treatment_sessions_api.py` | Session logging, 400 immutability lock, dated addenda, chronological retrieval |
| Session Concurrency Race | `pytest backend/tests/test_session_concurrency.py` | 20 threads racing, 0 duplicates, 0 gaps, contiguous 1..20 sequence |
| Phase 14 Gate | `pytest backend/tests/test_phase14_gate.py` | Full end-to-end integration pass (Prescriptions, Plans, Sessions, Triggers, Silo, Audit) |
| Backend Coverage | `pytest backend/tests --cov=kalyan_api --cov-fail-under=85` | Coverage >= 85% (Achieved: 93.07%, 505 passed) |
| Python Linter & Formatter | `ruff check backend && ruff format --check backend` | 0 errors |
| Frontend Typecheck & Lint | `npm run check` (typecheck + oxlint) | 0 warnings, 0 errors |
| Frontend Unit Tests | `npm run test` (vitest) | All 15 test suites passing (62 tests) |
| Frontend Production Build | `npm run build` | Clean Vite production bundle (397ms) |
| Legacy Isolation | `git diff --stat origin/main -- app tests DECISIONS.md` | 0 files changed |

## Manual & Browser Verification (M-14-01 to M-14-04)

- **M-14-01 (Structured Prescription Generation):** Doctor creates prescription with itemized medications, dosage, frequency presets, duration, instructions, and prints bilingual letterhead slip (`@media print`).
- **M-14-02 (Multi-Session Treatment Package):** Doctor creates treatment package with target session count, diagnosis, and agreed package fee. Progress gauge updates dynamically.
- **M-14-03 (Physiotherapy Session Logger & VAS Scoring):** Doctor logs session with interactive VAS pain slider (0–10 scale) and modality checkboxes. Session numbers sequence monotonically (Session #1, #2...).
- **M-14-04 (Finalised Session Immutability & Addenda):** Logged sessions cannot be edited or deleted (400 Bad Request / PostgreSQL trigger block). Post-session observations are appended as dated addenda.

