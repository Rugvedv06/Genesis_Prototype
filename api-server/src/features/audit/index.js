import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cfg } from '../../config.js';
import { sha256, stableStringify } from '../../lib/hash.js';

const DEFAULT_DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data');
const DATA_DIR = cfg.dataDir ?? DEFAULT_DATA_DIR;
const FILE = join(DATA_DIR, 'audit.jsonl');
const HEAD = join(DATA_DIR, 'audit.head.json');
const BACKUP = `${FILE}.bak`;

function prepare(value, key = '') {
  if (value === undefined) return undefined;
  if (/(credential|secret|token|password|authorization)/i.test(key)) return '[redacted]';
  if (Array.isArray(value)) return value.map((item) => prepare(item)).filter((item) => item !== undefined);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .map(([k, v]) => [k, prepare(v, k)])
      .filter(([, v]) => v !== undefined));
  }
  return value;
}

function readRecords() {
  if (!existsSync(FILE)) return [];
  return readFileSync(FILE, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

export function append(input) {
  ensureDir();
  const records = readRecords();
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
  return readRecords()
    .filter((record) => (!decision || record.decision === decision) && (!apiId || record.apiId === apiId) && (!tool || record.tool === tool))
    .slice(offset, offset + limit);
}

export function verify() {
  const records = readRecords();
  let brokenAt;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const expected = sha256(stableStringify(Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'hash'))));
    if (record.index !== index || record.hash !== expected || record.prevHash !== (index ? records[index - 1].hash : null)) {
      brokenAt = index;
      break;
    }
  }
  const anchor = existsSync(HEAD) ? JSON.parse(readFileSync(HEAD, 'utf8')) : null;
  const tail = records.at(-1);
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
  copyFileSync(BACKUP, FILE);
  const tail = readRecords().at(-1);
  if (tail) writeFileSync(HEAD, JSON.stringify({ index: tail.index, hash: tail.hash }));
  return true;
}

export function tamper(index, mode) {
  const records = readRecords();
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
