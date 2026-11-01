# Phase 13: Appointments & Clinical Encounters - Validation Criteria

## Automated Test Suites

| Category | Command | Target |
| :--- | :--- | :--- |
| Database Models & Migration | `pytest backend/tests/test_appointment_models.py` | Models, constraints, trigger |
| Token Concurrency | `pytest backend/tests/test_token_concurrency.py` | 20 threads, 0 duplicates, 0 gaps |
| Appointment State Machine | `pytest backend/tests/test_appointment_status.py` | Valid/invalid status transitions, 409 conflict |
| Encounters & Immutability | `pytest backend/tests/test_clinical_encounters.py` | Doctor silo, 403 reception default-deny, finalisation lock, addenda |
| Phase 13 Gate | `pytest backend/tests/test_phase13_gate.py` | Full end-to-end integration pass |
| Backend Coverage | `pytest backend/tests --cov=kalyan_api` | Coverage >= 85% |
| Python Linter | `ruff check backend` | 0 errors |
| Frontend Typecheck & Lint | `npm run check` | 0 errors |
| Frontend Unit Tests | `npm run test` | All test suites passing |
| Legacy Isolation | `git diff --stat 43ab9c4 -- app tests pytest.ini requirements.txt requirements-dev.txt .github .vscode DECISIONS.md` | 0 files changed |

## Manual & Browser Verification (M-13-01 to M-13-04)

- **M-13-01 (Daily Token Allocation):** Reception books appointment; token sequence increments per doctor per day.
- **M-13-02 (Queue Status Flow):** Status changes `BOOKED` -> `ARRIVED` -> `IN_CONSULTATION` -> `DONE` reflect across Reception and Doctor dashboards.
- **M-13-03 (Doctor Clinical Workspace):** Doctor records encounter notes; finalisation locks form with green badge and enables addenda.
- **M-13-04 (Doctor Silo & Reception Default-Deny):** Reception user cannot access clinical encounter routes or read clinical note text.
