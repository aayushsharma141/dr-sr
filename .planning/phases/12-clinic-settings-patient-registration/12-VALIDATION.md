---
phase: "12"
slug: "clinic-settings-patient-registration"
status: draft
nyquist_compliant: true
wave_0_complete: false
created: "2026-11-01"
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution of Phase 12 (`clinic-settings-patient-registration`).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Backend: pytest 9.2.0 + pytest-timeout + pytest-cov against real PostgreSQL 18.6 (`kalyan_test`). Frontend: Vitest 5.0.5 + Testing Library + jsdom |
| **Config file** | `backend/pyproject.toml`; `frontend/vite.config.ts` |
| **Quick run command** | `backend\.venv\Scripts\python.exe -m pytest backend/tests -q -x -k "settings or patients or doctors"` |
| **Full suite command** | `backend\.venv\Scripts\python.exe -m pytest backend/tests -q --cov=kalyan_api --cov-report=term-missing --cov-fail-under=85`, then `backend\.venv\Scripts\ruff.exe check backend`, `npm.cmd --prefix frontend run typecheck`, `npm.cmd --prefix frontend run lint`, `npm.cmd --prefix frontend run test`, `npm.cmd --prefix frontend run build` |
| **Estimated runtime** | Quick < 15 s; full suite ~ 45 s |

All commands run from `D:\dr-sr` in PowerShell.

---

## Sampling Rate

- **After every task commit:** quick run command (plus `ruff check backend` for backend tasks, `npm --prefix frontend run test` for frontend tasks)
- **After every plan wave:** full suite command (includes `concurrency` tests, coverage gate >= 85%, typecheck, lint, build)
- **Before phase gate:** full suite green, legacy diff empty, manual checks recorded

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------------|-----------|-------------------|-------------|--------|
| 12-01-T1 | 12-01 | 1 | SET-01, SET-02, PAT-01 | schema migration 0002 applies cleanly and downgrades | migration | `pytest backend/tests/test_migrations.py -q` | pending | pending |
| 12-01-T2 | 12-01 | 1 | SET-01, PAT-01 | model constraints, singleton check, gender check | unit | `pytest backend/tests/test_patient_models.py -q` | pending | pending |
| 12-02-T1 | 12-02 | 2 | SET-01 | only admin can update clinic settings | integration | `pytest backend/tests/test_clinic_settings.py -q` | pending | pending |
| 12-02-T2 | 12-02 | 2 | SET-02, SET-03 | doctor profiles and consultation fees CRUD | integration | `pytest backend/tests/test_doctor_admin.py -q` | pending | pending |
| 12-03-T1 | 12-03 | 3 | PAT-01 | 20 parallel threads allocate zero duplicate URNs | concurrency | `pytest backend/tests/test_urn_concurrency.py -q` | pending | pending |
| 12-03-T2 | 12-03 | 3 | PAT-01, PAT-04 | 12 canonical fields validation & duplicate warning check | integration | `pytest backend/tests/test_patient_registration.py -q` | pending | pending |
| 12-04-T1 | 12-04 | 4 | PAT-02 | search by URN, mobile, English & Hindi Devanagari name | integration | `pytest backend/tests/test_patient_search.py -q` | pending | pending |
| 12-04-T2 | 12-04 | 4 | PAT-03, PAT-05 | 409 conflict on stale version_id; photo upload and authenticated streaming | integration | `pytest backend/tests/test_patient_edit_photo.py -q` | pending | pending |
| 12-05-T1 | 12-05 | 5 | SET-01, SET-02 | admin settings & doctor management screens | frontend unit | `npm.cmd --prefix frontend run test -- settings` | pending | pending |
| 12-06-T1 | 12-06 | 6 | PAT-01, PAT-04 | reception registration form & duplicate warning banner | frontend unit | `npm.cmd --prefix frontend run test -- registration` | pending | pending |
| 12-07-T1 | 12-07 | 7 | PAT-02, PAT-03 | searchable patient directory & edit with ConflictBanner | frontend unit | `npm.cmd --prefix frontend run test -- directory` | pending | pending |
| 12-08-T1 | 12-08 | 8 | PRN-01 | registration card print preview & layout | frontend unit | `npm.cmd --prefix frontend run test -- print` | pending | pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Manual-Only Verifications

| Behavior | Requirement | Test Instructions |
|---|---|---|
| Print Registration Card on Physical A4 Paper | PRN-01 (Spike) | From Reception, click "Print Registration Card" on a registered patient; verify A4 page margins (15mm), crisp bilingual header, barcode, and dual-signature alignment. |
| Duplicate Registration Warning Interaction | PAT-04 | Attempt to register a patient with an existing name and mobile; confirm warning alert appears with existing patient's URN, and "Confirm new registration" checkbox enables submission. |
| Patient Photo Upload & Display | PAT-05 | Upload a JPEG photo; confirm thumbnail appears on patient card; verify direct access to photo file URL without session returns 401. |
