# Phase 20 Plan 03 Summary: Hospital Identity & Asset Management

## Overview
Phase 20 Plan 03 establishes complete hospital identity and asset governance:
- Database schema migration `0015_hospital_assets.py` tracking asset metadata and versioning.
- Secure filesystem storage and validation service `asset_service.py` with magic-byte verification (PNG, JPEG, WebP, SVG, PDF up to 10 MB) and immutable version retention.
- REST API router `routers/assets.py` with admin management endpoints guarded by `SETTINGS_WRITE` and a public endpoint `GET /api/assets/active-logo`.
- Backup bundle extensions in `backup_service.py` bundling the assets directory and computing cryptographic SHA-256 manifests.
- Data integrity inspection in `integrity_service.py` detecting missing asset files and untracked disk orphans.
- Accessible frontend React components `HospitalAssetManager.tsx` and `HospitalAssetsPage.tsx` at `/admin/assets`.

---

## Tasks Completed

### Task 1: Migration 0015, SQLAlchemy Model, and Asset Service
- **Files Created / Modified:**
  - `backend/src/kalyan_api/config.py`
  - `backend/src/kalyan_api/migrations/versions/0015_hospital_assets.py`
  - `backend/src/kalyan_api/models.py`
  - `backend/src/kalyan_api/main.py`
  - `backend/src/kalyan_api/services/asset_service.py`
- **Accomplishments:**
  - Added `assets_dir: Path = Field(default=BACKEND_DIR / "var" / "assets")` to `Settings`, configurable via `KALYAN_ASSETS_DIR`.
  - Created migration `0015_hospital_assets.py` revising `0014`, establishing `hospital_assets` table with check constraints and table permissions granted to `kalyan_app` (without `DELETE` to enforce immutability).
  - Defined `HospitalAsset` ORM model and `AssetType` StrEnum (`LOGO`, `PHOTO`, `REGISTRATION_DOC`).
  - Implemented `asset_service.py`:
    - `validate_asset_bytes`: validates PNG, JPEG, WebP, SVG, and PDF headers up to 10 MB (rejects oversized or invalid formats with HTTP 422).
    - `save_asset`: generates random UUID filenames outside the web root. For `LOGO` assets, calculates the next incremented version and marks prior active logos as inactive while retaining all files and historical database rows.
    - `deactivate_asset`: sets `is_active = False` without deleting physical files.
    - `get_active_logo`: queries the newest active logo crest.
    - `get_asset_path`: resolves sanitized asset paths defeating directory traversal.
- **Verification:**
  - `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_migrations.py -q` passed with 3 tests.
- **Commit:** `a7db0d0 feat(20-03): migration 0015 hospital_assets and asset_service`

---

### Task 2: REST Endpoints, Backup Bundle Extension, and Integrity Check
- **Files Created / Modified:**
  - `backend/src/kalyan_api/routers/assets.py`
  - `backend/src/kalyan_api/main.py`
  - `backend/src/kalyan_api/services/audit_service.py`
  - `backend/src/kalyan_api/services/backup_service.py`
  - `backend/src/kalyan_api/services/integrity_service.py`
  - `backend/tests/test_assets_api.py`
  - `backend/tests/test_backup_assets.py`
  - `backend/tests/test_route_policies.py`
- **Accomplishments:**
  - Added `AuditAction.ASSET_UPLOADED` and `AuditAction.ASSET_DEACTIVATED` to `AuditAction`.
  - Created router `routers/assets.py`:
    - `POST /api/admin/assets`: multipart upload guarded by `require(Permission.SETTINGS_WRITE)`. Records `ASSET_UPLOADED` audit event.
    - `GET /api/admin/assets`: lists assets ordered by creation time, guarded by `require(Permission.SETTINGS_WRITE)`.
    - `POST /api/admin/assets/{id}/deactivate`: deactivates asset, guarded by `require(Permission.SETTINGS_WRITE)`.
    - `GET /api/admin/assets/{id}/file`: authenticated asset download/streaming.
    - `GET /api/assets/active-logo`: unauthenticated public endpoint streaming the active logo crest or built-in fallback crest. Added to `PUBLIC_ALLOWLIST` in `test_route_policies.py`.
  - Extended `backup_service.py`:
    - Added `hospital_assets` to `RUNTIME_TABLE_GRANTS`.
    - Added `assets_count` and `assets_manifest` to `BackupManifest`.
    - Included `assets/` directory and SHA-256 manifest in `create_backup()`.
    - Added cryptographic checksum verification of assets in `verify_backup_bundle()`.
    - Restores `assets/` into `settings.assets_dir` during `restore_backup()`.
  - Extended `integrity_service.py`:
    - Implemented `check_asset_storage_integrity()`, integrated into `run_integrity_audit()`.
  - Wrote test suites `test_assets_api.py` and `test_backup_assets.py`.
- **Verification:**
  - `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_assets_api.py backend/tests/test_backup_assets.py backend/tests/test_route_policies.py -q` passed with 12 tests.
- **Commit:** `08572ae feat(20-03): asset endpoints, backup bundling, and integrity checks`

---

### Task 3: Frontend Hospital Asset Manager UI and Page Component
- **Files Created / Modified:**
  - `frontend/src/api/types.ts`
  - `frontend/src/api/queries.ts`
  - `frontend/src/components/admin/HospitalAssetManager.tsx`
  - `frontend/src/pages/admin/HospitalAssetsPage.tsx`
  - `frontend/src/router.tsx`
  - `frontend/src/pages/__tests__/hospital-assets.test.tsx`
- **Accomplishments:**
  - Declared `AssetType` and `HospitalAssetOut` TypeScript types.
  - Implemented React Query hooks `useHospitalAssets`, `useUploadAsset`, and `useDeactivateAsset`.
  - Built `HospitalAssetManager.tsx` satisfying UI-SPEC design system and copywriting contracts:
    - **Active Hospital Crest Hero Card**: framed logo crest with dimensions, MIME, file size, upload date, and active badge.
    - **Upload CTA & Modal**: drag-and-drop dropzone, type selector (`LOGO`, `REGISTRATION_DOC`, `PHOTO`), 10 MB validation, and accessible `<Modal>`.
    - **Historical Asset Table**: thumbnails, types, versions, uploaded by, timestamps, status pills (`ACTIVE` / `ARCHIVED`), and preview/deactivate actions.
    - **Deactivation Confirmation Modal**: destructive confirmation dialog following exact copywriting contract.
    - **Empty State**: displays "No Additional Assets Uploaded" when asset collection is empty.
  - Mounted `HospitalAssetsPage` inside `AppShell` at `/admin/assets` in `router.tsx`.
  - Wrote comprehensive frontend unit tests in `hospital-assets.test.tsx`.
  - Verified and passed all project quality guards (`guards.test.ts` for accessibility names and legibility contrast).
- **Verification:**
  - `npm.cmd test -- hospital-assets.test.tsx --run` passed with 5/5 tests.
  - `npm.cmd test -- guards.test.ts --run` passed with 15/15 tests.
  - `npm.cmd run typecheck` passed with 0 TypeScript errors.
- **Commits:**
  - `2d7fe55 feat(20-03): hospital asset manager UI and page component`
  - `749d8a2 fix(20-03): resolve accessibility and legibility guard violations in HospitalAssetManager`

---

## Verification Summary Table

| Test Suite | Commands Executed | Result |
|------------|-------------------|--------|
| Database Migrations | `pytest backend/tests/test_migrations.py -q` | 3 passed |
| Asset REST API | `pytest backend/tests/test_assets_api.py -q` | 6 passed |
| Backup & Integrity | `pytest backend/tests/test_backup_assets.py -q` | 4 passed |
| Route Security Policies | `pytest backend/tests/test_route_policies.py -q` | 2 passed |
| Frontend Components | `npm test -- hospital-assets.test.tsx --run` | 5 passed |
| Quality & Accessibility Guards | `npm test -- guards.test.ts --run` | 15 passed |
| Frontend Typecheck | `npm run typecheck` | 0 errors |

---

## Artifacts Produced
- `backend/src/kalyan_api/migrations/versions/0015_hospital_assets.py`
- `backend/src/kalyan_api/models.py` (`HospitalAsset`, `AssetType`)
- `backend/src/kalyan_api/services/asset_service.py`
- `backend/src/kalyan_api/routers/assets.py`
- `frontend/src/components/admin/HospitalAssetManager.tsx`
- `frontend/src/pages/admin/HospitalAssetsPage.tsx`
- `backend/tests/test_assets_api.py`
- `backend/tests/test_backup_assets.py`
- `frontend/src/pages/__tests__/hospital-assets.test.tsx`
