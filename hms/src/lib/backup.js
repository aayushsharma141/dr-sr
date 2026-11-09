'use strict';

/**
 * Backup and restore.
 *
 * A backup is a single file containing:
 *   MANIFEST.json   - what it is, when it was taken, schema version, checksums
 *   db/kalyan.db    - consistent snapshot of the database (VACUUM INTO)
 *   uploads/*.khc   - the already-encrypted document store
 *
 * The archive is encrypted with AES-256-GCM under the server's backup key
 * (data/keys/backup.key). Admin-triggered downloads are re-encrypted with a
 * passphrase the administrator types, so an off-site copy is portable and can
 * be restored on another machine with `npm run restore`.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { createTar, readTar } = require('./tar');
const { encryptBuffer, decryptBuffer, encryptWithPassphrase, decryptWithPassphrase, sha256hex } = require('./crypto');
const log = require('./logger');

function stamp(date = new Date()) {
  return date.toISOString().replace(/[:]/g, '-').replace(/\..+$/, '');
}

function buildArchive(ctx, { kind = 'manual', note = null, actorId = null } = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kh-backup-'));
  const snapshotPath = path.join(tmpDir, 'kalyan.db');
  try {
    // VACUUM INTO produces a consistent, defragmented copy while the server
    // keeps serving requests.
    ctx.db.prepare('VACUUM INTO ?').run(snapshotPath);
    const dbData = fs.readFileSync(snapshotPath);

    const entries = [];
    const files = [];

    const manifest = {
      format: 'kalyan-hospital-backup',
      formatVersion: 1,
      createdAt: new Date().toISOString(),
      appVersion: ctx.config.version,
      schemaVersion: ctx.store.schemaVersion,
      kind,
      note,
      instanceId: ctx.store.getMeta('instance_id'),
      hospitalName: ctx.store.getSetting('hospital_name', 'Kalyan Hospital'),
      totals: { patients: 0, visits: 0, invoices: 0, documents: 0 },
    };
    try {
      manifest.totals.patients = ctx.db.prepare('SELECT COUNT(*) AS n FROM patients').get().n;
      manifest.totals.visits = ctx.db.prepare('SELECT COUNT(*) AS n FROM visits').get().n;
      manifest.totals.invoices = ctx.db.prepare('SELECT COUNT(*) AS n FROM invoices').get().n;
      manifest.totals.documents = ctx.db.prepare('SELECT COUNT(*) AS n FROM attachments WHERE is_deleted = 0').get().n;
    } catch { /* non-fatal */ }

    entries.push({ name: 'db/kalyan.db', data: dbData });
    files.push({ path: 'db/kalyan.db', size: dbData.length, sha256: sha256hex(dbData) });

    let uploads = [];
    try {
      uploads = fs.readdirSync(ctx.config.paths.uploads);
    } catch { uploads = []; }
    for (const name of uploads) {
      const full = path.join(ctx.config.paths.uploads, name);
      const stat = fs.statSync(full);
      if (!stat.isFile()) continue;
      const data = fs.readFileSync(full);
      entries.push({ name: `uploads/${name}`, data, mtime: stat.mtime });
      files.push({ path: `uploads/${name}`, size: data.length, sha256: sha256hex(data) });
    }

    manifest.files = files;
    const manifestBuf = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');
    entries.unshift({ name: 'MANIFEST.json', data: manifestBuf });

    const tar = createTar(entries);
    return { archive: tar, manifest };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
}

function createBackup(ctx, { kind = 'manual', note = null, actorId = null } = {}) {
  const started = Date.now();
  const { archive, manifest } = buildArchive(ctx, { kind, note, actorId });
  const encrypted = encryptBuffer(archive, ctx.keys.backup);
  const filename = `kalyan-${stamp()}-${crypto.randomBytes(3).toString('hex')}.khb`;
  fs.mkdirSync(ctx.config.paths.backups, { recursive: true });
  const full = path.join(ctx.config.paths.backups, filename);
  fs.writeFileSync(full, encrypted, { mode: 0o600 });

  const info = ctx.db
    .prepare(
      `INSERT INTO backups (filename, kind, size_bytes, sha256, encrypted, status, created_by, created_at, note)
       VALUES (?,?,?,?,1,'ok',?,?,?)`,
    )
    .run(filename, kind, encrypted.length, sha256hex(encrypted), actorId, new Date().toISOString(), note || null);

  pruneBackups(ctx);
  log.info(`Backup written: ${filename} (${(encrypted.length / 1024).toFixed(1)} KB, ${Date.now() - started} ms)`);
  return {
    id: Number(info.lastInsertRowid),
    filename,
    sizeBytes: encrypted.length,
    manifest,
    durationMs: Date.now() - started,
  };
}

function pruneBackups(ctx) {
  const keep = Number(ctx.store.getSetting('backup_retention', '30')) || 30;
  const rows = ctx.db.prepare("SELECT * FROM backups WHERE status = 'ok' ORDER BY created_at DESC").all();
  const stale = rows.slice(keep);
  for (const row of stale) {
    try {
      fs.rmSync(path.join(ctx.config.paths.backups, row.filename), { force: true });
      ctx.db.prepare('DELETE FROM backups WHERE id = ?').run(row.id);
    } catch (err) {
      log.warn(`Could not prune backup ${row.filename}`, err.message);
    }
  }
  // Flag rows whose file vanished (e.g. cleaned up by hand).
  for (const row of ctx.db.prepare("SELECT * FROM backups WHERE status = 'ok'").all()) {
    if (!fs.existsSync(path.join(ctx.config.paths.backups, row.filename))) {
      ctx.db.prepare("UPDATE backups SET status = 'missing' WHERE id = ?").run(row.id);
    }
  }
}

/** Re-encrypt an existing backup with a passphrase for off-site download. */
function exportBackup(ctx, id, passphrase) {
  const row = ctx.db.prepare('SELECT * FROM backups WHERE id = ?').get(id);
  if (!row) throw new Error('Backup not found.');
  const full = path.join(ctx.config.paths.backups, row.filename);
  if (!fs.existsSync(full)) throw new Error('The backup file is missing from the server.');
  const encrypted = fs.readFileSync(full);
  if (sha256hex(encrypted) !== row.sha256) throw new Error('Backup file failed its integrity check.');
  const archive = decryptBuffer(encrypted, ctx.keys.backup);
  return encryptWithPassphrase(archive, passphrase);
}

/** Restore an export into a directory (used by scripts/restore.js). */
function extractBackupFile(fileBuffer, passphrase, targetDir) {
  const archive = decryptWithPassphrase(fileBuffer, passphrase);
  const entries = readTar(archive);
  const manifestEntry = entries.find((e) => e.name === 'MANIFEST.json');
  if (!manifestEntry) throw new Error('Backup archive has no MANIFEST.json - it is not a Kalyan Hospital backup.');
  const manifest = JSON.parse(manifestEntry.data.toString('utf8'));

  const dbEntry = entries.find((e) => e.name === 'db/kalyan.db');
  if (!dbEntry) throw new Error('Backup archive does not contain a database.');

  fs.mkdirSync(path.join(targetDir, 'db'), { recursive: true });
  fs.writeFileSync(path.join(targetDir, 'db', 'kalyan.db'), dbEntry.data);
  fs.mkdirSync(path.join(targetDir, 'uploads'), { recursive: true });
  for (const entry of entries) {
    if (entry.name.startsWith('uploads/')) {
      fs.writeFileSync(path.join(targetDir, entry.name), entry.data);
    }
  }
  return { manifest, fileCount: entries.length };
}

module.exports = { createBackup, pruneBackups, exportBackup, extractBackupFile, buildArchive };
