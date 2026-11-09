#!/usr/bin/env node
'use strict';

require('./src/lib/env').loadEnv();

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const config = require('./src/config');
const log = require('./src/lib/logger');
const { openDatabase } = require('./src/db');
const { loadOrCreateKey } = require('./src/lib/crypto');
const { createApp } = require('./src/app');
const { setupRequired, purgeExpiredSessions } = require('./src/auth');
const { createBackup } = require('./src/lib/backup');
const { generateSetupCode, clearSetupCode, codeExpired } = require('./src/routes/bootstrap');

const BANNER_WIDTH = 74;

function line(char = '=') {
  return char.repeat(BANNER_WIDTH);
}

function lanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const addr of addrs || []) {
      if (addr.family === 'IPv4' && !addr.internal) out.push({ name, address: addr.address });
    }
  }
  return out;
}

function ensureDirectories() {
  for (const dir of [config.paths.data, config.paths.uploads, config.paths.backups, config.paths.keys, config.paths.logs]) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

function printSetupBanner(code, expires) {
  console.log('');
  console.log(line('*'));
  console.log('  KALYAN HOSPITAL - FIRST-RUN SETUP');
  console.log(line('*'));
  console.log('');
  console.log('  No administrator account exists yet. To create the first one:');
  console.log('');
  console.log('    1. On this computer, open a browser and go to:');
  console.log(`         http://localhost:${config.port}/setup`);
  console.log('    2. Enter the one-time setup code shown below.');
  console.log('');
  console.log(`     ONE-TIME SETUP CODE:   ${code}`);
  console.log('');
  console.log(`  This code is valid until ${expires.toLocaleString()}.`);
  console.log('  It is printed ONLY here, works ONCE, and is destroyed the moment');
  console.log('  setup completes. After that the setup page is permanently disabled.');
  console.log('');
  console.log(line('*'));
  console.log('');
}

function printSetupNotice() {
  console.log('');
  console.log(line('*'));
  console.log('  KALYAN HOSPITAL - SETUP NOT COMPLETE');
  console.log(line('*'));
  console.log('  The one-time setup code has expired. A fresh code was printed');
  console.log('  above/below; open /setup on this computer to finish setup.');
  console.log(line('*'));
  console.log('');
}

async function main() {
  ensureDirectories();

  const store = openDatabase();
  const keys = {
    attachments: loadOrCreateKey(config.paths.keys, 'attachments.key'),
    backup: loadOrCreateKey(config.paths.keys, 'backup.key'),
  };

  if (!store.integrityCheck()) {
    console.error('\n[FATAL] The database failed its integrity check. Refusing to start.');
    console.error('        Restore the most recent backup (see docs/OPERATIONS.md) before continuing.\n');
    process.exit(1);
  }

  const ctx = {
    config,
    db: store.db,
    store,
    audit: store.audit,
    keys,
    startedAt: new Date(),
  };

  // ---- first-run bootstrap code -------------------------------------------
  if (setupRequired(store.db)) {
    const { code, expires } = generateSetupCode(ctx);
    printSetupBanner(code, new Date(expires));
    process.on('SIGUSR2', () => {
      if (!setupRequired(store.db)) return;
      const fresh = generateSetupCode(ctx);
      printSetupBanner(fresh.code, new Date(fresh.expires));
    });
  } else {
    clearSetupCode(ctx);
  }

  const app = createApp(ctx);
  const server = app.listen(config.port, config.host, () => {
    const urls = lanAddresses();
    console.log('');
    console.log(`  ${config.appName} server v${config.version}  (${config.env})`);
    console.log(`  Data directory: ${config.paths.data}`);
    console.log(`  Listening on http://${config.host}:${config.port}`);
    console.log('');
    console.log('  Staff can open these addresses from other PCs on the clinic network:');
    for (const iface of urls) {
      console.log(`    http://${iface.address}:${config.port}      (${iface.name})`);
    }
    if (urls.length === 0) {
      console.log('    (no LAN address detected - is this PC connected to the clinic network?)');
    }
    console.log('');
    console.log('  Press Ctrl+C to stop the server (always do this before moving or');
    console.log('  copying the data folder).');
    console.log('');
    log.info(`Server listening on ${config.host}:${config.port}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n[FATAL] Port ${config.port} is already in use.`);
      console.error('        Either another copy of this server is already running,');
      console.error('        or set a different PORT in the .env file.\n');
      process.exit(1);
    }
    console.error('[FATAL] Server error:', err);
    process.exit(1);
  });

  // ---- housekeeping timers ------------------------------------------------
  const sessionTimer = setInterval(() => {
    try {
      purgeExpiredSessions(store.db);
    } catch (err) {
      log.warn('Session purge failed', err.message);
    }
  }, 15 * 60 * 1000);
  sessionTimer.unref();

  function scheduleNightlyBackup() {
    if (!config.backup.scheduleEnabled) return null;
    const now = new Date();
    const next = new Date(now);
    next.setHours(config.backup.hour, 15, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const delay = next.getTime() - now.getTime();
    const timer = setTimeout(() => {
      try {
        if (setupRequired(store.db)) {
          log.info('Skipping scheduled backup: setup is not complete.');
        } else {
          createBackup(ctx, { kind: 'scheduled', note: 'Nightly automatic backup' });
        }
      } catch (err) {
        log.error('Scheduled backup failed', err.stack || err.message);
      }
      scheduleNightlyBackup();
    }, delay);
    timer.unref();
    log.info(`Next automatic backup scheduled for ${next.toString()}`);
    return timer;
  }
  const backupTimer = scheduleNightlyBackup();

  // Keep app_meta honest if the setup route regenerates codes.
  ctx.refreshSetupCode = () => {
    if (!setupRequired(store.db)) return null;
    if (!codeExpired(ctx)) return null;
    const fresh = generateSetupCode(ctx);
    printSetupNotice();
    printSetupBanner(fresh.code, new Date(fresh.expires));
    return fresh;
  };

  // ---- shutdown -----------------------------------------------------------
  let shuttingDown = false;
  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n  ${signal} received - shutting down cleanly...`);
    if (backupTimer) clearTimeout(backupTimer);
    clearInterval(sessionTimer);
    server.close(() => {
      try {
        store.close();
        console.log('  Database checkpointed and closed. Goodbye.\n');
      } catch (err) {
        console.error('  Error closing database:', err.message);
      } finally {
        log.close();
        process.exit(0);
      }
    });
    // Do not hang forever on keep-alive connections.
    setTimeout(() => process.exit(0), 5000).unref();
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    log.error('Unhandled promise rejection', reason && reason.stack ? reason.stack : String(reason));
  });
  process.on('uncaughtException', (err) => {
    log.error('Uncaught exception', err.stack || String(err));
    shutdown('uncaughtException');
  });

  if (process.platform !== 'win32' && typeof process.getuid === 'function' && process.getuid() === 0) {
    log.warn('Running as root. Run the server as a dedicated, unprivileged user instead.');
  }

  return { server, ctx, store };
}

main().catch((err) => {
  console.error('[FATAL] Could not start the server:', err.stack || err.message);
  process.exit(1);
});
