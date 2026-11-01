# Legacy Code and Data Migration — v2 Desktop to v3 LAN

**Status:** Conditional plan; no production migration approved.

## 1. Current legacy system

The repository currently contains a Python/PySide6 desktop application using local SQLite. It includes patient registry, treatment cases/sessions, billing, printing, local backup and demo utilities. This is not the v3 centralized LAN application.

## 2. Reuse policy

Potentially reusable after review:
- Canonical patient form field definitions and validation.
- Hospital branding, logos and approved print layout assets.
- Clinical terminology and treatment workflow rules.
- Integer-paise arithmetic and ledger validation concepts.
- Synthetic test fixtures and business-rule test cases.

Do not directly transplant desktop UI code into React or treat local desktop authentication/backup as satisfying v3 security requirements. Reimplement and test API-level permission enforcement, concurrency, audit, PostgreSQL transactions and database-plus-files backup.

## 3. Migration decision gate

Migration is in scope only if the hospital confirms that the desktop database contains genuine production patient records and explicitly authorizes migration. Demo-seeded or synthetic data does not justify production migration.

Before migration:
1. Identify database file, SQLite version, schema and all linked photo/file directories.
2. Confirm data owner and authorization.
3. Make immutable source copy and checksum it.
4. Inspect schema, row counts, constraints, duplicate identifiers and missing files.
5. Map legacy columns to v3 entities; document transformations and rejected rows.
6. Define patient URN preservation and collision handling.
7. Define payment ledger and historical balance reconciliation.
8. Obtain client approval of mapping and test report.

## 4. Migration execution

- Never migrate directly into production.
- Import into isolated staging PostgreSQL database.
- Preserve original patient identifiers where valid; do not silently renumber.
- Map historical records with provenance and migration timestamp.
- Copy files into private storage and verify checksums.
- Validate patient counts, treatment/session counts, payment totals, balances, orphan files, duplicate URNs and missing required fields.
- Generate exceptions report for manual resolution.
- Obtain clinic sign-off before production cutover.
- Keep original source database read-only and preserved until retention/retirement is approved.

## 5. Rollback

Take verified PostgreSQL + files backup before cutover. If acceptance fails, stop writes, preserve evidence and return to the agreed source workflow. Do not merge post-cutover records into legacy database without a separately designed reconciliation plan.

## 6. Privacy

Use synthetic data in development and AI-assisted workflows. Never upload real patient database, photographs, names, phone numbers or clinical notes to public repositories/issues or unapproved services.

---
*Migration is conditional and not part of baseline v3 implementation until approved.*