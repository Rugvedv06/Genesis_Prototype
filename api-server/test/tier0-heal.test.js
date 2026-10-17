import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATABASE_URL = '';
process.env.ALLOW_LOCAL_UPSTREAMS = '1';
process.env.HEALR_DATA_DIR = mkdtempSync(join(tmpdir(), 'healr-tier0-m5-'));
const dataDir = process.env.HEALR_DATA_DIR;
const [{ registryStore }, { invoke }] = await Promise.all([
  import('../src/features/registry/store.js'), import('../src/features/executor/invoke.js'),
]);

test('active M5 OpenAPI heals in one replay with the same four operations', async () => {
  const originalFetch = globalThis.fetch;
  registryStore.reset();
  registryStore.registerApi('tier0-m5-active', {
    baseUrl: 'http://localhost:5001', specUrl: 'https://tier0-m5.example.com/openapi.json',
    credentials: { 'X-Tenant': { env: 'TENANT_ID' } },
    tools: [{ name: 'get_user', method: 'POST', path: '/api/users/get', sideEffects: 'read', risk: 'low',
      parameters: { type: 'object', properties: { user_id: { type: 'string' } }, required: ['user_id'] },
      response: { map: { user_id: 'result.id' }, schema: { type: 'object', properties: { user_id: { type: 'string' } }, required: ['user_id'] } } }],
  });
  process.env.TENANT_ID = 'tenant-test';
  let upstreamCalls = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('openapi.json') || String(url).includes('swagger.json')) {
      const openapi = {
        openapi: '3.0.0',
        paths: { '/api/users/get': { post: {
          parameters: [{ in: 'header', name: 'X-Tenant', required: true, schema: { type: 'string' } }],
          requestBody: { content: { 'application/json': { schema: {
            type: 'object', properties: { target: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] } }, required: ['target'],
          } } } },
        } } },
      };
      return new Response(JSON.stringify(openapi), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    upstreamCalls += 1;
    if (!init.headers['X-Tenant']) return new Response(JSON.stringify({ error: 'missing_header', header: 'X-Tenant' }), { status: 400 });
    assert.equal(init.headers['X-Tenant'], 'tenant-test');
    assert.deepEqual(JSON.parse(init.body), { target: { id: 123 } });
    return new Response(JSON.stringify({ result: { id: '123' } }), { status: 200 });
  };
  try {
    const result = await invoke({ apiId: 'tier0-m5-active', toolName: 'get_user', args: { user_id: '123' } });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.meta.tier, 0);
    assert.equal(result.meta.rounds, 1, JSON.stringify({ meta: result.meta, upstreamCalls }));
    assert.deepEqual(result.meta.ops.map(({ op }) => op), ['add_header', 'move_field', 'rename_field', 'coerce_type']);
    assert.equal(upstreamCalls, 2, 'one initial failure and one verified replay');
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.TENANT_ID;
    registryStore.reset();
  }
});

test('Tier 0 replay mismatch marks its spec untrusted and continues at Tier 1', async () => {
  const originalFetch = globalThis.fetch;
  registryStore.reset();
  registryStore.registerApi('tier0-stale-replay', {
    baseUrl: 'http://localhost:5002', specUrl: 'https://stale-replay.example.com/openapi.json',
    healing: { enabled: true, maxRounds: 4 },
    tools: [{ name: 'lookup', method: 'POST', path: '/api/users/get', sideEffects: 'none',
      parameters: { type: 'object', properties: { user_id: { type: 'string' } }, required: ['user_id'] },
      response: { fields: { id: { path: 'result.id', type: 'string' } } } }],
  });
  let specFetches = 0;
  let upstreamCalls = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('openapi.json') || String(url).includes('swagger.json')) {
      specFetches += 1;
      if (String(url).startsWith('https://stale-replay.example.com/')) {
        return new Response(JSON.stringify({ openapi: '3.0.0', paths: { '/api/users/get': { post: {
          requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { userId: { type: 'string' } }, required: ['userId'] } } } },
        } } } }), { status: 200 });
      }
      return new Response('', { status: 404 });
    }
    upstreamCalls += 1;
    const body = JSON.parse(init.body);
    if (body.user_id) return new Response(JSON.stringify({ detail: [
      { loc: ['body', 'userId'], type: 'value_error.missing', msg: 'required' },
      { loc: ['body', 'user_id'], type: 'value_error.extra', msg: 'extra' },
    ] }), { status: 422 });
    if (body.userId) return new Response(JSON.stringify({ message: 'the spec proposal did not verify' }), { status: 503 });
    return new Response(JSON.stringify({ result: { id: body.account_id } }), { status: 200 });
  };
  try {
    const result = await invoke({ apiId: 'tier0-stale-replay', toolName: 'lookup', args: { user_id: '123' } });
    assert.equal(result.ok, false);
    assert.equal(result.error.details.reason, 'no_diagnosis');
    assert.equal(result.error.retryable, false);
    assert.equal(upstreamCalls, 2);
    assert.equal(specFetches, 3, 'only the first diagnose probes the three candidate URL sources');
  } finally { globalThis.fetch = originalFetch; registryStore.reset(); }
});

test.after(() => rmSync(dataDir, { recursive: true, force: true }));
