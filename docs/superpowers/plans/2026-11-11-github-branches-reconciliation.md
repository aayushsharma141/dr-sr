# GitHub Branches and PRs Reconciliation & Cleanup Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconcile, clean up, and systematically resolve all 19 remote GitHub branches and open pull requests in `aayushsharma141/dr-sr` to achieve a clean repository pipeline and merge-ready state.

**Architecture:** A 5-phase progressive remediation strategy: (1) merge the green, clean PR #26 into `main`, (2) prune 8 fully-integrated remote branches and close obsolete PR #16, (3) close and prune 4 superseded/abandoned PRs and branches, (4) reconcile and test-verify the 3 active feature/fix PRs (#12, #17, #27), and (5) stage the advanced local LAN work from `switch/node-lan` into a clean PR.

**Tech Stack:** Git, GitHub CLI (`gh`), Python 3.12 / FastAPI, PostgreSQL (Alembic), React 18 / TypeScript 5 / Vite / Vitest, Pytest.

**Spec:** [`docs/engineering/PROJECT_STATUS.md`](file:///d:/dr-sr/docs/engineering/PROJECT_STATUS.md) and Kalyan Hospital Engineering Governance in [`AGENTS.md`](file:///d:/dr-sr/AGENTS.md).

---

## Global Constraints

- **Strict Invariants:** Never bypass hospital invariants (one permanent URN, reception-only payment collection, doctor payment-write ban, integer paise calculations, authoritative central DB).
- **Safe Branching:** Never force-push to `main`. Every merge to `main` must maintain passing CI.
- **Traceability:** Check out clean worktrees or make atomic commits with clear messages. Document supersession reasons before closing any PR.
- **Evidence-First:** Every task ends with a concrete command and verified output before marking complete.

---

## Review Focus

1. **Premature Merge of Feature Branches:** Merging PR #17 or PR #27 without physical Epson A4 print verification and hospital UAT violates operational acceptance criteria.
2. **Loss of Unique Logic in Conflicted PRs:** PR #12 has valuable tokenless reservation logic that must not be deleted when closing or rebasing conflicts.
3. **Database Migration Revision Collisions:** Merging branches with diverging Alembic migration numbers causes revision tree forks. Check migration chains before merges.
4. **Local Branch Divergence:** `switch/node-lan` has 133 commits ahead containing Phase 19/20; do not overwrite or discard unpushed work.
5. **Accidental Deletion of Unmerged Commits:** Ensure `git rev-list --count origin/main..$branch` is strictly 0 before deleting any remote branch.

---

### Task 1: Merge PR #26 (`refactor/admin-modules-ssot`) into `main`

**Files:**
- Modify: `frontend/src/admin/modules.ts` (Already on branch)
- Test: `frontend/src/pages/__tests__/admin-navigation-architecture.test.tsx`

**Interfaces:**
- Consumes: `AdminModuleAction` definitions in `frontend/src/admin/modules.ts`
- Produces: Clean single source of truth for administrative module actions on `main`.

- [ ] **Step 1: Verify current PR #26 checks and diff**

Run: `gh pr view 26 --json number,mergeable,mergeStateStatus,statusCheckRollup`
Expected: `mergeable: MERGEABLE`, `mergeStateStatus: CLEAN`, all check runs `SUCCESS`.

- [ ] **Step 2: Merge PR #26 into `main`**

Run: `gh pr merge 26 --merge --subject "refactor(admin): establish single source of truth for admin module actions (#26)"`
Expected: Pull request #26 merged and closed.

- [ ] **Step 3: Update local `main` and delete remote `refactor/admin-modules-ssot`**

```bash
git fetch origin main --prune
git push origin --delete refactor/admin-modules-ssot
```
Expected: Remote branch deleted on GitHub.

---

### Task 2: Prune the 8 Fully-Integrated Remote Branches and Close Obsolete PR #16

**Branches to Delete (All 0 commits ahead of `main`):**
1. `ci/backend-tests` (Merged in PR #23)
2. `docs/phase-19-doctor-workspace-context` (Merged in PR #19)
3. `feat/admin-unified-navigation` (Merged in prior commit)
4. `fix/admin-navigation-hierarchy-2026-11-04` (Merged in PR #15)
5. `fix/backend-test-suite-remediation` (Merged in PR #20 / #21)
6. `fix/backup-manager-full-redesign-2026-11-04` (PR #16 obsolete; all commits in `main`)
7. `fix/ist-dates-and-dialog-focus` (Merged in PR #25)
8. `test/restore-endpoint-real-backup` (Merged in PR #22)

- [ ] **Step 1: Close obsolete PR #16 with comment**

Run:
```bash
gh pr close 16 --comment "Closing as all changes from this branch were already integrated into main via prior administration and backup manager redesign PRs."
```
Expected: PR #16 closed.

- [ ] **Step 2: Verify zero unmerged commits for all 8 branches**

Run:
```powershell
$branches = @(
  "ci/backend-tests",
  "docs/phase-19-doctor-workspace-context",
  "feat/admin-unified-navigation",
  "fix/admin-navigation-hierarchy-2026-11-04",
  "fix/backend-test-suite-remediation",
  "fix/backup-manager-full-redesign-2026-11-04",
  "fix/ist-dates-and-dialog-focus",
  "test/restore-endpoint-real-backup"
)
foreach ($b in $branches) {
  $ahead = (git rev-list --count origin/main..origin/$b).Trim()
  if ([int]$ahead -ne 0) { throw "Branch $b is not 0 ahead ($ahead)!" }
  Write-Output "$b is 0 ahead. Safe."
}
```
Expected: All 8 branches report "0 ahead. Safe."

- [ ] **Step 3: Delete the 8 remote branches on GitHub**

Run:
```bash
git push origin --delete ci/backend-tests docs/phase-19-doctor-workspace-context feat/admin-unified-navigation fix/admin-navigation-hierarchy-2026-11-04 fix/backend-test-suite-remediation fix/backup-manager-full-redesign-2026-11-04 fix/ist-dates-and-dialog-focus test/restore-endpoint-real-backup
```
Expected: All 8 remote branches deleted.

- [ ] **Step 4: Prune local tracking refs**

Run: `git remote prune origin`
Expected: Pruned tracking refs reported cleanly.

---

### Task 3: Close Superseded PRs and Archive Dead Branches

**PRs / Branches to close:**
1. **PR #24 (`fix/doctor-queue-ist-business-date`):** Superseded by PR #25 (`fix: use IST business dates and repair clinical dialogs and previews`).
2. **PR #18 (`feat/admin-page-standardization-p1-2026-11-04-v2`):** Targets deleted base branch `fix/admin-navigation-hierarchy-2026-11-04`; superseded by subsequent Phase 18 and Phase 20 page layouts.
3. **PR #7 (`docs/v3-lan-platform-baseline`) & PR #8 (`docs/v3-implementation-hygiene`):** Legacy documentation PRs (182 and 99 commits behind) with massive conflicts, superseded by active documentation in `docs/engineering/`.
4. **Dead branches with no PR:** `chore/repo-audit-hardening` and `feat/admin-p0-settings` (49 commits behind, massive conflicts, superseded).

- [ ] **Step 1: Close PR #24 as superseded by PR #25**

Run:
```bash
gh pr close 24 --comment "Superseded by PR #25 (commit 8925c19d) which already incorporated the IST business date for doctor queues and corresponding tests into main."
git push origin --delete fix/doctor-queue-ist-business-date
```
Expected: PR #24 closed and remote branch deleted.

- [ ] **Step 2: Close PR #18 as superseded**

Run:
```bash
gh pr close 18 --comment "Superseded by subsequent administration page layout standardization in Phase 18 and Phase 20."
git push origin --delete feat/admin-page-standardization-p1-2026-11-04-v2
```
Expected: PR #18 closed and remote branch deleted.

- [ ] **Step 3: Close legacy doc PRs #7 and #8**

Run:
```bash
gh pr close 7 --comment "Closed as superseded by current Kalyan Hospital v3 LAN platform documentation under docs/."
gh pr close 8 --comment "Closed as superseded by active engineering documentation under docs/."
git push origin --delete docs/v3-lan-platform-baseline docs/v3-implementation-hygiene
```
Expected: PRs #7 and #8 closed and branches deleted.

- [ ] **Step 4: Delete stale unattached branches `chore/repo-audit-hardening` and `feat/admin-p0-settings`**

Run:
```bash
git push origin --delete chore/repo-audit-hardening feat/admin-p0-settings
```
Expected: Remote branches deleted.

---

### Task 4: Reconcile Conflicted & In-Flight PRs (#12, #17, #27)

At this point, only 3 active PRs remain in the repository:
- **PR #12 (`fix/hybrid-appointment-workflow-review`)** (Needs rebase/audit)
- **PR #17 (`feature/reception-all-specialties`)** (Feature-complete, in Draft for Hospital UAT)
- **PR #27 (`feature/reception-refinements`)** (Refinements on top of PR #17)

- [ ] **Step 1: Reconcile PR #12 (`fix/hybrid-appointment-workflow-review`)**

1. Create a clean worktree or branch off `origin/main`: `git checkout -b fix/hybrid-appointment-workflow-reconciled origin/main`
2. Cherry-pick or re-apply the appointment token lifecycle changes from `origin/fix/hybrid-appointment-workflow-review` (tokenless reservations, check-in validation, overdue NO_SHOW).
3. Run backend tests: `pytest backend/tests/test_appointment_status.py backend/tests/test_appointments.py`
4. Push to remote and update PR #12 with clean mergeability against `main`.

- [ ] **Step 2: Rebase / Sync PR #17 (`feature/reception-all-specialties`) with `main`**

1. Fetch updated `main` (which now includes PR #26).
2. Merge `origin/main` into `feature/reception-all-specialties`.
3. Run test verification:
   - Backend: `pytest backend/tests/test_departments.py backend/tests/test_appointments.py`
   - Frontend: `npm --prefix frontend test -- src/pages/__tests__/AppointmentsReception.test.tsx`
4. Push updated branch to `origin/feature/reception-all-specialties`.

- [ ] **Step 3: Execute Operational Acceptance Checklist for PR #17**

1. Run Alembic migration verification against test database.
2. Verify payment creation permission restriction (Reception only, Admin blocked from posting payments).
3. Perform physical Epson A4 plain sheet print test (OD-06 verification).
4. Remove `Draft` status on PR #17 and merge into `main` once hospital sign-off is obtained.

- [ ] **Step 4: Graduate PR #27 (`feature/reception-refinements`)**

1. Once PR #17 is in `main`, re-target PR #27 to `main`.
2. Verify queue polling and LAN status indicator tests.
3. Merge PR #27 into `main`.

---

### Task 5: Consolidate Local Baseline Work (`switch/node-lan`)

**Context:** The local branch `switch/node-lan` contains 133 commits covering Phase 19, Phase 20, URN format updates (`KH-YY-P-MM-NNNNN`), and bug fixes.

- [ ] **Step 1: Verify local test green status on `switch/node-lan`**

Run:
```bash
npm --prefix frontend run test
pytest backend/tests/
```
Expected: All suites green.

- [ ] **Step 2: Push `switch/node-lan` to a clear canonical remote feature branch**

```bash
git push -u origin switch/node-lan:feature/hospital-lan-v3-stabilization
```
Expected: Upstream branch established on GitHub for safe backup and PR creation.

- [ ] **Step 3: Open Milestone PR for Phase 19/20 integration**

Run:
```bash
gh pr create --base main --head feature/hospital-lan-v3-stabilization --title "feat(platform): integrate Doctor Workspace (Phase 19) and Administrative Governance (Phase 20)" --body "Consolidates verified Phase 19 & Phase 20 modules, URN format updates, and clinical LAN stability fixes."
```
Expected: PR created with full audit trail.

