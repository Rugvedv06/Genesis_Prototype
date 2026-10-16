// Phase 1 Track C: golden tests for the mock mutation validator (§6 Phase 1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRequest, applyResponseMutation } from '../src/mutations/validator.js';
import { get, ids } from '../src/mutations/catalogue.js';
import { classify, parseErrors } from '../../../api-server/src/features/classifier/index.js';

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

test('M6 and M10 response mutations move the field while retaining the original truth source', () => {
  const canonical = { result: { id: '123', name: 'Asha Rao', email: 'asha@example.com' } };
  const nested = applyResponseMutation(canonical, get('M6').responseOps);
  const renamed = applyResponseMutation(canonical, get('M10').responseOps);
  assert.equal(nested.result.data.profile.name, 'Asha Rao');
  assert.equal(nested.result.name, undefined);
  assert.equal(renamed.result.full_name, 'Asha Rao');
  assert.equal(renamed.result.name, undefined);
  assert.equal(canonical.result.name, 'Asha Rao', 'mutation must not change the canonical truth object');
  assert.deepEqual(get('M6').expectedOps.map((op) => op.op), ['remap_response_path']);
  assert.deepEqual(get('M10').expectedOps.map((op) => op.op), ['remap_response_path']);
});

test('mutation catalogue exposes M6 and M10 response mutation metadata', () => {
  assert.ok(ids().includes('M6'));
  assert.ok(ids().includes('M10'));
  for (const id of ['M6', 'M10']) {
    const mutation = get(id);
    assert.equal(mutation.category, 'response');
    assert.equal(mutation.expected, 'heal');
    assert.equal(mutation.route.path, '/api/users/get');
  }
});

test('M1, M2, M3, M4, M7, and M8 fixtures emit the expected canonical errors', () => {
  const cases = [
    ['M1', { user_id: '123' }, {}, 422, ['value_error.missing', 'value_error.extra']],
    ['M2', { user_id: '123' }, {}, 422, ['type_error.integer']],
    ['M3', { user_id: '123' }, {}, 422, ['value_error.missing', 'value_error.extra']],
    ['M4', { user_id: '123' }, {}, 400, undefined],
    ['M7', { user_id: '123' }, {}, 422, ['value_error.missing']],
    ['M8', { user_id: '123', status: 'active' }, {}, 422, ['type_error.enum']],
  ];
  for (const [id, body, headers, status, types] of cases) {
    const failure = validateRequest(get(id), body, headers);
    assert.equal(failure.status, status, `${id} status`);
    if (types) assert.deepEqual(failure.body.detail.map((error) => error.type), types, `${id} errors`);
  }
});

test('shared validator emits v1, v2, and problem-json without leaking caller values', () => {
  const mutation = get('M1');
  const v1 = validateRequest(mutation, { user_id: 'private-caller-value' }, {}, 'pydantic-v1');
  const v2 = validateRequest(mutation, { user_id: 'private-caller-value' }, {}, 'pydantic-v2');
  const problem = validateRequest(mutation, { user_id: 'private-caller-value' }, {}, 'problem-json');
  assert.equal(v1.body.detail[0].type, 'value_error.missing');
  assert.equal(v2.body.detail[1].type, 'extra_forbidden');
  assert.equal(problem.body.status, 422);
  assert.ok(Array.isArray(problem.body.errors));
  assert.equal(JSON.stringify([v1, v2, problem]).includes('private-caller-value'), false);
});

test('OpenAPI describes the active mutation and exposes documented M7/M8 values', async () => {
  const { buildOpenApi } = await import('../src/mutations/openapi.js');
  const m7 = buildOpenApi('M7');
  const region = m7.paths['/api/users/get'].post.requestBody.content['application/json'].schema.properties.region;
  assert.equal(region.default, 'IN');
  assert.equal(m7['x-healr-active-mutation'], 'M7');
  const m8 = buildOpenApi('M8').paths['/api/users/set-status'].post.requestBody.content['application/json'].schema.properties.status;
  assert.deepEqual(m8.enum, ['ENABLED', 'DISABLED']);
  assert.equal(m8['x-healr-enum-aliases'].active, 'ENABLED');
});

test('M9 auth and approval-code variants keep distinct statuses in all error styles', () => {
  for (const style of ['pydantic-v1', 'pydantic-v2', 'problem-json']) {
    const auth = validateRequest(get('M9'), { user_id: '123', email: 'asha@example.com' }, {}, style);
    assert.equal(auth.status, 401, `${style} missing auth`);
    const approval = validateRequest(get('M9'), { user_id: '123', email: 'asha@example.com' }, { authorization: 'Bearer configured' }, style);
    assert.equal(approval.status, 422, `${style} missing approval code`);
  }
});

test('request mutations retain their semantic classification across all error formats', () => {
  const scenarios = [
    ['M1', { user_id: '123' }, {}, 'validation4xx'],
    ['M2', { user_id: '123' }, {}, 'validation4xx'],
    ['M3', { user_id: '123' }, {}, 'validation4xx'],
    ['M4', { user_id: '123' }, {}, 'header4xx'],
    ['M5', { user_id: '123' }, {}, 'header4xx'],
    ['M7', { user_id: '123' }, {}, 'validation4xx'],
    ['M8', { user_id: '123', status: 'active' }, {}, 'validation4xx'],
    ['M9', { user_id: '123', email: 'asha@example.com' }, {}, 'auth4xx'],
  ];
  for (const style of ['pydantic-v1', 'pydantic-v2', 'problem-json']) {
    for (const [id, body, headers, expected] of scenarios) {
      const failure = validateRequest(get(id), body, headers, style);
      assert.equal(classify(parseErrors(failure.body, failure.status), failure.status), expected, `${id} ${style}`);
    }
  }
});
