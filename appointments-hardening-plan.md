# Plan: Appointments Workspace & OPD Check-In Hardening

**Generated**: 2026-11-18 (Revised per plan review `#25`)

## Overview
Harden the Kalyan Hospital Appointments & OPD Reception module across backend concurrency/idempotency, doctor-wise token safety, audit completeness, status-filter consistency, 8-column operational table UX, and `CreateOpdTokenModal` safeguards — strictly preserving the existing PostgreSQL + FastAPI + React/TanStack Query architecture, hospital business invariants (`AGENTS.md`), and existing `AppointmentStatus` / `ConsultationStatus` enums.

This plan is grounded in the read-only frontend and backend codebase audits (board `#20`, `#21`) and adversarial review (`#25`), structured into **5 parallel execution waves (18 atomic tasks)** with strictly disjoint file ownership inside every wave.

## Prerequisites
- PostgreSQL 15+ running with migrations applied through revision `0037` (`0037_patient_documents.py`) and runtime role `kalyan_app`.
- Backend test environment: Python virtualenv with `pytest`, Alembic, and FastAPI test fixtures (`backend/tests/conftest.py`).
- Frontend toolchain: Node.js + npm (`tsc -b`, `oxlint`, `vitest`).
- Git checkpoint commit created before beginning Wave 1 implementation (`AGENTS.md`).

---

## Canonical Lifecycle & Policy Definitions

### 1. Authoritative State Machine (Grounded in `backend/src/kalyan_api/models.py` & `services/appointment_service.py`)

**`AppointmentStatus` (`models.py:775-792`)** — 12 existing values (no invented statuses):
- **Pre-arrival (booked / scheduled)**: `BOOKED`, `TO_ARRIVE`, `REGISTERED`
- **Checked-in / Active Queue**: `ARRIVED`, `CHECKED_IN`, `WAITING`
- **In Consultation**: `IN_CONSULTATION`
- **Completed (Terminal)**: `DONE`, `COMPLETED`
- **Recoverable Same-Day Absence**: `NO_SHOW`
- **Terminal Non-Completed**: `CANCELLED`, `RESCHEDULED`

**`ConsultationStatus` (`models.py:795-801`)** — nullable on `Appointment` until check-in:
- `WAITING` → `IN_CONSULTATION` → `COMPLETED` (terminal)
- `WAITING` → `CANCELLED` (terminal, e.g. on doctor transfer or cancellation)

**`PendingOpdArrival.status` (`models.py:890,913-915`)** — pre-registration quick walk-in arrivals:
- `TO_ARRIVE` → `REGISTERED` (linked to created `Patient` + `Appointment`) | `CANCELLED` (terminal)

```
Pre-Arrival (BOOKED / TO_ARRIVE / REGISTERED)
   ├── [Reception Check-In, same-day IST] ──► ARRIVED / WAITING (ConsultationStatus=WAITING, Visit=OPEN, Token issued)
   │      ├── [Doctor Start Consultation] ──► IN_CONSULTATION (ConsultationStatus=IN_CONSULTATION)
   │      │      └── [Doctor Finalise]    ──► DONE / COMPLETED (ConsultationStatus=COMPLETED) [TERMINAL]
   │      ├── [Reception Reassign Doctor] ──► CANCELLED (original token burned, charge voided) + New Successor Row (ARRIVED/WAITING, target doctor's new token, same visit_id)
   │      └── [Reception Cancel]          ──► CANCELLED [TERMINAL]
   ├── [Reception Reschedule]             ──► RESCHEDULED [TERMINAL] + New Booking Row
   ├── [Reception Mark No-Show]           ──► NO_SHOW
   │      ├── [Reception Check-In, same-day IST, no duplicate active booking] ──► ARRIVED / WAITING
   │      └── [Reception Reschedule]      ──► RESCHEDULED [TERMINAL] + New Booking Row
   └── [Reception Cancel]                 ──► CANCELLED [TERMINAL]
```

### 2. Explicit Answers to the 5 Lifecycle Policy Questions

| # | Policy Question | Authoritative System Policy | Targeted Gaps Closed by This Plan |
|---|---|---|---|
| 1 | **Can a `CANCELLED` appointment be checked in again?** | **No.** `CANCELLED` is strictly terminal (`BOOKING_TRANSITIONS[CANCELLED] = frozenset()`, `CONSULTATION_TRANSITIONS[CANCELLED] = frozenset()` → HTTP `422 invalid_status_transition`). Cancelled `PendingOpdArrival` rows reject registration with HTTP `409`. Reception must create a new booking or walk-in. | Enforced & regression-tested (`T15`). |
| 2 | **Can a `NO_SHOW` appointment be checked in later?** | **Yes — same-day only (`clock.ist_today()`), Reception only.** `BOOKING_TRANSITIONS[NO_SHOW] = {ARRIVED, CHECKED_IN, RESCHEDULED}`. Blocked with `422 check_in_wrong_day` on any other date and `409 duplicate_appointment` if the patient already has another active booking with the same doctor today. | Enforced; excluded from `To Arrive` pill while explicitly keeping same-day `"Check in"` CTA working in `RowActions` (`T14`); regression-tested (`T15`, `T17`). |
| 3 | **Can a patient be transferred between doctors?** | **Yes — for checked-in waiting patients on an `OPEN` visit via `POST /appointments/{id}/reassign` (`Permission.VISIT_WRITE`, Reception only).** Pre-check-in bookings stay on Cancel+Rebook or Reschedule (no speculative new transfer flow). | **Gap 1 (`T2`)**: Allow `AppointmentStatus.WAITING` alongside `ARRIVED`/`CHECKED_IN` and lock `Patient` row (`FOR UPDATE`) before `lock_doctor_for_booking` in `reassign_waiting`.<br>**Gap 2 (`T4`, `T14`)**: Extract `ReassignDialog` from `WaitingRoom.tsx` into shared `ReassignModal.tsx` and wire `"Transfer doctor"` into `AppointmentsReception.tsx` `More` menu. |
| 4 | **What happens to the original token after transfer?** | **Original token is permanently burned and never reused.** The original appointment row is retained as `CANCELLED` history (`status=CANCELLED`, `consultation_status=CANCELLED`, `cancellation_reason=reason`), its original consultation charge is voided via `ledger_service.void_appointment_charges`, and a new successor row on the **same `visit_id`** receives a brand-new token from the target doctor's independent daily sequence plus a fresh consultation bill line. | Preserved & regression-tested including audit trail and charge voiding (`T15`). |
| 5 | **Can a completed consultation be reopened?** | **No.** `DONE`, `COMPLETED`, `ConsultationStatus.COMPLETED`, and closed/cancelled `Visit` rows are strictly terminal (`422 invalid_status_transition`). Finalised encounters are immutable; post-finalisation clinical notes use append-only `ClinicalAddendum`. | **Gap (`T2`)**: Add `AppointmentStatus.COMPLETED: ConsultationStatus.COMPLETED` to `_STATUS_TO_CONSULTATION` in `appointment_service.py` so `PATCH /{id}/status` does not erroneously fail with `422` on canonical `COMPLETED`. |

### 3. Doctor-Wise Token Generation & Queue Ordering Policy
- **Independent Per-Doctor Daily Sequence**: Tokens are generated atomically in PostgreSQL via `DailyTokenSequence(doctor_id, appointment_date)` (`INSERT ... ON CONFLICT DO NOTHING` → `SELECT ... FOR UPDATE`). Each doctor has a strictly independent sequence; `Doctor.cabin_code` is strictly a display label, never a shared queue.
- **Collision-Safe High-Water Mark (`T2`)**: `token_service.generate_next_daily_token` computes `max(seq.last_token, MAX(Appointment.token_number), MAX(PendingOpdArrival.token_number)) + 1` so restored or out-of-band `PendingOpdArrival` rows can never trigger `uq_pending_opd_arrival_token` collisions.
- **Explicit Daily Reset Policy (`T1`, `T8`)**: Tokens reset automatically per IST calendar date (`Asia/Kolkata`, `clock.ist_today()`). `ClinicSettings.token_reset_policy` (`DAILY` default) makes the reset policy explicit and auditable without altering existing daily IST reset behavior (see Open Decision #3 if additional reset cycles are desired later).
- **Priority & Walk-In vs Appointment Ordering**:
  - Priority changes (`NORMAL` / `PRIORITY` / `EMERGENCY`, requiring ≥3-char reason) **never mutate `token_number`**.
  - Waiting queues sort strictly as: `EMERGENCY` (ordered by `priority_updated_at or status_updated_at` asc) → `PRIORITY` (ordered by `token_number` asc) → `NORMAL` (ordered by `token_number` asc).
  - Scheduled `POST /appointments` defaults to `issue_token=False` and allocates tokens upon check-in, so walk-ins and checked-in appointments share the doctor's sequence in true arrival order.

### 4. Canonical Appointments Status Filter Buckets (Zero Duplication, Exact Math)
Top toolbar duplicate counters (`To Arrive`, `Checked In`, `Completed`, `No-show`) are removed so counts live in **one authoritative filter pill bar**:

| Filter Pill | Exact Included Rows | Mathematical Relationship |
|---|---|---|
| `Active` | `To Arrive` + `Checked In` (open operational workload; excludes `Completed`, `No-Show`, `Cancelled`, `Rescheduled`) | `Active === To Arrive + Checked In` |
| `To Arrive` | `Appointment.status` in `{BOOKED, TO_ARRIVE, REGISTERED}` + `PendingOpdArrival.status === 'TO_ARRIVE'` (**excludes `NO_SHOW`**) | Disjoint |
| `Checked In` | `Appointment.status` in `{ARRIVED, CHECKED_IN, WAITING, IN_CONSULTATION}` with `consultation_status !== 'COMPLETED'` (**excludes `DONE` / `COMPLETED`**) | Disjoint |
| `Completed` | `Appointment.status` in `{DONE, COMPLETED}` OR `consultation_status === 'COMPLETED'` | Disjoint |
| `No-Show` | `Appointment.status === 'NO_SHOW'` | Disjoint |
| `Cancelled` | `Appointment.status === 'CANCELLED'` + `PendingOpdArrival.status === 'CANCELLED'` | Disjoint |
| `All` | Every row for selected date & doctor (including `RESCHEDULED`) | `All === To Arrive + Checked In + Completed + No-Show + Cancelled + Rescheduled` |

---

## Dependency Graph

```
Wave 1 (Root)        Wave 2                 Wave 3                  Wave 4                  Wave 5
─────────────        ──────                 ──────                  ──────                  ──────
T1 (Mig 0038 +   ──┬─► T6 (Idempotency  ──┬─► T11 (Appointments ──┬─► T15 (OpenAPI +    ──┐
    Models +       │       Service)       │        Router)        │        Backend Tests) │
    Grants)        ├─► T7 (OpdArrival   ──┼─► T12 (OpdArrivals  ──┤                       │
                   │       Audit Fix)     │        Router + Test) │                       │
                   ├─► T8 (Settings +   ──┼───────────────────────┘                       │
                   │       Areas Load)    │                                               │
                   │                      │                                               ├──► T18 (Full Gate,
T2 (Backend Svc  ──┼─► T9 (Backend      ──┘                                               │         Guards &
    Fixes)         │       Schemas)                                                       │         LAN/Print QA)
                   │                                                                      │
T3 (apiFetch     ──┴─► T10 (Frontend    ──┬─► T13 (CreateOpdToken ──┬─► T16 (Client +   ──┤
    Timeout/Key)           Types/Queries) │        Modal)           │        Modal Tests) │
                                          │                         │                     │
T4 (ReassignModal ────────────────────────┼─► T14 (Appointments   ──┴─► T17 (Reception + ──┘
    Extraction)                           │        Reception Page)           Waiting Tests)
                                          │
T5 (PriorityModal ────────────────────────┴───────────────────────────► (feeds T16)
    Hardening)
```

---

## Tasks

### T1: Migration 0038, ORM Models & Restore Runtime Grants
- **depends_on**: `[]`
- **location**: `backend/src/kalyan_api/migrations/versions/0038_appointments_hardening.py`, `backend/src/kalyan_api/models.py`, `backend/src/kalyan_api/services/backup_service.py`
- **description**:
  - Create Alembic migration `0038_appointments_hardening.py` (`revision = "0038"`, `down_revision = "0037"`):
    1. Create `idempotency_keys` table (keeping column types, `Identity`, and `server_default` expressions 100% identical to `models.py` so `alembic.command.check` in `test_migrations_match_models` passes with zero drift):
       - `id` (`BigInteger`, `sa.Identity(always=False)`, PK — NOT `autoincrement`)
       - `actor_user_id` (`BigInteger`, FK `users.id` ON DELETE CASCADE, NOT NULL)
       - `endpoint_key` (`String(128)`, NOT NULL)
       - `idempotency_key` (`String(128)`, NOT NULL)
       - `request_hash` (`String(64)`, NOT NULL — SHA-256 hex digest of canonical JSON payload)
       - `response_status` (`SmallInteger`, NOT NULL)
       - `response_body` (`postgresql.JSONB(astext_type=sa.Text())`, NOT NULL)
       - `created_at` (`DateTime(timezone=True)`, NOT NULL, `server_default=sa.text("now()")`)
       - `expires_at` (`DateTime(timezone=True)`, NOT NULL)
       - Unique constraint `uq_idempotency_keys_scope` on `(actor_user_id, endpoint_key, idempotency_key)`.
       - Index `ix_idempotency_keys_expires_at` on `(expires_at)` for 24h TTL cleanup.
       - Runtime grant: `GRANT SELECT, INSERT, UPDATE, DELETE ON idempotency_keys TO kalyan_app;` and `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kalyan_app;` (`DELETE` granted strictly on ephemeral `idempotency_keys` for 24h TTL cleanup; clinical/financial tables remain append-only).
    2. Add `token_reset_policy` column (`String(24)`, NOT NULL, `server_default=sa.text("'DAILY'")`) to `clinic_settings` with bare-named CheckConstraint `"token_reset_policy_valid"` (`token_reset_policy IN ('DAILY')`, matching `env.py`'s `ck_<table>_` convention).
    3. Add `cancellation_reason` column (`String(500)`, nullable) to `pending_opd_arrivals`.
    4. Implement fail-closed `downgrade()`: refuse to drop `pending_opd_arrivals.cancellation_reason` if any row has a non-null `cancellation_reason`; revoke `kalyan_app` grants on `idempotency_keys` and drop table/columns cleanly when safe.
  - Update `backend/src/kalyan_api/models.py` with `IdempotencyKey` ORM model (matching `sa.Identity(always=False)`, `JSONB`, `server_default=sa.text("now()")`), `ClinicSettings.token_reset_policy` (`server_default=sa.text("'DAILY'")`), and `PendingOpdArrival.cancellation_reason`.
  - Update `RUNTIME_TABLE_GRANTS` in `backend/src/kalyan_api/services/backup_service.py` (`L310-361`) to register `"idempotency_keys": ("SELECT", "INSERT", "UPDATE", "DELETE")` so restore grants cover every `public` table (`test_restore_grants_cover_every_table`).
- **validation**:
  - `alembic upgrade head` succeeds cleanly on a fresh database and on a `0037` database.
  - `pytest backend/tests/test_migrations.py backend/tests/test_restore_grants_and_locks.py` passes (including `test_migrations_match_models` and `test_restore_grants_cover_every_table`).
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T2: Backend Service Concurrency, Token High-Water Mark & Lifecycle Fixes
- **depends_on**: `[]`
- **location**: `backend/src/kalyan_api/services/token_service.py`, `backend/src/kalyan_api/services/appointment_service.py`, `backend/src/kalyan_api/services/booking_service.py`
- **description**:
  - **`token_service.py`**: Update `generate_next_daily_token` so `highest_used` checks the maximum of BOTH `Appointment.token_number` AND `PendingOpdArrival.token_number` for `(doctor_id, appointment_date)` while holding the `DailyTokenSequence` `FOR UPDATE` row lock.
  - **`appointment_service.py`**: Add `AppointmentStatus.COMPLETED: ConsultationStatus.COMPLETED` to `_STATUS_TO_CONSULTATION` (`L394-398`) so canonical `COMPLETED` aligns with `DONE`.
  - **`booking_service.py`**:
    1. In `reassign_waiting` (`L515`), allow `AppointmentStatus.WAITING` alongside `(AppointmentStatus.ARRIVED, AppointmentStatus.CHECKED_IN)`.
    2. In `reassign_waiting` (`L543-565`), call `session.get(Patient, appt.patient_id, with_for_update=True)` **before** `lock_doctor_for_booking` so lock acquisition order is strictly `Appointment → Patient → Doctor → Department → DailyTokenSequence` (closing the concurrent duplicate booking race window and preventing lock-order deadlocks).
    3. In `check_in`, accept optional `expected_patient_id: int | None = None`; when provided and `appt.patient_id != expected_patient_id`, raise `ApiError(status_code=422, code="patient_appointment_mismatch", message="Appointment does not belong to the selected patient")`.
- **validation**:
  - `pytest backend/tests/test_token_concurrency.py backend/tests/test_token_counter_drift.py backend/tests/test_reception_state_rules.py backend/tests/test_reception_checkin_api.py` passes.
  - Lock ordering verified strictly `Appointment → Patient → Doctor → Department → DailyTokenSequence` across `create_booking`, `check_in`, and `reassign_waiting`.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T3: Frontend API Client Timeout, `Idempotency-Key` Header & LAN-Safe UUID Helper
- **depends_on**: `[]`
- **location**: `frontend/src/api/client.ts`
- **description**:
  - Extend **`ApiFetchOptions`** (`client.ts:13`) with:
    - `timeoutMs?: number` (default `15000` ms for normal requests; `0` disables timeout for long uploads/exports).
    - `idempotencyKey?: string` — when provided, attaches the `Idempotency-Key` request header.
  - Compose caller `signal` with an internal timeout `AbortController` so caller aborts (e.g. TanStack Query cancellation) propagate cleanly while timeouts raise a typed `ApiError` (`status: 0`, `code: 'request_timeout'`, `isTimeout: true` — distinguishable from caller abort) so mutation UIs know when to preserve `Idempotency-Key` for safe retry.
  - Export `createIdempotencyKey(): string` using `crypto.randomUUID()` when available and falling back to a `crypto.getRandomValues` RFC-4122 v4 UUID generator (essential for non-HTTPS offline LAN HTTP origins where `window.isSecureContext === false`).
- **validation**:
  - `npm run typecheck` and `npx vitest run src/api/__tests__/client.test.ts` pass in `frontend/`.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T4: Extract Shared `ReassignModal` with Double-Submit Guard
- **depends_on**: `[]`
- **location**: `frontend/src/components/checkin/ReassignModal.tsx`, `frontend/src/pages/WaitingRoom.tsx`
- **description**:
  - Extract `ReassignDialog` from `WaitingRoom.tsx:626-785` into a standalone reusable component `frontend/src/components/checkin/ReassignModal.tsx`.
  - Add a synchronous `inFlightRef = useRef(false)` guard in the submit handler, releasing `inFlightRef.current = false` inside `onSettled` (or switching `reassign.mutate` to `mutateAsync` with `try/finally`) to prevent double-click / double-Enter duplicate POSTs before React re-renders `isPending`.
  - Disable all inputs/selects, submit button, AND the `"Keep with current doctor"` cancel button (`L767`) while `reassign.isPending`, preserving `dismiss="none"`, active-doctor filtering (excluding current doctor), `useDoctorDepartments` check + retry, ≥3-char reason validation with explicit disabled-reason helper text, and 409 conflict handling.
  - Update `WaitingRoom.tsx` to import and render `ReassignModal` with zero behavioral regression.
- **validation**:
  - `npm run typecheck` and `npx vitest run src/pages/__tests__/waiting-room.test.tsx` pass in `frontend/`.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T5: `PriorityModal` Double-Submit Guard & Disabled-Reason UX
- **depends_on**: `[]`
- **location**: `frontend/src/components/checkin/PriorityModal.tsx`
- **description**:
  - Add a synchronous `inFlightRef = useRef(false)` guard in the submit handler (`L51`), cleared in `finally` / `onSettled`.
  - Disable submit button when a non-`NORMAL` priority is selected and `reason.trim().length < 3` (`L151`), and display clear inline helper text explaining why submit is disabled (`"Enter a reason (at least 3 characters) to set Priority or Emergency"`).
  - Disable radio/select inputs and reason textarea while `busy` (`isPending`).
- **validation**:
  - `npm run typecheck` and `npm run lint` pass in `frontend/`.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T6: Backend Idempotency Service (`idempotency_service.py`)
- **depends_on**: `[T1]`
- **location**: `backend/src/kalyan_api/services/idempotency_service.py`
- **description**:
  - Implement atomic, PostgreSQL-backed idempotency helpers for mutation routes:
    - `extract_idempotency_key(request: Request) -> str | None`: reads `Idempotency-Key` header; if absent, returns `None` (backward-compatible); if present, validates trimmed length `8..128` printable ASCII characters, raising `422 invalid_idempotency_key` if malformed.
    - `hash_payload(payload: BaseModel | dict[str, Any]) -> str`: deterministic SHA-256 hex digest over canonical JSON of `payload.model_dump(mode="json")` (`json.dumps(..., sort_keys=True, separators=(",", ":"))`).
    - `begin_idempotent_request(session, *, actor_user_id: int, endpoint_key: str, idempotency_key: str, request_hash: str) -> tuple[int, dict[str, Any]] | None`:
      1. Acquires a PostgreSQL transaction-scoped advisory lock `pg_advisory_xact_lock(hashtextextended(:lock_key, 0))` on `f"{actor_user_id}:{endpoint_key}:{idempotency_key}"` so simultaneous identical retries serialize cleanly and wait for the first transaction to commit (and automatically release on rollback if request 1 fails).
      2. Runs contention-free opportunistic 24h TTL cleanup using:
         `DELETE FROM idempotency_keys WHERE id IN (SELECT id FROM idempotency_keys WHERE expires_at < now() LIMIT 50 FOR UPDATE SKIP LOCKED)`
         plus deletes any expired row matching the current `(actor_user_id, endpoint_key, idempotency_key)` scope.
      3. Looks up `(actor_user_id, endpoint_key, idempotency_key)`:
         - If found and `request_hash != existing.request_hash`: raise `ApiError(status_code=422, code="idempotency_key_payload_mismatch", message="Idempotency-Key was already used with a different request payload")`.
         - If found and hashes match: return `(existing.response_status, existing.response_body)` for immediate exact replay.
         - If not found: return `None` (caller executes mutation).
    - `store_idempotent_response(session, *, actor_user_id: int, endpoint_key: str, idempotency_key: str, request_hash: str, response_status: int, response_body: dict[str, Any], ttl_hours: int = 24) -> None`: inserts `IdempotencyKey` row into the **same active DB transaction** (called only for `2xx` responses, followed by `session.flush()` — committed atomically by `SessionDep` on handler return).
- **validation**:
  - Module imports cleanly and passes full unit/integration coverage in `T15`.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T7: OPD Arrival Cancellation Reason & Priority Audit Completeness
- **depends_on**: `[T1]`
- **location**: `backend/src/kalyan_api/services/opd_arrival_service.py`
- **description**:
  - In `cancel_arrival` (`L208`), write cancellation reason to `arrival.cancellation_reason = reason` instead of overwriting `arrival.priority_reason`; include `cancellation_reason` (and preserve `priority_reason`) in `OPD_ARRIVAL_CANCELLED` audit `before_data` / `after_data`.
  - In `update_arrival_priority` (`L268-277`), include `priority_reason` in both `before_data` and `after_data` of `OPD_ARRIVAL_PRIORITY_CHANGED`.
- **validation**:
  - `pytest backend/tests/test_opd_arrivals.py -k "not cancel"` passes cleanly (the API-layer `cancel` assertion on `L292` asserting the old `priority_reason` overwrite is updated in `T12` once `OpdArrivalRead` exposes `cancellation_reason`).
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T8: ClinicSettings `token_reset_policy` API & Reception Overview Live Doctor Load Fix
- **depends_on**: `[T1]`
- **location**: `backend/src/kalyan_api/schemas/settings.py`, `backend/src/kalyan_api/routers/settings.py`, `backend/src/kalyan_api/routers/areas.py`
- **description**:
  - **`schemas/settings.py`**: Add `token_reset_policy: str` to `ClinicSettingsOut`, and optional `token_reset_policy: str | None = Field(default=None, pattern=r"^DAILY$")` to `ClinicSettingsUpdate` (optional default `None` preserves existing full-replace clients).
  - **`routers/settings.py`**: Add `"token_reset_policy"` to `_SETTINGS_AUDIT_FIELDS` and apply `if payload.token_reset_policy is not None: settings.token_reset_policy = payload.token_reset_policy` inside the audited update transaction.
  - **`routers/areas.py`**: In `DoctorTodayOut` & `_doctors_today` (`L55-68, L268-345`):
    1. Populate `DoctorTodayOut.department` from the doctor's primary active `Department.name_en` (falling back to `Doctor.qualification` only if unmapped) instead of hardcoding `"Physiotherapy"` (`L341`).
    2. Add an explicit field **`pending_arrivals: int = 0`** on `DoctorTodayOut` counting today's active (`status == 'TO_ARRIVE'`) `PendingOpdArrival` rows per doctor, while keeping existing `appointments_today` and `waiting` counts strictly appointment-based so `test_admin_overview.py:248, 254` remains 100% backward-compatible.
- **validation**:
  - `pytest backend/tests/test_clinic_settings.py backend/tests/test_reception_overview.py backend/tests/test_admin_overview.py` passes.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T9: Backend Appointment & OPD Arrival Schema Extensions
- **depends_on**: `[T1, T2]`
- **location**: `backend/src/kalyan_api/schemas/appointments.py`, `backend/src/kalyan_api/schemas/opd_arrivals.py`
- **description**:
  - **`schemas/appointments.py`**:
    - Add optional `patient_id: int | None = None` to `CheckInRequest` (`L115-119`) for patient↔appointment verification on check-in.
    - Extend `AppointmentListResponse` (`L253-257`) while preserving **`appointments: list[AppointmentRead]`** (do NOT rename to `items`!) and `total: int`:
      - `limit: int = 500`
      - `offset: int = 0`
      - `bucket_counts: dict[str, int] | None = None` (server-computed counts across all matching rows for the date, doctor & search filter: `to_arrive`, `checked_in`, `completed`, `no_show`, `cancelled`, `rescheduled`, `active`, `all`).
  - **`schemas/opd_arrivals.py`**:
    - Expose `cancellation_reason: str | None = None` on **`OpdArrivalRead`** (`L58`).
- **validation**:
  - `pytest backend/tests/test_appointment_booking.py` passes.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T10: Frontend Types, AbortSignal Forwarding, Pagination Params & Complete Query Invalidations
- **depends_on**: `[T3]`
- **location**: `frontend/src/api/types.ts`, `frontend/src/api/queries.ts`
- **description**:
  - **`types.ts`** (using exact existing interface names):
    - Add optional `patient_id?: number` to **`CheckInRequest`** (`L1073`).
    - Add `limit?: number`, `offset?: number`, `bucket_counts?: Record<string, number> | null` to `AppointmentListResponse` (preserving `appointments: Appointment[]` and `total: number`).
    - Add `cancellation_reason?: string | null` to `OpdArrival` (`L1023`), `token_reset_policy?: string` to **`ClinicSettingsOut`** (`L501`), and `pending_arrivals?: number` to `DoctorTodayOut` (`L58`).
  - **`queries.ts`** (using exact existing hook & queryKey names, preserving backward-compatible mutation arg shapes for `AppointmentBookingModal.tsx`, `PatientRegister.tsx`, and `session-dialogs.test.tsx`):
    - Add optional `enabled?: boolean` to **`useOverview`** (`L243`) options so `CreateOpdTokenModal` can call `useOverview<ReceptionOverview>('reception', { enabled: open && isReception })` without triggering 403 for non-reception roles.
    - Forward TanStack Query `{ signal }` into `apiFetch` for `usePatients` (`L908`), `useCheckDuplicate` (`L828`), `useAppointments` (`L1084`), and `useOpdArrivals` (`L1095`) to cancel/ignore stale in-flight searches.
    - Add optional `limit?: number`, `offset?: number`, `statusBucket?: string`, `sortBy?: 'token' | 'time'`, and `search?: string` params to `useAppointments` (included in queryKey & query string; existing callers omit them cleanly).
    - Add optional `doctorId?: number` filter param to `useOpdArrivals` (`L1091`, included in queryKey & `doctor_id` query param).
    - Thread optional `idempotencyKey?: string` through **`useCheckIn`**, **`useWalkIn`**, **`useCheckInNewPatient`** (`L1222`), **`useBookAppointment`** (`L1175`), and **`useCreateOpdArrival`** (`L1109`) — destructuring `idempotencyKey` out before passing the JSON `body` to `apiFetch(..., { body, idempotencyKey })` so Pydantic `extra="forbid"` schemas never see an unknown key and existing callers require zero edits.
    - Fix incomplete query invalidations (using exact key **`['overview', 'reception']`**, NOT `['reception-overview']`!):
      - `useWalkIn` (`L1192-1204`): also invalidate `['visit-bill']`, `['patient-summary']`, `['patient-visits']`, `['timeline']`, `['overview', 'reception']` and call `qc.setQueryData(['appointment', data.id], data)`.
      - `useCheckIn` (`L1284-1298`): also invalidate `['patient-summary']`, `['patient-visits']`, `['timeline']`, `['overview', 'reception']`.
      - `useRegisterOpdArrival` (`L1121-1135`): also invalidate `['visits']`, `['visit-bill']`, `['overview', 'reception']`.
      - Verify `useReassignAppointment`, `useUpdatePriority`, and `useUpdateAppointmentStatus` invalidate `['appointments']`, `['overview', 'reception']`, `['doctor-queue']`, `['visits']`, and `['visit-bill']` as applicable.
- **validation**:
  - `npm run typecheck` and `npx vitest run src/api/__tests__/queries-body.test.ts` pass in `frontend/`.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T11: Appointments Router — Idempotency, Patient Verification, Validation Fix, Pagination/Sort/Search & Audit
- **depends_on**: `[T2, T6, T9]`
- **location**: `backend/src/kalyan_api/routers/appointments.py`
- **description**:
  - **Idempotency (`Idempotency-Key`)**: Wire `idempotency_service` (`extract_idempotency_key`, `hash_payload`, `begin_idempotent_request`, `store_idempotent_response`) into:
    1. `POST /appointments` (`"POST:/appointments"`)
    2. `POST /appointments/walk-in` (`"POST:/appointments/walk-in"`)
    3. `POST /appointments/walk-in/new-patient` (`"POST:/appointments/walk-in/new-patient"`)
    4. `POST /appointments/{appointment_id}/check-in` (`f"POST:/appointments/{appointment_id}/check-in"`)
    Return `JSONResponse(status_code=replayed_status, content=replayed_body)` on exact replay; store `response_body=result_schema.model_dump(mode="json")` followed by **`session.flush()`** (NOT `session.commit()` — `SessionDep` auto-commits atomically on handler return).
  - **Patient ↔ Appointment Verification**: In `POST /appointments/{appointment_id}/check-in`, pass `expected_patient_id=payload.patient_id` into `booking_service.check_in`.
  - **Fix `walk-in/new-patient` (`to_arrive=True`) Validation Bypass (`L312-335`)**: Lock and validate `doctor.is_active`, `department.is_active`, and `department in doctor.departments` (matching `booking_service.create_booking` checks) before creating the patient & appointment.
  - **Pagination, Deterministic Ordering, Search & Server-Side Bucket Counts on `GET /appointments` (`L613-656`)**:
    - Accept `limit: int = Query(default=500, ge=1, le=500)` (default `500` prevents silent truncation in `WaitingRoom.tsx`, `ReceptionDashboard.tsx`, `VisitCheckout.tsx`; `AppointmentsReception.tsx` explicitly passes `limit=100`), `offset: int = Query(default=0, ge=0)`, `status_bucket: str | None = Query(default=None)` (`active`, `to_arrive`, `checked_in`, `completed`, `no_show`, `cancelled`, `all`), `sort_by: Literal["token", "time"] = Query(default="token")`, and `search: str | None = Query(default=None)` (case-insensitive filter across patient name / URN / mobile / doctor name).
    - Apply deterministic `ORDER BY` tie-breakers so un-checked-in (`NULL` token) rows never jump pages across `OFFSET`:
      - `sort_by == "token"`: `(Appointment.appointment_date.desc(), Appointment.token_number.asc().nulls_last(), Appointment.expected_time.asc().nulls_last(), Appointment.id.asc())`
      - `sort_by == "time"`: `(Appointment.appointment_date.desc(), Appointment.expected_time.asc().nulls_last(), Appointment.token_number.asc().nulls_last(), Appointment.id.asc())`
    - Compute exact `bucket_counts` over the date + doctor + `search` scope BEFORE applying `status_bucket` + `offset`/`limit`, then compute `total` for the active `status_bucket` before slicing, returning `AppointmentListResponse(appointments=..., total=..., limit=..., offset=..., bucket_counts=...)`.
  - **Audit Hardening**:
    1. On `PATCH /appointments/{appointment_id}/status` (`L733, L774`), include `consultation_status` in `before_data` and `after_data`.
    2. On BOTH `POST /appointments/walk-in` (`L265-281`) AND `POST /appointments/walk-in/new-patient` (`L347`): record `_record_booking_created` with the pre-check-in `BOOKED` snapshot (`status="BOOKED"`, `token_number=None`, `consultation_status=None` — either via explicit snapshot override parameter on `_record_booking_created` or by calling `create_booking` → `_record_booking_created` → `check_in` directly) so `APPOINTMENT_CREATED` records the initial booking and `APPOINTMENT_CHECKED_IN` records `BOOKED → ARRIVED` + token.
- **validation**:
  - `pytest backend/tests/test_appointment_booking.py backend/tests/test_appointment_status.py backend/tests/test_reception_checkin_api.py backend/tests/test_reception_state_rules.py` passes.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T12: OPD Arrivals Router — Idempotency, `doctor_id` Filter, Pagination & `test_opd_arrivals.py` Update
- **depends_on**: `[T6, T7, T9]`
- **location**: `backend/src/kalyan_api/routers/opd_arrivals.py`, `backend/tests/test_opd_arrivals.py`
- **description**:
  - Wire `idempotency_service` (`Idempotency-Key` header) into `POST /opd-arrivals` (`endpoint_key="POST:/opd-arrivals"`), storing `response_body=result_schema.model_dump(mode="json")` followed by `session.flush()` (committed atomically by `SessionDep`) and replaying exact `201` + JSON on retries.
  - Update `_to_read_schema` (`routers/opd_arrivals.py:28-47`) to pass `cancellation_reason=arrival.cancellation_reason`.
  - Update `GET /opd-arrivals` (`L50-60`) to accept optional `doctor_id: int | None = Query(default=None)`, `limit: int = Query(default=500, ge=1, le=500)`, and `offset: int = Query(default=0, ge=0)`, computing `total` via `COUNT(*)` **before** applying `offset`/`limit` (fixes `total=len(arrivals)`).
  - Update `backend/tests/test_opd_arrivals.py` (`L292`) to assert `cancelled["cancellation_reason"] == "Patient decided to leave"` and verify `priority_reason` is preserved unchanged.
- **validation**:
  - `pytest backend/tests/test_opd_arrivals.py` passes with zero failures.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T13: `CreateOpdTokenModal` Full Hardening (Mode Clarity, Doctor Load, Confirmation, Idempotency & Busy Lock)
- **depends_on**: `[T10]`
- **location**: `frontend/src/components/checkin/CreateOpdTokenModal.tsx`
- **description**:
  - **State Preservation on Mode Switch (`L441-445`)**: Preserve all entered form info when switching `New patient` ↔ `Existing patient`, including carrying `booking.doctor_id` / `booking.department_id` into `doctorKey` when unlinking a pre-selected booking so the selected doctor is never unexpectedly wiped.
  - **Explicit Mode Visual Distinction (`L666-674`, `L914-931`)**:
    - Render a clear mode badge & distinct modal header/CTA for all three flows:
      1. **Walk-in Check-in** (`Walk-in Check-in` badge, `"Check in Walk-in & Issue Token"`)
      2. **Appointment Check-in** (`Booked Check-in` badge, `"Check in Appointment & Issue Token"`)
      3. **Advance Booking** (`Advance Booking` badge, `"Book Appointment"`)
  - **Doctor Availability & Live Queue Load**:
    - Consume **`useOverview<ReceptionOverview>('reception', { enabled: open && isReception })`** (`doctors_today`) alongside `useConsultingDoctors()` to display each active doctor's live queue load (`Waiting: waiting + pending_arrivals · In Cabin: in_consultation`) and active status badge in the doctor selector/summary; clearly flag inactive/unavailable doctors without inventing scheduling schemas.
  - **Patient-Specific Existing Appointments (Today & Future) + Active Queue Warning**:
    - Query patient-specific appointments with `patientId: selectedPatient.id` for the **selected `appointmentDate`** (and for `today` if checking today's active queue on a different date) instead of scanning an unbounded day list client-side — never truncated by pagination!
    - Remove the `!isBookingOnly` gate so future-date existing bookings warn pre-submit.
    - Upgrade the active queue banner to highlight **same-doctor conflicts** prominently and show exact status (`Waiting`, `In Cabin`, `Completed`).
  - **Explicit Disabled-Submit Reasons (`L471-503, L1172-1177`)**:
    - Render clear inline disabled explanation when `!canSubmit` (permission restriction) in addition to `Still needed: ...` missing fields.
  - **Confirm Selected Doctor Before Issuing Token**:
    - Add a lightweight inline confirmation bar inside the modal footer (no second stacked modal): first click reveals a highlighted summary box showing **Patient**, **Consulting Doctor**, **Department**, **Consultation Fee**, **Priority**, and **Action** (`Walk-in Check-in` / `Appointment Check-in` / `Advance Booking`) with **`Confirm & Issue Token`** + **`Edit`**. Any form field change automatically resets confirmation.
  - **Duplicate Check-In, Concurrency & Timeout Retry Safety**:
    - Add synchronous `inFlightRef` guard in `handleSubmit`.
    - Maintain `pendingIdempotencyKeyRef` generated via `createIdempotencyKey()` per user intent: preserved verbatim across timeout/network retries (showing a clear safe-retry banner), cleared on any form input edit, success, or definitive 4xx domain error.
    - Send `patient_id: booking.patient_id` on `CheckInRequest`.
    - On `409` / existing active token conflict, clearly display the existing active token and invalidate/refetch appointments & overview immediately.
  - **Complete Busy Lock & Debounced Duplicate Check**:
    - Disable `Clear form`, `<Link>` escape hatches (`SelectedPatientCard` & advance-booking links), mode toggle, and form inputs whenever `busy === true`.
    - Debounce `useCheckDuplicate` query inputs by `250ms`.
- **validation**:
  - `npm run typecheck` and `npm run lint` pass in `frontend/`.
  - All scenarios verified in `T16` and `T17`.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T14: `AppointmentsReception.tsx` — Canonical Filter Bar, 8-Column Table, Sort, Banners, Reassign & Pagination
- **depends_on**: `[T4, T10]`
- **location**: `frontend/src/pages/AppointmentsReception.tsx`
- **description**:
  - **Eliminate Status Filter Duplication & Fix Count Math (`L50-133, L961-994, L1235-1275`)**:
    - Remove the duplicate `To Arrive` / `Checked In` / `Completed` / `No-show` counter chips from the top toolbar.
    - Implement a single pure row classifier producing mutually exclusive buckets (`to_arrive`, `checked_in`, `completed`, `no_show`, `cancelled`, `rescheduled`) and render the single authoritative filter pill bar: `Active`, `To Arrive`, `Checked In`, `Completed`, `No-Show`, `Cancelled`, `All`.
    - Combine server `bucket_counts` with `pendingArrivals` counts for **`selectedDate`** (not hardcoded `today`) so pill counts stay 100% accurate across pagination and date views, strictly satisfying `Active === To Arrive + Checked In`, with `NO_SHOW` excluded from `To Arrive` and `DONE`/`COMPLETED` excluded from `Checked In`.
    - In `RowActions` (`L363-378`), explicitly keep same-day `"Check in"` enabled when `(bucket === 'to_arrive' || appt.status === 'NO_SHOW')` (preserving Policy #2 and same-day `NO_SHOW` recovery!).
    - In `arrivalAsAppointment` (`L91`), map `cancellation_reason: arrival.cancellation_reason ?? null`.
  - **8-Column Operational Table + Sort Toggle (`L1007-1014, L1290, L1311-1427`)**:
    - Render exact 8 columns: `Token`, `Time`, `Patient`, `Department`, `Doctor`, `Status`, `Priority` (**`<PriorityBadge level={...} showNormal />`**), `Action`.
    - Update loading skeleton to `columns={8}`.
    - Add a clean sort toggle control: **Sort by Token number** vs **Sort by Appointment time** (passed to server `sortBy: 'token' | 'time'` so sorting works accurately across pages, with matching local ordering for merged page-1 `pendingArrivals`).
  - **Wire `ReassignModal` & Harden `RescheduleModal` (`L322-587`)**:
    - Add `"Transfer doctor"` action to `RowActions` `More` menu strictly gated on: `isReception && canCheckIn && !pendingArrival && !cancelled && ['ARRIVED', 'CHECKED_IN', 'WAITING'].includes(appt.status) && appt.consultation_status === 'WAITING'`, opening shared `<ReassignModal>`.
    - Add synchronous `inFlightRef` guard in `RescheduleModal` (`L556`) and disable inputs while `busy`.
  - **Date-Context Banners & Context-Aware Empty States (`L1296-1305`)**:
    - Display an unmistakable **Historical Date** banner when `selectedDate < today` and **Future Date** banner when `selectedDate > today`, each with a one-click **`Return to Today`** button.
    - Context-aware empty states:
      - Today: `"No appointments or walk-ins for today"` + **`Create OPD Token`** CTA (if permitted).
      - Future: `"No appointments booked for this date"` + **`Book Appointment`** CTA.
      - Historical: `"No appointments recorded for this past date"` with **NO** `"Create OPD Token"` button (only `"Return to Today"`).
  - **Error Retry & Workspace Offline/LAN Banner (`L1278-1292`)**:
    - Wrap appointments error and pending-arrivals error in `role="alert"` banners with explicit **`Retry`** buttons triggering `refetch()`.
    - Reuse existing **`useHealth(15000)`** (`frontend/src/api/health.ts` — shared `['health']` cache with `AppShell`'s `LANStatusPill`, zero duplicate polling, exposes `refetch()`) combined with `navigator.onLine` (`online`/`offline` events) to render a workspace-level **Offline / Server-Disconnected Banner** with a safe **`Retry Connection`** button (`health.refetch()`).
  - **Pagination & Merged `PendingOpdArrival` Accounting**:
    - Pass `limit: 100`, `offset`, `statusBucket`, `sortBy`, and debounced `search` to `useAppointments`, and `doctorId` to `useOpdArrivals(selectedDate, ...)`.
    - Merge matching `pendingArrivals` rows into the table **only when `offset === 0`** (never duplicating them on page 2+) and display clear pagination text (`Showing X–Y of Z appointments` + `(+ N pending walk-in registrations)` on page 1 when `N > 0`), resetting `offset` to `0` on date/doctor/filter/sort/search changes.
  - **Safe URL Param Cleanup (`L689, L729-742`)**:
    - Convert `selectTab` and `clearDeepLinkParams` to functional `setSearchParams((prev) => ...)` updaters so unrelated query params are preserved.
- **validation**:
  - `npm run typecheck` and `npm run lint` pass in `frontend/`.
  - All UI behaviors verified in `T17`.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T15: OpenAPI Snapshot Sync & Backend Hardening Test Suite
- **depends_on**: `[T8, T11, T12]`
- **location**: `backend/tests/openapi.snapshot.json`, `backend/tests/test_appointments_hardening.py`
- **description**:
  - Update `backend/tests/openapi.snapshot.json` to match new schema fields (`CheckInRequest.patient_id`, `AppointmentListResponse` pagination/bucket_counts, `OpdArrivalRead.cancellation_reason`, `ClinicSettingsOut.token_reset_policy`, `DoctorTodayOut.pending_arrivals`, pagination/sort/search/doctor_id query params on `GET /appointments` and `GET /opd-arrivals`).
  - Create comprehensive `backend/tests/test_appointments_hardening.py` testing:
    1. **Lifecycle Policies**: `CANCELLED` check-in → `422`; same-day `NO_SHOW` check-in allowed for Reception, blocked wrong-day (`422`) and on duplicate active booking (`409`); `DONE`/`COMPLETED` reopen rejected (`422`); `PATCH /{id}/status` accepts canonical `COMPLETED`; `reassign_waiting` works for `WAITING`, preserves burnt token on `CANCELLED` source, voids original charge, allocates target doctor's new token on same `visit_id`, and rejects concurrent duplicate via `Patient` lock.
    2. **Idempotency (`Idempotency-Key`)**: exact replay (same status + body, zero duplicate rows/tokens/bills) across all 5 endpoints (`/check-in`, `/walk-in`, `/walk-in/new-patient`, `POST /appointments`, `POST /opd-arrivals`, including `/walk-in` with `override_reason`); mismatched payload with same key → `422 idempotency_key_payload_mismatch`; malformed key → `422`; actor isolation (user B's key does not replay user A); expired key (>24h) cleaned up and accepted as new; failed/rolled-back request 1 does not cache error and allows retry; concurrent duplicate requests serialize cleanly without duplicates.
    3. **Patient↔Appointment Verification & Validation Fix**: `check-in` with wrong `patient_id` → `422 patient_appointment_mismatch`; `walk-in/new-patient` with `to_arrive=True` rejects inactive doctor, inactive department, and unlinked doctor-department.
    4. **Doctor-Wise Tokens & Reset Policy**: `highest_used` respects `PendingOpdArrival.token_number` above `DailyTokenSequence.last_token`; parallel doctor sequences stay independent; `ClinicSettings.token_reset_policy` defaults to `DAILY` and audits updates; `DoctorTodayOut.pending_arrivals` reflects active pending arrivals without breaking `waiting`/`appointments_today`.
    5. **Pagination, Sort, Search & Bucket Counts**: `GET /appointments?limit=2&offset=1&sort_by=time&search=...` returns deterministic pages + full `total` + accurate `bucket_counts`, rejects `limit > 500`; `GET /opd-arrivals?doctor_id=...&limit=1&offset=0` computes `total` before slicing.
    6. **Audit Hardening**: `PATCH /{id}/status` logs `consultation_status` before/after; `cancel_arrival` preserves `priority_reason` and records `cancellation_reason`; `update_arrival_priority` logs `priority_reason` before/after; both `walk-in` AND `walk-in/new-patient` log `BOOKED` (no token) in `APPOINTMENT_CREATED`.
- **validation**:
  - `pytest backend/tests/test_openapi_snapshot.py backend/tests/test_migrations.py backend/tests/test_appointments_hardening.py` passes with zero failures or skips.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T16: Frontend API Client & Modal Hardening Tests
- **depends_on**: `[T5, T13]`
- **location**: `frontend/src/api/__tests__/client.test.ts`, `frontend/src/pages/__tests__/token-generation.test.tsx`
- **description**:
  - Expand `frontend/src/api/__tests__/client.test.ts`:
    - Verify `timeoutMs` aborts stalled requests with typed timeout error (`isTimeout`), external `signal` cancellation works cleanly, `Idempotency-Key` header is attached when provided, and `createIdempotencyKey()` works both with and without `crypto.randomUUID`.
  - Update and expand `frontend/src/pages/__tests__/token-generation.test.tsx` (adding `/api/reception/overview` mock and driving the inline doctor confirmation step):
    - Verify mode switch (`New patient` ↔ `Existing patient`) preserves fields including `doctorKey` when unlinking a booking.
    - Verify Walk-in Check-in vs Booked Check-in vs Advance Booking badges, headers, and submit labels.
    - Verify doctor availability & live queue load rendering from `useOverview('reception')` (and verify non-reception roles do NOT call `/api/reception/overview`).
    - Verify patient-specific future-date existing-booking warning AND same-doctor active queue conflict warning with exact queue state.
    - Verify inline disabled reasons for missing fields, `!canSubmit`, and `PriorityModal` reason `< 3` chars.
    - Verify inline doctor confirmation step (shows doctor, dept, fee, priority, action; resets on field edit; fires mutation only on confirm).
    - Verify `inFlightRef` prevents duplicate POSTs on rapid double-click, stable `Idempotency-Key` is reused on timeout retry and rotated after input edit, `AbortSignal` cancels stale patient search, `useCheckDuplicate` is debounced (250ms), and `Clear form` + links are disabled while `busy`.
- **validation**:
  - `npx vitest run src/api/__tests__/client.test.ts src/pages/__tests__/token-generation.test.tsx` passes in `frontend/`.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T17: Frontend Appointments Reception & Waiting Room Hardening Tests
- **depends_on**: `[T4, T13, T14]`
- **location**: `frontend/src/pages/__tests__/appointments-reception.test.tsx`, `frontend/src/pages/__tests__/waiting-room.test.tsx`
- **description**:
  - Update and expand `frontend/src/pages/__tests__/appointments-reception.test.tsx` (adding `/api/reception/overview` + `/api/health` mocks and updating `CreateOpdTokenModal` flows at `L798, L888` for the inline doctor confirmation step):
    - Verify zero duplicate status counts between top toolbar and filter pills.
    - Verify mutually exclusive filter pill math: `Active === To Arrive + Checked In`; `NO_SHOW` excluded from `To Arrive` while keeping same-day `"Check in"` CTA working; `COMPLETED`/`DONE` excluded from `Checked In`; dedicated `Completed` and `No-Show` pills work accurately.
    - Verify all 8 columns (`Token`, `Time`, `Patient`, `Department`, `Doctor`, `Status`, `Priority` with `Normal` visible via `PriorityBadge level=... showNormal`, `Action`) and `columns={8}` loading skeleton.
    - Verify sort toggle between **Token number** and **Appointment time**.
    - Verify `"Transfer doctor"` in `More` menu opens shared `ReassignModal` only when strictly eligible and calls `POST /appointments/{id}/reassign`.
    - Verify Historical & Future date banners, `Return to Today` button, and context-aware empty states (no `"Create OPD Token"` on past dates; `"Book Appointment"` on future dates).
    - Verify `role="alert"` error banners with working **Retry** buttons for both appointments and arrivals, plus workspace **Offline / Server-disconnected** banner from `useHealth(15000)` + `navigator.onLine`.
    - Verify pagination bar (`Showing X–Y of Z`, Prev/Next) when `total > pageSize` and verify `pendingArrivals` render only on `offset === 0` without duplication on page 2.
    - Verify `selectTab` and `clearDeepLinkParams` preserve unrelated URL query params.
  - Run & verify `frontend/src/pages/__tests__/waiting-room.test.tsx` with extracted `ReassignModal` (including `inFlightRef` guard and disabled `"Keep with current doctor"` button while pending).
- **validation**:
  - `npx vitest run src/pages/__tests__/appointments-reception.test.tsx src/pages/__tests__/waiting-room.test.tsx` passes in `frontend/`.
- **status**: Not Completed
- **log**:
- **files edited/created**:

### T18: Full Regression Gate, Static Guards & Manual LAN/Print QA Verification
- **depends_on**: `[T15, T16, T17]`
- **location**: Verification-only across `backend/` and `frontend/` (no new feature edits)
- **description**:
  - Execute full automated backend regression suite, frontend typecheck/lint/guards/tests, and manual offline-LAN & physical print-preview QA checklist (detailed under **Testing Strategy** below).
  - Verify all 7 Definition of Done criteria (`AGENTS.md`): frontend interaction, API behavior, DB persistence, related module updates (Waiting Room, Doctor Queue, Visit Billing), RBAC authorization, reload persistence, and zero regressions.
- **validation**:
  - Backend: `pytest` exits `0` (all existing + new hardening tests pass).
  - Frontend: `npm run typecheck` (`tsc -b`), `npm run lint` (`oxlint`), `npx vitest run src/test/guards/guards.test.ts` (cap = `0`), and `npm test` all exit `0`.
  - Manual print-preview and LAN disconnect/retry checklist completed with recorded evidence.
- **status**: Not Completed
- **log**:
- **files edited/created**:

---

## Parallel Execution Groups

| Wave | Tasks | Exclusive File Scope (Zero Overlap Verified) | Can Start When |
|---|---|---|---|
| **1** | `T1`, `T2`, `T3`, `T4`, `T5` | `T1`: `0038_appointments_hardening.py`, `models.py`, `backup_service.py`<br>`T2`: `token_service.py`, `appointment_service.py`, `booking_service.py`<br>`T3`: `frontend/src/api/client.ts`<br>`T4`: `ReassignModal.tsx`, `WaitingRoom.tsx`<br>`T5`: `PriorityModal.tsx` | Immediately (after git checkpoint) |
| **2** | `T6`, `T7`, `T8`, `T9`, `T10` | `T6`: `idempotency_service.py`<br>`T7`: `opd_arrival_service.py`<br>`T8`: `schemas/settings.py`, `routers/settings.py`, `routers/areas.py`<br>`T9`: `schemas/appointments.py`, `schemas/opd_arrivals.py`<br>`T10`: `frontend/src/api/types.ts`, `frontend/src/api/queries.ts` | Wave 1 dependencies complete (`T6/T7/T8` need `T1`; `T9` needs `T1+T2`; `T10` needs `T3`) |
| **3** | `T11`, `T12`, `T13`, `T14` | `T11`: `routers/appointments.py`<br>`T12`: `routers/opd_arrivals.py`, `test_opd_arrivals.py`<br>`T13`: `CreateOpdTokenModal.tsx`<br>`T14`: `AppointmentsReception.tsx` | Wave 2 dependencies complete (`T11` needs `T2+T6+T9`; `T12` needs `T6+T7+T9`; `T13` needs `T10`; `T14` needs `T4+T10`) |
| **4** | `T15`, `T16`, `T17` | `T15`: `openapi.snapshot.json`, `test_appointments_hardening.py`<br>`T16`: `client.test.ts`, `token-generation.test.tsx`<br>`T17`: `appointments-reception.test.tsx`, `waiting-room.test.tsx` | Wave 3 dependencies complete (`T15` needs `T8+T11+T12`; `T16` needs `T5+T13`; `T17` needs `T4+T13+T14`) |
| **5** | `T18` | Read-only verification gate | Wave 4 complete (`T15`, `T16`, `T17`) |

---

## Testing Strategy

### 1. Backend Automated Verification
```powershell
# Targeted migration, restore-grants, OpenAPI contract, concurrency & hardening tests
pytest backend/tests/test_migrations.py `
       backend/tests/test_restore_grants_and_locks.py `
       backend/tests/test_openapi_snapshot.py `
       backend/tests/test_appointments_hardening.py `
       backend/tests/test_token_concurrency.py `
       backend/tests/test_token_counter_drift.py `
       backend/tests/test_reception_state_rules.py `
       backend/tests/test_reception_checkin_api.py `
       backend/tests/test_opd_arrivals.py `
       backend/tests/test_clinic_settings.py `
       backend/tests/test_reception_overview.py `
       backend/tests/test_admin_overview.py `
       backend/tests/test_rbac_matrix.py

# Full backend regression suite
pytest backend/tests
```

### 2. Frontend Automated Verification & Strict Static Guards
```powershell
cd frontend
npm run typecheck                                        # strict tsc -b
npm run lint                                             # oxlint
npx vitest run src/test/guards/guards.test.ts            # static guard cap = 0
npx vitest run src/api/__tests__/client.test.ts `
               src/api/__tests__/queries-body.test.ts `
               src/pages/__tests__/token-generation.test.tsx `
               src/pages/__tests__/appointments-reception.test.tsx `
               src/pages/__tests__/waiting-room.test.tsx
npm test                                                 # full vitest suite
```

### 3. Manual LAN-Disconnect & Print-Preview QA Checklist (`T18`)
1. **LAN Disconnect / Timeout Retry Verification**:
   - Open Appointments page on a Reception session; confirm workspace Offline / Server-disconnected banner (`useHealth(15000)` + `navigator.onLine`) appears when backend is paused/disconnected and clears on **`Retry Connection`**.
   - Start a Walk-in Check-in, trigger network drop / timeout after DB commit (or via DevTools offline toggle right before response), click **Retry** without editing inputs, and confirm:
     - Same `Idempotency-Key` is replayed.
     - Exact original token number is displayed.
     - Database contains **1** appointment, **1** token, and **1** consultation charge (zero duplicates).
2. **Physical / Browser Print-Preview Verification**:
   - Issue a walk-in token and a reassigned doctor token; open OPD token slip / patient card print preview in Chrome (`Ctrl+P` / Print button).
   - Confirm doctor-specific token number, cabin label, department name, patient URN, and priority badge render cleanly with zero clipping or missing Devanagari/English glyphs, and confirm cancelled/reassigned original tokens never print as active.
3. **Reload & Cross-Module Verification**:
   - Reload `/appointments` after check-in, doctor transfer, priority change, no-show (including same-day no-show recovery check-in), and pagination; confirm counts (`Active === To Arrive + Checked In`), Waiting Room queue, Doctor Queue ordering, and Visit Billing lines all reflect authoritative PostgreSQL state.

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **`crypto.randomUUID()` unavailable on non-HTTPS LAN HTTP workstations** | Frontend crashes when generating `Idempotency-Key` on `http://192.168.x.x` | `T3` implements `createIdempotencyKey()` with a `crypto.getRandomValues` RFC-4122 v4 UUID fallback. |
| **Concurrent duplicate POSTs racing before first commit writes `idempotency_keys`** | Two simultaneous retries could bypass a naive `SELECT` check and create duplicate tokens/bills | `T6` acquires `pg_advisory_xact_lock` keyed on `(actor_user_id, endpoint_key, idempotency_key)` before lookup/insert, serializing concurrent identical retries and releasing automatically on rollback; expired cleanup uses `FOR UPDATE SKIP LOCKED`. |
| **Deadlock between `create_booking` and `reassign_waiting` row locks** | Occasional 500/serialization failures under heavy multi-desk load | `T2` locks `Patient` (`FOR UPDATE`) **before** `lock_doctor_for_booking` so lock order is strictly `Appointment → Patient → Doctor → Department → DailyTokenSequence`. |
| **Pagination truncating other callers or breaking search/sort/merged arrivals** | Missing waiting-room patients, jumping rows across `OFFSET`, or duplicated `PendingOpdArrival` rows on page 2 | `T11`/`T12` default `limit=500` (max `500`), add server-side `search`, `sort_by` with deterministic `(expected_time, id)` tie-breakers, `bucket_counts`, and `doctor_id` on `GET /opd-arrivals`; `T13` queries by `patient_id`; `T14` requests `limit=100` and merges `pendingArrivals` only on `offset === 0`. |
| **Alembic autogenerate drift or missing `kalyan_app` restore grants** | `test_migrations.py` (`alembic.command.check`, `test_restore_grants_cover_every_table`) fails | `T1` uses `sa.Identity(always=False)`, matching `JSONB`/`sa.text(...)` defaults, and registers `idempotency_keys` in `RUNTIME_TABLE_GRANTS` (`backup_service.py`). |
| **Same-day `NO_SHOW` check-in CTA lost when excluded from `To Arrive` pill** | Violates Policy #2 and breaks `appointments-reception.test.tsx:798` | `T14` explicitly allows `(bucket === 'to_arrive' || appt.status === 'NO_SHOW')` for same-day `"Check in"` in `RowActions`. |
| **Accidental weakening of `kalyan_app` least-privilege DB posture** | Runtime role gains broader DELETE access | `T1` grants `DELETE` exclusively on ephemeral `idempotency_keys` (24h TTL cleanup), never on clinical, patient, or financial tables. |

---

## Open Decisions for User Confirmation

Before executing Wave 1, three lightweight product preferences can be confirmed (recommended defaults are already baked into the plan above):

1. **Doctor Confirmation UX inside `CreateOpdTokenModal` (`T13`)**:
   - **Option A (Recommended — in plan)**: Lightweight **inline confirmation bar** inside the modal footer (1st click reveals Patient + Doctor + Department + Fee + Priority + Action summary with `Confirm & Issue Token` / `Edit`). Fast for high-volume reception desks, zero modal stacking.
   - **Option B**: Separate second confirmation modal dialog on top of `CreateOpdTokenModal`.

2. **`Active` Filter Pill Scope (`T14`)**:
   - **Option A (Recommended — in plan)**: `Active` = `To Arrive + Checked In` (current open operational workload, excluding `Completed`, `No-Show`, `Cancelled`, `Rescheduled`), guaranteeing exact math `Active === To Arrive + Checked In`.
   - **Option B**: `Active` = `To Arrive + Checked In + Completed` (all non-cancelled/non-no-show appointments for the day).

3. **Token Reset Policy Modes in `ClinicSettings` (`T1`, `T8`)**:
   - **Option A (Recommended — in plan)**: Enforce **`'DAILY'`** (automatic IST midnight reset per doctor) as the sole active policy in `ClinicSettings.token_reset_policy` so no unrequested reset behavior is invented while keeping the policy explicit and auditable.
   - **Option B**: Also support additional configurable reset cycles (e.g. `'MONTHLY'` or `'CONTINUOUS'`) — requires explicit hospital policy sign-off before adding alternate sequence keying.
