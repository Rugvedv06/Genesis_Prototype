import test from 'node:test';
import assert from 'node:assert/strict';
import { tier2SampleStatus } from './verify-m5-live-utils.js';

test('live Tier 2 latency samples fail when diagnosis returns any failure, including timeout', () => {
  assert.equal(tier2SampleStatus({}), 'passed');
  assert.equal(tier2SampleStatus({ failure: 'tier2_timeout' }), 'failed');
  assert.equal(tier2SampleStatus({ failure: 'tier2_invalid_output' }), 'failed');
  assert.equal(tier2SampleStatus({ failure: 'tier2_unavailable' }), 'failed');
});
