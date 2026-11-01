# System Invariants

These constraints apply to all future implementation work unless an explicit, reviewed architecture decision changes them.

## Deployment and data

1. v3 is a centralized offline LAN application.
2. PostgreSQL is the shared system of record; browser clients must never connect directly to it.
3. Do not use a shared SQLite database or network-drive database file for multi-user operation.
4. Patient photographs remain in private server-side storage and are delivered only through authenticated, authorized application routes.
5. Runtime workflows must not depend on an external internet service.

## Identity and authorization

6. Every staff member uses an individual account; shared staff logins are not the intended model.
7. Authentication is enforced by the server, not by hiding frontend controls.
8. Every protected API operation must enforce the required permission server-side.
9. Role names and permission grants are a controlled policy surface. Do not infer rights from UI visibility.
10. No default production password or reusable public bootstrap credential is permitted.

## Clinical records

11. Clinical records must preserve authorship and chronology.
12. Finalized clinical content is not silently overwritten; corrections are represented through dated addenda where the workflow supports them.
13. Patient demographic edits must retain version checks and audit history.
14. Doctor data isolation is currently implemented as a strict doctor silo; any relaxation requires explicit client policy approval and tests.

## Concurrency and identifiers

15. URN allocation must remain safe under concurrent registrations.
16. Updates to versioned records must detect stale writes rather than silently overwrite newer data.
17. Financial amounts, when implemented, must use integer paise rather than floating-point arithmetic.
18. Sequential identifiers and receipts must be allocated transactionally and have documented void/reversal semantics.

## Audit, backup, and release

19. Sensitive mutations must produce attributable audit events.
20. Backup and restore must treat the database and associated patient files as one recoverable dataset.
21. A backup is not considered verified merely because a file exists; restore and integrity checks are required.
22. Do not claim production readiness until deployment, access policy, backup/restore, power recovery, and physical printer acceptance have been tested in the target environment.

## Documentation discipline

23. Mark a capability implemented only when code and tests support the claim.
24. Keep phase progress in `.planning/STATE.md`; do not duplicate or independently recalculate it in this directory.
25. Record unresolved client policy choices explicitly rather than converting assumptions into requirements.
