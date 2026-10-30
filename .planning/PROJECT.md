# Kalyan Hospital — Patient & Physiotherapy Management System

## What This Is

A fully offline, centralized web application for Kalyan Hospital (operated by श्री वशिष्ठ कल्याण ट्रस्ट), Ara, Bhojpur, Bihar. One central server PC on the hospital LAN hosts a FastAPI backend and a PostgreSQL database; reception, doctor and admin staff use a browser on any LAN PC and sign in with individual accounts. It covers patient registration, appointments, clinical encounters, physiotherapy sessions, billing and data protection.

The earlier v2.0 PySide6 + SQLite single-PC desktop app is retained in-repo only as the reference implementation of domain rules. It is not part of the new architecture and the two must not be mixed.

## Core Value

Reliable, internet-free shared patient records for reception and doctors across the hospital LAN, enforced by server-side permissions, with auditable changes and a backup that has been proven to restore.

## Business Context

- **Customer:** Kalyan Hospital / श्री वशिष्ठ कल्याण ट्रस्ट (Station Road, Ara, Bhojpur, Bihar).
- **Revenue model:** Fixed-price custom software contract (₹22,000 total commercial ceiling).
- **Success metric:** Reception and doctor PCs read/write the same records over LAN with no internet; permissions hold at the API; backup restores cleanly on a clean machine.
- **Strategy notes:** Source of truth for the approved direction is `docs/plans/initial plan.pdf` plus the single-frontend decision recorded below.

## Current Milestone: v3.0 Centralized LAN Web Platform

**Goal:** Replace the single-PC desktop app with one central-server web platform: FastAPI + PostgreSQL backend and one React + TypeScript frontend serving role-based dashboards.

**Target features:**
- One React + TypeScript codebase with role-routed dashboards at `/admin`, `/reception`, `/doctor`; individual login, UI chosen by role.
- FastAPI enforces permissions on every endpoint independently of what the UI shows.
- PostgreSQL schema, migrations and authorization model; local filesystem storage for patient photos and documents.
- Reception: patient registration (KH-YYYY-XXXX URN), search, profile editing, photos, appointments, doctor assignment.
- Doctor: clinical encounters, consultation notes, prescriptions, treatment plans, physiotherapy session history.
- Billing: consultation charges, payments, outstanding balances, receipts, session packages (integer paise).
- Admin: users and permissions, hospital settings, doctor profiles, audit events, backup and tested restore, integrity checks.
- Printing and reports (registration card with dual-signature pad layout).
- One-time install on the server PC; offline, LAN, integrity and recovery testing before handover.

## Requirements

### Validated

Domain behaviour proven in the v2.0 desktop reference implementation (rules to carry over, not code to reuse):

- ✓ Sequential human-readable patient ID `KH-YYYY-XXXX` — v2.0
- ✓ 12-field canonical registration form with dual-signature A4 print — v2.0 (client approved)
- ✓ Integer-paise billing, rejects negative payments and overpayments — v2.0
- ✓ Chronological, immutable physiotherapy session history with VAS pain score — v2.0
- ✓ Persistent audit log and role-checked sensitive actions — v2.0
- ✓ Verified backup bundle (data + photos) with integrity-checked restore — v2.0

### Active

Defined in `.planning/REQUIREMENTS.md` for v3.0.

### Out of Scope

- **Cloud hosting / internet-facing access** — system must operate with no internet; server is reachable on the LAN only.
- **Separate frontend projects per role** — one codebase with role routes keeps maintenance inside the ₹22,000 budget.
- **Independent copies of the app on each PC** — all PCs share the one central database.
- **SMS / WhatsApp gateway automation** — third-party telecom cost and internet dependency.
- **Full hospital ERP and inpatient bed allocation** — outpatient registration and physiotherapy focus only.
- **Hardware biometric scanners** — keyboard and mouse entry only.
- **PySide6 + SQLite** — remains valid only if a single-computer deployment is later confirmed; never mixed with this architecture.

## Context

- **Environment:** One central Windows server PC plus reception, doctor and admin PCs on the hospital LAN; no internet required for normal operation. Actual server hardware and LAN topology are not yet confirmed.
- **Hospital Identity:** KALYAN HOSPITAL — PHYSIOTHERAPY DEPARTMENT (श्री वशिष्ठ कल्याण ट्रस्ट द्वारा संचालित).
- **Clinics:**
  - Clinic 1: नवादा थाना के सामने वाली गली, आरा, भोजपुर (802301)
  - Clinic 2: श्रीरामपुर रोड, गड़हनी, उदवन्तनगर, भोजपुर (802206)
- **Consultants:** Dr. Madan Mohan Dwivedi & Dr. Chandan Kr. Dwivedi.
- **Reference implementation:** `app/` (PySide6 + SQLite, v2.0, phases 1–10 archived under `.planning/milestones/v2.0-restart-phases/`).
- **Open-source references to study (not audited, verify licence and offline behaviour before reuse):** Open Hospital, ICTHospital, OpenEMR, GNU Health, VITALIt OS.
- **Data Policy:** 100% synthetic fictional patient records during development and demos.

## Constraints

- **Budget:** ₹22,000 maximum fixed ceiling.
- **Timeline:** 4–6 weeks total delivery window.
- **Stack:** React + TypeScript (single app), Python + FastAPI, PostgreSQL, local file storage.
- **Security:** Individual accounts; backend-enforced permissions on every endpoint; audit events for sensitive actions.
- **Deployment:** Installed once on the central server PC; other PCs use a browser over LAN; no internet dependency.
- **Build tooling:** Node.js is required only on the build machine to produce static frontend assets; the server PC serves the built assets and does not need Node. (Node is not currently installed on the dev machine.)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Centralized LAN server instead of per-PC installs | Shared records across reception and doctor PCs is the intended use case | — Pending hardware/LAN confirmation |
| React + TypeScript, ONE codebase with `/admin` `/reception` `/doctor` routes | Avoids maintaining three frontends within ₹22,000 | ✓ Approved by user 2026-10-30 |
| Python + FastAPI backend | Reuses existing Python domain logic; independent permission enforcement | ✓ Approved by user 2026-10-30 |
| PostgreSQL | Concurrent multi-PC writes, proper transactions | ✓ Approved by user 2026-10-30 |
| Backend enforces permissions; hiding screens is not security | Role UI is convenience only | ✓ Approved by user 2026-10-30 |
| Integer paise billing | Prevents floating-point rounding in accounts | ✓ Carried from v2.0 |
| 12-field form with dual signatures | Replicates the physical pad | ✓ Approved by client (v2.0) |
| PySide6 + SQLite desktop app | Superseded for v3.0; kept as reference only | ⚠️ Superseded |
| Plain HTTP transport on isolated LAN (D-01) | Eliminates root CA install on staff PCs; zero cert warnings on offline LAN | ✓ Approved by user 2026-10-30 (see 11-ENTRY-GATE.md EG-4) |
| Dedicated 600VA+ UPS with synchronous_commit = on (D-02) | Guarantees database durability against sudden Bhojpur grid cuts | ✓ Approved by user 2026-10-30 (see 11-ENTRY-GATE.md EG-2) |
| Strict doctor silo partitioning by doctor_id (D-03) | Doctors only view and manage patients and encounters assigned to them | ✓ Approved by user 2026-10-30 (see 11-ENTRY-GATE.md EG-6) |
| Strict default-deny for reception on clinical records (D-04) | Reception accesses demographics/billing; backend blocks SOAP notes/prescriptions | ✓ Approved by user 2026-10-30 (see 11-ENTRY-GATE.md EG-7) |
| Configurable receipt numbering cycle (D-05) | Indian FY (1 Apr – 31 Mar) default aligns with trust accounting compliance | ✓ Approved by user 2026-10-30 (see 11-ENTRY-GATE.md EG-8) |
| Payment reversals restricted to Admin role (D-06) | Requires mandatory reason; writes contra-record and immutable audit row | ✓ Approved by user 2026-10-30 (see 11-ENTRY-GATE.md EG-9) |
| 30-min idle timeout and 5-failure lockout (D-07) | 15-min lockout cooldown or Admin unlock balances workflow with security | ✓ Approved by user 2026-10-30 (see 11-ENTRY-GATE.md EG-10) |
| Optimistic concurrency via version_id with 409 and 1-click reload (D-08) | Prevents silent record overwrites during simultaneous edits | ✓ Approved by user 2026-10-30 (see 11-ENTRY-GATE.md EG-11) |
| Backend package layout and sync ORM (EG-14, EG-20) | `backend/src/kalyan_api` avoids legacy `app/` collision; sync ORM guarantees atomic audit commits | ✓ Approved by user 2026-10-30 (see 11-ENTRY-GATE.md EG-14, EG-20) |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-10-30 after starting milestone v3.0 (Centralized LAN Web Platform) - Phase 11 Entry Gate*
