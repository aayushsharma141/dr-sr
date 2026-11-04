# Administration UI/UX remediation

**Status:** Partial implementation applied on `fix/admin-navigation-hierarchy-2026-11-04`  
**Scope:** Frontend navigation hierarchy and administration landing page  
**Source reviewed:** `frontend/src/components/AppShell.tsx`, `frontend/src/components/AdminNavTabs.tsx`, `frontend/src/pages/AreaHome.tsx`, `frontend/src/router.tsx`, and `frontend/src/components/__tests__/app-shell.test.tsx`.

## 1. Findings

1. Administration destinations were represented in three places: the global sidebar, the administration tab component, and the administration dashboard shortcut cards.
2. The global navigation exposed patient and appointment destinations to the ADMIN role even though the role's intended responsibility is operational administration rather than clinical record access.
3. The admin landing page used a generic lowercase area heading and presented navigation cards instead of prioritizing the dashboard's operational information.
4. The screenshot supplied for review shows a vertical secondary administration sidebar. The current repository source reviewed contains a horizontal `AdminNavTabs` component, not that vertical panel. The screenshot and the checked-in source/runtime therefore appear to be from different frontend revisions or builds. Verify the deployed bundle before diagnosing any remaining visual mismatch.

## 2. Changes applied

- Removed the `AdminNavTabs` import and render point from `AppShell.tsx`. Administration pages now use the global primary sidebar as their only navigation system.
- Added a dedicated `Audit & Compliance` sidebar destination pointing to `/admin/audit`.
- Renamed the `Reports` destination to `System Integrity`, keeping the existing `/admin/integrity` route.
- Kept ADMIN navigation focused on administrative destinations: removed patient records and appointment links from the ADMIN sidebar. The existing backend route guards and permission model were not changed.
- Added clearer administration/finance/security section labels in the admin sidebar.
- Removed the six repeated administration shortcut cards from `AreaHome.tsx`. The user-count summary remains; the landing page now explains where administrative work is accessed.
- Changed the admin landing page heading to `Administration Dashboard` and promoted it to the page's H1.
- Updated the AppShell navigation test to assert the single-sidebar model and the absence of clinical workflow links for ADMIN.

## 3. Files changed

- `frontend/src/components/AppShell.tsx`
- `frontend/src/pages/AreaHome.tsx`
- `frontend/src/components/__tests__/app-shell.test.tsx`
- Deleted: `frontend/src/components/AdminNavTabs.tsx`

## 4. Remaining work for the repository owner

### P0 — Verify and complete the navigation cleanup

- [x] Confirmed the component had no remaining imports and deleted `frontend/src/components/AdminNavTabs.tsx`.
- [ ] Search the running frontend for the old vertical secondary sidebar. If it still appears, identify which component/build artifact renders it; the checked-in `AdminNavTabs.tsx` inspected for this change does not match that screenshot.
- [ ] Confirm the ADMIN route menu against the agreed role-permission matrix. This change hides patient records and appointments from the ADMIN sidebar; it does not remove or alter their route guards.
- [ ] Decide whether ADMIN should retain the `Billing & Payments` shortcut to `/reception/dues`, and whether it should be renamed to distinguish financial administration from reception collections.

### P1 — Standardize all administration pages

The following routes still need a visual consistency pass. This change did not rewrite their page-level layouts:

- [x] `/admin/settings`
- [x] `/admin/doctors`
- [x] `/admin/users`
- [x] `/admin/audit`
- [x] `/admin/backups`
- [x] `/admin/integrity`

For the six routes above, the shared `AdminPageLayout` now standardizes the page-level H1, breadcrumb, subtitle, responsive action slot, content width and vertical rhythm. Existing page-specific forms, tables, controls, loading/error states and confirmations remain in place. See `docs/ADMIN-PAGE-STANDARDIZATION.md` for the implementation inventory and remaining verification.

### P1 — Improve dashboard information architecture

- [ ] Replace the generic user-count-only summary with operational indicators backed by existing APIs: latest successful backup and timestamp, last integrity check and result, unresolved security/operational alerts, and recent audit activity.
- [ ] Do not show invented or hard-coded status values. If an API does not provide a metric, omit it or implement the API first.
- [ ] Add contextual quick actions only where they are genuinely useful; do not recreate the full navigation menu as cards.

### P2 — Responsive and accessibility review

- [ ] Test sidebar collapse at tablet and mobile widths.
- [ ] Confirm keyboard focus visibility, accessible names and active-route indication.
- [ ] Verify long Hindi/English hospital labels do not overflow.
- [ ] Confirm only the document/page owns the main vertical scrollbar.
- [ ] Review contrast for muted text, warning states and disabled controls.

## 5. Verification commands

Run from the `frontend/` directory:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

Then start the application using the repository's normal local/offline deployment procedure and verify:

1. ADMIN sees one sidebar and no secondary administration navigation.
2. ADMIN sees no patient records or appointment navigation entries.
3. Reception and Doctor navigation remains available for their allowed workflows.
4. Each admin sidebar item opens the correct route and shows the correct active state.
5. No navigation destination is duplicated on the admin landing page.
6. The screenshot/runtime no longer shows the old secondary sidebar after a clean rebuild and browser refresh.

**Important:** The GitHub connector was used to edit repository files; the frontend test suite, typecheck, lint and production build have not been executed in this environment. Treat the changes as unverified until those commands pass.
