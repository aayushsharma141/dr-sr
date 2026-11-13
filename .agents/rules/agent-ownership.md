# Multi-Agent File Ownership Policy

1. The Orchestrator assigns ownership before implementation.
2. Every implementation task has one primary owner.
3. No two workers edit the same file concurrently.
4. Schema and migration changes have one designated owner.
5. API contract changes require coordination with frontend and backend owners.
6. Global configuration and dependency files require Orchestrator approval.
7. Workers must inspect the latest file state before editing.
8. Worktree changes must be reviewed before integration.
9. No direct production database modifications.
10. Every integrated change must pass its assigned regression tests.

Ownership must use actual discovered repository paths, not assumed paths.

