// Phase 1 Track C: golden tests for the mock mutation validator (§6 Phase 1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRequest } from '../src/mutations/validator.js';
import { get } from '../src/mutations/catalogue.js';

const M5 = get('M5');

test('M5: clean v1 request passes (no mutation active)', () => {
  assert.strictEqual(validateRequest(null, { user_id: '123' }, {}), null);
});

test('M5: missing X-Tenant header returns 400 header error', () => {
  const violated = validateRequest(M5, { user_id: '123' }, {});
  assert.ok(violated);
  assert.strictEqual(violated.status, 400);
  assert.strictEqual(violated.body.error, 'missing_header');
  assert.strictEqual(violated.body.header, 'X-Tenant');
});

test('M5: header present, pre-wrap body returns layered 422', () => {
  const headers = { 'x-tenant': 'demo-tenant-01' };
  const violated = validateRequest(M5, { user_id: '123' }, headers);
  assert.ok(violated);
  assert.strictEqual(violated.status, 422);
  const types = violated.body.detail.map((d) => d.type);
  assert.ok(types.includes('value_error.missing'), 'expected missing');
  assert.ok(types.includes('value_error.extra'), 'expected extra');
});

test('M5: wrapped body with target.user_id returns next layer 422', () => {
  const headers = { 'x-tenant': 'demo-tenant-01' };
  const violated = validateRequest(M5, { target: { user_id: '123' } }, headers);
  assert.ok(violated);
  assert.strictEqual(violated.status, 422);
  const locs = violated.body.detail.map((d) => d.loc.join('.'));
  assert.ok(locs.includes('body.target.id'), 'expected target.id missing');
  assert.ok(locs.includes('body.target.user_id'), 'expected target.user_id extra');
});

test('M5: fully satisfied request returns null (200)', () => {
  const headers = { 'x-tenant': 'demo-tenant-01' };
  const body = { target: { id: 123 } };
  assert.strictEqual(validateRequest(M5, body, headers), null);
});

test('M5: non-integer target.id returns type error', () => {
  const headers = { 'x-tenant': 'demo-tenant-01' };
  const violated = validateRequest(M5, { target: { id: 'abc' } }, headers);
  assert.ok(violated);
  assert.strictEqual(violated.status, 422);
  const types = violated.body.detail.map((d) => d.type);
  assert.ok(types.includes('type_error.integer'), 'expected type_error.integer');
});
