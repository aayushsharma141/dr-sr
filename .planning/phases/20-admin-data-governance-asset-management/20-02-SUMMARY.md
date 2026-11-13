# Phase 20 Plan 02 Summary: Five-Section Admin Sidebar Navigation & SSOT Registry

## Overview
Phase 20 Plan 02 restructures the Administration sidebar navigation and module registry to implement the canonical five-section hierarchy per decisions **D-20-21**, **D-20-22**, and **D-20-23**. It replaces the legacy grouping with five canonical section groups (`hospital-config`, `patient-data`, `billing-finance`, `users-security`, `system-maintenance`), promotes `Management Overview` (`/admin`) as the single prominent link at the top, eliminates all dead placeholder links, scaffolds the five new Phase 20 admin routes in `router.tsx` behind `<RequireRole role="ADMIN" />`, and updates the test suite to assert the new layout.

---

## Deliverables & Tasks Completed

### Task 1: Update admin module SSOT registry in modules.ts
- **Files Modified:**
  - `frontend/src/admin/modules.ts`
- **Changes:**
  - Reorganized `ADMIN_MODULE_GROUPS` to define the 5 canonical section groups:
    - `hospital-config`: Hospital Configuration
    - `patient-data`: Patient & Data Management
    - `billing-finance`: Billing & Finance
    - `users-security`: Users, Security & Governance
    - `system-maintenance`: System & Maintenance
  - Reorganized `ADMIN_MODULES` array:
    - Top-level: `overview` (`/admin`, Management Overview)
    - Group `hospital-config`: `clinic-settings` (`/admin/settings`), `hospital-assets` (`/admin/assets`), `print-templates` (`/admin/templates`), `doctors-fees` (`/admin/doctors`)
    - Group `patient-data`: `patient-correct` (`/admin/patients/correct`), `patient-imports` (`/admin/imports`), `patient-exports` (`/admin/exports`)
    - Group `billing-finance`: `billing-reversals` (`/admin/billing`), `pending-dues` (`/reception/dues`)
    - Group `users-security`: `user-accounts` (`/admin/users`), `roles-matrix` (`/admin/roles`), `security-sessions` (`/admin/security`), `audit-trail` (`/admin/audit`)
    - Group `system-maintenance`: `backups-restore` (`/admin/backups`), `data-integrity` (`/admin/integrity`), `system-health` (`/admin/system`)
  - Removed dead placeholder keys ("Hospital Performance", "Department Analytics", "Resource Utilization") per D-20-22.
- **Verification:**
  - `cmd /c "cd /d frontend && npm.cmd run typecheck"` passed with zero errors.
- **Commit:** `0726136 feat(20-02): reorganize admin module registry into five canonical sections`

---

### Task 2: Refactor renderAdminSidebar in AppShell.tsx and scaffold router.tsx
- **Files Modified:**
  - `frontend/src/components/AppShell.tsx`
  - `frontend/src/router.tsx`
- **Changes:**
  - In `AppShell.tsx`:
    - Refactored `renderAdminSidebar()` to render `Management Overview` (`/admin`) with Home icon and active highlight `bg-indigo-600 text-white shadow-xs` at the top.
    - Sourced the 5 canonical sections and their links directly from `ADMIN_MODULE_GROUPS` and `ADMIN_MODULES`.
    - Added uppercase muted slate section headers with legibility guard compliance (`text-xs font-semibold uppercase tracking-wider text-slate-200 dark:text-slate-400 px-3 py-2`).
    - Enforced 44px min-touch targets (`min-h-11`) and consistent hover states (`hover:bg-slate-800 hover:text-white`) with dot indicators (`bg-indigo-400` / `bg-white`).
    - Eliminated dead placeholder links to `/admin`.
  - In `router.tsx`:
    - Scaffolded lazy-loaded route skeletons under `<RequireRole role="ADMIN">` for:
      - `/admin/assets`: Hospital Identity & Logo
      - `/admin/templates`: Print Templates
      - `/admin/patients/correct`: Patient Demographic Correction
      - `/admin/imports`: Import Centre
      - `/admin/exports`: Export Centre
    - Preserved all existing routes (`/admin`, `/admin/settings`, `/admin/doctors`, `/admin/billing`, `/admin/users`, `/admin/roles`, `/admin/security`, `/admin/audit`, `/admin/backups`, `/admin/integrity`, `/admin/system`).
- **Verification:**
  - `cmd /c "cd /d frontend && npm.cmd run typecheck"` passed with zero errors.
  - `cmd /c "cd /d frontend && npm.cmd test -- guards.test.ts --run"` passed (15 tests).
- **Commit:** `832302f feat(20-02): refactor admin sidebar to five sections and scaffold new routes`

---

### Task 3: Update app-shell and admin-navigation unit tests
- **Files Modified:**
  - `frontend/src/components/__tests__/app-shell.test.tsx`
  - `frontend/src/pages/__tests__/admin-navigation-architecture.test.tsx`
- **Changes:**
  - In `app-shell.test.tsx`:
    - Updated ADMIN sidebar assertions to check for all 5 section headers: `Hospital Configuration`, `Patient & Data Management`, `Billing & Finance`, `Users, Security & Governance`, and `System & Maintenance`.
    - Asserted that `Management Overview` links to `/admin`.
    - Asserted that dead placeholder links ("Hospital Performance", "Department Analytics", "Resource Utilization") are absent.
    - Asserted that all 16 canonical module destinations are present with exact URLs.
  - In `admin-navigation-architecture.test.tsx`:
    - Updated module registry invariant tests to validate the 5-group architecture, active status, and canonical paths.
    - Updated `findAdminModuleForPath` tests for all 17 admin routes.
    - Updated single sidebar layout test to verify the 5 canonical sections.
- **Verification:**
  - `cmd /c "cd /d frontend && npm.cmd test -- app-shell.test.tsx admin-navigation-architecture.test.tsx --run"` passed (13 tests).
  - `cmd /c "cd /d frontend && npm.cmd run typecheck"` passed with zero errors.
- **Commit:** `6b5b491 test(20-02): update navigation and shell unit tests for five-section admin layout`

---

## Verification Summary

All verification commands executed cleanly:

1. `cmd /c "cd /d frontend && npm.cmd run typecheck"` &rarr; Exit 0 (0 diagnostic errors)
2. `cmd /c "cd /d frontend && npm.cmd test -- app-shell.test.tsx admin-navigation-architecture.test.tsx --run"` &rarr; 2 files passed, 13 tests passed
3. `cmd /c "cd /d frontend && npm.cmd test -- guards.test.ts --run"` &rarr; 2 files passed, 15 tests passed (all UX-04 legibility and UX-06 accessibility guards pass)

---

## Success Criteria Verification

- [x] Admin sidebar renders 5 canonical sections in order per D-20-21.
- [x] Management Overview is the single top link.
- [x] Dead placeholder links ("Hospital Performance", "Department Analytics", "Resource Utilization") are removed per D-20-22.
- [x] All 5 new admin routes (`/admin/assets`, `/admin/templates`, `/admin/patients/correct`, `/admin/imports`, `/admin/exports`) are scaffolded in `router.tsx` under Admin role guard.
- [x] All navigation and shell tests pass.
