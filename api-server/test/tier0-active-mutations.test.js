import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DATABASE_URL = '';
process.env.ALLOW_LOCAL_UPSTREAMS = '1';
process.env.HEALR_DATA_DIR = mkdtempSync(join(tmpdir(), 'healr-tier0-active-'));
const dataDir = process.env.HEALR_DATA_DIR;
const [{ registryStore }, { invoke }] = await Promise.all([
  import('../src/features/registry/store.js'), import('../src/features/executor/invoke.js'),
]);

const cases = [
  { id: 'M1', schema: { type: 'object', properties: { userId: { type: 'string' } }, required: ['userId'] }, errors: [{ loc: ['body', 'userId'], type: 'value_error.missing', msg: 'required' }, { loc: ['body', 'user_id'], type: 'value_error.extra', msg: 'extra' }], expected: ['rename_field'] },
  { id: 'M2', schema: { type: 'object', properties: { user_id: { type: 'integer' } }, required: ['user_id'] }, errors: [{ loc: ['body', 'user_id'], type: 'type_error.integer', msg: 'must be integer' }], expected: ['coerce_type'] },
  { id: 'M3', schema: { type: 'object', properties: { target: { type: 'object', properties: { user_id: { type: 'string' } }, required: ['user_id'] } }, required: ['target'] }, errors: [{ loc: ['body', 'target'], type: 'value_error.missing', msg: 'required' }, { loc: ['body', 'user_id'], type: 'value_error.extra', msg: 'extra' }], expected: ['move_field'] },
  { id: 'M4', schema: { type: 'object', properties: { user_id: { type: 'string' } }, required: ['user_id'] }, parameters: [{ in: 'header', name: 'X-API-Version', required: true, schema: { type: 'string', enum: ['2'] } }], headerError: true, expected: ['add_header'] },
  { id: 'M5', schema: { type: 'object', properties: { target: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] } }, required: ['target'] }, parameters: [{ in: 'header', name: 'X-Tenant', required: true, schema: { type: 'string' } }], credentials: { 'X-Tenant': { env: 'TENANT_ID' } }, errors: [{ loc: ['body', 'target'], type: 'value_error.missing', msg: 'required' }, { loc: ['body', 'user_id'], type: 'value_error.extra', msg: 'extra' }], headerError: true, expected: ['add_header', 'move_field', 'rename_field', 'coerce_type'] },
  { id: 'M7', schema: { type: 'object', properties: { user_id: { type: 'string' }, region: { type: 'string', default: 'IN' } }, required: ['user_id', 'region'] }, errors: [{ loc: ['body', 'region'], type: 'value_error.missing', msg: 'required' }], expected: ['add_field'] },
];

test('active M1-M5 and M7 specs derive one-round Tier 0 mutations', async () => {
  const originalFetch = globalThis.fetch;
  process.env.TENANT_ID = 'tenant-m5';
  try {
    for (const item of cases) {
      registryStore.reset();
      const apiId = `tier0-${item.id}`;
      const specUrl = `https://${item.id.toLowerCase()}.example.com/openapi.json`;
      registryStore.registerApi(apiId, {
        baseUrl: 'http://localhost:5001', specUrl, credentials: item.credentials,
        healing: { enabled: true, maxRounds: 3 },
        tools: [{ name: 'get_user', method: 'POST', path: '/api/users/get', sideEffects: 'none', risk: 'low',
          parameters: { type: 'object', properties: { user_id: { type: 'string' } }, required: ['user_id'] },
          response: { fields: { id: { path: 'result.id', type: 'string' } } } }],
      });
      const openapi = { openapi: '3.0.0', paths: { '/api/users/get': { post: {
        ...(item.parameters ? { parameters: item.parameters } : {}),
        requestBody: { content: { 'application/json': { schema: item.schema } } },
      } } } };
      globalThis.fetch = async (url, init) => {
        if (String(url).endsWith('/openapi.json') || String(url).endsWith('/swagger.json')) return new Response(JSON.stringify(openapi), { status: 200 });
        const body = JSON.parse(init.body);
        const valid = item.id === 'M1' ? body.userId === '123'
          : item.id === 'M2' ? body.user_id === 123
            : item.id === 'M3' ? body.target?.user_id === '123'
              : item.id === 'M4' ? init.headers['X-API-Version'] === '2'
                : item.id === 'M5' ? init.headers['X-Tenant'] === 'tenant-m5' && body.target?.id === 123
                  : body.user_id === '123' && body.region === 'IN';
        if (valid) return new Response(JSON.stringify({ result: { id: String(body.user_id ?? body.userId ?? body.target?.id ?? body.target?.user_id ?? '123') } }), { status: 200 });
        if (item.headerError) return new Response(JSON.stringify({ error: 'missing_header', header: item.id === 'M4' ? 'X-API-Version' : 'X-Tenant' }), { status: 400 });
        return new Response(JSON.stringify({ detail: item.errors }), { status: 422 });
      };
      const result = await invoke({ apiId, toolName: 'get_user', args: { user_id: '123' } });
      assert.equal(result.ok, true, `${item.id}: ${JSON.stringify(result.error)}`);
      assert.equal(result.meta.tier, 0, item.id);
      assert.equal(result.meta.rounds, 1, item.id);
      assert.deepEqual(result.meta.ops.map(({ op }) => op), item.expected, item.id);
    }
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.TENANT_ID;
    registryStore.reset();
  }
});

test.after(() => rmSync(dataDir, { recursive: true, force: true }));
