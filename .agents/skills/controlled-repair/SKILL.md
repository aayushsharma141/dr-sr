---
name: controlled-repair
description: Controlled single-writer repair workflow for approved Kalyan Hospital issues with strict file ownership and regression verification.
---
# Controlled Repair Procedure

## Execution Steps
1. Verify task assignment and exclusive file ownership in `docs/engineering/AGENT_ASSIGNMENTS.md`.
2. Inspect current file state and establish Git checkpoint.
3. Apply surgical change adhering to Ponytail lazy senior dev principles (minimal code, preserve comments).
4. Run targeted unit and component tests.
5. Verify related modules and integration boundaries.
6. Update `docs/engineering/BUG_REGISTER.md` and `docs/engineering/REPAIR_CHANGELOG.md`.
7. Mark status as `IMPLEMENTED — NOT VERIFIED` until independently verified by QA.

