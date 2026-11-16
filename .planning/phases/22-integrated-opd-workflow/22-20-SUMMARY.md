# Phase 22 Plan 20 Summary: Approval-Gated Deploy to kalyan_dev on :8000, Frontend Build, Server Restart, and Verification

**Plan:** 22-20  
**Status:** IMPLEMENTED — NOT VERIFIED (Deployment successful on :8000; consolidated human checks pending owner walkthrough)  
**Task IDs:** T22-07, T22-09, T22-10, T22-11  

---

## 1. AGENTS.md Governance Report

- **Task ID:** 22-20 (T22-07, T22-09, T22-10, T22-11)
- **Owned Files Modified:**
  - `.planning/phases/22-integrated-opd-workflow/22-20-SUMMARY.md`
- **Git Checkpoint:**
  - Checkpoint stash: `checkpoint: before 22-20 deploy to kalyan_dev` (`stash@{0}`).
  - Working tree and index strictly preserved (no commits).
  - Hard rules enforced: Zero database resets (`kalyan_dev` never dropped, truncated, or reset; `backup-restore` not run; zero test suites executed against `kalyan_dev`).
- **Findings:**
  - Backup created: `D:\dr-sr\backend\var\backups\kalyan_backup_20261116_023646_before-0029-deploy.tar.gz`.
  - Backup cryptographically verified: Manifest 1.0, DB Dump SHA `c2eba72fba3b6888fcd69420a677da09e52739303969cd1b3461dc129f79ecf8`, 11 photos verified intact.
  - Database schema state on `kalyan_dev`: `Schema revision: 0029 (expected head: 0029)`. Durability flags: `synchronous_commit: on`, `fsync: on`, `full_page_writes: on`. Health check: `OK`.
  - Read-only balance comparison: `scripts/phase22_balance_compare.py --database kalyan_dev` executed cleanly with 2 visits compared and 0 balance mismatches between legacy formula and new formula.
  - Frontend production build: `npm.cmd --prefix frontend run build` (`tsc -b && vite build`) passed in 3.10s. Timestamp of `dist/index.html`: `16-11-2026 08:07:37` (830 bytes). Bundles verified containing `"Billing & Checkout"`.
  - Server daemon: Started via `uvicorn kalyan_api.main:create_app --factory --host 0.0.0.0 --port 8000 --no-access-log` on port 8000.
  - Live probe results against `http://localhost:8000`:
    * `GET /api/health` -> HTTP 200 `{"status":"ok","db":"ok","setup_required":false}`.
    * `GET /` -> HTTP 200 (serves React SPA index HTML `<title>Kalyan Hospital</title><div id="root"></div>`).
    * `GET /assets/index-BWV6NGCD.css` -> HTTP 200 with `cache-control: public, max-age=31536000, immutable`.
    * `GET /api/openapi.json` -> HTTP 404 (expected: runtime OpenAPI schema endpoint disabled for offline compliance via `openapi_url=None`).
- **Root Cause / Motivation:**
  - Fulfill Phase 22 Plan 20 approval-gated deployment under owner authorization ("proceed /swarm"). Deliver migration 0029 and rebuilt frontend together to `:8000` (design §8a), verify balance preservation (design §9), ensure server readiness, and compile the consolidated human-check checklist for end-of-phase verification.
- **Changes:**
  - Created `.planning/phases/22-integrated-opd-workflow/22-20-SUMMARY.md`. No application code, test files, or database rows altered.
- **Dependencies:**
  - Upstream: Plans 22-01 through 22-19.
  - Downstream: Owner acceptance walkthrough on `:8000`.
- **Remaining Risks:**
  - Features remain `IMPLEMENTED — NOT VERIFIED` until the owner completes the consolidated browser checklist on `:8000` with synthetic test patients.
  - Legacy test suite issues identified in 22-19 (`patient-import.test.tsx` and 3 Phase 20 snapshot tests) remain catalogued for Phase 23 / stabilization.

---

## 2. Deployment Execution Record

### Step 1: Pre-Deployment Backup & Verification
```powershell
# Create backup bundle
cd D:/dr-sr/backend
.venv/Scripts/python.exe -m kalyan_api.cli backup-create --label before-0029-deploy

# Output:
# Creating backup bundle (label=before-0029-deploy, destination=default)...
# SUCCESS: Backup bundle created at D:\dr-sr\backend\var\backups\kalyan_backup_20261116_023646_before-0029-deploy.tar.gz

# Cryptographically verify backup bundle
.venv/Scripts/python.exe -m kalyan_api.cli backup-verify D:\dr-sr\backend\var\backups\kalyan_backup_20261116_023646_before-0029-deploy.tar.gz

# Output:
# SUCCESS: Backup bundle is cryptographically verified and intact
# Manifest Version: 1.0, Created: 2026-11-16T02:36:46.534799+00:00
# DB Dump SHA: c2eba72fba3b6888fcd69420a677da09e52739303969cd1b3461dc129f79ecf8, Photos: 11
```

### Step 2: Database Schema & Durability Inspection
```powershell
cd D:/dr-sr/backend
.venv/Scripts/python.exe -m kalyan_api.cli check-db

# Output:
# Inspecting database 'kalyan_dev' at 127.0.0.1:5432...
# Schema revision: 0029 (expected head: 0029)
# synchronous_commit: on
# fsync: on
# full_page_writes: on
# Database health check: OK
```

### Step 3: Read-Only Balance Comparison on kalyan_dev
```powershell
$env:PYTHONPATH="D:/dr-sr/backend/src"
backend/.venv/Scripts/python.exe scripts/phase22_balance_compare.py --database kalyan_dev

# Output:
# Database: kalyan_dev
# Total visits compared: 2
# All visit balances match between legacy and new formulas.
```

### Step 4: Frontend Production Build
```powershell
npm.cmd --prefix frontend run build

# Output:
# > build
# > tsc -b && vite build
# vite v8.3.5 building client environment for production...
# transforming...
# ✓ 6512 modules transformed.
# rendering chunks...
# computing gzip size...
# dist/index.html                                       0.83 kB │ gzip:  0.39 kB
# dist/assets/index-BWV6NGCD.css                      109.76 kB │ gzip: 19.22 kB
# ...
# dist/assets/AppShell-gRqd7J8O.js                     53.73 kB │ gzip: 14.99 kB
# dist/assets/ReceptionBillingPage-Dw6yzaat.js         83.00 kB │ gzip: 15.89 kB
# dist/assets/ClinicalEncounterWorkspace-C9xcGeiF.js  121.68 kB │ gzip: 25.04 kB
# dist/assets/index-CiXXDfim.js                       256.74 kB │ gzip: 77.56 kB
# ✓ built in 3.10s

# Verify dist timestamp:
# FullName                          LastWriteTime       Length
# --------                          -------------       ------
# D:\dr-sr\frontend\dist\index.html 16-11-2026 08:07:37    830
```

### Step 5: Server Startup & Live Health Probes
```powershell
# Server daemon launch
backend\.venv\Scripts\python.exe -m uvicorn kalyan_api.main:create_app --factory --host 0.0.0.0 --port 8000 --no-access-log

# Health check probe
curl.exe -s http://localhost:8000/api/health
# Output: {"status":"ok","db":"ok","setup_required":false}

# Automated HTTP 200 gate
curl.exe -s -o NUL -w "%{http_code}" http://localhost:8000/api/health
# Output: 200

# Static root bundle probe
curl.exe -s http://localhost:8000/
# Output: HTML containing <title>Kalyan Hospital</title> and <div id="root"></div>

# Static CSS asset probe
curl.exe -s -I http://localhost:8000/assets/index-BWV6NGCD.css
# Output: HTTP/1.1 200 OK, Content-Type: text/css, Cache-Control: public, max-age=31536000, immutable
```

---

## 3. Consolidated Human-Check Checklist (For Owner on :8000)

Per `AGENTS.md` and Plan 22-20 Task 3, below is the consolidated checklist collected across all Phase 22 plans. All checks must be performed using **synthetic test patients only** (never real patient data).

| ID | Plan | Role | Check Description | Verification Criteria | Status |
|---|---|---|---|---|---|
| **HC-01** | 22-01 | Doctor | Emergency alert banner & queue badge | Log in as doctor on `:8000`. An EMERGENCY patient displays a red `PriorityBadge` and persistent red banner until "Acknowledge" is clicked. In-consultation card remains pinned at top; "Last updated" time advances every 10s. | IMPLEMENTED — NOT VERIFIED |
| **HC-02** | 22-02 | Reception | Waiting room columns & actions | Log in as reception on `:8000`. Empty Waiting/In Cabin/Completed columns show dedicated empty copy. Reassign a waiting patient to another doctor (new token issued, old token in history). Cancel a waiting consultation with a reason (min 3 chars). | IMPLEMENTED — NOT VERIFIED |
| **HC-03** | 22-07 | Reception | Visit-level checkout & dues collection | On a completed visit, collect partial amount, then remaining amount. Close a visit with balance and reason; collect balance from Dues tab. Print each receipt (verify single A4 page, totals only without line items per OD-H). | IMPLEMENTED — NOT VERIFIED |
| **HC-04** | 22-13 | Reception | Bill panel layout & Patient Out | Open a completed visit. Check 5 sections (Consultations, Procedures, Medicines, Additional Particulars, Summary), source tags (Doctor/Reception), totals order, previous dues card. Complete Patient Out with and without balance. Reload page to verify persistence. | IMPLEMENTED — NOT VERIFIED |
| **HC-05** | 22-14 | Reception | Same-day line additions & adjustments | Add a prescribed medicine (verify name/form only prefilled, quantity entered manually per OD-B), typed medicine, and additional particular. Change quantity on same-day own line. Void own line with reason. Reload page to confirm persistence. | IMPLEMENTED — NOT VERIFIED |
| **HC-06** | 22-14 | Admin | Admin fee adjustment & line overrides | Log in as admin. Adjust consultation fee (Discount/Waive/Correct with reason). Void a doctor procedure line on an open visit. Change a non-consultation line. Verify audit entries recorded. | IMPLEMENTED — NOT VERIFIED |
| **HC-07** | 22-15 | Reception | Navigation order, Receipts & Reports | Verify reception sidebar matches OD-22-01 exact order (`Check-in & Token`, `Dashboard`, `Patient Records`, `Appointments`, `Waiting Room`, `Billing & Checkout`, `Receipts`, `Reports`). In Receipts, verify today's receipts and reprint (DUPLICATE). In Reports, verify collection summary. | IMPLEMENTED — NOT VERIFIED |
| **HC-08** | 22-16 | Doctor | Clinical encounter charges panel & fee adjustment | Log in as doctor. Open consultation workspace: in charges panel, add a procedure line and package reference. Discount then waive consultation fee with reason. Verify no payment controls or visit totals visible. In reception, confirm bill reflects doctor lines. | IMPLEMENTED — NOT VERIFIED |
| **HC-09** | 22-18 | Admin | Referral report | Log in as admin. Under Patient & Data Management, open Referral Report. Filter by date range and source (e.g. Doctor). Verify cancelled visits excluded. Confirm route is inaccessible to reception role. | IMPLEMENTED — NOT VERIFIED |

---

## 4. Definition of Done Summary Table

| Requirement / Component | Automated Gate | Deployment Gate (:8000) | Final Phase 22 Status |
|---|---|---|---|
| **Queue Priority & Emergency (PRI-07..09)** | PASS (`test_phase22_wave2.py`) | Server running, health 200 | IMPLEMENTED — NOT VERIFIED |
| **Waiting Room & Reassignment (QUE-10, AUD-08)** | PASS (`test_reassignment_api.py`) | Server running, health 200 | IMPLEMENTED — NOT VERIFIED |
| **Fee Adjustments & Waivers (FEE-03..06, FEE-09)** | PASS (`test_phase22_fee_adjustment.py`) | Server running, health 200 | IMPLEMENTED — NOT VERIFIED |
| **Bill Line Snapshot & Balance Switch (BILL-01..02, BILL-16..17, BILL-19, LED-11)** | PASS (`test_phase22_balance_switch.py`, `phase22_balance_compare.py`) | Revision 0029, 0 mismatches | IMPLEMENTED — NOT VERIFIED |
| **Visit Payments & Checkout (AUD-04, BILL-07..15, LED-08..09)** | PASS (`test_visit_checkout_api.py`, `test_phase22_visit_payments.py`) | Server running, health 200 | IMPLEMENTED — NOT VERIFIED |
| **Prescribed Medicines (MED-02..12, BILL-18)** | PASS (`test_phase22_prescribed_medicines.py`) | Server running, health 200 | IMPLEMENTED — NOT VERIFIED |
| **Receipts & Reports Navigation (LED-01..07, LED-10)** | PASS (`test_phase22_bill_correct.py`, vitest) | Rebuilt dist served | IMPLEMENTED — NOT VERIFIED |
| **Referral Report (T22-11)** | PASS (`test_phase22_referral_report.py`) | Rebuilt dist served | IMPLEMENTED — NOT VERIFIED |
| **Full Phase 22 UAT Suite (182 tests)** | PASS (182/182 PASS on `kalyan_test`) | Backup verified, compare clean | IMPLEMENTED — NOT VERIFIED |
