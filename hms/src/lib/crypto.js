'use strict';

/**
 * Cryptography helpers: password hashing (scrypt), symmetric encryption for
 * attachments and backups (AES-256-GCM), hashing, and random tokens.
 *
 * Only Node's built-in crypto is used - no third-party crypto code.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// --------------------------------------------------------------------------
// Randomness
// --------------------------------------------------------------------------
const BASE32_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I,O,0,1

function randomBytes(n) {
  return crypto.randomBytes(n);
}

/** URL-safe random token (used for session ids). */
function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Human-friendly random code, grouped: ABCD-EFGH. */
function randomCode(groups = 2, groupLen = 4) {
  const parts = [];
  const bytes = crypto.randomBytes(groups * groupLen);
  for (let g = 0; g < groups; g += 1) {
    let s = '';
    for (let i = 0; i < groupLen; i += 1) {
      s += BASE32_ALPHABET[bytes[g * groupLen + i] % BASE32_ALPHABET.length];
    }
    parts.push(s);
  }
  return parts.join('-');
}

// --------------------------------------------------------------------------
// Hashing / comparison
// --------------------------------------------------------------------------
function sha256hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function constantTimeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// --------------------------------------------------------------------------
// Password hashing (scrypt)
//   stored format:  scrypt$N$r$p$<saltB64>$<hashB64>
// --------------------------------------------------------------------------
const SCRYPT = { r: 8, p: 1, keylen: 32 };

function scryptAsync(password, salt, N, keylen, opts) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

async function hashPassword(password, { N = require('../config').scryptN } = {}) {
  const salt = crypto.randomBytes(16);
  const key = await scryptAsync(password.normalize('NFKC'), salt, N, SCRYPT.keylen, {
    N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: 256 * 1024 * 1024,
  });
  return `scrypt$${N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  let key;
  try {
    key = await scryptAsync(password.normalize('NFKC'), salt, N, expected.length, {
      N,
      r,
      p,
      maxmem: 256 * 1024 * 1024,
    });
  } catch {
    return false;
  }
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

/** Spends the same CPU time as a real verification, for unknown usernames. */
async function dummyVerify() {
  const salt = Buffer.alloc(16, 7);
  try {
    await scryptAsync('dummy-password-for-timing', salt, 16384, 32, {
      N: 16384,
      r: 8,
      p: 1,
      maxmem: 128 * 1024 * 1024,
    });
  } catch {
    /* ignore */
  }
  return false;
}

// --------------------------------------------------------------------------
// Password policy
// --------------------------------------------------------------------------
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'passw0rd', '123456', '12345678', '123456789',
  'qwerty', 'qwerty123', 'abc123', 'letmein', 'welcome', 'admin', 'admin123', 'iloveyou',
  'dragon', 'monkey', 'football', 'kalyan', 'kalyanhospital', 'hospital', 'hospital123',
  'doctor', 'doctor123', 'reception', 'reception1', 'india123', 'changeme', 'secret',
  'test1234', 'qwertyuiop', 'asdfghjkl', '1qaz2wsx', 'zaq12wsx', 'master', 'sunshine',
]);

/**
 * Returns { ok, errors[] }. Deliberately simple to explain to staff:
 * at least 12 characters, not a common password, not all one character type.
 */
function checkPasswordPolicy(password, { username, fullName } = {}) {
  const errors = [];
  const pw = String(password || '');
  if (pw.length < 12) errors.push('Use at least 12 characters.');
  if (pw.length > 200) errors.push('Password is too long (200 characters maximum).');
  if (COMMON_PASSWORDS.has(pw.toLowerCase().replace(/\s+/g, ''))) {
    errors.push('This password is too common. Choose something less guessable.');
  }
  if (username && pw.toLowerCase().includes(String(username).toLowerCase())) {
    errors.push('Password must not contain the username.');
  }
  if (fullName) {
    const parts = String(fullName).toLowerCase().split(/\s+/).filter((p) => p.length >= 4);
    if (parts.some((p) => pw.toLowerCase().includes(p))) {
      errors.push('Password must not contain your name.');
    }
  }
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length;
  if (kinds < 3) errors.push('Mix upper case, lower case, numbers or symbols (at least 3 kinds).');
  if (/^(.)\1+$/.test(pw)) errors.push('Password cannot be a single repeated character.');
  return { ok: errors.length === 0, errors };
}

// --------------------------------------------------------------------------
// Symmetric encryption (AES-256-GCM)
//   output layout: "KHE1" | 12-byte IV | 16-byte tag | ciphertext
// --------------------------------------------------------------------------
const MAGIC = Buffer.from('KHE1');

function encryptBuffer(plaintext, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('encryptBuffer: key must be 32 bytes');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, iv, tag, ct]);
}

function decryptBuffer(payload, key) {
  if (!Buffer.isBuffer(payload) || payload.length < MAGIC.length + 28) throw new Error('decryptBuffer: payload too short');
  if (!payload.subarray(0, 4).equals(MAGIC)) throw new Error('decryptBuffer: bad magic header');
  const iv = payload.subarray(4, 16);
  const tag = payload.subarray(16, 32);
  const ct = payload.subarray(32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

/** Encrypt with a passphrase (used for downloadable backups). */
function encryptWithPassphrase(plaintext, passphrase, { N = 32768 } = {}) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(passphrase.normalize('NFKC'), salt, 32, {
    N, r: 8, p: 1, maxmem: 256 * 1024 * 1024,
  });
  const body = encryptBuffer(plaintext, key);
  return Buffer.concat([Buffer.from('KHB1'), salt, body]);
}

function decryptWithPassphrase(payload, passphrase) {
  if (payload.subarray(0, 4).toString() !== 'KHB1') throw new Error('Not a Kalyan Hospital backup file');
  const salt = payload.subarray(4, 20);
  const body = payload.subarray(20);
  const key = crypto.scryptSync(passphrase.normalize('NFKC'), salt, 32, {
    N: 32768, r: 8, p: 1, maxmem: 256 * 1024 * 1024,
  });
  return decryptBuffer(body, key);
}

// --------------------------------------------------------------------------
// Key files (0600) for attachment encryption
// --------------------------------------------------------------------------
function loadOrCreateKey(keysDir, name = 'attachments.key') {
  const file = path.join(keysDir, name);
  fs.mkdirSync(keysDir, { recursive: true, mode: 0o700 });
  if (fs.existsSync(file)) {
    const key = fs.readFileSync(file);
    if (key.length !== 32) throw new Error(`Key file ${file} is corrupt (expected 32 bytes).`);
    return key;
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(file, key, { mode: 0o600 });
  return key;
}

module.exports = {
  randomBytes,
  randomToken,
  randomCode,
  sha256hex,
  constantTimeEqual,
  hashPassword,
  verifyPassword,
  dummyVerify,
  checkPasswordPolicy,
  encryptBuffer,
  decryptBuffer,
  encryptWithPassphrase,
  decryptWithPassphrase,
  loadOrCreateKey,
};
