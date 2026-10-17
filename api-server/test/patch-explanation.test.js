import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPatchExplanation, sanitizePatchExplanation } from '../src/features/audit/explanation.js';

test('patch explanations preserve safe paths, provenance, checks, and hashes', () => {
  const explanation = buildPatchExplanation({
    beforeAdapter: { request: [{ op: 'rename_field', from: 'userId', to: 'user_id' }] },
    afterAdapter: { request: [{ op: 'rename_field', from: 'userId', to: 'user_id' }, { op: 'move_field', from: 'name', to: 'user.name' }] },
    beforeVersion: 2,
    afterVersion: 3,
    proposal: {
      tier: 1,
      confidence: 0.95,
      ops: [{ op: 'move_field', from: 'name', to: 'user.name' }],
      evidence: [{ kind: 'openapi_schema', pointer: '#/paths/users', quote: 'name is nested under user' }],
    },
    gate: { ok: true },
    verification: { replay: true, logicalResponse: true, identity: true, writeEcho: true },
    policy: { mode: 'enforce', threshold: 0.85, risk: 'low' },
  });

  assert.deepEqual(explanation.changes[0].paths, { before: 'name', after: 'user.name' });
  assert.equal(explanation.adapter.beforeVersion, 2);
  assert.equal(explanation.adapter.afterVersion, 3);
  assert.equal(explanation.evidenceItems[0].pointer, '#/paths/users');
  assert.equal(explanation.policy.decision, 'commit');
  assert.ok(explanation.checks.every((check) => check.passed));
});

test('patch explanation persistence sanitizer strips unknown and unsafe fields', () => {
  const explanation = buildPatchExplanation({
    beforeAdapter: { request: [] },
    afterAdapter: { request: [{ op: 'add_field', path: 'user.id', source: { type: 'spec_default', value: '1' } }] },
    beforeVersion: 1,
    afterVersion: 2,
    proposal: {
      tier: 1,
      confidence: 0.9,
      ops: [{ op: 'add_field', path: 'user.id' }],
      evidence: [{ kind: 'diagnostic', quote: 'safe evidence' }],
    },
    gate: { ok: true },
    verification: { replay: true, logicalResponse: true, identity: true },
    policy: { mode: 'enforce', threshold: 0.85, risk: 'low' },
  });
  const unsafe = {
    ...explanation,
    injected: 'must not persist',
    evidenceItems: [{ kind: 'diagnostic', quote: 'token abcdefghijklmnopqrstuvwxyz123456' }],
  };
  const sanitized = sanitizePatchExplanation(unsafe);
  assert.equal(sanitized.injected, undefined);
  assert.match(sanitized.evidenceItems[0].quote, /\[redacted-token\]/);
  assert.equal(sanitizePatchExplanation({ ...explanation, adapter: { ...explanation.adapter, afterHash: 'not-a-hash' } }), null);
  assert.equal(sanitizePatchExplanation({ schemaVersion: 99 }), null);
});
