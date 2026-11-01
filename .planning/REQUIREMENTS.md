# Requirements — Kalyan Hospital v3.0

**Defined:** 2026-11-01. **Status:** Proposed; client decisions pending.  
**Core value:** Shared, permission-controlled offline LAN records with auditable history and proven restore.

All requirements start Planned. Similar features in the old desktop application do not count as v3 completion.

## v1 requirements

### Security and identity
- [ ] SEC-01 Individual accounts and /admin, /reception, /doctor landing routes.
- [ ] SEC-02 Every protected API endpoint enforces permission server-side.
- [ ] SEC-03 Fixed Admin, Reception, Doctor permission catalogue.
- [ ] SEC-04 Idle timeout and lockout after repeated failed logins.
- [ ] SEC-05 Admin creates/deactivates users and resets passwords; first login forces change; no default credentials.
- [ ] SEC-06 Stale updates return conflict response.
- [ ] SEC-07 One-time first-admin console code, browser wizard, atomic consumption, permanent public setup shutdown and CLI-only recovery.

### Clinic setup
- [ ] SET-01 English/Hindi names, both addresses, phone and print header/footer.
- [ ] SET-02 Doctor profiles: name, qualification, registration number.
- [ ] SET-03 Consultation fee catalogue with effective dates and audit.

### Reception and registry
- [ ] PAT-01 Canonical 12 fields and unique KH-YYYY-XXXX under concurrency; define rollback/void gap semantics.
- [ ] PAT-02 Search URN/name/mobile; Devanagari supported.
- [ ] PAT-03 Demographic edits audited before/after.
- [ ] PAT-04 Duplicate warning for same name + mobile.
- [ ] PAT-05 Server-side patient photos, authorized reads only.
- [ ] APT-01 Daily per-doctor appointment with token and assignment.
- [ ] APT-02 Booked, Arrived, In consultation, Done, Cancelled, No-show; doctor queue.
- [ ] PRN-01 A4 registration card with dual signatures; actual printer test.

### Clinical
- [ ] CLN-01 Dated clinical encounters and notes.
- [ ] CLN-02 Finalized notes immutable; corrections as dated addenda.
- [ ] RX-01 Prescriptions with medicines, dosage and advice; English content/static Hindi labels.
- [ ] TRT-01 Treatment plan/package.
- [ ] TRT-02 Chronological sessions with VAS 0–10, clinician, modalities and notes.
- [ ] TRT-03 Finalized sessions immutable; corrections by addendum.
- [ ] CLN-03 Chronological timeline of encounters, sessions and payments.

### Billing
- [ ] BIL-01 Consultation fees/installments: cash, UPI, card.
- [ ] BIL-02 Integer paise; reject negative/overpayment including concurrent two-PC attempts.
- [ ] BIL-03 Balances computed from ledger, never editable.
- [ ] BIL-04 Sequential receipts; reprints marked DUPLICATE.
- [ ] BIL-05 Admin-authorized reversal with mandatory reason; no silent deletion/edit.

### Audit and backup
- [ ] AUD-01 Append-only audit for security, patient, clinical, billing and backup.
- [ ] AUD-02 Admin filters by user, action, entity and date.
- [ ] BAK-01 Database + files bundle, checksums, manual/scheduled backup, second drive.
- [ ] BAK-02 Clean-machine restore verification as handover gate.
- [ ] BAK-03 Integrity report: ledger, URN gaps/duplicates, orphan files, session counts.

### Deployment
- [ ] DEP-01 Central server and 3–5 browser PCs on LAN, no internet dependency.
- [ ] DEP-02 Auto-start after power restoration and recover without routine manual steps.
- [ ] DEP-03 Offline, permissions, integrity, actual printer and backup/restore acceptance.

## v2 deferred
- [ ] RPT-01 VAS trend chart per treatment plan.
- [ ] RPT-02 Daily collection report and printable dues follow-up.
- [ ] RPT-03 Missed-session list and treatment-plan templates.
- [ ] RPT-04 Canned Hindi advice and printable patient summary.
- [ ] RPT-05 Backup health banner.

## v4+ future
- [ ] FUT-01 LAN HTTPS with in-browser webcam if not included in v1 deployment approval.
- [ ] FUT-02 Document/scan attachments.
- [ ] FUT-03 SQLite-to-PostgreSQL migration only if real legacy data exists and is approved.

## Exclusions

IPD, pharmacy, laboratory, advanced ERP, Aadhaar, SMS/WhatsApp, cloud backup, patient portal, ICD/FHIR/ABDM, insurance, GST invoicing pending trust status, custom per-user permission builder, drag/drop calendar, websocket live updates and separate installed clients.

## Traceability

| Requirement group | Phase |
|---|---|
| SEC and bootstrap | 11 |
| SET, PAT, PRN | 12 |
| APT | 13 |
| CLN, RX, TRT | 14 |
| BIL | 15 |
| AUD, BAK | 16 |
| DEP | 17 |

## Definition of done

Code merged; automated tests cover normal, invalid, unauthorized and concurrent paths; acceptance criteria evidenced; no unresolved critical security/data-loss issue; verification evidence recorded; manual hardware/printer/restore checks completed where applicable; client approval obtained.

---
*All v3 requirements begin Planned; legacy desktop checklists are historical only.*