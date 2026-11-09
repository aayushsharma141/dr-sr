#!/usr/bin/env node
'use strict';

/**
 * Restore a backup that was exported from the admin console.
 *
 *   npm run restore -- "D:\backups\kalyan-2026-11-09-export.khb"
 *
 * The server MUST be stopped first. The current database and document store
 * are moved aside (not deleted) so a bad restore can be undone by hand.
 */
require('../src/lib/env').loadEnv();

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const config = require('../src/config');
const { extractBackupFile } = require('../src/lib/backup');
const { ask, fail, heading } = require('./_prompt');

async function main() {
  const file = process.argv[2];
  if (!file) {
    heading('Restore a backup');
    console.log('  Usage: npm run restore -- <path-to-backup.khb>\n');
    console.log('  Stop the server first (Ctrl+C in the server window), then run the');
    console.log('  command above. The current data is moved aside, never deleted.\n');
    process.exit(1);
  }
  if (!fs.existsSync(file)) fail(`Backup file not found: ${file}`);

  const payload = fs.readFileSync(file);
  if (payload.subarray(0, 4).toString('latin1') !== 'KHB1') {
    fail('That file is not a Kalyan Hospital backup export (.khb).');
  }

  heading('Restore backup');
  console.log(`  File: ${path.resolve(file)}`);
  console.log(`  Size: ${(payload.length / 1024 / 1024).toFixed(2)} MB\n`);

  const passphrase = await ask('  Backup passphrase: ', { mask: true });
  if (!passphrase) fail('A passphrase is required.');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kh-restore-'));
  let restored;
  try {
    restored = extractBackupFile(payload, passphrase, tempDir);
  } catch (err) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fail(`Could not open the backup (wrong passphrase or damaged file): ${err.message}`);
  }

  const manifest = restored.manifest;
  console.log('\n  Backup contents:');
  console.log(`    taken        ${manifest.createdAt}`);
  console.log(`    hospital     ${manifest.hospitalName || '—'}`);
  console.log(`    app version  ${manifest.appVersion} (schema v${manifest.schemaVersion})`);
  console.log(`    patients     ${manifest.totals?.patients ?? '?'}`);
  console.log(`    visits       ${manifest.totals?.visits ?? '?'}`);
  console.log(`    documents    ${restored.fileCount - 2}\n`);

  // Sanity-check the restored database before swapping it in.
  const candidate = path.join(tempDir, 'db', 'kalyan.db');
  try {
    const probe = new Database(candidate, { readonly: true, fileMustExist: true });
    const ok = probe.pragma('quick_check', { simple: true });
    const patients = probe.prepare('SELECT COUNT(*) AS n FROM patients').get().n;
    probe.close();
    if (ok !== 'ok') fail('The restored database failed its integrity check. Nothing was changed.');
    console.log(`  Integrity check passed — ${patients} patient records found.\n`);
  } catch (err) {
    fail(`The backup does not contain a usable database: ${err.message}`);
  }

  const answer = await ask('  Replace the current clinic data with this backup? Type "restore" to continue: ');
  if (String(answer).trim().toLowerCase() !== 'restore') {
    fs.rmSync(tempDir, { recursive: true, force: true });
    console.log('\n  Cancelled. Nothing was changed.\n');
    process.exit(0);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const aside = path.join(config.paths.data, `pre-restore-${stamp}`);
  fs.mkdirSync(aside, { recursive: true });

  // Move the live database and document store out of the way.
  for (const suffix of ['', '-wal', '-shm']) {
    const current = `${config.paths.db}${suffix}`;
    if (fs.existsSync(current)) fs.renameSync(current, path.join(aside, path.basename(current)));
  }
  if (fs.existsSync(config.paths.uploads)) {
    fs.renameSync(config.paths.uploads, path.join(aside, 'uploads'));
  }

  // Put the restored data in place.
  fs.mkdirSync(path.dirname(config.paths.db), { recursive: true });
  fs.copyFileSync(candidate, config.paths.db);
  fs.chmodSync(config.paths.db, 0o600);
  fs.mkdirSync(config.paths.uploads, { recursive: true });
  const restoredUploads = path.join(tempDir, 'uploads');
  if (fs.existsSync(restoredUploads)) {
    for (const name of fs.readdirSync(restoredUploads)) {
      fs.copyFileSync(path.join(restoredUploads, name), path.join(config.paths.uploads, name));
    }
  }

  fs.rmSync(tempDir, { recursive: true, force: true });

  heading('Restore complete');
  console.log(`  Restored database: ${config.paths.db}`);
  console.log(`  Previous data kept at: ${aside}`);
  console.log('\n  Next steps:');
  console.log('    1. Start the server:  npm start');
  console.log('    2. Sign in and open Backups → Verify integrity.');
  console.log('    3. Sign in with the credentials that were valid when the backup was');
  console.log('       taken — passwords are restored from the backup too.');
  console.log('    4. Once you are happy, delete the pre-restore folder.\n');
  console.log('  NOTE: the document encryption key in data/keys/ has NOT changed, so');
  console.log('  documents restored from this backup will keep working.\n');
}

main().catch((err) => fail(err.stack || err.message));
