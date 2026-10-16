import test from 'node:test';
import assert from 'node:assert/strict';
import { registryStore } from '../src/features/registry/store.js';
import { discover } from '../src/features/diagnoser/tier0-spec/index.js';
import { parseErrors } from '../src/features/classifier/index.js';

function registerSpecTool(path = '/api/users/get') {
  registryStore.reset();
  registryStore.registerApi('tier0-spec-test', {
    baseUrl: 'https://api.example.com',
    specUrl: 'https://api.example.com/openapi.json',
    tools: [{
      name: 'get_user', method: 'POST', path,
      parameters: { type: 'object', properties: { user_id: { type: 'string' } }, required: ['user_id'] },
    }],
  });
  const current = registryStore.current('tier0-spec-test', 'get_user');
  return { ...current, apiId: 'tier0-spec-test', name: 'get_user' };
}

function mockSpec(schema, extensions = {}) {
  const spec = {
    ...extensions,
    paths: {
      '/api/users/get': {
        post: {
          requestBody: {
            content: { 'application/json': { schema } },
          },
        },
      },
    },
  };
  return new Response(JSON.stringify(spec), { status: 200, headers: { 'content-type': 'application/json' } });
}

test('Tier 0 proposes only an explicit default from the active operation spec', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), method: options.method });
    return mockSpec({ type: 'object', properties: { region: { type: 'string', default: 'IN' } } });
  };
  try {
    const errors = parseErrors({ detail: [{ loc: ['body', 'region'], type: 'value_error.missing', msg: 'field required' }] }, 422);
    const proposal = await discover({ tool: registerSpecTool(), args: { user_id: '123' }, errors });
    assert.deepEqual(proposal.ops, [{ op: 'add_field', path: 'region', source: { type: 'spec_default', value: 'IN' } }]);
    assert.equal(proposal.tier, 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'GET');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Tier 0 applies only a declared alias that is also in the documented enum', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => mockSpec({ type: 'object', properties: {
      status: { type: 'string', enum: ['ENABLED', 'DISABLED'], 'x-healr-enum-aliases': { active: 'ENABLED', inactive: 'DISABLED' } },
  } });
  try {
    const tool = registerSpecTool();
    const errors = parseErrors({ detail: [{
      loc: ['body', 'status'], type: 'type_error.enum', msg: 'invalid enum',
      ctx: { enum_values: ['ENABLED', 'DISABLED'] },
    }] }, 422);
    const proposal = await discover({ tool, args: { status: 'active' }, errors });
    assert.deepEqual(proposal.ops, [{ op: 'set_enum_map', path: 'status', map: { active: 'ENABLED' } }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Tier 0 refuses stale specs and missing defaults', async () => {
  const originalFetch = globalThis.fetch;
  const errors = parseErrors({ detail: [{ loc: ['body', 'region'], type: 'value_error.missing', msg: 'field required' }] }, 422);
  try {
    const tool = registerSpecTool();
    globalThis.fetch = async () => mockSpec({}, { 'x-healr-spec-stale': true });
    assert.equal(await discover({ tool, args: { user_id: '123' }, errors }), null);
    globalThis.fetch = async () => mockSpec({ properties: { region: { type: 'string' } } });
    assert.equal(await discover({ tool, args: { user_id: '123' }, errors }), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
