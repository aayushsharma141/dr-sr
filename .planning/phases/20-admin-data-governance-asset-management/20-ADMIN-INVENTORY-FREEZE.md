# Phase 20: Administration Inventory Freeze & Security Baseline

**Status:** FROZEN  
**Established:** 2026-11-08  
**Phase:** 20-admin-data-governance-asset-management  
**Baseline Commit:** Task 2 (Phase 20 Wave 1)

---

## 1. Executive Summary & Freeze Policy

Phase 20 evolves Kalyan Hospital's administration panel into a self-contained Hospital Administration and Data Governance platform. Before creating net-new routes, models, or UI workflows, this document audits and freezes the existing administration surface area:
- All 33 active administration endpoints and their security policy markers.
- Existing database tables (`clinic_settings`, `users`, `audit_logs`, `payments`, `doctors`, `consultation_fees`) and their tamper triggers.
- RBAC permissions baseline and role separation invariants.
- Frontend module registrations in `modules.ts` and `AppShell.tsx`.

### Invariants Maintained Under Freeze
1. **Zero Route Regressions**: No existing administration route may be removed or have its URL altered.
2. **Strict RBAC Separation (D-20-01)**: Administrative demographic correction (`patient:correct`), bulk import (`patient:import`), and streaming export (`patient:export`) belong strictly to `Role.ADMIN`. Front-desk reception patient modification (`patient:update`) remains denied to `Role.ADMIN`.
3. **Database Tamper Preservation (D-20-06 / D-20-07)**: Existing tamper triggers (`trg_prevent_payment_tampering`, `trg_audit_logs_no_update_delete`) remain intact. Migrations adding historical snapshot columns must operate strictly within migration-scoped trigger disablement and immediate re-enablement.
4. **OpenAPI Contract Pinning**: The OpenAPI specification is pinned via `backend/tests/openapi.snapshot.json` and verified in CI by `test_openapi_snapshot.py`.

---

## 2. Active Administration Backend Routes & Security Policies

All administration endpoints require authenticated session cookies and enforce granular permissions via `Depends(require(Permission.X))` or `authenticated_only`.

| HTTP Method | Route Path | Source Router File | Security Policy Marker | Purpose & Functional Scope |
|---|---|---|---|---|
| `GET` | `/api/admin/overview` | `routers/areas.py` | `require(Permission.DASHBOARD_ADMIN)` | Operational dashboard KPIs, today's queues, failed logins, storage free space |
| `GET` | `/api/admin/management-overview` | `routers/areas.py` | `require(Permission.DASHBOARD_ADMIN)` | Executive management overview, revenue/expense trends, attention items |
| `GET` | `/api/settings` | `routers/settings.py` | `require(Permission.SETTINGS_READ)` | Fetch clinic identity, contact info, and bilingual header/footer settings |
| `PATCH` | `/api/settings` | `routers/settings.py` | `require(Permission.SETTINGS_WRITE)` | Mutate clinic configuration with optimistic concurrency (`version_id`) |
| `GET` | `/api/doctors` | `routers/doctors.py` | `require(Permission.DOCTOR_READ)` | List active and inactive doctor profiles |
| `POST` | `/api/doctors` | `routers/doctors.py` | `require(Permission.DOCTOR_MANAGE)` | Create new doctor profile |
| `PATCH` | `/api/doctors/{id}` | `routers/doctors.py` | `require(Permission.DOCTOR_MANAGE)` | Update doctor profile details and active status |
| `GET` | `/api/fees` | `routers/fees.py` | `require(Permission.FEE_READ)` | Fetch consultation fee schedule across doctors and visit types |
| `PATCH` | `/api/fees/{id}` | `routers/fees.py` | `require(Permission.FEE_MANAGE)` | Update consultation fee amount with optimistic concurrency |
| `GET` | `/api/users` | `routers/users.py` | `require(Permission.USER_READ)` | Filterable list of system users and active states |
| `POST` | `/api/users` | `routers/users.py` | `require(Permission.USER_CREATE)` | Create staff account with initial temporary credentials |
| `GET` | `/api/users/{id}` | `routers/users.py` | `require(Permission.USER_READ)` | Retrieve single user account details |
| `PATCH` | `/api/users/{id}` | `routers/users.py` | `require(Permission.USER_UPDATE)` | Update user name, assigned doctor, or profile |
| `POST` | `/api/users/{id}/deactivate` | `routers/users.py` | `require(Permission.USER_DEACTIVATE)` | Deactivate user account (last-admin protected) |
| `POST` | `/api/users/{id}/reactivate` | `routers/users.py` | `require(Permission.USER_UPDATE)` | Reactivate previously deactivated user account |
| `POST` | `/api/users/{id}/reset-password` | `routers/users.py` | `require(Permission.USER_RESET_PASSWORD)` | Force-issue temporary password (`must_change_password=True`) |
| `POST` | `/api/users/{id}/unlock` | `routers/users.py` | `require(Permission.USER_UNLOCK)` | Clear lockout on throttled/brute-force locked accounts |
| `GET` | `/api/roles/permissions` | `routers/roles.py` | `require(Permission.USER_READ)` | Read-only matrix of system roles, permissions, and grants |
| `GET` | `/api/admin/sessions` | `routers/sessions.py` | `require(Permission.SESSION_READ)` | Active login session monitor |
| `DELETE` | `/api/admin/sessions/{id}` | `routers/sessions.py` | `require(Permission.SESSION_REVOKE)` | Terminate specific user session |
| `DELETE` | `/api/admin/users/{id}/sessions` | `routers/sessions.py` | `require(Permission.SESSION_REVOKE)` | Bulk terminate all sessions for a specific user |
| `GET` | `/api/admin/security/policy` | `routers/security.py` | `require(Permission.SECURITY_READ)` | Inspect effective authentication & lockout parameters |
| `PATCH` | `/api/admin/security/policy` | `routers/security.py` | `require(Permission.SECURITY_WRITE)` | Tighten security thresholds (session TTL, lockout durations) |
| `GET` | `/api/audit` | `routers/audit.py` | `require(Permission.AUDIT_READ)` | Multi-filter immutable audit trail browser |
| `GET` | `/api/backups` | `routers/backups.py` | `require(Permission.BACKUP_RUN)` | List available backup archive bundles and manifests |
| `POST` | `/api/backups` | `routers/backups.py` | `require(Permission.BACKUP_RUN)` | Trigger manual database and photo archive bundle |
| `POST` | `/api/backups/verify` | `routers/backups.py` | `require(Permission.BACKUP_RUN)` | Validate checksums and manifests of existing archive bundle |
| `POST` | `/api/backups/restore` | `routers/backups.py` | `require(Permission.BACKUP_RESTORE)` | Restore database and photos from verified backup bundle |
| `GET` | `/api/backups/settings` | `routers/backups.py` | `require(Permission.BACKUP_CONFIGURE)` | View automated backup schedule and retention policy |
| `PATCH` | `/api/backups/settings` | `routers/backups.py` | `require(Permission.BACKUP_CONFIGURE)` | Update backup schedule parameters |
| `GET` | `/api/integrity` | `routers/integrity.py` | `require(Permission.INTEGRITY_RUN)` | Execute 5-pillar database and storage integrity diagnostics |
| `GET` | `/api/system` | `routers/system.py` | `require(Permission.SYSTEM_READ)` | Host resource utilization, disk free space, uptime |
| `POST` | `/api/payments/{id}/reverse` | `routers/billing.py` | `require(Permission.PAYMENT_REVERSE)` | Admin-exclusive payment reversal with mandatory reason |

---

## 3. Existing Database Schema & Entity Invariants

### 3.1 `clinic_settings` (Singleton Table, row `id = 1`)
- **Key Columns**: `id`, `name_en`, `name_hi`, `trust_name_en`, `trust_name_hi`, `location_line`, `address_1`, `address_2`, `phone`, `email`, `receipt_sequence_cycle`, `print_header_en`, `print_header_hi`, `print_footer_en`, `print_footer_hi`, `consultation_validity_days`, `version_id`, `updated_by_user_id`, `updated_at`.
- **Concurrency Control**: Enforces `version_id` optimistic concurrency check. Raises 409 `version_conflict` upon mismatch.
- **Audit Integration**: Writes `AuditAction.SETTINGS_UPDATED` with before/after state diff.

### 3.2 `users` (System User Accounts)
- **Key Columns**: `id`, `username`, `password_hash`, `full_name`, `role` (`ADMIN`, `RECEPTION`, `DOCTOR`), `doctor_id`, `is_active`, `failed_login_attempts`, `locked_until`, `must_change_password`, `last_login_at`, `version_id`.
- **Integrity Rules**:
  - `role` constrained to enum members via `CK_users_role_valid`.
  - Deactivation guard: Cannot deactivate the final remaining active administrator (`409 last_admin`).

### 3.3 `audit_logs` (Append-Only Compliance Ledger)
- **Key Columns**: `id`, `occurred_at`, `actor_user_id`, `actor_username`, `actor_role`, `action`, `entity_type`, `entity_id`, `client_ip`, `user_agent`, `correlation_id`, `before_data`, `after_data`, `reason`, `outcome`.
- **Security Invariant**: Enforced by database trigger `trg_audit_logs_no_update_delete`:
  - `UPDATE` operations raise `'audit_logs records are strictly immutable'`.
  - `DELETE` operations raise `'audit_logs records are strictly immutable'`.

### 3.4 `payments` (Financial Transaction Ledger)
- **Key Columns**: `id`, `receipt_number`, `patient_id`, `appointment_id`, `amount_paise`, `payment_method`, `notes`, `is_reversed`, `reversed_at`, `reversed_by_user_id`, `reversal_reason`, `created_by_user_id`, `created_at`.
- **Security Invariant**: Enforced by trigger `trg_prevent_payment_tampering`:
  - `DELETE` is permanently prohibited (`'Posted payments cannot be deleted. Use admin reversal.'`).
  - `UPDATE` is permitted only when transitioning `is_reversed = FALSE` &rarr; `TRUE`, modifying reversal metadata exclusively. Any other modification raises `'Posted payment details cannot be modified.'`.

### 3.5 `doctors` & `consultation_fees`
- `doctors`: Tracks clinical practitioners, qualifications, room assignments, and active status with optimistic locking.
- `consultation_fees`: Doctor fee schedule by visit type (`FIRST_VISIT`, `FOLLOW_UP_PAID`, `FREE_FOLLOW_UP`), linked to `doctors.id`.

---

## 4. Frontend Administration Structure & Navigation Baseline

### 4.1 Canonical Module Registry (`frontend/src/admin/modules.ts`)
The single source of truth for admin capabilities defines groups `hospital` and `system`:
1. `hospital-configuration` (`/admin/settings`)
2. `doctor-clinical` (`/admin/doctors`)
3. `billing-financial` (`/admin/billing`, `/reception/dues`)
4. `appointment-workflow` (status: `fixed` — APT-02)
5. `physiotherapy` (status: `fixed` — VAS 0-10)
6. `prescription-print` (`/admin/settings`)
7. `user-authority` (`/admin/users`, `/admin/roles`)
8. `security-access` (`/admin/security`)
9. `audit-compliance` (`/admin/audit`)
10. `backup-data` (`/admin/backups`, `/admin/integrity`)
11. `system-health` (`/admin/system`)

### 4.2 Reorganization Target for Plan 20-02 (D-20-21 & D-20-22)
AppShell's sidebar currently contains a temporary grouped structure with three placeholder links that redirect back to `/admin` (`Hospital Performance`, `Department Analytics`, `Resource Utilization`).
Plan 20-02 restructures `renderAdminSidebar` into the canonical 5-section hierarchy:
1. **Hospital Configuration**: Clinic Settings (`/admin/settings`), Hospital Identity & Logo (`/admin/assets`), Print Templates (`/admin/templates`), Doctors & Fees (`/admin/doctors`).
2. **Patient & Data Management**: Patient Demographic Correction (`/admin/patients/correct`), Import Centre (`/admin/imports`), Export Centre (`/admin/exports`).
3. **Billing & Finance**: Billing & Reversals (`/admin/billing`), Pending Dues (`/reception/dues`).
4. **Users, Security & Governance**: User Accounts (`/admin/users`), Roles & Permissions (`/admin/roles`), Security & Sessions (`/admin/security`), Audit Trail (`/admin/audit`).
5. **System & Maintenance**: Backup & Restore (`/admin/backups`), Data Integrity (`/admin/integrity`), System Health (`/admin/system`).

---

## 5. Phase 20 Target Gap Additions

The following net-new endpoints and models will be added across Plans 20-03 through 20-07:

| Plan | Target Route / Feature | Method | Proposed Policy Marker | Data Model / Storage Impact |
|---|---|---|---|---|
| **20-03** | `/api/admin/assets`<br>`/api/admin/assets/{id}`<br>`/api/assets/active-logo` | `GET`, `POST`<br>`PATCH`, `DELETE`<br>`GET` (auth/public) | `require(Permission.SETTINGS_WRITE)` | Table `hospital_assets`; file storage in `KALYAN_ASSETS_DIR`; backup bundle extended to include `assets/` |
| **20-04** | `/api/admin/templates`<br>`/api/admin/templates/{doc_type}` | `GET`<br>`PATCH` | `require(Permission.SETTINGS_WRITE)` | Table `print_templates` (types: `prescription`, `receipt`, `registration_card`, `consultation_summary`) |
| **20-05** | `/api/admin/patients/{id}/demographics`<br>`/api/admin/patients/search` | `PATCH`<br>`GET` | `require(Permission.PATIENT_CORRECT)` | Add snapshot columns (`patient_name`, `patient_urn`, `patient_mobile`, `patient_address`) to `payments`, `prescriptions`, `clinical_encounters`; migration backfill with trigger suspension |
| **20-06** | `/api/admin/imports/upload`<br>`/api/admin/imports/inspect`<br>`/api/admin/imports/map`<br>`/api/admin/imports/validate`<br>`/api/admin/imports/resolve`<br>`/api/admin/imports/preview`<br>`/api/admin/imports/commit`<br>`/api/admin/imports/batches/{id}/reconcile` | `POST`<br>`POST`<br>`POST`<br>`POST`<br>`POST`<br>`POST`<br>`POST`<br>`GET` | `require(Permission.PATIENT_IMPORT)` | Tables `patient_import_batches`, `patient_import_rows`; add column `legacy_urn` to `patients`; pre-commit safety backup |
| **20-07** | `/api/admin/exports` | `POST` | `require(Permission.PATIENT_EXPORT)` | Audited streaming CSV/XLSX generation with formula sanitization, date/department filters, and field selectors |

---

## 6. OpenAPI Snapshot & Policy Test Baseline Verification

As part of Wave 1 (Plan 20-01):
1. **Permissions Registered**: `patient:correct`, `patient:import`, and `patient:export` were added to `Permission` and `ROLE_PERMISSIONS[Role.ADMIN]`.
2. **Snapshot Updated**: `backend/tests/openapi.snapshot.json` was regenerated using `kalyan_api.cli export-openapi` to establish the clean baseline containing all 64 API paths.
3. **Verification Results**:
   - `test_permissions_catalogue.py`: 5 passed.
   - `test_roles_api.py`: 5 passed.
   - `test_route_policies.py`: 3 passed.
   - `test_openapi_snapshot.py`: 2 passed.

All route policy invariants and OpenAPI structural checks are verified green.
