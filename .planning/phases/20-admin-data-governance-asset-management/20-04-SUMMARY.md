# Phase 20 Plan 04 Summary: Bilingual Print Template Management

## Overview
Phase 20 Plan 04 establishes per-document-type bilingual print template management per D-20-04, SET-01, and BIL-04:
- Database schema migration `0016_print_templates.py` creating the `print_templates` table and idempotently seeding initial records for `prescription`, `receipt`, `registration_card`, and `consultation_summary` from existing `clinic_settings`.
- SQLAlchemy ORM model `PrintTemplate` and `PrintDocumentType` enum in `backend/src/kalyan_api/models.py`.
- Pydantic schemas `PrintTemplateRead` and `PrintTemplateUpdate` in `backend/src/kalyan_api/schemas/templates.py`.
- REST API router `admin_router` in `backend/src/kalyan_api/routers/templates.py` with `GET /api/admin/templates`, `GET /api/admin/templates/{doc_type}`, and `PATCH /api/admin/templates/{doc_type}`, guarded by `require(Permission.SETTINGS_WRITE)`, recording `PRINT_TEMPLATE_UPDATED` in the audit log and enforcing optimistic concurrency via version checking (HTTP 409 `version_conflict` on stale writes).
- Frontend bilingual template editor `PrintTemplateEditor.tsx` and admin page `PrintTemplatesPage.tsx` at `/admin/templates`, providing document selector tabs, accessible Hindi textareas (`lang="hi"`), optimistic concurrency conflict handling (`ConflictBanner`), and a live A4 document simulation canvas (`aspect-[1/1.414]`).

---

## Tasks Completed

### Task 1: Migration 0016, PrintTemplate Model, and Seed Data
- **Files Created / Modified:**
  - `backend/src/kalyan_api/migrations/versions/0016_print_templates.py`
  - `backend/src/kalyan_api/models.py`
- **Accomplishments:**
  - Authored migration `0016_print_templates.py` (revising `0015`), creating table `print_templates` with columns (`id`, `document_type`, `header_en`, `header_hi`, `footer_en`, `footer_hi`, `version`, `updated_by_user_id`, `updated_at`, `created_at`).
  - Added constraints: unique constraint on `document_type` and check constraint limiting values to `('prescription', 'receipt', 'registration_card', 'consultation_summary')`.
  - Added index `ix_print_templates_updated_by` on `updated_by_user_id`.
  - Seeded 4 initial rows for `prescription`, `receipt`, `registration_card`, `consultation_summary` populated from `clinic_settings` (id=1).
  - Granted table permissions (`SELECT, INSERT, UPDATE`) to `kalyan_app`.
  - Declared `PrintDocumentType` StrEnum and `PrintTemplate` ORM model in `models.py` with `__mapper_args__ = {"version_id_col": version}`.
- **Verification:**
  - `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_migrations.py -q` passed with 3 tests.
- **Commit:** `3b7e55d feat(20-04): migration 0016 print_templates table and seed data`

---

### Task 2: Print Template REST Endpoints and Audit Event
- **Files Created / Modified:**
  - `backend/src/kalyan_api/services/audit_service.py`
  - `backend/src/kalyan_api/schemas/templates.py`
  - `backend/src/kalyan_api/routers/templates.py`
  - `backend/src/kalyan_api/main.py`
  - `backend/tests/test_print_templates_api.py`
- **Accomplishments:**
  - Added `AuditAction.PRINT_TEMPLATE_UPDATED = "PRINT_TEMPLATE_UPDATED"` to `AuditAction`.
  - Added `PrintTemplateRead` and `PrintTemplateUpdate` Pydantic schemas to `schemas/templates.py`.
  - Implemented `admin_router` in `routers/templates.py`:
    - `GET /api/admin/templates`: lists all 4 print templates in deterministic order, guarded by `require(Permission.SETTINGS_WRITE)`.
    - `GET /api/admin/templates/{doc_type}`: retrieves single print template or raises 404 `template_not_found`.
    - `PATCH /api/admin/templates/{doc_type}`: validates client version against database record (raising 409 `version_conflict` on mismatch), updates header/footer fields, increments version, and records `PRINT_TEMPLATE_UPDATED` in the audit log with `before` and `after` states.
  - Mounted `admin_templates_router` in `backend/src/kalyan_api/main.py`.
  - Wrote test suite `backend/tests/test_print_templates_api.py` covering list seeding, single fetch, patch version increment, audit logging, 409 conflict, and RBAC restrictions.
- **Verification:**
  - `backend\.venv\Scripts\python.exe -m pytest backend/tests/test_print_templates_api.py backend/tests/test_route_policies.py -q` passed with 7 tests.
- **Commit:** `22aadd2 feat(20-04): print templates REST API and audit event`

---

### Task 3: Frontend PrintTemplateEditor Component and Admin Templates Page
- **Files Created / Modified:**
  - `frontend/src/api/types.ts`
  - `frontend/src/api/queries.ts`
  - `frontend/src/components/admin/PrintTemplateEditor.tsx`
  - `frontend/src/pages/admin/PrintTemplatesPage.tsx`
  - `frontend/src/router.tsx`
  - `frontend/src/pages/__tests__/print-templates.test.tsx`
- **Accomplishments:**
  - Added `PrintDocumentType`, `PrintTemplateOut`, and `PrintTemplateUpdatePayload` to `types.ts`.
  - Added React Query hooks `usePrintTemplates`, `usePrintTemplate`, and `useUpdatePrintTemplate` to `queries.ts`.
  - Built `PrintTemplateEditor.tsx`:
    - Document selector tabs for `Prescription Slip`, `Payment Receipt`, `Registration Identity Card`, and `Patient Consultation Summary`.
    - Split-screen workspace: left column with metadata version pill, bilingual textareas (marked `lang="hi"` for Hindi inputs), 44px min touch target, and "Save Print Template" CTA.
    - Concurrency conflict handling with `<ConflictBanner>` upon HTTP 409 responses.
    - Right column with live A4 simulation canvas (`aspect-[1/1.414]`) updating in real-time as users type.
    - Document-type specific simulation preview: Rx symbol and medications for prescription, receipt itemization for receipt, identity card with photo placeholder for registration card, and clinical assessment for consultation summary.
    - Historical reprint snapshot callout explaining that template changes apply to newly issued documents while historical reprints retain issued snapshots.
  - Built `PrintTemplatesPage.tsx` mounted inside `AppShell` and wired into `/admin/templates` in `router.tsx`.
  - Authored frontend unit tests in `print-templates.test.tsx` verifying tab switching, real-time live preview updates, `lang="hi"` presence, and conflict banner reload.
  - Resolved UX-04 legibility guard compliance (minimum 12px font size and proper slate contrast).
- **Verification:**
  - `npm.cmd test -- print-templates.test.tsx --run` passed with 7/7 tests.
  - `npm.cmd test -- guards.test.ts --run` passed with 15/15 tests.
  - `npm.cmd run typecheck` passed with 0 TypeScript errors.
- **Commits:**
  - `2a958e5 feat(20-04): bilingual print template editor UI and live preview`
  - `fc542b0 fix(20-04): resolve legibility guard violations in PrintTemplateEditor`

---

## Verification Summary Table

| Test Suite | Commands Executed | Result |
|------------|-------------------|--------|
| Database Migrations | `pytest backend/tests/test_migrations.py -q` | 3 passed |
| Print Templates REST API | `pytest backend/tests/test_print_templates_api.py -q` | 5 passed |
| Route Security Policies | `pytest backend/tests/test_route_policies.py -q` | 2 passed |
| Frontend Components | `npm test -- print-templates.test.tsx --run` | 7 passed |
| Quality & Accessibility Guards | `npm test -- guards.test.ts --run` | 15 passed |
| Frontend Typecheck | `npm run typecheck` | 0 errors |

---

## Artifacts Produced
- `backend/src/kalyan_api/migrations/versions/0016_print_templates.py`
- `backend/src/kalyan_api/models.py` (`PrintTemplate`, `PrintDocumentType`)
- `backend/src/kalyan_api/schemas/templates.py` (`PrintTemplateRead`, `PrintTemplateUpdate`)
- `backend/src/kalyan_api/routers/templates.py` (`admin_router`)
- `frontend/src/components/admin/PrintTemplateEditor.tsx`
- `frontend/src/pages/admin/PrintTemplatesPage.tsx`
- `backend/tests/test_print_templates_api.py`
- `frontend/src/pages/__tests__/print-templates.test.tsx`
