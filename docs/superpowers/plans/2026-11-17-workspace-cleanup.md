# Workspace File Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely audit, prune, and consolidate dead caches, misplaced build files, and unneeded media from `D:\dr-sr` to reduce disk usage and file watcher load without affecting the active hospital web application.

**Architecture:** Tiered cleanup starting with zero-risk ephemeral caches and misplaced directories, followed by user-confirmed media consolidation and legacy virtual environment cleanup.

**Tech Stack:** PowerShell, Git, Node/Vite, Python/Uvicorn.

**Spec:** Kalyan Hospital Governance (AGENTS.md) & Workspace Cleanliness Spec.

## Global Constraints
- Preserve all active application code (`backend/`, `frontend/`, `deploy/`).
- Never delete production database, migration history, or credentials.
- Verify Git status before and after every deletion batch.
- Retain agent configurations (`.agents/`, `.planning/`, `.claude/`, `.codex/`).

## Review Focus
1. Accidental deletion of files tracked by Git (prevented by checking `git status` / `git ls-files`).
2. Deleting dependencies needed by the active backend (prevented by preserving `backend/.venv`).
3. Deleting active frontend modules (prevented by only deleting root `node_modules`, never `frontend/node_modules`).
4. Losing unbacked-up screenshots or media needed for compliance.
5. Breaking active services or file watchers.

---

### Task 1: Clean Zero-Risk Ephemeral Caches and Misplaced Root Folders

**Files / Directories:**
- Delete: `d:\dr-sr\unsloth_compiled_cache\` (15 files)
- Delete: `d:\dr-sr\node_modules\` (100 files, misplaced root vite cache)
- Delete: `d:\dr-sr\hms\` (1 file, obsolete dropped Node.js HMS prototype)
- Delete: `d:\dr-sr\graphify-out\` (1,777 files, tool output)
- Delete: `d:\dr-sr\.coverage` (temporary coverage file)
- Delete: `d:\dr-sr\.archify\` (46 files, tool cache)

- [ ] Step 1: Verify none of these folders contain uncommitted tracked source files via `git status --ignored`.
- [ ] Step 2: Delete `unsloth_compiled_cache`, `node_modules` (root only), `hms`, `graphify-out`, `.coverage`, and `.archify`.
- [ ] Step 3: Run `git status` to verify repository working tree is clean.

### Task 2: Reorganize Root Media and Artifacts

**Files / Directories:**
- Move: `d:\dr-sr\kalyan_hospital_product_video.mp4` -> `d:\dr-sr\promo_assets\`
- Move: `d:\dr-sr\kalyan_hospital_product_tour.html` -> `d:\dr-sr\promo_assets\`
- Relocate or Archive: `d:\dr-sr\raw files\` (170 MB of whatsapp videos/mockups) -> `d:\dr-sr\assets\archive\` or dedicated external storage.

- [ ] Step 1: Ensure `promo_assets/` exists and move root video and html tour files into it.
- [ ] Step 2: Check with user whether `raw files\` should be kept in an archive subfolder or deleted.
- [ ] Step 3: Verify no broken links in documentation for relocated files.

### Task 3: Decide on Root `.venv` (Legacy Desktop App)

**Files / Directories:**
- Review: `d:\dr-sr\.venv\` (13,521 files, ~700 MB, PySide6 desktop app)
- Keep: `d:\dr-sr\backend\.venv\` (5,422 files, FastAPI active LAN backend)

- [ ] Step 1: Confirm with user if the old PySide6 desktop app is still needed.
- [ ] Step 2: If no longer needed, remove `d:\dr-sr\.venv` to free ~13,500 files and ~700 MB.
- [ ] Step 3: Verify backend tests and server startup still succeed using `backend\.venv`.

### Task 4: Verification and Baseline Checks

- [ ] Step 1: Run `backend\.venv\Scripts\pytest backend/tests` to confirm backend passes.
- [ ] Step 2: Run `npm run typecheck` in `frontend/` to confirm frontend passes.
- [ ] Step 3: Run file count check on `D:\dr-sr` to measure reduction in total workspace file count.
