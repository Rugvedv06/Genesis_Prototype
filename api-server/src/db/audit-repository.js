import { sha256, stableStringify } from '../lib/hash.js';
import { getLocalWorkspaceId } from './workspace.js';

function prepare(value, key = '') {
  if (value === undefined) return undefined;
  const normalizedKey = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (['args', 'arguments', 'data', 'request', 'requestbody', 'response', 'responsebody', 'body', 'prompt', 'headers', 'cookies', 'error', 'message', 'raw']
    .includes(normalizedKey)) return undefined;
  if (key === 'evidence') return undefined;
  if (key === 'ops' && Array.isArray(value)) {
    return value.map((operation) => {
      if (!operation || typeof operation !== 'object' || Array.isArray(operation)) return { op: 'unknown' };
      const safe = {};
      for (const field of ['op', 'path', 'from', 'to', 'type', 'name']) {
        if (typeof operation[field] === 'string') safe[field] = operation[field];
      }
      if (operation.source && typeof operation.source === 'object') {
        safe.source = Object.fromEntries(['type', 'ref'].filter((field) => typeof operation.source[field] === 'string').map((field) => [field, operation.source[field]]));
      }
      return safe;
    });
  }
  if (/(credential|secret|password|authorization|cookie|api[_-]?key|access[_-]?token|refresh[_-]?token)/i.test(key)) return '[redacted]';
  if (Array.isArray(value)) return value.map((item) => prepare(item)).filter((item) => item !== undefined);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .map(([childKey, childValue]) => [childKey, prepare(childValue, childKey)])
      .filter(([, childValue]) => childValue !== undefined));
  }
  return value;
}

function withoutHash(record) {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'hash'));
}

function validRecord(record, index, previousHash) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
  if (record.index !== index || record.prevHash !== previousHash) return false;
  if (typeof record.ts !== 'string' || typeof record.decision !== 'string' || !record.decision) return false;
  return typeof record.hash === 'string' && record.hash === sha256(stableStringify(withoutHash(record)));
}

async function readHead(client, workspaceId, { lock = false } = {}) {
  const { rows } = await client.query(
    `SELECT last_sequence, last_hash FROM audit_heads WHERE workspace_id = $1${lock ? ' FOR UPDATE' : ''}`,
    [workspaceId],
  );
  if (!rows[0]) throw new Error('Audit head is missing for the workspace');
  return rows[0];
}

/** Append within the caller's transaction so domain mutation and audit decision commit together. */
export async function appendAuditInTransaction(client, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.decision !== 'string' || !input.decision) {
    throw new TypeError('audit decision is required');
  }
  if (['index', 'ts', 'prevHash', 'hash'].some((field) => Object.hasOwn(input, field))) {
    throw new TypeError('audit chain fields are assigned by the persistence layer');
  }
  const workspaceId = await getLocalWorkspaceId(client);
  const head = await readHead(client, workspaceId, { lock: true });
  const nextSequence = BigInt(head.last_sequence) + 1n;
  if (nextSequence > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Audit sequence exceeds the supported canonical JSON integer range');
  const index = Number(nextSequence);
  const safeInput = prepare(input);
  if (input.evidence !== undefined) safeInput.evidenceCount = Array.isArray(input.evidence) ? input.evidence.length : 1;
  const record = {
    index,
    ts: new Date().toISOString(),
    prevHash: head.last_hash,
    ...safeInput,
  };
  record.hash = sha256(stableStringify(record));
  const recordedAt = new Date(record.ts);
  await client.query(
    `INSERT INTO audit_entries
     (workspace_id, sequence, recorded_at, decision, call_id, api_id, tool_name, version, reason,
      details, previous_hash, record_hash, canonical_record, hash_format_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13::jsonb, 1)`,
    [workspaceId, index, recordedAt, record.decision, record.callId ?? null, record.apiId ?? null,
      record.tool ?? null, record.versionAfter ?? record.version ?? null, record.reason ?? null,
      JSON.stringify(record), record.prevHash, record.hash, JSON.stringify(record)],
  );
  await client.query(
    `UPDATE audit_heads SET last_sequence = $2, last_hash = $3, updated_at = now() WHERE workspace_id = $1`,
    [workspaceId, index, record.hash],
  );
  return record;
}

export async function listAuditRecords(queryable, { limit = 50, offset = 0, decision, apiId, tool } = {}) {
  const workspaceId = await getLocalWorkspaceId(queryable);
  const safeLimit = Number.isInteger(limit) ? Math.max(0, Math.min(limit, 500)) : 50;
  const safeOffset = Number.isInteger(offset) ? Math.max(0, offset) : 0;
  const { rows } = await queryable.query(
    `SELECT canonical_record FROM audit_entries
     WHERE workspace_id = $1 AND ($2::text IS NULL OR decision = $2)
       AND ($3::text IS NULL OR api_id = $3) AND ($4::text IS NULL OR tool_name = $4)
     ORDER BY sequence LIMIT $5 OFFSET $6`,
    [workspaceId, decision ?? null, apiId ?? null, tool ?? null, safeLimit, safeOffset],
  );
  return rows.map((row) => row.canonical_record);
}

export async function getAuditHead(queryable) {
  const workspaceId = await getLocalWorkspaceId(queryable);
  const head = await readHead(queryable, workspaceId);
  const count = BigInt(head.last_sequence) + 1n;
  if (count > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Audit count exceeds the supported API integer range');
  return { count: Number(count), headHash: head.last_hash };
}

export async function verifyAuditChain(queryable) {
  const workspaceId = await getLocalWorkspaceId(queryable);
  // One statement snapshot prevents a concurrent append from appearing in the
  // head but not the entry list (or vice versa) during verification.
  const { rows: snapshot } = await queryable.query(
    `WITH head AS (
       SELECT last_sequence, last_hash FROM audit_heads WHERE workspace_id = $1
     ), entries AS (
       SELECT sequence, record_hash, previous_hash, canonical_record
       FROM audit_entries WHERE workspace_id = $1
     )
     SELECT head.last_sequence, head.last_hash, entries.sequence, entries.record_hash,
       entries.previous_hash, entries.canonical_record
     FROM head LEFT JOIN entries ON true ORDER BY entries.sequence`,
    [workspaceId],
  );
  if (!snapshot.length) throw new Error('Audit head is missing for the workspace');
  const head = { last_sequence: snapshot[0].last_sequence, last_hash: snapshot[0].last_hash };
  const rows = snapshot.filter((row) => row.sequence !== null);
  let previousHash = null;
  let brokenAt;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (BigInt(row.sequence) !== BigInt(index) || row.previous_hash !== previousHash
      || row.record_hash !== row.canonical_record.hash || !validRecord(row.canonical_record, index, previousHash)) {
      brokenAt = index;
      break;
    }
    previousHash = row.record_hash;
  }
  const expectedSequence = BigInt(rows.length) - 1n;
  const headMatches = BigInt(head.last_sequence) === expectedSequence && head.last_hash === (rows.at(-1)?.record_hash ?? null);
  return {
    ok: brokenAt === undefined && headMatches,
    count: rows.length,
    headHash: rows.at(-1)?.record_hash ?? null,
    ...(brokenAt === undefined ? {} : { brokenAt, reason: 'hash_mismatch' }),
    ...(!headMatches && brokenAt === undefined ? { reason: 'head_mismatch' } : {}),
    anchor: {
      index: BigInt(head.last_sequence) <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(head.last_sequence) : String(head.last_sequence),
      hash: head.last_hash,
    },
  };
}

export async function exportAuditNdjson(queryable) {
  const workspaceId = await getLocalWorkspaceId(queryable);
  const { rows } = await queryable.query(
    'SELECT canonical_record FROM audit_entries WHERE workspace_id = $1 ORDER BY sequence', [workspaceId],
  );
  return rows.map((row) => JSON.stringify(row.canonical_record)).join('') + (rows.length ? '\n' : '');
}
