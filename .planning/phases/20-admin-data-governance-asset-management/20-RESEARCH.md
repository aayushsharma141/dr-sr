# Phase 20: Admin Data Governance & Asset Management - Technical Research

**Researched:** 2026-11-08  
**Phase Objective:** Transform the Admin panel into a self-contained Hospital Administration and Data Governance system. Administrators can manage hospital identity, correct patient records with an audit trail, import/export data, manage bilingual print templates, and navigate all admin modules via a coherent five-section navigation — without developer intervention.

---

## Executive Summary & Gap Analysis

Phase 20 integrates administrative data governance across backend APIs, Alembic migrations, file storage, and the React frontend. Currently, administration contains settings, user administration, doctor profiles, financial reversal controls, audit viewing, backup/restore, and system diagnostics. However:
1. **Permissions**: Admin possesses operational administration and `settings:write`, but lacks patient modification rights (`patient:create`, `patient:update`, `photo:write` belong only to `RECEPTION`). Per **D-20-01**, three specific permissions must be added to `Permission` and `Role.ADMIN`: `patient:correct`, `patient:import`, and `patient:export`.
2. **Patient Demographic Correction**: Patient updates are currently performed only by Reception via `PATCH /api/patients/{id}` (`patient:update`). A dedicated `PATCH /api/admin/patients/{id}/demographics` endpoint is needed with mandatory correction reason, optimistic locking (`version_id`), and an in-transaction audit event (`PATIENT_CORRECTED`).
3. **Printed Patient Identity & Reprints**: Issued documents (`payments`, `prescriptions`, `clinical_encounters`) currently link dynamically to `patients`. When patient demographics are corrected, reprinting historical documents would display new values. Per **D-20-05**, **D-20-06**, and **D-20-07**, documents must store `patient_name`, `patient_urn`, `patient_mobile`, and `patient_address` at the time of issuance, backfilled by migration while respecting the `payments` tamper-prevention trigger.
4. **Asset Management**: `photo_service.py` manages patient identification photos in `KALYAN_PHOTOS_DIR`. An equivalent `asset_service.py` is needed to store hospital identity assets (logos, registration certificates, clinic photographs) in a managed `KALYAN_ASSETS_DIR`, maintaining full version history so issued documents never reference deleted files.
5. **Print Template Management**: Clinic settings currently have single `print_header_en/hi` and `print_footer_en/hi` text fields. Per-document templates (`prescription`, `receipt`, `registration_card`, `consultation_summary`) require a dedicated `print_templates` table and editor with bilingual live previews.
6. **Import & Export Pipelines**: No bulk import or export capability currently exists. Phase 20 must introduce an 8-stage staging pipeline for CSV/XLSX imports (allocating gap-free URNs via `urn_service` only on commit, after mandatory safety backups) and an audited, formula-sanitized streaming export facility.
7. **Admin Navigation**: AppShell's admin sidebar currently renders a temporary 3-section layout with placeholder links. It must be reorganized into the canonical 5-section hierarchy (**D-20-21**).

---

## 1. Existing Admin Code Inventory

### Admin Backend Routers & API Endpoints
| Route | Method | File | Policy / Permission | Purpose |
|---|---|---|---|---|
| `/api/admin/overview` | GET | `backend/src/kalyan_api/routers/areas.py` | `require(Permission.DASHBOARD_ADMIN)` | Management Overview dashboard KPIs & metrics |
| `/api/settings` | GET | `backend/src/kalyan_api/routers/settings.py` | `require(Permission.SETTINGS_READ)` | Current clinic configuration |
| `/api/settings` | PATCH | `backend/src/kalyan_api/routers/settings.py` | `require(Permission.SETTINGS_WRITE)` | Clinic configuration mutation with optimistic locking |
| `/api/doctors` | GET | `backend/src/kalyan_api/routers/doctors.py` | `require(Permission.DOCTOR_READ)` | Doctor profiles list |
| `/api/doctors` | POST | `backend/src/kalyan_api/routers/doctors.py` | `require(Permission.DOCTOR_MANAGE)` | Create doctor profile |
| `/api/doctors/{id}` | PATCH | `backend/src/kalyan_api/routers/doctors.py` | `require(Permission.DOCTOR_MANAGE)` | Edit doctor profile |
| `/api/fees` | GET | `backend/src/kalyan_api/routers/fees.py` | `require(Permission.FEE_READ)` | Consultation fee schedule |
| `/api/fees/{id}` | PATCH | `backend/src/kalyan_api/routers/fees.py` | `require(Permission.FEE_MANAGE)` | Edit consultation fee |
| `/api/users` | GET | `backend/src/kalyan_api/routers/users.py` | `require(Permission.USER_READ)` | User accounts list |
| `/api/users` | POST | `backend/src/kalyan_api/routers/users.py` | `require(Permission.USER_CREATE)` | Create staff account |
| `/api/users/{id}` | GET | `backend/src/kalyan_api/routers/users.py` | `require(Permission.USER_READ)` | Single user detail |
| `/api/users/{id}` | PATCH | `backend/src/kalyan_api/routers/users.py` | `require(Permission.USER_UPDATE)` | Update user account |
| `/api/users/{id}/deactivate` | POST | `backend/src/kalyan_api/routers/users.py` | `require(Permission.USER_DEACTIVATE)` | Deactivate user account |
| `/api/users/{id}/reactivate` | POST | `backend/src/kalyan_api/routers/users.py` | `require(Permission.USER_UPDATE)` | Reactivate user account |
| `/api/users/{id}/reset-password` | POST | `backend/src/kalyan_api/routers/users.py` | `require(Permission.USER_RESET_PASSWORD)` | Issue temporary password |
| `/api/users/{id}/unlock` | POST | `backend/src/kalyan_api/routers/users.py` | `require(Permission.USER_UNLOCK)` | Unlock throttled/locked user |
| `/api/roles` | GET | `backend/src/kalyan_api/routers/roles.py` | `require(Permission.USER_READ)` | RBAC matrix catalogue |
| `/api/admin/sessions` | GET | `backend/src/kalyan_api/routers/sessions.py` | `require(Permission.SESSION_READ)` | Active sessions monitor |
| `/api/admin/sessions/{id}` | DELETE | `backend/src/kalyan_api/routers/sessions.py` | `require(Permission.SESSION_REVOKE)` | Revoke single session |
| `/api/admin/users/{id}/sessions` | DELETE | `backend/src/kalyan_api/routers/sessions.py` | `require(Permission.SESSION_REVOKE)` | Revoke all sessions for a user |
| `/api/admin/security/policy` | GET | `backend/src/kalyan_api/routers/security.py` | `require(Permission.SECURITY_READ)` | Effective security policy |
| `/api/admin/security/policy` | PATCH | `backend/src/kalyan_api/routers/security.py` | `require(Permission.SECURITY_WRITE)` | Update security policy |
| `/api/audit` | GET | `backend/src/kalyan_api/routers/audit.py` | `require(Permission.AUDIT_READ)` | Filterable immutable audit log |
| `/api/backups` | GET | `backend/src/kalyan_api/routers/backups.py` | `require(Permission.BACKUP_RUN)` | Backup archive list |
| `/api/backups` | POST | `backend/src/kalyan_api/routers/backups.py` | `require(Permission.BACKUP_RUN)` | Trigger manual backup bundle |
| `/api/backups/verify` | POST | `backend/src/kalyan_api/routers/backups.py` | `require(Permission.BACKUP_RUN)` | Verify archive bundle checksums |
| `/api/backups/restore` | POST | `backend/src/kalyan_api/routers/backups.py` | `require(Permission.BACKUP_RESTORE)` | Restore database & files |
| `/api/backups/settings` | GET | `backend/src/kalyan_api/routers/backups.py` | `require(Permission.BACKUP_CONFIGURE)` | Backup schedule settings |
| `/api/backups/settings` | PATCH | `backend/src/kalyan_api/routers/backups.py` | `require(Permission.BACKUP_CONFIGURE)` | Update backup schedule |
| `/api/integrity` | GET | `backend/src/kalyan_api/routers/integrity.py` | `require(Permission.INTEGRITY_RUN)` | Run 5-pillar data integrity check |
| `/api/system` | GET | `backend/src/kalyan_api/routers/system.py` | `require(Permission.SYSTEM_READ)` | Server health, disk, uptime |
| `/api/payments/{id}/reverse` | POST | `backend/src/kalyan_api/routers/billing.py` | `require(Permission.PAYMENT_REVERSE)` | Admin payment reversal with reason |

### Frontend Admin Pages & Router Registration (`frontend/src/router.tsx`)
All admin pages are lazy-loaded within `<RequireRole role="ADMIN" />`:
- `/admin` &rarr; `frontend/src/pages/AreaHome.tsx` (renders `ManagementOverviewDashboard.tsx`)
- `/admin/settings` &rarr; `frontend/src/pages/Settings.tsx`
- `/admin/doctors` &rarr; `frontend/src/pages/Doctors.tsx`
- `/admin/billing` &rarr; `frontend/src/pages/admin/BillingAdminPage.tsx`
- `/admin/users` &rarr; `frontend/src/pages/admin/Users.tsx`
- `/admin/roles` &rarr; `frontend/src/pages/admin/RolesMatrixPage.tsx`
- `/admin/security` &rarr; `frontend/src/pages/admin/SecurityCenterPage.tsx`
- `/admin/audit` &rarr; `frontend/src/pages/admin/AuditViewerPage.tsx`
- `/admin/backups` &rarr; `frontend/src/pages/admin/BackupManagerPage.tsx`
- `/admin/integrity` &rarr; `frontend/src/pages/admin/IntegrityDashboard.tsx`
- `/admin/system` &rarr; `frontend/src/pages/admin/SystemHealthPage.tsx`

### Admin Module Single Source of Truth (`frontend/src/admin/modules.ts`)
`modules.ts` defines `ADMIN_MODULE_GROUPS` (`hospital`, `system`) and `ADMIN_MODULES`:
1. `hospital-configuration` (`/admin/settings`)
2. `doctor-clinical` (`/admin/doctors`)
3. `billing-financial` (`/admin/billing`, `/reception/dues`)
4. `appointment-workflow` (status: `fixed` — APT-02)
5. `physiotherapy` (status: `fixed` — VAS 0-10)
6. `prescription-print` (`/admin/settings` — status: `partial`)
7. `user-authority` (`/admin/users`, `/admin/roles`)
8. `security-access` (`/admin/security`)
9. `audit-compliance` (`/admin/audit`)
10. `backup-data` (`/admin/backups`, `/admin/integrity`)
11. `system-health` (`/admin/system`)

### Current `renderAdminSidebar` in `AppShell.tsx`
Currently groups items under:
- Header: `Management Overview` (`/admin`)
- Group 1: `Business Intelligence` (Financial Reports `/admin/billing`, plus 3 placeholder links leading to `/admin`: Hospital Performance, Department Analytics, Resource Utilization)
- Group 2: `Hospital Governance` (Hospital Profile `/admin/settings`, Departments & Services `/admin/doctors`, Doctors & Staff `/admin/doctors`, Policies & Approvals `/admin/security`, Audit & Compliance `/admin/audit`)
- Group 3: `System Administration` (Users & Roles `/admin/users`, Configuration Settings `/admin/settings`, Backup & Restore `/admin/backups`, System Health `/admin/system`, Audit Logs `/admin/audit`, Updates & Maintenance `/admin/integrity`)

Per **D-20-21** and **D-20-22**, this must be restructured into 5 canonical sections with placeholders removed:
1. **Hospital Configuration**: Clinic Settings (`/admin/settings`), Hospital Identity & Logo (`/admin/assets`), Print Templates (`/admin/templates`), Doctors & Fees (`/admin/doctors`).
2. **Patient & Data Management**: Patient Demographic Correction (`/admin/patients/correct`), Import Centre (`/admin/imports`), Export Centre (`/admin/exports`).
3. **Billing & Finance**: Billing & Reversals (`/admin/billing`), Pending Dues (`/reception/dues`).
4. **Users, Security & Governance**: User Accounts (`/admin/users`), Roles & Permissions (`/admin/roles`), Security & Sessions (`/admin/security`), Audit Trail (`/admin/audit`).
5. **System & Maintenance**: Backup & Restore (`/admin/backups`), Data Integrity (`/admin/integrity`), System Health (`/admin/system`).

---

## 2. Permission System & Route Verification

### Permission Catalogue (`backend/src/kalyan_api/core/permissions.py`)
- `Permission(StrEnum)`: String-backed enum following `noun:verb` naming.
- `Role(StrEnum)`: `ADMIN`, `RECEPTION`, `DOCTOR`.
- `ROLE_PERMISSIONS`: Maps each role to a `frozenset[Permission]`.

Currently, `Role.ADMIN` has 30 permissions. Crucially:
- `Role.ADMIN` possesses `PATIENT_READ`, but **NOT** `PATIENT_CREATE` or `PATIENT_UPDATE`.
- `Role.ADMIN` does **NOT** have `PHOTO_READ` or `PHOTO_WRITE`.
- Reception's demographic edit route `PATCH /api/patients/{id}` enforces `require(Permission.PATIENT_UPDATE)` — hence Reception can edit patient records, but Admin is forbidden from using Reception's route.

### Exact Pattern for Adding Permissions (D-20-01)
To add `patient:correct`, `patient:import`, and `patient:export`:
1. Add members to `Permission` enum:
   ```python
   PATIENT_CORRECT = "patient:correct"
   PATIENT_IMPORT = "patient:import"
   PATIENT_EXPORT = "patient:export"
   ```
2. Add all three to `ROLE_PERMISSIONS[Role.ADMIN]`. Neither `RECEPTION` nor `DOCTOR` receives them.
3. Keep `ROLE_PERMISSIONS[Role.RECEPTION]` and `ROLE_PERMISSIONS[Role.DOCTOR]` untouched.
4. Logo, asset, and print-template management endpoints use existing `Permission.SETTINGS_WRITE` (`settings:write`), which `ADMIN` already possesses.

### Tests Enumerating Permissions and Routes
The test suite has strict automated gates that fail if permissions or routes change without updating tests:
1. `backend/tests/test_permissions_catalogue.py`:
   - `test_permissions_noun_verb_format()`: Regex `^[a-z_]+:[a-z_]+$` validates syntax.
   - `test_no_orphan_permissions()`: Walks all FastAPI routes with `walk_routes(create_app())`, extracts `require()` permissions, and asserts that every `Permission` enum value is either bound to an active route or present in `RESERVED`. If a new permission is added to the enum without a route, this test fails.
   - `test_golden_role_permissions_snapshot()`: Hardcoded dictionary assertion of `ROLE_PERMISSIONS`. Must be updated to include the new permissions.
2. `backend/tests/test_roles_api.py`:
   - Validates that `GET /api/roles` returns grants mirroring `ROLE_PERMISSIONS`.
3. `backend/tests/test_route_policies.py`:
   - `test_every_route_has_exactly_one_policy()`: Checks that every FastAPI route declares exactly one policy marker (`public`, `authenticated_only`, or `require(Permission)`).
   - Validates `MUST_EXIST` and `PUBLIC_ALLOWLIST`.
4. `backend/tests/test_openapi_snapshot.py`:
   - Compares the generated OpenAPI schema against `backend/tests/openapi.snapshot.json`. Any new route or schema mutation requires regenerating the snapshot:
     ```powershell
     python -m kalyan_api.cli export-openapi --out backend/tests/openapi.snapshot.json
     ```

---

## 3. Patient Model & Demographic Correction Pattern

### Patient Entity Schema (`backend/src/kalyan_api/models.py`)
```python
class Patient(Base):
    __tablename__ = "patients"
    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    urn: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    full_name: Mapped[str] = mapped_column(String(120), nullable=False)
    guardian_name: Mapped[str] = mapped_column(String(120), nullable=False)
    gender: Mapped[str] = mapped_column(String(1), nullable=False)  # 'M', 'F', 'O'
    dob: Mapped[date | None] = mapped_column(Date, nullable=True)
    age_years: Mapped[int] = mapped_column(Integer, nullable=False)  # 0 to 150
    mobile: Mapped[str] = mapped_column(String(15), nullable=False)
    address: Mapped[str] = mapped_column(Text, nullable=False)
    district: Mapped[str] = mapped_column(String(64), default="Bhojpur", server_default="Bhojpur", nullable=False)
    state: Mapped[str] = mapped_column(String(64), default="Bihar", server_default="Bihar", nullable=False)
    emergency_contact: Mapped[str | None] = mapped_column(String(120), nullable=True)
    allergies: Mapped[str] = mapped_column(Text, default="None reported", server_default="None reported", nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    photo_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"), nullable=False)
    version_id: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    __mapper_args__ = {"version_id_col": version_id}
```
**Per D-20-09**: A new column `legacy_urn` (or `legacy_identifier`: `String(64)`, nullable=True, indexed) must be added so imported patients retain original IDs without clashing with the canonical `urn`.

### Reception Update Pattern (`backend/src/kalyan_api/routers/patients.py#L201-L291`)
1. Row lock: `session.scalar(select(Patient).where(Patient.id == id).with_for_update())`.
2. Optimistic concurrency: `require_version(patient, payload.version_id, "patient")` raises 409 `version_conflict` if stale.
3. Snapshot before state: Dictionary of all demographic attributes.
4. Mutation & flush: Update allowed fields, invoke `session.flush()`.
5. Snapshot after state: Dictionary of new attributes.
6. Audit recording:
   ```python
   ctx = build_audit_context(request, principal)
   audit_service.record(
       session,
       ctx,
       AuditAction.PATIENT_UPDATED,
       "PATIENT",
       str(patient.id),
       before=before_state,
       after=after_state,
   )
   ```

### Admin Demographic Correction Endpoint Design (`PATCH /api/admin/patients/{id}/demographics`)
Per **D-20-02**, **D-20-03**, and **D-20-04**:
- Guarded by `require(Permission.PATIENT_CORRECT)`.
- Request schema `AdminPatientDemographicCorrection`:
  - `reason`: `str` with `min_length=5` (mandatory audit explanation).
  - `version_id`: `int` (optimistic lock).
  - Permitted demographic fields: `full_name`, `guardian_name`, `gender`, `dob`, `age_years`, `mobile`, `address`, `district`, `state`, `emergency_contact`.
  - Disallowed: `urn` (immutable), `allergies` / `notes` (reception clinical notes), clinical records / addenda (immutable).
- Records `AuditAction.PATIENT_CORRECTED` with `reason`, `before`, `after` in the same transaction.
- Server-side patient search for correction screen: Admin uses `GET /api/admin/patients/search?q=...` (or existing patient read with query).

---

## 4. Settings Backend & Print Template Architecture

### Current Settings Storage (`backend/src/kalyan_api/routers/settings.py`)
- Stored in singleton table `clinic_settings` (row `id = 1`).
- `_SETTINGS_AUDIT_FIELDS`:
  `name_en`, `name_hi`, `trust_name_en`, `trust_name_hi`, `location_line`, `address_1`, `address_2`, `phone`, `email`, `receipt_sequence_cycle`, `print_header_en`, `print_header_hi`, `print_footer_en`, `print_footer_hi`, `consultation_validity_days`, `version_id`.
- Handled with `require_version(settings, payload.version_id, "clinic_settings")`.
- `print_header_en/hi` and `print_footer_en/hi` are plain text strings. Today, no printout uses `print_header_*` (letterhead header is generated by `LetterheadBanner`), and only `ReceiptPrint.tsx` and `RegistrationCard.tsx` read `print_footer_*`.

### Print Template Schema (`print_templates` table)
Per **D-20-04** and Claude's Discretion:
```python
class PrintDocumentType(StrEnum):
    PRESCRIPTION = "prescription"
    RECEIPT = "receipt"
    REGISTRATION_CARD = "registration_card"
    CONSULTATION_SUMMARY = "consultation_summary"

class PrintTemplate(Base):
    __tablename__ = "print_templates"
    id: Mapped[int] = mapped_column(BigInteger, Identity(always=False), primary_key=True)
    document_type: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    header_en: Mapped[str | None] = mapped_column(Text, nullable=True)
    header_hi: Mapped[str | None] = mapped_column(Text, nullable=True)
    footer_en: Mapped[str | None] = mapped_column(Text, nullable=True)
    footer_hi: Mapped[str | None] = mapped_column(Text, nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)
    updated_by_user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
```
- Seeding: Initial migration copies existing `clinic_settings.print_header_*` and `print_footer_*` into the initial row for all 4 document types.
- Historical integrity: When documents are issued, they record `template_version` so reprints remain identical to what was printed.

---

## 5. File Uploads & Hospital Asset Management

### Reference Pattern: `photo_service.py`
Located at `backend/src/kalyan_api/services/photo_service.py`:
- Max bytes: `MAX_PHOTO_BYTES = 5 * 1024 * 1024` (5 MB).
- Magic bytes check:
  - JPEG: `b"\xff\xd8\xff"`
  - PNG: `b"\x89PNG\r\n\x1a\n"`
- Sanitization: Generates `uuid.uuid4().hex + ext`. Path traversal prevented with `Path(filename).name`.
- Storage directory: `settings.photos_dir` (`BACKEND_DIR / "var" / "photos"`), configured via `KALYAN_PHOTOS_DIR`.

### Hospital Asset Management Service (`asset_service.py`)
Per plan **20-03** and Claude's Discretion:
- Configuration: `assets_dir: Path = BACKEND_DIR / "var" / "assets"`, configured via `KALYAN_ASSETS_DIR`.
- Accepted formats:
  - Logos: PNG (`b"\x89PNG\r\n\x1a\n"`), JPEG (`b"\xff\xd8\xff"`), WebP (`RIFF....WEBP`), SVG (`<?xml` or `<svg`).
  - Clinic Photos: JPEG, PNG, WebP.
  - Registration/Legal Docs: PDF (`b"%PDF-"`), JPEG, PNG.
- Max size: 10 MB.
- Database tracking (`hospital_assets` table):
  - `id`, `asset_type` (`LOGO`, `PHOTO`, `REGISTRATION_DOC`), `filename`, `original_filename`, `mime_type`, `file_size_bytes`, `is_active`, `version`, `uploaded_by_user_id`, `created_at`.
- Historical retention: When a new logo is uploaded, previous logos remain stored on disk and in DB (`is_active = False`), as issued receipts and prescriptions may reference them. Historical assets are **never deleted**.
- Public/Read serving: `GET /api/assets/active-logo` serves the current active logo image for the login screen and print components.

---

## 6. Migration Structure & The Payments Tamper Trigger

### Alembic Migration Conventions
- Latest migration: `0014_follow_up_recommendations.py` (`Revises: 0013`). Next revision is `0015`.
- Runtime user permissions: Alembic migrations run under `kalyan_owner`, but must explicitly grant table rights to runtime user `kalyan_app`:
  ```python
  op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON table_name TO kalyan_app;")
  op.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kalyan_app;")
  ```

### The Payments Tamper-Prevention Trigger Hazard (D-20-07)
In `backend/src/kalyan_api/migrations/versions/0005_billing_receipts_and_reversals.py`:
```sql
CREATE OR REPLACE FUNCTION fn_prevent_payment_tampering()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Posted payments cannot be deleted. Use admin reversal.';
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.is_reversed = TRUE THEN
            RAISE EXCEPTION 'Reversed payments are permanently immutable.';
        END IF;

        IF NEW.is_reversed = TRUE AND OLD.is_reversed = FALSE THEN
            IF (
                OLD.id IS DISTINCT FROM NEW.id OR
                OLD.receipt_number IS DISTINCT FROM NEW.receipt_number OR
                ...
            ) THEN
                RAISE EXCEPTION 'Only reversal metadata can be updated on reversal.';
            END IF;
            RETURN NEW;
        ELSE
            RAISE EXCEPTION 'Posted payment details cannot be modified.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```
Any `UPDATE` on `payments` outside of setting `is_reversed = True` raises an exception: `'Posted payment details cannot be modified.'`.

### Solution for Migration Backfill (D-20-06 & D-20-07)
When adding `patient_name`, `patient_urn`, `patient_mobile`, `patient_address` columns to `payments`:
1. Add columns with `sa.Column(..., nullable=True)`.
2. Disable trigger before backfill:
   ```python
   op.execute("ALTER TABLE payments DISABLE TRIGGER trg_prevent_payment_tampering;")
   ```
3. Backfill from `patients`:
   ```sql
   UPDATE payments p
   SET patient_name = pt.full_name,
       patient_urn = pt.urn,
       patient_mobile = pt.mobile,
       patient_address = pt.address
   FROM patients pt
   WHERE p.patient_id = pt.id;
   ```
4. Update `fn_prevent_payment_tampering()` to guard the new snapshot columns against subsequent edits.
5. Re-enable trigger:
   ```python
   op.execute("ALTER TABLE payments ENABLE TRIGGER trg_prevent_payment_tampering;")
   ```
6. Enforce `nullable=False` on the snapshot columns if desired, or leave nullable with default.
The same stored columns are added to `prescriptions` and `clinical_encounters` and backfilled from `patients`.

---

## 7. Backup & Integrity Services Extension

### Backup Service (`backend/src/kalyan_api/services/backup_service.py`)
- Archive creation (`create_backup_bundle`):
  1. `db.sql` via `pg_dump`
  2. Copies patient photos from `cfg.photos_dir` into bundle `photos/`
  3. Computes SHA-256 for each photo and records in `photos_manifest`
  4. Writes `manifest.json`
  5. Compresses into `.tar.gz`
- Verification (`verify_backup_bundle`):
  Checks `manifest.json`, validates SHA-256 hashes of `db.sql` and each photo.
- Restoration (`restore_backup`):
  Fails closed if manifest hashes mismatch; takes a pre-restore safety snapshot; restores database; restores photos.
- **Phase 20 Extension**:
  - Add `assets_dir` to `Settings` (`KALYAN_ASSETS_DIR`, default `backend/var/assets`).
  - Bundle `assets/` into `.tar.gz` alongside `photos/`.
  - Include `assets_count` and `assets_manifest` in `manifest.json`.
  - Restore assets to `cfg.assets_dir`.
  - In `backup_service.py`, preserve backward compatibility: if restoring an older v1.0 backup archive lacking `assets/`, treat `assets_manifest` as optional.

### Integrity Service (`backend/src/kalyan_api/services/integrity_service.py`)
- Currently runs 5 pillars: Financial ledger invariants, URN uniqueness, URN sequence gaps, Receipt uniqueness, Photo storage integrity (`check_photo_storage_integrity`).
- Add `check_asset_storage_integrity()`:
  - Cross-references DB records in `hospital_assets` against files in `cfg.assets_dir`.
  - Flags missing asset files (DB record exists, disk file missing).
  - Flags orphan files (disk file exists in `assets_dir`, no DB record found).

---

## 8. Audit Service Context & New Event Actions

### Audit Architecture (`backend/src/kalyan_api/services/audit_service.py`)
- In-transaction append-only logging into `audit_logs` table (`session.flush()`).
- Database trigger `trg_audit_logs_no_update_delete` blocks all UPDATE and DELETE operations.
- `_assert_no_redacted_keys`: Raises `AuditPayloadError` if passwords or tokens appear in payloads.
- Caller pattern:
  ```python
  ctx = build_audit_context(request, principal)
  audit_service.record(
      session,
      ctx,
      AuditAction.ACTION_NAME,
      entity_type="ENTITY_TYPE",
      entity_id=str(entity.id),
      before=before_state,
      after=after_state,
      reason=reason,
  )
  ```

### New Phase 20 Audit Actions (`AuditAction` enum, max length 48 chars)
```python
PATIENT_CORRECTED = "PATIENT_CORRECTED"
PATIENT_IMPORT_STAGED = "PATIENT_IMPORT_STAGED"
PATIENT_IMPORT_COMMITTED = "PATIENT_IMPORT_COMMITTED"
PATIENT_EXPORTED = "PATIENT_EXPORTED"
PRINT_TEMPLATE_UPDATED = "PRINT_TEMPLATE_UPDATED"
ASSET_UPLOADED = "ASSET_UPLOADED"
```

### Event Payload Contracts
1. **Demographic Correction (`PATIENT_CORRECTED`)**:
   - `entity_type`: `"PATIENT"`
   - `entity_id`: `str(patient.id)`
   - `before`: Full dictionary of changed demographic fields before edit.
   - `after`: Full dictionary of changed demographic fields after edit.
   - `reason`: Mandatory justification string (`>= 5` characters).
2. **Import Batch Staged (`PATIENT_IMPORT_STAGED`)**:
   - `entity_type`: `"IMPORT_BATCH"`
   - `entity_id`: `batch_id`
   - `after`: `{"filename": filename, "total_rows": N, "valid": V, "duplicates": D, "errors": E}`
3. **Import Batch Committed (`PATIENT_IMPORT_COMMITTED`)**:
   - `entity_type`: `"IMPORT_BATCH"`
   - `entity_id`: `batch_id`
   - `after`: `{"committed_count": C, "safety_backup": backup_filename}`
4. **Export Executed (`PATIENT_EXPORTED`)**:
   - Per **D-20-17**: Single audit event recording actor, reason, scope, selected fields, row count.
   - `entity_type`: `"PATIENT_EXPORT"`
   - `entity_id`: None
   - `after`: `{"scope": {"start_date": ..., "end_date": ..., "department_id": ...}, "fields": [...], "row_count": N}`
   - `reason`: Mandatory export purpose.

---

## 9. Print Components & Patient Identification

### Existing Print Components
1. **`PrintLetterhead.tsx`**:
   - `LetterheadBanner`: Crimson banner with logo, hospital name in English, department title.
   - `LetterheadDoctors`: Renders Dr. Madan Mohan Dwivedi & Dr. Chandan Kr. Dwivedi flanking Caduceus emblem.
   - `PatientStrip`: Ruled box for Name, Age/Sex, Date, Address, Reference.
   - `LetterheadFooter`: Address lines and clinic contact.
2. **`ReceiptPrint.tsx`**:
   - Props: `payment: PaymentOut`, `isReprint?: boolean`, `settings?: ClinicSettingsOut | null`.
   - Layout: Clinic header & addresses &rarr; Receipt metadata &rarr; Patient info (currently URN, Name, Package) &rarr; Payment details &rarr; DUPLICATE stamp &rarr; Footer text.
   - Currently missing mobile and address. Must display all 4 per **D-20-05**.
3. **`PrescriptionPrint.tsx`**:
   - Props: `prescription: PrescriptionOut`, `onClose?: () => void`.
   - Uses `LetterheadBanner`, `LetterheadDoctors`, `PatientStrip`.
   - Displays URN and Doctor name below strip. Must include stored mobile and address.
4. **`RegistrationCard.tsx`**:
   - Props: `patient: PatientOut`, `settings?: ClinicSettingsOut | null`, `onClose?: () => void`.
   - Live ID card (always shows current patient details per **D-20-06**).
   - Reads `settings.print_footer_en/hi` and consultation validity days.
5. **`ConsultationSummaryPrint.tsx`**:
   - Props: `encounter: EncounterRead`, `patient?: PatientOut | null`, `followUp`, `advice`, `isReprint`.
   - Finalisation gate (DWS-09): Only prints if `encounter.is_finalised`.
   - Displays reprint timestamp if duplicate. Must show stored patient details.

### Reprints vs Live ID Card Rule (D-20-05, D-20-06)
- **Issued documents** (`receipt`, `prescription`, `consultation_summary`) are historical records. When reprinted, they **must display the stored patient details captured at issuance**, not the current patient row values. Reprints must remain marked `DUPLICATE` (BIL-04).
- **Registration card** is an active hospital identification card and always reads the live `Patient` record.

---

## 10. URN Service & Import Sequence Guarantees

### URN Service (`backend/src/kalyan_api/services/urn_service.py`)
```python
def allocate_next_urn(session: Session, year: int | None = None) -> str:
    if year is None:
        year = clock.ist_today().year

    query = text("""
        INSERT INTO urn_sequences (year, last_seq)
        VALUES (:year, 1)
        ON CONFLICT (year)
        DO UPDATE SET last_seq = urn_sequences.last_seq + 1
        RETURNING last_seq;
    """)
    res = session.execute(query, {"year": year})
    seq_val = res.scalar_one()

    return f"KH-{year}-{seq_val:04d}"
```

### Import Sequence Gap-Free Guarantee (D-20-09, D-20-11, D-20-12)
1. **Never allocate during upload or validation**: URNs are **never** allocated during file upload, inspection, mapping, or staging.
2. **Allocate only on commit**: `allocate_next_urn(session)` is called strictly inside the commit transaction, and only for rows marked `VALID` or resolved as `IMPORT_AS_NEW`.
3. **Failed rows do not leak URNs**: Any row that fails validation or is unresolved is excluded from commit and receives no URN, ensuring zero gaps in the sequence counter.
4. **Pre-commit safety backup**: Before committing an import batch, `backup_service.create_backup_bundle()` is invoked. If the backup fails, the transaction is aborted and no rows are imported.
5. **Legacy identifier preservation**: Old hospital numbers from import files are stored in `patient.legacy_urn`, making them searchable via patient search without reusing them as canonical URNs.

---

## 11. Patient Import & Export Center Specifications

### 8-Stage Import Pipeline (Plan 20-06, D-20-08 to D-20-14)
1. **Upload**: Accept CSV or XLSX file (max 10 MB). Store in temporary upload directory. Generate `batch_id`.
2. **Inspect**: Detect character encoding (`utf-8`, `utf-8-sig`, `windows-1252`), detect delimiter, count total rows, extract header row.
3. **Map**: Map columns to canonical demographic fields (`full_name`, `guardian_name`, `gender`, `age_years` or `dob`, `mobile`, `address`, `district`, `state`, `emergency_contact`, `legacy_urn`).
4. **Validate**:
   - Required fields: `full_name`, `guardian_name`, `gender` ('M'/'F'/'O'), `age_years` (0-150), `mobile` (10 digits), `address`. Missing fields flag row as `INVALID` with specific field errors.
   - Clean mobile numbers (strip spaces, `+91`, prefixes).
5. **Resolve (Duplicate Detection)**:
   - Identify candidate duplicates against existing patients using: exact mobile + address match, exact legacy URN match, or phonetic/Levenshtein name similarity with matching mobile.
   - For each duplicate candidate, Administrator explicitly selects `SKIP` or `IMPORT_AS_NEW`.
   - **Overwriting existing patients is strictly prohibited** (D-20-13).
6. **Preview**: Display summary: X rows to import, Y duplicates skipped, Z invalid rows held back.
7. **Commit**:
   - Run automatic safety backup via `backup_service`. If backup fails, abort commit.
   - In a single database transaction, iterate through approved rows, call `urn_service.allocate_next_urn()`, insert into `patients`, update staging row status.
8. **Reconcile**: Generate batch reconciliation report. Export failed/unresolved rows as CSV for correction.

### Export Pipeline (Plan 20-07, D-20-15 to D-20-20)
- **Permissions**: Guarded by `require(Permission.PATIENT_EXPORT)`.
- **Filtering / Scope**:
  - Date range (registration date or visit date).
  - Department (patients with an appointment in that department within the date range per **D-20-19**).
  - Search query filter.
- **Field Selection**:
  - Demographics: Name, URN, Guardian, Gender, Age, Mobile, Address, District, State. (Ticked by default).
  - Allergies & Notes: Unticked by default (D-20-18).
  - Clinical Content: Encounters, Clinical Notes, Specialty Assessment Responses, Vitals, Diagnoses, Prescriptions, Treatment Plans, Sessions (Unticked by default, D-20-16).
- **Security & Safety**:
  - Mandatory export reason (`>= 5` characters).
  - Formula injection mitigation: Values starting with `=`, `+`, `-`, or `@` must be prefixed with a single quote `'` to neutralize formula execution in Excel/Calc.
  - Streaming delivery: Stream response directly to browser; do not persist export file on server disk (D-20-20).
  - Audit event: Single `AuditAction.PATIENT_EXPORTED` event written with actor, scope, field list, row count, reason.

---

## 12. Library Selection for CSV / XLSX Processing

### Current Dependencies (`pyproject.toml` & `requirements.lock.txt`)
- Python standard library: `csv` is built-in and available.
- `openpyxl`: **Not currently installed** in `backend/.venv` and not listed in `pyproject.toml`.

### Recommendation
1. **CSV Parsing**: Use standard library `csv` module with `codecs` / `io.TextIOWrapper(encoding='utf-8-sig')`. Zero external dependencies, fully offline, handles Excel UTF-8 BOM automatically.
2. **XLSX Parsing & Generation**:
   - `openpyxl` (v3.1.5) is the industry standard for reading and writing `.xlsx` files without Microsoft Office.
   - It requires only one dependency: `et_xmlfile` (v2.0.0).
   - Both are pure Python wheels (`py2.py3-none-any.whl`, 250 kB + 18 kB total).
   - Offline compliance: To satisfy DEP-01 / DEP-03 (offline LAN deployment), add `openpyxl>=3.1.5` to `pyproject.toml`, and bundle the wheel files in the installer package so installation requires zero internet access.

---

## 13. Test Patterns & Environments

### Backend Tests Execution
- Runner: `pytest`
- Environment Variables required:
  ```powershell
  $env:PYTHONPATH = "D:\dr-sr\backend\src"
  $env:KALYAN_TEST_DB_NAME = "kalyan_test"
  $env:KALYAN_PHOTOS_DIR = "$env:TEMP\kalyan_test_photos"
  $env:KALYAN_BACKUP_DIR = "$env:TEMP\kalyan_test_backups"
  $env:KALYAN_ASSETS_DIR = "$env:TEMP\kalyan_test_assets"
  pytest backend/tests/ -v
  ```
- Important test fixtures in `conftest.py`:
  - `migrated_db`: Runs Alembic `upgrade_head` on `kalyan_test`. Database name must end in `_test`.
  - `db_session`: Per-test isolated session inside a `SAVEPOINT`, rolled back on teardown.
  - `client`: `TestClient` with `Origin: http://testserver` for CSRF compliance.

### Frontend Tests Execution
- Runner: `vitest` in `frontend/`
  ```powershell
  cd frontend
  npm test
  ```
- Key admin test suites:
  - `frontend/src/components/__tests__/app-shell.test.tsx` (tests sidebar navigation links and active states)
  - `frontend/src/pages/__tests__/admin-navigation-architecture.test.tsx` (tests admin overview, quick access grid, management attention)
  - `frontend/src/pages/__tests__/settings.test.tsx` (tests clinic settings form, optimistic locking)
  - `frontend/src/pages/__tests__/backup-manager.test.tsx` (tests backup listing, creation, restore)
  - `frontend/src/pages/__tests__/audit-viewer.test.tsx` (tests audit trail filters, before/after diffs)
  - `frontend/src/pages/__tests__/integrity-dashboard.test.tsx` (tests integrity check pillars)

---

## 14. Verification of D-20-23 Prerequisite

**Decision D-20-23 specifies:**
> "Plan 20-02 builds on the uncommitted sidebar and admin-home changes on `refactor/admin-modules-ssot` (`AppShell.tsx`, `AreaHome.tsx`, `routers/areas.py`, `app-shell.test.tsx`). Those changes must be committed before 20-02 starts..."

### Git Verification
- Working branch: `refactor/admin-modules-ssot`
- Verified commit: `07184b051a1276316e95695d3fdf69a589b0508e` ("feat: reception dashboard, token desk and billing pages; admin overview and grouped navigation")
- Files committed:
  - `frontend/src/components/AppShell.tsx`
  - `frontend/src/components/admin/ManagementOverviewDashboard.tsx`
  - `frontend/src/pages/AreaHome.tsx`
  - `backend/src/kalyan_api/routers/areas.py`
  - `frontend/src/components/__tests__/app-shell.test.tsx`
  - `frontend/src/pages/__tests__/admin-navigation-architecture.test.tsx`
- Current git status on these files:
  `nothing to commit, working tree clean`.
- **Verdict**: The prerequisite is completely satisfied. Plan 20-02 can safely build upon this committed state.

---

## Implementation Roadmap for Planning Phase 20

With the inventory frozen and constraints researched, the phase is structured into 8 distinct plans:

1. **20-01: Admin Inventory Audit & Permissions Foundation**
   - Audit all routes and permissions; add `patient:correct`, `patient:import`, `patient:export` to `Permission` and `Role.ADMIN`.
   - Update permission catalogue tests, OpenAPI snapshot, and roles API test.
2. **20-02: Five-Section Sidebar & Navigation Reorganization**
   - Reorganize `renderAdminSidebar` in `AppShell.tsx` into 5 canonical sections per D-20-21.
   - Remove dead placeholder links leading to `/admin` per D-20-22.
   - Update `app-shell.test.tsx` and `admin-navigation-architecture.test.tsx`.
3. **20-03: Hospital Identity & Logo Asset Management**
   - Create `hospital_assets` table (`0015_hospital_assets_and_print_templates.py`).
   - Create `asset_service.py` to validate, store in `KALYAN_ASSETS_DIR`, and serve assets.
   - Extend backup bundle and integrity checker to cover `assets/`.
   - Add frontend asset management tab/page under `/admin/assets` or `/admin/settings`.
4. **20-04: Per-Document Print Template Registry & Previews**
   - Create `print_templates` table seeded from existing `clinic_settings` values.
   - Backend CRUD endpoints (`GET /api/admin/templates`, `PATCH /api/admin/templates/{doc_type}`).
   - Frontend template editor with live bilingual previews for prescription, receipt, registration card, consultation summary.
5. **20-05: Patient Demographic Correction Workflow**
   - Alembic migration to add stored snapshot columns (`patient_name`, `patient_urn`, `patient_mobile`, `patient_address`) to `payments`, `prescriptions`, `clinical_encounters`, backfilling from `patients` while temporarily disabling `trg_prevent_payment_tampering`.
   - Backend `PATCH /api/admin/patients/{id}/demographics` with mandatory reason, optimistic locking, and `PATIENT_CORRECTED` audit event.
   - Frontend demographic correction UI with server-side search and before/after confirmation dialog.
6. **20-06: Patient Import Centre (8-Stage Staging Pipeline)**
   - Staging tables `patient_import_batches` and `patient_import_rows`.
   - Backend upload, inspect, map, validate, resolve, commit endpoints.
   - Commit runs pre-import backup and allocates gap-free URNs strictly for committed rows.
   - Frontend step-by-step import wizard with duplicate resolution (skip vs import as new).
7. **20-07: Patient Export Centre**
   - Backend streaming endpoint `POST /api/admin/exports` with scope filters, field selection, formula sanitization, and audit event `PATIENT_EXPORTED`.
   - Frontend export configuration dialog with scope pickers and field checkboxes.
8. **20-08: Phase 20 Verification & Integration Gate**
   - Full test suite run (`pytest` and `npm test`).
   - OpenAPI schema snapshot verification.
   - End-to-end verification of import round-trip, export streaming, logo upload, template preview, and demographic correction audit.

---

*Phase 20 Research Complete. Document generated for Phase 20 Planner.*
