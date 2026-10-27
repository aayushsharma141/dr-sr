# Roadmap: Kalyan Hospital Management System

## Overview

A structured 5-phase delivery plan to build a reliable, fully offline Windows desktop application for Kalyan Hospital, Ara, Bihar. Starting from a clean application shell, each phase delivers a testable, runnable milestone ending with complete offline verification and demo readiness.

## Phases

- [x] **Phase 1: App Shell & Dashboard Foundation** - Runnable PySide6 window with hospital branding, sidebar navigation, and live DB-backed metric cards.
- [x] **Phase 2: Patient Registration & Search** - SQLite schema initialization, atomic patient ID generation, registration form, photo storage, and instant search.
- [x] **Phase 3: Treatment Cases & Payment Tracking** - Multi-case tracking, chronological session logging, integer paise billing calculations, and balance ledger.
- [x] **Phase 4: A4 Print Preview, PDF Export & Local Backup** - Hospital-branded A4 registration card generator, PDF export, hot SQLite backup, and verified restore pipeline.
- [x] **Phase 5: Demo Hardening & Security Controls** - Role-based authentication, offline resilience verification, synthetic demo data seeder, and walkthrough readiness.

## Phase Details

### Phase 1: App Shell & Dashboard Foundation
**Goal**: Deliver a runnable PySide6 application window with hospital branding, responsive sidebar navigation, and live dashboard stat cards backed by the database layer.  
**Depends on**: Nothing (Initial Phase)  
**Requirements**: DASH-01, DASH-02, DASH-03  
**Success Criteria**:
  1. Main window launches cleanly in Windows without console errors.
  2. Sidebar accurately displays "KALYAN HOSPITAL" and "श्री वशिष्ठ कल्याण ट्रस्ट".
  3. Dashboard cards query the local database layer and display accurate zero counts on fresh launch.
  4. Sidebar buttons switch smoothly between placeholder views without application crash.
**Plans**: 2 plans

Plans:
- [x] 01-01: Environment setup, theme styling tokens, and QMainWindow shell with navigation sidebar.
- [x] 01-02: Live database connection initialization and dashboard view with metric query cards.

### Phase 2: Patient Registration & Search
**Goal**: Implement complete patient intake workflow backed by SQLite with persistent unique IDs and instant multi-field search.  
**Depends on**: Phase 1  
**Requirements**: PAT-01, PAT-02, PAT-03, PAT-04, PAT-05  
**Success Criteria**:
  1. System generates a unique `KH-YYYY-XXXX` ID on patient creation.
  2. Patient form saves valid demographic records and persists data after app restart.
  3. Optional patient photo is safely stored in local application directory without corruption.
  4. Searching by patient ID, name, or mobile filters records in < 50ms.
**Plans**: 2 plans

Plans:
- [x] 02-01: SQLite schema DDL, atomic sequence generator, patient repository, and validation service.
- [x] 02-02: Patient registration form UI, photo manager, and searchable patient list table view.

### Phase 3: Treatment Cases & Payment Tracking
**Goal**: Manage physiotherapy clinical case histories and implement a currency-safe ledger for agreed fees, installments, and outstanding balances.  
**Depends on**: Phase 2  
**Requirements**: TRT-01, TRT-02, TRT-03, BIL-01, BIL-02, BIL-03, BIL-04  
**Success Criteria**:
  1. Physiotherapy treatment cases can be opened and linked to any patient.
  2. Adding new treatment sessions preserves all past clinical notes chronologically.
  3. All monetary values are handled in integer paise, preventing floating-point discrepancies.
  4. Outstanding balance ($\text{Agreed Fee} - \sum\text{Payments}$) updates immediately and rejects negative payments.
**Plans**: 2 plans

Plans:
- [x] 03-01: Relational treatment repository, session logger, and currency-safe billing service.
- [x] 03-02: Treatment history UI, session logging dialog, payment ledger view, and dynamic balance card.

### Phase 4: A4 Print Preview, PDF Export & Local Backup
**Goal**: Implement official hospital-branded A4 patient registration printout and a fail-safe hot database backup and verified restore system.  
**Depends on**: Phase 3  
**Requirements**: PRN-01, PRN-02, PRN-03, BAK-01, BAK-02  
**Success Criteria**:
  1. Registration form renders on standard ISO A4 paper preview with exact hospital branding.
  2. Form includes dual bottom signatures (Patient / Attendant Signature and Authorized Signature) along with Date per authentic slip.
  3. User can export the document directly to a clean PDF file.
  4. Local backup creates an uncorrupted SQLite snapshot via Online Backup API.
  5. Restore pipeline tests database integrity in scratch DB before replacing active live data.
**Plans**: 2 plans

Plans:
- [x] 04-01: A4 HTML/QTextDocument builder, QPrintPreviewDialog, and PDF export manager.
- [x] 04-02: Hot SQLite backup service, backup manager UI, and isolated restore verification test pipeline.

### Phase 5: Demo Hardening & Security Controls
**Goal**: Protect administrative actions, verify complete offline operation, and prepare a 5-minute repeatable demonstration dataset for the client.  
**Depends on**: Phase 4  
**Requirements**: SEC-01, SEC-02  
**Success Criteria**:
  1. PBKDF2-hashed administrator credentials protect database restore and financial overrides.
  2. Full suite of automated and manual tests passes with all network adapters disabled.
  3. Demo reset utility seeds 5 realistic fictional patients with full treatment histories in < 1s.
  4. 5-minute client demo script rehearsal executes without glitches or pending operations.
**Plans**: 2 plans

Plans:
- [x] 05-01: PBKDF2 authentication service, permission guard dialogs, and offline regression test suite.
- [x] 05-02: Synthetic demo dataset generator, reset utility, and client walkthrough script.

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. App Shell & Dashboard | 2/2 | Complete | 2026-10-28 |
| 2. Patient Registration & Search | 2/2 | Complete | 2026-10-28 |
| 3. Treatment Cases & Payments | 2/2 | Complete | 2026-10-28 |
| 4. A4 Printing & Local Backup | 2/2 | Complete | 2026-10-28 |
| 5. Demo Hardening & Security | 2/2 | Complete | 2026-10-28 |

---
*Roadmap created: 2026-10-28*
