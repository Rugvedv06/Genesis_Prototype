import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createClient } from 'redis';
import { createIsolatedDatabase } from './helpers/isolated-database.js';
import { loadEnv } from '../src/lib/env.js';

loadEnv();

test('candidate lookup survives Redis eviction and rejects a stale mirror payload', {
  skip: !process.env.HEALR_TEST_DATABASE_URL || !process.env.HEALR_TEST_REDIS_URL,
}, async () => {
  const envKeys = ['DATABASE_URL', 'REDIS_URL', 'HEALR_CACHE_NAMESPACE'];
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  const namespace = `healr:m41evict:${randomBytes(8).toString('hex')}`;
  const cacheKey = randomBytes(32).toString('hex');
  const { closeRedisMirror, readCandidateMirror } = await import('../src/features/patch-cache/redis-mirror.js');
  const { closePool, getPool } = await import('../src/db/pool.js');
  const { saveVerifiedPatchCandidate, findVerifiedPatchCandidate, invalidateVerifiedPatchCandidate } =
    await import('../src/db/registry-service.js');
  let cleanupError;
  const isolated = await createIsolatedDatabase('m41evict');
  let redis;

  try {
    process.env.DATABASE_URL = isolated.url;
    process.env.REDIS_URL = process.env.HEALR_TEST_REDIS_URL;
    process.env.HEALR_CACHE_NAMESPACE = namespace;
    redis = createClient({ url: process.env.REDIS_URL });
    assert.ok(getPool());
    await redis.connect();

    const candidate = {
      cacheKey, scope: 'convention', sourceApiId: 'm41-eviction-source', sourceToolName: 'lookup', sourceVersion: 2,
      adapterFingerprint: 'a'.repeat(64), schemaFingerprint: 'b'.repeat(64), operationSignature: 'c'.repeat(64),
      operations: [{ op: 'rename', from: 'userId', to: 'user_id' }], evidenceClass: 'replay_verified',
      evidenceSummary: { tier: 1, confidence: 0.99, kind: 'validator', replayVerified: true },
      provenanceRequirements: [],
    };

    const saved = await saveVerifiedPatchCandidate(candidate);
    assert.equal(saved.state, 'verified');
    const mirrorKey = `${namespace}:patch:${cacheKey}`;
    assert.ok(await readCandidateMirror(cacheKey), 'save creates the Redis hint');

    await redis.del(mirrorKey);
    assert.equal(await readCandidateMirror(cacheKey), null, 'evicted mirror is absent');
    const found = await findVerifiedPatchCandidate({
      cacheKey, adapterFingerprint: candidate.adapterFingerprint, schemaFingerprint: candidate.schemaFingerprint,
    });
    assert.equal(found.cache_key, cacheKey, 'PostgreSQL remains sufficient to serve the candidate');
    assert.equal((await readCandidateMirror(cacheKey))?.operationSignature, candidate.operationSignature,
      'a successful durable lookup repopulates the mirror');

    assert.equal(await invalidateVerifiedPatchCandidate(cacheKey), 1);
    await redis.set(mirrorKey, JSON.stringify({
      cacheKey, state: 'verified', operationSignature: candidate.operationSignature,
      adapterFingerprint: candidate.adapterFingerprint, schemaFingerprint: candidate.schemaFingerprint,
      sourceVersion: candidate.sourceVersion, operations: candidate.operations,
    }), { EX: 60 });
    assert.equal(await findVerifiedPatchCandidate({
      cacheKey, adapterFingerprint: candidate.adapterFingerprint, schemaFingerprint: candidate.schemaFingerprint,
    }), null, 'an injected stale hint cannot revive an invalidated PostgreSQL row');
    assert.equal(await redis.get(mirrorKey), null, 'stale hint is removed after the durable miss');
  } finally {
    try { if (redis?.isOpen) await redis.quit(); } catch (error) { cleanupError ??= error; }
    try { await closeRedisMirror(); } catch (error) { cleanupError ??= error; }
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
