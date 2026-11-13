# Phase 11: Decisions Gate Register

**Phase:** 11-decisions-gate-foundation-auth  
**Date:** 2026-10-30  
**Status Key:**  

- `LOCKED`: Decided by project owner in `11-CONTEXT.md` (2026-10-30).  
- `DECIDED-BY-USER`: Formally approved user requirement or policy decision.  
- `DEFAULT`: Architectural assumption in force until confirmed by the named owner.  
- `CONFIRMED`: Formally confirmed by client/trust stakeholder.  
*(Note: Per ROADMAP Success Criterion 1, no item in this register may have status OPEN).*

---

## 1. Entry-Gate Decision Register

| ID | Item | Decision / default | Status | Source | Owner | Confirm by | If it changes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| EG-1 | Server hardware | Dedicated always-on Windows PC, >= 4 GB RAM, SSD preferred, second physical drive/USB for backups, no daily-use login | DEFAULT | PROJECT.md "not yet confirmed" | Trust administrator | before Phase 17 | Sizing, backup target |
| EG-2 | UPS | 600VA+ line-interactive UPS on the server; `synchronous_commit = on` | LOCKED | CONTEXT D-02 | Trust administrator | before Phase 17 | Costly: durability config. No UPS -> written risk acceptance |
| EG-3 | Fixed IP / name | DHCP reservation (example 192.168.1.50); optional single-label alias `kalyan-server` via hosts file; never a fake FQDN | DEFAULT | CONTEXT D-01 example | Trust administrator / project owner | before Phase 17 | Bookmarks, firewall rule |
| EG-4 | Transport | Plain HTTP on the isolated LAN; client PCs install no certificate; HTTPS deferred (FUT-01) | LOCKED | CONTEXT D-01, Deferred | Project owner | - | Cookie `Secure`/`__Host-` flip; webcam capture becomes possible |
| EG-5 | Network isolation condition | Wired or staff-only Wi-Fi; no guest/patient devices on the subnet; no router port-forwarding | DEFAULT | RISK-01 | Trust administrator | before Phase 17 | RISK-01 likelihood |
| EG-6 | Doctor visibility | Strict silo by `doctor_id` (supersedes the ROADMAP "recommended: read yes, write only own"); reassignment of a patient to the other doctor = Admin-only, audited | LOCKED | CONTEXT D-03 | Both consultants + trust administrator | before Phase 13 | One-way: scopes across all clinical tables |
| EG-7 | Role/permission matrix | Pattern 1 tables; Reception has no clinical permission (D-04); Admin has no clinical-content permission and uses only `/admin`. Phase 20 Revision (D-20-15, 2026-11-07): Clinical content is permitted for audited administrative export via POST /api/admin/exports with a mandatory documented reason. Admin UI screens remain strictly denied direct clinical record viewing. | LOCKED | CONTEXT D-04, D-20-15 | Trust administrator | before Phase 13 | Matrix snapshot test + ROLE_PERMISSIONS |
| EG-8 | Receipt numbering year | Configurable in Admin Panel; default Indian FY (`RCPT-2627-XXXX`, 1 Apr – 31 Mar), alternative calendar year | LOCKED | CONTEXT D-05 | Trust accountant | before Phase 15 | Costly: billing sequence generators |
| EG-9 | Who authorises reversals | Admin only, mandatory reason, contra-record in billing ledger, audit row | LOCKED | CONTEXT D-06 | Trust administrator | before Phase 15 | Permission `payment:reverse` |
| EG-10 | Session & lockout | 30 min idle, 5 failures -> 15 min lock, admin unlock (D-07); defaults: 12 h absolute, min password 10, per-IP throttle 20 failures/15 min, multiple concurrent sessions | LOCKED | CONTEXT D-07 | Project owner (trust administrator informed) | before Phase 17 | Settings only |
| EG-11 | Concurrency UX | `version_id` + 409 + "Record was modified by another user" + 1-click reload | LOCKED | CONTEXT D-08 | Project owner | - | - |
| EG-12 | Audit tamper-evidence | Append-only (triggers + INSERT-only runtime role); no hash chain; daily digest in backup manifest considered for Phase 16 | DEFAULT | Pattern 7 | Project owner | before Phase 16 | Phase 16 scope |
| EG-13 | Real v2.0 data to migrate | None assumed (PROJECT.md: synthetic data); clean start for v3.0 | DEFAULT | REQUIREMENTS "Open Decisions" | Project owner | before Phase 12 | FUT-03 |
| EG-14 | Package layout | Adopt `backend/src/kalyan_api` package layout instead of `backend/app` to avoid namespace collision with legacy root `app/` | DEFAULT | RESEARCH A1 | Project owner | - | Import paths in backend |
| EG-15 | Doctor stub table | Stub `doctors` table in baseline Alembic migration `0001` so `users.doctor_id` and D-03 silo helpers are testable from Phase 11; role change to/from DOCTOR rejected (409) | DEFAULT | RESEARCH A5 | Project owner | before Phase 12 | Schema migration in Phase 12 |
| EG-16 | Admin least privilege | Admin has no clinical-content permission and only the `/admin` dashboard in Phase 11 (least privilege) | DEFAULT | RESEARCH A2 | Trust administrator | before Phase 13 | Role permission matrix snapshot |
| EG-17 | First-run setup mechanism | First-run web wizard, protected by setup-mode-only availability and a one-time server-console setup code (SEC-07, SC-6). Singleton `system_setup` table ensures atomic single-admin creation; `create-admin` dropped; `reset-admin-password` kept for console recovery | DECIDED-BY-USER | User decision 2026-10-30 | Project owner | - | Setup flow & auth recovery |
| EG-18 | Patient reassignment authority | Reassigning a patient between the two consultants under the D-03 silo is Admin-only and audited | DEFAULT | RESEARCH A6 | Both consultants | before Phase 13 | Encounter assignment logic |
| EG-19 | Session & password policy | Absolute session limit 12 h, touch throttle 60 s, password policy (min 10, max 128, ~100-entry blocklist, 12-char temp passwords), per-IP throttle 20 failures / 15 min | DEFAULT | RESEARCH A3, A4 | Project owner | before Phase 17 | Config settings |
| EG-20 | Backend stack & sync ORM | Sync SQLAlchemy 2.0.55 + psycopg 3.3.6 + FastAPI 0.162.0 pinned; same-transaction atomic audit writing; canary tests; no separate UI-SPEC | DEFAULT | RESEARCH A8 | Project owner | - | Backend dependencies |

---

## 2. Accepted Risks

### RISK-01: Plaintext Credentials and Session on the LAN

- **Risk Statement:** Under D-01 (plain HTTP on the LAN), login passwords, temporary passwords, the session cookie, and all patient records traverse the local network unencrypted. Anyone with access to the LAN segment (ARP spoofing, compromised PC, unauthorized Wi-Fi connection) could intercept credentials or session cookies.
- **Likelihood:** Low-to-moderate on a dedicated, switched, staff-only wired network.
- **Impact:** High (unauthorized exposure of patient health information).
- **Owner:** Recorded by Project Owner; accepted by Trust Administrator.
- **Review Triggers:** Introduction of Wi-Fi or guest devices on the subnet, router replacement, remote-access requests, or implementation of FUT-01 (HTTPS).
- **Compensating Mitigations (8 in-scope controls):**
  1. *Subnet Isolation Condition:* Strict physical separation: wired or staff-only Wi-Fi, zero guest devices on the subnet, no router port-forwarding to the internet.
  2. *Host Firewall Rules:* Windows Firewall inbound rule for TCP 8000 restricted to the hospital LAN subnet and Private profile; PostgreSQL listening strictly on `127.0.0.1`.
  3. *Per-Person Accounts & Forced Rotation:* Individual accounts for all staff, mandatory password change at first login, random server-generated temporary passwords shown once.
  4. *Session Hardening:* 30-min sliding idle timeout, 12 h absolute session cap, server-side revocation, `HttpOnly` and `SameSite=Strict` cookie, per-session CSRF token in memory.
  5. *Brute-Force Throttling:* 5 failed logins triggers a 15-minute account lockout; per-IP request throttling blocks automated guessing.
  6. *Immutable Audit Trail:* Every login, failed attempt, lockout, and administrative action is written to append-only `audit_logs`.
  7. *Staff Device Rule:* Operational clinic policy forbidding login from personal smartphones or unauthorized laptops.
  8. *Permanent Browser Indicator:* Staff informed that browser will display "Not secure" indicator due to plain HTTP on LAN.

### RISK-02: Server PC as Single Point of Failure

- **Risk Statement:** With a centralized LAN deployment, if the reception server PC suffers hardware failure or corruption, all connected workstations lose system access.
- **Likelihood:** Moderate over a multi-year horizon.
- **Impact:** High (disruption of clinic operations).
- **Mitigation & Runbook:** Dual physical backup targets (secondary physical drive / USB storage), daily checksummed backups (Phase 16), physical paper-pad clinical fallback forms, and tested bare-metal restore runbook (Phases 16-17).

### RISK-03: Account Lockout Denial-of-Service

- **Risk Statement:** An attacker on the local network could deliberately submit 5 incorrect passwords for a known user (e.g. Dr. Dwivedi), locking their account for 15 minutes.
- **Likelihood:** Low in an internal clinic setting.
- **Impact:** Moderate (temporary inconvenience to the practitioner).
- **Mitigation:** Instant administrative unlock via the `/admin` user management dashboard, plus the server-side CLI recovery command (`reset-admin-password`).

---

## 3. Deferred and Out of Scope Ideas

- **FUT-01 (HTTPS with local CA / mkcert):** Deferred to post-v3.0 unless hospital network topology requires wireless untrusted links.
- **FUT-02 (Multi-doctor co-management / cross-case sharing):** Strict silo enforced for v3.0 per D-03.
- **FUT-03 (Legacy SQLite data migration):** Clean start for v3.0; legacy v2.0 desktop app retained as read-only historical archive if needed.

---

## 4. Evidence Convention Note

Client acknowledgement evidence (such as WhatsApp confirmations, signed handover notes, or email acknowledgements from Sri Vashishtha Kalyan Trust) will be recorded in the `Evidence` column upon final deployment verification.
