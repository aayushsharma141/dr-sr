---
phase: "23"
slug: "advanced-data-operations"
status: draft
nyquist_compliant: true
wave_0_complete: false
created: "2026-11-16"
---

# Phase 23 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: 23-RESEARCH.md and 23-CONTEXT.md.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Backend: pytest 9.2.0 (`backend/pyproject.toml`, `timeout = 60`, `--import-mode=importlib`). Frontend: vitest (`frontend/package.json` `test`). |
| **Config file** | `backend/pyproject.toml`, `backend/tests/conftest.py`, `frontend/vite.config.*` |
| **Quick run command** | `cd D:/dr-sr/backend && PYTHONPATH=D:/dr-sr/backend/src .venv/Scripts/python.exe -m pytest -p no:warnings <touched test files>` and `cd D:/dr-sr/frontend && npx vitest run --maxWorkers=2 <touched test files>` |
| **Full suite command** | `cd D:/dr-sr/backend && PYTHONPATH=D:/dr-sr/backend/src .venv/Scripts/python.exe -m pytest tests -p no:warnings`; `cd D:/dr-sr/frontend && npx vitest run && npm run typecheck && npm run lint` |
| **Estimated runtime** | Quick: ~5–60 s. Full backend: ~240 s. Full frontend: ~60 s. |

Database rules: backend tests run only on `kalyan_test` (conftest rebuilds its schema). Never run tests against `kalyan_dev`. Backend pytest runs never run concurrently, because they share `kalyan_test`.

---

## Sampling Rate

- **After every task commit:** quick run of the touched test files, plus `test_rbac_matrix.py` and `test_openapi_snapshot.py` when an API or permission changed.
- **After every plan wave:** full backend suite, full frontend suite, `npm run typecheck`, `npm run lint`.
- **Before Phase Completion:** full suites green and manual smoke check on `:8000`.
- **Max feedback latency:** 120 seconds for quick runs.

---

## Per-Task Verification Map

| Requirement | Plan | Behaviour | Test Type | Automated Command / File | File Exists | Status |
|-------------|------|-----------|-----------|--------------------------|-------------|--------|
| MIG-30 | 23-01 | Migration 0030: `patients.merged_into_id`, `patients.is_archived`, `workstations` table | Schema | `test_migrations.py`, `test_phase23_schema.py` | ❌ W0 | ⬜ pending |
| RBAC-23 | 23-01 | Admin holds `patient:merge`, `patient:archive`, `workstation:read`; Reception and Doctor forbidden | Matrix | `test_rbac_matrix.py`, `test_phase23_rbac.py` | ❌ W0 | ⬜ pending |
| MERGE-01 | 23-02 | Duplicate candidate identification by exact mobile + normalized full name | Unit/API | `test_phase23_patient_merge.py` | ❌ W0 | ⬜ pending |
| MERGE-02 | 23-02 | Open visit guard fail-closed refusal (HTTP 400 `open_visit_conflict`) | API | `test_phase23_patient_merge.py` | ❌ W0 | ⬜ pending |
| MERGE-03 | 23-02 | Alias-pointer merge sets `is_active=False`, `merged_into_id`; DB triggers preserved | DB Trigger | `test_phase23_patient_merge.py` | ❌ W0 | ⬜ pending |
| MERGE-04 | 23-02 | Undo merge reactivates secondary record without foreign key rewriting | API | `test_phase23_patient_merge.py` | ❌ W0 | ⬜ pending |
| MERGE-05 | 23-03 | Timeline and visit aggregations dynamically include merged patient records | Integration | `test_phase23_patient_merge.py` | ❌ W0 | ⬜ pending |
| ARCH-01 | 23-04 | Filtered candidate search for bulk archival (>= 3 years inactive, zero visits) | API | `test_phase23_patient_archive.py` | ❌ W0 | ⬜ pending |
| ARCH-02 | 23-04 | Hard Financial Invariant: Patients with dues > 0 strictly blocked from archival | Financial Guard | `test_phase23_patient_archive.py` | ❌ W0 | ⬜ pending |
| ARCH-03 | 23-04 | Soft archive sets `is_archived=True`; hidden from reception; unarchive restores | API | `test_phase23_patient_archive.py` | ❌ W0 | ⬜ pending |
| WS-01 | 23-05 | LAN heartbeat ping records terminal hostname, IP, app version, active user | API | `test_phase23_workstations.py` | ❌ W0 | ⬜ pending |
| WS-02 | 23-05 | Workstation status query computes Online, Idle, Offline thresholds | API | `test_phase23_workstations.py` | ❌ W0 | ⬜ pending |
| UI-MERGE | 23-06 | Duplicate resolution queue, side-by-side comparison modal, undo banner | Component | `duplicate-merge.test.tsx` | ❌ W0 | ⬜ pending |
| UI-ARCH | 23-07 | Filtered bulk archival screen, dues guard indicators, unarchive table | Component | `bulk-archive.test.tsx` | ❌ W0 | ⬜ pending |
| UI-WS | 23-08 | Workstation monitor page with live pills, AppShell heartbeat hook | Component | `workstation-monitor.test.tsx` | ❌ W0 | ⬜ pending |
| REG-23 | 23-09 | Full stack integration & regression pass, production build, `:8000` deployment | Full Suite | Full pytest + Vitest + `npm run build` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `backend/tests/test_phase23_schema.py` — verifies Migration 0030 schema columns, indices, foreign keys
- [ ] `backend/tests/test_phase23_rbac.py` — verifies permission enforcement for Phase 23 endpoints
- [ ] `backend/tests/test_phase23_patient_merge.py` — candidate detection, open visit guard, alias-pointer merge, DB triggers preservation, undo
- [ ] `backend/tests/test_phase23_patient_archive.py` — bulk archival filtering, financial dues guard, unarchive
- [ ] `backend/tests/test_phase23_workstations.py` — heartbeat upsert, IP tracking, status calculations
- [ ] `frontend/src/pages/admin/__tests__/duplicate-merge.test.tsx`
- [ ] `frontend/src/pages/admin/__tests__/bulk-archive.test.tsx`
- [ ] `frontend/src/pages/admin/__tests__/workstation-monitor.test.tsx`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Terminal IP detection on real LAN | WS-01 | Requires multiple real physical machines on hospital LAN | On 2 workstations, access `:8000`; verify both appear in `/admin/workstations` with distinct LAN IPs |
| Merged record redirect banner clarity | MERGE-03 | Visual UX inspection | In browser, search old merged URN; verify automatic redirect to master record with informative amber banner |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter
