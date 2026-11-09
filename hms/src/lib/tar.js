'use strict';

/**
 * Minimal ustar reader/writer.
 *
 * Backups package the SQLite file plus the encrypted document store into a
 * single tarball before encrypting it. Writing ~80 lines of well-specified tar
 * handling keeps the dependency count at two (express + better-sqlite3), which
 * matters on machines that may never see the internet again.
 */

const BLOCK = 512;

function pad(str, len) {
  const buf = Buffer.alloc(len, 0);
  Buffer.from(str, 'utf8').copy(buf, 0, 0, Math.min(len, Buffer.byteLength(str)));
  return buf;
}

function octal(value, len) {
  const s = value.toString(8);
  if (s.length > len - 1) throw new Error('tar: numeric field overflow');
  return pad(s.padStart(len - 1, '0'), len);
}

function splitName(name) {
  const buf = Buffer.byteLength(name);
  if (buf <= 100) return { name, prefix: '' };
  // Split at a '/' so prefix (155) + name (100) holds the path.
  for (let i = name.length - 1; i > 0; i -= 1) {
    if (name[i] === '/' && Buffer.byteLength(name.slice(i + 1)) <= 100 && Buffer.byteLength(name.slice(0, i)) <= 155) {
      return { name: name.slice(i + 1), prefix: name.slice(0, i) };
    }
  }
  throw new Error(`tar: path too long: ${name}`);
}

function header({ name, size, mtime, type = '0', mode = 0o644 }) {
  const { name: shortName, prefix } = splitName(name);
  const h = Buffer.alloc(BLOCK, 0);
  pad(shortName, 100).copy(h, 0);
  octal(mode, 8).copy(h, 100);
  octal(0, 8).copy(h, 108); // uid
  octal(0, 8).copy(h, 116); // gid
  octal(size, 12).copy(h, 124);
  octal(mtime, 12).copy(h, 136);
  h.fill(0x20, 148, 156); // checksum placeholder = spaces
  h.write(type, 156, 1, 'latin1');
  // linkname (157-256) zero
  h.write('ustar\u000000', 257, 8, 'latin1');
  pad('root', 32).copy(h, 265);
  pad('root', 32).copy(h, 297);
  octal(0, 8).copy(h, 329);
  octal(0, 8).copy(h, 337);
  prefix ? pad(prefix, 155).copy(h, 345) : null;

  let sum = 0;
  for (let i = 0; i < BLOCK; i += 1) sum += h[i];
  const chk = sum.toString(8).padStart(6, '0');
  h.write(chk, 148, 6, 'latin1');
  h[154] = 0;
  h[155] = 0x20;
  return h;
}

function padToBlock(buf) {
  const rem = buf.length % BLOCK;
  if (rem === 0) return Buffer.alloc(0);
  return Buffer.alloc(BLOCK - rem, 0);
}

/**
 * Build a tar archive from [{ name, data: Buffer, mtime?: Date }].
 */
function createTar(entries) {
  const chunks = [];
  for (const entry of entries) {
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data || '');
    const mtime = Math.floor((entry.mtime ? entry.mtime.getTime() : Date.now()) / 1000);
    chunks.push(header({ name: entry.name, size: data.length, mtime }));
    chunks.push(data);
    const padding = padToBlock(data);
    if (padding.length) chunks.push(padding);
  }
  chunks.push(Buffer.alloc(BLOCK * 2, 0));
  return Buffer.concat(chunks);
}

/** Parse a tar archive into [{ name, data }]. */
function readTar(buffer) {
  const entries = [];
  let offset = 0;
  while (offset + BLOCK <= buffer.length) {
    const block = buffer.subarray(offset, offset + BLOCK);
    if (block.every((b) => b === 0)) break;
    const rawName = block.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const prefix = block.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
    const name = prefix ? `${prefix}/${rawName}` : rawName;
    const sizeStr = block.subarray(124, 136).toString('latin1').replace(/\0.*$/, '').trim();
    const size = parseInt(sizeStr || '0', 8);
    if (Number.isNaN(size)) throw new Error(`tar: bad size for ${name}`);
    const type = block.subarray(156, 157).toString('latin1');
    offset += BLOCK;
    const data = buffer.subarray(offset, offset + size);
    offset += size + (size % BLOCK === 0 ? 0 : BLOCK - (size % BLOCK));
    if (type === '0' || type === '\0' || type === '') entries.push({ name, data: Buffer.from(data) });
  }
  return entries;
}

module.exports = { createTar, readTar };
