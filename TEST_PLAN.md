# Test and Acceptance Plan — Kalyan Hospital v3.0

**Status:** Test strategy for target platform; v3 implementation not yet present.

## 1. Test principles

- Test server-side behavior, not only frontend display.
- Use synthetic patient data.
- Every PRD requirement maps to tests and evidence.
- A feature is not complete solely because a page renders.
- Protect privacy; never commit production records or credentials.

## 2. Test layers

### Unit tests
Validation, permission evaluation, URN/receipt allocators, integer-paise arithmetic, balance calculation, state transitions, addendum rules, backup manifest and checksum functions.

### API integration tests
Authentication, authorization, request validation, error responses, object-level access, file downloads, database transactions and audit events.

### Security tests
Anonymous access denied; Reception cannot call Admin endpoints; Doctor cannot perform disallowed billing/clinical actions; every protected route has permission declaration; bootstrap is one-time; session timeout/lockout work; no secret leakage.

### Concurrency tests
- Simultaneous patient registration.
- Simultaneous appointment token allocation.
- Two PCs attempting payments that together exceed balance.
- Concurrent receipt allocation.
- Stale patient/clinical edit returns 409.
- Simultaneous first-admin bootstrap creates exactly one admin.

### Clinical integrity tests
Finalized encounters and sessions cannot be edited/deleted. Addenda preserve original and record author/time/reason. Timeline ordering is stable and includes correct event type.

### Financial tests
Integer paise only; negative and overpayment rejected; balances computed from ledger; reversal requires Admin and reason; duplicate reprint does not create a payment or new receipt.

### Backup and recovery tests
Database and file bundle manifest/checksums; missing/corrupt file detection; corrupted bundle rejected; staging restore does not mutate live data; clean-machine restore reproduces counts and checksums; integrity report reconciles.

### Deployment tests
Internet disconnected; 3–5 browser PCs; server restart; power recovery; LAN disconnect/reconnect; actual A4 printer; backup drive unavailable; service logs and health status.

## 3. Permission coverage gate

Maintain an explicit API route inventory. Every protected route must declare an authorization dependency or documented public policy. Automated test fails when a new route is unclassified or protected route lacks a permission. Test both allowed and denied role/action combinations.

## 4. Release gates

**Gate A — secure foundation:** bootstrap, accounts, roles, server-side authorization, migrations, concurrency and security suite.

**Gate B — workflow:** patient, appointment, clinical, prescription, treatment, billing, receipt and audit tests.

**Gate C — handover:** offline LAN, actual printer, backup/restore on clean machine, integrity report, service recovery and client acceptance.

## 5. Evidence record

For each run record:
- commit SHA and application/database versions
- test command and environment
- pass/fail counts and failed test logs
- test data classification (synthetic)
- manual tester, date and hardware used
- printer samples and restore report where applicable
- known limitations and client acceptance

## 6. Legacy desktop tests

Existing tests under `legacy/tests/` validate portions of the prior PySide6/SQLite app. They may remain useful for regression/reference but do not verify the v3 API, LAN concurrency, role enforcement or PostgreSQL backup system.

---
*No v3 test result is claimed by this document.*