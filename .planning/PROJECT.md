# Kalyan Hospital — v3.0 Centralized LAN Patient Platform

## What this is

A browser-based, internet-independent patient and physiotherapy platform. One on-premises server serves reception, doctors and administrators across 3–5 PCs on the hospital LAN. Target stack: React + TypeScript, FastAPI and PostgreSQL. Existing PySide6/SQLite app is legacy reference, not v3 runtime.

## Core value

Shared, permission-controlled patient records across clinic workstations, with auditable clinical and financial history and a backup proven to restore.

## Business context

- Customer: Kalyan Hospital / श्री वशिष्ठ कल्याण ट्रस्ट, Ara/Bhojpur, Bihar.
- Prior commercial ceiling: ₹22,000. Full v3 scope requires commercial re-baselining; this is not approval for all v3 requirements.
- Prior 4–6 week estimate applied to the smaller desktop MVP, not automatically to v3.
- Success: offline LAN operation, correct role boundaries, safe concurrent writes, immutable finalized records, accurate ledger, clean-machine restore and actual printer acceptance.

## v1 scope

1. First-run bootstrap, individual users, sessions and server-side permissions.
2. Clinic settings, doctor profiles, fee catalogue and patient registry.
3. Appointments, token numbers and doctor queue.
4. Clinical encounters, addenda, prescriptions, treatment plans and sessions.
5. Billing ledger, sequential receipts and authorized reversals.
6. Append-only audit, database-plus-files backup and integrity report.
7. LAN deployment, offline/power recovery, printer and restore acceptance.

Detailed scope and codes are in .planning/REQUIREMENTS.md and root PRD.md.

## Deferred scope

v2 reporting/convenience features. v4+ webcam/HTTPS if not included in v1 deployment decision, document attachments and conditional legacy migration.

## Constraints and assumptions

Runtime must not require internet. Three to five browser clients share one server. Server hardware, OS, fixed IP, UPS and certificate strategy are unconfirmed. PostgreSQL is recommended pending hardware assessment. Use synthetic data. No shared staff logins or public patient files.

## Architecture rules

- API owns authorization and business invariants.
- Every protected route declares and tests permission.
- Sensitive mutation and audit commit atomically.
- Finalized clinical records and posted payments are immutable; corrections use addenda/reversals.
- Money is integer paise; balances derive from ledger.
- Stale edits return 409.
- Backup includes database and referenced files with checksums; restore is staged and verified.

## Open decisions

Track in root DECISIONS.md: server/UPS, doctor access, reversal authority, receipt period, genuine v2 data, printer, HTTPS, session thresholds, backup schedule/retention and fee catalogue.

## Evolution

Root PRD is product contract. Planning requirements and roadmap provide execution traceability. Update STATE.md after each phase and retain verification evidence.

---
*Planning baseline reset 2026-11-01; client sign-off pending.*