#!/usr/bin/env node
'use strict';

/**
 * Build a self-contained folder that can be copied to a clinic PC by USB and
 * run with no internet connection and no npm install.
 *
 *   npm run portable
 *
 * Requires that `npm install` has already been run here (on a machine with
 * internet) so node_modules can be copied across. Run this on the same kind of
 * system as the clinic PCs — the SQLite driver is a native binary.
 */
const fs = require('node:fs');
const path = require('node:path');

const config = require('../src/config');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'portable', `kalyan-hospital-${config.version}`);

const COPY = ['server.js', 'package.json', 'package-lock.json', 'src', 'public', 'scripts', 'docs', 'README.md', 'SECURITY.md'];

function copyRecursive(from, to) {
  const stat = fs.statSync(from);
  if (stat.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from)) {
      if (['data', 'node_modules', '.git', 'portable', 'test', 'shots'].includes(entry)) continue;
      copyRecursive(path.join(from, entry), path.join(to, entry));
    }
    return;
  }
  fs.copyFileSync(from, to);
}

function main() {
  if (!fs.existsSync(path.join(ROOT, 'node_modules'))) {
    console.error('\n  Run `npm install` first — node_modules must exist to copy it.\n');
    process.exit(1);
  }

  console.log(`\n  Building portable bundle in ${OUT}\n`);
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  for (const item of COPY) {
    const from = path.join(ROOT, item);
    if (fs.existsSync(from)) copyRecursive(from, path.join(OUT, item));
  }

  console.log('  copying node_modules (this takes a moment)…');
  copyRecursive(path.join(ROOT, 'node_modules'), path.join(OUT, 'node_modules'));

  fs.mkdirSync(path.join(OUT, 'data'), { recursive: true });

  // Windows launcher
  fs.writeFileSync(path.join(OUT, 'START-WINDOWS.bat'), [
    '@echo off',
    'title Kalyan Hospital server',
    'cd /d "%~dp0"',
    'echo.',
    'echo   Starting the Kalyan Hospital clinic server...',
    'echo   Leave this window open while the clinic is working.',
    'echo   Press Ctrl+C in this window to stop the server safely.',
    'echo.',
    'node server.js',
    'echo.',
    'echo   The server has stopped. Press any key to close.',
    'pause >nul',
  ].join('\r\n'), 'utf8');

  // Linux / macOS launcher
  fs.writeFileSync(path.join(OUT, 'start.sh'), [
    '#!/bin/sh',
    'cd "$(dirname "$0")" || exit 1',
    'echo "Starting the Kalyan Hospital clinic server (Ctrl+C to stop)..."',
    'exec node server.js',
  ].join('\n'), 'utf8');
  fs.chmodSync(path.join(OUT, 'start.sh'), 0o755);

  fs.writeFileSync(path.join(OUT, 'READ-ME-FIRST.txt'), [
    'KALYAN HOSPITAL — CLINIC SERVER',
    '',
    'This folder runs the hospital system on a single PC. Other PCs on the',
    'clinic network open it in a browser. It needs no internet connection.',
    '',
    'WHAT YOU NEED',
    '  • Node.js 20, 22 or 24 installed on this PC (offline installer).',
    '    Get the LTS "Windows Installer (.msi)" for x64 from nodejs.org on a',
    '    machine that has internet, copy it across on a USB stick, install.',
    '',
    'TO START THE SERVER',
    '  1. Double-click START-WINDOWS.bat (or run ./start.sh on Linux).',
    '  2. A black window opens and stays open: that IS the server.',
    '  3. The first time, it prints a ONE-TIME SETUP CODE.',
    '  4. On this PC open a browser at  http://localhost:3000/setup',
    '     and create the first administrator with that code.',
    '  5. Tell the other PCs the address shown in the window',
    '     (e.g. http://192.168.1.24:3000).',
    '',
    'IMPORTANT',
    '  • Keep the black window open all day. Closing it stops the system.',
    '  • Never copy or move the "data" folder while the window is open.',
    '  • Backups are written automatically to data\\backups every night.',
    '    Copy them to an external drive weekly.',
    '  • The full guide is in docs\\DEPLOYMENT.md and docs\\OPERATIONS.md.',
    '',
  ].join('\r\n'), 'utf8');

  const size = (function measure(dir) {
    let total = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      total += entry.isDirectory() ? measure(full) : fs.statSync(full).size;
    }
    return total;
  })(OUT);

  console.log(`\n  ✔ Bundle ready: ${OUT}`);
  console.log(`    size: ${(size / 1024 / 1024).toFixed(0)} MB`);
  console.log('\n  Copy that folder to the clinic PC (USB), then double-click START-WINDOWS.bat.');
  console.log('  Do not copy this folder while the server is running.\n');
}

main();
