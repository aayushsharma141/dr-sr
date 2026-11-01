# Security Checklist & Detailed Audit Findings — Kalyan Hospital

This document provides a comprehensive security review of the Kalyan Hospital LAN Web Platform across 20 audit categories. Every finding includes full architectural evidence and remediation guidance.

---

## 1. Categorized Security Checklist

| Category | Control Description | Status in Project | Implementation Reference |
|---|---|---|---|
| **1. Authentication** | Zero default/hardcoded credentials | Pass (Verified) | `backend/tests/test_no_default_credentials.py` |
| | Modern password hashing (Argon2id) | Pass (Verified) | `core/security.py` (`time_cost=3`, `memory=64MB`) |
| | NIST password complexity & length limits | Pass (Verified) | `core/password_policy.py` (min 10 chars, user similarity checks) |
| | First-run setup bootstrap via console code | Pass (Verified) | `core/setup_code.py`, `routers/setup.py` |
| | Forced password change on first login/reset | Pass (Verified) | `models.py` (`must_change_password`), `guards.tsx` |
| **2. Authorization / RBAC** | Strict role catalogue (Admin, Reception, Doctor) | Pass (Verified) | `core/permissions.py` |
| | Server-side permission checks on all routes | Pass (Verified) | `backend/tests/test_route_policies.py` (automated walk) |
| | Doctor silo (doctors edit only assigned cases) | Pass (Verified) | `core/scope.py` (`ScopeFamily.CLINICAL`) |
| | Reception clinical default-deny (403/404) | Pass (Verified) | `routers/encounters.py`, `backend/tests/test_clinical_encounters.py` |
| | Inactive user session revocation & block | Pass (Verified) | `routers/users.py`, `services/user_service.py` |
| **3. Session / Token Security**| Cryptographically secure session tokens | Pass (Verified) | `core/security.py` (`secrets.token_urlsafe(32)`) |
| | Session tokens stored hashed in DB | Pass (Verified) | `sessions.token_hash` (SHA-256) |
| | HttpOnly and SameSite=Strict cookies | Pass (Verified) | `routers/auth.py` (`httponly=True`, `samesite="strict"`) |
| | Cookie Secure flag enabled on transport | **Weakness** | `config.py` (`cookie_secure = False` on plain HTTP) |
| | Sliding idle timeout (30 min) & absolute (12 hr) | Pass (Verified) | `config.py`, `routers/auth.py` |
| **4. Input Validation** | Strict request schema typing | Pass (Verified) | Pydantic v2 schemas across `backend/src/kalyan_api/schemas/` |
| | Mobile number normalization (10 digits) | Pass (Verified) | `routers/patients.py` (`_clean_mobile`) |
| | Enum & string length constraints | Pass (Verified) | SQL column bounds & Pydantic `Field(max_length=...)` |
| **5. Injection Defense** | SQL parameterization (ORM queries) | Pass (Verified) | SQLAlchemy 2.0 select/insert expressions; 0 raw SQL strings |
| | Path traversal prevention on file paths | Pass (Verified) | `Path(filename).name` in `services/photo_service.py` |
| **6. XSS / CSRF** | Content Security Policy & Security headers | Pass (Verified) | `main.py` (`SecurityHeadersMiddleware`) |
| | Origin / Referer validation on unsafe methods | Pass (Verified) | `core/csrf.py` (`verify_origin`) |
| | Cryptographic double-submit CSRF token | Pass (Verified) | `core/csrf.py` (`check_csrf_token`) |
| | Frontend CSRF token kept in memory | Pass (Verified) | `frontend/src/api/client.ts` (never in local storage) |
| **7. API Security** | Standard JSON error envelopes | Pass (Verified) | `core/errors.py` (`ApiError`, `STATUS_TO_CODE`) |
| | No sensitive data echoing in validation errors | Pass (Verified) | `core/errors.py` (omits values from `fields`) |
| | Request tracing with X-Request-ID | Pass (Verified) | `core/errors.py` (`RequestIdMiddleware`) |
| **8. Rate Limiting / Abuse** | Account lockout on 5 failed attempts | Pass (Verified) | `models.py` (`locked_until`), `routers/auth.py` |
| | Database-backed per-IP failure rate limiting | Pass (Verified) | `services/throttle_service.py` (`LoginThrottle`) |
| | Constant-time dummy hash verification | Pass (Verified) | `core/security.py` (`dummy_verify`) |
| **9. File Uploads** | File payload size limit (5 MB) | Pass (Verified) | `services/photo_service.py` (`MAX_PHOTO_BYTES`) |
| | Magic bytes validation (JPEG/PNG) | Pass (Verified) | `services/photo_service.py` (`JPEG_MAGIC`, `PNG_MAGIC`) |
| | Random UUID renaming | Pass (Verified) | `services/photo_service.py` (`uuid.uuid4().hex`) |
| | Private storage outside web roots | Pass (Verified) | `backend/var/photos` |
| | Authenticated download route | Pass (Verified) | `GET /api/v1/patients/{id}/photo` |
| **10. Database Security** | Least-privilege runtime user (`kalyan_app`) | Pass (Verified) | `0001_baseline.py` (no DDL/DROP privileges) |
| | Trigger-enforced append-only audit logs | Pass (Verified) | `0001_baseline.py` (`trg_audit_logs_no_update_delete`) |
| | Trigger-enforced clinical note immutability | Pass (Verified) | `0003_appointments_and_clinical_encounters.py` |
| | ACID row-level locking for concurrency | Pass (Verified) | `urn_service.py`, `token_service.py` (`with_for_update`) |
| **11. Secrets Management** | Configuration via environment variables | Pass (Verified) | `config.py` (`pydantic-settings`) |
| | Git-ignored `.env` and `var/` | Pass (Verified) | `.gitignore` |
| | Refusal to run on placeholder passwords | Pass (Verified) | `config.py` (`validate_password_not_placeholder`) |
| **12. Encryption** | Modern at-rest hashing | Pass (Verified) | Argon2id for passwords; SHA-256 for session tokens |
| | In-transit encryption (HTTPS) | **Missing Control**| Plain HTTP default under D-01 |
| **13. CORS** | Strict Origin matching | Pass (Verified) | `core/csrf.py` |
| | Restrictive allowed origins | Pass (Verified) | Defaults to server Host header; dev origins configurable |
| **14. Dependency Security** | Pinned dependencies in lockfiles | Pass (Verified) | `requirements.lock.txt`, `package.json` |
| | Zero runtime external CDN dependencies | Pass (Verified) | Local fonts and local static assets bundled |
| **15. Logging / Monitoring** | Structured append-only audit trail | Pass (Verified) | `services/audit_service.py` |
| | Passwords/tokens omitted from logs | Pass (Verified) | Enforced in schemas, CLI, and error handlers |
| **16. Admin Security** | CLI-only password reset recovery | Pass (Verified) | `cli.py` (`cmd_reset_admin_password`) |
| | Zero web-based admin backdoor | Pass (Verified) | First-run setup permanently closed after registration |
| **17. Deployment / Infra** | PostgreSQL bound to localhost (`127.0.0.1`) | Pass (Verified) | `config.py` (`db_host = "127.0.0.1"`) |
| | Durability startup check | Pass (Verified) | `db/startup.py` (checks `fsync`, `synchronous_commit`) |
| **18. Data Privacy** | Doctor silo access isolation | Pass (Verified) | `core/scope.py` |
| | Receptionist default-deny clinical notes | Pass (Verified) | `routers/encounters.py` |
| **19. Error Handling** | Generic 500 responses without tracebacks | Pass (Verified) | `core/errors.py` (`handle_unhandled_exception`) |
| | Optimistic concurrency 409 envelopes | Pass (Verified) | `core/errors.py` (`handle_version_conflict`) |
| **20. Backup / Recovery** | PostgreSQL + files backup pipeline | **Missing Control**| Phase 16 planned; not yet implemented in v3.0 |

---

## 2. Detailed Findings

---

### A. Confirmed Vulnerabilities
*None detected.* The codebase exhibits strong architectural defenses with zero hardcoded credentials, zero unparameterized SQL strings, and automated regression suites.

---

### B. Security Weaknesses

#### FINDING-01: Plain HTTP Transport Default (`cookie_secure=False`)
- **Severity**: Medium
- **Evidence**: `backend/src/kalyan_api/config.py` line 34: `cookie_secure: bool = False  # D-01: Plain HTTP on offline LAN`, and `backend/src/kalyan_api/routers/auth.py` lines 258 and 476.
- **Risk**: Cleartext transmission of session cookies and clinical/demographic data across the hospital LAN. Anyone on the local network (via a compromised terminal or Wi-Fi packet capture) can sniff the `kalyan_session` cookie and hijack sessions.
- **Affected Location**: `backend/src/kalyan_api/config.py`, `backend/src/kalyan_api/routers/auth.py`.
- **Why It Matters**: Even on an offline LAN, unauthorized devices or malware on staff workstations can monitor unencrypted HTTP traffic.
- **Recommended Fix**: Enable TLS (HTTPS) on the central server using a local self-signed or internal CA certificate, and set `KALYAN_COOKIE_SECURE=true`.

#### FINDING-02: Doctor Role Missing `PHOTO_READ` Permission
- **Severity**: Low
- **Evidence**: `backend/src/kalyan_api/core/permissions.py` lines 122–140 (`Role.DOCTOR` lacks `Permission.PHOTO_READ`), while `backend/src/kalyan_api/routers/patients.py` line 337 requires `Permission.PHOTO_READ` to stream patient photos.
- **Risk**: When a doctor opens a patient file during consultation, the patient's photo cannot be displayed (API returns 403 Forbidden). This impairs the doctor's ability to visually confirm the patient's identity against the medical record.
- **Affected Location**: `backend/src/kalyan_api/core/permissions.py`.
- **Why It Matters**: Visual patient verification is a key clinical safety control against record misattribution.
- **Recommended Fix**: Add `Permission.PHOTO_READ` to `ROLE_PERMISSIONS[Role.DOCTOR]`.

---

### C. Missing Controls

#### FINDING-03: Automated Database Backup & Verification Not Yet Built (Phase 16 Scope)
- **Severity**: High (Operational / Data Resilience)
- **Evidence**: `.planning/ROADMAP.md` Phase 16 (`Audit Viewer, Backup/Restore & Integrity`) is marked unstarted.
- **Risk**: If the server PC suffers physical storage failure, power surge, or file system corruption prior to Phase 16 completion, patient medical records and intake history could be permanently lost.
- **Affected Location**: Central server infrastructure; missing backup automation scripts.
- **Why It Matters**: Clinical continuity and statutory medical record preservation require daily verifiable backups to a secondary physical medium.
- **Recommended Fix**: Implement Phase 16 backup service using scheduled `pg_dump` bundles paired with checksummed patient photo directory snapshots written to an external physical drive.

---

### D. Potential Risks Requiring Verification

#### FINDING-04: In-Memory Multipart Parsing of Patient Photos
- **Severity**: Low
- **Evidence**: `backend/src/kalyan_api/routers/patients.py` lines 45–58 uses `await request.body()` followed by `BytesParser().parsebytes()` to extract photo payloads into memory.
- **Risk**: If multiple concurrent uploads occur, reading full file payloads into server RAM could increase memory pressure on low-spec server hardware.
- **Affected Location**: `backend/src/kalyan_api/routers/patients.py` (`_extract_photo_bytes`).
- **Why It Matters**: Resource exhaustion on a low-RAM server could cause API slowdowns.
- **Compensating Control**: Request size is capped at 5 MB (`MAX_PHOTO_BYTES`).
- **Recommended Fix**: Stream upload chunks directly to disk using FastAPI `UploadFile` rather than buffering `await request.body()`.

#### FINDING-05: Server Hardware & UPS Durability Uncertainty
- **Severity**: Medium
- **Evidence**: `DECISIONS.md` lists `OD-01 (Server PC, OS, RAM, storage, fixed IP, UPS)` as "Pending client approval".
- **Risk**: Frequent Indian grid power cuts without a dedicated Uninterruptible Power Supply (UPS) could cause ungraceful server shutdowns, potentially risking filesystem or transaction journal corruption.
- **Affected Location**: Physical server deployment.
- **Why It Matters**: Data durability checks in `db/startup.py` verify PostgreSQL `fsync=on`, but physical power failure during write flushes requires hardware battery protection.
- **Recommended Fix**: Confirm server hardware with battery-backed UPS before production go-live.

---

### E. Recommendations

1. **Enforce HTTPS in Production**: Transition from plain HTTP (`D-01`) to HTTPS (`KALYAN_COOKIE_SECURE=true`) with an approved internal certificate.
2. **Synchronize Permission Matrix**: Add `Permission.PHOTO_READ` to Doctor role.
3. **Execute Backup Implementation (Phase 16)**: Prioritize automated backup scheduling and clean-machine restore rehearsals before live clinical rollout.
4. **Physical Server Hardening**: Restrict physical access to the server PC, lock the Windows console session when unattended, and encrypt server storage volumes with BitLocker.

