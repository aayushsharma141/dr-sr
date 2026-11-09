# Deployment — putting Kalyan Hospital on the clinic network

This guide takes a fresh clinic computer from "nothing installed" to "reception and the doctors
are using it from their own PCs". Follow it once; after that the server simply starts with the
PC.

**Who this is for:** the person setting up the system (hospital administrator, IT helper, or the
doctor's technician). No programming knowledge is needed beyond copying and pasting commands.

---

## 0. What you need

| Item | Detail |
|---|---|
| Server PC | Any Windows 10/11 PC on the clinic network, 4 GB RAM is plenty, 20 GB free disk. It must stay switched on during clinic hours. |
| Network | The PCs must be on the **same** network (same router/switch). Wired is strongly preferred for the server. |
| Workstations | 3–5 PCs with Chrome, Edge or Firefox. Nothing is installed on them. |
| Node.js | Version **20.11 or newer (LTS)** on the server PC only — installed once. |
| Printer | Any network or USB printer the reception PC can already print to (receipts, prescriptions). |

Sizing reality check: this system is designed for one hospital site with up to ~10 simultaneous
users. It has been tested with 5 concurrent sessions.

---

## 1. Choose and prepare the server PC

1. Pick a PC that will stay on and connected by cable. A small desktop is ideal; a laptop is
   acceptable if it never sleeps.
2. In **Windows Settings → System → Power & sleep**, set *Sleep* to **Never** while plugged in.
3. Set a **fixed IP address** for this PC, or reserve its address in the router's DHCP table.
   Without this, the address can change after a power cut and staff shortcuts will break.
   * Router admin → DHCP reservation → pick the server PC → e.g. `192.168.1.24`.
4. Give the PC a clear name, e.g. `clinic-server`.
5. Turn on **BitLocker** (or another full-disk encryption) for the drive holding clinic data.
   The application encrypts uploaded documents, but the database file itself relies on disk
   encryption — see [../SECURITY.md](../SECURITY.md) §5.

---

## 2. Install Node.js (offline-friendly)

### If the server PC has internet

Open <https://nodejs.org> → download the **LTS** Windows installer (`.msi`, x64) → run it with
default options. Verify in a new Command Prompt:

```bat
node -v
```
Expect `v20.x`, `v22.x` or `v24.x`. Anything from v20.11 up is fine.

### If the server PC has no internet (recommended, and the normal case for a clinic)

Build a portable folder on an internet-connected machine of the same kind (same OS, same
64-bit architecture):

```bash
npm install          # on the internet machine, inside the project folder
npm run portable     # creates portable/kalyan-hospital-1.0.0/
```

Copy the whole `portable/kalyan-hospital-1.0.0/` folder to a USB stick, then to the server PC
(for example to `D:\KalyanHospital`). That folder contains the application **and** its
`node_modules`, so no internet and no `npm install` is needed on the clinic PC — but it still
needs Node.js itself, which must be installed from the offline `.msi` you downloaded (also
carry that file on the stick).

> The SQLite driver inside `node_modules` is a native Windows binary. Build the portable folder
> **on Windows x64** if the clinic PCs are Windows x64; do not build it on a Mac or Linux and
> expect it to run on Windows.

---

## 3. Copy the application onto the server PC

Either:

* **From the portable bundle:** copy `portable/kalyan-hospital-1.0.0` to `D:\KalyanHospital`
  (the folder that contains `server.js` is the application folder), or
* **From a source copy:** copy the project folder (with `node_modules`), then run
  `npm install` once on a machine that has internet.

Do **not** put the application inside `C:\Program Files` — Windows blocks writes there, and the
app writes its `data` folder next to itself.

---

## 4. First start and first administrator

Open Command Prompt in the application folder and run:

```bat
npm start
```

You will see (abridged):

```
**************************************************************************
  KALYAN HOSPITAL - FIRST-RUN SETUP
**************************************************************************
  No administrator account exists yet. To create the first one:
    1. On this computer, open a browser and go to:
         http://localhost:3000/setup
    2. Enter the one-time setup code shown below.

     ONE-TIME SETUP CODE:   7K4Q-2M9X

  This code is valid until 09/11/2026, 19:42:00.
```

1. On the server PC, open `http://localhost:3000/setup`.
2. Enter the setup code, your name, a username and a password (12+ characters, mixed case,
   a digit or symbol).
3. Submit. You are signed in as the **first Administrator**.

From that moment the setup page is permanently disabled: `POST /api/bootstrap/complete`
answers `410 Gone`, and no browser can create another first admin. Keep the console window —
it is also where the server logs and warnings appear.

> If the code expires (60 minutes) nothing is lost: restarting the server, or opening `/setup`
> again, prints a fresh code **on the console only**. If you ever need a hard reset before the
> clinic starts using the system, stop the server, delete the `data` folder, and start again.

---

## 5. Open the firewall for the other PCs

Windows will usually show a "Allow Node.js to communicate on…" prompt the first time — tick
**Private networks** and allow. If you missed it, run this once in an **Administrator** Command
Prompt:

```bat
netsh advfirewall firewall add rule name="Kalyan Hospital" dir=in action=allow protocol=TCP localport=3000
```

Verify from another PC on the network by opening a browser at the address the server printed:

```
  Staff can open these addresses from other PCs on the clinic network:
    http://192.168.1.24:3000      (Ethernet)
```

If that does not load: check the IP (`ipconfig` on the server), check both PCs are on the same
subnet, and check the firewall rule. Wired vs Wi-Fi on different routers ("guest network") is
the most common cause.

---

## 6. Set up the workstations (about 2 minutes each)

On every reception/doctor PC:

1. Open Chrome or Edge.
2. Go to `http://192.168.1.24:3000`.
3. Sign in, and let the browser offer to **save the password** if the clinic allows it.
4. Add a shortcut: drag the tab to the desktop, or bookmark it. Rename it
   "Kalyan Hospital".
5. Optional but recommended: set the browser to open that page on startup
   (Chrome → Settings → On startup → *Open a specific page*).

No software, plugin or printer driver is installed on workstations. Printed receipts and
prescriptions use the workstation's normal print dialog.

---

## 7. Start automatically when the server PC boots

### Option A — Startup shortcut (simplest)

1. Create a file `start-clinic.bat` in the application folder:

```bat
@echo off
cd /d D:\KalyanHospital
title Kalyan Hospital server
node server.js
pause
```

2. Press `Win+R`, type `shell:startup`, press Enter.
3. Put a **shortcut** to `start-clinic.bat` in that folder.

The server window appears after sign-in and stays open. Closing it stops the server — name the
window something obvious and tell staff not to close it. (`pause` keeps the window open so any
error is readable.)

### Option B — Windows service (no window, survives sign-out)

Use [NSSM](https://nssm.cc) if you have it available offline:

```bat
nssm install KalyanHospital "C:\Program Files\nodejs\node.exe" "D:\KalyanHospital\server.js"
nssm set KalyanHospital AppDirectory D:\KalyanHospital
nssm set KalyanHospital Start SERVICE_AUTO_START
nssm start KalyanHospital
```

Logs are then written to `data\logs\server-YYYY-MM-DD.log` (the console banner — including a
first-run setup code — needs Option A, so do the first run in a normal command window).

---

## 8. Clinic details and settings

Sign in as the Administrator → **Settings**:

* Hospital name, tagline, address, phone, email, registration number (these print on receipts
  and prescriptions).
* Session idle timeout, receipt/prescription footer disclaimer.
* Backup hour and how many backups to keep.

Then create the real staff accounts under **Staff accounts** — one account per person, never a
shared "reception" login, because the audit trail identifies who did what:

| Role | Give it to |
|---|---|
| Administrator | 1–2 people only (you and a deputy) |
| Doctor | Each consulting doctor |
| Reception | Front desk staff |

Passwords are set by the administrator at creation and must be changed at first sign-in.

---

## 9. Final acceptance checklist

Run through this before the clinic starts using the system for real patients:

- [ ] `npm start` prints a LAN address; the app loads from **two different** PCs.
- [ ] Two staff signed in at once see the same patient list, and a new registration made on
      PC A appears on PC B after a refresh.
- [ ] The setup code has been used and `http://<server>:3000/setup` is refused.
- [ ] Every real staff member has their own account with the right role; demo accounts
      (`admin`, `dr.verma`, …) are disabled or their passwords changed.
- [ ] **The synthetic dataset has been cleared** — see
      [SYNTHETIC-DATA.md](SYNTHETIC-DATA.md).
- [ ] A test patient, visit, invoice and receipt can be created end-to-end, and the receipt
      prints on the reception printer.
- [ ] A file (a PDF) uploads and opens again from the patient's Documents tab.
- [ ] **Backups → Back up now** produces a file, and **Export** with a passphrase downloads it.
- [ ] The exported backup is copied to a USB drive that lives **outside** the server room.
- [ ] The server PC is on a fixed IP, does not sleep, and Windows Update is set to "notify"
      rather than auto-restart in clinic hours.
- [ ] One other staff member has been shown **Operations** (how to check backups and what to do
      if the server does not start).

---

## 10. Uninstalling / moving to a new server PC

1. On the old server: Administrator → **Backups → Back up now**, then **Export** with a
   passphrase, and copy the file to a USB drive.
2. Copy `data\keys\` to the same USB drive, in a separate folder (the backup **needs** the key
   file to be readable later).
3. On the new PC: install Node.js, copy the application folder, and run
   `npm run restore -- <file.khb>` (with the old `data\keys\` restored into the new
   `data\keys\`), following [OPERATIONS.md](OPERATIONS.md) §6.
4. Change the router's fixed-IP reservation to the new PC so workstation shortcuts keep working
   — or update the shortcuts.

Full routine procedures: **[OPERATIONS.md](OPERATIONS.md)**.
