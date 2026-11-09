#!/usr/bin/env node
'use strict';

/**
 * Create a backup from the console (the server also does this nightly).
 *
 *   npm run backup                 # write an encrypted backup into data/backups
 *   npm run backup -- --list       # list existing backups
 */
require('../src/lib/env').loadEnv();

const fs = require('node:fs');
const path = require('node:path');

const config = require('../src/config');
const { openDatabase } = require('../src/db');
const { loadOrCreateKey } = require('../src/lib/crypto');
const { createBackup, pruneBackups } = require('../src/lib/backup');
const { heading } = require('./_prompt');

function main() {
  const wantList = process.argv.includes('--list');
  fs.mkdirSync(config.paths.data, { recursive: true });
  const store = openDatabase();
  const ctx = {
    config,
    db: store.db,
    store,
    keys: { backup: loadOrCreateKey(config.paths.keys, 'backup.key') },
  };

  if (wantList) {
    heading('Existing backups');
    const rows = store.db.prepare('SELECT * FROM backups ORDER BY created_at DESC LIMIT 40').all();
    if (!rows.length) console.log('  No backups yet.');
    for (const row of rows) {
      console.log(`  ${row.created_at}  ${(row.size_bytes / 1024).toFixed(0).padStart(6)} KB  ${row.kind.padEnd(9)} ${row.filename}`);
    }
    console.log('');
    store.close();
    return;
  }

  heading('Creating backup');
  const result = createBackup(ctx, { kind: 'manual', note: 'Console backup' });
  pruneBackups(ctx);
  console.log(`  ✔ ${result.filename}`);
  console.log(`    size     ${(result.sizeBytes / 1024).toFixed(1)} KB`);
  console.log(`    patients ${result.manifest.totals.patients} · visits ${result.manifest.totals.visits} · invoices ${result.manifest.totals.invoices}`);
  console.log(`    stored   ${path.join(config.paths.backups, result.filename)}`);
  console.log('\n  Copy this file to an external drive that lives away from the server.');
  console.log('  To hand a copy to a third party, use the admin console "Export" button,');
  console.log('  which re-encrypts it with a passphrase you choose.\n');
  store.close();
}

main();
