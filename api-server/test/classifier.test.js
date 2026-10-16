// Phase 1 golden tests: classifier parseErrors for all error styles (§4.4).
// Feeds every golden fixture under /contracts/errors through parseErrors+classify.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseErrors, classify } from '../src/features/classifier/index.js';
import { loadGolden } from './helpers/golden.js';

// Extract the error detail/errors array from a golden fixture, handling the
// fact that some mutations nest details under `body` (M4/M5) while others
// place them at the top level (M1/M2/M3). Returns a wrapper object suitable
// for parseErrors (i.e. { detail: [...] } or { errors: [...] }).
function errorDetailsFrom(g) {
  if (g.body) {
    if (Array.isArray(g.body.detail)) return { detail: g.body.detail };
    if (Array.isArray(g.body.errors)) return { errors: g.body.errors };
  }
  if (Array.isArray(g.detail)) return { detail: g.detail };
  if (Array.isArray(g.errors)) return { errors: g.errors };
  return { detail: [] };
}

// Extract the header error from a golden fixture (M4/M5).
function headerErrorFrom(g) {
  if (g.header) return g.header;
  return null;
}

function kindsOf(details, status) {
  return parseErrors(details, status).map((r) => r.kind);
}

// ---- pydantic-v1 ----

test('pydantic-v1 missing + extra (M1 user_id renamed userId)', () => {
  const g = loadGolden('pydantic-v1', 'm1');
  const recs = parseErrors(errorDetailsFrom(g), g._status);
  assert.strictEqual(recs.length, 2);
  assert.strictEqual(recs[0].kind, 'missing');
  assert.deepStrictEqual(recs[0].path, ['userId']);
  assert.strictEqual(recs[1].kind, 'extra');
  assert.deepStrictEqual(recs[1].path, ['user_id']);
  assert.strictEqual(classify(recs, g._status), 'validation4xx');
});

test('pydantic-v1 type error (M2 user_id must be integer)', () => {
  const g = loadGolden('pydantic-v1', 'm2');
  const recs = parseErrors(errorDetailsFrom(g), g._status);
  assert.strictEqual(recs[0].kind, 'type');
  assert.deepStrictEqual(recs[0].path, ['user_id']);
});

test('pydantic-v1 layered M3 (target missing + user_id extra)', () => {
  const g = loadGolden('pydantic-v1', 'm3');
  const recs = parseErrors(errorDetailsFrom(g), g._status);
  assert.strictEqual(recs[0].kind, 'missing');
  assert.deepStrictEqual(recs[0].path, ['target']);
  assert.strictEqual(recs[1].kind, 'extra');
  assert.deepStrictEqual(recs[1].path, ['user_id']);
});

test('mock canonical missing_header (M4/M5)', () => {
  const g = loadGolden('pydantic-v1', 'm4');
  // m4 returns the mock canonical shape { error, header, allowed } at top level
  const recs = parseErrors(g, g._status);
  assert.strictEqual(recs.length, 1);
  assert.strictEqual(recs[0].kind, 'missing_header');
  assert.strictEqual(recs[0].header, 'X-API-Version');
});

// ---- pydantic-v2 ----

test('pydantic-v2 shape (M1)', () => {
  const g = loadGolden('pydantic-v2', 'm1');
  const recs = parseErrors(errorDetailsFrom(g), g._status);
  assert.strictEqual(recs[0].kind, 'missing');
  assert.strictEqual(recs[1].kind, 'extra');
});

test('pydantic-v2 M5 header + layered body', () => {
  const g = loadGolden('pydantic-v2', 'm5');
  const recs = parseErrors(errorDetailsFrom(g), g._status);
  assert.strictEqual(recs[0].kind, 'missing');
  assert.strictEqual(recs[1].kind, 'extra');
  assert.strictEqual(recs[2].kind, 'missing');
});

// ---- problem-json ----

test('problem-json shape (M1)', () => {
  const g = loadGolden('problem-json', 'm1');
  const recs = parseErrors(errorDetailsFrom(g), g._status);
  assert.strictEqual(recs[0].kind, 'missing');
});

test('problem-json M5 header + layered body', () => {
  const g = loadGolden('problem-json', 'm5');
  const recs = parseErrors(errorDetailsFrom(g), g._status);
  assert.strictEqual(recs[0].kind, 'missing');
  assert.strictEqual(recs[1].kind, 'extra');
  assert.strictEqual(recs[2].kind, 'missing');
});

// ---- classify edge cases ----

test('classify: 500 transient, 400 other4xx, empty errors', () => {
  assert.strictEqual(classify([], 500), 'transient');
  assert.strictEqual(classify([], 400), 'other4xx');
  assert.strictEqual(classify([], 200), 'other4xx');
});

test('classify: missing_header is header4xx', () => {
  const recs = [{ kind: 'missing_header', header: 'X-Tenant' }];
  assert.strictEqual(classify(recs, 400), 'header4xx');
});

// ---- golden fixtures are all valid JSON ----

test('every golden fixture under /contracts parses as JSON', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const walk = (dir, out = []) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (entry.name.endsWith('.json')) out.push(full);
    }
    return out;
  };
  const files = walk(path.join(process.cwd(), 'contracts'));
  assert.ok(files.length > 0, 'no contract files found');
  for (const f of files) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch (e) {
      assert.fail(`Not valid JSON: ${f}: ${e.message}`);
    }
    if (f.includes('errors/')) {
      assert.ok(parsed._status, `Missing _status: ${f}`);
      assert.ok(parsed._note, `Missing _note: ${f}`);
    }
  }
});
