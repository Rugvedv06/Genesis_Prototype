import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync, copyFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { cfg } from '../../config.js';
import { sha256, stableStringify } from '../../lib/hash.js';
import { resolveDataDir } from '../../lib/data-dir.js';
import { sanitizePatchExplanation } from './explanation.js';

const DATA_DIR = resolveDataDir(cfg.dataDir);
const FILE = join(DATA_DIR, 'audit.jsonl');
const HEAD = join(DATA_DIR, 'audit.head.json');
const BACKUP = `${FILE}.bak`;

function prepare(value, key = '') {
  if (value === undefined) return undefined;
  if (key === 'explanation') return sanitizePatchExplanation(value) ?? undefined;
  if (/(credential|secret|password|authorization)/i.test(key)) return '[redacted]';
  if (Array.isArray(value)) return value.map((item) => prepare(item)).filter((item) => item !== undefined);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .map(([k, v]) => [k, prepare(v, k)])
      .filter(([, v]) => v !== undefined));
  }
  return value;
}

function validRecordShape(record) {
  return record !== null && typeof record === 'object' && !Array.isArray(record)
    && Number.isInteger(record.index) && record.index >= 0
    && typeof record.ts === 'string'
    && (record.prevHash === null || (typeof record.prevHash === 'string' && /^[a-f0-9]{64}$/i.test(record.prevHash)))
    && typeof record.hash === 'string' && /^[a-f0-9]{64}$/i.test(record.hash)
    && typeof record.decision === 'string' && record.decision.length > 0;
}

function parseRecords(text) {
  const records = [];
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      return { records, malformedAt: records.length, malformedReason: 'malformed_json' };
    }
    if (!validRecordShape(record)) return { records, malformedAt: records.length, malformedReason: 'malformed_record' };
    records.push(record);
  }
  return { records, malformedAt: undefined, malformedReason: undefined };
}

function readRecords() {
  if (!existsSync(FILE)) return { records: [], malformedAt: undefined };
  return parseRecords(readFileSync(FILE, 'utf8'));
}

function readAnchor() {
  if (!existsSync(HEAD)) return { anchor: null, malformed: false };
  try {
    const anchor = JSON.parse(readFileSync(HEAD, 'utf8'));
    const valid = anchor && typeof anchor === 'object'
      && Number.isInteger(anchor.index) && anchor.index >= 0
      && typeof anchor.hash === 'string' && /^[a-f0-9]{64}$/i.test(anchor.hash);
    return valid ? { anchor, malformed: false } : { anchor: null, malformed: true };
  } catch {
    return { anchor: null, malformed: true };
  }
}

function firstBrokenRecord(records) {
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const expected = sha256(stableStringify(Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'hash'))));
    if (record.index !== index || record.hash !== expected || record.prevHash !== (index ? records[index - 1].hash : null)) {
      return index;
    }
  }
  return undefined;
}

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

export function append(input) {
  ensureDir();
  const { records, malformedAt, malformedReason } = readRecords();
  if (malformedAt !== undefined) throw new Error(`audit_${malformedReason ?? 'malformed_record'} at index ${malformedAt}`);
  const integrity = verify();
  if (!integrity.ok) throw new Error(`audit_integrity_error: ${integrity.reason ?? 'invalid_chain'}`);
  const payload = prepare(input);
  const previous = records.at(-1);
  const record = {
    index: records.length,
    ts: new Date().toISOString(),
    prevHash: previous?.hash ?? null,
    ...payload,
  };
  record.hash = sha256(stableStringify(record));
  appendFileSync(FILE, `${JSON.stringify(record)}\n`);
  writeFileSync(HEAD, JSON.stringify({ index: record.index, hash: record.hash }));
  return record;
}

export function list({ limit = 50, offset = 0, decision, apiId, tool } = {}) {
  return readRecords().records
    .filter((record) => (!decision || record.decision === decision) && (!apiId || record.apiId === apiId) && (!tool || record.tool === tool))
    .slice(offset, offset + limit);
}

export function verify() {
  const { records, malformedAt, malformedReason } = readRecords();
  const { anchor, malformed: malformedHead } = readAnchor();
  const tail = records.at(-1);
  if (malformedAt !== undefined) {
    return {
      ok: false,
      count: records.length,
      headHash: tail?.hash ?? null,
      brokenAt: malformedAt,
      reason: malformedReason ?? 'malformed_record',
      malformed: true,
      anchor,
    };
  }
  if (malformedHead) {
    return {
      ok: false,
      count: records.length,
      headHash: tail?.hash ?? null,
      reason: 'malformed_head',
      malformed: true,
      anchor: null,
    };
  }
  const brokenAt = firstBrokenRecord(records);
  const tailMatches = !anchor || (tail && anchor.index === tail.index && anchor.hash === tail.hash);
  return {
    ok: brokenAt === undefined && tailMatches,
    count: records.length,
    headHash: tail?.hash ?? null,
    brokenAt,
    reason: brokenAt !== undefined ? 'hash_mismatch' : (!tailMatches ? 'tail_truncated' : undefined),
    anchor,
  };
}

export function backup() {
  ensureDir();
  if (existsSync(FILE)) copyFileSync(FILE, BACKUP);
}

export function restore() {
  if (!existsSync(BACKUP)) return false;
  const backup = readFileSync(BACKUP, 'utf8');
  const { records, malformedAt } = parseRecords(backup);
  if (malformedAt !== undefined || firstBrokenRecord(records) !== undefined) return false;
  writeFileSync(FILE, backup);
  const tail = records.at(-1);
  if (tail) writeFileSync(HEAD, JSON.stringify({ index: tail.index, hash: tail.hash }));
  else if (existsSync(HEAD)) unlinkSync(HEAD);
  return verify().ok;
}

export function tamper(index, mode) {
  const { records, malformedAt } = readRecords();
  if (malformedAt !== undefined) return false;
  if (!Number.isInteger(index) || !records[index] || !['edit', 'delete'].includes(mode)) return false;
  backup();
  if (mode === 'delete') records.splice(index, 1);
  else records[index] = { ...records[index], tampered: true };
  writeFileSync(FILE, records.map((record) => JSON.stringify(record)).join('\n') + (records.length ? '\n' : ''));
  return true;
}

export function exportNdjson() {
  return existsSync(FILE) ? readFileSync(FILE, 'utf8') : '';
}

export function head() {
  const { records } = readRecords();
  const tail = records.at(-1);
  return { count: records.length, headHash: tail?.hash ?? null, verified: verify().ok };
}
