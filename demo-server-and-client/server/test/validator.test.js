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

test('M1-M5, M7-M9 error-stage goldens are style-specific but canonically equivalent', () => {
  const privacyValue = 'private-golden-value-7f9c';
  const privateTenantCredential = 'private-x-tenant-sentinel-481a';
  const privateAuthCredential = 'Bearer private-auth-sentinel-92bd';
  const scenarios = [
    { id: 'M1', body: { user_id: privacyValue }, headers: {}, status: 422, errors: [
      { loc: ['body', 'userId'], msg: 'field required', type: 'value_error.missing' },
      { loc: ['body', 'user_id'], msg: 'extra fields not permitted', type: 'value_error.extra' },
    ] },
    { id: 'M2', body: { user_id: privacyValue }, headers: {}, status: 422, errors: [
      { loc: ['body', 'user_id'], msg: 'value is not a valid integer', type: 'type_error.integer' },
    ] },
    { id: 'M3', body: { user_id: privacyValue }, headers: {}, status: 422, errors: [
      { loc: ['body', 'target'], msg: 'field required', type: 'value_error.missing' },
      { loc: ['body', 'user_id'], msg: 'extra fields not permitted', type: 'value_error.extra' },
    ] },
    { id: 'M4', body: { user_id: privacyValue }, headers: {}, status: 400, header: 'X-API-Version', allowed: ['2'] },
    { id: 'M5', body: { user_id: privacyValue }, headers: {}, status: 400, header: 'X-Tenant' },
    { id: 'M5', body: { user_id: privacyValue }, headers: { 'x-tenant': privateTenantCredential }, status: 422, errors: [
      { loc: ['body', 'target'], msg: 'field required', type: 'value_error.missing' },
      { loc: ['body', 'user_id'], msg: 'extra fields not permitted', type: 'value_error.extra' },
    ] },
    { id: 'M5', body: { target: { user_id: privacyValue } }, headers: { 'x-tenant': privateTenantCredential }, status: 422, errors: [
      { loc: ['body', 'target', 'id'], msg: 'field required', type: 'value_error.missing' },
      { loc: ['body', 'target', 'user_id'], msg: 'extra fields not permitted', type: 'value_error.extra' },
    ] },
    { id: 'M5', body: { target: { id: privacyValue } }, headers: { 'x-tenant': privateTenantCredential }, status: 422, errors: [
      { loc: ['body', 'target', 'id'], msg: 'value is not a valid integer', type: 'type_error.integer' },
    ] },
    { id: 'M7', body: { user_id: privacyValue }, headers: {}, status: 422, errors: [
      { loc: ['body', 'region'], msg: 'field required', type: 'value_error.missing' },
    ] },
    { id: 'M8', body: { user_id: privacyValue, status: 'active' }, headers: {}, status: 422, errors: [
      { loc: ['body', 'status'], msg: 'Input should be ENABLED or DISABLED', type: 'type_error.enum', ctx: { enum_values: ['ENABLED', 'DISABLED'] } },
    ] },
    { id: 'M9', body: { user_id: privacyValue, email: 'private@example.invalid' }, headers: {}, status: 401, auth: true },
    { id: 'M9', body: { user_id: privacyValue, email: 'private@example.invalid' }, headers: { authorization: privateAuthCredential }, status: 422, errors: [
      { loc: ['body', 'approval_code'], msg: 'field required', type: 'value_error.missing' },
    ] },
  ];
  const styleTypes = {
    'pydantic-v1': { 'value_error.missing': 'value_error.missing', 'value_error.extra': 'value_error.extra', 'type_error.integer': 'type_error.integer', 'type_error.enum': 'type_error.enum' },
    'pydantic-v2': { 'value_error.missing': 'missing', 'value_error.extra': 'extra_forbidden', 'type_error.integer': 'int_type', 'type_error.enum': 'enum' },
    'problem-json': { 'value_error.missing': 'value_error.missing', 'value_error.extra': 'value_error.extra', 'type_error.integer': 'type_error.integer', 'type_error.enum': 'type_error.enum' },
  };
  const canonicalResults = new Map();

  for (const style of Object.keys(styleTypes)) {
    const canonicalByStage = [];
    for (const scenario of scenarios) {
      const failure = validateRequest(get(scenario.id), scenario.body, scenario.headers, style);
      assert.equal(failure.status, scenario.status, `${scenario.id} status (${style})`);
      const types = styleTypes[style];
      if (scenario.auth) {
        const expectedBody = style === 'pydantic-v1'
          ? { error: 'missing_auth', scheme: 'Bearer', header: 'Authorization' }
          : style === 'pydantic-v2'
            ? { detail: 'Not authenticated', error: 'missing_auth', scheme: 'Bearer', header: 'Authorization' }
            : { type: 'https://api.example/problems/authentication-error', title: 'Unauthorized', status: 401, detail: 'Authentication required', errors: [], error: 'missing_auth', scheme: 'Bearer', header: 'Authorization' };
        assert.deepEqual(failure.body, expectedBody, `${scenario.id} auth body (${style})`);
      } else if (scenario.header) {
        const expectedBody = style === 'pydantic-v1'
          ? { error: 'missing_header', header: scenario.header, ...(scenario.allowed ? { allowed: scenario.allowed } : {}) }
          : style === 'pydantic-v2'
            ? { detail: [{ loc: ['header', scenario.header.toLowerCase()], msg: 'Field required', type: 'missing', ...(scenario.allowed ? { ctx: { allowed_values: scenario.allowed } } : { ctx: {} }) }] }
            : { type: 'https://api.example/problems/validation-error', title: 'Bad Request', status: 400, detail: 'Request validation failed', errors: [{ loc: ['header', scenario.header.toLowerCase()], msg: 'Field required', type: 'missing', ...(scenario.allowed ? { ctx: { allowed_values: scenario.allowed } } : { ctx: {} }) }] };
        assert.deepEqual(failure.body, expectedBody, `${scenario.id} header body (${style})`);
      } else {
        const wireErrors = scenario.errors.map((error) => ({
          ...error,
          type: types[error.type],
        }));
        const expectedBody = style === 'pydantic-v1'
          ? { detail: wireErrors }
          : style === 'pydantic-v2'
            ? { detail: wireErrors }
            : { type: 'https://api.example/problems/validation-error', title: 'Unprocessable Entity', status: 422, detail: 'Request validation failed', errors: wireErrors };
        assert.deepEqual(failure.body, expectedBody, `${scenario.id} exact error body (${style})`);
      }

      const parsed = parseErrors(failure.body, failure.status).map((error) => error.kind === 'missing_header'
        ? {
            kind: error.kind,
            path: [],
            expected: null,
            received: null,
            allowed: error.allowed ?? error.expected,
            header: String(error.header ?? '').toLowerCase(),
          }
        : {
            kind: error.kind,
            path: error.path,
            expected: error.expected,
            received: error.received,
            allowed: error.allowed,
            header: error.header,
          });
      canonicalByStage.push(parsed);
      assert.equal(JSON.stringify(failure.body).includes(privacyValue), false, `${scenario.id} leaks caller value (${style})`);
      assert.equal(JSON.stringify(failure.body).includes('private@example.invalid'), false, `${scenario.id} leaks caller email (${style})`);
      assert.equal(JSON.stringify(failure.body).includes(privateTenantCredential), false, `${scenario.id} leaks tenant credential (${style})`);
      assert.equal(JSON.stringify(failure.body).includes(privateAuthCredential), false, `${scenario.id} leaks bearer credential (${style})`);
    }
    canonicalResults.set(style, canonicalByStage);
  }

  assert.deepEqual(canonicalResults.get('pydantic-v2'), canonicalResults.get('pydantic-v1'));
  assert.deepEqual(canonicalResults.get('problem-json'), canonicalResults.get('pydantic-v1'));
});

test('unrelated 401 required-header errors preserve their declared meaning in every style', () => {
  const mutation = structuredClone(get('M4'));
  mutation.headers[0].status = 401;
  mutation.headers[0].error = { error: 'missing_header', header: 'X-Required-Token', allowed: ['service'] };

  const v1 = validateRequest(mutation, {}, {}, 'pydantic-v1');
  const v2 = validateRequest(mutation, {}, {}, 'pydantic-v2');
  const problem = validateRequest(mutation, {}, {}, 'problem-json');
  assert.equal(v1.status, 401);
  assert.deepEqual(v1.body, { error: 'missing_header', header: 'X-Required-Token', allowed: ['service'] });
  assert.deepEqual(v2.body, {
    detail: [{ loc: ['header', 'x-required-token'], msg: 'Field required', type: 'missing', ctx: { allowed_values: ['service'] } }],
  });
  assert.deepEqual(problem.body, {
    type: 'https://api.example/problems/validation-error',
    title: 'Unprocessable Entity',
    status: 401,
    detail: 'Request validation failed',
    errors: [{ loc: ['header', 'x-required-token'], msg: 'Field required', type: 'missing', ctx: { allowed_values: ['service'] } }],
  });
  assert.equal(v2.body.error, undefined, 'a non-auth header failure must not be reformatted as missing_auth');
  assert.equal(problem.body.error, undefined, 'problem response keeps the declared missing-header error shape');
});
