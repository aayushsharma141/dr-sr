# Security, LAN & Deployment Audit (T06)

- **Auditor**: Security Explorer
- **Repository Scope**: Authentication, sessions, permissions, offline posture, backup security
- **Date**: 2026-11-09
- **Status**: AUDITED

---

## 1. Authentication & Session Security
- **Password Storage**: Argon2id via `argon2-cffi` adhering to OWASP floor (`time_cost=3`, `memory_cost=65536`, `parallelism=4` in production).
- **Session Tokens**: 32-byte cryptographically secure random tokens stored in database with idle timeout (30 min) and absolute timeout (12 hours).
- **CSRF Protection**: Double-submit CSRF cookie matching request headers.
- **Brute Force Defense**: Account lockout after consecutive failed attempts with sliding cooldown.

---

## 2. Findings & Mitigation Plan
1. **[SEC-01 / F-1] Plain HTTP Cookie & LAN Sniffing Risk**:
   - `KALYAN_COOKIE_SECURE=false` in `.env.example` allows unencrypted cookies over plain HTTP on LAN.
   - Recommended Mitigation: Terminate TLS via local reverse proxy (Caddy / IIS ARR) with a local hospital CA certificate, enabling `KALYAN_COOKIE_SECURE=true`.
2. **[SEC-02 / F-2] Database Backup Verification & SQL Execution**:
   - Backup restore runs `psql -f db.sql` using `kalyan_owner` privileges.
   - Integrity manifest uses SHA-256 inside the tar archive.
   - Recommended Mitigation: Enforce strict archive path traversal checks, sanitize SQL inputs, and verify file signatures.
3. **[SEC-03 / F-4] PHI in Unencrypted Local Backups**:
   - Local database backup tar archives are stored unencrypted on server storage.
   - Recommended Mitigation: Implement AES-256 encryption for backup archives at rest with a locally managed server key.

