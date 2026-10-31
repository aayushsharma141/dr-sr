# Phase 11 Plan 15 Summary: SPA Serving, Caching Semantics & Traversal Security

**Execution Date:** 2026-11-01  
**Status:** Complete & Verified  
**Requirements Addressed:** SEC-01  

---

## 1. Objectives Achieved

1. **SPA Frontend Distribution Mount (`app.frontend`) (SEC-01):**
   - Configured FastAPI `create_app` to mount the built Vite distribution via `app.frontend("/", directory=str(dist_dir), fallback="index.html", check_dir=False)`.
   - Verified that API routes (`/api/*`) are registered before `app.frontend` so backend API endpoints always take precedence over static files.
   - Enforced absolute path requirement for `Settings.frontend_dist` via a Pydantic field validator, rejecting relative paths to prevent inadvertent serving of legacy folders.
   - Graceful fallback: when `frontend_dist` is not configured or missing `index.html`, the backend starts in API-only mode and logs a warning.

2. **HTTP Caching Semantics & Security Headers:**
   - Updated `SecurityHeadersMiddleware`:
     - `/api/*`: strictly returns `Cache-Control: no-store`.
     - `/assets/*`: returns `Cache-Control: public, max-age=31536000, immutable` for hashed static bundles.
     - HTML navigation requests (e.g. `/`, `/reception/patients`, `/admin`): return `Cache-Control: no-cache`.
     - 404 responses for missing assets do not receive immutable caching headers.
     - `HEAD` requests return 200 with matching headers and empty bodies.
     - SPA routes requested with `Accept: application/json` return 404 JSON, preserving the API contract.

3. **Path Traversal Protection & Security Guarantees:**
   - Raw-ASGI traversal probes (`/../secret.txt`, `/assets/../../secret.txt`, `/%2e%2e/secret.txt`, backslash and `%2f` variants) verified against a sandbox secret file outside the dist directory: 0 secret content leaks detected.
   - Production bundle audit verified: zero external CDN, font, or script references.

---

## 2. Verification & Automated Tests

- **Unit & Integration Suite (`pytest backend/tests/test_spa_serving.py`):**
  - `test_html_navigation_returns_index_html_with_no_cache`: Passed.
  - `test_spa_route_with_json_accept_returns_404_json`: Passed.
  - `test_api_unknown_route_returns_404_and_no_store`: Passed.
  - `test_assets_caching_and_missing_assets`: Passed.
  - `test_head_requests_work`: Passed.
  - `test_path_traversal_probes_never_leak_external_files`: Passed.
  - `test_settings_rejects_relative_frontend_dist`: Passed.
  - `test_missing_dist_starts_in_api_only_mode`: Passed.
  - `test_real_build_served` (`needs_build`): Passed with real built assets in `frontend/dist`.
- **Route Policy Enumeration:** `test_every_route_has_exactly_one_policy` passed.
- **Ruff:** `ruff check backend` clean (0 errors).
- **Backend Test Suite:** 245 tests passed.
