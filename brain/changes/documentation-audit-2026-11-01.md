# Repository Documentation Consistency Audit — 2026-11-01

## Scope and method

Reviewed the documentation and engineering knowledge base on branch `docs/v3-implementation-hygiene` against the available v3 source files. This was a static repository review, not a runtime test, formal security audit, clinical validation, or production acceptance exercise.

Reviewed documentation included the root README, PRD, architecture, security policy, decision register, roadmap, task list, test plan, deployment and migration runbooks, planning roadmap/requirements/state, and the `brain/` knowledge base.

Reviewed implementation evidence included the role/permission catalogue, patient request schemas and routes, URN allocator, appointment routes, encounter routes, authentication route, and package manifests.

## Findings and dispositions

| ID | Finding | Disposition |
|---|---|---|
| DOC-01 | README contained a custom `<badge>` tag that is not ordinary GitHub Markdown. TASKS used the same tag in phase headings. | Fixed: replaced with ordinary Markdown or removed the placeholder. |
| DOC-02 | PRD described PostgreSQL as a recommended future target despite PostgreSQL already being the v3 implementation database. | Fixed: PRD now identifies PostgreSQL as implemented and server hardware as a deployment prerequisite. |
| DOC-03 | PRD recommended cross-doctor read access while source code and the decision register described a strict doctor silo. | Fixed: current strict silo is documented as implemented; any change remains a client decision. |
| DOC-04 | AUD-01 was marked complete even though the Phase 11 evidence establishes an audit writer/foundation and later module coverage remains planned. | Fixed: AUD-01 is now partial; complete event coverage is explicitly carried into Phases 14–16 and the Admin viewer remains Phase 16. |
| DOC-05 | TRT-03 (finalized physiotherapy sessions immutable; corrections by addendum) appeared in the PRD but was missing from traceability and Phase 14 requirement mapping. | Fixed: added to the requirements ledger and Phase 14 roadmap mapping. |
| DOC-06 | PRD and roadmap described the patient registry as implementing the client's canonical registration form, but the current `PatientCreate` API schema has a different set of fields. | Documented as an unresolved scope gap; PAT-01 is partial until the client form is mapped and the approved mapping is implemented. |
| DOC-07 | Admin-only payment reversal appeared as a definitive product requirement while the decision register still required client confirmation. | Fixed: current permission mapping is described as a provisional baseline; written client approval is required before Phase 15. |
| DOC-08 | Documentation implied the server already owns backup operations even though backup/restore is Phase 16 scope. | Fixed: backup ownership is described as the target architecture; backup operations remain unimplemented. |

## Patient form-to-schema gap

The current `PatientCreate` schema stores:

- `full_name`
- `guardian_name`
- `gender`
- `dob`
- `age_years`
- `mobile`
- `address`
- `district`
- `state`
- `emergency_contact`
- `allergies`
- `notes`

The client-provided registration form includes patient in/out date and time, referral, condition, session count, and total/paid/balance amounts, in addition to identity and contact fields. Those concepts are not represented as equivalent fields in the current patient-create schema.

This is not automatically a requirement to add every item to the patient table. Some data may belong to visit/encounter records, treatment plans, or the future payment ledger. The client must approve a field-by-field mapping. In particular, balance should be derived from the financial ledger rather than stored as an editable demographic field.

Tracked as OQ-13 in `brain/decisions/open-questions.md`.

## Remaining decisions before affected work

- Admin patient-photo access.
- Admin demographic-edit access.
- Whether strict doctor silo remains the clinical policy.
- URN void/cancellation and gap semantics.
- Patient registration form-to-API field mapping.
- Financial reversal authority and receipt numbering cycle.
- LAN topology, HTTPS, UPS, printer, backup ownership/retention, and final acceptance sign-off.

## Verification limits

- No application source code, database migration, or frontend behavior was changed by this audit.
- No backend/frontend tests, lint, type checks, migration tests, or deployment tests were rerun.
- Historical Phase 13 test counts remain historical evidence, not verification of this documentation branch.
- The review does not establish regulatory compliance, penetration-test completion, or production readiness.

## Result

The reviewed documentation now better distinguishes implemented behavior, partial requirements, planned modules, client decisions, and production acceptance. The principal unresolved product gap is the patient registration form-to-schema mapping. Resolve that and the outstanding access-policy decisions before treating the corresponding requirements as fully signed off.
