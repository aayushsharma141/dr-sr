# Kalyan Hospital — Repair Changelog

All changes made during controlled repair tracks must be documented here with exact task ID, files modified, and verification evidence.

## Milestone M3: Live Comprehensive OPD UAT Execution (2026-11-15)
- **Task ID**: T-UAT-FULL
- **Author**: Lead QA & Engineering Orchestrator
- **Artifacts Created / Verified**:
  - `scripts/qa_opd_full_suite.py`: 182-assertion end-to-end multi-station live UAT test harness.
  - `docs/engineering/KALYAN_OPD_UAT_CONSOLIDATED_REPORT.md`: Comprehensive UAT audit report with module rankings and remediation tracks.
  - `docs/engineering/UAT_EXECUTION_RESULTS.json`: Machine-readable results artifact.
- **Verification**:
  - 182 test cases evaluated against PostgreSQL staging (`kalyan_test`).
  - 160 Passed (87.9%), 0 Blocked, 1 Known Defect (doctor reassignment without department param), 21 Future Scope.

## Milestone M2: Phase 22 Integrated OPD Workflow — Waves 1 & 2 (2026-11-15)
- **Task ID**: T-PHASE22-W1-W2
- **Author**: Fullstack Engineering Team
- **Files Modified / Created**:
  - `backend/src/kalyan_api/migrations/versions/0026_checkin_priority_referral.py`: Added `referred_by`, `triage_classification`, `emergency_alerted_at`, `emergency_acknowledged_at` columns.
  - `backend/src/kalyan_api/migrations/versions/0027_bill_items.py`: Added `bill_items` fee snapshot table.
  - `backend/src/kalyan_api/routers/patients.py` & `appointments.py`: Check-in endpoint with automatic visit, token, and fee snapshotting; emergency alert and acknowledgment mutations.
  - `frontend/src/pages/AppointmentsReception.tsx`: Two-column Check-in & Token view as default reception tab (`OD-22-01`).
  - `frontend/src/components/checkin/PriorityBadge.tsx`: Normal, Priority (amber), and Emergency (red) badges.
  - `frontend/src/components/checkin/TodayAppointmentsPanel.tsx`: Right-column quick action panel.
  - `frontend/src/components/EmergencyAlertBanner.tsx`: Doctor workstation persistent emergency alert with audit acknowledgment.
  - `frontend/src/pages/WaitingRoom.tsx`: Waiting room with computed priority ordering and same-visit doctor transfer.
- **Verification**:
  - 29/29 Phase 22 backend tests passing (`test_phase22_checkin.py`, `test_phase22_bill_snapshot.py`, `test_phase22_wave2.py`).
  - 15/15 Phase 22 frontend tests passing (`emergency-alert-banner.test.tsx`, `waiting-room.test.tsx`).

## Milestone M1: Phase 21 Build Takeover & Stabilization (2026-11-11)
- **Task ID**: T-PHASE21-STABILIZE
- **Author**: Engineering Core
- **Files Modified**:
  - Frontend admin navigation, app shell, and backup manager components.
  - Test suites: `admin-navigation-architecture.test.tsx`, `app-shell.test.tsx`, `backup-manager.test.tsx`.
- **Verification**:
  - All 65 frontend test suites passing cleanly (422 passed, 0 failed).
  - TypeScript build (`tsc -b`) exits with 0 errors.
  - PR #30 cleanly merged into integration branch.

## Milestone M0 / Phase 0: Baseline & Governance Setup (2026-11-09)
- **Task ID**: T00
- **Author**: Primary Engineering Orchestrator
- **Files Created**:
  - `AGENTS.md`: Permanent engineering governance and hospital invariants.
  - `.agents/rules/agent-ownership.md`: Multi-agent file write isolation policy.
  - `.agents/rules/hospital-business-rules.md`: Core hospital invariants (URN identity, visit vs consultation, billing, physiotherapy sessions).
  - `.agents/rules/safety-policy.md`: Safeguards against destructive actions and PII leakage.
  - `.agents/rules/coding-policy.md`: Ponytail minimal change and coding standards.
  - `.agents/rules/database-policy.md`: Role separation (`kalyan_app` vs `kalyan_owner`) and `_test` DB guards.
  - `.agents/rules/testing-policy.md`: Testing hierarchy and evidence requirements.
  - `.agents/skills/workflow-lifecycle-testing/SKILL.md`: Standard workflow lifecycle testing procedure.
  - `.agents/skills/hospital-system-audit/SKILL.md`: Read-only audit skill.
  - `.agents/skills/controlled-repair/SKILL.md`: Single-writer repair workflow.
  - `.agents/skills/release-verification/SKILL.md`: Final release verification gate.
  - `docs/engineering/*`: Project status, module inventory, API inventory, bug register, architecture, and test matrix.
  - `pytest.ini`: Unified root pytest configuration mapping backend tests, pythonpath, and ignoring legacy suites (resolving BUG-004).
- **Verification**:
  - Root Pytest collection: 1,064 tests collected across 75 test files with 0 errors (`& backend\.venv\Scripts\pytest.exe --collect-only -q`).
  - Backend Smoke test passing: 6/6 passed.
  - Frontend Vitest baseline run: 277 passing, 9 failing, 5 skipped.
