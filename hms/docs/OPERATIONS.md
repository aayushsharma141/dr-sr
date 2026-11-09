# Operations — running the system day to day

Everything here is done by the clinic's administrator or a trusted deputy. It assumes the system
is installed and running as described in [DEPLOYMENT.md](DEPLOYMENT.md).

Commands are shown for the application folder (e.g. `D:\KalyanHospital`). On Windows use
Command Prompt; on Linux/macOS a normal terminal works the same.

---

## 1. Daily routine

**Start of day (2 minutes)**

1. Switch on the server PC, sign in to Windows. The server window opens automatically
   (see DEPLOYMENT.md §7); it should print `Listening on http://0.0.0.0:3000`.
2. On reception: open the browser shortcut, sign in, check the dashboard shows **Connected**
   (top right) and today's date.
3. Note the "Patients waiting" and "Appointments today" figures — these are what the desk works
   from all day.

**During the day**

* Reception: register patients, book/check in appointments, raise invoices, take payments.
* Doctors: open the queue or search a patient by name/MRN/phone, record vitals, notes,
  diagnoses, prescriptions; **sign** notes when finished (signed notes are read-only).
* Nothing needs to be saved manually — every action is written to the database immediately and
  recorded in the audit trail.

**End of day (5 minutes)**

1. Reception: confirm the **Collected today** figure on the dashboard matches the cash drawer,
   then print/save the day's collection from **Billing → Report** (choose today's date, export
   CSV if you keep digital accounts).
2. Check for patients left "in consult" that were actually discharged; close those visits.
3. Leave the server PC switched **on** (it takes the 22:15 backup itself) or, if the clinic
   powers everything down, shut the server down cleanly:
   press `Ctrl+C` in the server window, wait for `Database checkpointed and closed. Goodbye.`,
   then shut down Windows. **Never** pull the plug on the server PC.

---

## 2. Where the data lives

| Path | Contents | Back it up? |
|---|---|---|
| `data\kalyan.db` | The database: patients, visits, notes, bills, audit log | **Yes** (in backups) |
| `data\kalyan.db-wal`, `-shm` | SQLite journal files (normal, ignore) | Part of the DB |
| `data\uploads\` | Encrypted documents (scans, PDFs) | **Yes** (in backups) |
| `data\backups\` | Encrypted backup archives `.khb` | Copied off-site routinely |
| `data\keys\attachments.key` | Key that decrypts uploaded documents | **Yes — separately, in a safe** |
| `data\keys\backup.key` | Key that decrypts backup archives | **Yes — separately, in a safe** |
| `data\logs\` | Server log files (no clinical content) | Optional, 90 days is plenty |

Rule of thumb: **backups alone are not enough** — a `.khb` file without `data\keys\backup.key`
cannot be read, and a restored database without `attachments.key` cannot open documents.

---

## 3. Backups

### What happens automatically

Every night at **22:15** (server local time, configurable) the server writes an encrypted
archive to `data\backups\kalyan-<timestamp>-<rand>.khb` and keeps the newest 30. It uses
SQLite's `VACUUM INTO`, so the copy is consistent even while staff are working. A failed backup
is logged and shown in red on **Backups & system**.

### Manual backup

* In the app: **Backups & system → Back up now**.
* On the console: `npm run backup` (add `-- --list` to list existing archives).

### Off-site copy — the part that actually saves the clinic

Once a week (and after any busy day), the administrator:

1. Opens **Backups & system → Export** next to the newest backup, types an **export passphrase**
   (at least 12 characters, different from every login password) and saves the file.
2. Copies that file to a USB drive that is kept **outside the server room** — typically the
   administrator's locked drawer, or a second building.
3. Writes the passphrase on paper, seals it and keeps it in the clinic safe. Never store the
   passphrase on the same USB drive as the file, and never email either of them.
4. Rotate: keep the last 8 weekly exports; they are small (a few hundred KB).

A tested routine beats a clever one: put a recurring reminder in the administrator's phone on
the same day each week.

### Verifying a backup is usable (monthly, 5 minutes)

```bat
npm run backup -- --list
```

The list shows size and date. Then, **once a month**, actually test one:

1. Stop the server (`Ctrl+C`).
2. `npm run restore -- data\backups\kalyan-<timestamp>-<rand>.khb`
3. Enter the passphrase/confirm; the script prints the archive manifest, runs SQLite's
   integrity check and shows the patient count.
4. Type `restore`, let it finish, start the server, sign in, confirm patients and a document
   open correctly.
5. Nothing is lost: the previous live data was moved to `data\pre-restore-<stamp>\`. Delete
   that folder once you are happy, or keep it for a day.

A backup that has never been restored is a hope, not a backup.

---

## 4. Restoring after a failure

### The server PC still works, data looks wrong

1. Sign in as Administrator → **Backups & system** and look at the list.
2. Note the timestamp of the last good backup.
3. Stop the server, run `npm run restore -- data\backups\<file>.khb`, confirm, restart.
4. Tell staff what was entered after that timestamp — those entries are gone and must be
   re-entered.

### The server PC is dead

1. Prepare a replacement PC (DEPLOYMENT.md §1–3: Node.js + application folder).
2. Copy `data\keys\` from the old machine, or from the safe copy of the keys, into the new
   `data\keys\`.
3. Copy the newest off-site export to the new PC.
4. `npm run restore -- <exported-file>.khb`, entering the **export passphrase** (this is the
   passphrase you typed when exporting, not the backup key).
5. Start the server, sign in, check patients and one document, then hand the network address
   back to staff (update the router IP reservation or the shortcuts).

### Ransomware or a stolen PC

Treat all data as exposed: restore onto a clean machine and **change every password**
(Staff accounts → Reset password for each person, plus your own). Review the audit trail for
sign-ins you do not recognise. Report it as a data-protection incident per clinic policy.

---

## 5. Staff accounts

| Task | Where |
|---|---|
| Add a staff member | **Staff accounts → Add staff** (choose role; you set a starter password) |
| Rename / change role | **Staff accounts → Edit** |
| Somebody leaves | **Staff accounts → Disable** — this also ends all their sessions immediately |
| Forgotten password | **Staff accounts → Reset password** |
| Nobody can sign in (all admins locked out) | On the **server console only**: `npm run users -- reset <username>` |
| See who is signed in | **My account → Active sessions**, with *Sign out other devices* |

Console commands:

```bat
npm run users                          :: list accounts, roles, status
npm run users -- reset dr.verma        :: set a new password, unlock, end sessions
npm run users -- add-admin owner "N. Kulkarni"
```

Anything done on the console is written to the audit trail as `user.*_console` so the
records still show it.

Rules that keep the clinic safe:

* One account per person. Shared logins destroy accountability.
* Administrators: at most two, and both must be reachable by phone.
* Change any password that was ever written on a sticky note.
* Reception accounts should not be left signed in on an unattended PC; the session locks itself
  after 20 idle minutes.

---

## 6. Audit trail

**Audit trail** in the sidebar shows every recorded action with who, what, when and from which
PC. Filter by person, action or date, and **Export CSV** for a review meeting or an inspection.

* Sign-ins (including failures), patient views/edits, note signing, document views and
  downloads, invoices, payments, voids, staff changes, settings changes and backups are all
  logged.
* The log is **hash-chained**. The page shows **Intact** or a red warning; `npm run audit:verify`
  checks the same thing from the console and exits non-zero if the chain is broken.
* If a warning ever appears: stop using the installation, preserve the `data` folder, and
  restore from a known-good backup before investigating.

Audit rows are never edited or deleted by the application. They are retained for as long as
clinic policy requires (commonly 3 years for medical records; check local rules).

---

## 7. Common problems and fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| Workstations show "Cannot reach the clinic server" | Server window closed, PC asleep, or IP changed | Restart the server (`npm start`), check the address in the server window, keep the PC awake |
| Only one PC can connect | Firewall blocked port 3000, or Wi-Fi guest network | Add the firewall rule (DEPLOYMENT.md §5); make sure all PCs use the same network |
| Page loads but "sign in" fails | Caps Lock / wrong account, or the account is disabled | Admin resets the password; check Staff accounts status |
| "Too many attempts" on sign-in | Login throttling after repeated failures | Wait 10 minutes, or the admin resets the password (which unlocks the account) |
| "Session ended" while working | 20 idle minutes elapsed | Sign in again; unsaved form text is gone, so finish consultations before stepping away |
| Printer prints the wrong size | Browser print settings | In the print dialog choose the printer's paper size (A5 for prescriptions, 80 mm for receipts) |
| A document will not open | File deleted from `data\uploads` or the key file changed | Restore from backup; check `data\keys\attachments.key` is the original |
| Dashboard says "Backup failed" | Disk full or `data\backups` not writable | Free space, check permissions, run `npm run backup` on the console to see the error |
| Everything is slow | Very old server PC, or huge date ranges in reports | Close unused browser tabs; keep report ranges to a week or a month |

Logs to read before calling for help: `data\logs\server-YYYY-MM-DD.log` (newest file, look for
`ERROR`).

---

## 8. Weekly / monthly calendar

| When | Task |
|---|---|
| Daily | Start-of-day check (§1), end-of-day cash match and CSV |
| Weekly | Off-site export to USB + sealed passphrase check; glance at the audit trail for oddities |
| Monthly | Restore test (§3), review staff accounts (who still works here?), check disk space, verify `npm run audit:verify` |
| Quarterly | Change administrator passwords; review roles and permissions with the doctors |
| Yearly | Archive the year's exports to a second medium; confirm the off-site storage is still being filled |

---

## 9. Reference: console commands

| Command | Purpose |
|---|---|
| `npm start` | Start the server (banner, LAN addresses, setup code on first run) |
| `Ctrl+C` | Clean shutdown — always use this before moving/copying the data folder |
| `npm run backup` | Write an encrypted backup now; `-- --list` lists archives |
| `npm run restore -- <file.khb>` | Restore an archive (server stopped); the current data is moved aside |
| `npm run users` | List staff; `-- reset <user>`; `-- add-admin <user> "<Name>"` |
| `npm run audit:verify` | Check the audit chain; exit code 1 = broken |
| `npm run seed` / `npm run seed:reset` | Load / reload synthetic demo data (**never** on a live clinic database) |
| `npm test` | Run the automated test suite |
| `npm run portable` | Build a copy that needs no internet |
