import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import { registryStore } from '../src/features/registry/store.js';
import { discover } from '../src/features/diagnoser/tier0-spec/index.js';
import { loadSpec, markSpecUntrusted } from '../src/features/diagnoser/tier0-spec/loader.js';
import { parseErrors } from '../src/features/classifier/index.js';

let testLock = Promise.resolve();
function test(name, fn) {
  nodeTest(name, async () => {
    const previous = testLock;
    let unlock;
    testLock = new Promise((resolve) => { unlock = resolve; });
    await previous;
    try { await fn(); } finally { unlock(); }
  });
}
test.after = nodeTest.after;

let toolCounter = 0;
function registerSpecTool(path = '/api/users/get', specUrl) {
  registryStore.reset();
  const apiId = `tier0-spec-test-${++toolCounter}`;
  const baseUrl = `https://api${toolCounter}.example.com`;
  registryStore.registerApi(apiId, {
    baseUrl,
    specUrl: specUrl ?? `${baseUrl}/openapi.json`,
    tools: [{
      name: 'get_user', method: 'POST', path,
      parameters: { type: 'object', properties: { user_id: { type: 'string' } }, required: ['user_id'] },
    }],
  });
  const current = registryStore.current(apiId, 'get_user');
  return { ...current, apiId, name: 'get_user' };
}

function mockSpec(schema, extensions = {}) {
  const spec = {
    openapi: '3.1.0',
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
    let specExcerpt = '';
    const proposal = await discover({ tool: registerSpecTool(), args: { user_id: '123' }, errors, onSpecExcerpt: (value) => { specExcerpt = value; } });
    assert.match(specExcerpt, /requestBody/);
    assert.deepEqual(proposal.ops, [{ op: 'add_field', path: 'region', source: { type: 'spec_default', value: 'IN' } }]);
    assert.equal(proposal.tier, 0);
    assert.ok(calls.length >= 1);
    assert.ok(calls.every((call) => call.method === 'GET'));
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

test('Tier 0 dereferences local request schemas and can derive a field rename', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => mockSpec({ $ref: '#/components/schemas/UpdateRequest' }, {
    components: { schemas: { UpdateRequest: { type: 'object', properties: { userId: { type: 'string' } }, required: ['userId'] } } },
  });
  try {
    const tool = registerSpecTool('/api/users/get');
    const errors = parseErrors({ detail: [
      { loc: ['body', 'userId'], type: 'value_error.missing', msg: 'field required' },
      { loc: ['body', 'user_id'], type: 'value_error.extra', msg: 'extra field' },
    ] }, 422);
    const proposal = await discover({ tool, args: { user_id: '123' }, errors });
    assert.equal(proposal.tier, 0);
    assert.deepEqual(proposal.ops, [{ op: 'rename_field', from: 'user_id', to: 'userId' }]);
  } finally { globalThis.fetch = originalFetch; }
});

test('Tier 0 candidate probe falls through quickly when registered spec is unavailable', async () => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async (url) => {
    requested.push(String(url));
    if (String(url).endsWith('/openapi.json')) return mockSpec({ type: 'object', properties: { region: { type: 'string', default: 'IN' } } });
    return new Response('', { status: 503 });
  };
  try {
    const tool = registerSpecTool('/api/users/get', `https://api${toolCounter + 1}.example.com/registered.json`);
    const errors = parseErrors({ detail: [{ loc: ['body', 'region'], type: 'value_error.missing', msg: 'field required' }] }, 422);
    const started = Date.now();
    const proposal = await discover({ tool, args: {}, errors });
    assert.ok(Date.now() - started < 500);
    assert.equal(proposal?.ops[0]?.source.value, 'IN');
    assert.ok(requested.some((url) => url.endsWith('/openapi.json')));
  } finally { globalThis.fetch = originalFetch; }
});

test('Tier 0 cache avoids a second spec fetch within its TTL', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return mockSpec({ type: 'object', properties: { region: { type: 'string', default: 'IN' } } }); };
  try {
    const tool = registerSpecTool();
    const errors = parseErrors({ detail: [{ loc: ['body', 'region'], type: 'value_error.missing', msg: 'field required' }] }, 422);
    await discover({ tool, args: {}, errors });
    const firstCalls = calls;
    await discover({ tool, args: {}, errors });
    assert.equal(calls, firstCalls);
  } finally { globalThis.fetch = originalFetch; }
});

test('Tier 0 hard-caps a spec probe when fetch ignores its abort signal', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => new Promise(() => {});
  try {
    const tool = registerSpecTool();
    const errors = parseErrors({ detail: [{ loc: ['body', 'region'], type: 'value_error.missing', msg: 'field required' }] }, 422);
    const started = Date.now();
    assert.equal(await discover({ tool, args: {}, errors }), null);
    assert.ok(Date.now() - started < 500);
  } finally { globalThis.fetch = originalFetch; }
});

test('Tier 0 marks a failed-replay spec untrusted through its cache TTL', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return mockSpec({ type: 'object', properties: { region: { type: 'string', default: 'IN' } } }); };
  try {
    const tool = registerSpecTool();
    const loaded = await loadSpec(tool);
    const firstCalls = calls;
    markSpecUntrusted({ url: loaded.url, fingerprint: loaded.fingerprint, urls: loaded.urls });
    assert.equal(await loadSpec(tool), null);
    assert.equal(calls, firstCalls, 'the matching cached probe set stays untrusted until its TTL expires');
  } finally { globalThis.fetch = originalFetch; }
});

test('Tier 0 derives the complete evidence-backed M5 request in one proposal', async () => {
  const originalFetch = globalThis.fetch;
  const tool = registerSpecTool();
  const spec = {
    openapi: '3.0.0',
    paths: {
      '/api/users/get': {
        post: {
          parameters: [{ in: 'header', name: 'X-Tenant', required: true, schema: { type: 'string' } }],
          requestBody: { content: { 'application/json': { schema: {
            type: 'object', properties: { target: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] } }, required: ['target'],
          } } } },
        },
      },
    },
  };
  globalThis.fetch = async () => new Response(JSON.stringify(spec), { status: 200 });
  try {
    const errors = parseErrors({ detail: [
      { loc: ['body', 'target'], type: 'value_error.missing', msg: 'field required' },
      { loc: ['body', 'user_id'], type: 'value_error.extra', msg: 'extra field' },
    ] }, 422);
    errors.unshift({ kind: 'missing_header', header: 'X-Tenant' });
    const proposal = await discover({ tool, args: { user_id: '123' }, errors, apiConfig: { credentials: { 'X-Tenant': { env: 'TENANT_ID' } } } });
    assert.deepEqual(proposal.ops.map(({ op }) => op), ['add_header', 'move_field', 'rename_field', 'coerce_type']);
  } finally { globalThis.fetch = originalFetch; }
});
