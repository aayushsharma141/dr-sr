---
name: session-state-sync
description: Activates automatically at the start of any new conversation, chat, or session to ground the agent across the repository's core knowledge base (brain/, DECISIONS.md, PRD.md, SECURITY.md, TASKS.md, GEMINI.md, COLD-PATHS.md, ENV-CONTRACTS.md, docs/). Enforces strict adherence to system invariants, clinical requirements, and architectural contracts, while triggering instant real-time synchronization of all relatable tracking files whenever progress occurs.
---

# Session State & Repository Knowledge Base Synchronization

This skill ensures **zero context loss, zero architectural regression, and total knowledge persistence** across conversation resets, new chats, and autonomous development loops. The agent treats the repository's structured documentation and knowledge base as the durable Single Source of Truth (SSOT), strictly honoring system invariants and updating relatable files **instantly** without deferring.

---

## 1. Source-of-Truth Hierarchy & Precedence

When analyzing behavior, resolving conflicts, or planning implementations, always consult documents in this strict order:

```
┌────────────────────────────────────────────────────────────────────────┐
│ 1. Current Source Code & Tests (Executable Authority)                  │
│    (What actually executes, validates, and passes in CI)               │
├────────────────────────────────────────────────────────────────────────┤
│ 2. .planning/STATE.md & .planning/ROADMAP.md                           │
│    (Current phase status, execution wave, blockers, next action)       │
├────────────────────────────────────────────────────────────────────────┤
│ 3. brain/ Directory (Durable Engineering Knowledge Base)               │
│    (System invariants, threat model, permission policies, decisions)   │
├────────────────────────────────────────────────────────────────────────┤
│ 4. Formal Contract Documents                                           │
│    (DECISIONS.md, PRD.md, SECURITY.md, COLD-PATHS.md, ENV-CONTRACTS.md)│
├────────────────────────────────────────────────────────────────────────┤
│ 5. Operational Specifications & Deep Context                           │
│    (TASKS.md, GEMINI.md, and docs/ remediation blueprints)             │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Document Context Matrix: Use Cases & Inspection Triggers

### 2.1 `brain/` — The Core Engineering Knowledge Base
The `brain/` directory records stable engineering context, architectural guardrails, and project memory:
- **`brain/architecture/invariants.md` (System Invariants):**
  - *When to use:* **Mandatory check before altering ANY system behavior.**
  - *Core Guardrails:* Centralized LAN operation (no cloud dependency); PostgreSQL dual-role access (`kalyan_app` DML vs `kalyan_owner` DDL); private server-side photo storage; immutable finalized clinical records (addenda only); transactional integer paise calculations.
- **`brain/architecture/system-overview.md`:**
  - *When to use:* When reviewing system boundaries, network topology (single port 8000), SPA serving, or database connection pooling.
- **`brain/security/permission-policy.md` & `threat-model.md`:**
  - *When to use:* When touching routes, roles, authorization gates, or authentication tokens.
  - *Core Guardrail:* Doctor data isolation is currently a **strict doctor silo** (doctors see only their assigned patients/records); any relaxation requires explicit client approval.
- **`brain/decisions/approved-decisions.md` vs `open-questions.md`:**
  - *When to use:* Before choosing clinical or financial policies.
  - *Core Guardrail:* Never guess on open policy questions (e.g. cross-doctor read, financial reversal authority, thermal print model). Check `open-questions.md` first.
- **`brain/changes/current-state.md` & `changelog.md`:**
  - *When to use:* To review known functional gaps, pending acceptance gates, and durable version history.

### 2.2 `DECISIONS.md` — Architectural Decision Records (ADRs)
- *When to use:* Architectural design, framework integration, database selection, or role boundaries.
- *Active Baseline:* ADR-14 through ADR-22 (Centralized LAN, PostgreSQL, FastAPI + React SPA, one-time admin setup wizard, immutable addenda, integer paise, database + files backup bundles).
- *Open Decisions (OD-01 to OD-11):* Tracks client approval status for hardware UPS, doctor visibility, reversal authority, and receipt resets.

### 2.3 `PRD.md` — Product Requirements Document
- *When to use:* Clinical workflow modeling, form field schemas, and business validation rules.
- *Key Requirements:* 12-field patient registration, clinical encounters, physiotherapy packages, treatment sessions, VAS pain scale scoring (0–10), dual doctor signatures, thermal receipt printing, and billing ledgers.

### 2.4 `SECURITY.md` — Security Architecture & RBAC
- *When to use:* User management, session lifecycle, password policies, and role permission matrices.
- *Key Requirements:* NIST SP 800-63B compliant password policies (minimum 10 chars, Argon2id hashing), sliding 30-minute session idle timeout (12h absolute ceiling), CSRF same-origin enforcement on unsafe HTTP methods, and immutable tamper-evident audit logs.

### 2.5 `COLD-PATHS.md` — Invariant Paths & Frozen Subsystems
- *When to use:* Before modifying any established module or executing refactoring.
- *Key Requirements:* Identifies frozen, high-risk code paths (first-run setup bootstrap, CLI database recovery, scheduled backup engines, Alembic migration chains). Never alter cold paths without explicit task scope.

### 2.6 `ENV-CONTRACTS.md` — Environment Variable Specifications
- *When to use:* When inspecting, declaring, or referencing configuration variables.
- *Key Requirements:* Complete registry of all 37 variables across backend, frontend, test fixtures, and CI/CD. Enforces `KALYAN_` prefix, strict password validation, and safe defaults.

### 2.7 `TASKS.md` & `.planning/` — Roadmap & Phase Execution
- *When to use:* Determining what to build next, checking plan dependencies, and breaking work into atomic steps.
- *Key Requirements:* Single source of truth for phase plans (01-PLAN.md, etc.), wave execution dependencies, and acceptance test criteria.

### 2.8 `GEMINI.md` — CLI Operating Context & GSD Workflows
- *When to use:* When running GSD commands (`/gsd-progress`, `/gsd-plan-phase`, `/gsd-execute-phase`, `/gsd-verify-work`, `/gsd-ship`).
- *Key Requirements:* Sets the GSD Core context-engineering baseline, ensuring atomic test-backed commits and version-tracked execution.

### 2.9 `docs/` — Clinical Blueprints, Forms & Remediation Plans
- *When to use:* Validating UI layouts, form fields, and past UX/navigation audits.
- *Key Documents:*
  - `docs/Kalyan_Hospital_Registration_Form.docx` (The authentic paper registration form).
  - `docs/ADMIN-NAVIGATION-REMEDIATION.md` & `ADMIN-UI-UX-REMEDIATION.md` (SSOT navigation and layout rules).
  - `docs/BACKEND-TEST-REMEDIATION.md` (Test harness, pytest session fixtures, database safety guards).
  - `docs/plans/` (Phase-specific planning artifacts and design contracts).

---

## 3. The 3-Step Journey Protocol

### Step 1: Conversation Initialization (Grounding)
At the start of **any** conversation or prompt:
1. **Inspect Git Context:**
   ```powershell
   git branch --show-current
   git status -s
   ```
2. **Read Active Position:**
   - Open `.planning/STATE.md` to identify current milestone, active phase, blockers, and `next_action`.
   - Cross-check with `.planning/ROADMAP.md` and `TASKS.md`.
3. **Verify Safety Boundaries:**
   - Scan `brain/architecture/invariants.md` and `COLD-PATHS.md` to ensure planned actions do not violate invariants or frozen code paths.
   - Scan `DECISIONS.md` to ensure no open policy questions are silently assumed.

### Step 2: Implementation & Clinical Validation
When writing code or designing schemas:
1. Cross-reference clinical fields with `PRD.md` and `docs/Kalyan_Hospital_Registration_Form.docx`.
2. Check authorization rules against `brain/security/permission-policy.md` and `SECURITY.md`.
3. Adhere strictly to the "Lazy Senior Dev" (Ponytail) rule: the smallest change that completely solves the task, zero unnecessary wrappers or bloat, and assertions/tests for all non-trivial logic.

### Step 3: Instant Relatable File Updates (Real-Time Synchronization)
Do **not** defer updating tracking documents. Update relatable files **in the exact turn the change occurs**:

| Event / Action Taken | Relatable Document to Update Instantly |
| :--- | :--- |
| Task or sub-plan completed | [`.planning/STATE.md`](file:///d:/dr-sr/.planning/STATE.md) (Update status, progress %, completed items, next focus) |
| Phase or milestone transition | [`.planning/ROADMAP.md`](file:///d:/dr-sr/.planning/ROADMAP.md) & [`TASKS.md`](file:///d:/dr-sr/TASKS.md) (Update checkbox, date, commit) |
| System invariant or boundary established | [`brain/architecture/invariants.md`](file:///d:/dr-sr/brain/architecture/invariants.md) & [`COLD-PATHS.md`](file:///d:/dr-sr/COLD-PATHS.md) |
| Architectural / clinical policy decided | [`brain/decisions/approved-decisions.md`](file:///d:/dr-sr/brain/decisions/approved-decisions.md) & [`DECISIONS.md`](file:///d:/dr-sr/DECISIONS.md) |
| Unresolved policy or gap discovered | [`brain/decisions/open-questions.md`](file:///d:/dr-sr/brain/decisions/open-questions.md) |
| Environment variable added or tuned | [`ENV-CONTRACTS.md`](file:///d:/dr-sr/ENV-CONTRACTS.md) |
| Requirement fulfilled or verified | [`.planning/REQUIREMENTS.md`](file:///d:/dr-sr/.planning/REQUIREMENTS.md) |
| Significant release or milestone closed | [`brain/changes/changelog.md`](file:///d:/dr-sr/brain/changes/changelog.md) & [`brain/changes/current-state.md`](file:///d:/dr-sr/brain/changes/current-state.md) |

---

## 4. Agent Self-Check Checklist

Before completing any turn:
- [ ] Did I ground myself in `.planning/STATE.md` and `brain/architecture/invariants.md`?
- [ ] Did I respect the strict doctor silo and security policies in `SECURITY.md` and `brain/security/`?
- [ ] Did I avoid modifying frozen cold paths in `COLD-PATHS.md`?
- [ ] Did I update all relatable tracking files (`STATE.md`, `ROADMAP.md`, `ENV-CONTRACTS.md`, etc.) immediately?
- [ ] Is disk state fully aligned with what was discussed and executed?
