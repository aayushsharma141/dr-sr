# Client Demonstration and Acceptance Walkthrough — Kalyan Hospital v3.0

**Status:** Future acceptance script. Do not use the legacy desktop demo as a v3 demonstration.

## Before demonstration

- Use synthetic patient records only.
- Confirm server and 3–5 client PCs are on clinic LAN.
- Disconnect internet for offline test.
- Have Reception, Doctor and Admin accounts with approved permissions.
- Prepare actual A4 printer and a clean restore target.
- Confirm backup destination drive is connected.
- Record software commit/version and test environment.

## Walkthrough

### 1. First-run setup (fresh test environment)
Show server console one-time setup code. Open browser setup wizard, create first Admin, verify code cannot be reused and setup endpoint is disabled. Demonstrate no default credentials.

### 2. Roles and permissions
Sign in as Reception, Doctor and Admin on separate PCs. Attempt direct unauthorized API actions as well as hidden UI actions. Show denied operations and audit events.

### 3. Reception workflow
Register a synthetic patient using all canonical fields. Search by URN, name, mobile and Devanagari. Trigger duplicate warning. Upload photo and verify only authorized users can access it. Print A4 card and inspect dual signatures on actual printer.

### 4. Appointment queue
Create appointment, assign doctor and token. Progress through Booked, Arrived, In consultation and Done. Show doctor daily queue and verify unauthorized queue access is denied.

### 5. Clinical workflow
Doctor creates encounter, prescription and treatment plan; logs VAS session. Finalize note, attempt edit and show rejection. Add dated addendum and show original remains unchanged. Show unified timeline.

### 6. Billing
Reception posts partial cash/UPI/card payment. Show computed balance and receipt. Attempt negative and overpayment. From two PCs, attempt concurrent payments that together exceed balance; confirm one is rejected. Reprint receipt and show DUPLICATE. Demonstrate Admin-authorized reversal with reason.

### 7. Audit and backup
Admin filters audit by user/action/entity/date. Run manual backup and show scheduled backup status, bundle manifest and checksums. Corrupt a test copy and show verification rejection.

### 8. Restore and resilience
Restore verified bundle on clean machine/staging target. Compare patient/session/payment counts and file checksums. Disconnect internet and repeat core workflows. Reboot server and verify automatic service recovery.

## Acceptance evidence

Capture no real patient data. Record test report, printer sample, backup manifest, restore report, permission test results, server recovery test and client sign-off.

## Legacy desktop demo

The old desktop demo script and its demo credentials apply only to the PySide6/SQLite legacy application. Do not reuse those credentials or claim that desktop demo proves v3 LAN acceptance.

---
*This walkthrough is a proposed acceptance procedure, not evidence that the platform has passed it.*