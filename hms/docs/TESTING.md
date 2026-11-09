# Testing

The system ships with an automated test suite that exercises the real HTTP API against a real
temporary database — no mocks, no network, no extra dependencies. It is the safety net for any
future change.

```bash
npm test
```

Expected output: **5 suites, 55 tests, 0 failures**, in roughly 5 seconds. Exit code is non-zero
if anything fails, so it can gate a deployment.

---

## 1. How it works

* `node --test` (built into Node 22+) with `--test-concurrency=1` so suites never share state.
* `test-support/helpers.js` boots the actual Express app on a random port, using a throwaway
  `KH_DATA_DIR` under the OS temp directory, and returns a tiny HTTP client:

```js
const { boot, setupAdmin, makeStaff, createPatient } = require('../test-support/helpers');

const env = await boot();                        // fresh DB + keys + app on a random port
const { client: admin } = await setupAdmin(env); // consumes the setup code like a human would
await createPatient(admin, { firstName: 'Sunita', phone: '9876543210' });
const { client: nurse } = await makeStaff(env, admin, { username: 'nurse.test', role: 'nurse' });
await env.close();                               // stops the server, closes the DB
```

`env.client()` returns a fresh client for each request context; clients keep their own session
token and CSRF value after `login()`.

* Every request goes through the same middleware as production: security headers, origin guard,
  session authentication, CSRF check, route permissions, error handler.
* Test data is synthetic by construction (the helpers create it), so running the suite can never
  mix in real patient information.

### Running a single suite

```bash
node --test test/04-billing.test.js
node --test --test-name-pattern="voiding is ordered" test/04-billing.test.js
```

---

## 2. What is covered

### `test/01-bootstrap.test.js` — first-run setup (9 tests)
Status reports `setupRequired` while no account exists; the API is otherwise closed; a wrong
setup code is rejected; a weak admin password is rejected with a helpful message; the printed code
creates the first administrator; that admin can immediately use the API; **`/api/bootstrap/complete`
returns `410` forever afterwards**; exactly one admin exists; the setup is written to the audit
chain.

### `test/02-auth.test.js` — authentication and authorisation (10 tests)
Generic failure text for unknown user vs wrong password (no account enumeration); login returns a
token and an `HttpOnly` cookie; cookie-authenticated writes without a CSRF token are rejected; a
forged `Origin` is refused; role permissions are enforced server-side (reception gets `403` on
clinical routes); changing a password revokes other sessions; deactivating a user kills their
sessions immediately; an admin cannot deactivate themselves or remove the last admin; logout
invalidates the token.

### `test/03-patients-clinical.test.js` — records (13 tests)
Sequential MRNs; registration validation; search by name, phone and MRN; renaming a patient keeps
the display name in sync; allergies and conditions; a visit can be opened but not duplicated;
vitals are validated (impossible values refused) and stored against the visit; notes can be
written and signed, then lock (`409` on later edits); diagnoses and prescriptions attach to the
visit; **reception sees the visit but no clinical content**; closing a visit freezes it; the
timeline merges visits, notes and documents; archiving requires no open visit.

### `test/04-billing.test.js` — money (10 tests)
Invoices are built from catalogue items (prices snapshotted); invalid invoices are refused;
partial payments move the invoice to *partially paid*; overpayment and unreferenced card payments
are refused; paying the balance closes the invoice; voiding is ordered (payments before invoice)
and audited; the collections report reconciles exactly to the payments; patient balance agrees
with the outstanding list; reception can take money but cannot void it; a zero-value invoice is
recorded as paid.

### `test/05-security-backup.test.js` — documents, audit, backup (10 tests)
Tar archives round-trip; **documents are encrypted at rest** (the file on disk does not contain
the plaintext) and download byte-identical; disallowed file types are refused (`415`, including a
file whose magic bytes contradict its declared type); uploads without a session are refused;
every chart view lands in the audit trail; **the audit chain detects tampering** (an edited row
fails verification); backups are created, encrypted and restorable; a non-admin cannot manage
backups; login throttling stops password guessing (`429`).

---

## 3. What is *not* covered automatically

Some things need a human in front of a browser or a printer:

| Area | How to check it |
|---|---|
| Visual layout at 1366×768 / 1440×900 / 1920×1080 | Load each screen and look; the layout is responsive down to 1180 px for the two-column chart |
| Printing receipts and prescriptions | Print one of each on the reception printer and check paper size and alignment |
| Multi-PC behaviour | Sign in on two PCs, register a patient on one, refresh the other |
| Real world slowness | Open a chart for a patient with 40 visits and time it |
| Restore drill | Follow docs/OPERATIONS.md §3 once a month |
| Keyboard-only use | Tab through the patient form and the invoice screen |

A quick manual smoke test after any change: sign in → register a patient → open a visit → record
vitals → write and sign a note → add a diagnosis and a prescription → print the prescription →
raise an invoice → take a partial payment → print the receipt → check the audit trail → take a
backup.

---

## 4. Adding a test

1. Pick the suite that matches the area (or add `test/06-*.test.js`).
2. Use the helpers; never the production `data/` folder.

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, setupAdmin, makeStaff, createPatient } = require('../test-support/helpers');

test('a nurse cannot void an invoice', async (t) => {
  const env = await boot();
  t.after(() => env.close());
  const { client: admin } = await setupAdmin(env);
  const { client: nurse } = await makeStaff(env, admin, { username: 'nurse.void', role: 'nurse' });

  const patient = await createPatient(admin);
  const invoice = await admin.post('/api/invoices', {
    patientId: patient.id,
    items: [{ description: 'Consultation', qty: 1, unitPricePaise: 25000 }],
  });
  assert.equal(invoice.status, 201);

  const res = await nurse.post(`/api/invoices/${invoice.body.invoice.id}/void`, { reason: 'test void' });
  assert.equal(res.status, 403);
});
```

3. Test the **rule**, not the implementation: assert status codes and observable effects
   (database state through the API, audit rows) rather than internal function names.
4. Keep suites independent — the runner is serial, but a test must never depend on another's
   leftovers.

---

## 5. Notes for maintainers

* `npm test` also proves the app boots on a clean machine: the helpers run `openDatabase()`,
  create the AES keys, and apply the full schema on every run.
* If you add a table or column, bump nothing — the schema is idempotent (`CREATE TABLE IF NOT
  EXISTS`) for v1; a real migration path is the first thing to build before schema v2.
* The suite deliberately does not assert exact counts of seeded demo data (that lives in
  `scripts/seed.js` and changes with the demo).
* Never weaken a test to make a change pass. Each of the 55 tests corresponds to something
  the hospital is relying on.
