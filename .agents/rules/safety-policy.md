# Kalyan Hospital — Engineering Safety Policy

## Non-Negotiable Safety Invariants
1. **Preserve User Changes**: Never run destructive Git commands (`git reset --hard`, `git clean -fd`, `git checkout .`, `git restore .`) across uncommitted user work. Always check `git status` first.
2. **Dedicated Test Database**: Never execute destructive DDL, drop tables, or test migrations against production hospital data. Always verify the active target database (`kalyan_dev` / `kalyan_test`).
3. **Synthetic Patient Data**: All automated tests, QA journeys, and seed scripts must use synthetic anonymized data. Never store or commit real patient PII.
4. **Credential & Secret Protection**: No passwords, JWT secrets, session keys, or API tokens in logs, audit documents, or Git commits.
5. **No False Passes / Error Suppression**: Never silence exceptions or bypass validation to make tests appear green.
6. **No Privilege Dilution**: Never bypass or weaken backend RBAC/permissions to fix frontend permission errors.
7. **Explicit Approval Gates**: Require human approval before:
   - Database schema migrations or data migrations.
   - Bulk database record updates or deletions.
   - Financial calculation or payment ledger modifications.
   - Core authentication, session, or role configuration changes.
   - Installing heavy new framework dependencies.
   - Production deployment or LAN firewall alterations.

