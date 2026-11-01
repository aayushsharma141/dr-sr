# Security Threat Model

## Scope and assumptions

This threat model describes the v3 centralized offline LAN platform. It is a project engineering baseline, not a formal penetration-test report or a guarantee of regulatory compliance.

The clinic LAN is treated as a controlled but not inherently trustworthy network. A compromised client PC, malicious insider, stolen staff credentials, physical access to the server, malware, or power/storage failure can threaten confidentiality, integrity, or availability.

## Assets

- Patient identity and contact details.
- Patient photographs.
- Clinical encounters, prescriptions and physiotherapy records.
- Appointment queues and doctor assignment information.
- Staff credentials, sessions, and role assignments.
- Audit history and future financial ledgers/receipts.
- PostgreSQL database, patient files, backups, and recovery credentials.
- Clinic configuration, doctor profiles, and operational availability.

## Trust boundaries

1. Browser client to central API over the clinic LAN.
2. API process to PostgreSQL.
3. API process to private patient-file storage.
4. Staff identity/role to protected application operations.
5. Server host and local administrators to backup/recovery media.
6. Backup media and restored environment to production data.

## Threats and controls

| Threat | Required/recorded control | Residual concern |
|---|---|---|
| Unauthorized API access | Server-side permission enforcement | Verify every route and negative-role test |
| Credential guessing | Failed-login lockout and Argon2id password hashing are part of the v3 baseline | Confirm rate/lockout policy and operational recovery |
| Session theft or CSRF | Server-managed cookie sessions and CSRF protections | Verify cookie flags, session revocation, and deployment transport |
| Unauthorized photo access | Private storage and permission-gated photo route | Current role map grants PHOTO_READ only to Reception |
| Unauthorized demographic edits | PATIENT_UPDATE permission and versioned/audited edits | Current role map grants PATIENT_UPDATE only to Reception |
| Insider misuse | Individual accounts and audit-event writing | Audit viewer and routine review remain planned |
| Data loss/corruption | PostgreSQL central storage | Backup/restore and integrity phase remains planned |
| Server theft or physical compromise | Controlled server location and host access required | Physical security and disk encryption policy need deployment decision |
| LAN interception or rogue device | Restrict access to trusted clinic LAN | Network segmentation, firewall, and TLS policy need deployment verification |
| Malware/ransomware | Offline operation reduces external dependency | LAN-connected malware and removable media remain risks |
| Power failure | Recovery behavior must be tested | UPS and automated startup/recovery need deployment acceptance |

## Security acceptance checklist

- [ ] Confirm staff account lifecycle, password reset, lockout, and session revocation.
- [ ] Review every protected API route against the role-permission matrix.
- [ ] Resolve photo access and demographic-edit policy mismatches.
- [ ] Verify CSRF, cookie flags, and transport protections in the actual LAN deployment.
- [ ] Restrict server ports and database access to required hosts/processes.
- [ ] Decide and implement host disk encryption and physical access controls as appropriate.
- [ ] Verify database and patient-file backup consistency.
- [ ] Perform a restore drill and integrity verification.
- [ ] Test power loss/restart and backup-media handling.
- [ ] Complete a security review before production use.

## Explicit limitations

The project record does not establish that a formal penetration test, external security audit, legal compliance assessment, or production restore drill has been completed. Do not imply otherwise.
