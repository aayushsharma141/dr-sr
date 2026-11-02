# Phase 17 Execution Plan: LAN Deployment, Print Verification & Acceptance

## Plan Breakdown

### Plan 17-01: Offline LAN Deployment Engine & Packaging Bundle (`DEP-01`)
- Build `scripts/build_offline_bundle.py` or powershell packaging script:
  - Compiles frontend production assets (`frontend/dist/`).
  - Collects offline wheel dependencies (`backend/wheelhouse/`).
  - Generates template `backend/.env.production`.
  - Produces clean offline installer package.
- Write `deploy/install.ps1`:
  - Installs Python virtual environment from local offline wheelhouse.
  - Verifies PostgreSQL connectivity (`kalyan_owner`, `kalyan_app`).
  - Applies all Alembic migrations (`alembic upgrade head`).
  - Sets up directories (`var/photos`, `var/backups`, `var/logs`).
- Write `deploy/start-server.bat` and `deploy/stop-server.bat`:
  - Starts Uvicorn listening on `0.0.0.0:8000` with production logging and durability checks.

### Plan 17-02: Power Cut Auto-Recovery & Startup Orchestration (`DEP-02`)
- Write `deploy/register-autostart.ps1` and `deploy/unregister-autostart.ps1`:
  - Registers Windows Task Scheduler job or service wrapper configured to trigger at Windows system startup with elevated privileges.
  - Checks PostgreSQL service status before starting FastAPI backend.
  - Automatically recovers after unexpected power cuts or hard reboots.
- Write `deploy/health-check.ps1`:
  - Probes `http://localhost:8000/api/health` and verifies schema version and database durability.

### Plan 17-03: Real-Printer Layout Sign-Off & Dual Printable Contracts (`PRN-01`)
- Verify all 3 printable formats:
  - 80mm Thermal Receipt (`ReceiptPrint.tsx`): 72mm printable width, Hindi + English headers, `DUPLICATE` watermark logic, sequential receipt number, itemized totals.
  - A5 Consultation Slip: Header, doctor name, patient URN, clinical diagnosis, Rx details.
  - A4 Registration Card (`PatientCardPrint.tsx`): 210mm x 297mm `@page`, hospital logo, patient photo, dual signature boxes (Doctor / Patient).
- Create automated test suite `frontend/src/pages/__tests__/print-layouts.test.tsx` verifying print stylesheet rules, margin resets, and watermarks.

### Plan 17-04: Disaster Recovery Rehearsal & End-to-End LAN Acceptance Suite (`DEP-03`)
- Create `backend/tests/test_phase17_acceptance.py`:
  - Simulates offline deployment environment.
  - Multi-client concurrent load test across Admin, Reception, and Doctor sessions.
  - Disaster Recovery drill: Taking automated backup, wiping target environment, restoring from bundle, verifying 100% data fidelity.
  - Power cut recovery assertion test.
- Full verification:
  - Pytest with `--cov=kalyan_api --cov-fail-under=85`.
  - Frontend Vitest suite (all test suites passing).
  - TypeScript compilation and Vite build clean.
  - Legacy v2.0 isolation verification (`git diff --stat origin/main -- app tests DECISIONS.md` == 0).

### Plan 17-05: Final Phase 17 Handover & Milestone v3.0 Completion
- Create `.planning/phases/17-lan-deployment-acceptance/17-VALIDATION.md`.
- Create `.planning/phases/17-lan-deployment-acceptance/17-MANUAL-CHECKS.md`.
- Create `.planning/phases/17-lan-deployment-acceptance/17-SUMMARY.md`.
- Update `.planning/STATE.md` to Milestone v3.0 COMPLETE.
- Fast-forward merge `planning/phase-17-lan-deployment-acceptance` into `main` and push to remote.
