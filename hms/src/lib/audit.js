'use strict';

/**
 * Tamper-evident audit trail.
 *
 * Every entry is chained to the previous one by hash. Deleting or editing any
 * historical row breaks the chain, which `verifyChain()` detects. All writes
 * happen on the same synchronous SQLite connection, so the chain cannot race.
 */
const { sha256hex } = require('./crypto');

const GENESIS = '0'.repeat(64);

function canonicalDetail(detail) {
  if (detail === undefined || detail === null) return null;
  const sortKeys = (value) => {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (value && typeof value === 'object') {
      const out = {};
      for (const k of Object.keys(value).sort()) out[k] = sortKeys(value[k]);
      return out;
    }
    return value;
  };
  try {
    return JSON.stringify(sortKeys(detail));
  } catch {
    return JSON.stringify({ unserialisable: true });
  }
}

function rowHash(row, prevHash) {
  const parts = [
    prevHash,
    row.at,
    row.actor_id ?? '',
    row.actor_name ?? '',
    row.actor_role ?? '',
    row.action ?? '',
    row.entity_type ?? '',
    row.entity_id ?? '',
    row.patient_id ?? '',
    row.ip ?? '',
    // user_agent is intentionally excluded from the hash: it is high-entropy
    // noise that would make the chain brittle across proxy changes.
    row.detail_json ?? '',
  ];
  return sha256hex(parts.join('\u0000'));
}

function createAuditLog(db) {
  const lastHashStmt = db.prepare('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1');
  const insertStmt = db.prepare(`
    INSERT INTO audit_log (at, actor_id, actor_name, actor_role, action, entity_type, entity_id,
                           patient_id, ip, user_agent, detail_json, prev_hash, hash)
    VALUES (@at, @actor_id, @actor_name, @actor_role, @action, @entity_type, @entity_id,
            @patient_id, @ip, @user_agent, @detail_json, @prev_hash, @hash)
  `);

  function record(entry) {
    const prev = lastHashStmt.get();
    const prevHash = prev ? prev.hash : GENESIS;
    const row = {
      at: new Date().toISOString(),
      actor_id: entry.actorId ?? null,
      actor_name: entry.actorName ?? null,
      actor_role: entry.actorRole ?? null,
      action: String(entry.action || 'unknown').slice(0, 80),
      entity_type: entry.entityType ?? null,
      entity_id: entry.entityId != null ? String(entry.entityId) : null,
      patient_id: entry.patientId ?? null,
      ip: entry.ip ?? null,
      user_agent: entry.userAgent ? String(entry.userAgent).slice(0, 300) : null,
      detail_json: canonicalDetail(entry.detail),
    };
    row.prev_hash = prevHash;
    row.hash = rowHash(row, prevHash);
    insertStmt.run(row);
    return row;
  }

  /** Walk the whole chain and report the first inconsistency. */
  function verifyChain({ limit = null } = {}) {
    const rows = limit
      ? db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit).reverse()
      : db.prepare('SELECT * FROM audit_log ORDER BY id ASC').all();
    let prev = GENESIS;
    let checked = 0;
    for (const row of rows) {
      const expected = rowHash(row, prev);
      if (row.prev_hash !== prev || row.hash !== expected) {
        return { ok: false, checked, brokenAtId: row.id, reason: 'Hash chain mismatch' };
      }
      prev = row.hash;
      checked += 1;
    }
    return { ok: true, checked, lastHash: prev };
  }

  return { record, verifyChain };
}

module.exports = { createAuditLog, GENESIS };
