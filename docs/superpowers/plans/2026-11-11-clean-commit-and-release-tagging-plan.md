# Clean Commit & Release Tagging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cleanly stage, test-verify, and commit all pending changes in the Kalyan Hospital repository into structured, atomic Conventional Commits, realign the branch away from the obsolete `switch/node-lan` name, and tag a verified milestone release with an annotated semantic version tag.

**Architecture:** A 5-task workflow: (1) fix working-tree syntax errors to guarantee 100% build and test pass, (2) commit pending work into 5 logical slices (UI fixes, repo hygiene, engineering documentation, visual assets, and harness configuration), (3) rename local branch to `feature/hospital-lan-v3-stabilized`, (4) create an annotated release tag `v3.0.0-rc.1` with a comprehensive changelog, and (5) publish the branch and tag to GitHub.

**Tech Stack:** Git, TypeScript / React 18 / Vite / Vitest, Python 3.12 / FastAPI / Pytest, PostgreSQL.

**Spec:** [`docs/engineering/PROJECT_STATUS.md`](file:///d:/dr-sr/docs/engineering/PROJECT_STATUS.md), [`DECISIONS.md`](file:///d:/dr-sr/DECISIONS.md) (ADR-23 to ADR-27), and Kalyan Hospital Governance in [`AGENTS.md`](file:///d:/dr-sr/AGENTS.md).

---

## Global Constraints

- **Zero Broken Builds:** Never commit code that breaks TypeScript compilation (`tsc -b`) or test suites (`vitest`, `pytest`).
- **No Monolithic Blobs:** Every commit must have a single logical focus and a clear conventional message (`fix:`, `feat:`, `docs:`, `chore:`).
- **Preserve Unpushed History:** Do not rebase or alter already-committed commits on `switch/node-lan` (which contains 13 commits from Phase 19/20 and domain rules).
- **SemVer Tagging:** Use standard Semantic Versioning with release candidate status (`v3.0.0-rc.1`) to clearly distinguish production releases from pre-release LAN milestones.

---

## Review Focus

1. **TypeScript Build Guard:** Uncommitted JSX changes in `frontend/src/pages/DoctorDashboard.tsx` currently break `tsc -b`. They must be repaired before any commit.
2. **Binary Churn Prevention:** The `.coverage` SQLite database must be untracked from Git and added to `.gitignore`.
3. **Branch Realignment:** `switch/node-lan` references a discarded architecture (ADR-27 dropped the Node switch); rename to `feature/hospital-lan-v3-stabilized`.
4. **Tag Integrity:** The existing `v3-fastapi-final` tag refers to obsolete Node-switch history; the new tag must be annotated with full verified system capabilities.
5. **No Data Loss:** Ensure untracked demo screenshots and architecture diagrams are captured cleanly in the assets/docs commits.

---

### Task 1: Fix Syntax Errors & Verify Green Build

**Files:**
- Modify: `frontend/src/pages/DoctorDashboard.tsx`
- Modify: `.gitignore`
- Untrack: `.coverage`

**Interfaces:**
- Consumes: `useState`, `useEffect` from `react`
- Produces: Clean TypeScript build and zero lint errors.

- [ ] **Step 1: Repair `frontend/src/pages/DoctorDashboard.tsx`**

1. Import `useEffect` from `react` alongside `useState`.
2. Fix the malformed JSX comment `{/* Initial load skeleton */` on line 31 to properly render the loading pulse without syntax errors:
```tsx
{/* Welcome & Queue Header */}
{isInitialLoad && (
  <div className="h-64 border-b border-neutral-200 animate-pulse bg-neutral-50/50" />
)}
```

- [ ] **Step 2: Untrack `.coverage` and update `.gitignore`**

1. Run: `git rm --cached .coverage`
2. Ensure `.gitignore` includes:
```gitignore
.coverage
.coverage.*
```

- [ ] **Step 3: Verify TypeScript compilation and build**

Run: `cmd /c "npm --prefix frontend run build"`
Expected: `tsc -b && vite build` exits with code 0.

- [ ] **Step 4: Verify backend test gate**

Run: `backend\.venv\Scripts\pytest.exe backend/tests/test_phase20_gate.py backend/tests/test_admin_overview.py`
Expected: 13 passed, 0 failed.

---

### Task 2: Commit All Changes in Logical Slices

**Commit Slice 1: Frontend UI Refinements & Animations**
- **Files:**
  - `frontend/src/pages/DoctorDashboard.tsx`
  - `frontend/src/pages/ReceptionDashboard.tsx`
  - `frontend/src/components/PatientTimeline.tsx`
- **Command:**
```bash
git add frontend/src/pages/DoctorDashboard.tsx frontend/src/pages/ReceptionDashboard.tsx frontend/src/components/PatientTimeline.tsx
git commit -m "fix(ui): repair doctor dashboard loading pulse, reception queue animations, and patient timeline"
```

**Commit Slice 2: Repository Hygiene & Gitignore**
- **Files:**
  - `.gitignore`
  - `.coverage` (removal)
- **Command:**
```bash
git add .gitignore
git commit -m "chore(repo): untrack coverage database and update gitignore"
```

**Commit Slice 3: Engineering Documentation & Architecture Audits**
- **Files:**
  - `docs/AUDIT-2026-11-08.md`
  - `docs/UI-UX-AUDIT-2026-11-08.md`
  - `docs/engineering/`
  - `docs/plans/`
  - `docs/superpowers/`
  - `docs/system-audit/`
  - `.archify/`
  - `.gsd-plan.md`
  - `.planning/`
- **Command:**
```bash
git add docs/ .archify/ .gsd-plan.md .planning/
git commit -m "docs(audit): consolidate system architecture, workflow maps, and engineering status registers"
```

**Commit Slice 4: Hospital Assets & Visual Media**
- **Files:**
  - `frontend/public/assets/`
  - `demo/`
  - `raw files/`
  - `screenshots/`
- **Command:**
```bash
git add frontend/public/assets/ demo/ "raw files/" screenshots/
git commit -m "feat(assets): add hospital crest branding, login media, and UAT interface recordings"
```

**Commit Slice 5: Harness Configuration & Dev Scripts**
- **Files:**
  - `pytest.ini`
  - `backend/scripts/seed_dev_data.py`
  - `.agents/`
  - `.claude/`
  - `skills-lock.json`
- **Command:**
```bash
git add pytest.ini backend/scripts/seed_dev_data.py .agents/ .claude/ skills-lock.json
git commit -m "chore(harness): integrate agent skill definitions, dev seeder, and test configuration"
```

- [ ] **Step 6: Verify clean working directory**

Run: `git status`
Expected: `nothing to commit, working tree clean`.

---

### Task 3: Realign Canonical Branch Name

- [ ] **Step 1: Rename `switch/node-lan` to `feature/hospital-lan-v3-stabilized`**

Run: `git branch -m switch/node-lan feature/hospital-lan-v3-stabilized`
Expected: Current branch renamed cleanly to reflect the stable React/FastAPI LAN platform.

---

### Task 4: Create Annotated Semantic Versioning Release Tag

- [ ] **Step 1: Create annotated tag `v3.0.0-rc.1`**

Run:
```bash
git tag -a v3.0.0-rc.1 -m "Release Candidate 1: Kalyan Hospital Offline LAN Web Platform (v3.0.0)

Key Capabilities:
- Full React 18 + FastAPI + PostgreSQL offline LAN platform (ADR-27 confirmed)
- Doctor Workspace & Clinical Encounters with draft auto-save and vitals (Phase 19)
- Administration Governance, Hospital Assets, bilingual Print Templates, and Demographic Correction (Phase 20)
- Strict hospital business invariants: Reception-only payment collection, doctor payment-write ban
- URN format: KH-YY-P-MM-NNNNN with yearly restart (K-65)
- Doctor cabin codes and self-service consultation fee schedules (K-60)
- Monotonic queue tokens, mid-consultation cancellation guard, and dynamic check-in fee (BR-006, BR-013)
- 100% green test suites: 55 frontend test files (295 tests), full backend integration gate"
```

- [ ] **Step 2: Verify tag creation**

Run: `git tag -l -n20 v3.0.0-rc.1`
Expected: Tag listed with complete annotation.

---

### Task 5: Publish Branch & Tag to GitHub Remote

- [ ] **Step 1: Push branch to GitHub**

Run: `git push -u origin feature/hospital-lan-v3-stabilized`
Expected: Branch pushed to `origin`.

- [ ] **Step 2: Push annotated tag to GitHub**

Run: `git push origin v3.0.0-rc.1`
Expected: Tag published to GitHub Releases/Tags.

- [ ] **Step 3: Open Milestone PR targeting `main`**

Run:
```bash
gh pr create --base main --head feature/hospital-lan-v3-stabilized --title "feat(platform): Kalyan Hospital v3.0.0-rc.1 Offline LAN Platform Baseline" --body "Consolidates verified Phase 19 (Doctor Workspace), Phase 20 (Admin Governance), URN format updates (K-65), doctor fees (K-60), and system audit documentation into the authoritative main branch."
```
Expected: PR created with full audit trail and clean CI pipeline.

