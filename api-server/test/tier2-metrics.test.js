import test from 'node:test';
import assert from 'node:assert/strict';
import { emit } from '../src/features/events/bus.js';
import { record } from '../src/features/metrics/index.js';

test('heal metrics aggregate real token usage by tier and role', () => {
  const before = record();
  emit({ type: 'heal.finished', tier: 2, tokens: { input: 12, output: 7 }, tokensByRole: { diagnoser: { input: 12, output: 7 } } });
  const after = record();
  assert.equal(after.tokensIn - before.tokensIn, 12);
  assert.equal(after.tokensOut - before.tokensOut, 7);
  assert.equal(after.tokensByTier['2'].input - (before.tokensByTier['2']?.input ?? 0), 12);
  assert.equal(after.tokensByRole.diagnoser.output - (before.tokensByRole.diagnoser?.output ?? 0), 7);
});
