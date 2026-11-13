---
name: hospital-system-audit
description: Read-only parallel module audit workflow for Kalyan Hospital codebase, architecture, API, schema, workflows, and security.
---
# Hospital System Audit

## Objective
Perform structured, read-only discovery of application modules, data models, endpoints, and workflows without altering code or state.

## Methodology
1. Inspect source files within assigned module scope.
2. Verify actual implementations against architectural invariants.
3. Identify discrepancies between UI controls, API contracts, and database schema.
4. Record precise reproduction steps, affected files, line numbers, and impact.
5. Save findings directly to the designated audit report file in `docs/engineering/audits/`.

