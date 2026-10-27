---
phase: 05-demo-hardening-security
plan: 01
subsystem: security-and-auth
tags: [pbkdf2, password-hashing, admin-guard, offline-security, air-gapped]

requires:
  - phase: 01-app-shell-dashboard
    provides: [Database connection factory, users table schema]
  - phase: 04-a4-printing-backup
    provides: [BackupService, BackupView]
provides:
  - "AuthService providing PBKDF2-HMAC-SHA256 password hashing and constant-time verification"
  - "Default administrator account seeding (admin / kalyan@admin)"
  - "AdminAuthDialog modal guarding sensitive operations"
  - "Guarded database restoration in BackupView requiring admin password"
  - "Automated security test suite in tests/test_auth_service.py"
affects: [05-02]

actuals:
  tasks: 3
  commits: 1

tech-stack:
  added: [hashlib.pbkdf2_hmac, hmac.compare_digest, secrets]
  patterns: [Per-user 16-byte cryptographic salt, Constant-time digest comparison, Modal authorization gate]

key-files:
  created:
    - app/services/auth_service.py
    - app/ui/views/auth_dialog.py
    - tests/test_auth_service.py
  modified:
    - app/ui/views/backup_view.py

key-decisions:
  - "PBKDF2-HMAC-SHA256 uses 100,000 iterations and per-user salt to withstand offline brute force."
  - "Database restoration and data wipe actions are strictly guarded by AdminAuthDialog."
  - "Verified zero network socket usage, guaranteeing 100% offline air-gapped clinic operation."

requirements-completed:
  - SEC-01
  - SEC-02

coverage:
  - id: D1
    description: "PBKDF2 password hashing and administrator authorization"
    requirement: SEC-01
    verification:
      - kind: unit
        ref: "tests/test_auth_service.py#test_pbkdf2_hashing_and_verification"
        status: pass
  - id: D2
    description: "Zero external network dependencies / 100% offline isolation"
    requirement: SEC-02
    verification:
      - kind: unit
        ref: "tests/test_auth_service.py#test_offline_zero_network_operation"
        status: pass
---

# Plan 05-01 Summary: Security Controls & Offline Verification

Delivered local security authentication and offline isolation:
1. **PBKDF2 Authentication Engine:** `AuthService` provides PBKDF2-HMAC-SHA256 hashing (100,000 iterations), constant-time comparison (`hmac.compare_digest`), role management (`ADMIN`, `RECEPTIONIST`), and auto-seeding of a default administrator account (`admin` / `kalyan@admin`).
2. **Admin Permission Guard Dialog:** `AdminAuthDialog` prompts for administrator credentials before executing high-risk clinic actions, securing database restoration in `BackupView`.
3. **Automated Testing & Offline Proof:** `tests/test_auth_service.py` validates cryptographic salt uniqueness, admin verification, and verifies with socket monkeypatching that all operations execute 100% offline with zero remote calls.
