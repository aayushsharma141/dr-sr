# Phase 22 Plan 18 Summary: Admin Referral Report Page

**Plan:** 22-18  
**Status:** IMPLEMENTED — NOT VERIFIED  
**Task IDs:** T22-11  

---

## 1. AGENTS.md Governance Report

- **Task ID:** 22-18 (T22-11)
- **Owned Files:**
  - `frontend/src/pages/admin/ReferralReportPage.tsx` (new)
  - `frontend/src/api/reports.ts` (new)
  - `frontend/src/pages/admin/__tests__/referral-report.test.tsx` (new)
  - `frontend/src/admin/modules.ts` (modified)
  - `frontend/src/pages/__tests__/admin-navigation-architecture.test.tsx` (modified)
  - `frontend/src/router.tsx` (modified - serialised owner)
- **Git Checkpoint:**
  - Checkpoint stash: `checkpoint: before 22-18 referral report page` (stored in git stash list).
  - Working tree and index untouched by commits; zero database resets (`kalyan_dev` untouched, backend test run on `kalyan_test`).
- **Findings:**
  - Implemented the admin Referral Report page at `/admin/reports/referrals` over `GET /api/reports/referrals` (OD-I, OD-22-21, T22-11, UI-SPEC S7).
  - Date range defaults to the first day of the current IST month (`${today.slice(0, 7)}-01`) to today (`istToday()`).
  - Strict client-side date validation: `date_from <= date_to`. If `date_from > date_to`, renders an inline error alert and blocks outgoing API queries.
  - Source filter with options: All sources, Self, Doctor, Personal, Organisation, Other, Not recorded.
  - Referrer text search sends query parameter `referrer`.
  - Table renders:
    - Source label ("Self", "Doctor", "Personal", "Organisation", "Other", "Not recorded").
    - Referrer name (shown only for sources that require a name: Doctor, Personal, Organisation; em dash `—` for others).
    - Visit count right-aligned in tabular-nums.
    - Total row in table footer showing the sum of visit counts in tabular-nums.
  - Empty state displays "No visits in this date range."
  - Error state displays persistent `InlineAlert` with `role="alert"`.
  - Registered module `referral-report` in `frontend/src/admin/modules.ts` under group `patient-data` with `canonicalPath: '/admin/reports/referrals'` and `requiredPermission: 'report:referral'`.
  - Shifted subsequent module display orders to maintain unique sequential ordering (1..17).
  - Registered route in `frontend/src/router.tsx` inside `<RequireRole role="ADMIN" />` block (lazy-loaded).
  - Updated admin navigation architecture tests in `frontend/src/pages/__tests__/admin-navigation-architecture.test.tsx`.
- **Root Cause / Motivation:**
  - Owner requirement OD-I and T22-11: provide the clinic administrator with visibility into patient referral sources across customizable date ranges, with filtering and security protections.
- **Changes:**
  - `frontend/src/api/reports.ts`:
    - Defined `ReferralReportRow`, `ReferralReportOut`, `ReferralReportParams` types.
    - Defined `REFERRAL_SOURCE_FILTER_OPTIONS`, `formatReferralSource`, `shouldShowReferrerName`.
    - Implemented `useReferralReport` hook fetching `/api/reports/referrals` with date validation guard (`enabled: isValidRange`).
  - `frontend/src/pages/admin/ReferralReportPage.tsx`:
    - Created admin page wrapped in `AppShell` and `AdminPageHeader`.
    - Built filter controls (from/to dates, source select, referrer text input) conforming to 44px min-height target and 4px spacing scale.
    - Built results table with right-aligned tabular-nums and summary footer total.
    - Handled loading, empty ("No visits in this date range."), validation error, and server error states.
  - `frontend/src/router.tsx`:
    - Added `/admin/reports/referrals` route lazy-loading `ReferralReportPage` under ADMIN `RequireRole` block.
  - `frontend/src/admin/modules.ts`:
    - Added `referral-report` module in `patient-data` group at displayOrder 8 with `requiredPermission: 'report:referral'`.
    - Shifted displayOrders 8..16 to 9..17.
  - `frontend/src/pages/admin/__tests__/referral-report.test.tsx`:
    - Added test suite covering default IST date range, table formatting, visit counts, total calculation, empty state, InlineAlert error state, date validation error & query block, source filter, and referrer text filter.
  - `frontend/src/pages/__tests__/admin-navigation-architecture.test.tsx`:
    - Added module matching assertion for `/admin/reports/referrals`.
    - Added sidebar link assertion for `Referral Report`.
- **Test Commands & Results:**
  - Frontend Vitest suite:
    `cd frontend; npx.cmd vitest run --maxWorkers=2 src/pages/__tests__/admin-navigation-architecture.test.tsx src/pages/admin/__tests__/referral-report.test.tsx src/components/__tests__/app-shell.test.tsx src/test/guards/guards.test.ts`
    -> **41 passed in 4 test files**
  - Frontend Typecheck & Lint:
    `npm.cmd run typecheck && npm.cmd run lint`
    -> **Typecheck 0 errors, Lint 0 errors**
  - Backend Test:
    `$env:PYTHONPATH="D:/dr-sr/backend/src"; backend/.venv/Scripts/python.exe -m pytest -p no:warnings backend/tests/test_phase22_referral_report.py`
    -> **5 passed in 3.23s**
- **Dependencies:**
  - Upstream: 22-17 (referral report API endpoint), 22-15.
  - Downstream: 22-20 (human verification on :8000).
- **Remaining Risks:**
  - Full end-to-end browser check with real session cookies deferred to post-22-20 on `:8000`. Marked as `IMPLEMENTED — NOT VERIFIED`.

---

## 2. Requirements Satisfied

- **T22-11 (Referral report for admin):** Admin referral report page over `GET /api/reports/referrals`, registered in admin module navigation under Patient & Data Management, guarded with `report:referral`, with source & referrer filtering, date range validation, empty state, and total visit count summary.
