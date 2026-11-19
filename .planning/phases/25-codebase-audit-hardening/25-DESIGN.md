# Phase 25 Design: Codebase Audit & System Hardening

## Context & Objectives

Following the comprehensive Ponytail repo audit, 20 specific defects and opportunities were identified across backend safety, RBAC permissions, state machine consistency, workstation monitoring, and test gate health.

The objective of Phase 25 is to resolve all 20 audit findings using the smallest complete diffs (Ponytail lazy senior dev principles) with strict verification against PostgreSQL (`kalyan_test`) and Vitest.

## Core Architectural Invariants

1. **Restore Durability (Kalyan Governance §15):** The database backup restore workflow must grant all required table permissions to `kalyan_app`. No newly created table may be omitted from `RUNTIME_TABLE_GRANTS`.
2. **Default-Deny Authorization (SEC-01, SEC-02):** Every API endpoint must declare an explicit security policy dependency and must be mapped in the RBAC matrix with verified expected status codes per role.
3. **Appointment Lifecycle Consistency (APT-01, RF-11):** An appointment waiting for a doctor consultation has `status = "ARRIVED"` and `consultation_status = "WAITING"`. State machine transitions must remain backwards-compatible with all existing dashboards, queues, and test gates.
4. **Isolated Workstation Identity (DWS-10):** Workstations on the hospital LAN must report unique, persistent hardware/client identities, never the shared server IP/hostname. Background heartbeats must never interfere with frontend test runners.
5. **Data Audit Immutability (AUD-01, PAT-01):** Any demographic change applied during patient merge must be validated and auditable, incrementing the master record's `version_id`.
6. **Lean & Zero Bloat:** The codebase should not retain dead files, unneeded root caches, or redundant package dependencies.

## Execution Waves

- **Wave 1 (Plan 25-01):** Backend Security, Permissions & State Machine Alignment
  - Restore table grants for `pending_opd_arrivals`
  - Explicit policy marker for `POST /api/system/heartbeat`
  - Check-in `ARRIVED` status contract preservation
  - 13 endpoints added to RBAC matrix and OpenAPI snapshot regenerated
  - Legacy credentials audit test updated for pruned `legacy/` directory
- **Wave 2 (Plan 25-02):** Workstation Heartbeat & Frontend Mock Isolation
  - Heartbeat test environment guard
  - Client workstation UUID in `localStorage`
  - Admin module registry unique display orders
  - Doctor settings route restoration and 12px text floor fix
- **Wave 3 (Plan 25-03):** Data Safety, Integrity & Efficiency
  - Patient archival candidate SQL-level inactivity filter & batched dues
  - Patient merge demographic validation and prior state audit logging
  - Hospital logo project root path resolution fix
  - Patient previous dues batch visit totals optimization
- **Wave 4 (Plan 25-04):** Lean Cleanup & Documentation Synchronization
  - Prune redundant `psycopg` dependency
  - Invalidation consolidation in `queries.ts`
  - README tech stack version synchronization
  - Ephemeral root clutter cleanup
