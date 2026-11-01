# Security Policy — Kalyan Hospital v3.0

**Status:** Phase 11 security foundation and Phase 12–13 authorization controls are implemented. Remaining module-specific controls and deployment acceptance are pending. Client policy sign-off is still required.

## 1. Objectives and threat model

Protect patient confidentiality, prevent unauthorized clinical/financial changes, preserve attribution and recover from device/data loss. LAN-only does not mean inherently secure.

Assume shared/unattended workstations, direct API probing, concurrent edits, disconnects during writes, power loss, corrupt/lost backup drives and accidental or malicious staff actions. Full compromise of the server OS or physical administrator is outside the initial protection boundary and must be documented as residual risk.

## 2. Implemented authentication baseline

Phase 11 implementation includes:
- Individual staff accounts; fixed Admin, Reception and Doctor roles.
- Argon2id password hashing.
- HttpOnly session cookies and CSRF protections.
- Idle/session expiry and failed-login lockout controls.
- First-login password-change workflow.
- User creation, deactivation/reactivation, password reset and unlock operations.
- One-time first-admin setup using a code shown on the local server console, with atomic consumption and permanent public bootstrap shutdown after successful setup.
- Local administrative CLI recovery; no hidden HTTP recovery backdoor.

Verify exact timeout, lockout and password-policy values from current configuration before client sign-off. Never log or commit passwords, setup codes, session tokens or production secrets.

## 3. Server-side authorization

The backend permission catalogue is defined in `backend/src/kalyan_api/core/permissions.py`; enforcement is implemented through backend policy dependencies. Frontend route guards are usability controls, not the security boundary.

### Current role mapping (source-derived)

| Capability | Admin | Reception | Doctor |
|---|---:|---:|---:|
| User administration | Yes | No | No |
| Clinic settings / doctor / fee management | Yes | No | No |
| Patient read | Yes | Yes | Yes |
| Patient create | No | Yes | No |
| Patient demographic update | No | Yes | No |
| Patient photo upload | No | Yes | No |
| Patient photo read | **No** | **Yes** | **No** |
| Appointment read | Yes | Yes | Yes |
| Appointment write | No | Yes | Yes |
| Clinical encounter read/write | No | No | Yes |
| Payment and reversal permissions | Reserved for Phase 15; current catalogue entries are not proof of completed billing |
| Audit / backup permissions | Reserved for Phase 16; current catalogue entries are not proof of completed audit viewer or backup UI |

This table describes the current `ROLE_PERMISSIONS` mapping, not a client-approved policy.

### Tracked permission findings

1. **PHOTO_READ mismatch:** `GET /patients/{id}/photo` requires `PHOTO_READ`, but the role map grants `PHOTO_READ` only to Reception. Admin and Doctor cannot use that endpoint through their current roles. Decide explicitly whether either role needs photo access; then update role grants and allowed/denied tests in a separate code change.
2. **Admin demographic edit:** `PATCH /patients/{id}` requires `PATIENT_UPDATE`; current role map grants it to Reception but not Admin. Confirm whether Admin should also edit demographics. Do not silently infer the answer.
3. **Doctor silo:** appointment and encounter APIs scope doctors to their own doctor ID; encounter reads/writes are doctor-owned. Reception is denied encounter access. This is implemented behavior, but the client must confirm that a strict silo is the intended clinical policy.

Any permission change must include both positive and negative API tests and update this matrix.

## 4. Record integrity and audit

Implemented through Phase 13:
- Patient demographic updates use version checks and record before/after audit values.
- Appointment status changes are validated, versioned and audited.
- Encounter drafts can be updated; finalized encounters are locked and corrections are dated addenda.
- Doctor-scoped clinical and appointment access is enforced.

Not yet complete:
- Full audit coverage across every future domain; Phase 11 provides the writer/foundation, while Phase 14–16 modules must add and test their own events.
- Prescription and physiotherapy-session immutability (Phase 14).
- Financial append-only ledger, reversals and receipt audit (Phase 15).
- Admin audit viewer and full audit-domain review (Phase 16).

Do not treat reserved permission enum values as proof that the corresponding business module exists.

## 5. Patient photo security

Photos are stored server-side and streamed through an authenticated endpoint protected by `PHOTO_READ`; uploads require `PHOTO_WRITE`. Reception currently has both grants. Admin and Doctor do not. Direct URL access must remain authenticated and permission-checked. Validate content, size, generated filenames, path traversal resistance and cleanup behavior with tests.

## 6. Network and server

Phase 17 must confirm:
- Bind services only to the intended LAN interface and restrict firewall access to the clinic subnet.
- No public exposure, router port forwarding, runtime CDN, cloud auth, telemetry or internet API.
- HTTPS is preferred; any HTTP exception must be explicit because HTTP is unencrypted.
- Stable LAN addressing, UPS, service auto-start and power-recovery behavior.
- Physical server access and OS administrator responsibilities.

## 7. Future financial controls — Phase 15

Require integer paise, ledger-derived balances, transactional overpayment protection under two-PC concurrency, sequential receipts, duplicate reprint markers, and reversal with a mandatory reason. The current permission catalogue reserves `PAYMENT_REVERSE` for Admin, but client approval of reversal authority is still pending (OD-03); do not treat the role mapping as client sign-off. No silent deletion or editing of posted payments.

## 8. Future audit and recovery controls — Phase 16/17

Require append-only audit review, PostgreSQL + referenced-file backup bundles, checksummed manifests, manual and scheduled backups to a second physical drive, staging verification, safe restore, pre-restore snapshot, integrity report and clean-machine restore drill.

## 9. Release security gates

Before production use:
- Re-run backend and frontend tests on the exact release SHA.
- Verify every protected route has a policy and test both allowed and denied role/action pairs.
- Resolve PHOTO_READ and Admin demographic-edit policy findings.
- Obtain client sign-off for doctor silo and role matrix.
- Complete Phase 14–16 controls and Phase 17 LAN/offline/restore acceptance.
- Record test logs, configuration, hardware and client approval.

---
*Security policy synchronized to the Phase 13 source and current permission catalogue on 2026-11-01.*
