# Kalyan Hospital — Multi-Agent Task Board & File Ownership

## Task Board & Execution Dependencies

| Task ID | Agent Role | Execution Mode | Scope & File Ownership | Dependency | Output Artifact | Status |
|---|---|---|---|---|---|---|
| **T00** | Primary Orchestrator | Single Coordinator | Entire repository; Governance & Baseline | None | `PROJECT_STATUS.md`, `AGENTS.md` | **COMPLETED** |
| **T01** | Architecture Auditor | Read-Only | Repository layout, dependencies, startup, packaging | T00 | `audits/01-architecture.md`, `SYSTEM_ARCHITECTURE.md` | Ready to Run |
| **T02** | Frontend Auditor | Read-Only | `frontend/src/**`, UI routes, components, state | T00 | `audits/02-frontend.md`, `FUNCTIONALITY_AUDIT.md` | Ready to Run |
| **T03** | Backend Auditor | Read-Only | `backend/src/kalyan_api/routers/**`, services | T00 | `audits/03-backend.md`, `API_INVENTORY.md` | Ready to Run |
| **T04** | Database Auditor | Read-Only | `backend/src/kalyan_api/models.py`, `migrations/**` | T00 | `audits/04-database.md`, `DATABASE_RELATIONSHIPS.md` | Ready to Run |
| **T05** | Workflow Auditor | Read-Only | End-to-end lifecycles (Reception → Doctor → Billing) | T00 | `audits/05-workflows.md`, `PROCESS_DEPENDENCY_MAP.md` | Ready to Run |
| **T06** | Security Auditor | Read-Only | Auth, permissions, session management, LAN offline | T00 | `audits/06-security.md` | Ready to Run |
| **T07** | Primary Orchestrator | Single Coordinator | Issue consolidation, deduplication, prioritization | T01–T06 | `BUG_REGISTER.md`, Repair Plan | Pending Audits |
| **T08** | Database Worker | Controlled Writer | `backend/src/kalyan_api/models.py`, `migrations/**` | T07 | Verified Schema / Migrations | Blocked by T07 |
| **T09** | Backend Worker | Controlled Writer | `backend/src/kalyan_api/services/**`, routers | T07, T08 | Verified Backend Endpoints | Blocked by T08 |
| **T10** | Frontend Worker | Controlled Writer | `frontend/src/**` (excluding shared contracts) | T07, T09 | Verified UI & Form Submissions | Blocked by T09 |
| **T11** | Integration Worker | Controlled Writer | Cross-module synchronization & event flows | T08–T10 | Real-time Queue & Billing Sync | Blocked by T10 |
| **T12** | Test Automation Worker | Controlled Writer | `frontend/src/**/__tests__/**`, `backend/tests/**` | T07 | Regression Test Suite | Blocked by T07 |
| **T13** | Independent Critic | Read-Only Review | Review pull requests / repair diffs | T08–T12 | Architecture & Correctness Review | Blocked by Repairs |
| **T14** | Adversarial Challenger | Test Execution | Edge-case, race conditions, concurrency tests | T08–T12 | Stress Test Log | Blocked by Repairs |
| **T15** | Evidence Auditor | Verification | Independent verification of test outputs | T13, T14 | `END_TO_END_TEST_RESULTS.md` | Blocked by T14 |
| **T16** | Success Auditor | Gate Authority | Final release gate check & offline validation | All Gates | `RELEASE_READINESS_REPORT.md` | Blocked by T15 |

---

## File Ownership Rules
1. **Parallel Audits (T01–T06)**: Read-only access across the entire repository. May ONLY write to their respective file in `docs/engineering/audits/`.
2. **Implementation (T08–T12)**: Strictly serialized single active writer. No concurrent edits on shared files (`frontend/src/router.tsx`, `frontend/src/admin/modules.ts`, `backend/src/kalyan_api/models.py`, `backend/src/kalyan_api/main.py`).
3. **Rollback Baseline**: Every implementation step must start with clean Git state verification.

