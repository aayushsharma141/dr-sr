# Kalyan Hospital — Testing & Verification Policy

## Verification Levels
1. **Frontend**:
   - Framework: Vitest (`npm.cmd run test` in `frontend/`)
   - Testing Library: `@testing-library/react`
   - Scope: Component behavior, forms, role-gated navigation, accessible elements, and UI state transitions.
2. **Backend**:
   - Framework: pytest (`.venv\Scripts\pytest.exe -c pyproject.toml` in `backend/`)
   - Scope: Service boundaries, schema validation, authorization enforcement, transaction rollbacks, concurrency, and audit logging.
3. **Database**:
   - Enforce relational integrity, unique constraints (e.g. daily doctor tokens, URN uniqueness), and trigger guards against `kalyan_test`.
4. **End-to-End Workflow Validation**:
   - Verify all 17 core hospital business workflows (WF-001 through WF-017).
   - Assert actual user-visible state, API contract payload, and database persistence.
   - Reload tests to ensure persistent state across browser refresh.

## Evidence Standards
- Never mark a task `VERIFIED` without executing the test commands and inspecting output.
- Unverified work must remain `IMPLEMENTED — NOT VERIFIED`.
- Synthetic data only; zero PII.

