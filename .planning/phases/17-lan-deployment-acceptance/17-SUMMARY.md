# Phase 17 Summary: LAN Deployment, Print Setup & UAT Acceptance

## Phase Overview
Phase 17 represents the final milestone delivery phase of the **Kalyan Hospital Centralized LAN Management Web Platform** (Milestone v3.0). It operationalizes the FastAPI + PostgreSQL backend and Vite + React SPA frontend for robust, offline on-premise execution across the hospital local area network.

## Key Deliverables & Achievements

### 1. Offline Production LAN Deployment (DEP-01)
- Delivered self-contained Windows deployment toolset in `deploy/`:
  - `install.ps1`: Automated environment builder creating virtualenv, installing Python wheels, initializing database migrations via Alembic, and generating secure random JWT secrets.
  - `start-server.bat`: Production batch runner starting Uvicorn with factory application pattern (`kalyan_api.main:create_app`) binding `0.0.0.0:8000`. Serves compiled frontend assets directly from `frontend/dist/` with zero Node.js on the server machine.
  - `stop-server.bat`: Graceful process termination targeting port 8000.
  - `.env.production.template`: Standardized production configuration template specifying database credentials, cookie secrets, and storage paths.

### 2. Auto-Recovery & Health Watchdog (DEP-02)
- Implemented Windows Scheduled Task registration and unregistration scripts:
  - `register-autostart.ps1`: Registers `KalyanHospitalServer` Windows task to start upon system boot with elevated privileges and highest run priority.
  - `unregister-autostart.ps1`: Cleanly unregisters the scheduled task.
  - `health-check.ps1`: Watchdog monitor querying `/api/health` with automatic server restart upon unresponsive states.

### 3. Real-Printer Layout Sign-Off (PRN-01)
- Verified all three critical hospital print layouts:
  - 80mm thermal receipt (`ReceiptPrint.tsx`): 80mm roll width, 72mm printable body, bilingual Hindi Devanagari and English header, conditional `DUPLICATE` watermark for reprints.
  - A4 double-signature registration card (`RegistrationCard.tsx`): Demographic frame, clinic header, dual signature blocks for patient/attendant and authorized receptionist.
  - A5 prescription / consultation slip layout.
- Added automated print layout tests in `frontend/src/pages/__tests__/print-layouts.test.tsx`.

### 4. Operational Acceptance & Disaster Recovery Suite (DEP-03)
- Comprehensive acceptance test suite in `backend/tests/test_phase17_acceptance.py`:
  - Multi-client concurrent simulated requests over LAN across Admin, Reception, and Doctor roles.
  - Role-based isolation checks (Doctor denied billing, Reception denied audit).
  - Clean-machine disaster recovery rehearsal: Full backup creation, data loss simulation, complete restore from archive, post-restore verification, and 5-point clinical/financial integrity audit pass.
  - Server operational health endpoint (`/api/health`) and CLI `check-db` verification.

---

## Test Verification Summary
- **Backend Test Suite:** 597 passed, 1 skipped, 0 failures.
- **Backend Coverage:** 92.80% (requirement >= 85%).
- **Frontend Test Suite:** 24 test suites, 78 tests passing.
- **Frontend Build:** Built cleanly without errors via `tsc -b && vite build`.
- **RBAC Matrix:** 339 cells verified across all endpoints.
- **Legacy Preservation:** Zero git diff against legacy desktop app (`origin/main: app tests DECISIONS.md`).
