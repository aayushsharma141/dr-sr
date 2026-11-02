# Phase 17 Context: LAN Deployment, Print Verification & Acceptance (Final Phase)

## Overview & Scope
Phase 17 represents the final phase of the Kalyan Hospital v3.0 Centralized LAN Management Web Platform.
With feature freeze established at the conclusion of Phase 16, Phase 17 focuses strictly on:
1. **Offline Server Deployment Bundle (`DEP-01`)**:
   - Packaging Python wheels (`wheelhouse/`), pre-built React SPA distribution files (`dist/`), schema migrations, and configuration scripts so the central Windows PC server can install and run with zero external internet connectivity and zero Node.js on the server PC.
   - Creating standalone Windows service / batch runners: `install.ps1`, `start-server.bat`, `stop-server.bat`, `health-check.ps1`.
2. **Auto-Recovery & Power Cut Resilience (`DEP-02`)**:
   - Windows Startup / Task Scheduler automation script (`register-autostart.ps1`).
   - Crash recovery and power-outage resilience: when power returns, PostgreSQL and the FastAPI application restart automatically, verify durability (`fsync`, `synchronous_commit`), and serve LAN traffic without manual administrative intervention.
3. **Dual Print Layout Verification & Real-Printer Testing (`PRN-01`)**:
   - Verification of the 80mm thermal receipt slips (`ReceiptPrint.tsx`), A5 consultation slips, and A4 double-signature registration card (`PatientCardPrint.tsx`).
   - Dual Hindi Devanagari + English typography, pixel/mm boundaries, CSS `@page` page-break rules, printable watermarks.
4. **End-to-End System Acceptance Suite & Rehearsal (`DEP-03`)**:
   - Full integration acceptance gate testing:
     - Multi-client concurrent requests over LAN simulation.
     - Complete clean-machine disaster recovery drill: taking a backup from active instance and restoring into fresh target.
     - Final UAT acceptance scorecard documenting client verification and handover criteria.

## Invariants & Rules
- Zero diffs in legacy v2.0 desktop codebase (`app/`, legacy `tests/`, `DECISIONS.md`).
- PR #8 remains completely untouched.
- 85% backend test coverage requirement maintained.
- All 339 RBAC matrix cells tested and passed.
- No external internet dependency during production LAN installation or runtime.
