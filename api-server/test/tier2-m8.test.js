import test from 'node:test';
import assert from 'node:assert/strict';
import { run as diagnose } from '../src/features/diagnoser/index.js';

test('M8 enum case not inferable by Tier 1 reaches Tier 2 when spec is unavailable', async () => {
  const tool = { apiId: 'm8-tier2', versionObj: { meta: { path: '/api/users/set-status', method: 'POST', logicalSchema: {
    type: 'object', properties: { user_id: { type: 'string' }, status: { type: 'string', enum: ['active', 'inactive'] } }, required: ['user_id', 'status'],
  } }, adapter: { request: [], response: { map: {} }, _logicalSchema: { type: 'object', properties: { user_id: { type: 'string' }, status: { type: 'string', enum: ['active', 'inactive'] } }, required: ['user_id', 'status'] } } } };
  let calls = 0;
  const result = await diagnose({
    tool, args: { user_id: '123', status: 'active' }, kind: 'request_drift',
    failure: { status: 422, json: { detail: [{ loc: ['body', 'status'], msg: 'must be ENABLED or DISABLED', type: 'type_error.enum', ctx: { enum_values: ['ENABLED', 'DISABLED'] } }] } },
    apiConfig: { healing: { tier2: true } },
    tier2Provider: { generate: async () => { calls += 1; return { text: JSON.stringify({ ops: [{ op: 'set_enum_map', path: 'status', map: { active: 'ENABLED' } }], confidence: 0.96, evidence: [{ source: 'error', quote: 'ENABLED or DISABLED' }] }), provider: 'gemini', model: 'test', keySlot: 0, usage: { inputTokens: 4, outputTokens: 3 } }; } },
  });
  assert.equal(calls, 1);
  assert.equal(result.tier, 2);
  assert.deepEqual(result.ops, [{ op: 'set_enum_map', path: 'status', map: { active: 'ENABLED' } }]);
});
