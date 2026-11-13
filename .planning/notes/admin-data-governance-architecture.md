---
title: "Admin Panel — Data Governance & Configuration Architecture"
date: 2026-11-07
context: "Exploration session: gsd-explore — Admin architecture redesign"
status: "reference specification"
---

# Admin Panel — Data Governance & Configuration Architecture

**Decision:** The Admin panel is a self-contained Hospital Administration and Data Governance
system. Its responsibility is to let an authorized administrator independently manage the
software after installation — without developer intervention for ordinary hospital changes,
asset updates, record corrections, staff access, or backup operations.

---

## Five-Section Architecture

### 1. Management Overview
Executive summary: financial indicators, management attention items, backup status, system
health. No queues, waiting patients, or operational reception/doctor workflows.

Every card must have a drill-down route and a defined data source.
Show "Not configured" or "Insufficient data" — never zero as a fake metric.

### 2. Hospital Configuration
Controls **how the hospital software behaves**. Routes to existing settings pages, reorganized.

| Sub-section | Contents |
|---|---|
| Hospital Profile & Identity | Trust name, hospital name, bilingual address, contact, registration details |
| Logo & Document Assets | Logo upload/replace, hospital photographs, file validation, version history |
| Print Templates | Header/footer per document type (prescription, receipt, registration card) |
| Departments & Services | Department CRUD, service catalogue, active status |
| Doctors & Staff | Doctor profile, qualifications, registration number, fee schedules |
| Clinical & OPD Policies | Follow-up validity, consultation rules, treatment policies |
| Billing & Financial Rules | Receipt cycle, payment methods, fee catalogue, reversal authority |

**Constraint:** This section must not introduce a second configuration system or duplicate
existing hospital settings. It reorganizes the existing `/admin/settings`, `/admin/doctors`,
and `/admin/billing` pages under a coherent hierarchy.

### 3. Patient & Data Management
Controls **the integrity, correction, movement and lifecycle of hospital records**.

| Sub-section | Contents |
|---|---|
| Record Correction | Demographic correction with mandatory reason and audit |
| Import Centre | CSV/XLSX staging pipeline — validate, resolve, preview, commit |
| Export Centre | Permission-checked, audited, field-selective export |
| Bulk Operations | Archive, selective export; no unrestricted bulk delete in v1 |

Distinct from Hospital Configuration: this section acts on patient data, not application rules.

### 4. Users, Security & Governance
Controls **staff access, authentication, session safety, and accountability**.

| Sub-section | Contents |
|---|---|
| Users & Roles | Account lifecycle, role assignment, password reset, unlock |
| Role Permissions Matrix | Read-only view of RBAC grants per role |
| Security & Sessions | Active sessions, session revocation, auth policy, security events |
| Audit & Compliance | Tamper-evident event search, before/after diff, change history |
| Billing Corrections | Financial reversals (existing `/admin/billing` reversal workflow) |

### 5. System & Maintenance
Controls **the local server and infrastructure the software runs on**.

| Sub-section | Contents |
|---|---|
| System Health | Server uptime, CPU/RAM/disk, PostgreSQL status, application version |
| Database & Integrity | Migration revision, FK checks, URN sequence analysis |
| Backup & Recovery | Archive list, manual snapshot, schedule config, verified restore |
| Storage Management | Disk usage by volume (backups, photos) |
| Logs | Application and system logs with filtering |

---

## Data Operation Safety Rules

### Record Correction
- Distinguish: demographic correction vs. clinical amendment vs. billing correction.
- Clinical notes are **never silently edited**. Corrections append an addendum with author
  and timestamp; the original entry is preserved.
- Financial corrections use reversals or adjustments, not transaction deletion.
- Every correction records: actor, timestamp, field changed, old value, new value, reason.
- Permission: `ADMIN` role required. Uses existing RBAC; no new permission system.

### Import Pipeline — 8 Stages
```
Upload → Inspect → Map → Validate → Resolve → Preview → Commit → Reconcile
```
1. **Upload**: Accept CSV/XLSX, detect encoding and format.
2. **Inspect**: Read columns, row count, field types, date formats.
3. **Map**: Map source columns to hospital patient fields using standard template.
4. **Validate**: Required fields, format checks, URN uniqueness, duplicate candidates.
5. **Resolve**: Administrator reviews flagged duplicates and conflicts. No auto-overwrite.
6. **Preview**: Show new records, updates, and skipped rows before any commit.
7. **Commit**: Transactional batch write with error handling per row.
8. **Reconcile**: Report imported / skipped / failed counts; persist batch history with ID,
   filename, operator, timestamp, mapping profile, results.

**Non-negotiable**: An uploaded file never directly overwrites existing patient records.
Matching identifies candidates; a human must resolve ambiguous identities.

### Export
- Requires permission check, mandatory reason, field selection, and audit event.
- Sensitive clinical fields excluded by default.
- CSV/XLSX for data analysis; a spreadsheet export is not a database backup.

### Bulk Operations (v1 scope)
| Operation | Allowed in Phase 20 |
|---|---|
| Bulk export | Yes — selected records, fields, date range |
| Bulk archive | Yes — eligible records under approved policy |
| Bulk correction | No — deferred to Phase 21 |
| Bulk delete | No — deferred to Phase 21; restricted to uncommitted/test records |
| Duplicate merge | No — deferred to Phase 21 |

### Asset Management (Logo & Templates)
- Files stored in managed local server storage; metadata in PostgreSQL.
- Validate file type, dimensions, and size on upload.
- Keep previous versions of important branding assets.
- Preview print layout before publishing.
- Do not delete assets referenced by historical documents.
- One authoritative hospital identity populates all receipts, prescriptions, and reports.

---

## Permission Map (Phase 20, using existing RBAC)

| Operation | Permission Required | Role |
|---|---|---|
| View patient records | `patients:read` | ADMIN |
| Correct patient demographics | `patients:write` + admin role | ADMIN |
| Import patient records | `patients:write` + admin role | ADMIN |
| Export patient records | `patients:read` + explicit export permission | ADMIN |
| Upload hospital logo/assets | `settings:write` | ADMIN |
| Edit print templates | `settings:write` | ADMIN |
| View audit trail | `audit:read` | ADMIN |
| All above | Server-enforced; hidden UI ≠ authorization | — |

No new permissions are introduced. The existing RBAC grants to `ADMIN` already cover
read/write for patients, settings, and audit. Phase 20 adds UI and backend workflows
that exercise those existing permissions correctly.

---

## Implementation Priorities

| Priority | Capability | Reason |
|---|---|---|
| **P0** | Audit all existing admin routes, APIs, permissions, schemas | Prevent regressions during reorganization |
| **P0** | Standard audit recording for every new admin operation | Foundation; cannot be retrofitted |
| **P1** | Hospital identity, logo, bilingual assets | Everyday administration; client-visible |
| **P1** | Print template management per document type | Replaces current single header/footer text fields |
| **P1** | Patient demographic correction workflow | Direct data-control requirement |
| **P1** | Import centre (CSV/XLSX, 8-stage pipeline) | Patient data portability |
| **P1** | Controlled patient export | Counterpart to import |
| **P2** | Duplicate detection & merge | High-risk; needs own auth and transaction design |
| **P2** | Bulk archive and bulk export | Depends on stable patient data model |
| **P2** | LAN workstation status view | Operational management |
| **P3** | Advanced financial analytics | Dependent on reliable expense data |

---

## Deferred — Not in Phase 20

| Capability | Reason | Home |
|---|---|---|
| Duplicate patient merge | High-risk FK cascade; needs dedicated transaction design | Phase 21 |
| Bulk delete | Risk of permanent data loss; needs staged safeguards | Phase 21 |
| Extended data-edit permissions | Advanced RBAC customization; depends on v1 usage | Phase 21 |
| LAN workstation monitoring | Requires local monitoring service; browser can't inspect remote hardware | Phase 21 |
| Offline Setup Console | Seven-stage install workflow; activate when preparing physical installation | Seed |
| Operating expense tracking | No confirmed expense ledger in current scope | Future |
| Advanced analytics | Requires reliable financial and department data sources | Future |

---

## Standards Applied to Every Phase 20 Admin Page

| Standard | Required behavior |
|---|---|
| Permissions | Server-side enforcement on every endpoint; hiding UI is not authorization |
| Validation | Frontend + backend; 422 field errors map to inputs |
| Confirmation | Explicit confirmation modal for destructive or sensitive operations |
| Reason | Mandatory justification text for record corrections, imports, exports, reversals |
| Audit | Actor, timestamp, action, before/after values, reason, result — in same transaction |
| Concurrency | Optimistic locking (`version` field) for concurrent edits |
| Feedback | Loading, success, failure, and retry states on every async operation |
| Offline | All essential functions work without internet on the hospital LAN |
| Search | Server-side search and filtering for patient lookups |
| Pagination | Server-side pagination; no client-side-only large data loads |

---

## Connections to Existing Code

| Existing feature | Phase 20 treatment |
|---|---|
| `/admin/settings` (clinic settings) | Extend to include logo upload and per-document template fields |
| `/admin/doctors` | No change; remains the doctor configuration page |
| `/admin/billing` | Reversal workflow preserved; billing rules view stays |
| `/admin/users` | Preserved; account lifecycle unchanged |
| `/admin/security` | Preserved; session management unchanged |
| `/admin/audit` | Preserved and surfaced under Users, Security & Governance |
| `/admin/backups` | Preserved under System & Maintenance |
| `/admin/integrity` | Preserved under System & Maintenance |
| `/admin/system` | Preserved under System & Maintenance |
| `ManagementOverviewDashboard.tsx` | Remains as the Admin home; real data only, no fabricated KPIs |

The five-section navigation reorganizes these pages under a coherent sidebar.
No pages are deleted. All existing backend endpoints and permissions are preserved.

