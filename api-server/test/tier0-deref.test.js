import test from 'node:test';
import assert from 'node:assert/strict';
import { dereferenceLocalRefs } from '../src/features/diagnoser/tier0-spec/deref.js';

test('Tier 0 resolves local refs, preserving nested pointers', () => {
  const root = { components: { schemas: { Body: { type: 'object', properties: { nested: { $ref: '#/components/schemas/Leaf' } } }, Leaf: { type: 'string' } } } };
  assert.deepEqual(dereferenceLocalRefs({ $ref: '#/components/schemas/Body' }, root), { type: 'object', properties: { nested: { type: 'string' } } });
});

test('Tier 0 rejects remote, cyclic, excessive-depth, and oversized ref graphs', () => {
  assert.throws(() => dereferenceLocalRefs({ $ref: 'https://example.com/schema.json' }, {}), /remote_ref_not_allowed/);
  const cyclic = { components: { schemas: { A: { $ref: '#/components/schemas/B' }, B: { $ref: '#/components/schemas/A' } } } };
  assert.throws(() => dereferenceLocalRefs({ $ref: '#/components/schemas/A' }, cyclic), /cyclic_ref/);
  let deep = { type: 'string' };
  for (let i = 0; i < 30; i += 1) deep = { items: deep };
  assert.throws(() => dereferenceLocalRefs(deep), /spec_depth_limit/);
  let wide = {};
  for (let i = 0; i < 10_001; i += 1) wide[`p${i}`] = { type: 'string' };
  assert.throws(() => dereferenceLocalRefs(wide), /spec_node_limit/);
});
