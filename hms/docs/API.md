# HTTP API reference

Every screen in the app talks to this API; it is documented here so the hospital can integrate
printers, reports, exports or a future mobile view without reverse-engineering the code.

Base URL: `http://<server>:3000/api`. All requests and responses are JSON except document
upload (raw body) and download (binary).

---

## 1. Conventions

### Authentication

Sign in with `POST /api/auth/login`; the response contains a session `token` and a `csrf` value.

Send the token on every request, either way:

```
X-Session-Token: <token>            (preferred; what the browser app uses)
Cookie: kh_sid=<token>              (HttpOnly, SameSite=Strict, set automatically)
```

**Unsafe methods** (`POST`, `PATCH`, `PUT`, `DELETE`) must also:

* come from the same origin (`Origin`/`Referer` must match the host, unless the origin is in
  `KH_TRUSTED_ORIGINS`), and
* when authenticated by cookie, carry `X-CSRF-Token: <csrf>`.

Header-token requests satisfy the CSRF check by construction.

### Responses

| Status | Meaning |
|---|---|
| `200` | OK |
| `201` | Created (patients, invoices, appointments, …) |
| `400` | Validation failed — body has `error.code = "validation_failed"` and `error.details[]` with `{field, message}` |
| `401` | Not signed in / bad credentials |
| `403` | Signed in but missing the permission |
| `404` | Not found |
| `409` | Conflict (note already signed, invoice voided, duplicate username) |
| `410` | Bootstrap already completed — permanent |
| `413` | Payload too large |
| `415` | Unsupported upload type |
| `422` | Business rule failed (overpayment, visit already closed) |
| `423` | Account locked |
| `429` | Too many requests / too many sign-in attempts |
| `500` | Server error — `error.requestId` correlates with `data/logs` |

Error body:

```json
{ "error": { "code": "validation_failed", "message": "Please correct the highlighted fields.",
             "details": [{ "field": "phone", "message": "A contact phone number is required." }],
             "requestId": "0f6c1a9e…" } }
```

Every response carries `X-Request-Id`; quote it when reporting a problem.

### Conventions

* **Edit conflicts.** Every `PATCH` on a patient, visit, appointment, note, staff account, service
  or the settings must include `version` (the value from the last `GET`). If someone else saved
  first, the answer is `409` with `code: "version_conflict"` and `details.currentVersion`.

* Money is **integer paise** (`25000` = ₹250.00) on the wire.
* Timestamps are ISO-8601 UTC. Plain dates are `YYYY-MM-DD` in clinic time.
* List endpoints use `?limit=` (default 25–50, max 100–200) and `?offset=`; some accept `?q=`,
  `?from=`, `?to=`, `?status=`, `?patientId=`, `?doctorId=`.
* Nothing is cached by intermediaries (`Cache-Control: no-store` on API responses).

---

## 2. Health and bootstrap

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /api/health` | none | `{status:"ok", version, serverTime, database:"ok"}` — use for uptime monitoring |
| `GET /api/bootstrap/status` | none | `{setupRequired:false, hospitalName, version}`. While setup is pending, `setupRequired` is `true` and the console code is (re)printed. |
| `POST /api/bootstrap/complete` | none | Body: `{code, fullName, username, password, hospitalName?}` → creates the first administrator. **Available only before setup; afterwards always `410 Gone`.** |

---

## 3. Authentication and account

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /api/auth/login` | none | `{username, password}` → `{user, token, csrf, expiresAt, settings}` |
| `POST /api/auth/logout` | token | Ends the current session |
| `GET /api/auth/me` | token | `{user, settings, serverTime, version, setupComplete}` — also refreshes the idle timer |
| `POST /api/auth/change-password` | token | `{currentPassword, newPassword}`; ends other sessions |
| `GET /api/auth/sessions` | token | Active sessions (device, IP, last seen) for "My account" |
| `POST /api/auth/sessions/revoke-others` | token | Signs out everywhere else |
| `POST /api/auth/session/refresh` | token | Extends the session; returns new `expiresAt` |
| `GET /api/auth/roles` | token | Role list with labels and permission sets |

`user` object:

```json
{ "id": 4, "username": "dr.verma", "fullName": "Dr Anil Kumar Verma", "role": "doctor",
  "roleLabel": "Doctor", "designation": "Consultant Physician", "specialty": "Internal Medicine",
  "permissions": ["patient.read", "clinical.write", "..."], "mustChangePassword": false }
```

---

## 4. Patients

| Method & path | Perm | Purpose |
|---|---|---|
| `GET /api/patients?q=&limit=&offset=&active=` | `patient.read` | Search by name, MRN or phone; returns `{patients, total}` |
| `POST /api/patients` | `patient.write` | Register; server assigns the MRN |
| `GET /api/patients/:id` | `patient.read` | Full record: demographics, allergies, conditions, stats (open visit, counts, balance) |
| `PATCH /api/patients/:id` | `patient.write` | Update demographics (audited field-by-field) |
| `POST /api/patients/:id/archive` | `patient.write` | Archive (never deletes history) |
| `GET /api/patients/:id/timeline` | `patient.read` | Merged chronological events: visits, notes, documents, invoices |
| `POST /api/patients/:id/allergies` | `clinical.write`\|`patient.write` | `{substance, reaction, severity}` |
| `DELETE /api/patients/:id/allergies/:allergyId` | same | Remove an allergy entry (audited) |
| `POST /api/patients/:id/conditions` | `clinical.write` | `{condition, sinceDate, status, notes}` |
| `PATCH /api/patients/:id/conditions/:conditionId` | `clinical.write` | Update status/notes |

Create body (minimum):

```json
{ "firstName": "Sunita", "lastName": "Devi", "dob": "1990-05-12", "sex": "female",
  "phone": "9876543210", "city": "Ara", "allergiesSummary": "Penicillin — rash" }
```

`firstName`, a contact `phone`, and either `dob` or `ageYears` are required.

---

## 5. Clinical

| Method & path | Perm | Purpose |
|---|---|---|
| `GET /api/staff/doctors` | `visit.read` etc. | Minimal doctor list for pickers (never exposes admin user data) |
| `GET /api/meta/clinical` | `clinical.read`\|`visit.read` | Visit types, note types, drug routes/frequencies, diagnosis kinds |
| `GET /api/visits?patientId=&status=&doctorId=&from=&to=&limit=&offset=` | `visit.read` | Visit list |
| `POST /api/visits` | `visit.write` | Open a visit `{patientId, visitType, doctorId?, chiefComplaint?, department?, scheduledAt?}` |
| `GET /api/visits/:id` | `visit.read` | Visit with vitals, notes, diagnoses, prescriptions |
| `PATCH /api/visits/:id` | `visit.write` | Update complaint, doctor, department, follow-up |
| `POST /api/visits/:id/close` | `visit.write` | `{outcome, followUpDate?, dischargeSummary?}` → status `closed`, read-only |
| `POST /api/visits/:id/vitals` | `vitals.write`/`clinical.write` | `{temperatureC, pulseBpm, respRate, bpSystolic, bpDiastolic, spo2, weightKg, heightCm, painScore, notes}` (all optional, validated ranges) |
| `GET /api/vitals?patientId=` | clinical/patient read | Vitals history for charting |
| `POST /api/visits/:id/notes` | `clinical.write` | `{noteType, subject?, body}` |
| `PATCH /api/notes/:id` | `clinical.write` | Edit an **unsigned** note |
| `POST /api/notes/:id/sign` | `clinical.write` | Sign → immutable (`409` afterwards) |
| `POST /api/notes/:id/cancel` | `clinical.write` | Author withdraws an unsigned note `{reason}` (≥5 chars); it stays on the record |
| `POST /api/visits/:id/diagnoses` | `clinical.write` | `{code?, description, kind}` |
| `POST /api/visits/:id/diagnoses/:diagnosisId/cancel` | `clinical.write` | Cancel a diagnosis `{reason}` (own open visit) |
| `POST /api/visits/:id/prescriptions` | `clinical.write` | `{drugName, strength?, form?, dose?, route?, frequency?, durationDays?, instructions?}` |
| `POST /api/visits/:id/prescriptions/:rxId/cancel` | `clinical.write` | Cancel a drug line `{reason}` (own open visit) |
| `DELETE` on any of the three above | — | `405`: clinical records are never deleted |
| `GET /api/patients/:id/prescriptions` | `clinical.read` | All prescriptions for the printable sheet |

---

## 6. Documents (attachments)

| Method & path | Perm | Purpose |
|---|---|---|
| `POST /api/patients/:id/attachments` | `attachment.write` | **Raw binary body** with headers `X-File-Name`, `X-File-Type`, plus optional `X-Category` (`lab`, `imaging`, `consent`, `referral`, `insurance`, `other`), `X-Title`, `X-Visit-Id` |
| `GET /api/patients/:id/attachments` | `attachment.read` | List (metadata only — no file content) |
| `GET /api/attachments/:id` | `attachment.read` | Decrypt + integrity-check + stream as a download (`Content-Disposition: attachment`, sandbox CSP). Every view is audited. |
| `DELETE /api/attachments/:id` | `attachment.write` | Soft-delete (file retained for the record, flag `is_deleted=1`) |

Upload example:

```bash
curl -X POST http://localhost:3000/api/patients/12/attachments \
  -H "X-Session-Token: $TOKEN" -H "X-CSRF-Token: $CSRF" \
  -H "Content-Type: application/pdf" \
  -H "X-File-Name: lipid-profile.pdf" -H "X-File-Type: application/pdf" -H "X-Category: lab" \
  --data-binary @lipid-profile.pdf
```

The declared type must match the file's magic bytes (or, for formats without a signature, must
be on the allow-list and free of markup) → otherwise `415`.

---

## 7. Appointments

| Method & path | Perm | Purpose |
|---|---|---|
| `GET /api/appointments?date=&from=&to=&doctorId=&status=` | `appointment.read`\|`visit.read` | Diary for a day or range, with patient name/MRN/phone/age |
| `POST /api/appointments` | `appointment.write` | `{patientId, doctorId, scheduledAt, durationMin?, reason?}` |
| `PATCH /api/appointments/:id` | `appointment.write` | Reschedule / change doctor / set `status` |
| `POST /api/appointments/:id/check-in` | `visit.write` | Marks `arrived` and creates the linked visit |
| `DELETE /api/appointments/:id` | `appointment.write` | Cancel the appointment |

---

## 8. Billing

| Method & path | Perm | Purpose |
|---|---|---|
| `GET /api/services` | `billing.read`\|`billing.catalogue`\|`invoice.write` | Service catalogue (empty on a fresh install) |
| `POST /api/services` · `PATCH /api/services/:id` | `billing.catalogue` | Add / edit a catalogue entry (`PATCH` needs `version`) |
| `GET /api/invoices?q=&status=&from=&to=&limit=&offset=` | `billing.read` | Invoice list with patient, totals, balance |
| `POST /api/invoices` | `invoice.write` | Create an invoice (below) |
| `GET /api/invoices/:id` | `billing.read` | Invoice with items and payments |
| `POST /api/invoices/:id/payments` | `payment.collect` | Record a receipt `{amountPaise, method, reference?, note?}` (Reception only) |
| `POST /api/invoices/:id/void` | `payment.reverse` | Void with `{reason}` (≥5 chars) |
| `POST /api/payments/:id/void` | `payment.reverse` | Void a single receipt with `{reason}` |
| `GET /api/billing/report?from=&to=&groupBy=method\|day\|doctor` | `billing.read` | Collection report |
| `GET /api/billing/outstanding` | `billing.read` | Unpaid / partly paid invoices |

Create invoice:

```json
{ "patientId": 12, "visitId": 45, "discountPaise": 0, "taxPaise": 0,
  "notes": "OPD consultation",
  "items": [ { "serviceId": 3, "qty": 1 }, { "description": "Dressing", "qty": 2, "unitPricePaise": 15000 } ] }
```

`serviceId` pulls name and price from the catalogue (a line price may override it); a free-text
line needs `description` and `unitPricePaise`. Totals are computed server-side and returned.

Payment response includes the receipt: `{payment: {receiptNo, amountPaise, method, receivedAt}, invoice: {…updated totals}}`.

---

## 9. Dashboard

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /api/dashboard` | any signed-in role | One call for the home screen: patients waiting, appointments today (and next few), registrations today, collected today, outstanding total and count, recent registrations, and the caller's own reminders. Sections are omitted when the role lacks the permission (e.g. reception gets no clinical counts). |

---

## 10. Administration

| Method & path | Perm | Purpose |
|---|---|---|
| `GET /api/admin/users` | `user.manage` | Staff list with role, status, last sign-in |
| `POST /api/admin/users` | `user.manage` | Create `{username, fullName, role, password, designation?, specialty?, registrationNo?, phone?}` |
| `PATCH /api/admin/users/:id` | `user.manage` | Update name/role/active/designation (cannot demote or disable yourself, or the last admin) |
| `POST /api/admin/users/:id/reset-password` | `user.manage` | Set a new starter password, unlock, revoke sessions |
| `GET /api/admin/audit?actorId=&action=&patientId=&from=&to=&limit=&offset=` | `audit.read` | Audit entries, newest first, with actor name/role |
| `GET /api/admin/audit/export?from=&to=` | `audit.read` + `export.data` | CSV of audit entries (exporting is itself audited) |
| `GET /api/admin/audit/verify` | `audit.read` | `{ok:true, entries, headHash}` or `{ok:false, brokenAt}` |
| `GET /api/admin/backups` | `backup.manage` | Backup list with kind, size, checksum, author |
| `POST /api/admin/backups` | `backup.manage` | Write a backup now (`{note?}`) |
| `POST /api/admin/backups/:id/export` | `backup.manage` | Re-encrypt with `{passphrase}` and download |
| `GET /api/admin/system` | `backup.manage`\|`audit.read` | Version, Node, uptime, counts, DB size, backup settings, synthetic-data flag |
| `GET /api/admin/settings` · `PATCH /api/admin/settings` | `settings.manage` | Bilingual identity, clinic addresses, print header/footer, receipt cycle, consultation validity, idle minutes, backup retention, disclaimer. `GET` returns `version`; `PATCH` must send it and is validated per field |
| `POST /api/admin/settings/logo` · `DELETE /api/admin/settings/logo` | `settings.manage` | Upload (raw PNG/JPEG/WebP, ≤512 KB) or remove the hospital logo |
| `GET /api/branding/logo` | none | The logo, for the sign-in page and prints (`404` when none) |

---

## 11. Integration examples

**Nightly health check (cron / Task Scheduler)**

```bash
curl -fsS http://192.168.1.24:3000/api/health || echo "clinic server is down"
```

**Export today's collection from a script**

```bash
TOKEN=$(curl -s -X POST http://192.168.1.24:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"report.bot","password":"…"}' | jq -r .token)

curl -s "http://192.168.1.24:3000/api/billing/report?from=$(date +%F)&to=$(date +%F)" \
  -H "X-Session-Token: $TOKEN" | jq .
```

Use a dedicated account for integrations so the audit trail distinguishes machine activity from
staff activity, and give it the least role that works.

---

## 12. Things the API deliberately does not do

* No endpoint creates the first administrator after setup (`410` forever).
* No endpoint reads a password hash, another user's session token, or the encryption keys.
* No endpoint deletes patients, visits, notes (once signed), invoices or payments outright.
* No endpoint returns document content without a permission check **and** an audit entry.
* No bulk "export everything" endpoint: bulk clinical export is a deliberate offline operation
  (`npm run backup` + `restore`), not a web feature.
