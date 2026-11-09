# Security model — Kalyan Hospital

This document describes what the system protects, how, and where the boundaries are. It is
written to be read by the clinic's administrator, not only by a developer.

---

## 1. Scope and assumptions

* The server PC lives **inside the clinic** and is reachable only from the clinic LAN.
* The LAN is trusted for availability, **not** for confidentiality: assume any PC on it could
  be compromised, and that staff accounts are shared at the front desk.
* There is no internet connection. Nothing is sent to a third party, no telemetry, no CDN, no
  web fonts, no external JavaScript. The Content-Security-Policy enforces
  `default-src 'self'`, so a stray remote resource cannot load even if code tried.
* Physical access to the server PC is treated as administrator-equivalent (it can read the
  data folder). Protect it accordingly.

Explicitly **out of scope**: an attacker who already has administrator rights on the server PC
or a filesystem copy of `data/`, malware on a workstation, and network sniffing on the LAN.

---

## 2. Authentication

| Control | Implementation |
|---|---|
| Password hashing | `scrypt` (N=32768, r=8, p=1, 32-byte key, 16-byte random salt per password), constant-time verification. Format: `scrypt$N$r$p$salt$hash`. Stored in `users.password_hash`. |
| Password policy | ≥12 characters, at least 3 of {lower, upper, digit, symbol}, rejected against a common-password list, must not contain the username or the person's name. Enforced on bootstrap, account creation, reset and self-service change. |
| Unknown usernames | A dummy scrypt verification runs so response timing does not reveal whether an account exists. Error text is identical for unknown user and wrong password. |
| Login throttling | 8 attempts per 10 minutes per IP **and** per username, in memory (resets on restart). 10 consecutive failures on one account lock it for 15 minutes. |
| Sessions | 32-byte random token (`base64url`). Only `sha256(token)` is stored in `sessions`, so a leaked database file cannot be replayed as a live session. |
| Session lifetime | 20 minutes idle (sliding) and 12 hours absolute, both configurable. Expired sessions are purged every 15 minutes. |
| Session revocation | Deactivating a user, resetting their password, or changing their own password deletes their sessions server-side. |
| Transport in the browser | The SPA keeps the token in `sessionStorage` and sends it as `X-Session-Token`; the server also sets an `HttpOnly; SameSite=Strict` cookie as a reload fallback. |
| Multi-factor | **Not implemented.** Compensating controls: role separation, audit trail, short session life. |

### First-run bootstrap

The first administrator can only be created with a one-time code printed on the server console:

* stored only as `sha256(code)`, with an expiry (60 min) and 10-attempt cap;
* destroyed the instant setup succeeds;
* `POST /api/bootstrap/complete` returns `410 Gone` for the rest of the system's life;
* regenerating a code requires restarting the server (physical access) or clicking through to
  `/setup` after expiry, which reprints on the console only.

Recovery when all admins are locked out is a **console** command
(`npm run users -- reset <username>`) — deliberately unreachable over HTTP.

---

## 3. Authorisation

Permissions are checked in the route handlers (`requirePerm(...)`), not only in the UI.
Hiding a button is a convenience; the API is the boundary.

| Permission | Admin | Doctor | Nurse | Reception |
|---|:--:|:--:|:--:|:--:|
| `patient.read` / `patient.write` | ✅ | ✅ | read | ✅ |
| `clinical.read` (notes, diagnoses, prescriptions) | ✅ | ✅ | ✅ | ❌ |
| `clinical.write` | ✅ | ✅ | ✅ | ❌ |
| `vitals.write` | ✅ | ✅ | ✅ | ❌ |
| `attachment.read` / `attachment.write` | ✅ | ✅ | ✅ | ✅ |
| `visit.read` / `visit.write` | ✅ | ✅ | ✅ | ✅ |
| `appointment.read` / `appointment.write` | ✅ | ✅ | read | ✅ |
| `billing.read` | ✅ | ✅ | ❌ | ✅ |
| `billing.write` | ✅ | ❌ | ❌ | ✅ |
| `billing.void` (void invoices / payments) | ✅ | ❌ | ❌ | ❌ |
| `report.read` / `export.data` | ✅ | ✅ | ❌ | ✅ |
| `user.manage`, `audit.read`, `backup.manage`, `settings.manage` | ✅ | ❌ | ❌ | ❌ |

Guard rails against self-inflicted lockout: an administrator cannot deactivate or demote
themselves, and the last active administrator cannot be disabled or demoted.

Reception staff calling a clinical endpoint receive `403`; the patient chart they can open
simply contains no clinical sections (verified by an automated test).

---

## 4. Web application protections

| Threat | Control |
|---|---|
| CSRF | Header-token requests are immune (no other origin can set the header). Cookie-authenticated unsafe requests must also carry `X-CSRF-Token` matching the session's CSRF value. |
| Cross-origin writes | Unsafe methods are rejected unless `Origin` matches the serving host (or is listed in `KH_TRUSTED_ORIGINS`). |
| XSS | All user data is HTML-escaped by a single `esc()` helper before interpolation; no `innerHTML` of raw user input; strict CSP (`script-src 'self'`, no `unsafe-inline` for scripts). |
| Clickjacking | `frame-ancestors 'none'` + `X-Frame-Options: DENY` by default. |
| MIME sniffing | `X-Content-Type-Options: nosniff`; documents are additionally served with `Content-Security-Policy: sandbox` and as `attachment`. |
| SQL injection | Every query uses bound parameters; no string concatenation of user input. `trusted_schema=OFF`. |
| Oversized requests | JSON bodies capped at 1 MB; uploads capped at 25 MB (configurable); a 413 is returned cleanly. |
| Directory traversal | Download filenames come from the database, never from the request; stored names are UUIDs; original names are sanitised before storage. |
| Malicious uploads | MIME allow-list, magic-byte sniffing that must agree with the declared type, and downloads always forced as attachments so an uploaded HTML/SVG cannot execute in the app's origin. |
| Error leakage | Client gets a generic 500 message plus a request id; the stack goes to `data/logs/server-YYYY-MM-DD.log` only. |
| Brute force | See throttling above; per-IP and per-account. |
| Session fixation | A fresh token is issued at login; the token is never accepted from a URL or form field. |

---

## 5. Data protection at rest

| Asset | Protection |
|---|---|
| `data/kalyan.db` | SQLite file, mode `0600`, directory `0700` on Linux/macOS. **Not encrypted by the application** — rely on OS/disk encryption (BitLocker / LUKS) for at-rest protection. |
| `data/uploads/*.khc` | Each document is encrypted with AES-256-GCM (authenticated) under a 32-byte key in `data/keys/attachments.key` (mode `0600`). Plaintext is never written to disk. A SHA-256 of the plaintext is stored to detect tampering on download. |
| `data/backups/*.khb` | Tar archive (manifest + database + encrypted documents) encrypted with AES-256-GCM under `data/keys/backup.key`. |
| Off-site export | Re-encrypted with a passphrase you type (scrypt-derived key), so the copy is useless without the passphrase. |
| Logs | Contain usernames, IPs and error stacks — **no clinical content**. |

Key management rules (see docs/OPERATIONS.md for the drill):

1. Keep `data/keys/` **with** the server, not with the backups. A backup file plus the key
   file is equivalent to the whole database.
2. Store off-site exports away from the building, and keep their passphrase in a sealed
   envelope in the clinic safe.
3. Losing `attachments.key` means documents cannot be decrypted — the database survives, the
   files do not. Include `data/keys/` in any disaster-recovery plan, separately.

---

## 6. Audit trail

Every security-relevant action is appended to `audit_log`:
sign-ins and failures, chart views, patient edits, note signing, document upload/view/download,
invoice and payment creation, voiding, staff account changes, settings changes, backup
creation and export, audit export, and setup.

Each row carries `prev_hash` and `hash = sha256(prev_hash ‖ canonical fields)`. Any edit,
deletion or reordering breaks verification:

```
npm run audit:verify                       # console, exits 1 if broken
GET  /api/admin/audit/verify               # in-app banner on the Audit trail page
```

The log is append-only by convention (the application never updates or deletes audit rows) and
shows a red warning in the UI the moment the chain does not verify. An automated test proves
that tampering is detected.

---

## 7. Backup and recovery

* Nightly at 22:15 local time (`KH_BACKUP_HOUR`), plus on demand; the last 30 are kept.
* `VACUUM INTO` produces a consistent snapshot while the server keeps serving requests.
* Restores are validated (SQLite `quick_check`, patient count) **before** the live data is
  replaced, and the previous data is moved aside rather than deleted.

---

## 8. Known limitations (accept these consciously)

1. **HTTP, not HTTPS, on the LAN.** Traffic between PCs and the server is unencrypted. On a
   switched clinic LAN with no guest access this is a normal trade-off; if you need transport
   encryption, terminate TLS in a reverse proxy (nginx/Caddy) in front of port 3000 and set
   `KH_FRAME_ANCESTORS` accordingly.
2. **The database file is not encrypted.** Use full-disk encryption on the server PC and keep
   it in a locked room.
3. **No MFA**, so a stolen password is enough to sign in until the account is disabled.
4. **In-memory login throttling** resets when the server restarts.
5. **Audit trail integrity is detectable, not immutable.** A determined insider with
   filesystem access could rewrite the whole chain; off-site exports are the defence.
6. **Single node.** No high availability; if the server PC dies, the clinic works from paper
   until it is restored (backups make that a short interruption).

---

## 9. Incident response checklist

1. **Suspected account compromise** — Admin → Staff accounts → *Disable* the account (kills its
   sessions immediately), then reset its password.
2. **Lost or stolen server PC** — treat all data as exposed. Restore the most recent off-site
   backup onto a new machine and change every password.
3. **Lost or stolen workstation** — nothing is stored on workstations except an in-memory
   session token; if it was signed in, disable the account to end the session.
4. **Audit chain broken** — do not continue using the installation. Preserve
   `data/` as-is, restore from a known-good backup, and investigate who had filesystem access.
5. **Ransomware / disk failure** — stop the server, restore from off-site backup
   (`npm run restore -- <file>`), verify integrity, then re-enable the clinic.
6. **Wrong patient record opened** — this is visible in the audit trail (`patient.view`); note
   it in the clinic register and tell the administrator so it can be reviewed.

Report security issues with this system to the hospital administrator; do not file them in
public trackers while real patient data is involved.
