import test from 'node:test';
import assert from 'node:assert/strict';
import { propose } from '../src/features/diagnoser/tier2-llm/index.js';

const tool = { versionObj: { adapter: { request: [], response: { map: {} } }, meta: { logicalSchema: { type: 'object', properties: { user_id: { type: 'string' } } } } } };
const args = { user_id: 'secret-caller-value' };

test('Tier 2 sends placeholder values and returns only validated typed proposals', async () => {
  let request;
  const provider = { generate: async (value) => {
    request = value;
    return { text: JSON.stringify({ ops: [{ op: 'rename_field', from: 'user_id', to: 'subscriber_ref' }], confidence: 0.96, evidence: [{ source: 'error', quote: 'subscriber_ref is required' }] }), usage: { inputTokens: 14, outputTokens: 8, totalTokens: 22 }, provider: 'gemini', model: 'fake', keySlot: 1, latencyMs: 5 };
  } };
  const result = await propose({ tool, args, failure: { text: 'subscriber_ref is required' }, provider });
  assert.equal(result.tier, 2);
  assert.equal(result.keySlot, 1);
  assert.equal(JSON.stringify(request).includes('secret-caller-value'), false);
  assert.equal(request.thinkingBudget, 0);
});

test('Tier 2 timeout is bounded even if an injected provider ignores AbortSignal', async () => {
  const result = await propose({ tool, args, failure: { text: 'unknown' }, budgetMs: 2, provider: { generate: () => new Promise(() => {}) } });
  assert.equal(result.failure, 'tier2_timeout');
});

test('Tier 2 empty output is a no-proposal and malformed JSON is an invalid output', async () => {
  const empty = await propose({ tool, args, failure: { text: 'no mapping found' }, provider: { generate: async () => ({ text: '{"ops":[],"confidence":0,"evidence":[]}' }) } });
  assert.equal(empty.failure, 'no_proposal');
  const malformed = await propose({ tool, args, failure: { text: 'no mapping found' }, provider: { generate: async () => ({ text: 'not json' }) } });
  assert.equal(malformed.failure, 'tier2_invalid_output');
});

test('Gemini 503 is unavailable and is not retried through another provider', async () => {
  let calls = 0;
  const provider = { generate: async () => {
    calls += 1;
    const error = new Error('provider unavailable');
    error.code = 'provider_unavailable';
    throw error;
  } };
  const result = await propose({ tool, args, failure: { text: 'no mapping found' }, provider });
  assert.equal(result.failure, 'tier2_unavailable');
  assert.equal(calls, 1);
});
