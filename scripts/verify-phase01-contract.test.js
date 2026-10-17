import test from 'node:test';
import assert from 'node:assert/strict';
import { isConsistentConcurrentHealResult } from './verify-phase01-contract.js';

const fourOps = ['add_header', 'move_field', 'rename_field', 'coerce_type'];
const response = (id, meta) => ({ json: { ok: true, data: { id }, meta } });

test('concurrent M5 acceptance accepts heal followers and calls that arrive after the one commit', () => {
  assert.equal(isConsistentConcurrentHealResult(response('111', { version: 4, healed: true, rounds: 4, ops: fourOps.map((op) => ({ op })) }), '111', 4), true);
  assert.equal(isConsistentConcurrentHealResult(response('222', { version: 4, healed: false, rounds: 0, tier: 0, ops: [] }), '222', 4), true);
  assert.equal(isConsistentConcurrentHealResult(response('333', { version: 4, healed: false, rounds: 1, tier: 1 }), '333', 4), false);
  assert.equal(isConsistentConcurrentHealResult(response('other', { version: 4, healed: false, rounds: 0, tier: 0 }), '333', 4), false);
});
