# Project Research Summary

**Project:** Kalyan Hospital — v3.0 Centralized LAN Web Platform
**Domain:** Offline small-hospital (physiotherapy) patient, clinical and billing system
**Researched:** 2026-10-30
**Confidence:** MEDIUM (stack versions read live from registries; features, architecture and pitfalls rest on codebase reading and engineering practice, no live browsing)

## Executive Summary

The approved direction is one static-IP Windows server PC running PostgreSQL and a FastAPI service, serving a single built React + TypeScript app to browsers on the LAN, with `/admin`, `/reception` and `/doctor` routes. The v2.0 PySide6/SQLite code is a specification of domain rules (URN, integer paise, 12-field card, audit, backup bundle), not code to port. Research found v2.0 has real gaps that must not be copied: overpayment is flagged but still inserted, URN and session numbers race under concurrent use, audit rows are editable, and a default admin password ships.

The recommended approach is a modular-monolith backend with permission-based (not role-name) checks on every route, server-side sessions in PostgreSQL, same-origin serving (no CORS), integer-paise money, `timestamptz` with Asia/Kolkata, and immutable clinical and financial records (addenda and reversals instead of edits). The main risks are permission leaks, power cuts on the single server, untested restores, print misalignment on the physical pad, and scope creep against Rs 22,000 / 4-6 weeks.

## Key Findings

### Recommended Stack

- **Backend:** Python 3.12/3.13, FastAPI, Pydantic 2, SQLAlchemy 2 + Alembic, psycopg 3, uvicorn.
- **Auth/uploads:** argon2-cffi, opaque server-side session cookie (HttpOnly, SameSite, CSRF header), Pillow to validate and re-encode photos.
- **Frontend:** React 19, Vite, React Router (library mode), TanStack Query, react-hook-form + zod, Tailwind + shadcn/ui, self-hosted fonts including Noto Sans Devanagari. API client generated from OpenAPI.
- **Platform:** PostgreSQL (EDB installer, localhost-only), uvicorn as a Windows service (WinSW or NSSM), Task Scheduler backups, wheelhouse for offline install. Node is build-machine only.
- **Do not add:** CDNs/Google Fonts, JWT in localStorage, Docker/WSL, Redis/Celery, float money, startup `create_all`, SQLite fallback.

Exact versions are in STACK.md and must be pinned in lockfiles at scaffold time (TypeScript 7.x and SQLAlchemy 2.1 may need fallback).

### Expected Features

- **Must have:** per-endpoint permissions; registration with KH-YYYY-XXXX URN, search, edit, photos; appointments as per-doctor day list; encounters with notes (finalise then addendum); prescriptions with bilingual print; treatment plans as session packages; immutable session log with VAS; instalment payments, balances, gap-free sequential receipts per financial year with reversal entries; audit viewer; backup, tested restore, integrity checks; dual-signature registration card.
- **Should have (small):** VAS trend, daily collection report, dues list, missed-session list, backup-health banner.
- **Defer / anti-features:** Aadhaar storage, SMS/WhatsApp, inpatient/pharmacy/lab, drug-interaction checks, ABDM/FHIR, GST/insurance, per-user permission trees, editing or deleting past records, websockets, cloud backup.

### Architecture Approach

- **Layout:** `app/{core,models,schemas,repositories,services,routers,cli}`; one transaction per request; audit row commits with the business write.
- **Data rules:** bigint paise, `row_version` optimistic locking (409), atomic URN counter via `INSERT ... ON CONFLICT ... RETURNING`, `SELECT ... FOR UPDATE` plus idempotency keys on payments, DB triggers blocking edits to sessions, payments and audit.
- **Authz:** `require(perm)` on every route, with a test that fails if any route lacks it; object-level checks in services; reception sees demographics and finance, not clinical content.
- **Backup:** `.kbak` bundle (pg_dump -Fc + photos + manifest + checksums); weekly scratch-database restore test; CLI restore plus in-app verify.
- **Migrations:** one linear Alembic history; app refuses to start on revision mismatch; backup before each upgrade.

### Critical Pitfalls

1. **UI-only role hiding / object-level leaks** — default-deny dependencies plus a role x endpoint x object test matrix.
2. **Power cuts and single server** — BIOS power-on, delayed-start services with restart, API retries DB, UPS, pull-the-plug acceptance test, paper-pad downtime fallback.
3. **Untested or same-disk backups** — second physical drive, checksum manifest, clean-machine restore as handover gate.
4. **Print drift on the real pad** — early spike, mm-based `@page` A4, bundled Devanagari font, per-printer offset, signed physical test print.
5. **Concurrency and numbering** — atomic counters, row locks, 20-parallel-request test; receipts gap-free.
6. **Scope creep** — frozen cut list, feature freeze end of week 4, about 20% reserved for operations and handover.

## Implications for Roadmap

The architecture file proposes 14 phases (0 to 13); for the budget this should be consolidated to roughly 7 to 9. Suggested order with rationale:

1. **Decisions gate and server foundation:** server hardware/LAN, role matrix, overpayment policy, doctor visibility; scaffold repo, PostgreSQL schema baseline, Alembic, service scaffolding, Node on build machine.
2. **Auth, permissions, audit core:** accounts, sessions, `require(perm)`, route-coverage test, first-admin CLI, audit table.
3. **Reception:** patients, URN, search, photos, appointments, doctor assignment, registration card print spike.
4. **Doctor clinical:** encounters, notes, prescriptions, treatment plans, immutable sessions.
5. **Billing:** payments, balances, packages, receipts, reversals.
6. **Admin and data protection:** users, settings, doctor profiles, audit viewer, backup bundle, restore verification, integrity checks.
7. **Printing, deployment and hardening:** real-pad print sign-off, Windows services, offline and power-cut tests, permission matrix test, client acceptance.
8. **(Optional) SQLite import:** only if real v2.0 data exists; PROJECT.md implies it is all synthetic.

Ordering dependencies: permissions before any module; settings and doctor profiles before print templates; storage layout before photos and backup; encounters before prescriptions and plans; billing before packages; integrity checks before restore verification.

### Research Flags

- Re-check at phase planning: WinSW vs NSSM, PostgreSQL 18 minor version, Node LTS required by Vite, TypeScript version, SQLAlchemy 2.1 vs 2.0.
- Unverified (general knowledge only): reference-system comparisons and Indian receipt/GST/80G points; confirm with the client or an advisor.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM-HIGH | Versions read live 2026-10-30; some Windows tooling status from search only |
| Features | MEDIUM | Codebase read directly; competitor and regulatory points not browsed |
| Architecture | MEDIUM | v2.0 gaps verified in code; v3.0 schema is a proposal |
| Pitfalls | MEDIUM | Established practice, no web research |

### Gaps to Address

- Server hardware, UPS and whether client PCs may import a local root CA (HTTPS).
- Whether real v2.0 data exists to migrate.
- Overpayment policy (recommend reject), whether consultation charges are billed separately, doctor visibility of other doctors' patients, appointments as calendar vs queue.
- Who may void a receipt; GST/80G status of the trust.
- Aadhaar: record as a decision not to store it.

## Sources

### Primary (HIGH confidence)
- PyPI and npm registries (read 2026-10-30), for STACK.md versions.
- Repository code: `app/db/schema.sql`, `app/services/*`, for v2.0 behaviour and gaps.

### Secondary (MEDIUM confidence)
- `docs/plans/initial plan.pdf` and the user's frontend decision, for approved scope.
- Web search results on WinSW and PostgreSQL release status.

### Tertiary (LOW confidence)
- General knowledge of OpenEMR, Open Hospital, ICTHospital, GNU Health and Indian small-clinic billing practice.

---
*Research completed: 2026-10-30*
*Ready for roadmap: yes*
