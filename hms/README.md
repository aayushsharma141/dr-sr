# Kalyan Hospital — clinic management system (offline LAN)

A complete hospital/OPD system that runs on **one computer inside the clinic** and is used
from the browsers of 3–5 reception and doctor PCs on the same local network. It needs **no
internet connection** and sends nothing outside the building.

> **This installation is seeded with synthetic test data only.** No real patient
> information is included anywhere in this repository. See
> [docs/SYNTHETIC-DATA.md](docs/SYNTHETIC-DATA.md) before the clinic starts using it for
> real patients.

---

## What it does

| Area | What staff get |
|---|---|
| **Patients** | Registration with automatic MRN, search by name / MRN / phone, full demographic record, allergies (with severity flags), ongoing conditions, documents, timeline |
| **Clinical** | OPD/IPD/emergency visits, vitals with range validation, clinical notes that lock on signing, diagnoses with ICD-10 codes, prescriptions, printable prescription sheet |
| **Reception** | Appointment diary, check-in that opens a visit, queue on the dashboard, patient registration, billing and payments |
| **Billing** | Service catalogue, invoices, part payments, receipts (printable), voiding with a mandatory reason, daily collection report, outstanding balances |
| **Documents** | PDFs and images (lab reports, scans, consent forms) encrypted on disk, integrity-checked on download, every access audited |
| **Administration** | Staff accounts and roles, tamper-evident audit trail with CSV export, encrypted backups (nightly + on demand + off-site export), clinic settings |
| **Safety** | One-time console setup code for the first admin, role-based access, session timeouts, login throttling, CSRF/origin protection, hash-chained audit log |

Roles: **Administrator**, **Doctor**, **Reception** (ADR-17) — each with a fixed permission
set enforced on the server, not just hidden in the UI. Reception registers patients and takes
payments; doctors write the clinical record of their own visits; the administrator manages the
system and reverses payments but sees no clinical content.

---

## Quick start (on this computer, for a demo)

```bash
npm install            # needs internet once (prebuilt SQLite binary, no compiler)
npm run seed           # loads synthetic patients, visits, bills, appointments
npm start              # prints the server URL
```

Open <http://localhost:3000> and sign in with one of the demo accounts printed at the end of
`npm run seed` (all share the password `Kalyan#Clinic2026`):

| Username | Role |
|---|---|
| `admin` | Administrator |
| `dr.verma` | Doctor (Physiotherapy) |
| `dr.sinha` | Doctor (Physiotherapy) |
| `dr.ojha` | Doctor (Ophthalmology) |
| `reception` | Reception |

To see the **real first-run experience** instead (no data, setup code on the console):

```bash
rm -rf data        # Windows: rmdir /s /q data
npm start          # a ONE-TIME SETUP CODE is printed in the terminal
```

Then open <http://localhost:3000/setup> and create the first administrator with that code.

---

## First-run bootstrap (how the first admin is created safely)

1. On first start, with no accounts in the database, the server prints a one-time setup code
   **on its own console only** — never to a browser, log file or API response.
2. A browser opens `/setup` and submits the code with the new administrator's name, username
   and password. The code is stored hashed, is single-use, expires after 60 minutes, and is
   destroyed the moment setup completes.
3. After that, `POST /api/bootstrap/complete` returns **410 Gone** forever and the status
   endpoint reports `setupRequired: false`. There is no HTTP path back into bootstrap.
4. If every administrator is later locked out, the only way back in is the **local console**
   (`npm run users -- reset <username>`), which requires physical access to the server.

---

## Deployment on the clinic network (3–5 PCs)

Full step-by-step instructions for Windows are in **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.
The short version:

1. Pick one PC as the **server** (wired connection, always on).
2. Install Node.js LTS on it once — offline if needed, via the portable bundle
   (`npm run portable` on an internet-connected machine).
3. Start the server; it prints the LAN address to use, e.g. `http://192.168.1.24:3000`.
4. On the other PCs, just open that address in Chrome or Edge. Nothing to install.
5. Allow port 3000 through the server PC's firewall (the guide shows the command).

Operational routines — daily close, backups, restores, moving the server, recovering a
password — are in **[docs/OPERATIONS.md](docs/OPERATIONS.md)**.

---

## Architecture

```
   Reception PC 1 ─┐
   Reception PC 2 ─┤   HTTP (clinic LAN, no internet)
   Doctor PC 1    ─┼──────────────────────────────►  ┌──────────────────────────────┐
   Doctor PC 2    ─┤                                 │  Server PC (Node.js)         │
   Doctor PC 3    ─┘                                 │                              │
                                                     │  Express 5 API + static SPA  │
                                                     │  ├─ sessions / roles / audit │
                                                     │  ├─ SQLite (WAL)  kalyan.db  │
                                                     │  └─ data/uploads (AES-256)   │
                                                     └──────────────────────────────┘
                                                                 │
                                                     data/backups/*.khb  (nightly)
```

* **One process, one file database.** SQLite in WAL mode handles the read/write load of a
  3–5 workstation OPD comfortably, needs no database server to install or administer, and a
  backup is a single file.
* **No build step, no CDN.** The front end is plain ES modules + one hand-written stylesheet
  served by the same process. It works on an isolated network with no egress at all.
* **Two runtime dependencies**: `express` and `better-sqlite3` (pinned to `13.0.3`, which ships
  prebuilt binaries for current Node LTS releases, including Node 26, so no C++ toolchain is needed
  on clinic PCs). Node 22 or newer is required.

### Layout

```
server.js                 entry point: console banner, timers, graceful shutdown
src/
  app.js                  Express app assembly (security headers, routes, errors)
  config.js               env-driven configuration with safe defaults
  db.js  schema.sql       SQLite bootstrap, v1 baseline schema, upgrade runner, helpers
  migrations/             numbered schema upgrades (002-phase1-foundations.sql, ...)
  auth.js                 permissions, sessions, login throttling
  lib/                    crypto, audit chain, http/validation, tar, backups, logging
  routes/                 bootstrap, auth, patients, clinical, attachments,
                          appointments, billing, dashboard, admin
public/                   the browser app (index.html, css, js/views/*)
scripts/                  seed, backup, restore, users, audit-verify, make-portable
test/                     78 integration tests (node:test, no extra dependencies)
docs/                     deployment, operations, data model, API, security, testing
data/                     runtime data (git-ignored): database, uploads, keys, backups
```

---

## Security in one paragraph

Passwords use scrypt with per-password salts; sessions are random tokens stored only as
SHA-256 hashes with idle + absolute timeouts; state-changing requests need a same-origin
`Origin` and a token the browser never auto-attaches (so CSRF cannot work); uploaded
documents are encrypted with AES-256-GCM before touching the disk and are integrity-checked
when served through an audited endpoint; the audit log is hash-chained so any edit or deletion
of history is detectable; backups are encrypted at rest with a separate key, and off-site
copies are re-encrypted with a passphrase you choose. Rate limiting, account lockout, generic
login errors and a strict Content-Security-Policy round it out.

The full threat model, what is deliberately *not* protected, and the key-management rules are
in **[SECURITY.md](SECURITY.md)**.

---

## Commands

| Command | Purpose |
|---|---|
| `npm start` | Run the server (prints LAN URLs and, on first run, the setup code) |
| `npm run dev` | Same, with auto-restart on file changes |
| `npm test` | Run the integration test suite (78 tests) |
| `npm run seed` | Load synthetic demo data |
| `npm run seed:reset` | **Wipe** the database and reload synthetic data |
| `npm run backup` | Write an encrypted backup now (`-- --list` to list them) |
| `npm run restore -- <file.khb>` | Restore an exported backup (server stopped) |
| `npm run users` | List staff accounts (`-- reset <username>`, `-- add-admin …`) |
| `npm run audit:verify` | Verify the audit chain; exits non-zero if broken |
| `npm run portable` | Build a no-internet folder to copy to the clinic PC |

---

## Limits worth knowing

* Designed for a **single server** and up to roughly 10 concurrent workstations on a wired or
  good Wi-Fi LAN. It is not a multi-site system.
* Plain HTTP on the LAN (no certificate). Traffic stays inside the building; if you need
  transport encryption, put a TLS reverse proxy in front of it — see SECURITY.md.
* Files up to 25 MB each (`KH_MAX_UPLOAD_MB`).
* No clinical decision support, no drug interaction checking, no lab/insurance integrations —
  it is a records, workflow and billing system.

## Documentation

* [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — install, firewall, static IP, starting on boot
* [docs/OPERATIONS.md](docs/OPERATIONS.md) — daily/weekly routines, backups, restore, recovery
* [docs/DATA-MODEL.md](docs/DATA-MODEL.md) — tables, relationships, permission matrix
* [docs/API.md](docs/API.md) — every endpoint, for future integrations
* [docs/SYNTHETIC-DATA.md](docs/SYNTHETIC-DATA.md) — what the demo data is and how to clear it
* [docs/TESTING.md](docs/TESTING.md) — what the test suite covers and how to extend it
* [SECURITY.md](SECURITY.md) — threat model and controls

---

*Built for Kalyan Hospital. Demo data is synthetic; treat any real deployment as a system
holding sensitive personal health information and staff it accordingly.*
