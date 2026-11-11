# Overall System Validation & Release Readiness Report

**Project:** Kalyan Hospital centralized LAN hospital system  
**Validation date:** 2026-11-11  
**Reviewed application commit:** `2736a8ae01b5546b1722b1f819afe11a632a1444`  
**Branch:** `arena/f4de0770-dr-sr`  
**Scope:** Active React/FastAPI/PostgreSQL platform, deployment scripts, automated tests, privacy artifacts, current documentation and handover evidence. The legacy PySide6/SQLite application is excluded from the production runtime assessment.  
**Data used during validation:** Synthetic automated-test records only. No production database or backup was accessed.

## 1. Final verdict

# **NO-GO for real patient use or hospital production deployment**

The repository contains a substantial centralized browser application with strong engineering foundations and extensive automated coverage. It is not an empty prototype. However, it currently fails essential patient-safety, confidentiality, synthetic-data and operational-acceptance requirements.

The decisive blockers are:

1. **Critical:** clinical records can be linked to the wrong patient, and a mismatched encounter can complete another patient’s appointment.
2. **High:** the unified timeline exposes clinical and financial information beyond the caller’s direct endpoint permissions and row scope.
3. **High / explicit requirement:** the repository cannot be certified as synthetic-data-only; it contains realistic patient-identifiable sample output and identifiable people in clinical/promotional media without documented synthetic provenance or consent.
4. **High:** the supplied production configuration uses unencrypted HTTP, and access logging can record patient name/mobile search parameters.
5. **High for handover:** scheduled-backup deployment is incomplete, the active Admin UI disconnects users from the existing schedule API, and clean-machine/second-drive/power-recovery acceptance has not been demonstrated.
6. **High workflow risk:** clinical errors are mislabeled, long forms lack unsaved-work protection, and photo-upload failure can be hidden behind registration success.

A green CI run is valuable evidence of implemented behavior; it does not negate these defects or substitute for real LAN, printer, restore, accessibility and power-recovery acceptance.

## 2. Requirement-by-requirement assessment

Status meanings:

- **PASS — implementation evidence:** source and automated tests support the requirement; any listed hardware acceptance remains separate.
- **PARTIAL:** meaningful implementation exists, but important behavior, integration or acceptance evidence is missing.
- **FAIL:** current behavior violates the requirement or a safety/privacy invariant.
- **NOT VERIFIED:** requires hardware, physical deployment, a real browser/screen reader or hospital staff acceptance.

| Requested capability | Status | Validation finding |
|---|---|---|
| Browser-based hospital application | **PASS — implementation evidence** | Active React SPA with role routes, FastAPI API and local production bundle. Frontend build succeeds. |
| One central server for shared records | **PASS — implementation evidence** | Central FastAPI service, PostgreSQL system of record, private server-side photo directory, audit and backup services are present. Legacy SQLite is not the active server. |
| Works on LAN without internet | **PASS in source; handover pending** | Frontend uses same-origin API calls and local images; no runtime CDN, cloud auth, analytics or remote font dependency was found. Backend SPA tests audit the production bundle for external hosts. A disconnected 3–5-PC test was not performed. Installer falls back to online `pip` if no wheelhouse is supplied, so offline installation media must be prepared explicitly. |
| Reception and doctors on 3–5 PCs simultaneously | **PARTIAL / blocked** | PostgreSQL concurrency tests cover 20-thread URN/receipt allocation, payment constraints, token allocation, setup races and optimistic locking. This is not an actual 3–5-browser load/session test, and the cross-patient defect makes concurrent clinical use unsafe. |
| Individual logins and fixed roles | **FAIL as a complete confidentiality boundary** | Argon2id passwords, HttpOnly cookie sessions, CSRF/origin checks, idle/absolute expiry, lockout, revocation, forced password change, fixed Admin/Reception/Doctor permissions and route-policy tests exist. The timeline nevertheless bypasses domain permissions and doctor/financial scopes. |
| First-run one-time setup code on server console | **PASS with one security gap** | Cryptographically random code, interactive-console output, non-TTY local-file fallback, hashed in-memory verification, throttling/rotation, atomic advisory lock, one concurrent winner, post-commit consumption and permanent `410 setup_closed` behavior are implemented and tested. No default users are seeded. |
| Public bootstrap permanently disabled | **PASS — implementation evidence** | The singleton `system_setup` row closes both setup endpoints permanently, including after restart or deactivation of all administrators. Recovery is local CLI password reset, not public rebootstrap. |
| Short-lived setup secret required by Security docs | **PARTIAL** | No issue timestamp or time-to-live is stored or checked. An unconsumed setup code remains valid indefinitely until restart, rotation or successful setup, contrary to `SECURITY.md`’s short-expiry requirement. |
| Patient registration, search and edit | **PARTIAL** | URN allocation, URN/name/mobile/Devanagari search, duplicate warning, optimistic edit conflicts and before/after audit exist. The directory exposes only the first 20 records without pagination. The registration model does not map one-to-one to all canonical fields in `PRD.md` (PIN, patient in/out, referral and integrated treatment/payment details are not in that form). |
| Patient photographs / uploaded files | **PARTIAL** | JPEG/PNG size and magic-byte checks, UUID names, private storage and authorized reads exist; backups include photos. General document/scan attachments are deferred by the PRD. Registration can hide a failed photo upload. Browser webcam capture on LAN PCs requires HTTPS or localhost, while production is HTTP. |
| Appointments and doctor queue | **PARTIAL / blocked by clinical invariant** | Tokens, daily queues, statuses, permissions and stale-update handling are implemented. A mismatched encounter can advance and complete another patient’s appointment, violating workflow integrity. |
| Clinical history, prescriptions and treatment | **FAIL** | Encounters, immutable finalization/addenda, prescriptions, treatment plans, immutable sessions and VAS exist. Three creation paths omit same-patient relationship validation, and PostgreSQL lacks a cross-table patient-identity constraint. |
| Unified chronological timeline | **FAIL** | Aggregation bypasses the underlying domain permissions/scopes: Admin can receive clinical details, Reception treatment details, and Doctors financial and unscoped cross-doctor operational details denied by direct endpoints. |
| Billing, payments, dues and reversals | **PASS — automated implementation evidence** | Integer paise, positive amounts, payment methods, ledger-derived dues, package overpayment constraints, concurrent receipt allocation, Admin-only reasoned reversals, receipt reprints marked `DUPLICATE`, and payment immutability tests are present. Real printer acceptance remains open. |
| Audit history | **PASS — automated implementation evidence** | In-transaction audit writing, credential-key redaction, append-only database triggers, Admin filtering and actor attribution are implemented. Separate access-log privacy leakage is described below. |
| Manual backup and restore | **PARTIAL** | Database+photo `.tar.gz` bundles, SHA-256 manifests, corruption checks, path confinement, mandatory pre-restore snapshot and transactional SQL restore are implemented and tested. Restore acts directly on the configured database rather than proving the required staged verification/cutover on separate clean hardware. Bundles are compressed and checksummed, not encrypted. |
| Scheduled backup and second physical drive | **FAIL for delivered handover** | Scheduler service and settings APIs exist, including verified second copies and retention. However, `deploy/register-backup-task.ps1` referenced by the UI is absent, no other script registers that task, the production template has no `KALYAN_BACKUP_DESTINATIONS`, and the active backup page incorrectly says schedule APIs do not exist. The implemented `BackupSchedulePanel` is not mounted. |
| Auto-start and power recovery | **PARTIAL / NOT VERIFIED on hardware** | Windows startup task, database wait/schema/durability gates and health-check scripts exist. No reboot/power-cut test was performed. The startup batch continues after `check-db` failure, and the task runs as elevated `SYSTEM`, conflicting with the documented dedicated least-privilege service-account direction. |
| Simple, fast, clinic-friendly UX | **PARTIAL** | Role navigation, native dialogs, responsive layouts and extensive frontend tests exist. Misleading error copy, unsaved-work loss, hidden partial failure, first-page-only patient browsing, missing billing shell, mobile-drawer keyboard gaps and small-text/table issues remain. No measured 3–5-PC latency or staff-usability result is available. |
| Safe handling of private medical data | **FAIL** | Timeline overexposure, plain HTTP, patient identifiers in loggable query strings, unencrypted backup bundles and unverified media/sample-data provenance prevent a privacy-safe release decision. |
| Synthetic test data only | **FAIL / cannot certify** | Test database names must end in `_test`, migrations seed no users/doctors, fixtures use fictional test records, and no live database/photo backup was found in Git. Conversely, `demo/Sample_Registration_KH-2026-0006.pdf` contains realistic patient identity/contact/address/clinical details without a synthetic label or provenance, and `srivashishthakalyantrust/` contains identifiable people in clinical/promotional media, including apparent treatment recipients. Consent or synthetic provenance is not documented. |
| Actual A4/Hindi printer acceptance | **NOT VERIFIED** | Print component tests exist; five opt-in browser print checks were skipped locally. Phase 18 records physical-printer and printed-Devanagari checks as waived, not passed. Historical claims of real-printer sign-off and older paper sizes conflict with current A4 decisions and must not be used as acceptance evidence. |
| NVDA, keyboard and display-scaling acceptance | **NOT VERIFIED** | Component-level keyboard/focus tests exist. Real Edge, NVDA, long Hindi/English dialog, reduced-motion and Windows 100/125/150% scaling checks remain outstanding in Phase 18 records. |

## 3. Release-blocking findings

### RB-1 — Critical: wrong-patient clinical relationships are accepted

**Affected code**

- `backend/src/kalyan_api/routers/encounters.py`
- `backend/src/kalyan_api/routers/prescriptions.py`
- `backend/src/kalyan_api/routers/treatment_plans.py`
- Independent foreign keys in `backend/src/kalyan_api/models.py`

**Runtime proof already obtained**

Synthetic PostgreSQL probes created all three invalid relationships with HTTP 201. An encounter for Patient B linked to Patient A’s appointment advanced Patient A’s appointment to `IN_CONSULTATION`; finalizing the encounter marked it `DONE`.

**Required correction**

Validate patient equality before every mutation; preserve doctor ownership checks; reject mismatches without side effects; audit existing data; add composite constraints or equivalent triggers; add negative API and direct-database tests. Detailed remediation is in `docs/FOUNDATIONAL-BUG-REPORT.md`.

### RB-2 — High: timeline authorization bypass

`backend/src/kalyan_api/routers/timeline.py` applies `TIMELINE_READ` and a separate broader role-name policy instead of composing each domain’s permission and row-scope rules. Existing tests currently assert the overbroad behavior.

**Required correction**

Build each timeline section through shared domain authorization/query functions and role-approved redacted DTOs. Add per-role, per-event, sensitive-field and cross-doctor tests proving the aggregate cannot return anything denied by its direct endpoint.

### RB-3 — High: synthetic-only and media privacy requirement is not met

Two artifact classes need immediate data-governance review:

1. `demo/Sample_Registration_KH-2026-0006.pdf` contains realistic named patient, address, mobile and clinical details. No source fixture, synthetic watermark or provenance was found.
2. `srivashishthakalyantrust/` is approximately 159 MB of real-world promotional/clinical images and videos. Sampled frames show identifiable people, including apparent treatment recipients. These are not synthetic UI fixtures.

This report does not determine whether any depicted person gave consent. Under the stated “no real patient information” constraint, consent cannot be assumed.

**Required correction**

Quarantine/remove suspected patient artifacts from the development and test repository; replace them with clearly marked synthetic records and illustrations. If any artifact is claimed to be synthetic or consented marketing material, document provenance and approval explicitly. Do not attach the materials to issues or reports. Add an approved-asset/data-governance check before future commits.

### RB-4 — High: production transport and log privacy need correction

- `deploy/.env.production.template` sets `KALYAN_COOKIE_SECURE=false`; `deploy/start-server.bat` serves HTTP on `0.0.0.0:8000`.
- `DECISIONS.md` still marks HTTPS approval pending. HTTP is unencrypted even on a LAN and is not an acceptable silent default for private clinical data.
- The same startup script enables Uvicorn `--access-log`.
- `frontend/src/api/queries.ts` sends patient search `q`, duplicate-check `name`, and `mobile` in URL query strings. Standard access logs can therefore retain direct patient identifiers.

**Required correction**

Deploy trusted LAN HTTPS with Secure cookies, preferably using a local CA installed on approved clinic PCs. Until then, record an explicit written HTTP risk decision and do not represent the transport as secure. Disable/redact query strings in access logs or move searches to a privacy-reviewed request design; add a synthetic-marker log test. Preserve no-store API responses and avoid logging request/response bodies.

Backup bundles also need an explicit confidentiality control: encryption or documented physically secured, access-controlled storage. SHA-256 proves integrity, not confidentiality.

### RB-5 — High: backup/deployment handover is incomplete

The backend scheduler is useful but not an installed, verifiable hospital backup service:

- The referenced backup-task registration script does not exist.
- The active Admin backup page does not mount the implemented schedule panel and falsely says APIs are missing.
- No approved second-drive destination is present in the supplied production template.
- The installer does not install/configure PostgreSQL roles and database, build the frontend, configure the environment, or register backup/autostart tasks end to end.
- The startup batch prints a warning and continues after a failed DB precheck; the autostart task uses elevated `SYSTEM` rather than the documented dedicated low-privilege account.
- Automated “disaster recovery” uses an isolated test database in the test process; it is not a clean physical/virtual machine restore with a second drive and controlled cutover.

**Required correction**

Integrate the schedule UI; add/test the scheduled-task installer; configure approved destinations; use a least-privilege service identity; fail startup scripts clearly on precheck failure; complete offline installation media; and document/test staging, clean-machine restore, rollback and cutover. Keep manual backups available independently of scheduler configuration.

### RB-6 — High workflow risk: UI can mislead staff or discard work

Source-confirmed examples:

- `ClinicalEncounterWorkspace` and `AppointmentsReception` route validation/network errors through a banner that always claims a version conflict.
- The unsaved-changes guard is used only in Settings, not long clinical/prescription/registration workflows.
- `PatientRegister` logs photo-upload failure only to the console and then shows full success.
- Patient directory silently limits browsing to 20 records.
- Pending Dues loses `AppShell` navigation.
- Mobile drawer lacks focus containment, inert background, Escape handling and focus return.

These issues and accessibility/responsive details are listed in `docs/UI-UX-GAPS-AND-ANIMATION-ANALYSIS.md`.

## 4. What is implemented well

The following should be preserved during remediation:

- Clear active architecture: one React SPA, FastAPI API, PostgreSQL database and server-side files; legacy desktop is not used as the LAN server.
- No default production users or post-migration seed accounts.
- Atomic first-admin bootstrap with permanent closure and concurrent-submission tests.
- Argon2id, per-session CSRF tokens, origin checks, idle/absolute session expiry, account lockout/revocation and forced password changes.
- Fixed role catalogue and automated protected-route policy coverage.
- Transactional URN, daily token and receipt numbering with real PostgreSQL concurrency tests.
- Optimistic locking with 409 responses for stale edits.
- Immutable finalized clinical/session/payment behavior through application and database controls.
- Reasoned financial reversals and duplicate-marked receipt reprints.
- In-transaction, append-only audit records with sensitive credential-key redaction.
- Private photo storage, file-type/size validation and generated names.
- Database+photo backup manifests, checksums, corruption rejection and mandatory pre-restore snapshots.
- Same-origin frontend API access and local production assets without CDN or telemetry dependencies.
- A broad automated suite and green supported-runtime CI at the reviewed commit.

## 5. Verification evidence

| Check | Result |
|---|---|
| GitHub Actions run `42889964342`, exact reviewed commit | **Success** for backend, frontend and legacy pytest jobs. Backend job uses Python 3.12 and PostgreSQL 18 with the required origin configuration. |
| Current frontend tests | **196 passed, 5 skipped** across 40 files. Skips are opt-in browser print checks. |
| Frontend TypeScript | **PASS** |
| Frontend oxlint | **PASS — 0 warnings/errors** |
| Frontend production build | **PASS** |
| `npm audit` during clean install | **0 reported vulnerabilities** |
| Backend Ruff | **PASS** |
| Backend test collection | **722 tests collected** |
| Foundational synthetic probes | **3 reproduced defects** — invalid encounter/appointment, prescription/encounter and treatment-plan/encounter relationships all persisted. |
| Source diff from CI-reviewed commit | Application code unchanged; working-tree additions are validation/audit documentation only. |

The local sandbox provides Python 3.11 rather than the supported Python 3.12+. The earlier isolated local backend run therefore had five Python-3.11 restore failures and one origin-fixture configuration failure. Those are not counted here as supported-runtime product regressions; the exact-commit CI job supplies the supported-runtime green result. The safety/privacy blockers were independently confirmed in source and, for cross-patient writes, real API/PostgreSQL probes.

## 6. Documentation and acceptance-evidence drift

Release decisions should not use planning completion percentages as proof:

- Root `README.md` says v3 is not implemented, although the active implementation is substantial.
- `.planning/STATE.md` calls Phases 11–17 complete and signed off, while current manual records leave accessibility and physical-printer verification open.
- `brain/changes/current-state.md` stops at Phase 13 and is also outdated.
- Historical printer dimensions/sign-off differ from the current A4 decisions.
- The active backup page contradicts the implemented schedule API and unused panel.

Create one current release-evidence ledger linking each requirement to source, automated test, environment, date and physical acceptance result. Mark waived tests as **not verified**, never passed.

## 7. Required path to a Go decision

### Stage 1 — Stop patient-safety and confidentiality defects

- Fix and test all three same-patient invariants in API and PostgreSQL.
- Repair timeline permissions/scopes and replace assertions that preserve the leak.
- Audit existing data for mismatched relationships before adding constraints.
- Quarantine suspected patient artifacts and replace them with approved synthetic assets.

### Stage 2 — Privacy and security hardening

- Deploy trusted LAN HTTPS and Secure cookies, or record an explicit exception with residual-risk acceptance before any further pilot.
- Remove patient identifiers from access logs and test with synthetic markers.
- Add setup-code expiry and an expiration regression test.
- Define backup confidentiality/storage controls and least-privilege service/file permissions.

### Stage 3 — Operational completion

- Mount and test the backup schedule UI; install the scheduler task; configure and verify a second physical drive.
- Complete the offline installer, least-privilege autostart and fail-closed preflight behavior.
- Correct misleading errors, unsaved-work loss and partial-registration feedback.
- Add patient pagination and role-appropriate actions; restore the billing shell and mobile keyboard behavior.

### Stage 4 — Hospital acceptance on synthetic data

Perform and record all of the following on the actual target environment:

1. Fresh install with internet disconnected and one-time Admin setup; simultaneous setup attempts yield exactly one administrator.
2. Three to five real browser PCs with individual accounts, simultaneous registration/appointments/clinical/billing work, no session crosstalk and acceptable measured response times.
3. Two-PC conflicting edits and payment attempts; no duplicate URN/token/receipt, silent overwrite or overpayment.
4. Negative cross-patient and per-role timeline tests through the actual deployed API.
5. Server reboot, controlled power-loss recovery, database restart and LAN disconnect/reconnect.
6. Scheduled database+photo backup to a second physical drive; checksum comparison and visible failure handling.
7. Restore onto a separate clean machine/VM, verify records/photos/schema/integrity, and rehearse rollback/cutover.
8. Actual A4 printer output with readable English/Hindi and correct `DUPLICATE` reprints.
9. Keyboard-only, NVDA, 200% zoom, Windows display scaling and reduced-motion checks.
10. Staff walkthrough using only clearly marked synthetic patients; final client sign-off records all accepted residual risks.

## 8. Release decision rule

Do not change this verdict to **GO** until:

- Every release blocker is corrected with negative regression tests.
- No suspected real patient artifact remains in the synthetic development/test distribution.
- The deployed system passes the real LAN, clean-restore, backup, power-recovery and printer gates.
- Hospital ownership approves the final role policy, HTTPS/transport posture, backup destination/retention and residual risks in writing.

**Current recommendation:** continue synthetic development and remediation, but do not import real patient information, conduct a live clinical pilot, or describe the system as production-ready.

