import test from 'node:test';
import assert from 'node:assert/strict';
import { foldEvent, newCall } from './derive.js';

test('foldEvent retains Tier 2 provider, usage, latency, evidence, and review proposal details', () => {
  const initial = newCall({ callId: 'c1', apiId: 'api', tool: 'lookup', ts: '2026-10-17T00:00:00Z' });
  const proposed = foldEvent(initial, {
    type: 'patch.proposed', tier: 2, round: 1, ops: [{ op: 'rename_field', from: 'old', to: 'new' }],
    provider: 'gemini', model: 'gemini-2.5-flash', usage: { inputTokens: 12, outputTokens: 4 }, latencyMs: 321,
    evidence: [{ source: 'error', quote: 'missing new' }],
  });
  const halted = foldEvent(proposed, { type: 'halt', reason: 'requires_approval', details: { needsOperator: true, proposal: { ops: [{ op: 'rename_field', from: 'old', to: 'new' }] } } });
  assert.deepEqual(halted.proposals[0], {
    round: 1, tier: 2, ops: [{ op: 'rename_field', from: 'old', to: 'new' }], confidence: undefined,
    evidence: [{ source: 'error', quote: 'missing new' }], provider: 'gemini', model: 'gemini-2.5-flash',
    usage: { inputTokens: 12, outputTokens: 4 }, latencyMs: 321,
  });
  assert.equal(halted.needsReview, true);
  assert.deepEqual(halted.reviewOps, [{ op: 'rename_field', from: 'old', to: 'new' }]);
});
