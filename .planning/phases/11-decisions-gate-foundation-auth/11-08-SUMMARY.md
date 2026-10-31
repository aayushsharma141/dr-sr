# Phase 11 Plan 08 Summary: Route-Walk Verification, RBAC Matrix, and Row Scope

**Execution Date:** 2026-10-31  
**Status:** Complete & Verified  
**Commits:** `9192d83`, `c40c2d0`, `ce6b653`  
**Requirements Addressed:** SEC-01, SEC-02, SEC-03, D-03, D-04  

---

## 1. Objectives Achieved

1. **Role Overview Dashboard Endpoints (Task 1):**
   - Implemented `GET /api/admin/overview`, `GET /api/reception/overview`, and `GET /api/doctor/overview` in [`routers/areas.py`](file:///d:/dr-sr/backend/src/kalyan_api/routers/areas.py).
   - Decorated endpoints with granular permission requirements: `require(Permission.DASHBOARD_ADMIN)`, `require(Permission.DASHBOARD_RECEPTION)`, and `require(Permission.DASHBOARD_DOCTOR)`.
   - Admin overview computes real active/inactive user counts grouped by role (`ADMIN`, `RECEPTION`, `DOCTOR`) via database queries.
   - Doctor overview loads linked doctor profiles and restricts output strictly to the authenticated practitioner.

2. **Non-Vacuous Route-Walk Policy Test (Task 1):**
   - Implemented [`tests/test_route_policies.py`](file:///d:/dr-sr/backend/tests/test_route_policies.py) using `fastapi.routing.iter_route_contexts(app.routes)` (avoiding obsolete `isinstance(r, APIRoute)` traversal which is vacuous on FastAPI 0.162.0).
   - Recursively walks Dependant trees (`_policies(dependant)`) to inspect `__policy__` attributes.
   - Strictly enforces that **every route declares exactly one policy marker** (`public`, `authenticated_only`, or `require(...)`).
   - Asserts non-vacuity via mandatory existence of `MUST_EXIST` routes (`/api/health`, `/api/auth/login`, `/api/auth/me`, `/api/auth/logout`, `/api/auth/change-password`, `/api/admin/overview`, `/api/reception/overview`, `/api/doctor/overview`).
   - Verifies `PUBLIC_ALLOWLIST` strictly equals `{('GET', '/api/health'), ('POST', '/api/auth/login')}`.
   - Negative control verified: throwaway app with 0-marker and 2-marker routes correctly flagged.

3. **RBAC Matrix, Completeness Gate & Secrets Scan (Task 2):**
   - Implemented [`tests/support/matrix.py`](file:///d:/dr-sr/backend/tests/support/matrix.py) with 6 non-public endpoints x 5 identities (`anonymous`, `admin`, `reception`, `doctor_a`, `doctor_b`) = 30 test cells.
   - Verified in [`tests/test_rbac_matrix.py`](file:///d:/dr-sr/backend/tests/test_rbac_matrix.py) with dedicated, isolated test users generated per cell to prevent cross-test state leakage.
   - Built completeness gate `check_matrix_completeness()`: fails CI if any registered non-public route lacks a corresponding matrix row (tested with a negative control).
   - Built recursive response scanner ensuring no 2xx response exposes sensitive credentials (`password_hash`, `current_password`, `new_password`, `token`), and `csrf_token` appears exclusively on `/api/auth/login`, `/api/auth/me`, and `/api/auth/change-password`.
   - Updated [`core/permissions.py`](file:///d:/dr-sr/backend/src/kalyan_api/core/permissions.py) `RESERVED` catalog and added `test_no_orphan_permissions` in [`tests/test_permissions_catalogue.py`](file:///d:/dr-sr/backend/tests/test_permissions_catalogue.py), verifying all permissions are either actively used by routes or explicitly tracked in `RESERVED`.

4. **Default-Deny Row Scope Helpers (Task 3):**
   - Implemented [`core/scope.py`](file:///d:/dr-sr/backend/src/kalyan_api/core/scope.py) providing `ScopeFamily` (`CLINICAL`, `DEMOGRAPHIC`, `FINANCIAL`) and `row_scope(principal, family, doctor_id_col)`.
   - Defaults strictly to `sqlalchemy.false()` for unknown roles, unauthenticated principals, or NULL `doctor_id` rows.
   - Enforces D-03: `CLINICAL` records strictly accessible only by the owning doctor (`doctor_id_col == principal.doctor_id`).
   - Enforces D-04: `RECEPTION`, `ADMIN`, unknown roles, and doctors with `doctor_id=None` receive `false()` for all clinical queries.
   - Implemented `get_scoped_or_404(session, target, obj_id, principal, family, doctor_id_col)`: executes combined ID and scope filter; raises HTTP 404 `not_found` byte-identical to a non-existent ID (mitigating T-11-39 existence leakage).
   - Validated against a PostgreSQL `TEMPORARY` table testbed in [`tests/test_scope_helpers.py`](file:///d:/dr-sr/backend/tests/test_scope_helpers.py) (18 tests passing). `conftest.py` was updated to grant `TEMPORARY` table privileges on `kalyan_test` to `kalyan_app`.

---

## 2. Test Verification & Code Quality

- **Unit & Integration Tests:** 143 tests passed, 0 failures across the entire backend suite in 13.94s.
- **Linter & Style:** `ruff check backend` passed with 0 errors.
- **Acceptance Criteria Verification:**
  - `Select-String -CaseSensitive -Pattern 'iter_route_contexts'` on `test_route_policies.py`: matches.
  - `Select-String -CaseSensitive -Pattern 'isinstance\(.*APIRoute'` on `backend/tests`: 0 matches.
  - `Select-String -CaseSensitive -Pattern 'password_hash'` on `test_rbac_matrix.py`: appears exclusively in `FORBIDDEN_SECRET_KEYS` tuple.
  - `Select-String -CaseSensitive -Pattern 'false\(\)'` on `core/scope.py`: matches default-deny base cases.
  - `Select-String -CaseSensitive -Pattern '\b403\b'` on `core/scope.py`: 0 matches (guaranteeing 404 only).

---

## 3. Next Steps

- Proceed to **Plan 11-09** (Wave 9: User administration backend service, schema models, optimistic locking with `version_id`, admin endpoints for create, update, deactivate, reactivate, unlock, and reset password).
