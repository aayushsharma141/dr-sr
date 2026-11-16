# Phase 23: Advanced Data Operations - Context

**Gathered:** 2026-11-16
**Status:** Ready for planning
**Mode:** Interactive discussion with Owner (Owner-confirmed decisions locked)

<domain>
## Phase Boundary

Phase 23 covers hospital data governance and system operational workflows:
1. **Duplicate Patient Detection & Merge**: Automated high-precision candidate identification, side-by-side comparison, non-destructive alias pointer merge, redirection, and undo capability.
2. **Filtered Bulk Archival**: Admin-guided manual bulk archiving with inactivity filters and financial dues guards.
3. **Extended Data-Edit Permissions**: Strict permission boundaries for administrative data operations.
4. **LAN Workstation Status Monitoring**: Local network terminal heartbeats and real-time station monitoring.

Out of scope: Cloud sync (violates offline LAN invariant), automated hard purge of clinical records (violates hospital retention invariants).

</domain>

<decisions>
## Implementation Decisions

### 1. Duplicate Patient Merge Architecture (Owner-Decided — LOCKED)
- **Model: Alias Pointer Architecture**:
  - The merged patient is deactivated (`is_active = False`, `merged_into_id = master_patient.id`, `merged_at`, `merged_by_user_id`).
  - Immutability trigger preservation: Historical records (`payments`, `clinical_encounters`, `prescriptions`, `treatment_sessions`) remain untouched on their original rows, strictly preserving database tamper triggers (`trg_prevent_payment_tampering`, `trg_prevent_finalised_encounter_tampering`).
  - Master aggregation: Master patient timeline, visits, encounters, billing summaries, and receipts dynamically aggregate records where `patient_id = master.id OR patient.merged_into_id = master.id`.
  - Search & Routing: Searching or scanning the old merged URN automatically redirects to the master patient with an informative banner: "Merged Record: This file was merged from URN {old_urn} on {date} by {admin}".
  - Visit check-in blocked: Check-in, token generation, or appointments cannot be initiated for deactivated/merged records.

### 2. Candidate Detection & Matching Criteria (Owner-Decided — LOCKED)
- **Matching Rule**: Exact mobile number match + normalized name match (whitespace-normalized, case-insensitive).
- **Admin Review Queue**: A dedicated queue under Admin (`/admin/duplicates`) showing suspected duplicate pairs with similarity scoring, registration dates, and activity counts.

### 3. Open Visit Safety Guard (Owner-Decided — LOCKED)
- **Fail Closed**: Merging is strictly refused with an error if either candidate patient has an active or open visit (e.g. status `ARRIVED`, `WAITING`, `IN_CONSULTATION`, or unclosed visit).
- **Resolution**: Reception must complete or cancel the open visit before the merge can proceed.

### 4. Demographic Conflict Resolution (Owner-Decided — LOCKED)
- **Master Default with Selective Override**:
  - Master patient's demographics (name, mobile, address, guardian, photo) are preserved by default.
  - Side-by-side comparison modal presents both records and allows the admin to toggle individual fields from the secondary record into the master record if more up-to-date.

### 5. Temporary Undo Mechanism (Owner-Decided — LOCKED)
- **Undo Capability**:
  - Admin can reverse a merge via an immediate action banner / recent merge log.
  - Undoing clears `merged_into_id = NULL`, reactivates the secondary patient (`is_active = True`), and records a detailed `PATIENT_UNMERGED` audit event.
  - Since the Alias Pointer model never mutates historical foreign keys, undo is completely clean and non-destructive.

### 6. Filtered Bulk Archival (Owner-Decided — LOCKED)
- **Admin-Guided Manual Archival**:
  - Admin uses filtering controls (e.g., inactive threshold 3+ years, district, zero visits).
  - Admin manually selects matching candidates for bulk archival.
  - **Financial Invariant (HARD GUARD)**: Any patient with outstanding dues (`dues > 0`) is strictly blocked from archival.
  - **Soft Archive**: Archived patients receive `is_archived = True`. They are hidden from standard reception lookups but remain retrievable via an explicit "Include Archived" filter in Patient Records.

### 7. Permission Boundaries (Owner-Decided — LOCKED)
- **Admin-Only**:
  - `patient:merge` and `patient:archive` permissions assigned strictly to `ADMIN` role.
  - Reception and Doctor roles have zero merge or archive capabilities.

### 8. LAN Workstation Status Monitoring
- **Heartbeat & Registry**:
  - Workstations send periodic heartbeat ping (every 30s) reporting terminal identifier, local IP, active user, and app version.
  - Dedicated Admin screen (`/admin/workstations`) displaying active LAN workstations with live status indicators (Online, Idle, Disconnected).
</decisions>

<canonical_invariants>
## Canonical Hospital Invariants Enforced

1. Permanent Patient URN preserved without recycling.
2. Financial tamper triggers on payments never disabled or bypassed in application code.
3. Clinical encounter immutability triggers never bypassed.
4. Reception cannot merge or archive patient identities.
5. Zero internet dependencies — LAN local heartbeats only.
6. Patients with outstanding dues cannot be archived.
</canonical_invariants>
