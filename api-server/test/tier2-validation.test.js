import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTier2Output } from '../src/features/diagnoser/tier2-llm/validate.js';

const tool = { versionObj: { adapter: { request: [], response: { map: {} } } } };
const sentText = 'The upstream error names subscriber_ref and says it is required.';

test('Tier 2 accepts only typed operations over observed names with quoted evidence', () => {
  const checked = validateTier2Output({
    output: { ops: [{ op: 'rename_field', from: 'user_id', to: 'subscriber_ref' }], confidence: 0.95, evidence: [{ source: 'error', quote: 'subscriber_ref and says it is required' }] },
    sentText, observedNames: new Set(['user_id', 'subscriber_ref']), args: { user_id: 'u1' }, tool,
  });
  assert.equal(checked.ok, true);
});

test('Tier 2 rejects unquoted evidence, invented names, and forbidden operations', () => {
  const base = { confidence: 0.95, evidence: [{ source: 'error', quote: 'subscriber_ref' }] };
  assert.equal(validateTier2Output({ output: { ...base, ops: [{ op: 'rename_field', from: 'user_id', to: 'contact_address' }] }, sentText, observedNames: new Set(['user_id', 'subscriber_ref']), args: { user_id: 'u1' }, tool }).reason, 'unobserved_name');
  assert.equal(validateTier2Output({ output: { ...base, evidence: [{ source: 'error', quote: 'invented proof' }], ops: [] }, sentText, observedNames: new Set(), args: {}, tool }).reason, 'evidence_not_quoted');
  assert.equal(validateTier2Output({ output: { ...base, ops: [{ op: 'add_header', name: 'Authorization', source: { type: 'credential', ref: 'TOKEN' } }] }, sentText, observedNames: new Set(['Authorization']), args: {}, tool }).reason, 'invalid_schema');
});

test('Tier 2 evidence must come from the declared error or spec source', () => {
  const result = validateTier2Output({
    output: { ops: [{ op: 'rename_field', from: 'user_id', to: 'subscriber_ref' }], confidence: 0.9, evidence: [{ source: 'error', quote: 'server title' }] },
    sentText: 'server title', evidenceSources: { error: 'subscriber_ref is required', spec: 'server title' },
    observedNames: new Set(['user_id', 'subscriber_ref']), args: { user_id: 'u' }, tool,
  });
  assert.equal(result.reason, 'evidence_not_quoted');
});
