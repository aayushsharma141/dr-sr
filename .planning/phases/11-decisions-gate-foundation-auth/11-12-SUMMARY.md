# Phase 11 Plan 12 Summary: React + TypeScript Toolchain & API Client

**Execution Date:** 2026-10-31  
**Status:** Complete & Verified  
**Requirements Addressed:** SEC-01, SEC-06, D-01, D-08  

---

## 1. Objectives Achieved

1. **Vite + React + TypeScript Toolchain with Exact Pins (SEC-01):**
   - Established standalone offline-ready frontend under `frontend/`.
   - Exact pinned versions without floating semver ranges (`^` or `~` strictly absent):
     - `react@19.3.1`, `react-dom@19.3.1`
     - `react-router@8.5.1`
     - `@tanstack/react-query@5.105.0`
     - `vite@8.3.5`, `@vitejs/plugin-react@6.1.2`
     - `typescript@7.0.2`
     - `tailwindcss@4.3.3`, `@tailwindcss/vite@4.3.3`
     - `oxlint@1.90.0`
     - `vitest@5.0.5`, `jsdom@30.1.3`
     - `@testing-library/react@16.3.3`, `@testing-library/dom@10.4.2`, `@testing-library/jest-dom@7.0.1`, `@testing-library/user-event@14.6.8`
     - `@types/react@19.3.0`, `@types/react-dom@19.3.0`, `@types/node@24.19.2`
   - `.npmrc` configured with `save-exact=true` and `engine-strict=true`.
   - `tsconfig.json` configured with `erasableSyntaxOnly=true`, `verbatimModuleSyntax=true`, `moduleResolution="bundler"`, and `strict=true`.
   - `vite.config.ts` configured with React and Tailwind plugins, test environment jsdom with setup file, and `/api` reverse proxy to `http://127.0.0.1:8000` preserving client `Host` without `changeOrigin` for same-origin CSRF compliance.
   - `frontend/index.html` has zero external script, font, or CDN links.
   - Committed `package-lock.json` with 127 installed packages and 0 vulnerabilities.

2. **Hand-Written API Client with CSRF & Error Envelope Contract (SEC-06, D-01, D-08):**
   - `apiFetch<T>(path, init)`:
     - Automatically prefixes `/api` to request paths.
     - Enforces `credentials: 'same-origin'` on all calls.
     - Adds `Content-Type: application/json` when body is provided.
     - Stores CSRF token solely in module memory via `setCsrfToken` (never in `localStorage`, `sessionStorage`, or cookies under D-01).
     - Automatically attaches `X-CSRF-Token` header on non-GET/HEAD methods.
     - Flattens backend error response envelopes into `ApiError(status, code, message, extra)`.
     - Maps `409` conflict responses with `version_conflict` code and exposes `extra.entity` and `extra.id`.
     - Automatically triggers registered `onAuthLost` callbacks on `not_authenticated` or `session_expired` 401 statuses.
     - Returns `undefined` for `204 No Content` responses.
     - Gracefully falls back to code `error` and HTTP status text for non-JSON error bodies.
   - `types.ts`: Complete TypeScript definitions for `Role`, `Me`, `AreaOverview` (`AdminOverview`, `ReceptionOverview`, `DoctorOverview`), `UserOut`, `UserCreatedOut`, and union of `ApiErrorCode`.

3. **Zero Secure-Context / Web Storage Dependencies (D-01):**
   - Zero occurrences of `localStorage`, `sessionStorage`, `randomUUID`, `navigator.clipboard`, or `serviceWorker` across `frontend/src`.

---

## 2. Verification & Automated Tests

- **Typecheck:** `npm --prefix frontend run typecheck` (`tsc -b`) exits 0 with 0 errors.
- **Lint:** `npm --prefix frontend run lint` (`oxlint`) exits 0 with 0 errors and 0 warnings across 6 files.
- **Tests:** `npm --prefix frontend run test` (`vitest run`) executes 7/7 passing unit tests in `src/api/__tests__/client.test.ts`.
- **Build:** `npm --prefix frontend run build` produces production bundle in `dist/` in 210ms.
- **Backend Regression Suite:** 238 passed in 21s (100% green).
