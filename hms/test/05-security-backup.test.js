'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { boot, setupAdmin, makeStaff, createPatient, makeTeam } = require('../test-support/helpers');
const { createTar, readTar } = require('../src/lib/tar');
const { createBackup, exportBackup, extractBackupFile } = require('../src/lib/backup');

const PDF = Buffer.concat([
  Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'),
  Buffer.alloc(2048, 0x20),
]);

test('documents, audit trail and backups', async (t) => {
  const env = await boot();
  t.after(() => env.close());
  const { client: admin } = await setupAdmin(env);
  const { reception: desk } = await makeTeam(env, admin);
  const patient = await createPatient(desk, { firstName: 'Farhan', lastName: 'Qureshi', phone: '9898989898' });

  await t.test('tar archives round-trip', () => {
    const entries = [
      { name: 'MANIFEST.json', data: Buffer.from('{"a":1}') },
      { name: 'uploads/' + 'a'.repeat(60) + '.khc', data: Buffer.from('x'.repeat(1000)) },
      { name: 'deep/'.repeat(10) + 'file.bin', data: Buffer.from([1, 2, 3, 4, 5]) },
    ];
    const tar = createTar(entries);
    const back = readTar(tar);
    assert.equal(back.length, 3);
    for (let i = 0; i < entries.length; i += 1) {
      assert.equal(back[i].name, entries[i].name);
      assert.deepEqual(back[i].data, entries[i].data);
    }
  });

  let attachmentId;
  await t.test('documents are encrypted at rest and download byte-identical', async () => {
    const upload = await desk.request('POST', `/api/patients/${patient.id}/attachments`, {
      raw: PDF,
      headers: {
        'content-type': 'application/pdf',
        'x-file-name': 'cbc-report.pdf',
        'x-file-type': 'application/pdf',
        'x-category': 'lab',
        'x-title': 'CBC report',
      },
    });
    assert.equal(upload.status, 201, JSON.stringify(upload.body));
    attachmentId = upload.body.attachment.id;

    // On disk: ciphertext, and no readable PDF header.
    const stored = fs.readdirSync(env.ctx.config.paths.uploads);
    assert.equal(stored.length, 1);
    const raw = fs.readFileSync(path.join(env.ctx.config.paths.uploads, stored[0]));
    assert.notEqual(raw.subarray(0, 5).toString('latin1'), '%PDF-');
    assert.equal(raw.subarray(0, 4).toString('latin1'), 'KHE1');

    const download = await fetch(`${env.base}/api/attachments/${attachmentId}`, {
      headers: { 'x-session-token': desk.token },
    });
    assert.equal(download.status, 200);
    const bytes = Buffer.from(await download.arrayBuffer());
    assert.deepEqual(bytes, PDF);
    assert.match(download.headers.get('content-disposition'), /attachment/);
    assert.equal(download.headers.get('x-content-type-options'), 'nosniff');

    const anonymous = await env.client().get(`/api/attachments/${attachmentId}`);
    assert.equal(anonymous.status, 401);
  });

  await t.test('disallowed file types are refused', async () => {
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    const res = await desk.request('POST', `/api/patients/${patient.id}/attachments`, {
      raw: html,
      headers: { 'content-type': 'text/html', 'x-file-name': 'evil.html' },
    });
    assert.equal(res.status, 415);

    // Declared as a PNG but the bytes are not one.
    const spoof = await desk.request('POST', `/api/patients/${patient.id}/attachments`, {
      raw: Buffer.from('MZ virtual executable'),
      headers: { 'content-type': 'image/png', 'x-file-type': 'image/png', 'x-file-name': 'x.png' },
    });
    assert.equal(spoof.status, 415);
  });

  await t.test('uploading without a session is refused', async () => {
    const res = await env.client().request('POST', `/api/patients/${patient.id}/attachments`, {
      raw: PDF,
      headers: { 'content-type': 'application/pdf', 'x-file-name': 'x.pdf' },
    });
    assert.equal(res.status, 401);
  });

  await t.test('every access to a chart is recorded in the audit trail', async () => {
    await admin.get(`/api/patients/${patient.id}`);
    const audit = await admin.get(`/api/admin/audit?patientId=${patient.id}`);
    const actions = audit.body.events.map((e) => e.action);
    assert.ok(actions.includes('patient.view'));
    assert.ok(actions.includes('patient.create'));
    assert.ok(audit.body.events.every((e) => e.hash && e.hash.length === 16));
  });

  await t.test('the audit chain detects tampering', async () => {
    const before = await admin.get('/api/admin/audit/verify');
    assert.equal(before.body.ok, true);

    // Simulate a privileged attacker editing history directly in the file.
    env.ctx.db.prepare("UPDATE audit_log SET detail_json = '{\"tampered\":true}' WHERE id = 3").run();
    const after = await admin.get('/api/admin/audit/verify');
    assert.equal(after.body.ok, false);
    assert.equal(after.body.brokenAtId, 3);
  });

  await t.test('backups are created, encrypted and restorable', async () => {
    const result = createBackup(env.ctx, { kind: 'manual', actorId: 1, note: 'test' });
    assert.ok(result.sizeBytes > 0);
    const file = path.join(env.ctx.config.paths.backups, result.filename);
    assert.ok(fs.existsSync(file));
    assert.equal(fs.readFileSync(file).subarray(0, 4).toString('latin1'), 'KHE1');
    assert.ok(result.manifest.createdAt);
    assert.ok(result.manifest.files.some((f) => f.path === 'db/kalyan.db'));
    assert.ok(result.manifest.files.some((f) => f.path.startsWith('uploads/')));

    const api = await admin.post('/api/admin/backups', {});
    assert.equal(api.status, 201);
    const list = await admin.get('/api/admin/backups');
    assert.ok(list.body.backups.length >= 2);

    const exportRes = await fetch(`${env.base}/api/admin/backups/${result.id}/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-session-token': admin.token, origin: env.base },
      body: JSON.stringify({ passphrase: 'clinic-offsite-passphrase' }),
    });
    assert.equal(exportRes.status, 200);
    const payload = Buffer.from(await exportRes.arrayBuffer());
    assert.equal(payload.subarray(0, 4).toString('latin1'), 'KHB1');

    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'kh-restore-'));
    const restored = extractBackupFile(payload, 'clinic-offsite-passphrase', target);
    assert.equal(restored.manifest.format, 'kalyan-hospital-backup');
    assert.ok(fs.statSync(path.join(target, 'db', 'kalyan.db')).size > 0);
    assert.ok(fs.readdirSync(path.join(target, 'uploads')).length >= 1);

    // Wrong passphrase must fail loudly.
    assert.throws(() => extractBackupFile(payload, 'wrong-passphrase-here', target));
    fs.rmSync(target, { recursive: true, force: true });
  });

  await t.test('a non-admin cannot manage backups', async () => {
    const { client: doctor } = await makeStaff(env, admin, { username: 'doctor2', role: 'doctor' });
    const res = await doctor.post('/api/admin/backups', {});
    assert.equal(res.status, 403);
  });

  await t.test('admin has no access to patient documents (D-04)', async () => {
    assert.equal((await admin.get(`/api/patients/${patient.id}/attachments`)).status, 403);
    assert.equal((await admin.get(`/api/attachments/${attachmentId}`)).status, 403);
  });

  await t.test('password guessing is stopped by lockout and by throttling', async () => {
    const attacker = env.client();
    let last;
    for (let i = 0; i < 12; i += 1) {
      last = await attacker.post('/api/auth/login', { username: 'admin', password: `guess-${i}` });
    }
    assert.equal(last.status, 423, 'the account locks after five wrong passwords (D-07)');

    // Spraying many usernames from one computer is throttled per IP.
    let sprayed;
    for (let i = 0; i < 10; i += 1) {
      sprayed = await attacker.post('/api/auth/login', { username: `nobody${i}`, password: 'guess-guess' });
    }
    assert.equal(sprayed.status, 429);
  });
});
