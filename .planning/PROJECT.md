# Kalyan Hospital — Offline Patient & Physiotherapy Management System

## What This Is

A lightweight, 100% offline Windows desktop application built with Python, PySide6 (Qt 6), and SQLite 3 for Kalyan Hospital (operated by श्री वशिष्ठ कल्याण ट्रस्ट) in Ara, Bhojpur, Bihar. It streamlines patient registration, manages physiotherapy treatment cases and chronological clinical session notes, tracks package fees and payments with currency-safe arithmetic, generates hospital-branded A4 registration printouts, and provides verified local database backup and restore.

## Core Value

Reliable, zero-cloud offline patient registration, physiotherapy clinical history, and payment tracking on a single clinic computer with 100% data persistence and verifiable local backup.

## Business Context

- **Customer:** Kalyan Hospital / श्री वशिष्ठ कल्याण ट्रस्ट (Station Road, Ara, Bhojpur, Bihar).
- **Revenue model:** Fixed-price custom desktop software contract (₹22,000 total commercial ceiling).
- **Success metric:** 100% offline operation, reliable patient records retrieval, accurate balance calculation, client-accepted A4 registration printouts, and zero data corruption across restarts.
- **Strategy notes:** 6-week phased delivery with early working prototype demos after Stage B (Patient Registration) and Stage D (Printing & Backups).

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] **DASH-01**: Dashboard view showing real-time counts for total patients, today's registrations, active cases, and pending balances from SQLite.
- [ ] **PAT-01**: Sequential, human-readable unique patient ID generation (`KH-YYYY-XXXX`).
- [ ] **PAT-02**: Patient registration capturing name, age, sex, mobile, address, referral source, condition, and registration timestamp.
- [ ] **PAT-03**: Optional patient photo selection stored in local application data directory.
- [ ] **PAT-04**: Fast patient search by ID, name, or mobile number with immediate record reopening.
- [ ] **TRT-01**: Multi-case physiotherapy tracking linked to patient records.
- [ ] **TRT-02**: Chronological treatment sessions logging session timestamp, therapist name, notes, modalities, and pain scores.
- [ ] **TRT-03**: Preservation of historical treatment session notes when adding new sessions.
- [ ] **BIL-01**: Treatment fee package and payment tracking stored in integer paise.
- [ ] **BIL-02**: Dynamic outstanding balance calculation rejecting negative payments and overpayments.
- [ ] **PRN-01**: Hospital-branded A4 patient registration card print preview and PDF export reproducing official maroon header and clinician credentials.
- [ ] **PRN-02**: Reproduction of canonical 12 form fields + Patient Picture box + dual signatures (Patient/Attendant & Authorized Signature) + Date.
- [ ] **BAK-01**: Safe hot SQLite backup creation to designated local directory.
- [ ] **BAK-02**: Verified database restore pipeline with integrity check before active database replacement.
- [ ] **SEC-01**: Salted PBKDF2 password-hashed administrator login for sensitive clinic operations.

### Out of Scope

- **Cloud Hosting / Web Portal** — Excluded to guarantee 100% offline resilience and eliminate recurring cloud costs within ₹22,000 budget.
- **Multi-PC LAN Real-Time Networking** — Out of scope for v1 single-workstation contract; requires separate networking/concurrency agreement.
- **SMS / WhatsApp Gateway Automation** — Excluded to eliminate third-party telecom API costs and internet dependencies.
- **Full Hospital ERP & Inpatient Bed Allocation** — Focus is strictly outpatient registration and physiotherapy case management.
- **Hardware Biometric Scanners** — Standard Windows keyboard and mouse entry only.

## Context

- **Environment:** Single offline Windows 10/11 workstation at clinic reception in Ara, Bihar.
- **Hospital Identity:** KALYAN HOSPITAL — PHYSIOTHERAPY DEPARTMENT (श्री वशिष्ठ कल्याण ट्रस्ट द्वारा संचालित).
- **Clinics:**
  - Clinic 1: नवादा थाना के सामने वाली गली, आरा, भोजपुर (802301)
  - Clinic 2: श्रीरामपुर रोड, गड़हनी, उदवन्तनगर, भोजपुर (802206)
- **Consultants:** Dr. Madan Mohan Dwivedi & Dr. Chandan Kr. Dwivedi.
- **Data Policy:** 100% synthetic fictional patient records used during development and client demonstrations.

## Constraints

- **Budget:** ₹22,000 maximum fixed ceiling.
- **Timeline:** 4–6 weeks total delivery window.
- **Stack:** Python 3.10+, PySide6, SQLite 3.
- **Architecture:** Layered Service-Repository architecture separating UI, services, data repositories, and SQL.
- **Deployment:** Completely offline, self-contained local installation.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Python + PySide6 + SQLite | Zero recurring licensing, native desktop speed, rich Qt printing and PDF output | — Pending verification |
| Single-PC Offline Boundary | Matches clinic setup and preserves budget/timeline constraints | — Pending client demo |
| Integer Paise Billing | Prevents binary floating-point rounding errors in clinic accounts | — Pending implementation |
| 12-Field Form with Dual Signatures | Exact replication of official Kalyan Hospital physical pad and workflow | ✓ Approved by client |
| Hot SQLite Backup + Verified Restore | Prevents data loss during power outages and validates backup usability | — Pending implementation |

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
*Last updated: 2026-10-28 after initialization*
