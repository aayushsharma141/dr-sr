# Kalyan Hospital — Authoritative Consolidated Bug Register

## Severity Classifications

- **P0 (Critical)**: Exploitable security vulnerability, patient record corruption, or complete workflow block.
- **P1 (High)**: Test failure, broken business workflow, or uncommitted refactoring regression.
- **P2 (Medium)**: Offline hardening, security enhancement, or usability limitation.
- **P3 (Low)**: Code hygiene, styling discrepancy, or dependency cleanup.

---

## Active Defect Register

| Issue ID | Priority | Module | Exact File Path / Function | Description & Root Cause | Recommended Repair | Status |
| --- | --- | --- | --- | --- | --- | --- |
| **BUG-001** | **P1** | Admin / SSOT Nav | `src/pages/__tests__/admin-navigation-architecture.test.tsx` | 4 tests failing due to uncommitted refactor replacing `ManagementOverviewDashboard.tsx` with `AdminDashboard.tsx`. | Reconciled `ManagementOverviewDashboard.tsx` into `AreaHome.tsx` and resolved TypeScript typing. | VERIFIED |
| **BUG-002** | **P1** | AppShell | `src/components/__tests__/app-shell.test.tsx` | 2 tests failing on doctor follow-up deep-link and admin single-sidebar DOM queries. | Aligned navigation labels and links in `AppShell.tsx` to match clinical navigation structure. | VERIFIED |
| **BUG-003** | **P1** | Backup Manager | `src/pages/__tests__/backup-manager.test.tsx` | 3 tests failing on `Patient Import Centre` heading expectation in backup manager route query `?action=import`. | Aligned tab heading and action query param in `BackupManagerPage.tsx`. | VERIFIED |
| **BUG-004** | **P2** | Test Harness | Workspace Root / `pytest.ini` | Running pytest from workspace root scanned `legacy/tests/` and hit sys.path conflicts. | Add root `pytest.ini` with `pythonpath = backend backend/tests backend/src` and `norecursedirs = legacy`. | VERIFIED |
| **BUG-005** | **P1** | Security / LAN | `backend/src/kalyan_api/config.py` | `KALYAN_COOKIE_SECURE=false` transmits auth cookies in plaintext over LAN. | Deploy local reverse-proxy with TLS and configure `KALYAN_COOKIE_SECURE=true`. | OPEN |
| **BUG-006** | **P2** | Backup Service | `backend/src/kalyan_api/services/backup_service.py` | Backup restore feeds archive SQL directly to `psql` as DB owner without meta-command filtering. | Validate SQL commands, enforce strict path traversal checks, and verify archive integrity. | OPEN |
| **BUG-007** | **P2** | Backup Service | `backend/src/kalyan_api/services/backup_service.py` | Database backup archives stored unencrypted containing PHI. | Implement AES-256 archive encryption at rest. | OPEN |
| **BUG-008** | **P2** | Workflows | `frontend/src/pages/DoctorDashboard.tsx` | Transferring patient to a second doctor within the same visit requires receptionist re-booking. | Introduce direct doctor-to-doctor transfer and queue token generation. | OPEN |
