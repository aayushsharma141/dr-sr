---
phase: "19"
slug: "universal-consultation-workspace"
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-06"
---

# Phase 19 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution of Phase 19 (Universal Consultation Workspace).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Backend Framework** | pytest 9.2.0 + pytest-timeout 2.4.0 (PostgreSQL test db `kalyan_test`) |
| **Frontend Framework** | Vitest 5.0.5 + React Testing Library (jsdom) |
| **Backend Config** | `backend/pyproject.toml` |
| **Frontend Config** | `frontend/vite.config.ts` |
| **Quick Run (Backend)** | `& backend\.venv\Scripts\python.exe -m pytest backend/tests/test_consultation_drafts.py -q` |
| **Quick Run (Frontend)** | `cmd /c "cd /d D:\dr-sr\frontend && npx vitest run src/pages/__tests__/clinical-encounter-workspace.test.tsx"` |
| **Full Suite Command** | `& backend\.venv\Scripts\python.exe -m pytest backend/tests/ -q; cmd /c "cd /d D:\dr-sr\frontend && npm test -- --run"` |
| **Estimated Runtime** | ~90s (full backend + frontend suites) |

---

## Sampling Rate

- **After every task commit:** Run targeted unit test for modified service/route/component
- **After every plan wave:** Run full backend and frontend regression suites
- **Before `/gsd-verify-work`:** Full suite green, 100% RBAC pass, clean production build (`npm run build`), clean linter (`ruff check` + `oxlint`)
- **Max feedback latency:** 10s for targeted tests, 90s for full suite

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 19-01-01 | 01 | 1 | DWS-01, DWS-02 | T-19-01 | Partial unique index on `clinical_encounters(appointment_id)` prevents concurrent double-creation | unit / db | `pytest backend/tests/test_appointment_encounter_uniqueness.py` | ❌ W0 | ⬜ pending |
| 19-01-02 | 01 | 1 | DWS-02 | T-19-02 | Draft columns allow empty/partial saves; triggers prevent finalisation without mandatory fields | unit / api | `pytest backend/tests/test_consultation_drafts.py` | ❌ W0 | ⬜ pending |
| 19-01-03 | 01 | 1 | DWS-10 | T-19-03 | Single concurrent session returns 409 `session_in_use`; takeover revokes prior session and logs audit | unit / auth | `pytest backend/tests/test_auth_single_session.py` | ❌ W0 | ⬜ pending |
| 19-02-01 | 02 | 2 | DWS-05 | T-19-04 | Clinical template schemas validate Physio & Eye templates; rejects malformed payloads on finalise | unit / api | `pytest backend/tests/test_specialty_templates.py` | ❌ W0 | ⬜ pending |
| 19-02-02 | 02 | 2 | DWS-06 | T-19-05 | Vitals observations calculate BMI server-side; enforces clinical range validation | unit / api | `pytest backend/tests/test_vitals_and_bmi.py` | ❌ W0 | ⬜ pending |
| 19-03-01 | 03 | 3 | DWS-07 | T-19-06 | Prescription lifecycle (`DRAFT` -> `AUTHORISED` -> `CANCELLED`); unchangeable once authorised | unit / api | `pytest backend/tests/test_prescription_lifecycle.py` | ❌ W0 | ⬜ pending |
| 19-03-02 | 03 | 3 | DWS-08 | T-19-07 | Follow-up recommendations booked by reception without exposing doctor-only clinical reasons | unit / api | `pytest backend/tests/test_follow_up_workflow.py` | ❌ W0 | ⬜ pending |
| 19-04-01 | 04 | 4 | DWS-04 | T-19-08, T-19-09 | Centralized `core/scope.py`: cross-doctor read allowed on finalised encounters with `CROSS_DOCTOR_CLINICAL_READ` audit; write denied | unit / rbac | `pytest backend/tests/test_cross_doctor_access.py` | ❌ W0 | ⬜ pending |
| 19-05-01 | 05 | 5 | DWS-02, DWS-05 | T-19-10, T-19-11 | Universal consultation workspace renders jump-list, specialty form & debounced auto-save | frontend | `cmd /c "cd /d frontend && npx vitest run src/pages/__tests__/clinical-encounter-workspace.test.tsx"` | ❌ W0 | ⬜ pending |
| 19-06-01 | 06 | 6 | DWS-02, DWS-09 | T-19-12 | Doctor dashboard lists unfinished drafts; prints patient consultation summary without medicines | frontend | `cmd /c "cd /d frontend && npx vitest run src/pages/__tests__/doctor-dashboard-unfinished.test.tsx src/pages/__tests__/consultation-summary-print.test.tsx"` | ❌ W0 | ⬜ pending |
| 19-06-02 | 06 | 6 | DWS-10 | T-19-13 | Login screen handles 409 `session_in_use` and renders takeover confirmation dialog | frontend | `cmd /c "cd /d frontend && npx vitest run src/pages/__tests__/login-takeover-dialog.test.tsx"` | ❌ W0 | ⬜ pending |
| 19-07-01 | 07 | 7 | DWS-01–10 | T-19-14, T-19-15 | Full integration gate: draft -> vitals -> template -> rx -> finalise -> print -> audit log | integration | `pytest backend/tests/test_phase19_gate.py` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `backend/tests/test_appointment_encounter_uniqueness.py` — Stubs for DWS-01 double-creation rejection
- [ ] `backend/tests/test_consultation_drafts.py` — Stubs for DWS-02 draft auto-save & finalisation invariants
- [ ] `backend/tests/test_auth_single_session.py` — Stubs for DWS-10 concurrent login rejection & takeover
- [ ] `backend/tests/test_specialty_templates.py` — Stubs for DWS-05 Physio & Ophthalmology template validation
- [ ] `backend/tests/test_vitals_and_bmi.py` — Stubs for DWS-06 vitals & BMI calculation
- [ ] `backend/tests/test_prescription_lifecycle.py` — Stubs for DWS-07 prescription authorisation & cancellation
- [ ] `backend/tests/test_follow_up_workflow.py` — Stubs for DWS-08 follow-up recommendation lifecycle
- [ ] `backend/tests/test_cross_doctor_access.py` — Stubs for DWS-04 cross-doctor read audit & write isolation
- [ ] `backend/tests/test_phase19_gate.py` — End-to-end integration test harness

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real printer letterhead fit (A4) | DWS-09 | Physical paper margin & Hindi font rendering verification | Print Patient Consultation Summary on physical Canon/HP A4 printer; verify single-page fit and Hindi Devanagari typography |
| Session takeover experience | DWS-10 | Concurrent workstation browser verification | Log in on PC A, attempt login on PC B, observe takeover prompt, confirm takeover, verify PC A session is immediately terminated on next navigation |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 10s quick / < 90s full
- [x] `nyquist_compliant: true` set in frontmatter once verified

**Approval:** Pending Phase 19 planning sign-off
