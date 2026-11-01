# Project Brain

This directory is the durable engineering knowledge base for the Kalyan Hospital patient and physiotherapy platform.

## How to use this knowledge base

- Read this file, then the relevant architecture, rules, security, and decision documents before changing system behavior.
- Treat `.planning/STATE.md` and `.planning/ROADMAP.md` as the phase-progress ledger. The `brain/` directory records stable context and current decisions; it does not replace the execution plan.
- Treat code and executable tests as the authority for what is implemented. Documentation describes the observed implementation and must be updated when code changes.
- Distinguish **implemented**, **planned**, **client-approved**, and **accepted in production**. These statuses are not interchangeable.
- Record unresolved policy questions in `decisions/open-questions.md`; do not silently choose a clinical or financial policy.
- Never place real patient data, patient photographs, credentials, setup codes, production database contents, or backups in this repository.

## Contents

- [System overview](architecture/system-overview.md) — runtime topology and technology choices.
- [System invariants](architecture/invariants.md) — constraints that changes must preserve.
- [Development workflow](rules/development-workflow.md) — implementation, testing, and documentation discipline.
- [Threat model](security/threat-model.md) — assets, trust boundaries, threats, and mitigations.
- [Permission policy](security/permission-policy.md) — current roles, known permission gaps, and authorization rules.
- [Approved decisions](decisions/approved-decisions.md) — decisions evidenced by current implementation or explicit project direction.
- [Open questions](decisions/open-questions.md) — policy and acceptance items still requiring resolution.
- [Current state](changes/current-state.md) — concise snapshot of implementation and known gaps.
- [Changelog](changes/changelog.md) — durable project-level change history.

## Source-of-truth order

1. Current source code and tests for actual behavior.
2. `.planning/STATE.md` for recorded phase completion and gate evidence.
3. `.planning/ROADMAP.md` and `.planning/REQUIREMENTS.md` for planned scope and traceability.
4. This knowledge base for stable context, invariants, security posture, and decisions.
5. Other overview documents for explanatory summaries.

When sources disagree, do not guess. Verify code and tests, then update the relevant documentation in the same change.
