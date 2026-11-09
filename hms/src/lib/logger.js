'use strict';

const fs = require('node:fs');
const path = require('node:path');

const config = require('../config');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[process.env.KH_LOG_LEVEL] ?? LEVELS.info;

let stream = null;
let streamDay = null;

function dayStamp(d = new Date()) {
  const iso = d.toISOString();
  return iso.slice(0, 10);
}

function fileStream() {
  try {
    const day = dayStamp();
    if (stream && streamDay === day) return stream;
    if (stream) stream.end();
    fs.mkdirSync(config.paths.logs, { recursive: true });
    stream = fs.createWriteStream(path.join(config.paths.logs, `server-${day}.log`), { flags: 'a' });
    stream.on('error', () => { stream = null; });
    streamDay = day;
    return stream;
  } catch {
    return null;
  }
}

function write(level, msg, extra) {
  if (LEVELS[level] < threshold) return;
  const ts = new Date().toISOString();
  let line = `${ts} ${level.toUpperCase().padEnd(5)} ${msg}`;
  if (extra !== undefined) {
    try {
      line += ' ' + (typeof extra === 'string' ? extra : JSON.stringify(extra));
    } catch {
      line += ' [unserialisable]';
    }
  }
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
  const s = fileStream();
  if (s) s.write(line + '\n');
}

module.exports = {
  debug: (m, e) => write('debug', m, e),
  info: (m, e) => write('info', m, e),
  warn: (m, e) => write('warn', m, e),
  error: (m, e) => write('error', m, e),
  close: () => {
    if (stream) {
      stream.end();
      stream = null;
    }
  },
};
