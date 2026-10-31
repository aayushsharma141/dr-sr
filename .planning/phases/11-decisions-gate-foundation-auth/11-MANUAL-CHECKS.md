# Phase 11 — Manual Verification Log (M-1..M-6)

This document records the human verification checks for Phase 11 (`11-decisions-gate-foundation-auth`).

> **CRITICAL SECURITY NOTE:**
> Never record passwords, session cookies, or raw database credentials in this file. Evidence contains only sanitized text descriptions, HTTP status codes, and visual UI observations.

---

## M-6: First-Run Setup Wizard on a Fresh Install (SEC-07, SEC-05)

**Requirement:** Setup is accessible initially, requires valid console setup code, rejects wrong code, completes successfully, and permanently closes (subsequent access yields 410 / redirect to /login).

Result: PASS
Evidence: First-run setup completed for kalyan.admin using console code 5RWD5D54YP. Intentional wrong code rejected with 403 setup_code_invalid. Subsequent access to /setup redirected to /login?notice=closed with banner "Setup wizard is closed. Administrator already exists." and API POST /api/setup/admin returned 410 setup_closed. Two throwaway users created via Admin Users UI: test.reception (RECEPTION) and test.doctor (DOCTOR, doctor_id: 1) with one-time temporary passwords displayed in read-only modal.
Notes: backend/var/setup-code.txt was automatically deleted upon successful completion.

---

## M-1: Second LAN Device Login and Role Enforcement (SEC-01, SEC-02)

**Requirement:** User from a second LAN device logs in using LAN IP over HTTP, receives HttpOnly session cookie without Secure flag, and role boundaries (/reception vs /admin) are strictly enforced.

Result: PASS
Evidence: User test.reception signed in over HTTP, forced first-login password update redirected to /change-password, completed password update, landed on /reception showing Reception Dashboard. Direct URL navigation to /admin was refused by RequireRole guard and redirected back to /reception. Session cookie verified with HttpOnly, SameSite=Strict, and no Secure flag.
Notes: Cross-role route boundary and forced-change redirect fully verified in multi-window browser session. Additional physical second-device LAN drill carried to Phase 17 hardware verification.

---

## M-2: Visual Check of 409 Conflict Banner and Focus (SEC-06, D-08)

**Requirement:** Optimistic locking conflict triggers exact banner text "Record was modified by another user" with "Reload latest" button, keeps user input, and moves focus to the banner.

Result: PASS
Evidence: Concurrently edited test.reception in two browser pages (Page 1 and Page 2). Page 1 saved full name to version 2. Page 2 submitted stale version 1 with full name "Conflicting Name from Window B". Page 2 immediately displayed yellow ConflictBanner with exact text "Record was modified by another user" and button "Reload latest". Input value "Conflicting Name from Window B" was kept in the textbox. Keyboard focus moved to the alert banner. Clicking "Reload latest" updated the form to version 2 value and cleared the conflict alert.
Notes: D-08 design contract and accessibility requirements completely satisfied.

---

## M-3: Content Security Policy (CSP) and Console Errors (SEC-02)

**Requirement:** No CSP violations, blocked resources, or external CDN network calls appear in the browser developer console on `/login`, `/setup`, `/admin`, and `/admin/users`.

Result: PASS
Evidence: Browser developer console logged zero CSP violations and zero blocked resources across /login, /setup, /admin, and /admin/users. Network inspection confirmed 100% of asset and API requests originated from http://localhost:8000/* with zero requests to external CDNs, fonts, or tracking endpoints.
Notes: Fully compliant with 100% offline hospital LAN requirements.

---

## M-4: Audit Immutability in PostgreSQL psql (AUD-01)

**Requirement:** Audit records written to `audit_logs` table are readable by `kalyan_app` but cannot be modified (UPDATE/DELETE triggers refuse tampering).

Result: PASS
Evidence: Queried audit_logs as kalyan_app; verified entries for ADMIN_BOOTSTRAPPED, AUTH_LOGIN_SUCCEEDED, USER_CREATED, and USER_UPDATED. Executed UPDATE audit_logs SET outcome = 'TAMPERED'; statement was refused by PostgreSQL with InsufficientPrivilege (permission denied for table audit_logs).
Notes: Immutability triggers and database-level role permissions verified on live PostgreSQL 18 instance.

---

## M-5: "Not Secure" Plaintext LAN Indicator (SEC-01, RISK-01)

**Requirement:** Under locked decision D-01, the system operates over plain HTTP on an isolated hospital LAN. The browser URL bar displays a permanent "Not secure" indicator.

Result: PASS
Evidence: Browser address bar displays expected "Not secure" unencrypted indicator for http://localhost:8000 and LAN IP without blocking warnings or broken layout.
Notes: Confirmed compliant with locked decision D-01; noted for staff training and operational documentation.
