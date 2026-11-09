# Data model and permissions

Reference for anyone maintaining or integrating with the system. The schema lives in
`src/schema.sql` (SQLite, schema version 1); nothing here is required reading for daily use.

---

## 1. Conventions

| Convention | Rule |
|---|---|
| Timestamps | ISO-8601 **UTC** strings with milliseconds, e.g. `2026-11-09T08:15:00.000Z`. The UI renders them in the clinic timezone (`TZ`, default `Asia/Kolkata`) reported to the browser, so appointment times look the same on every PC. |
| Dates only | `YYYY-MM-DD` in clinic-local time (date of birth, follow-up dates). |
| Money | **Integer paise** everywhere (`25000` = ₹250.00). No floats, no rounding drift. Rendered by the UI only. |
| Booleans | `INTEGER` 0/1. |
| Soft deletes | Patients are archived (`is_active=0`); attachments are flagged `is_deleted=1`; invoices/payments are **voided** (`status='void'`, `is_void=1`) with a reason — nothing clinical or financial is ever hard-deleted. |
| Deletion policy | `ON DELETE RESTRICT` on patients→visits and invoices→payments means a patient with records cannot be removed at all; records are retained as medical records. |
| IDs | Integer primary keys internally; human-facing numbers (`mrn`, `visit_no`, `invoice_no`, `receipt_no`) come from the `app_meta` sequences and are never reused. |
| SQLite pragmas | `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`, `synchronous=NORMAL`, `trusted_schema=OFF`. |

Numbering formats: `KH-000001` (MRN), `V-000001` (visit), `INV-YYYYMMDD-0000` (invoice),
`RCPT-YYYYMMDD-0000` (receipt). Sequence counters live in `app_meta` under
`seq:mrn`, `seq:visit`, `seq:invoice:<date>`, `seq:receipt:<date>`.

---

## 2. Entity relationships

```
users ──┬── sessions                       (1:n, hash-only tokens)
        ├── visits.doctor_id               (who saw the patient)
        ├── clinical_notes.author_id
        ├── invoices.created_by, payments.received_by
        └── audit_log.actor_id

patients ──┬── patient_allergies            (n, active flag + severity)
           ├── patient_conditions           (n, status)
           ├── visits ──┬── vitals
           │            ├── clinical_notes  (sign → read-only)
           │            ├── diagnoses
           │            ├── prescriptions
           │            └── attachments     (optional link)
           ├── appointments ──► visit_id    (check-in creates the visit)
           ├── attachments                  (encrypted blobs on disk)
           ├── invoices ──┬── invoice_items
           │              └── payments      (partial payments allowed)
           └── audit_log.patient_id

services ──► invoice_items.service_id      (catalogue → price snapshot)
backups                                    (archive metadata, files on disk)
settings, app_meta                         (key/value state)
```

---

## 3. Tables

### `users`
Staff accounts. `role` ∈ `admin | doctor | nurse | reception`. `password_hash` is
`scrypt$N$r$p$salt$hash`; there is no plaintext or reversible form anywhere.
`must_change_password` forces the change-password dialog at first sign-in.
`failed_login_count` / `locked_until` implement account lockout. Deactivated users
(`is_active=0`) keep their history, because audit and clinical rows reference them.

### `sessions`
One row per signed-in browser. `token_hash` = SHA-256 of the bearer token (the token itself is
never stored). `csrf_token` must accompany cookie-authenticated writes. `expires_at` is the
absolute limit; `last_seen_at` drives the 20-minute idle timeout. Rows are purged on expiry and
whenever the user's password changes or the account is disabled.

### `patients`
Demographics plus `allergies_summary` (denormalised headline shown on the chart). `mrn` is the
permanent identifier. Search uses `full_name`, `mrn` and `phone` (indexed). `age_years` is used
when `dob` is unknown (`dob_estimated=1` when the birth date is approximate).

### `patient_allergies` / `patient_conditions`
Problem list and allergy list. Allergy `severity` ∈ `mild | moderate | severe | life_threatening`;
severe and life-threatening allergies are highlighted in red on every screen that shows the
patient. Condition `status` ∈ `active | resolved | in_remission`.

### `visits`
An encounter: `opd`, `ipd`, `emergency`, `follow_up`, `teleconsult`. Lifecycle
`open → closed` (or `cancelled`), tracked by `checked_in_at`, `seen_at`, `closed_at`.
`outcome`, `follow_up_date` and `discharge_summary` are captured at closure. A visit can only be
closed once; the UI then shows it read-only.

### `vitals`
One row per observation set: temperature °C, pulse, respiratory rate, blood pressure
(systolic/diastolic), SpO₂, weight, height, pain score 0–10. Server-side range validation rejects
impossible values (e.g. SpO₂ > 100, temperature outside 25–45 °C). Rows are append-only —
a mistake is corrected by recording a new set, preserving what the machine actually measured.

### `clinical_notes`
Free-text notes typed as `consultation | progress | nursing | procedure | discharge | other`.
`signed_at`/`signed_by` make a note **immutable**: the API refuses further edits after signing
(`409`). This is the medico-legal record of what the clinician attested to.

### `diagnoses` / `prescriptions`
Structured entries belonging to a visit. Diagnoses carry an optional ICD-10 `code` and a
`kind` (primary / secondary / provisional). Prescriptions are one row per drug with strength,
form, dose, route, frequency, duration and instructions — the prescription sheet is generated
from these rows, not from free text.

### `attachments`
Documents (lab reports, scans, consents). The file itself is **not** in the database: `stored_name`
points at `data/uploads/<uuid>.khc`, which is AES-256-GCM ciphertext. `sha256` is the hash of the
*plaintext*, so a download can be verified. `original_name` and `mime_type` are display metadata;
the actual content type was validated against the file's magic bytes at upload time.

### `appointments`
Diary entries: `scheduled_at`, `duration_min`, `status` ∈
`scheduled | arrived | completed | cancelled | no_show`, and `visit_id` once checked in.
Check-in creates a visit, links it here and flips the status to `arrived`.

### `services`
The billable catalogue (consultation fees, procedures, injections…). `price_paise` is copied into
`invoice_items.unit_price_paise` at billing time — later price changes never alter old invoices.

### `invoices` / `invoice_items` / `payments`
`invoices` holds the totals snapshot (`subtotal`, `discount`, `tax`, `total`, `paid`, `balance`);
the authoritative lines are in `invoice_items`. Status is derived and stored:
`open → partially_paid → paid`, or `void` (with `void_reason`, `voided_by`, `voided_at`).
`payments` records each receipt with a method
(`cash | card | upi | netbanking | cheque | insurance | waived`), an optional reference
(cheque no., UPI ref.), `received_by` and `received_at`. Payments are voided, never deleted, so
the day's collection always reconciles.

### `audit_log`
Append-only. `action` is dotted (`auth.login`, `patient.view`, `invoice.create`,
`payment.void`, `user.reset_password`, `backup.create`, …). `detail_json` holds small structured
context (no clinical text). Chain fields:

```
hash = sha256(prev_hash ‖ at ‖ actor_id ‖ action ‖ entity_type ‖ entity_id ‖ patient_id ‖ detail_json)
```

`prev_hash` links to the previous row, so editing, deleting or reordering any row invalidates
every later hash. `npm run audit:verify` and `GET /api/admin/audit/verify` recompute the chain.

### `backups`
Metadata for each archive: `filename`, `kind` ∈ `manual | scheduled | pre_restore`, size,
SHA-256 of the encrypted file, and who triggered it.

### `settings` / `app_meta`
`settings` holds non-secret clinic configuration (name, address, phone, disclaimer, session
timeout, backup hour/retention, `synthetic_data` flag). `app_meta` holds internal state:
`setup_completed`, number sequences, the hashed bootstrap code and its expiry.

---

## 4. Permission matrix

Roles are fixed; permissions are checked server-side on every request (`requirePerm`).

| Permission | Admin | Doctor | Nurse | Reception |
|---|:--:|:--:|:--:|:--:|
| `patient.read` | ✅ | ✅ | ✅ | ✅ |
| `patient.write` | ✅ | ✅ | — | ✅ |
| `clinical.read` | ✅ | ✅ | ✅ | — |
| `clinical.write` | ✅ | ✅ | ✅ | — |
| `vitals.write` | ✅ | ✅ | ✅ | ✅ ¹ |
| `visit.read` | ✅ | ✅ | ✅ | ✅ |
| `visit.write` | ✅ | ✅ | ✅ | ✅ |
| `attachment.read` / `attachment.write` | ✅ | ✅ | ✅ | ✅ |
| `appointment.read` | ✅ | ✅ | ✅ | ✅ |
| `appointment.write` | ✅ | ✅ | — | ✅ |
| `billing.read` | ✅ | ✅ | — | ✅ |
| `billing.write` | ✅ | — | — | ✅ |
| `billing.void` | ✅ | — | — | — |
| `report.read` | ✅ | ✅ | — | ✅ |
| `export.data` | ✅ | — | — | — |
| `user.manage` | ✅ | — | — | — |
| `audit.read` | ✅ | — | — | — |
| `backup.manage` | ✅ | — | — | — |
| `settings.manage` | ✅ | — | — | — |

¹ Reception may record vitals at check-in (weight/BP in the queue); the route permits
`vitals.write` or `clinical.write`.

The UI mirrors this table through `session.can(...)` — a hidden button is a convenience, the API
check is the real control. A reception user opening a chart sees demographics, visits, documents
and billing, but no clinical tabs, and direct calls to clinical endpoints return `403`.

---

## 5. Data integrity rules enforced in code

* A visit must belong to the patient in the URL; mismatches are rejected.
* Notes, diagnoses and prescriptions cannot be added to a **closed** visit.
* A signed note is read-only; unsigned notes can be edited only by their author (admins may
  delete).
* `payments.amount_paise` must be > 0 and ≤ the invoice balance; overpayment returns `422`.
* An invoice with any payment cannot be voided until those payments are voided first.
* Voiding requires a reason of at least 5 characters and is audited.
* An invoice's `paid_paise`/`balance_paise` are recomputed inside the same transaction that
  inserts a payment, so a crash cannot leave totals inconsistent.
* Attachments: declared MIME must match the sniffed magic bytes (PDF/JPEG/PNG/WebP/TIFF/BMP);
  other allow-listed types must not contain HTML/script payloads, and downloads are always
  served as attachments with a sandbox CSP.
* The last active administrator cannot be deactivated or demoted, and nobody can change their
  own role.

---

## 6. Size and growth expectations

A busy OPD of ~100 visits/day produces roughly: 100 visits + ~100 vitals sets + ~150 notes +
~250 prescriptions + ~80 invoices + ~80 payments per day, i.e. well under 2 MB of database
growth per month excluding documents. With SQLite WAL and the indexes defined above, typical
queries on a 5-year dataset (≈150k visits) stay in the low milliseconds. Documents dominate
storage; the 25 MB per-file cap and the 30-backup retention keep the data folder manageable.
