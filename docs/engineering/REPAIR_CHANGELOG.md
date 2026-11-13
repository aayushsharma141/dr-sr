# Kalyan Hospital — Repair Changelog

All changes made during controlled repair tracks must be documented here with exact task ID, files modified, and verification evidence.

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
