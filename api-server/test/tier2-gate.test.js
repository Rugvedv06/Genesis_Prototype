import test from 'node:test';
import assert from 'node:assert/strict';
import { check } from '../src/features/safety/gate.js';

const proposal = { tier: 2, confidence: 0.95, ops: [{ op: 'rename_field', from: 'user_id', to: 'subscriber_ref' }] };
for (const risk of ['low', 'medium']) {
  test(`Tier 2 allows ${risk} risk proposals over its typed-op allowlist`, () => {
    const tool = { risk, versionObj: { risk, meta: { risk }, adapter: { response: { map: {} } } } };
    assert.equal(check({ proposal, tool, mode: 'enforce', apiCfg: { confidenceThreshold: 0.85 } }).ok, true);
  });
}
test('Tier 2 high risk proposals require operator approval', () => {
  const tool = { risk: 'high', versionObj: { meta: { risk: 'high' }, adapter: { response: { map: {} } } } };
  assert.equal(check({ proposal, tool, mode: 'enforce' }).reason, 'requires_approval');
});
