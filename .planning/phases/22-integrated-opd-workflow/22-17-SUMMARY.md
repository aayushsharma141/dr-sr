# Phase 22 Plan 17 Summary: Admin Referral Report API

**Plan:** 22-17  
**Status:** IMPLEMENTED — NOT VERIFIED  
**Task IDs:** T22-11  

---

## 1. AGENTS.md Governance Report

- **Task ID:** 22-17 (T22-11)
- **Owned Files:**
  - `backend/src/kalyan_api/routers/reports.py` (new)
  - `backend/src/kalyan_api/schemas/reports.py` (new)
  - `backend/tests/test_phase22_referral_report.py` (new)
  - `backend/src/kalyan_api/main.py` (modified)
  - `backend/src/kalyan_api/core/permissions.py` (modified)
  - `backend/tests/support/matrix.py` (modified)
  - `backend/tests/openapi.snapshot.json` (modified)
- **Git Checkpoint:**
  - Checkpoint stash: `checkpoint: before 22-17 referral report api` (stored in git stash list).
  - Working tree and index untouched; no commits created; zero database resets (kalyan_dev untouched, all backend tests run on kalyan_test).
- **Findings:**
  - Designed and implemented the Admin Referral Report endpoint `GET /api/reports/referrals` (OD-I, OD-22-21, T22-11).
  - Query parameters:
    - `date_from: date` (required, inclusive)
    - `date_to: date` (required, inclusive)
    - Returns HTTP 422 `invalid_date_range` if `date_from > date_to`.
    - `source: str | None` (optional filter for referral source or `NOT_RECORDED`, case-insensitive).
    - `referrer: str | None` (optional filter for referrer name substring, case-insensitive).
  - Exclusions & Aggregations:
    - Excludes CANCELLED visits (`status != 'CANCELLED'`).
    - Visited records opened before Phase 22 with NULL `referral_source` are bucketed as `"NOT_RECORDED"` (never inferred, adhering to migration 0026 rule and design §4).
    - Referrer names are grouped exactly as stored; `referrer_name` appears only for sources that require one (`DOCTOR`, `PERSONAL`, `ORGANIZATION`), and is `None` for `SELF`, `OTHER`, and `NOT_RECORDED` (OD-22-16, UI-SPEC S7).
    - Aggregated rows ordered by `visit_count` descending, then `source` ascending, then `referrer_name` ascending (with nulls last).
    - Returns `ReferralReportOut` envelope with `date_from`, `date_to`, `rows`, and `total_visits`.
  - Authorisation & RBAC:
    - Protected by `require(Permission.REPORT_REFERRAL)`.
    - Removed `Permission.REPORT_REFERRAL` from `RESERVED` mapping in `permissions.py` (leaving `RESERVED: dict[Permission, str] = {}`).
    - Catalog verified: Admin holds `report:referral` (200), Reception denied (403), Doctor denied (403), Anonymous denied (401).
  - Test Suite & Matrix:
    - Added `MatrixRow` for `GET /api/reports/referrals?date_from=2026-11-01&date_to=2026-11-30`.
    - Extended `check_matrix_completeness` in `support/matrix.py` to match paths stripped of query string (`r.path.split("?")[0]`).
    - Regenerated `openapi.snapshot.json` using `kalyan_api.cli export-openapi`.
    - Wrote comprehensive unit and integration tests in `backend/tests/test_phase22_referral_report.py`.
- **Root Cause / Motivation:**
  - Owner requirement OD-I and OD-22-21: the clinic owner wants to see where patients come from over a given date range; the referral source is captured per visit at check-in since Phase 22 Wave 1.
- **Changes:**
  - `backend/src/kalyan_api/schemas/reports.py`:
    - Defined `ReferralReportRow` (`source`, `referrer_name: str | None = None`, `visit_count: int`).
    - Defined `ReferralReportOut` (`date_from: date`, `date_to: date`, `rows: list[ReferralReportRow]`, `total_visits: int`).
  - `backend/src/kalyan_api/routers/reports.py`:
    - Implemented `GET /reports/referrals` route with parameter validation (`date_from > date_to -> 422`), SQL aggregate query using `func.coalesce`, conditional `case` expression for referrer name isolation, status filtering, optional source/referrer filtering, and deterministic ordering.
  - `backend/src/kalyan_api/main.py`:
    - Included `reports_router` with prefix `"/api"`.
  - `backend/src/kalyan_api/core/permissions.py`:
    - Unreserved `Permission.REPORT_REFERRAL` from `RESERVED` mapping.
  - `backend/tests/test_phase22_referral_report.py`:
    - Unit and integration tests verifying report count aggregation, distinct spelling preservation, NOT_RECORDED legacy handling, CANCELLED exclusion, out-of-range exclusion, source filter, case-insensitive referrer substring filter, date validation, and RBAC matrix permissions.
  - `backend/tests/support/matrix.py`:
    - Added `MatrixRow` for `/api/reports/referrals?date_from=2026-11-01&date_to=2026-11-30`.
    - Handled query string strip in `check_matrix_completeness`.
  - `backend/tests/openapi.snapshot.json`:
    - Regenerated OpenAPI snapshot capturing the new `/api/reports/referrals` endpoint, parameters, and schemas.
- **Test Commands & Results:**
  - Referral report, permissions catalogue, route policies, matrix, and snapshot tests:
    `$env:PYTHONPATH="D:/dr-sr/backend/src"; backend/.venv/Scripts/python.exe -m pytest -p no:warnings backend/tests/test_rbac_matrix.py backend/tests/test_openapi_snapshot.py backend/tests/test_route_policies.py backend/tests/test_permissions_catalogue.py backend/tests/test_phase22_referral_report.py backend/tests/test_phase22_checkin.py`
    -> **818 passed in 110.10s (0:01:50)**
- **Dependencies:**
  - Upstream: 22-01 / 22-02 (referral source on visits), 22-12.
  - Downstream: 22-18 (Admin referral report frontend page / table).
- **Remaining Risks:**
  - End-to-end integration with frontend table and production database check deferred to later plans in Phase 22; marked as `IMPLEMENTED — NOT VERIFIED`.

---

## 2. Requirements Satisfied

- **T22-11 (Referral report for admin):** Grouped counts by source and referrer for date range, exclusions for cancelled visits, not-recorded bucket for legacy records, source and referrer filters, strictly restricted to Admin (403 for reception/doctor).
