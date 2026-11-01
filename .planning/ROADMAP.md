# Roadmap — Kalyan Hospital v3.0

**Status:** Planning baseline; v3 implementation not started.  
**Baseline:** 2026-11-01.

The previous five-phase roadmap delivered a single-PC PySide6/SQLite desktop application. This roadmap targets a centralized React + TypeScript / FastAPI / PostgreSQL platform for 3–5 browser clients on an offline hospital LAN.

## Phases

- [ ] **Phase 11 — Foundation and bootstrap:** repo transition, database, authentication, first-admin wizard, permission catalogue and API security.
- [ ] **Phase 12 — Clinic setup and patient registry:** settings, doctors, fees, patient registry, photos, search and registration print.
- [ ] **Phase 13 — Appointments and queue:** token allocation, doctor assignment, daily queue and statuses.
- [ ] **Phase 14 — Clinical workflows:** encounters, addenda, prescriptions, treatment plans, sessions and timeline.
- [ ] **Phase 15 — Billing and receipts:** integer-paise ledger, concurrent payment guard, receipt sequence, reprints and reversals.
- [ ] **Phase 16 — Audit, backup and integrity:** append-only audit, scheduled/manual bundles, checksums, restore and integrity report.
- [ ] **Phase 17 — Deployment and acceptance:** server/LAN, offline operation, auto-start/recovery, printer, restore drill and handover.

## Phase exit gates

**11:** Fresh install creates exactly one admin via one-time console code. No defaults. Every protected route has explicit permission and automated coverage. Migrations and stale-update handling pass.

**12:** Settings audited; concurrent patient registrations produce unique URNs; Devanagari search works; photo access authorized; actual A4 printer checked.

**13:** Token allocation safe under concurrency; transitions and doctor queue permission-scoped.

**14:** Finalized notes/sessions immutable; addenda preserve original; prescription and timeline verified.

**15:** Concurrent payment tests cannot overpay; balances reconcile; receipt numbering policy and duplicate reprints/reversals verified.

**16:** Audit append-only; database and files backed up as one set; corrupt restore rejected; clean-machine restore and integrity report pass.

**17:** 3–5 PCs operate on LAN with internet disconnected; auto-start/recovery, printer and restore acceptance recorded; client handover signed.

## Progress

| Phase | Status | Evidence |
|---|---|---|
| 11 | Not started | None |
| 12 | Not started | None |
| 13 | Not started | None |
| 14 | Not started | None |
| 15 | Not started | None |
| 16 | Not started | None |
| 17 | Not started | None |

Old desktop phases 1–5 remain historical and do not count toward v3 completion.

## Risks and dependencies

Client decisions on server hardware, doctor access, receipt numbering, printer and HTTPS. Full v3 scope exceeds the prior desktop MVP assumptions; re-baseline budget and schedule. Confirm whether real legacy data exists before migration. Security and restore acceptance require dedicated time.

---
*Roadmap reset to v3.0. Do not mark phases complete without verification artifacts.*