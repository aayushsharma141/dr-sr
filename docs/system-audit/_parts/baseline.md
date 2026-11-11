# Baseline test health (working tree as of 2026-11-09 05:32-05:45 IST)

Branch `refactor/admin-modules-ssot`, HEAD `2f587384`. The working tree carries uncommitted changes from other contributors: 66 modified files (2414+/1925-), one staged deletion (`frontend/src/components/admin/ManagementOverviewDashboard.tsx`), and untracked files including `backend/src/kalyan_api/migrations/versions/0020_integrity_runs.py`, `frontend/src/components/admin/AdminDashboard.tsx`, `frontend/src/api/integrity.ts`, `frontend/src/admin/integrity.ts` and a root `pytest.ini`. Every run below audits that tree as it is on disk.

No repo file was created or changed by this run except this report. `frontend/tsconfig.tsbuildinfo` was rewritten by `tsc -b`, but it is git-ignored (`.gitignore:12`). The production build went to scratch only. `backend/var` mtimes did not change, and `find -newermt "2026-11-09 05:30"` over backend/src, backend/tests and frontend/src returned nothing, so no source file changed while the suites ran.

## Environment

- Windows 11, Python 3.12.10 (backend `.venv`), pytest 9.2.0, plugins anyio 4.15.1, cov 7.1.0 (not enabled), timeout 2.4.0 (60 s per test).
- Import check: `python -c "import kalyan_api; print(kalyan_api.__file__)"` printed `D:\dr-sr\backend\src\kalyan_api\__init__.py`, which is the correct path.
- pytest rootdir `D:\dr-sr\backend`, configfile `pyproject.toml`; the untracked root `pytest.ini` was not used. Addopts `-ra -q --import-mode=importlib --strict-markers`.
- Env: `PYTHONPATH=D:/dr-sr/backend/src`; `KALYAN_PHOTOS_DIR`, `KALYAN_ASSETS_DIR` and `KALYAN_BACKUP_DIR` point to scratchpad `baseline/{photos,assets,backups}`. The test DB comes from tests/conftest.py (`kalyan_test`) and was not overridden.
- Frontend: React 19 + Vite, Vitest, oxlint, `tsc -b`.

## Commands and results

| # | Command (cwd) | Result | Wall time |
|---|---|---|---|
| 1 | `.venv\Scripts\python.exe -m pytest -p no:cacheprovider -q -rfE --durations=15` (backend) | **EXIT 0. 1064 collected: 1063 passed, 1 skipped, 0 failed, 0 errors**, 1 warning | 212 s |
| 1b | same env + `KALYAN_FRONTEND_DIST=<scratch dist>`: `tests/test_spa_serving.py::test_real_build_served` | **1 passed**, so the skip in run 1 is closed | 2.5 s |
| 2 | `npm run typecheck` (`tsc -b`) | **EXIT 0**, no errors | 2.6 s (incremental) |
| 3 | `npm run lint` (`oxlint`) | **EXIT 0**, no diagnostics printed | 0.7 s |
| 4 | `npx vitest run` | **EXIT 1. Files: 3 failed, 51 passed (54). Tests: 9 failed, 277 passed, 5 skipped (291)** | 69 s (vitest), 75 s wall |
| 4b | each failing file re-run alone (`npx vitest run <file>`) | same failures each time (2 + 4 + 3), so all are **deterministic** | - |
| 5 | `npx vite build --outDir <scratchpad>/baseline/dist --emptyOutDir` | **EXIT 0**, built in 5.21 s | 7.8 s |

Note on run 1: the extra `-q` on top of the addopts `-q` hides pytest's final stats line. The counts above come from the progress dots (14x72+56 = 1064), the single `s`, exit code 0, and `--collect-only` reporting "1064 tests collected".

Slowest backend tests: `test_no_default_credentials::test_legacy_credentials_absent_from_v3_codebase` (4.8 s), `test_restore_endpoint_real` (2.8 s), `test_restore_service::test_restore_database_and_photos` (2.3 s), `test_phase16_gate` (2.2 s), lockout throttle tests (about 1.9 s each).

Logs (scratchpad, not in repo): `baseline/backend.log`, `typecheck.log`, `lint.log`, `vitest.log`, `vitest.json`, `rerun-*.log`, `build.log`.

## Backend skipped test

- `tests/test_spa_serving.py:291 test_real_build_served` skips unless `KALYAN_FRONTEND_DIST` is set (line 297). I ran it against the scratch production build (run 1b) and it **passed**: the built bundle is served and contains no external host references, which is the offline requirement.

## Frontend failures (all deterministic, all caused by in-flight uncommitted work; none is a behaviour regression)

### A. `src/components/__tests__/app-shell.test.tsx`: 2 of 4 fail
- `shows doctor clinical workflows and activates the follow-up deep link` cannot find link "Physiotherapy Treatment".
- `shows administration destinations once in a single primary sidebar for ADMIN without duplicates` cannot find link "Management Overview".
- Cause: uncommitted `AppShell.tsx` renames the sidebar labels "Physiotherapy Treatment"->"Treatment Plans" (line 95), "Follow-up & Visits"->"Follow-ups" (line 112) and "Management Overview"->"Dashboard" (around line 616). The same file's uncommitted diff edits the test, deleting the whole `AppShell doctor specialty (D-19-03)` describe block, but it does not update the label assertions at lines 61-63 and 80. The test and the code are out of step: **in-flight**.
- Side effect: the RECEPTION test's negative checks at lines 53-54 (no link named 'Physiotherapy Treatment' / 'Follow-up & Visits') now pass vacuously because those labels no longer exist anywhere. The guarantee itself still holds in code (`roles: DOCTOR_ONLY` at AppShell.tsx:99,116), but the test no longer checks it.

### B. `src/pages/__tests__/admin-navigation-architecture.test.tsx`: 4 of 9 fail
- `renders the executive Management Overview dashboard and all KPI cards`, `renders executive performance charts, attention items, growth and system health`, `renders the Quick Access grid with canonical routes`, `sidebar renders Management Overview and five canonical sections`.
- Cause: this test file is unchanged since HEAD (last commit 2f587384). The uncommitted work deletes `ManagementOverviewDashboard.tsx` (staged) and replaces it with the untracked `components/admin/AdminDashboard.tsx` (wired in `AreaHome.tsx`). The new dashboard drops the expense, surplus, utilisation and Quick Access panels (its header comment at lines 32-41 says "The hospital does not record expenses"). The backend `ManagementOverviewResponse` (routers/areas.py:186-203, `extra="forbid"`) now returns `collections_paise`, `collection_trend`, `department_collections`, `new_patients` and `patient_trend`. The test still mocks the old shape (`operating_expenses`, `net_surplus`, `doctor_utilization`, `management_attention`). Frontend `ManagementOverview` (types.ts:184-195) matches the backend, so the contract is consistent. Only the test is stale: **in-flight**.
- Consequence: the new `AdminDashboard` has **no passing test**. `admin-navigation-architecture.test.tsx` is the only test that renders it (via `AreaHome`), and it fails before reaching any new content.

### C. `src/pages/__tests__/backup-manager.test.tsx`: 3 of 12 fail
- `shows an honest schedule state when the API has no schedule data`: there is no tab named "Schedule & automation".
- `opens import wizard modal when clicking Import Spreadsheet` and `automatically opens import modal when navigated with ?action=import`: there is no heading "Patient Import Centre".
- Cause: uncommitted `BackupManagerPage.tsx` renames the tab to "Schedule" (line 340) and the modal title to "Import Patients" (line 498), and `PatientImportPage.tsx` renames its h1 the same way. The test's only uncommitted change is whitespace (line 196). The modal still opens and the `?action=import` handling at BackupManagerPage.tsx:47-63 is unchanged: **in-flight**, label drift only.

## Skipped frontend tests
- `src/print-check/print-check.test.tsx`: 5 skipped. They are gated by `const run = !!edge && (required || process.env.PRINT_CHECK === '1')` (line 39), so the headless Edge A4 print-layout checks for the registration card, prescription slip, receipt and long-dialog pagination never run in a default `vitest run`.

## Warnings worth knowing
- Backend: `StarletteDeprecationWarning: Using httpx with starlette.testclient is deprecated` (fastapi/testclient.py:1). This is harmless now and may break on a future Starlette upgrade.
- Frontend: 13 "An update to EncounterWorkspace inside a test was not wrapped in act(...)" warnings from `clinical-encounter-workspace.test.tsx`. That suite passes (18/18), but the warnings suggest async state updates its assertions do not await.
- `D:/dr-sr/.coverage` (tracked) shows as modified, mtime 2026-11-08 15:05. This run did not change it (no `--cov`).
- An untracked root `D:/dr-sr/pytest.ini` (mtime 2026-11-09 02:13) exists. Running pytest from the repo root would use it instead of `backend/pyproject.toml`. It has no `timeout = 60`, and its `pythonpath` includes `backend/src`. Running from `backend/` as here uses pyproject.toml.
- Typecheck took 2.6 s because `tsc -b` is incremental (tsbuildinfo). A clean run would take longer but gives the same result for the same sources.

## Verdict
- Backend: GREEN on the current tree, uncommitted `0020_integrity_runs` migration and backend edits included (1063 passed, 1 env-gated skip that passes when enabled).
- Frontend typecheck, lint and build: GREEN.
- Frontend unit suite: RED, with 9 deterministic failures in 3 files. All of them are tests not yet updated for in-flight label renames and the admin dashboard rewrite. None shows a behaviour regression, but as long as they fail, the regression gate (AGENTS.md "Definition of done" item 7) cannot pass on this tree.
