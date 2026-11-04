# Admin Panel P0: completed-versus-pending evidence

Status date: 2026-11-04. Branch `feat/admin-p0-settings`, built on `chore/repo-audit-hardening`.

"Done" below means the setting persists, a real workflow consumes it, and a test proves that. A screen alone does not count.

## Completed versus pending

| P0 module | State | What remains |
|---|---|---|
| 1. Security settings | Done, tighten-only | Loosening past the baseline needs a server change and client approval |
| 2. Backup schedule, destination, retention | Built, off by default | Client approves schedule; register the Windows task; list the second drive |
| 3. Financial configuration and reversal | Reversal and read-only rules done | Payment methods and receipt format await the client |
| 4. Hospital configuration | Identity and print header done | Logo upload, branches and working hours are not done |
| 5. System health | Live checks done | Maintenance mode is P2; no history of past checks |

P1 and P2 items were not started.

## How each setting works

| Setting | Changed at | Stored in | Consumed by | Authorization | Audit | Tests |
|---|---|---|---|---|---|---|
| Idle timeout, session length | Security & Access > Tighten policy | `security_settings` | `core/principal.py`, on every request; `auth_service` for session lists | `security:write` | `SECURITY_POLICY_UPDATED`, with reason | `test_security_policy_update.py` |
| Lockout threshold and duration | Same | `security_settings` | `routers/auth.py`, `auth_service.authenticate` | `security:write` | Same | Same |
| Minimum password length | Same | `security_settings` | `validate_password_policy`, `generate_temp_password`, change-password screen | `security:write` | Same | Same |
| Backup on/off, frequency, time | Backup & Restore > Scheduled backups | `backup_settings` | `backup_schedule_service`, run by the Windows task | `backup:configure` | `BACKUP_SETTINGS_UPDATED`, with reason | `test_backup_schedule.py` |
| Second copy | Same, approved folders only | `backup_settings`, `KALYAN_BACKUP_DESTINATIONS` | `copy_verified` | `backup:configure` | Same, plus `BACKUP_CREATED` | Same |
| Retention | Same | `backup_settings` | `prune_scheduled` | `backup:configure` | `BACKUP_PRUNED` lists removed files | Same |
| Trust name, location line | Clinic Settings | `clinic_settings` | Application header | `settings:write` | `SETTINGS_UPDATED` | `test_admin_p0_config.py`, `admin-p0-identity.test.tsx` |
| Print header | Clinic Settings | `clinic_settings` | Prescription, registration card, receipt | `settings:write` | `SETTINGS_UPDATED` | `admin-p0-identity.test.tsx` |

## Other changes in this branch

- **Reversal screen.** `/admin/billing` finds a payment by receipt, URN or name and reverses it. Before this, `PaymentReversalModal` was not used by any page, so no administrator could reverse a payment from the interface.
- **Reversal register.** The same screen filters to reversed payments, with reason, who and when.
- **System health checks.** Database, photos folder, backup folder, latest run, schedule and second copy. Folder checks prove the server can write there.
- **Missed-schedule alert.** On the dashboard and health page, so a Windows task that was never registered cannot fail silently.
- **Backup run history.** Manual and scheduled runs, including failures, in `backup_runs`.
- **Date fix.** The doctor queue and default physiotherapy session date used the UTC date. Between 00:00 and 05:30 IST a session was dated the previous day on an immutable record.
- **Login notice.** No longer states "30 minutes", which would be untrue after the idle limit is tightened.
- **README.** No longer says v3 is unimplemented.

## Test isolation defect (fixed here only)

Before this branch, tests using plain `get_settings()` ran real `pg_dump` and `DROP SCHEMA public CASCADE` against the database named in `backend/.env`, and wrote archives to its real backup folder. On a production server that would destroy the live database.

`backend/tests/conftest.py` now redirects those paths to `kalyan_restore_test` and temporary folders before the application loads. The other branches still have the old behaviour until this merges.

## Migrations

| Revision | Contents |
|---|---|
| `0006` (previous branch) | `consultation_fees.version_id` |
| `0007` | `security_settings`, `backup_settings`, `backup_runs`; `clinic_settings.trust_name_en`, `trust_name_hi`, `location_line` |

`0007` changes no behaviour on its own: overrides start empty, scheduling starts off and retention starts unset. Tested up and down, including grants. The runtime role cannot delete settings rows or run history.

## Test results

| Check | Result |
|---|---|
| Backend `pytest` | Pass, with 12 skips: 11 need `kalyan_restore_test`, 1 needs `KALYAN_FRONTEND_DIST` |
| Backend `ruff` check and format | Clean |
| Frontend `vitest` | 46 files, 240 passed, 5 skipped (Edge print checks) |
| Frontend typecheck, lint, build | Clean |

**The 11 skipped tests include the backup, restore and disaster-recovery tests.** They have not run against this branch. See "Needed from you".

## Verified in the running application

On localhost, with synthetic data:

- Reversed a payment through the new screen; receipt, reason and actor appeared.
- Tightened idle timeout from 30 to 25; audit row showed before, after and reason.
- A direct API attempt to set it to 45 was refused with 422.
- `₹1,234.05` displayed correctly from 123405 paise.
- Health checks, backup panel and hospital identity loaded with no overflow at 1440px.

Screenshots are in `docs/admin-p0-screenshots/`.

## Not verified

- The Windows scheduled task has not been registered or run. Scheduling is tested through the service and CLI parser only.
- No real scheduled backup, second copy or real restore has run on this branch.
- Whether ending the request transaction prevents restore lock contention on PostgreSQL 18.
- Print header output on paper. It only appears when filled in, but A4 fit with a long header is unchecked.
- The clinical/financial review found one bug, now fixed, but it was done by reading the code, without an independent reviewer.

## Client approval register

| Item | Current state | Built behaviour until decided |
|---|---|---|
| Idle timeout, lockout, password length | Pending | Environment values apply; administrators can only tighten |
| Limits on tightening (5 min idle, 1 h session, 3 attempts, 24 h lockout) | Engineering choice, unapproved | Enforced; easy to change |
| Backup frequency, time, retention | Pending | Off; retention unset, so nothing is deleted |
| Second backup drive | Pending | None approved |
| Retention permanently deleting scheduled backups | Pending | Only happens if an administrator sets a number |
| Who may reverse payments | Recommended Admin only, pending | Admin only |
| Payment methods and required references | Pending | Cash, UPI, card, fixed |
| Receipt format | Mismatch: code emits `RCP-2026-2027-0001`, requirement says `RCPT-2627-XXXX` | Unchanged |
| Receipt cycle | Pending | Financial year |
| Print header wording and placement | Pending | Empty until set |
| URN gaps, doctor visibility, HTTPS, printer, server hardware, data migration, fees | Pending | Unchanged |

## Needed from you

Create the throwaway test database as a PostgreSQL superuser; the application roles cannot. This has not been run:

```sql
CREATE DATABASE kalyan_restore_test WITH OWNER kalyan_owner TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER builtin BUILTIN_LOCALE 'C.UTF-8';
ALTER DATABASE kalyan_restore_test SET timezone TO 'Asia/Kolkata';
REVOKE ALL ON DATABASE kalyan_restore_test FROM PUBLIC;
GRANT CONNECT ON DATABASE kalyan_restore_test TO kalyan_app;
```
