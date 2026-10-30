# Phase 11 Plan 01 Summary: Entry Gate Decision Register & Toolchain Bootstrap

**Phase:** 11 — Decisions Gate, Foundation & Auth  
**Plan:** 11-01 (Wave 0)  
**Status:** Completed  
**Execution Date:** 2026-10-31  

---

## 1. Objectives Completed

1. **Entry Gate Decision Register (`11-ENTRY-GATE.md`):**
   - Established the formal register mapping rows `EG-1` through `EG-20` and accepted risks `RISK-01` through `RISK-03`.
   - Zero `OPEN` statuses in compliance with ROADMAP Success Criterion 1.
   - Locked in core architectural decisions:
     - `D-01`: Plain HTTP on isolated private hospital LAN.
     - `D-02`: 600VA+ line-interactive UPS with PostgreSQL `synchronous_commit = on`.
     - `D-03`: Strict doctor silo partitioning by `doctor_id`.
     - `D-04`: Strict default-deny for reception on clinical SOAP notes and prescriptions.
     - `D-05`: Configurable receipt numbering cycle (default Indian FY 1 Apr – 31 Mar).
     - `D-06`: Payment reversals restricted to Admin role with mandatory audit reason.
     - `D-07`: 30-min idle timeout and 5-failure account lockout (15-min cooldown or Admin unlock).
     - `D-08`: Optimistic concurrency control via `version_id` with HTTP 409 conflict and 1-click reload.
     - `EG-17`: First-run web setup wizard (`/setup`), singleton `system_setup` constraint, one-time console code (`SEC-07`, `SC-6`).
   - Updated `PROJECT.md` Key Decisions with all 8 locked decisions and stack conventions.
   - Authored and verified `check-entry-gate.ps1` in both `content` and `order` modes (`OK: gate precedes code`).

2. **Backend Foundation Skeleton & Security Templates:**
   - Updated `.gitignore` with `node_modules/`, `*.tsbuildinfo`, and `coverage/`.
   - Authored `backend/db/bootstrap.sql` implementing least-privilege role separation:
     - `kalyan_owner`: Schema owner and migration runner.
     - `kalyan_app`: Runtime DML-only user (no DDL/CREATE permissions).
     - Standardized on `UTF8` encoding, builtin `C.UTF-8` locale provider, and `Asia/Kolkata` timezone.
     - Zero hardcoded passwords; passwords prompted securely via interactive `\password`.
   - Authored `backend/.env.example` with placeholder security controls.

3. **Windows Toolchain Bootstrap:**
   - **Node.js LTS:** Verified installation at `C:\Program Files\nodejs\node.exe` (`v26.13.0` with `npm 11.20.0`). Removed legacy Python Playwright shim interception and standardized User PATH.
   - **PostgreSQL 18.6-5:** Installed and verified running as Windows service `postgresql-x64-18` on port 5432. Added `C:\Program Files\PostgreSQL\18\bin` to User PATH.
   - **Database Setup Executed:** Executed `bootstrap.sql` creating databases `kalyan_dev` and `kalyan_test` with UTF-8 / builtin C.UTF-8 locale.
   - **Environment Configuration:** Configured local `backend/.env` with active credentials; verified live connectivity of `kalyan_app` to `kalyan_dev` (`Asia/Kolkata`, return code 0).

---

## 2. Artifacts & Deliverables

- `.planning/phases/11-decisions-gate-foundation-auth/11-ENTRY-GATE.md`: Committed decision register.
- `.planning/phases/11-decisions-gate-foundation-auth/check-entry-gate.ps1`: Automated entry-gate verification script.
- `.planning/PROJECT.md`: Updated Key Decisions table.
- `.gitignore`: Updated with Node/TS/coverage ignores.
- `backend/db/bootstrap.sql`: PostgreSQL bootstrap script for roles and databases.
- `backend/.env.example`: Safe configuration template.
- `backend/.env`: Local git-ignored runtime environment configuration.

---

## 3. Verification Evidence

- `check-entry-gate.ps1 -Mode content`: `OK`
- `check-entry-gate.ps1 -Mode order`: `OK: gate precedes code`
- Node & npm: `v26.13.0` / `11.20.0`
- PostgreSQL service: `postgresql-x64-18 Running` (`psql 18.6`)
- `backend/.env`: Exists, is git-ignored, and active connection to `kalyan_dev` succeeded.

