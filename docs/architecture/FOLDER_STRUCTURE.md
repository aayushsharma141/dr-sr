# Kalyan Hospital — Architectural Standard & Folder Structure

**Version**: 1.0.0  
**Status**: ACTIVE / FROZEN STANDARD  
**Applies to**: Full Kalyan Hospital Offline LAN Stack (`frontend/`, `backend/`, `docs/`, `scripts/`)

---

## 1. Executive Summary & Purpose

Kalyan Hospital is an offline-first, local area network (LAN) hospital management system designed for continuous 24/7 clinical and administrative workflows without reliance on internet connectivity.

This document establishes the **authoritative architectural standard** and **folder structure** for the codebase. It reconciles the existing monolithic codebase with a clean, feature-modular target architecture. Rather than executing a high-risk full rewrite, the project enforces a **gradual, non-disruptive migration policy**: new capabilities (beginning with the Doctor Workspace Dashboard) adopt the modular feature structure, while proven existing consultation, billing, and reception engines are preserved and wrapped without regression.

---

## 2. The 5-Minute Mental Model

```text
d:\dr-sr/
├── frontend/                     # React 19 + TypeScript + Vite + Tailwind 4 SPA
│   └── src/
│       ├── features/             # Feature-packaged modules (domain-driven)
│       │   └── dashboard/doctor/ # Doctor Workspace Dashboard module
│       ├── components/           # Reusable shared UI primitives (buttons, modals, tables)
│       ├── pages/                # Route entry points & legacy workspace pages
│       ├── api/                  # Global API client, endpoints, and response types
│       └── auth/                 # Authentication, token storage, and session context
│
├── backend/                      # FastAPI + SQLAlchemy 2 + Alembic + Python 3.12
│   └── src/kalyan_api/
│       ├── routers/              # HTTP API route endpoints & RBAC permission checks
│       ├── schemas/              # Pydantic validation schemas & DTOs
│       ├── services/             # Business logic & domain transactions
│       ├── db/                   # Database engine, session lifecycle, guards, startup
│       ├── core/                 # Config, security, JWT auth, exceptions
│       ├── models.py             # Authoritative SQLAlchemy declarative database models
│       └── migrations/           # Alembic database schema migrations
│
├── database/                     # Operational database assets
│   ├── migrations/               # Alembic version scripts (backend/src/kalyan_api/migrations)
│   ├── seeds/                    # Reproducible dev and staging fixtures (backend/scripts/seed_dev_data.py)
│   └── backups/                  # Encrypted local snapshot archives (backend/var/backups/)
│
└── docs/                         # Project documentation repository
    ├── architecture/             # System design, folder standards, RFCs
    ├── workflows/                # Clinical OPD, queue, and billing operational flows
    ├── database/                 # Schema dictionaries and relationship diagrams
    └── user-guides/              # Desk manuals for Reception, Doctor, and Admin roles
```

---

## 3. Layer-by-Layer Architectural Standards

### 3.1 Frontend (`frontend/src/`)

The frontend is transitioning from a flat page-based structure to a **feature-modular** architecture:

- **`features/<domain>/<subdomain>/`**:
  Each business feature is self-contained. It groups UI components, state logic, and API calls:
  ```text
  frontend/src/features/dashboard/doctor/
  ├── DoctorDashboard.tsx             # Root feature coordinator & layout
  ├── dashboard-service.ts            # TanStack Query hooks & API fetchers
  └── components/                     # Feature-private UI components
      ├── SummaryCards.tsx            # Workload status metrics (Waiting, In Consult, etc.)
      ├── LiveQueue.tsx               # Doctor patient queue with token circles & triage
      ├── TodaysSchedule.tsx          # Pre-booked appointments schedule
      ├── UnfinishedConsultations.tsx # Resumable encounter drafts
      ├── TodayGlance.tsx             # Offline SVG consultation breakdown chart
      ├── RecentTreatmentPlans.tsx    # Rehabilitation/treatment session progress
      ├── QuickActions.tsx            # Fast navigation actions
      └── NewConsultationModal.tsx    # Modal to initiate encounter for queued patient
  ```
- **`components/`**: Feature-agnostic, reusable UI design system elements (e.g., `Button`, `Modal`, `Input`, `StatusBadge`, `ErrorBoundary`, `Toast`). If a component does not contain domain-specific business rules, it belongs here.
- **`pages/`**: Primary route endpoints mapped by React Router (e.g., `ReceptionDashboard.tsx`, `VisitWorkspacePage.tsx`, `ClinicalEncounterWorkspace.tsx`). Pages act as thin route wrappers that render feature components or preserved legacy modules.
- **`api/`**: Shared Axios/fetch client configuration, global error interceptors, and generic pagination/envelope typings.
- **`auth/`**: Authentication state machine, role-based authorization guards (`RoleRouteGuard`), login token storage, and session lifecycle.

### 3.2 Backend (`backend/src/kalyan_api/`)

The backend follows a strict separation of concerns:

- **`routers/`**: Transport and protocol layer.
  - Declares HTTP methods, URL paths, path/query parameters, and HTTP response codes.
  - Enforces role-based access control (RBAC) via `Permission` dependencies and principal checks.
  - Validates request payloads using Pydantic schemas.
  - Delegates all business calculations, entity modifications, and database operations to services.
- **`schemas/`**: Data Transfer Objects (DTOs).
  - Explicit Pydantic models for request bodies, query filters, and response payloads.
  - Strict serialization rules; prevents leaky internal database columns from exposing to clients.
- **`services/`**: Domain and business logic layer.
  - Contains all hospital workflow rules (queue progression, encounter finalization, fee accumulation).
  - Executes database transactions (`Session.commit()`, `Session.rollback()`).
  - Ensures atomicity: multiple table mutations happen inside a single transaction.
- **`db/`**: Database infrastructure.
  - `session.py`: Thread-safe database engine creation and scoped session factory.
  - `guards.py`: Offline integrity guards, foreign key checks, and connection verification.
  - `startup.py`: Initialization hooks executed on Uvicorn application boot.
- **`core/`**: Cross-cutting utilities.
  - Application settings (`config.py`), password hashing, JWT creation/validation, and custom API exception classes (`ApiError`).
- **`models.py`**: The authoritative declarative SQLAlchemy 2 models mapping to PostgreSQL tables.

### 3.3 Database Operations & Assets

- **Migrations** (`backend/src/kalyan_api/migrations/versions/`):
  - Every schema modification must be tracked via a deterministic Alembic migration script.
  - Migrations must be bidirectional (implementing both `upgrade()` and `downgrade()`).
  - Never execute manual ad-hoc DDL against the local production database.
- **Seeds** (`backend/scripts/` and `scripts/`):
  - `seed_dev_data.py`: Generates standardized mock doctors, reception staff, test patients, and appointment queues for local development.
  - `seed_uat_staging.py`: Populates clean testing data for User Acceptance Testing and release qualification.
- **Backups** (`backend/var/backups/`):
  - Managed by `backend/src/kalyan_api/services/backup_service.py` and scheduled by `backup_schedule_service.py`.
  - Compressed `.tar.gz` bundles containing PostgreSQL dump and runtime assets.
  - Guaranteed pre-migration and scheduled snapshot generation.

### 3.4 Documentation Structure (`docs/`)

- **`docs/architecture/`**: Structural designs, folder conventions, ADRs (Architectural Decision Records), and technology stack standards.
- **`docs/workflows/`**: Formal workflow specifications mapping real hospital interactions (e.g., Patient Registration $\rightarrow$ Token Generation $\rightarrow$ Doctor Queue $\rightarrow$ Clinical Encounter $\rightarrow$ Billing $\rightarrow$ Receipt Printing).
- **`docs/database/`**: Entity-relationship documentation, column dictionaries, and integrity constraint catalogs.
- **`docs/user-guides/`**: Role-tailored operator manuals for hospital staff (Receptionist Guide, Doctor Workspace Guide, System Admin Manual).

---

## 4. The 5 Rules to Keep the Project Clean

### Rule 1: One Feature, One Folder
Every self-contained workflow or functional domain lives within its own designated directory under `features/<feature-name>/`. All components, hooks, local state utilities, and API service functions that are only used by that feature reside inside that folder. When that feature is deleted or refactored, the entire folder can be manipulated without leaving orphaned files scattered across the codebase.

### Rule 2: Share, Don't Duplicate
Code duplication is prohibited. When a UI element or business logic utility is required by two or more independent features:
- **UI Component**: Promote it to `frontend/src/components/` after stripping out feature-specific business assumptions.
- **Business Logic / Calculation**: Extract it into a reusable helper in `backend/src/kalyan_api/services/` or a shared utility in `frontend/src/api/` or `frontend/src/format.ts`.
- If only one feature uses it, keep it private to that feature. Do not create premature shared abstractions.

### Rule 3: Don't Over-Engineer (No Empty Folders)
Do not create speculative files or directories for "future" requirements. Every folder must contain active, functioning code and accompanying tests. Avoid nested abstraction layers that simply pass arguments through without adding value. If a task requires one component file and one service file, create exactly those two files.

### Rule 4: UI is Not Business Logic
Frontend React components must focus strictly on presentation, user interactions, accessibility, and visual feedback.
- **Calculations & Validation**: Domain rules (e.g., patient queue ordering, fee calculation, session deductions, encounter state transitions) are enforced by the backend service layer.
- **Client Transformations**: Data fetching, caching, and serialization logic are encapsulated inside feature service hooks (e.g., TanStack Query hooks in `dashboard-service.ts`), never embedded directly in JSX render trees.

### Rule 5: Preserve Existing Work (Gradual Migration)
Never execute arbitrary full rewrites of working production modules. Existing workflows (such as Reception Desk, Billing & Invoicing, Prescriptions, and 3-Zone Consultation Workspace) represent verified, working software:
- Coexist new feature structures alongside existing modules.
- Ensure all historical test suites (e.g., `doctor-kanban-dashboard.test.tsx`, `doctor-workspace.test.tsx`, `reception-flow.test.tsx`) remain green during and after introducing new features.
- Deprecate and replace modules only through deliberate, tested, and approved incremental steps.

---

## 5. Offline LAN Invariants & Non-Negotiables

Kalyan Hospital operates in an offline hospital campus environment. All systems must comply with these architectural guarantees:

1. **Central Authoritative Local Database**:
   - The primary database server runs locally on the on-premise hospital server (`PostgreSQL 16`).
   - All workstations (Reception PCs, Doctor OPD laptops, Admin desks) communicate over the local subnet (LAN) with the central server.
   - There are no remote cloud synchronizers or split-brain local databases. The central database is the single source of truth.

2. **Zero External CDN Dependencies**:
   - All third-party JavaScript libraries, CSS stylesheets, UI icons (`@tabler/icons-react`), and fonts must be bundled and distributed locally by Vite.
   - No `<link>` or `<script>` tags targeting external CDNs (e.g., unpkg, cdnjs, Google Fonts) are permitted.
   - Applications must load and render completely in an isolated network environment with physical WAN disconnect.

3. **100% Offline Operational Capability**:
   - Daily patient care—registration, token issue, consultation queue, clinical diagnosis, prescription writing, treatment session tracking, billing, and receipt printing—must function flawlessly without an internet connection.
   - External internet access is treated strictly as an optional administrative channel (e.g., offsite encrypted backup replication).

4. **Network Resilience & Reload Persistence**:
   - Client network transient drops on the local Wi-Fi/Ethernet must not crash client applications. TanStack Query is configured with `placeholderData: keepPreviousData` and cached states.
   - Browser reloads must retain session context via persisted local tokens. Active clinical encounter drafts must persist in the central database or structured drafts to prevent data loss.

5. **Hospital Business Invariants (`AGENTS.md`)**:
   - **Single Patient URN**: Exactly one permanent URN per patient across all hospital departments.
   - **Doctor Queue Isolation**: Each doctor operates an independent consultation queue. Doctors can only see and manage patients assigned to their department/roster.
   - **Billing Exclusivity**: Reception owns all payment collection and invoice creation. Doctors cannot collect cash, create bills, or modify financial ledgers.
   - **Physiotherapy & Treatment Invariants**: Treatment plan sessions are deducted only upon documented clinical completion of the procedure.
   - **Auditability**: Financial records, payment history, and completed clinical encounters are immutable and must never be overwritten or deleted.

---

## 6. Verification & Quality Checklist

Before integrating any new feature or module into the codebase, verify against this checklist:

- [ ] Does the new feature live in its own dedicated directory (`frontend/src/features/<feature>/`)?
- [ ] Are all UI assets and dependencies locally bundled with zero external network requests?
- [ ] Do backend endpoints enforce strict RBAC permissions and prevent data leaks (e.g., guarding `doctor_id is None`)?
- [ ] Are existing test suites untouched and passing with zero regressions?
- [ ] Does the UI cleanly delegate state and API operations to a dedicated service layer?
- [ ] Is the module fully operational on a disconnected offline LAN?
