# Kalyan Hospital — Coding & Architecture Policy

## Principles
1. **Preserve Architecture**: Do not rewrite working modules or replace established libraries.
2. **Minimal, Surgical Changes**: Follow Ponytail rules — solve the whole problem with the least new code. No unnecessary abstractions, wrappers, or "for later" boilerplate.
3. **Single File Ownership**: During multi-agent tasks, each implementation agent owns an exclusive set of files. Never edit files owned by another worker without explicit handoff.
4. **TypeScript & React Standards**:
   - Strict typing across frontend code.
   - Respect component hierarchy and AppShell navigation conventions.
   - Follow accessibility guidelines (accessible names, keyboard focus, ARIA standards).
5. **FastAPI & Python Standards**:
   - Explicit Pydantic schemas for requests and responses.
   - Role-based authorization enforced at every endpoint dependency (`kalyan_api.core.policy.require`).
   - Audit logging via `AuditWriter` within the caller's transaction boundary.
   - No sensitive values (passwords, tokens) in responses or audit logs.

