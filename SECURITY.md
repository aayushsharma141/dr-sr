# Security Policy — Kalyan Hospital v3.0

**Status:** Required target controls; implementation and acceptance evidence pending.

## 1. Objectives and threat model

Protect patient confidentiality, prevent unauthorized clinical/financial changes, preserve attribution and recover from device/data loss. LAN-only does not mean inherently secure.

Assume shared/unattended workstations, direct API probing, concurrent edits, disconnects during writes, power loss, corrupt/lost backup drives and accidental or malicious staff actions. Full compromise of server OS/physical administrator is outside initial protection boundary and must be documented as residual risk.

## 2. Authentication

- Individual staff accounts; no shared or default production credentials.
- Passwords stored using Argon2id or approved modern password hashing, never plaintext/reversible.
- First login after reset forces password change.
- Idle expiry, logout invalidation, failed-login rate limiting/lockout and security audit.
- Deactivation blocks login, revokes sessions and preserves historical actor identity.
- Password resets are authorized and audited.

### First-run setup wizard

- Enabled only when no administrator exists.
- Cryptographically random one-time setup code printed only to local server console.
- Short expiry, safe storage (preferably hash), rate limiting and atomic consumption.
- Concurrent setup attempts must create exactly one administrator.
- Successful setup permanently disables public bootstrap endpoints.
- Recovery requires local server CLI access; never implement hidden HTTP backdoor or hardcoded master password.

## 3. Server-side authorization

Every protected API endpoint, patient object and file access must enforce permissions on the backend. Frontend route guards are usability only. Fixed Admin, Reception and Doctor roles; no custom permission editor in v1. A route/permission coverage test fails if any protected endpoint has no declared policy.

### Authoritative role matrix (v3 LAN)

| Capability | Admin | Reception | Doctor |
|---|---|---|---|
| Users, clinic settings, doctor/fee setup | Yes | No | No |
| Patient registration/demographic edit | Yes | Yes | Limited/pending |
| Patient search/photo access | Yes | Yes | Subject to patient policy |
| Appointments | Yes | Yes | Own queue/status |
| Clinical notes and addenda | Read/admin | No authoring | Authorized clinician |
| Prescription and treatment authoring | Read/admin | No | Assigned/authorized cases |
| Record payments | No (D-06/REC-04) | Yes | No |
| Authorize reversals | Yes | No | No |
| Read audit | Yes | No | No |
| Backup/restore | Yes | No | No |

*Note: In accordance with D-06, ADR-23, and PRD REC-04, separation of duties is strictly enforced: Reception exclusively collects and posts payments (`payment:create`). Admin holds read and authorized reversal permissions (`payment:read`, `payment:reverse`) but cannot collect payments (API returns HTTP 403). Doctor has zero billing permissions.*

Recommended doctor access: read clinically relevant records across doctors, write only assigned cases. Not yet client-approved.

## 4. Record integrity

Finalized encounters, prescriptions and sessions cannot be silently edited/deleted. Corrections are dated addenda with author/reason. Payments are append-only; reversal is a compensating event with Admin authorization and mandatory reason. Balances derive from ledger. Stale updates return HTTP 409. Patient demographic edits retain before/after audit values.

## 5. Audit events

Cover login success/failure, lockout, logout, password reset, user activation/deactivation, patient create/update, clinical finalization/addenda, prescriptions, appointment status, payment, reversal, receipt print/reprint, backup, verification and restore.

Minimum fields: actor, timestamp, action/outcome, entity type/id, request ID, reason where required, structured before/after values where applicable. Ordinary users cannot update/delete audit events. Never log passwords, setup codes, session tokens or unnecessary clinical narrative.

## 6. Network and server

Bind services to controlled LAN interface; firewall only required ports from trusted subnet. No router port forwarding/public exposure. HTTPS preferred. HTTP exception only with explicit client approval for isolated physically controlled LAN; it is unencrypted. Use secure cookies and CSRF protection where applicable. No runtime CDN, cloud auth or internet dependency.

## 7. Patient files

Private storage outside public web root; generated opaque names; validate content and size; path traversal prevention; checksum metadata; every download authorization-checked. Unauthorized file IDs must not reveal private file existence. Backup includes all referenced files.

## 8. Backup security

Database and patient files in one checksummed bundle. Access-controlled destinations and secure removable-drive storage. Stage and verify restore before live cutover; take pre-restore safety snapshot; scheduled failure visible to Admin. Clean-machine restore drill is mandatory.

## 9. Security acceptance tests

1. Anonymous users cannot access protected APIs/files.
2. Reception cannot call Admin-only user, audit, restore or reversal APIs directly.
3. Doctor cannot post payments or modify unassigned records under approved policy.
4. Every protected route has permission coverage.
5. Bootstrap is one-time and simultaneous submissions yield one success.
6. Lockout, idle timeout, reset and session revocation work.
7. Stale updates return 409.
8. Finalized clinical records and posted payments cannot be overwritten/deleted.
9. Audit is committed with sensitive mutation.
10. Corrupt backup cannot replace live data.
11. File authorization and path traversal tests pass.

## 10. Incident response

Isolate affected server/network; preserve logs, database and files before repair; do not overwrite only known-good backup; revoke affected sessions and reset credentials; restore only after verification; document timeline, impact and corrective action.

Report vulnerabilities privately. Never attach real patient data, passwords, setup codes or production backups to public issues.

---
*Requirements only. Do not claim security compliance until test evidence exists.*