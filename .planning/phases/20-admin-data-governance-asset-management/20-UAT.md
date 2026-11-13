---
status: testing
phase: 20-admin-data-governance-asset-management
source:
  - 20-01-SUMMARY.md
  - 20-02-SUMMARY.md
  - 20-03-SUMMARY.md
  - 20-04-SUMMARY.md
  - 20-05-SUMMARY.md
  - 20-06-SUMMARY.md
  - 20-07-SUMMARY.md
  - 20-08-SUMMARY.md
started: 2026-11-08T04:26:00Z
updated: 2026-11-08T04:26:00Z
---

## Current Test

number: 2
name: Five-Section Admin Sidebar Navigation
expected: |
  Sign in as Admin. The admin sidebar displays Management Overview at the top followed by 5 clear, accessible sections:
  1. Hospital Configuration (Profile, Assets & Logo, Print Templates, Doctors & Fees)
  2. Patient & Data Governance (Record Correction, Import Centre, Export Centre)
  3. Billing & Finance (Reversals & Invoices)
  4. Users, Security & Governance (Users, Audit Trail, Sessions)
  5. System & Maintenance (System Status, Database Health, Backup & Restore)
  All links navigate cleanly without console errors or dead /admin redirects.
awaiting: user response

## Tests

### 1. Cold Start Smoke Test
expected: |
  Start the backend and frontend application servers from scratch. The backend boots without errors, database migrations up to head revision 0018 apply cleanly, and GET /api/health returns HTTP 200 with status "ok".
result: pass

### 2. Five-Section Admin Sidebar Navigation
expected: |
  Sign in as Admin. The admin sidebar displays Management Overview at the top followed by 5 clear, accessible sections:
  1. Hospital Configuration (Profile, Assets & Logo, Print Templates, Doctors & Fees)
  2. Patient & Data Governance (Record Correction, Import Centre, Export Centre)
  3. Billing & Finance (Reversals & Invoices)
  4. Users, Security & Governance (Users, Audit Trail, Sessions)
  5. System & Maintenance (System Status, Database Health, Backup & Restore)
  All links navigate cleanly without console errors or dead /admin redirects.
result: [pending]

### 3. Hospital Logo Crest Upload & Public Asset Delivery
expected: |
  Navigate to /admin/assets. The page displays the active hospital crest, total asset metrics, and an "Upload New Asset" button.
  Uploading an image (PNG, JPEG, WebP, SVG <= 10MB) assigns it as active, increments the logo version, and lists older logos in the version gallery with deactivation controls.
  The active logo renders publicly at GET /api/assets/active-logo without requiring an active session.
result: [pending]

### 4. Bilingual Print Template Editor with Live A4 Canvas Preview
expected: |
  Navigate to /admin/templates. Document tabs (Prescription, Receipt, Registration Card, Consultation Summary) allow switching templates.
  Editing the bilingual header and footer textareas (Hindi and English) immediately reflects changes on the proportional live A4 preview canvas.
  Saving updates the template with an audit trail, while conflicting edits from another session prompt a 409 conflict banner.
result: [pending]

### 5. Patient Record Correction with Historical Snapshot Isolation
expected: |
  Navigate to /admin/patients/correct. Server-side search finds patients by URN, Name, Mobile, or Legacy URN.
  The patient's URN is locked and clinical notes/allergies are read-only.
  Editing demographic fields opens a side-by-side Before/After diff modal highlighting modified fields in crimson and requiring a mandatory reason (min 5 chars).
  After saving, reprinting an existing receipt or prescription preserves the original patient snapshot details (marked DUPLICATE), while the registration card shows the newly corrected details.
result: [pending]

### 6. Patient Import Centre 8-Stage Staging Pipeline
expected: |
  Navigate to /admin/imports. An 8-stage stepper displays across the top (Upload -> Inspect -> Map -> Validate -> Resolve -> Preview -> Commit -> Reconcile).
  Uploading a CSV or XLSX spreadsheet inspects encoding and delimiters, allows mapping headers to canonical patient fields, and validates required demographic fields without inventing placeholder values.
  Duplicate candidate records default to "Skip Row" (existing patient records are never overwritten).
  Committing triggers an automated safety backup before writing, allocates gap-free sequential URNs (KH-YYYY-XXXX), and provides a downloadable error CSV in the Reconcile stage.
result: [pending]

### 7. Patient Export Centre with Formula Sanitization & Streaming
expected: |
  Navigate to /admin/exports. The export dialog supports date range, department, and search query filters.
  Clinical content checkboxes (encounters, vitals, prescriptions, sessions) are unchecked by default; checking any clinical field displays an amber security warning notice.
  Exporting in CSV or XLSX format requires a documented reason (min 5 chars), neutralizes spreadsheet formula injection characters (=, +, -, @) by prepending a single quote ('), and streams directly to the browser without caching files on the server disk.
result: [pending]

## Summary

total: 7
passed: 1
issues: 0
pending: 6
skipped: 0
blocked: 0

## Gaps

[none yet]

