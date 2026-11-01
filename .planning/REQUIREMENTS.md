# Requirements: Kalyan Hospital v3.0 Centralized LAN Web Platform

**Defined:** 2026-10-30  
**Last synchronized:** 2026-11-01  
**Core value:** Reliable, internet-free shared patient records for reception and doctors across the hospital LAN, enforced by server-side permissions, with auditable changes and a backup proven to restore.

**Status convention:** [x] means implemented and recorded complete; [~] means partially implemented or awaiting required coverage/mapping; [ ] means not yet implemented/verified. None of these statuses implies client acceptance or deployment sign-off.

## v1 Requirements

### Foundation and Security

- [x] **SEC-01** Individual accounts and role-specific dashboards/routes.
- [x] **SEC-02** Server-side API permission enforcement and route policy coverage.
- [x] **SEC-03** Fixed Admin, Reception and Doctor roles.
- [x] **SEC-04** Idle/session expiry and repeated-failure lockout.
- [x] **SEC-05** Admin user create/deactivate/reset, forced first-login password change and no default production credentials.
- [x] **SEC-06** Optimistic concurrency; stale updates return conflict response.
- [x] **SEC-07** First-run setup wizard with one-time server-console code, atomic first-admin creation and permanent public bootstrap shutdown.
- [~] **AUD-01** Audit-event writer and append-only audit foundation implemented in Phase 11; full event coverage across future clinical, billing and backup modules remains incomplete through Phases 14–16.

### Clinic Setup

- [x] **SET-01** Admin configures English/Hindi clinic identity, branch addresses, phone and print header/footer.
- [x] **SET-02** Admin maintains doctor profiles.
- [x] **SET-03** Admin maintains consultation fee catalogue.

### Reception: Patients and Appointments

- [~] **PAT-01** Current patient registration schema and unique annual `KH-YYYY-XXXX` URN allocation under concurrency are implemented; exact mapping to all client-provided registration-form fields remains unresolved.
- [x] **PAT-02** Search by URN, name and mobile, including Devanagari names.
- [x] **PAT-03** Demographic edits audited with before/after values and optimistic concurrency.
- [x] **PAT-04** Duplicate-patient warning for same name and mobile.
- [x] **PAT-05** Server-side patient photo storage and authenticated, permission-checked streaming.
- [x] **APT-01** Per-doctor daily appointment booking with token number and doctor assignment.
- [x] **APT-02** Appointment status tracking and doctor-specific daily queue.
- [ ] **PRN-01** Final A4 registration card acceptance on the actual hospital printer with approved dual-signature layout. (Print spike exists; physical acceptance is Phase 17.)

### Doctor and Clinical

- [x] **CLN-01** Doctor records clinical encounters with notes.
- [x] **CLN-02** Finalized encounter notes are locked; later changes use dated addenda.
- [ ] **RX-01** Prescription items, dosage, advice and bilingual print output.
- [ ] **TRT-01** Treatment plans/packages.
- [ ] **TRT-02** Chronological physiotherapy session logs with VAS 0–10.
- [ ] **TRT-03** Finalized sessions immutable; corrections by dated addendum.
- [ ] **CLN-03** Unified timeline including encounters, sessions and payments.

### Billing

- [ ] **BIL-01** Consultation fees and installment payments by cash, UPI or card.
- [ ] **BIL-02** Integer-paise storage and concurrent negative/overpayment rejection.
- [ ] **BIL-03** Ledger-derived balances and pending-dues list.
- [ ] **BIL-04** Sequential receipts and DUPLICATE reprints.
- [ ] **BIL-05** Admin-authorized reversals with mandatory reason and immutable posted payments.

### Admin and Data Protection

- [ ] **AUD-02** Admin audit viewer with user/action/entity/date filters.
- [ ] **BAK-01** Manual and scheduled database+files backups with checksums to second drive.
- [ ] **BAK-02** Verified restore on a clean machine.
- [ ] **BAK-03** Integrity report for balances, URNs, orphan files and session counts.

### Deployment and Acceptance

- [ ] **DEP-01** Central server with 3–5 browser clients over LAN, no internet dependency.
- [ ] **DEP-02** Automatic service startup and recovery after power interruption.
- [ ] **DEP-03** Offline, permissions, integrity, real-printer and backup/restore acceptance.

## Deferred and later requirements

### v2 reporting/convenience
- **RPT-01** VAS trend chart per treatment plan.
- **RPT-02** Daily collection and printable dues report.
- **RPT-03** Missed-session list and treatment templates.
- **RPT-04** Canned Hindi advice and printable patient summary.
- **RPT-05** Backup-health banner.

### v4+
- **FUT-01** LAN HTTPS with in-browser webcam capture if not included in deployment baseline.
- **FUT-02** Document and scan attachments.
- **FUT-03** Conditional import of genuine legacy SQLite data.

## Out of scope

IPD, pharmacy inventory, laboratory, Aadhaar, SMS/WhatsApp, cloud backup, patient portal, ICD/FHIR/ABDM, insurance, GST invoicing pending trust status, custom per-user permission trees, drag-drop calendar, websockets and separate frontend installations per role.

## Open decisions

- Server hardware, OS, fixed IP and UPS; local certificate/HTTPS policy.
- Doctor silo and clinical visibility policy.
- Admin demographic-edit permission and patient-photo access policy.
- Reversal authority and receipt numbering year.
- Whether genuine v2 production data exists.
- Actual printer and final print sign-off.
- Idle timeout/lockout values and client acceptance.
- Backup schedule, retention and operational owner.

## Traceability

| Requirement | Phase | Implementation status |
|---|---:|---|
| SEC-01–SEC-07 | 11 | Recorded complete |
| AUD-01 | 11, 14–16 | Partial: Phase 11 writer/foundation recorded complete; full domain coverage remains planned/incomplete |
| SET-01–SET-03 | 12 | Recorded complete |
| PAT-01 | 12 | Partial: current API schema/URN implemented; client-form mapping outstanding |
| PAT-02–PAT-05 | 12 | Recorded complete; role policy findings remain |
| APT-01–APT-02 | 13 | Recorded complete |
| CLN-01–CLN-02 | 13 | Recorded complete |
| RX-01, TRT-01–TRT-03 | 14 | Planned |
| BIL-01–BIL-05, CLN-03 | 15 | Planned |
| AUD-02, BAK-01–BAK-03 | 16 | Planned |
| PRN-01, DEP-01–DEP-03 | 17 | Planned |

**Coverage:** All v1 requirements are mapped to a phase. Completion status is tracked separately from client approval and production acceptance.

---
*Requirement statuses synchronized with the recorded Phase 13 state on 2026-11-01.*
