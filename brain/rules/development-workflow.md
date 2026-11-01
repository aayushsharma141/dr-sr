# Development Workflow Rules

## Before changing code

1. Read this knowledge base and the relevant product/architecture/security documentation.
2. Read `.planning/STATE.md`, `.planning/ROADMAP.md`, and the active phase plan.
3. Inspect the existing implementation and tests. Do not assume a planned feature or permission enum has a working route or UI.
4. Identify whether the change affects authentication, authorization, clinical immutability, identifiers, audit history, patient files, money, backup, or restore. These areas require explicit regression coverage.

## Implementation rules

- Keep authorization in backend dependencies/service logic. Frontend route guards are usability controls, not security boundaries.
- Validate all untrusted input on the server.
- Use database transactions for multi-step state changes and identifiers.
- Preserve optimistic concurrency checks on versioned records.
- Keep clinical finalization and addendum behavior explicit; do not silently mutate finalized records.
- Use integer paise for financial values.
- Do not expose patient-photo storage paths or serve private files from a public static directory.
- Avoid adding runtime internet dependencies.
- Keep secrets, real patient records, photos, and production data out of source control and test fixtures.

## Testing rules

- Add or update backend tests for every API behavior and permission boundary changed.
- Add frontend tests for user-visible behavior and state transitions changed.
- Include negative authorization tests, not only successful-role tests.
- Test concurrent allocation/update behavior where identifiers or optimistic concurrency are involved.
- Use synthetic patient data.
- Run the relevant test suites, linting, and type checks before describing a change as verified.
- Report the exact commands and results. Do not present historical gate counts as a fresh run.

## Documentation rules

- Update the relevant `brain/` document when a stable invariant, architecture boundary, security posture, or decision changes.
- Update `.planning/STATE.md` and phase plans when phase status changes.
- Update PRD/roadmap/requirements when scope or traceability changes.
- Separate implementation evidence from client approval and production acceptance.
- Keep unresolved questions visible and assign an owner/next action where known.

## Git and review discipline

- Work on a feature or documentation branch; do not make unreviewed direct changes to `main`.
- Keep documentation-only changes separate from application-code changes when practical.
- Review the complete diff for accidental secrets or patient data.
- Do not merge a draft PR or claim it is mergeable without checking its current status and checks.
