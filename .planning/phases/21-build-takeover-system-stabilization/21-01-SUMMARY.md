# Plan 21-01 Summary: Reconcile Admin Navigation & Dashboard Architecture

- **Phase**: 21 — Build Takeover & System Stabilization
- **Plan**: 01
- **Status**: COMPLETE
- **Files Modified**:
  - `frontend/src/pages/admin/BackupManagerPage.tsx`
  - `frontend/src/pages/__tests__/admin-navigation-architecture.test.tsx`

---

## 1. What was accomplished
1. **Resolved BUG-003**:
   - In `BackupManagerPage.tsx`, updated the schedule tab accessible label to `Schedule & automation` and the import modal title to `Patient Import Centre`.
   - Verified with `npm.cmd run test -- src/pages/__tests__/backup-manager.test.tsx`: 12/12 passed cleanly.
2. **Resolved BUG-001**:
   - Reconciled `admin-navigation-architecture.test.tsx` with production `AdminDashboard.tsx` and types (`collections_paise`, `collection_trend`, `department_collections`, `new_patients`, `business_date`, `collections_today`).
   - Removed obsolete mock fields (`operating_expenses`, `net_surplus`) that violated the hospital domain rule ("hospital records no expenses").
   - Verified with `npm.cmd run test -- src/pages/__tests__/admin-navigation-architecture.test.tsx`: 9/9 passed cleanly.
3. **Verification**:
   - Both test suites pass 100% green without flaky timeouts.

