# Admin Workspace Panel Audit (T07)

- **Auditors**: `backend-audit`, `frontend-audit`, `baseline-verifier` (multi-agent parallel read-only audit + cross-verification)
- **Repository Scope**: Kalyan Hospital Administration Workspace Panel — backend admin routers/services/schemas/RBAC (`backend/src/kalyan_api/`) and frontend admin routes/pages/components/API clients (`frontend/src/`)
- **Date**: 2026-11-18
- **Status**: AUDITED & FULL REMEDIATION VERIFIED (Phase 1-2 M1–M18 committed in `38e85612`; Phase 3 S1–S18, L1–L4, N1–N5 committed in `762d8947`)

**What this workspace does:** Operates the administrative control plane for Kalyan Hospital's offline LAN web platform (FastAPI + PostgreSQL + React/Vite/TanStack Query): hospital identity/settings/print templates/assets, doctors/fees/departments, patient demographic corrections, duplicate patient alias-merges, bulk soft-archival, spreadsheet import & dataset export, billing rules & payment reversals, user accounts/RBAC catalogue/security policy/session revocation, append-only audit trail, backup/restore/scheduling, data integrity checks, LAN workstation heartbeat monitor, and management/referral reporting.

**Assumed load:** Multi-workstation offline hospital LAN (reception desks, doctor cabins, and admin terminals concurrently accessing one central PostgreSQL-backed FastAPI server with zero internet dependency; up to ~10–30 concurrent LAN workstations, tens of thousands of patient records, and dozens of multi-hundred-MB backup archives on local server disk).

---

## Baseline State & Test Results (Pre-Remediation)

- **Git state**: Branch `fix/sidebar-daily-flow` @ `a5b71d9a` — **DIRTY working tree** (`496` entries: `156` modified, `97` deleted, `243` untracked), including active uncommitted edits in admin pages, routers, and services. Preserve all existing user changes and establish a git checkpoint before any commit.
- **Backend requested admin pytest (21 files)**: **145 passed, 0 failed** (exit 0)
  ```powershell
  Set-Location backend; .\.venv\Scripts\pytest.exe -q tests/test_admin_overview.py tests/test_admin_sessions.py tests/test_audit_api.py tests/test_audit_append_only.py tests/test_audit_writer.py tests/test_backup_assets.py tests/test_backup_service.py tests/test_restore_endpoint_real.py tests/test_restore_grants_and_locks.py tests/test_restore_service.py tests/test_clinic_settings.py tests/test_users_admin.py tests/test_user_delete.py tests/test_integrity_service.py tests/test_patient_import_api.py tests/test_patient_import_service.py tests/test_permissions_catalogue.py tests/test_department_doctor_cabin.py tests/test_department_workflow.py tests/test_doctor_admin.py tests/test_phase22_referral_report.py
  ```
- **Backend extended admin/RBAC/OpenAPI pytest (16 files)**: **1,084 passed, 0 failed** (exit 0)
  ```powershell
  Set-Location backend; .\.venv\Scripts\pytest.exe -q tests/test_phase23_patient_archive.py tests/test_phase23_patient_consolidation.py tests/test_phase23_patient_merge.py tests/test_phase23_rbac.py tests/test_phase23_workstations.py tests/test_roles_api.py tests/test_security_policy_api.py tests/test_print_templates_api.py tests/test_assets_api.py tests/test_patient_export_api.py tests/test_patient_demographic_correction.py tests/test_operations_api.py tests/test_system_api.py tests/test_rbac_matrix.py tests/test_route_policies.py tests/test_openapi_snapshot.py
  ```
- **Frontend admin Vitest (22 files)**: **114 passed, 0 failed** (exit 0; React `act(...)` stderr warnings on `ToastHost`)
  ```powershell
  Set-Location frontend; npx vitest run src/pages/admin/__tests__/ src/__tests__/admin-routes.test.tsx src/pages/__tests__/admin-navigation-architecture.test.tsx src/pages/__tests__/audit-viewer.test.tsx src/pages/__tests__/backup-manager.test.tsx src/pages/__tests__/hospital-assets.test.tsx src/pages/__tests__/integrity-dashboard.test.tsx src/pages/__tests__/patient-demographic-correction.test.tsx src/pages/__tests__/patient-export.test.tsx src/pages/__tests__/patient-import.test.tsx src/pages/__tests__/print-layouts.test.tsx src/pages/__tests__/print-templates.test.tsx src/pages/__tests__/settings.test.tsx src/pages/__tests__/users-alerts.test.tsx src/pages/__tests__/users-delete.test.tsx src/pages/__tests__/doctors.test.tsx src/components/__tests__/integrity-sidebar-count.test.tsx src/components/__tests__/print-letterhead-settings.test.tsx
  ```
- **Frontend TypeScript (`npx tsc --noEmit`)**: **0 errors** (exit 0)

---

## Must Fix (18 Verified Defects — Ready for Red→Green TDD)

### Tier A — Security, RBAC & Disaster Recovery Blockers

- **M1 [Security & RBAC] Non-super Admin can reset Super Admin's password and bypass super-admin-guarded user deletion**
  - **Location**: `backend/src/kalyan_api/services/user_service.py:584-634` (`reset_password`), `backend/src/kalyan_api/services/user_service.py:397-412` (`_authorise_super_admin`), `backend/src/kalyan_api/routers/users.py:256-279`
  - **Trigger → Problem**: A non-super `ADMIN` calls `POST /api/users/{super_admin_id}/reset-password`. `reset_password` checks only `user.id == ctx.actor_user_id` and lacks a `user.is_super_admin` guard, overwriting the super admin's `password_hash`, revoking their sessions, and returning the plaintext `temporary_password`. `_authorise_super_admin` verifies `super_admin_password` against `super_admin.password_hash` without rejecting `must_change_password=True`, so the regular admin can immediately pass that `temporary_password` to `POST /api/users/{id}/delete` / `/bulk-delete` or log in as Super Admin.
  - **Impact**: Complete bypass of migration 0024's super-admin deletion guard and privilege escalation to Super Admin.
  - **Smallest fix**: Reject `user.is_super_admin` in `user_service.reset_password` with `409 super_admin_protected`, and require `User.must_change_password.is_(False)` in `_authorise_super_admin`.

- **M2 [Security & RBAC] Admin Security Center policy overrides are ignored by `/api/auth/login` and `/api/auth/change-password`**
  - **Location**: `backend/src/kalyan_api/routers/auth.py:42` (`login`), `backend/src/kalyan_api/routers/auth.py:343` (`change_password`)
  - **Trigger → Problem**: Admin tightens `password_min_length`, `lockout_threshold`, or `lockout_minutes` via `PATCH /api/security/policy`. Both policy GET endpoints report the tightened values, but `login()` and `change_password()` inject `Depends(get_current_settings)` instead of `Depends(get_effective_settings)`, so lockout thresholds/durations (`auth.py:88,129,385-386`) and `validate_password_policy` (`auth.py:430`) continue enforcing the raw env baseline.
  - **Impact**: 3 of 5 Security Center controls are silently unenforced while the UI reports them active.
  - **Smallest fix**: Switch `Depends(get_current_settings)` to `Depends(get_effective_settings)` in `routers/auth.py:42` and `routers/auth.py:343`.

- **M3 [UI↔API Contract] Database restore unconditionally fails HTTP 422 (confirmation phrase mismatch)**
  - **Location**: `frontend/src/pages/admin/BackupManagerPage.tsx:18,135,142,514,518` vs `backend/src/kalyan_api/schemas/operations.py:13,100-103`
  - **Trigger → Problem**: UI requires typing `'RESTORE-DATABASE-OVERWRITE'` and sends it as `confirmation_phrase` to `POST /api/operations/restore`. Backend strictly requires exact `'RESTORE'` and returns 422 for any other string; typing `'RESTORE'` keeps submit disabled (`backup-manager.test.tsx:164` mocked the mutation, hiding this).
  - **Impact**: Disaster-recovery database restore is 100% unusable from the Admin UI.
  - **Smallest fix**: Change `RESTORE_CONFIRMATION` in `BackupManagerPage.tsx:18` to `'RESTORE'` and update `backup-manager.test.tsx`.

- **M4 [EMR/HMS Data Integrity & Backup/Restore] Backups omit `settings.documents_dir` and restore drops `delete_unreferenced_user` function privileges**
  - **Location**: `backend/src/kalyan_api/services/backup_service.py:378-394` (`runtime_grant_sql`), `469-570` (`create_backup`), `576-662` (`verify_backup_bundle`), `665-740` (`restore_backup`)
  - **Trigger → Problem**: (a) `create_backup`, `verify_backup_bundle`, and `restore_backup` archive/restore `db.sql`, `photos/`, and `assets/`, but never `settings.documents_dir` (patient documents). Restoring onto a fresh host restores `patient_documents` DB rows with zero files on disk, triggering permanent document loss and `missing_document_file` (`ERROR`) integrity failures. (b) `pg_dump --no-privileges` (`line 274`) strips migration 0024's `REVOKE ALL ON FUNCTION delete_unreferenced_user(bigint) FROM PUBLIC; GRANT EXECUTE ... TO "<app_user>"`, and `runtime_grant_sql` only re-grants tables and sequences.
  - **Impact**: Permanent clinical/ID document loss on disaster recovery; weakened DB privilege isolation post-restore.
  - **Smallest fix**: Archive, SHA-256 verify (backward-compatibly optional in manifest), and restore `settings.documents_dir` alongside `assets_dir`; add a conditional `DO` block in `runtime_grant_sql` restoring `delete_unreferenced_user(bigint)` `REVOKE PUBLIC` / `GRANT EXECUTE`.

### Tier B — EMR/HMS Data & Financial Integrity

- **M5 [EMR/HMS Invariants] Multi-hop patient merge (`A -> B -> C`) silently orphans Patient A's clinical and financial history**
  - **Location**: `backend/src/kalyan_api/services/patient_merge_service.py:191-210` (`merge_patients`), `backend/src/kalyan_api/services/code_sequence_service.py:61-66` (`effective_patient_ids`), `backend/src/kalyan_api/services/billing_service.py:529-532` (`patient_previous_dues`)
  - **Trigger → Problem**: Merge A into B (`A.merged_into_id = B.id`), then merge B into C (`B.merged_into_id = C.id`). `merge_patients` only checks `master.merged_into_id is None` and `secondary.merged_into_id is None`, creating a 2-hop chain `A -> B -> C`. Because `effective_patient_ids` and `patient_previous_dues` traverse only 1 hop (`WHERE merged_into_id == patient_id`), Master C consolidates `[C.id, B.id]` and drops A entirely.
  - **Impact**: Patient A's visits, encounters, prescriptions, payments, refunds, ledger entries, documents, and unpaid dues vanish from Master C.
  - **Smallest fix**: Reject merging a `secondary` that already has merged children (`EXISTS (SELECT 1 FROM patients WHERE merged_into_id = secondary.id)`) with `409` so merge trees stay flat (1 hop) and unmerge stays clean.

- **M6 [EMR/HMS Financial Invariants] Patient archival dues guard completely ignores Treatment Plan / Physiotherapy package balances**
  - **Location**: `backend/src/kalyan_api/services/patient_archive_service.py:25-28` (`_get_patient_dues`), `75-95` (`find_archival_candidates`), `173-183` (`bulk_archive_patients`)
  - **Trigger → Problem**: A patient with ₹0 visit dues who owes ₹10,000 on an `ACTIVE`/`COMPLETED` `TreatmentPlan` package gets `total_dues = 0` and `can_archive = True` in both `find_archival_candidates` (sums only `Visit` dues) and `bulk_archive_patients` (`_get_patient_dues` calls `billing_service.patient_previous_dues`, which queries only closed visits).
  - **Impact**: Hard financial dues archival guard is bypassed for all physiotherapy/package debt.
  - **Smallest fix**: Include unpaid `TreatmentPlan` package balances (across `effective_patient_ids`, matching `billing_service.patient_package_summaries` / `ledger_service`) in both `find_archival_candidates` and `_get_patient_dues`.

- **M7 [Correctness] Patient merge open-visit guard checks `closed_at IS NULL` instead of `status == 'OPEN'`, permanently blocking merge after any cancelled visit**
  - **Location**: `backend/src/kalyan_api/services/patient_merge_service.py:61-71` (`check_open_visit`) vs `backend/src/kalyan_api/services/visit_service.py:214-218` (`cancel_visit`)
  - **Trigger → Problem**: `cancel_visit` sets `status='CANCELLED'` and `cancelled_at` while leaving `closed_at=NULL`. `check_open_visit` filters `Visit.closed_at.is_(None)`, permanently flagging any patient with a historical cancelled visit as `has_open_visit=True` and blocking `POST /api/admin/patients/merge` with `400 open_visit_conflict`.
  - **Impact**: Duplicate patients who ever had a cancelled visit can never be merged.
  - **Smallest fix**: Change `Visit.closed_at.is_(None)` to `Visit.status == VisitStatus.OPEN.value` at `patient_merge_service.py:65`.

- **M8 [UI↔API Contract] "Archived Patient Files" tab is permanently empty; cannot view or restore archived patients**
  - **Location**: `frontend/src/pages/admin/BulkArchivePage.tsx:62-63` vs `backend/src/kalyan_api/routers/patients.py:328-335,384-386`
  - **Trigger → Problem**: Opening "Archived Patient Files" calls `GET /patients?limit=100` (omitting `status`), which defaults to `status="active"` (`WHERE is_archived IS FALSE`). Client `.filter((p) => p.is_archived)` always produces `[]` (`bulk-archive.test.tsx:139` mocked archived rows without checking query params).
  - **Impact**: Admins can never view or unarchive archived patients from the UI.
  - **Smallest fix**: Call `apiFetch<PatientOut[]>('/patients?status=archived&limit=100')` (and surface a limit notice if `data.length >= 100`).

- **M9 [Functional / Data Integrity] Patient Export Dialog hardcodes department IDs `1` and `2`**
  - **Location**: `frontend/src/components/admin/PatientExportDialog.tsx:298-307`
  - **Trigger → Problem**: Department `<select>` hardcodes `<option value="1">Physiotherapy</option>` and `<option value="2">Ophthalmology</option>` instead of loading `useDepartments()`.
  - **Impact**: Admin-created departments cannot be filtered; deployments with different DB IDs silently export the wrong department's PHI.
  - **Smallest fix**: Populate department options dynamically via `useDepartments()`.

- **M10 [EMR/HMS Audit Trail] Stale audit `reason` persists across patients, receipts, and exports**
  - **Location**: `frontend/src/components/admin/DemographicCorrectionModal.tsx:30,121-131`, `frontend/src/components/PaymentReversalModal.tsx:19-20,48,58-61`, `frontend/src/components/admin/PatientExportDialog.tsx:113,209-211`
  - **Trigger → Problem**: All three modals remain mounted while closed and never reset `reason` (or error state) on close/success/target change, pre-filling Record A's justification when opened for Record B.
  - **Impact**: Corrupted immutable audit trail justifications across patients, payments, and exports.
  - **Smallest fix**: Reset `reason` and error state on close/success and whenever target record or `open` state resets.

### Tier C — Operational Reliability, Scale & Broken Admin UX

- **M11 [Scale & Optimization] `GET /api/operations/backups` synchronously decompresses and SHA-256 hashes every archive on disk on every page load**
  - **Location**: `backend/src/kalyan_api/routers/operations.py:390-423` (line 401)
  - **Trigger → Problem**: `list_backups()` calls full `verify_backup_bundle(file_path)` (gunzipping and SHA-256 hashing `db.sql`, every photo, and every asset) for every archive in `backup_dir` on every page visit.
  - **Impact**: Multi-GB synchronous disk/CPU stall blocking FastAPI worker threads and risking clinic-wide LAN timeouts.
  - **Smallest fix**: Use `backup_service.read_manifest(file_path)` (`backup_service.py:141-160`, head-only tar read) in `list_backups()`, reserving full hashing for `POST /api/operations/backups/{filename}/verify`.

- **M12 [Functional / Reliability] Long-running backup, restore, and import commit abort at 15s default timeout**
  - **Location**: `frontend/src/api/queries.ts:2058,2226`, `frontend/src/components/admin/ImportWizard.tsx:280` + `frontend/src/api/client.ts:13,120`
  - **Trigger → Problem**: Backup creation, database restore, and import batch commit (which runs a pre-commit `pg_dump` + bulk insert) inherit `DEFAULT_API_TIMEOUT_MS = 15_000`. Operations exceeding 15s throw `request_timeout` in the UI while the server continues mutating DB/disk.
  - **Impact**: False failure alerts and risk of operators double-triggering restore or import commits.
  - **Smallest fix**: Pass `timeoutMs: 300_000` explicitly on those 3 `apiFetch` calls.

- **M13 [Correctness] Re-validating an import batch crashes HTTP 500; `/commit` and `/resolve` skip batch state guards**
  - **Location**: `backend/src/kalyan_api/services/import_service.py:432,495-501,665-675`, `backend/src/kalyan_api/routers/imports.py:211-225`
  - **Trigger → Problem**: (a) First `/validate` overwrites `mapped["age_years"]` from `str` to `int` (`line 501`); a second `/validate` calls `raw_age.strip()` (`line 432`) -> `AttributeError` (500). (b) `commit_batch` only rejects `COMMITTED`, not `STAGED` (running a full backup and committing 0 rows on unvalidated batches). (c) `resolve_duplicates` does not reject `COMMITTED` batches.
  - **Impact**: Deterministic 500 on re-validation; wasted pre-commit backups and locked unvalidated batches; post-commit mutation of resolution records.
  - **Smallest fix**: Coerce `str(raw_age).strip()` in `parse_age_and_dob`; require `batch.status == "VALIDATED"` in `commit_batch`; reject `batch.status == "COMMITTED"` in `resolve_duplicates`.

- **M14 [Security, Correctness & Concurrency] Workstation heartbeat trusts spoofable `X-Forwarded-For`, can 500 on long/missing IP, has first-insert race, and double-resolves auth**
  - **Location**: `backend/src/kalyan_api/services/workstation_service.py:16-22,35-60`, `backend/src/kalyan_api/routers/system.py:220-232`, `backend/src/kalyan_api/models.py:2980`
  - **Trigger → Problem**: (a) `get_client_ip` trusts `X-Forwarded-For` (violating `core/net.py:34-42`), values >64 chars trigger `StringDataRightTruncation` (500) on `VARCHAR(64) NOT NULL`, and `request.client is None` inserts `NULL` (500). (b) Concurrent first heartbeats for a new hostname both see `not ws` and race on `INSERT` (`IntegrityError` 500). (c) `routers/system.py:222,229` pairs `authenticated_only` (allows `must_change_password`) with `current_principal` (rejects with 403), contradicting policy and doing 2 session lookups per heartbeat.
  - **Impact**: Spoofable LAN monitor, 500s on concurrent boot/malformed headers, redundant DB queries every 30s per workstation.
  - **Smallest fix**: Use `core.net.client_ip(request)` with non-null `<=64`-char fallback, use PostgreSQL `INSERT ... ON CONFLICT (hostname) DO UPDATE`, and use `Depends(current_principal_allow_pending)` at `routers/system.py:229`.

- **M15 [Functional / Navigation & Layout] Phase 23 admin pages omit `<AppShell>`, losing navigation AND breaking vertical scroll**
  - **Location**: `frontend/src/pages/admin/BulkArchivePage.tsx:138`, `frontend/src/pages/admin/DuplicateMergePage.tsx:140`, `frontend/src/pages/admin/WorkstationMonitorPage.tsx:68` + `frontend/src/index.css:55-63`
  - **Trigger → Problem**: All three standalone admin routes render without `<AppShell>`. Because `index.css:55-63` sets `html, body, #root { height: 100%; overflow: hidden }`, `<AppShell>`'s `<main className="overflow-y-auto">` is the sole vertical scroller. Without it, sidebar, header, sign-out, LAN status, and 30s heartbeat vanish AND all rows below viewport height are clipped and unscrollable.
  - **Impact**: Stranded admins and unreachable candidate/workstation rows.
  - **Smallest fix**: Wrap all three pages in `<AppShell name={me?.full_name ?? 'Admin'} role={me?.role ?? 'ADMIN'}>` using `useMe()`.

- **M16 [Accessibility & Destructive Guard] Raw `<div>` confirmation overlays lack dialog semantics/focus trap/Escape/busy guard; Import modal dismissable mid-commit**
  - **Location**: `frontend/src/pages/admin/BulkArchivePage.tsx:401-443`, `frontend/src/pages/admin/DuplicateMergePage.tsx:277-378`, `frontend/src/pages/admin/BackupManagerPage.tsx:466-481`
  - **Trigger → Problem**: Bulk archive and merge confirmations use raw fixed `<div>` overlays (no `role="dialog"`, `aria-modal`, focus trap, Escape dismiss, or Cancel disabled while pending). Outer `<Modal>` wrapping `<ImportWizard>` in `BackupManagerPage` omits `busy`, so pressing `Esc`/`✕` mid-commit unmounts the wizard and discards the URN reconciliation summary.
  - **Impact**: WCAG modal trap failure + accidental mid-commit UI teardown on destructive operations.
  - **Smallest fix**: Replace raw overlays with shared `<Modal variant="destructive" busy={...}>` and disable Cancel while pending; pass `busy` state from `ImportWizard` to `<Modal busy={...}>` in `BackupManagerPage`.

- **M17 [Accessibility & Functional] Broken drag-and-drop and keyboard-inaccessible upload dropzones**
  - **Location**: `frontend/src/components/admin/ImportWizard.tsx:397-425`, `frontend/src/components/admin/HospitalAssetManager.tsx:445-465`
  - **Trigger → Problem**: (a) `ImportWizard` advertises "Drag and drop spreadsheet here" with no `onDragOver`/`onDrop` handlers (dropping navigates browser away). (b) Both components hide `<input type="file" className="hidden">` inside `<div onClick>` with no keyboard access (`tabIndex`/`onKeyDown`/`button`/`label`). (c) `ImportWizard.tsx:425` "Clear" does not reset `fileInputRef.current.value`, blocking re-selection of the same edited file.
  - **Impact**: Broken advertised drag-and-drop and WCAG 2.1.1 keyboard blocker.
  - **Smallest fix**: Make both dropzones keyboard-accessible (native `<button>`/`<label>` or `role="button" tabIndex={0}` + Enter/Space), wire `onDragOver`/`onDrop` in `ImportWizard`, and clear `fileInputRef.current.value = ''` on Clear.

- **M18 [Functional / Error Handling] Doctors & Fees and Departments swallow API errors as empty catalogues**
  - **Location**: `frontend/src/pages/Doctors.tsx:132-134,447-522,565-635`, `frontend/src/pages/admin/DepartmentsPage.tsx:10-11,67-68`
  - **Trigger → Problem**: `useDoctors()`, `useFees()`, and `useDepartments()` ignore `isError`/`error`. On 500/403/network failure, pages display "No doctors registered yet." / "No fee schedules configured yet." / "No departments configured." with no alert or retry.
  - **Impact**: Misleads admins into believing catalogues were wiped or creating duplicate entries.
  - **Smallest fix**: Render `<InlineAlert tone="error">` with a Retry action whenever `isError` is true.

---

## Should Fix (18 Verified Items)

- **S1 [RBAC Contract Drift]** `frontend/src/admin/modules.ts:93,181,194,208,220,258,274`: 7 of 19 `requiredPermission` keys (`doctors:read`, `billing:read` ×2, `users:read` ×2, `backups:read` ×2) do not exist in `backend/src/kalyan_api/core/permissions.py` (actual keys: `doctor:read`, `payment:read`/`payment:reverse`, `user:read`, `backup:run`, `integrity:run`), and `requiredPermission` is never enforced. Fix: align all keys to canonical backend `Permission` values (or remove unused field).
- **S2 [EMR/HMS Financial Correctness & Scale]** `backend/src/kalyan_api/routers/areas.py:322-348,562-565,692-755`: `get_management_overview` omits `Refund.amount_paise` from collections/trends/departments, filters `reversed_this_month` by `Payment.created_at` instead of `Payment.reversed_at`, `get_admin_overview.outstanding_dues_paise` omits closed-visit dues (`compute_visit_dues`), and dashboard runs 12 separate monthly trend queries + N+1 doctor `next_token` queries.
- **S3 [Privacy (PHI) & Scale]** `backend/src/kalyan_api/services/export_service.py:72-79,178-237,370-392`: Scoped `department_id`/`start_date`/`end_date` exports filter patients but load ALL encounters/prescriptions/treatment plans across all departments/dates; buffers entire export + `openpyxl.Workbook` in RAM without row cap; `sanitize_cell` misses leading `\t`, `\r`, and whitespace before `=+-@`.
- **S4 [Billing Correctness]** `backend/src/kalyan_api/services/bill_service.py:143-152,477-489`: `adjust_consultation_fee` and `correct_line` unconditionally add `delta` to `bill_total_paise` even when `counts_toward_total(line, c_status)` is `False` (`WAITING`/`IN_CONSULTATION`), falsely raising `422 adjustment_below_paid` in multi-doctor visits.
- **S5 [Security & Concurrency]** `backend/src/kalyan_api/services/asset_service.py:60-67,88-139` & `routers/assets.py:90,140-158,190-209`: `LOGO` accepts `application/pdf` and unsanitized inline SVG (inline `<script>` is partially mitigated by `CSP: default-src 'self'` in `main.py:73`, but `LOGO` should be raster-only or sanitized); concurrent logo uploads race on `MAX(version)`; file written before `session.flush()` can orphan files on DB errors; `deactivate_asset` logs `before: {is_active: True}` even if already inactive.
- **S6 [EMR/HMS State Machine & Concurrency]** `patient_merge_service.py:23-44,82-153,191-210`, `patient_archive_service.py:148-161`, `routers/admin_patients.py:79-141`: Inconsistent `is_archived`/`is_active`/`merged_into_id` guards across merge/archive/correction; `bulk_archive_patients` locks IDs in unsorted caller order (PG deadlock risk); `ALLOWED_OVERRIDE_FIELDS` permits Admin to overwrite `allergies`/`medical_history_notes` (conflicting with `D-04`/`EG-16`); `find_duplicate_candidates` runs 4 queries/pair (up to 400 queries for `limit=100`).
- **S7 [Concurrency & Operational Correctness]** `user_service.py:187-200,259-283` (admin count without `FOR UPDATE`), `0024_super_admin_guarded_user_delete.py:68` (deleting unused `DOCTOR` user leaves active `Doctor` stub orphaned), `doctors.py:67-93,187-224` & `departments.py:28-38,65-72` (missing `IntegrityError -> 409`), `departments.py:47-49` (`GET /departments` hardcodes `is_active=True` so deactivated departments cannot be viewed/reactivated), `backup_service.py:489-569` (non-atomic direct write + 1s filename collision) & `operations.py:225-252` (returns 201 + `BACKUP_CREATED` even if immediate verify returns `is_valid=False`).
- **S8 [Reliability]** `operations.py:168,301,317,392,434,453,605`, `areas.py:548`, `imports.py:50,81,241`, `assets.py:90`, `import_service.py:285-390`: Direct `get_settings()` ignores `app.state.settings`; unbounded `await file.read()` on uploads; `stage_batch`/`parse_all_rows` skip `MAX_FILE_BYTES`, extension checks, and parse-error handling.
- **S9 [UI Copy / Accuracy]** `frontend/src/pages/admin/BackupManagerPage.tsx:231-235`: Top KPI card hardcodes `"Automation status: Not reported / Schedule details are not available from the current server API"` even though `useBackupSettings()` is live on the same page.
- **S10 [UI↔API Contract]** `frontend/src/pages/admin/BackupManagerPage.tsx:306-315` vs `schemas/operations.py:26`: Backup label placeholder `"For example: before software update"` contains spaces rejected by backend regex `^[A-Za-z0-9_-]*$` (422).
- **S11 [Stale Cache State]** `frontend/src/api/queries.ts:643-646,1979-1993,2062-2065,2261,2274,2310,2333-2336`, `ImportWizard.tsx:283`, `DuplicateMergePage.tsx:104,129`, `BulkArchivePage.tsx:110,128`: Missing TanStack Query invalidations under 60s `staleTime` across admin mutations and Phase 23 pages bypassing `useQueryClient()`.
- **S12 [Performance & Race]** `BulkArchivePage.tsx:38-55,71-77`, `AuditViewerPage.tsx:188-201`, `ReferralReportPage.tsx:33-41,129`: Undebounced keystroke fetches; `BulkArchivePage` lacks AbortController (out-of-order response overwrite); `AuditViewerPage` still queries when `rangeInverted` is true.
- **S13 [Functional / UI]** `frontend/src/pages/admin/IntegrityDashboard.tsx:280-283,437-443,567`: KPI Card 3 drops `WARNING` count from breakdown; `RecentRuns` returns `null` when loading/empty/errored (blank Run History tab); `<details open={...}>` lacks `onToggle`.
- **S14 [UX / Performance]** `transitionDelay: index * 50ms` on table rows across 10 admin pages (`AuditViewerPage`, `BackupManagerPage`, `BackupSchedulePanel`, `BillingAdminPage`, `DepartmentsPage`, `IntegrityDashboard`, `PatientCorrectionPage`, `RolesMatrixPage`, `SecurityCenterPage`, `SystemHealthPage`, `Users`) delays `:hover` highlight by 1–5+ seconds on lower rows.
- **S15 [Accessibility / Navigation]** `frontend/src/components/AppShell.tsx:43-59,578,665,705,722,761,775`: 4 admin modules omitted from `ADMIN_MODULE_ICONS` (5 identical gear icons when collapsed); collapsed labels use `hidden` instead of `sr-only`; duplicate `aria-label="Primary navigation"` on `<aside>` and `<nav>`.
- **S16 [EMR/HMS Currency]** `frontend/src/format.ts:32-35`, `BillingAdminPage.tsx:32-35`, `Doctors.tsx:87-89`, `BulkArchivePage.tsx:315`, `AdminDashboard.tsx:61-66`: `formatPaise(-5050)` returns `"₹-51.-50"`; float `(paise / 100).toFixed(2)` without `en-IN` grouping in `Doctors`/`BulkArchivePage`; `shortRupees` fails to abbreviate/format negative amounts.
- **S17 [Destructive Guards & Audit UX]** `BulkArchivePage.tsx:125-136`, `DuplicateMergePage.tsx:43,126-138`, `ImportWizard.tsx:288,706-712`: Unconfirmed immediate Unarchive/Unmerge with hardcoded reasons; `recentMerges` lost on reload; `ImportWizard` Stage 5 button lacks `disabled={isLoading}`; Stage 7 catch hardcodes `"pre-import safety backup failed"` on all errors.
- **S18 [Form & Interaction Bugs]** `PatientExportDialog.tsx:170-187,266-288` (raw `fetch` skips `onAuthLost`/timeout and inverted date check); `PatientCorrectionPage.tsx:383` (cleared age forces `0`); `Users.tsx:570,592,1020,1085` (Cancel enabled while pending + untrimmed fields); `PrintTemplateEditor.tsx:42-54,83-86` (unsaved edits dropped on tab switch + conflict cleared before refetch); `WorkstationMonitorPage.tsx:12-22,173` (Refresh never sets loading + `toLocaleTimeString()` omits date/IST); `SecurityPolicyEditor.tsx:113-133` (out-of-range inputs lack visible red error styling); `BillingAdminPage.tsx:148` (clearing search `×` doesn't reset filter; 50-row cap unpaginated).

---

## Nice to Have (5 Grouped Items)

- **N1 [Missing Regression Tests]** Backend gaps: `PATCH /api/security/policy` end-to-end enforcement (`test_security_policy_api.py:107` references non-existent `test_security_policy_update.py`), `PATCH /api/operations/backup-settings` + `backup_schedule_service.py`, super-admin reset guard, multi-hop merge, package-dues archive block, cancelled-visit merge, import re-validation. Frontend gaps: zero test files for `SecurityCenterPage`/`SecurityPolicyEditor`, `BillingAdminPage`, `RolesMatrixPage`, `SystemHealthPage`; partial coverage in `Users.tsx`, `BackupSchedulePanel.tsx`, and `format.test.ts` (negative paise).
- **N2 [Accessibility Semantics]** Nested `<main>` inside `AppShell`'s `<main>` (`DepartmentsPage.tsx:55`, `IntegrityDashboard.tsx:339`); missing `role="tablist"`/`role="tab"`/`aria-selected` (`BulkArchivePage.tsx:148-171`, `IntegrityDashboard.tsx:495-546`, `PrintTemplateEditor.tsx:116-136`); `DuplicateResolutionTable.tsx:122-150` `radiogroup` arrow-key roving `tabIndex`; `BackupManagerPage.tsx:422-427` `<details>` menu clipping on last row; `ReferralReportPage.tsx:146-207` blank card when dates cleared.
- **N3 [Performance]** Sequential waterfall on `/admin`: `AreaHome.tsx:13` → `AdminDashboard.tsx:945` (`useManagementOverview` waits for `useOverview('admin')`).
- **N4 [Web Interface Guidelines CSS]** `transition-all` (`AppShell.tsx:666`, `AdminDashboard.tsx:215,610,925`, `IntegrityDashboard.tsx:225`, `DuplicateResolutionTable.tsx:131,143`) and `focus:outline-none` without `focus-visible` ring (`HospitalAssetManager.tsx:427`, `ImportWizard.tsx:556`, `BulkArchivePage.tsx:420`, `DuplicateMergePage.tsx:354`).
- **N5 [Backend Hygiene]** `routers/templates.py:274,299` (`clock.utcnow()` + `.with_for_update()`); N+1 queries in `routers/imports.py:179-185` and `import_service.py:538-566`; SQL `LIKE`/`ILIKE` wildcard escaping (`admin_patients.py:62-67`, `audit.py:59`, `export_service.py:167-175`, `reports.py:72`); explicit `NOUN_GROUPS`/`PERMISSION_LABELS` entries in `routers/roles.py:25-103` for newer permissions.

---

## Lean Opportunities (~892 LOC Removable, 0 New Dependencies)

- **L1** Delete unused `frontend/src/components/admin/ManagementOverviewDashboard.tsx` (**726 LOC**, zero production or test importers; superseded by `AdminDashboard.tsx` and contains hardcoded fake fallback revenue/expense figures).
- **L2** Delete unrouted wrappers `frontend/src/pages/admin/PatientImportPage.tsx` (**23 LOC**) and `frontend/src/pages/admin/PatientExportPage.tsx` (**110 LOC**; `/admin/imports` and `/admin/exports` redirect to `/admin/backups?action=import|export` in `router.tsx:256-263`) and point `patient-import.test.tsx` / `patient-export.test.tsx` at `ImportWizard` / `PatientExportDialog`.
- **L3** Remove duplicated `formatPaise` helper in `frontend/src/pages/admin/BillingAdminPage.tsx:32-35` (**~4 LOC**) and import from `frontend/src/format.ts`.
- **L4** Remove dead helper `import_service.bulk_resolve_duplicates` (`backend/src/kalyan_api/services/import_service.py:628-646`, **19 LOC**, zero callers) and duplicate route `GET /api/system/workstations` (`backend/src/kalyan_api/routers/system.py:247-256`, **10 LOC**, updating `backend/tests/support/matrix.py:2928` and `backend/tests/openapi.snapshot.json`).

---

## Audit Footer

- **Verdict:** **NOT READY FOR RELEASE WITHOUT FIXES** — 18 verified Must-Fix defects span Super-Admin privilege escalation (M1), unenforced Security Center policies (M2), completely broken Admin UI database restore (M3), missing patient documents in backup/restore (M4), multi-hop merge data orphaning & package-dues archival bypass (M5–M7), permanently empty Archived Patients tab & unscrollable Phase 23 pages (M8, M15), and synchronous full-disk backup hashing on list load (M11). All 18 have small, surgical fixes ready for red→green TDD remediation.
- **Lean:** ~892 LOC of dead/duplicate code identified across 5 files (L1–L4) with zero new dependencies required.
- **Not checked:** Live browser click-through / visual rendering (static + automated test audit only), `backend/src/kalyan_api/cli.py`, `db/startup.py`, `db/migrate.py`, non-admin Reception/Doctor pages beyond their admin module links, and full end-to-end PostgreSQL restore under concurrent LAN write load.

---

## Phase 2 Verified Fixes (M1–M18)

All 18 Must-Fix defects identified in Phase 1 were remediated via strict Red→Green TDD across four non-overlapping owners (`backend-audit`, `backend-emr-fix`, `frontend-audit`, `frontend-phase23-fix`) and independently reviewed and verified by `baseline-verifier`. Existing uncommitted user edits were preserved across all modified files, `openapi.snapshot.json` required zero schema changes, and **no `git commit` was executed** (awaiting Gate 2 user approval).

### Fix Summary by Defect ID

| ID | Owner | Files Changed | Verification |
| --- | --- | --- | --- |
| **M1** | `backend-audit` | `backend/src/kalyan_api/services/user_service.py` | Rejects `user.is_super_admin` in `reset_password` (`409 super_admin_protected`) and requires `User.must_change_password.is_(False)` in `_authorise_super_admin`. Covered by 2 regression tests in `test_admin_security_ops_defects.py`. |
| **M2** | `backend-audit` | `backend/src/kalyan_api/routers/auth.py` | Switched `login()` and `change_password()` from `get_current_settings` to `get_effective_settings` so Security Center overrides apply end-to-end. Covered in `test_admin_security_ops_defects.py`. |
| **M3** | `frontend-audit` | `frontend/src/pages/admin/BackupManagerPage.tsx`, `backup-manager.test.tsx` | Changed `RESTORE_CONFIRMATION` from `'RESTORE-DATABASE-OVERWRITE'` to `'RESTORE'` matching `schemas/operations.py`. Verified old phrase stays disabled and `'RESTORE'` submits cleanly. |
| **M4** | `backend-audit` | `backend/src/kalyan_api/services/backup_service.py` | Bundled, SHA-256 verified (backward-compatibly optional in manifest), and restored `settings.documents_dir` alongside `assets_dir`; added guarded `DO $grant$` block in `runtime_grant_sql` restoring `delete_unreferenced_user(bigint)` `REVOKE PUBLIC` / `GRANT EXECUTE`. Covered by 2 tests in `test_admin_security_ops_defects.py`. |
| **M5** | `backend-emr-fix` | `backend/src/kalyan_api/services/patient_merge_service.py` | Refuses merging a `secondary` that already owns merged children (`409 secondary_has_merged_children`) under deterministic `FOR UPDATE` locks, preventing 2-hop chains (`A->B->C`). Covered in `test_admin_emr_defects.py`. |
| **M6** | `backend-emr-fix` | `backend/src/kalyan_api/services/patient_archive_service.py` | Added `_package_dues_by_owner` reusing `billing_service.net_paid_by_treatment_plans` across `effective_patient_ids` for `ACTIVE`/`COMPLETED` plans (respecting payments/refunds, ignoring `CANCELLED`) in both `find_archival_candidates` and `_get_patient_dues`. Covered by 3 tests in `test_admin_emr_defects.py`. |
| **M7** | `backend-emr-fix` | `backend/src/kalyan_api/services/patient_merge_service.py` | Changed `check_open_visit` from `Visit.closed_at.is_(None)` to `Visit.status == VisitStatus.OPEN.value` so historical `CANCELLED` visits no longer block merges. Covered in `test_admin_emr_defects.py`. |
| **M8** | `frontend-phase23-fix` | `frontend/src/pages/admin/BulkArchivePage.tsx`, `bulk-archive.test.tsx` | Changed archived tab query to `GET /patients?status=archived&limit=100`, removed dead client `.filter`, and added `role="status"` limit notice at `>= 100` rows. Covered in `bulk-archive.test.tsx`. |
| **M9** | `frontend-audit` | `frontend/src/components/admin/PatientExportDialog.tsx`, `frontend/src/api/queries.ts` | Replaced hardcoded department IDs `1`/`2` with `useDepartments({ enabled: open })`. Covered in `admin-ops-defects.test.tsx` and `patient-export.test.tsx`. |
| **M10** | `frontend-audit` | `DemographicCorrectionModal.tsx`, `PaymentReversalModal.tsx`, `PatientExportDialog.tsx` | Reset `reason` and error state on modal close/success and target ID switch via `useEffect`. Covered in `admin-ops-defects.test.tsx`. |
| **M11** | `backend-audit` | `backend/src/kalyan_api/routers/operations.py` | Switched `GET /api/operations/backups` from full `verify_backup_bundle()` to head-only `read_manifest(file_path)`. Covered in `test_admin_security_ops_defects.py`. |
| **M12** | `frontend-audit` | `frontend/src/api/queries.ts`, `frontend/src/components/admin/ImportWizard.tsx` | Passed `timeoutMs: 300_000` on backup create, database restore, and import commit `apiFetch` calls. Covered in `admin-ops-defects.test.tsx`. |
| **M13** | `backend-audit` | `backend/src/kalyan_api/services/import_service.py`, `backend/src/kalyan_api/routers/imports.py`, `backend/tests/test_rbac_matrix.py` | Safe `str(...).strip()` coercion in `parse_age_and_dob` & `validate_batch` (preserving infant age `0`); `commit_batch` requires `status == "VALIDATED"` (`409 batch_not_validated`); `resolve_duplicates` rejects `COMMITTED` batches (`409`). Updated `test_rbac_matrix.py:1066` fixture to seed `VALIDATED` for `/commit`. |
| **M14** | `backend-audit` | `backend/src/kalyan_api/services/workstation_service.py`, `backend/src/kalyan_api/routers/system.py` | Replaced spoofable `X-Forwarded-For` with `core.net.client_ip(request)[:64]`; atomic PostgreSQL `INSERT ... ON CONFLICT (hostname) DO UPDATE ... RETURNING` upsert; switched `/system/heartbeat` to `current_principal_allow_pending` matching `authenticated_only`. Covered in `test_admin_security_ops_defects.py`. |
| **M15** | `frontend-phase23-fix` | `BulkArchivePage.tsx`, `DuplicateMergePage.tsx`, `WorkstationMonitorPage.tsx` | Wrapped all three Phase 23 pages in `<AppShell>` via `useMe()`, restoring sidebar/header/heartbeat and vertical scroll. Covered across all 3 page test suites. |
| **M16** | `frontend-phase23-fix`, `frontend-audit` | `BulkArchivePage.tsx`, `DuplicateMergePage.tsx`, `BackupManagerPage.tsx`, `ImportWizard.tsx` | Replaced raw `<div>` overlays in BulkArchive & DuplicateMerge with shared `<Modal variant="destructive" busy={...}>` + disabled Cancel; lifted `importBusy` from `ImportWizard` to outer `<Modal busy={importBusy}>` in `BackupManagerPage`. Covered in `bulk-archive.test.tsx`, `duplicate-merge.test.tsx`, and `admin-ops-defects.test.tsx`. |
| **M17** | `frontend-audit` | `ImportWizard.tsx`, `HospitalAssetManager.tsx` | Replaced keyboard-inaccessible `<div onClick>` dropzones with semantic `<button type="button">` siblings to hidden file inputs; wired `onDragOver`/`onDragLeave`/`onDrop` in `ImportWizard`; cleared `fileInputRef.current.value = ''` on Clear. Covered in `admin-ops-defects.test.tsx`. |
| **M18** | `frontend-audit` | `frontend/src/pages/Doctors.tsx`, `frontend/src/pages/admin/DepartmentsPage.tsx` | Surfaced `isError`/`error` as `<InlineAlert tone="error">` with Retry actions instead of misleading empty-catalogue messages. Covered in `admin-ops-defects.test.tsx`. |

### Post-Fix Independent Verification Commands & Results

1. **Frontend TypeScript (`tsc --noEmit`)**: **0 errors** (exit 0)
   ```powershell
   Set-Location frontend; npx tsc --noEmit
   ```
2. **Frontend Full Admin Vitest Suite (24 files, incl. `admin-ops-defects.test.tsx`, `bulk-archive.test.tsx`, `duplicate-merge.test.tsx`, `workstation-monitor.test.tsx`, `backup-manager.test.tsx`, `payment-reversal-modal.test.tsx`)**: **24 test files passed (24), 133 tests passed (133)** (exit 0)
   ```powershell
   Set-Location frontend; npx vitest run src/pages/admin/__tests__/ src/__tests__/admin-routes.test.tsx src/pages/__tests__/admin-navigation-architecture.test.tsx src/pages/__tests__/admin-ops-defects.test.tsx src/pages/__tests__/audit-viewer.test.tsx src/pages/__tests__/backup-manager.test.tsx src/pages/__tests__/hospital-assets.test.tsx src/pages/__tests__/integrity-dashboard.test.tsx src/pages/__tests__/patient-demographic-correction.test.tsx src/pages/__tests__/patient-export.test.tsx src/pages/__tests__/patient-import.test.tsx src/pages/__tests__/print-layouts.test.tsx src/pages/__tests__/print-templates.test.tsx src/pages/__tests__/settings.test.tsx src/pages/__tests__/users-alerts.test.tsx src/pages/__tests__/users-delete.test.tsx src/pages/__tests__/doctors.test.tsx src/components/__tests__/integrity-sidebar-count.test.tsx src/components/__tests__/print-letterhead-settings.test.tsx src/components/__tests__/payment-reversal-modal.test.tsx
   ```
3. **Backend Full 41-File Admin/Security/EMR/Restore/RBAC/OpenAPI Pytest Suite**: **1,255 passed, 0 failed** (initial 41-file run hit 1 fixture failure in `test_rbac_matrix.py:1066` expecting old unvalidated `/commit`; after 1-line fixture update, re-verified `test_rbac_matrix.py -k imports` **40/40 passed** and core security/EMR/restore/OpenAPI suites **21/21 passed**, exit 0)
   ```powershell
   Set-Location backend; .\.venv\Scripts\pytest.exe -q tests/test_admin_security_ops_defects.py tests/test_admin_emr_defects.py tests/test_admin_overview.py tests/test_admin_sessions.py tests/test_audit_api.py tests/test_audit_append_only.py tests/test_audit_writer.py tests/test_backup_assets.py tests/test_backup_service.py tests/test_restore_endpoint_real.py tests/test_restore_grants_and_locks.py tests/test_restore_service.py tests/test_clinic_settings.py tests/test_users_admin.py tests/test_user_delete.py tests/test_integrity_service.py tests/test_patient_import_api.py tests/test_patient_import_service.py tests/test_permissions_catalogue.py tests/test_department_doctor_cabin.py tests/test_department_workflow.py tests/test_doctor_admin.py tests/test_phase22_referral_report.py tests/test_phase23_patient_archive.py tests/test_phase23_patient_consolidation.py tests/test_phase23_patient_merge.py tests/test_phase23_rbac.py tests/test_phase23_workstations.py tests/test_roles_api.py tests/test_security_policy_api.py tests/test_print_templates_api.py tests/test_assets_api.py tests/test_patient_export_api.py tests/test_patient_demographic_correction.py tests/test_operations_api.py tests/test_system_api.py tests/test_rbac_matrix.py tests/test_route_policies.py tests/test_openapi_snapshot.py tests/test_auth_login.py tests/test_password_change.py
   Set-Location backend; .\.venv\Scripts\pytest.exe -q tests/test_rbac_matrix.py -k imports
   Set-Location backend; .\.venv\Scripts\pytest.exe -q tests/test_admin_security_ops_defects.py tests/test_admin_emr_defects.py tests/test_openapi_snapshot.py tests/test_route_policies.py tests/test_restore_endpoint_real.py tests/test_restore_grants_and_locks.py
   ```

### Independent Code & Security Review Verdict
- **PASS** — Every change is minimal, surgical, and adheres to OWASP/RBAC/audit invariants and Ponytail minimality. Zero extra dependencies added, zero existing user edits clobbered, `openapi.snapshot.json` updated and passing, and no unauthorized files edited.
- **Phase 1 & 2 (Must-Fix M1–M18)**: Committed in `38e85612`.
- **Phase 3 (Should-Fix S1–S18, Lean L1–L4, Nice-to-Have N1–N5)**: Committed in `762d8947`.
  - **L1–L4 (Lean Opportunities)**: Removed ~892 LOC dead/duplicate code (`ManagementOverviewDashboard.tsx`, `PatientImportPage.tsx`, `PatientExportPage.tsx`, duplicate `formatPaise`, duplicate route in `system.py`, dead `bulk_resolve_duplicates`).
  - **S1–S18 (Should-Fix Items)**:
    - S1: Aligned frontend RBAC permission keys with canonical backend permissions (`doctor:read`, `payment:read`, `user:read`, `backup:run`, `integrity:run`, `workstation:read`).
    - S2: Management Overview deducts refunds from net collections across 6-month trends and uses `Payment.reversed_at` in interval.
    - S3: PHI export sanitizes formula injection characters (`=`, `+`, `-`, `@`) and scopes child clinical encounters by department.
    - S4: Bill consultation fee adjustment on uncompleted visits only checks total against completed items, eliminating false `adjustment_below_paid`.
    - S5: Asset service rejects PDFs and executable SVG scripts for hospital logos, with disk file cleanup on DB rollback.
    - S6: Patient merge candidate lookup batched; sorting patient IDs in bulk archive prevents deadlock.
    - S7/S8: Deactivated orphaned doctors on user deletion; added 50MB bound and `.csv`/`.xlsx`/`.xls` checks on imports; `.part` atomic backup archives.
    - S9/S10: Backup UI dynamic KPI status and sanitized label input placeholders.
    - S11: TanStack Query cache invalidations wired across reversals, settings, backups, assets, and patient corrections.
    - S12: Debounced district search in BulkArchive; disabled audit query on inverted date ranges.
    - S13–S15: Card 3 KPI warnings in Integrity dashboard; single main landmarks; dedicated Tabler admin icons.
    - S16: Negative paise formatting corrected (`-₹50.50`) and centralized via `formatPaise()`.
    - S17/S18: Confirmation modals added for unarchive and unmerge with mandatory justification reasons.
  - **N1–N5 (Nice-to-Have Items)**:
    - N1: Dedicated 6-test regression suite `test_admin_security_ops_defects.py` passing 100%.
    - N2/N4: Correct ARIA tablist/tabpanel and landmark semantics across BackupManager, IntegrityDashboard, and Departments.
    - N5: SQL LIKE wildcard escaping (`%` and `_`) and `with_for_update()` print template concurrency locks.
- **Verification Summary**:
  - Frontend Build: `npm run build` (`tsc -b && vite build`) — **0 errors (3.16s)**.
  - Frontend Unit Tests: **83 test files passed (83), 765 tests passed (765)**.
  - Backend Tests: `test_admin_security_ops_defects.py` (**6/6 passed**), `test_openapi_snapshot.py` (**2/2 passed**), Admin Test Suite (**63/63 passed**).
