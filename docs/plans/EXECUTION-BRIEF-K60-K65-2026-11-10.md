# Execution brief: K-65 (URN format) and K-60 (doctor fee and cabin code)

**For:** an implementation agent with no prior context.
**Owner:** Kalyan Hospital. Decisions below are binding. Anything not covered here: stop and ask the owner; do not invent a rule.
**Source of truth:** `docs/plans/UI-ADOPTION-PLAN-2026-11-09.md` section 6a (decisions) and section 4 (K-xx tasks).
**Status when written:** no code changed for K-60 or K-65. Only the plan file is modified in the working tree.

---

## 0. Ground rules (read first)

1. **Repo:** `D:\dr-sr`, branch `switch/node-lan`. The HEAD commit is `63888657` (or later). Check `git log -1` before starting.
2. **Commit only when the owner says so.** Do not commit, push or amend. Leave changes in the working tree and report the file list.
3. **Backend tests: pin the environment every time**, or pytest can import another checkout and write to `backend/var`:
   ```
   cd D:/dr-sr/backend
   PYTHONPATH=D:/dr-sr/backend/src KALYAN_PHOTOS_DIR=<temp dir> KALYAN_BACKUP_DIR=<temp dir> \
     .venv/Scripts/python.exe -m pytest <paths> -q -p no:cacheprovider
   ```
   Use a temp dir from the session scratchpad for the two `KALYAN_*` values. Never run tests on the hospital server.
4. **Shell:** Git Bash. Write scripts with the Write tool, not heredocs containing backslash-n or Devanagari.
5. **Do not touch** `hms/` (deleted), `.archify/`, `.coverage`, `docs/handover/`.
6. **Do not create files in `/tmp`.** Use the scratchpad.
7. **Concurrent editors exist.** Before editing a file, check its mtime; if it changed since you last read it, report the diff and stop rather than overwriting.
8. **Report** each task with: task ID, owned files, root cause or reason, changes, test commands, exact results, remaining risks. Do not claim a test passed unless you ran it and saw it pass.

---

## Part A: K-65, URN format `KH-YY-P-MM-00001`

### A.1 Decision (owner, 2026-11-10)
- New format: `KH-YY-P-MM-NNNNN`. Example: registered 10 Nov 2026 → `KH-26-P-11-00001`.
- `P` = Patient.
- `YY` = last two digits of the IST year. `MM` = IST month of registration (two digits).
- `NNNNN` = five-digit sequence that **restarts each calendar year** (IST). The sequence is unique per year, so the `MM` part does not affect uniqueness.
- Synthetic data only. No migration of old `KH-YYYY-XXXX` numbers is required.

### A.2 Current code (verified)
- `backend/src/kalyan_api/services/urn_service.py`: `allocate_next_urn(session, year=None)` returns `f"KH-{year}-{seq_val:04d}"`. The counter table `urn_sequences(year, last_seq)` is **already keyed by year**, so no table change is needed.
- Callers (keep signatures unchanged):
  - `backend/src/kalyan_api/routers/patients.py:79`
  - `backend/src/kalyan_api/services/import_service.py:681`
- `backend/src/kalyan_api/services/integrity_service.py:69`: `URN_PATTERN = re.compile(r"^KH-(\d{4})-(\d+)$")`, used around line 237 to group sequence numbers by year. **This must change or the integrity report will misread every new URN.**
- `backend/tests/test_urn_concurrency.py:21`: parallel allocation test. It calls `allocate_next_urn(session, year=test_year)`.
- Many tests hard-code URNs such as `KH-2026-8801` as fixture data. They do not parse the format; leave them alone.
- Frontend text still showing the old format: `frontend/src/pages/PatientsDirectory.tsx` (search placeholder "e.g. KH-2026-0001"). Search for others with `grep -rn "KH-2026-0001\|KH-YYYY" frontend/src` and update user-facing examples only.

### A.3 Changes
1. **`urn_service.py`**
   - Keep the `year` parameter. Default to `clock.ist_today().year`.
   - Month comes from `clock.ist_today().month` (registration month, IST), **not** from `year`.
   - Format: `f"KH-{year % 100:02d}-P-{month:02d}-{seq_val:05d}"`.
   - Update the module docstring to the new format.
   - Keep the `ON CONFLICT ... DO UPDATE ... RETURNING` statement unchanged.
2. **`integrity_service.py`**
   - `URN_PATTERN = re.compile(r"^KH-(\d{2})-P-(\d{2})-(\d{5})$")`.
   - In the loop, `year = 2000 + int(match.group(1))`, `seq = int(match.group(3))`. Update the code that reads `match.group(2)` accordingly. Read lines 225–260 first.
3. **Frontend examples:** change user-visible example text `KH-2026-0001` to `KH-26-P-11-00001`. Do not change test fixtures.
4. **OpenAPI snapshot:** not affected (no route change). Confirm by running the snapshot test.

### A.4 Tests to add or update
- `backend/tests/test_urn_format.py` (new):
  - `allocate_next_urn` returns `KH-26-P-11-00001` for the first allocation on 10 Nov 2026 (use `year=2026` and a patched `clock.ist_today`).
  - Second allocation in the same year → `...-00002`.
  - Allocation on 31 Dec 2026 IST → `KH-26-P-12-0000N`; first allocation on 1 Jan 2027 IST → `KH-27-P-01-00001` (proves the yearly restart).
  - Allocation at 00:30 IST on 1 Jan uses the new year (existing docstring promise).
- `test_urn_concurrency.py`: keep passing; if it asserts the old format, update the assertion only.
- Integrity: add a case to the existing integrity test file (find it with `grep -rln "URN_PATTERN\|urn_sequence_gap" backend/tests`) showing new-format URNs produce no false gap warning.

### A.5 Verification commands
```
pytest tests/test_urn_format.py tests/test_urn_concurrency.py tests/test_patient_search.py tests/test_phase12_gate.py -q
pytest tests -q -p no:cacheprovider          # full suite; expect 0 failures
```
Frontend: `cd frontend && npx tsc -b && npx oxlint src && npx vitest run src/pages/__tests__/patients-directory.test.tsx src/pages/__tests__/patient-register.test.tsx`
Then `npx vite build` and check the Register screen on `http://localhost:8000` after the owner's server is running.

**Done when:** a new patient registered on `:8000` gets a `KH-YY-P-MM-NNNNN` URN, the integrity report shows no URN gap warnings, and the full backend suite passes.

---

## Part B: K-60, doctor consultation fee and cabin code

### B.1 Decisions (owner, 2026-11-10)
- **Consultation fee** is per doctor and editable by **Admin** (Doctors page) **and by the doctor on their own settings page**.
- Revisit fee, plans and follow-up validity are **not** part of K-60. They are K-61 and K-62.
- **Cabin code** per doctor, used for the token display in K-66. Cabin codes are the letters `A`–`Z`; a doctor may have one. Each active doctor's cabin code must be unique among active doctors.
- **Cabin code is Admin only (decided).** A doctor may not change their own cabin code. Doctors may change only their own consultation fee on `/doctor/settings`.

### B.2 Current code (verified)
- Model: `backend/src/kalyan_api/models.py`, class `Doctor` (line 115). `default_fee_paise` at line 125. Note: `Doctor.default_fee_paise` is the fee the overpayment guard uses (`routers/billing.py:158`).
- Routes: `backend/src/kalyan_api/routers/doctors.py`. Create at line 71, PATCH at 126. Schemas in `backend/src/kalyan_api/schemas/doctors.py` (lines 18, 34, 46).
- Second, separate fee source: `ConsultationFee` table, `/api/fees` routes in `routers/doctors.py` (~line 161+). The check-in dropdown lists these fees. **Keep it for now**, but K-60 must add a note in the report describing how the two relate; K-67 resolves it.
- Frontend: `frontend/src/pages/Doctors.tsx` already has a fee form (`fee_rupees`, default `'500'`).
- Migrations: head is `0020_integrity_runs`. Confirm with `ls backend/src/kalyan_api/migrations/versions | sort | tail -2`. K-60 takes **`0021_doctor_cabin_code.py`**. If another 0021 appears, stop and report.

### B.3 Changes
1. **Migration `0021_doctor_cabin_code.py`:** add `doctors.cabin_code VARCHAR(1) NULL` with a partial unique index `WHERE cabin_code IS NOT NULL AND is_active`. Write `upgrade()` and `downgrade()`. Model it on the most recent migration file.
2. **Model:** add `cabin_code: Mapped[str | None] = mapped_column(String(1), nullable=True)` to `Doctor`.
3. **Schemas (`schemas/doctors.py`):**
   - Create and update: `cabin_code: str | None`, validated to a single uppercase `A`–`Z` (or null).
   - Read: include `cabin_code`.
4. **Routes (`routers/doctors.py`):**
   - Create and PATCH accept `cabin_code`. Enforce uniqueness among active doctors; on clash return **409** with code `cabin_code_taken`.
   - New route `PATCH /api/doctors/me/settings` (role DOCTOR only, acting on the principal's own `doctor_id`). Body: `{ "default_fee_paise": int >= 0 }`. Returns the doctor record. Use the same optimistic-concurrency `version_id` pattern as the existing PATCH route, and write an audit row (`doctor.settings.update`) with before/after fee.
   - Admin PATCH must also audit the fee change (check that it already does; add if not).
5. **Permissions:** the new route needs a permission. Look at `backend/src/kalyan_api/core/permissions.py` and the policy matrix in `tests/support/matrix.py`. Add the matrix row for the new route (Doctor allowed; Admin, Reception, Nurse denied unless they have a doctor record). Otherwise the RBAC matrix test fails.
6. **Frontend:**
   - `Doctors.tsx` (Admin): add a cabin-code input (one letter, uppercase, optional). Show the server error `cabin_code_taken` inline.
   - New page `frontend/src/pages/DoctorSettings.tsx` at route `/doctor/settings`, visible only to role DOCTOR in the nav. Form: consultation fee in rupees. Show the current value; save via `PATCH /api/doctors/me/settings`. Handle 409 with the existing `ConflictBanner` pattern.
   - Register the route in `frontend/src/router.tsx` under the doctor `RequireRole`. Add the nav item in `AppShell.tsx` for DOCTOR.
7. **OpenAPI snapshot:** regenerate after the route changes:
   ```
   PYTHONPATH=... .venv/Scripts/python.exe -m kalyan_api.cli export-openapi --out tests/openapi.snapshot.json
   ```
   Review the diff; it should contain only the new route and the new fields.

### B.4 Tests to add
Backend, new file `backend/tests/test_doctor_settings.py`:
- Admin sets cabin code `A`; the read returns `A`.
- Admin sets cabin code `a` (lowercase) → 422 or normalised to `A` (pick one; state it in the report).
- Admin sets `AB` or `1` → 422.
- Second active doctor tries `A` → 409 `cabin_code_taken`.
- Deactivated doctor holding `A` frees it: a new doctor can take `A`.
- Doctor PATCH `/api/doctors/me/settings` with `default_fee_paise: 50000` → 200, fee is 50000, audit row exists with before 50000 and after new value.
- Doctor PATCH with a stale `version_id` → 409.
- Reception or Admin calling `/api/doctors/me/settings` → 403 (Admin has no doctor record).
- Doctor A cannot change Doctor B's fee through any route.
- Negative fee → 422.

Frontend: `frontend/src/pages/__tests__/doctor-settings.test.tsx` (new) — renders the current fee, saves, shows conflict banner on 409. `Doctors.tsx` existing test must still pass.

### B.5 Verification commands
```
pytest tests/test_doctor_settings.py tests/test_rbac_matrix.py tests/test_openapi_snapshot.py -q
pytest tests -q -p no:cacheprovider       # full suite; expect 0 failures
```
Frontend: `npx tsc -b && npx oxlint src && npx vitest run` (full suite; it takes about a minute).
Then `npx vite build` and check `:8000`: Admin sets a cabin code; a Doctor login opens `/doctor/settings` and changes the fee; the fee on the check-in dropdown for that doctor updates.

**Done when:** all the tests above pass, the migration upgrades and downgrades on a copy of the test database, and the `:8000` check shows both screens working.

---

## Part C: What the executing agent must NOT do
- Do not implement K-61, K-62, K-63, K-64, K-66 or K-67. They are separate briefs.
- Do not change the revisit, plan or invoice models.
- Do not remove `ConsultationFee` or the `/api/fees` routes.
- Do not change `DoctorFollowUp`, encounters or the appointment booking rules.
- Do not commit.

## Part D: Reporting template
```
Task ID:
Owned files:
Findings:
Root cause / reason:
Changes:
Test commands (exact):
Test results (exact counts, failures):
Dependencies:
Remaining risks:
Open questions for the owner (e.g. cabin-code edit permission):
```
