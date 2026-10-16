import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { createIsolatedDatabase } from './helpers/isolated-database.js';
import pg from 'pg';

const { Pool } = pg;

async function unusedPort() {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return port;
}

const candidate = (key, label) => ({
  cacheKey: key.repeat(64), scope: 'exact', sourceApiId: `m41-${label}`, sourceToolName: 'lookup',
  sourceVersion: 1, adapterFingerprint: 'a'.repeat(64), schemaFingerprint: 'b'.repeat(64),
  operationSignature: 'c'.repeat(64), operations: [{ op: 'rename_field', from: 'old', to: 'new' }],
  evidenceClass: 'validator_missing_field', evidenceSummary: { tier: 1, confidence: 0.9, kind: 'validator', replayVerified: true },
  provenanceRequirements: [],
});

test('cache HTTP routes paginate and invalidate durable candidates', { skip: !process.env.HEALR_TEST_DATABASE_URL }, async (t) => {
  const database = await createIsolatedDatabase('m41_routes');
  const pool = new Pool({ connectionString: database.url });
  const port = await unusedPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, DATABASE_URL: database.url, REDIS_URL: '', PORT: String(port), ENABLE_DEV_ROUTES: '0' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  t.after(async () => {
    child.kill('SIGTERM');
    await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 5000))]);
    await pool.end();
    const cleanup = await database.drop();
    assert.equal(cleanup.databaseExists, false);
  });

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) assert.fail(`API server exited before readiness: ${stderr}`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) break;
    } catch { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal((await fetch(`${baseUrl}/health`)).status, 200, `API server did not become ready: ${stderr}`);

  const { putVerifiedCandidateInTransaction } = await import('../src/db/patch-candidate-repository.js');
  for (const [key, label] of [['1', 'one'], ['2', 'two'], ['3', 'three']]) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await putVerifiedCandidateInTransaction(client, candidate(key, label));
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  const get = async (path) => fetch(`${baseUrl}${path}`);
  const firstResponse = await get('/cache?limit=1');
  assert.equal(firstResponse.status, 200, 'GET /cache should expose candidate inspection');
  const firstPage = await firstResponse.json();
  assert.equal(firstPage.candidates.length, 1);
  assert.ok(firstPage.nextCursor, 'a non-final page exposes its UUID cursor');
  assert.ok(firstPage.mirror && typeof firstPage.mirror.configured === 'boolean', 'response exposes Redis mirror status');
  assert.equal(firstPage.mirror.configured, false, 'the test process deliberately has no Redis mirror configured');

  const secondResponse = await get(`/cache?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor)}`);
  assert.equal(secondResponse.status, 200);
  const secondPage = await secondResponse.json();
  assert.equal(secondPage.candidates.length, 1);
  assert.notEqual(secondPage.candidates[0].id, firstPage.candidates[0].id);
  const maxPageResponse = await get('/cache?limit=200');
  assert.equal(maxPageResponse.status, 200, 'the public maximum page size is accepted');
  assert.equal((await maxPageResponse.json()).candidates.length, 3);
  assert.equal((await get('/cache?limit=201')).status, 400, 'page sizes above the documented maximum are rejected');
  assert.equal((await get('/cache?cursor=not-a-uuid')).status, 400, 'malformed cursors are rejected');

  const oneKey = candidate('1', 'one').cacheKey;
  const invalidateOne = await fetch(`${baseUrl}/cache/${oneKey}`, { method: 'DELETE' });
  assert.equal(invalidateOne.status, 200, 'DELETE /cache/:cacheKey invalidates one candidate');
  assert.deepEqual(await invalidateOne.json(), { ok: true, invalidated: true });
  assert.equal((await pool.query('SELECT state FROM patch_candidates WHERE cache_key = $1', [oneKey])).rows[0].state, 'invalidated');
  assert.equal((await fetch(`${baseUrl}/cache/not-a-fingerprint`, { method: 'DELETE' })).status, 400);

  const clearAll = await fetch(`${baseUrl}/cache`, { method: 'DELETE' });
  assert.equal(clearAll.status, 200, 'DELETE /cache clears all verified candidates');
  assert.deepEqual(await clearAll.json(), { ok: true, invalidated: 2 });
  const remaining = await pool.query("SELECT count(*)::int AS count FROM patch_candidates WHERE state = 'verified'");
  assert.equal(remaining.rows[0].count, 0);
  const postClear = await pool.query("SELECT state FROM patch_candidates WHERE cache_key = $1", [candidate('2', 'two').cacheKey]);
  assert.equal(postClear.rows[0].state, 'invalidated');
  const { findVerifiedCandidateInTransaction } = await import('../src/db/patch-candidate-repository.js');
  const lookup = await pool.connect();
  try {
    const staleMirrorCannotAuthorize = await findVerifiedCandidateInTransaction(lookup, {
      cacheKey: candidate('2', 'two').cacheKey,
      adapterFingerprint: 'a'.repeat(64), schemaFingerprint: 'b'.repeat(64),
    });
    assert.equal(staleMirrorCannotAuthorize, null, 'PostgreSQL invalidation prevents repository use of stale mirror data');
  } finally { lookup.release(); }
});
