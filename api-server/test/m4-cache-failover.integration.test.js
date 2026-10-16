import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { createIsolatedDatabase } from './helpers/isolated-database.js';
import { loadEnv } from '../src/lib/env.js';

loadEnv();

async function unusedLocalPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

test('patch candidate operations remain PostgreSQL-authoritative during Redis outage', {
  skip: !process.env.HEALR_TEST_DATABASE_URL,
}, async () => {
  const isolated = await createIsolatedDatabase('m41redis');
  const originalEnv = Object.fromEntries([
    'DATABASE_URL', 'REDIS_URL', 'HEALR_CACHE_NAMESPACE', 'REDIS_CONNECT_TIMEOUT_MS', 'REDIS_COMMAND_TIMEOUT_MS',
  ].map((key) => [key, process.env[key]]));
  const { closeRedisMirror, redisMirrorStatus } = await import('../src/features/patch-cache/redis-mirror.js');
  const { closePool, getPool } = await import('../src/db/pool.js');
  const { saveVerifiedPatchCandidate, findVerifiedPatchCandidate, invalidateVerifiedPatchCandidate } =
    await import('../src/db/registry-service.js');
  const cacheKey = randomBytes(32).toString('hex');
  const port = await unusedLocalPort();
  let cleanupError;

  try {
    process.env.DATABASE_URL = isolated.url;
    process.env.REDIS_URL = `redis://127.0.0.1:${port}`;
    process.env.HEALR_CACHE_NAMESPACE = `healr:m41:${randomBytes(8).toString('hex')}`;
    process.env.REDIS_CONNECT_TIMEOUT_MS = '100';
    process.env.REDIS_COMMAND_TIMEOUT_MS = '50';

    // Ensure the newly imported pool binds to this disposable database URL.
    assert.ok(getPool());
    const candidate = {
      cacheKey,
      scope: 'convention',
      sourceApiId: 'm41-outage-source',
      sourceToolName: 'lookup',
      sourceVersion: 2,
      adapterFingerprint: 'a'.repeat(64),
      schemaFingerprint: 'b'.repeat(64),
      operationSignature: 'c'.repeat(64),
      operations: [{ op: 'rename', from: 'userId', to: 'user_id' }],
      evidenceClass: 'replay_verified',
      evidenceSummary: { tier: 1, confidence: 0.99, kind: 'validator', replayVerified: true },
      provenanceRequirements: [],
    };

    const saved = await saveVerifiedPatchCandidate(candidate);
    assert.equal(saved.cache_key, cacheKey);
    assert.equal(saved.state, 'verified');
    const found = await findVerifiedPatchCandidate({
      cacheKey, adapterFingerprint: candidate.adapterFingerprint, schemaFingerprint: candidate.schemaFingerprint,
    });
    assert.equal(found.cache_key, cacheKey);
    assert.deepEqual(found.operations, candidate.operations);
    assert.deepEqual(redisMirrorStatus(), { configured: true, ready: false, degraded: true });

    assert.equal(await invalidateVerifiedPatchCandidate(cacheKey), 1);
    assert.equal(await findVerifiedPatchCandidate({
      cacheKey, adapterFingerprint: candidate.adapterFingerprint, schemaFingerprint: candidate.schemaFingerprint,
    }), null);
    const durable = await getPool().query('SELECT state FROM patch_candidates WHERE cache_key = $1', [cacheKey]);
    assert.equal(durable.rows[0]?.state, 'invalidated');
  } finally {
    try {
      await closeRedisMirror();
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(redisMirrorStatus().degraded, false, 'closing an outage client resets its process-local degraded state');
    } catch (error) { cleanupError ??= error; }
    try { await closePool(); } catch (error) { cleanupError ??= error; }
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    try {
      const dropped = await isolated.drop();
      assert.deepEqual(dropped, { dropped: true, databaseExists: false });
    } catch (error) { cleanupError ??= error; }
    if (cleanupError) throw cleanupError;
  }
});
