# Project Agent Directives — Kalyan Hospital Management System

This document specifies operational guidance, domain invariants, and verification protocols for autonomous coding agents (including Kimi Code, Antigravity, Claude Code, and Codex) operating within `d:\dr-sr`.

---

## 1. Project Identity & Architecture
- **System:** Kalyan Hospital Patient & Physiotherapy Management System (v3.0 LAN Web Platform).
- **Core Value:** Reliable, internet-independent shared patient records across hospital LAN workstations (Reception, Doctor, Admin) with server-side RBAC, tamper-evident audit history, and verified backup/restore.
- **Backend:** `backend/src/` (FastAPI 0.162.0 + synchronous SQLAlchemy 2.0.55 + PostgreSQL 18.6).
- **Frontend:** `frontend/src/` (React 19.3.1 + TypeScript 5.x + Vite 8.3.5 + Tailwind CSS).
- **Deployment & Infra:** `deploy/` (PowerShell auto-recovery, Windows scheduled tasks, print services).
- **State of Record:** `.planning/` directory contains active milestone and phase state (`STATE.md`, `ROADMAP.md`).

---

## 2. Specialized Agent Dispatch Mapping

When tackling sub-problems, dispatch or follow guidelines corresponding to the specialized agent profiles available under `.kimi-code/agents/` and `.agents/agents/`:

| Subsystem / Task | Specialized Agent | Key Mandate |
| :--- | :--- | :--- |
| **Backend REST & Auth** | `fastapi-reviewer`, `python-reviewer` | Synchronous SQLAlchemy patterns, Pydantic validation, Argon2id auth, CSRF checks |
| **Frontend UI & Components** | `react-reviewer`, `typescript-reviewer` | React 19 hooks, strict typing, optimistic locking, high-contrast accessible layouts |
| **Database & Migrations** | `database-reviewer` | PostgreSQL schema integrity, gap-free URN sequences, tamper-prevention DB triggers |
| **Clinical & Healthcare Rules** | `healthcare-reviewer`, `a11y-architect` | ABDM/NRCeS compliance, doctor queue isolation, VAS scores, Hindi bilingual rendering |
| **Security & RBAC** | `security-reviewer` | 339-cell RBAC verification, credential redaction in logs, input sanitization |
| **Testing & Verification** | `tdd-guide`, `e2e-runner` | Pytest suite (>90% coverage), Vitest assertions, clean machine acceptance drill |

---

## 3. Non-Negotiable Domain Invariants

1. **Integer Paise Financials:** Never use floating-point types (`float`, `number`) for monetary storage or calculations. All currency values are stored as integer paise.
2. **Immutable Encounters & Sessions:** Finalized clinical consultations (`CLN-02`) and physiotherapy sessions (`TRT-03`) are protected by PostgreSQL triggers against UPDATE/DELETE. Corrections must be append-only dated addenda.
3. **Gap-Free URN Generation (`PAT-01`):** Patient registration URN format `KH-YYYY-XXXX` is atomic and collision-free under concurrent multi-user registration.
4. **Server-Side Authorization:** Every protected endpoint must validate role permissions (`Admin`, `Doctor`, `Reception`) at the handler level. UI hiding is purely ergonomic.
5. **No Silent Error Swallowing:** All exceptions must be explicitly handled, logged to the append-only audit trail, and surfaced with structured error models.

---

## 4. Standard Agent Verification Protocol

Before completing any task or declaring work ready:
1. **Backend Verification:**
   ```powershell
   pytest backend/tests/ -v
   ruff check backend/src/
   ```
2. **Frontend Verification:**
   ```powershell
   cd frontend
   npm test
   npm run build
   ```
3. **Git Hygiene:** Maintain clean, atomic commits aligned with GSD phase goals and verification criteria.

