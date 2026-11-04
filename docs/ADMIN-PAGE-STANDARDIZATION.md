# Administration page standardization

**Status:** Implemented on `feat/admin-page-standardization-p1-2026-11-04`  
**Base:** `fix/admin-navigation-hierarchy-2026-11-04` (PR #15)  
**Scope:** Shared page framing for the six administration routes. This is a frontend presentation change; it does not change API contracts, backend permissions, data models or route guards.

## Implemented

Added `frontend/src/components/AdminPageLayout.tsx`, a shared wrapper for all six admin workspaces.

The wrapper standardizes:
- One page-level H1 with a consistent size and hierarchy.
- A breadcrumb linking back to Administration and identifying the current page.
- A concise explanatory subtitle.
- A responsive header that moves page actions below the title on narrow screens.
- Consistent maximum content width and vertical rhythm.
- Shared integration with the existing primary `AppShell`; no secondary navigation is introduced.

Applied to:

| Route | Page | Header action |
|---|---|---|
| `/admin/settings` | Clinic Settings | Existing save action remains in the form |
| `/admin/doctors` | Doctors & Consultation Fees | Existing Add Doctor / Add Fee Rate actions remain in their sections |
| `/admin/users` | User Management | Create User |
| `/admin/audit` | Audit & Compliance | Refresh Logs |
| `/admin/backups` | Backup & Recovery | Refresh Archives |
| `/admin/integrity` | System Integrity | Run Integrity Check |

Existing page-specific forms, tables, filters, dialogs, query hooks, mutations and empty/loading/error states are retained. Page actions have only been repositioned into the common header where appropriate.

## Tests updated or added

- Added `frontend/src/components/__tests__/admin-page-layout.test.tsx` for the shared breadcrumb, H1, description and action slot.
- Updated the audit, backup and integrity page title assertions to match the standardized page titles.
- Existing settings and doctor workflow tests remain in place.

## Explicitly not changed

- No backend endpoint or permission changes.
- No route guard changes.
- No data/API contract changes.
- No dashboard KPI or operational metric work. Metrics must be backed by existing API data; they should not be fabricated as part of a visual pass.
- No claim that responsive, keyboard, screen-reader or real-browser checks have been completed.

## Verification still required

Run from `frontend/`:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Then manually inspect all six routes at desktop, tablet and mobile widths. Confirm there is one H1 per page, no duplicate page heading, no nested vertical scrollbar, no clipped Hindi/English text, and that action buttons remain reachable by keyboard.

**Status note:** Repository files were updated through GitHub. These checks have not been run in this environment, so this branch is not yet verified or merge-ready.
