import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findVerifiedCandidateInTransaction,
  invalidatePatchCandidatesInTransaction,
  listPatchCandidates,
  putVerifiedCandidateInTransaction,
} from '../src/db/patch-candidate-repository.js';

const fp = 'a'.repeat(64);
const candidate = {
  cacheKey: fp, scope: 'exact', sourceApiId: 'source', sourceToolName: 'get_user', sourceVersion: 2,
  adapterFingerprint: fp, schemaFingerprint: fp, operationSignature: fp,
  operations: [{ op: 'rename_field', from: 'user_id', to: 'userId' }], evidenceClass: 'validator_error',
  evidenceSummary: { kind: 'missing_field', tier: 1, confidence: 1, replayVerified: true },
  provenanceRequirements: [{ apiEpoch: 1, configRevision: 1, credentialRevision: 1, method: 'GET' }],
};

function clientFor(responses = []) {
  const calls = [];
  return {
    calls,
    async query(sql, values) {
      calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), values });
      if (sql.includes("slug = 'local'")) return { rows: [{ id: 'workspace-id' }] };
      return responses.shift() ?? { rows: [], rowCount: 0 };
    },
  };
}

test('candidate persistence only accepts verified-shaped, fingerprinted operations', async () => {
  const db = clientFor([{ rows: [{ cache_key: fp, state: 'verified' }] }]);
  const result = await putVerifiedCandidateInTransaction(db, candidate);
  assert.equal(result.state, 'verified');
  const insert = db.calls.at(-1);
  assert.match(insert.sql, /INSERT INTO patch_candidates/);
  assert.match(insert.sql, /ON CONFLICT \(workspace_id, cache_key\) DO UPDATE/);
  assert.equal(JSON.parse(insert.values[9])[0].op, 'rename_field');
  await assert.rejects(() => putVerifiedCandidateInTransaction(db, { ...candidate, adapterFingerprint: 'bad' }), /SHA-256/);
  await assert.rejects(() => putVerifiedCandidateInTransaction(db, { ...candidate, operations: [] }), /non-empty/);
  await assert.rejects(() => putVerifiedCandidateInTransaction(db, {
    ...candidate,
    provenanceRequirements: [{ apiEpoch: 1, configRevision: 1, method: 'GET' }],
  }), /provenance requirements/);
});

test('candidate lookup is a PostgreSQL state and fingerprint checked update, stale fingerprints miss', async () => {
  const db = clientFor([{ rows: [] }]);
  const result = await findVerifiedCandidateInTransaction(db, { cacheKey: fp, adapterFingerprint: fp, schemaFingerprint: 'b'.repeat(64) });
  assert.equal(result, null);
  const query = db.calls.at(-1);
  assert.match(query.sql, /state = 'verified'/);
  assert.match(query.sql, /adapter_fingerprint = \$3 AND schema_fingerprint = \$4/);
});

test('candidate listing is bounded and invalidation scopes to current workspace', async () => {
  const db = clientFor([{ rows: [] }, { rowCount: 3 }]);
  assert.deepEqual(await listPatchCandidates(db, { limit: 10000 }), []);
  assert.equal(db.calls[1].values[2], 200);
  assert.equal(await invalidatePatchCandidatesInTransaction(db), 3);
  assert.match(db.calls[3].sql, /state = 'invalidated'/);
  assert.deepEqual(db.calls[3].values, ['workspace-id']);
});
