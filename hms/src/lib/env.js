'use strict';

/**
 * Tiny .env loader (no dependency). Loaded before anything reads
 * process.env, so configuration can live in a file next to server.js.
 */
const fs = require('node:fs');
const path = require('node:path');

function loadEnv(file = path.resolve(__dirname, '..', '..', '.env')) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return {};
  }
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
    out[key] = value;
  }
  return out;
}

module.exports = { loadEnv };
