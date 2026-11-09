#!/usr/bin/env node
'use strict';

/**
 * Verify the tamper-evident audit chain from the console.
 * Exits non-zero if the chain is broken, so it can be run from a nightly
 * scheduled task and alert the administrator.
 *
 *   npm run audit:verify
 */
require('../src/lib/env').loadEnv();

const config = require('../src/config');
const { openDatabase } = require('../src/db');

function main() {
  const store = openDatabase();
  const result = store.audit.verifyChain();
  const total = store.db.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n;

  console.log('');
  console.log(`  Audit entries: ${total.toLocaleString('en-IN')}`);
  if (result.ok) {
    console.log(`  ✔ Chain intact — ${result.checked.toLocaleString('en-IN')} entries verified`);
    console.log(`    head hash: ${result.lastHash}`);
    console.log('');
    store.close();
    process.exit(0);
  }
  console.error(`  ✖ CHAIN BROKEN at entry #${result.brokenAtId} (${result.reason})`);
  console.error('    The audit log has been modified outside the application.');
  console.error('    Do not ignore this: restore from a known-good backup and');
  console.error('    investigate who has access to the data folder.');
  console.error('');
  store.close();
  process.exit(1);
}

main();
