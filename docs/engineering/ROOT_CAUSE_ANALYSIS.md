# Kalyan Hospital — Root Cause Analysis of Baseline Issues

## 1. Issue: Failing Tests in `admin-navigation-architecture.test.tsx` (BUG-001)
- **Symptom**: 4 tests failed in Vitest:
  - `renders the executive Management Overview dashboard and all KPI cards`
  - `renders executive performance charts, attention items, growth and system health`
  - `renders the Quick Access grid with canonical routes`
  - `sidebar renders Management Overview and five canonical sections`
- **Root Cause**: An in-progress refactoring on branch `refactor/admin-modules-ssot` deleted `frontend/src/components/admin/ManagementOverviewDashboard.tsx` and consolidated its layout into `AdminDashboard.tsx`, but the test file still imports and asserts on `ManagementOverviewDashboard`.
- **Targeted Surgical Fix**: Update `admin-navigation-architecture.test.tsx` to mount `AdminDashboard` and check the consolidated canonical navigation structure.

---

## 2. Issue: Failing Tests in `app-shell.test.tsx` (BUG-002)
- **Symptom**: 2 tests failed in Vitest:
  - `shows doctor clinical workflows and activates the follow-up deep link`
  - `shows administration destinations once in a single primary sidebar for ADMIN without duplicates`
- **Root Cause**: Changes to navigation hierarchy and active route matching in `AppShell.tsx` altered the DOM query path for the deep link and sidebar items.
- **Targeted Surgical Fix**: Ensure `AppShell.tsx` maintains accessible labels and consistent link href attributes for clinical and administration sub-routes.

---

## 3. Issue: Failing Tests in `backup-manager.test.tsx` (BUG-003)
- **Symptom**: 3 tests failed in Vitest:
  - Expects `screen.getByRole('heading', { name: 'Patient Import Centre' })` when navigating to `/admin/backups?action=import`.
- **Root Cause**: `BackupManagerPage.tsx` was modularized into tabs (`archive_list`, `schedule`, `restore`), and the patient import action was split out to `PatientImportPage.tsx`.
- **Targeted Surgical Fix**: Ensure the action routing parameter triggers the expected tab or redirects smoothly to the dedicated import page.

---

## 4. Issue: Pytest Root Collection Failure (BUG-004)
- **Symptom**: Running pytest in workspace root causes 9 collection errors due to `legacy/tests/`.
- **Root Cause**: `legacy/` contains an old PySide6 desktop client with tests that require `PySide6`, which is not installed in the modern web stack.
- **Targeted Surgical Fix**: Add a workspace-level `pytest.ini` with `testpaths = backend/tests` and `norecursedirs = legacy` to guarantee root-level commands cleanly run only the active backend suite.

