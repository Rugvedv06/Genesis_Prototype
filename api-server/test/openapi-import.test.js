import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DATABASE_URL = '';
process.env.ALLOW_LOCAL_UPSTREAMS = '1';
process.env.HEALR_DATA_DIR = mkdtempSync(join(tmpdir(), 'healr-import-test-'));
const dataDir = process.env.HEALR_DATA_DIR;

test('OpenAPI import preview produces tools from local refs without registering them', async () => {
  const { previewOpenApi } = await import('../src/features/apis/import/openapi-import.js');
  const spec = { openapi: '3.1.0', info: { title: 'Fixture', version: '1' }, servers: [{ url: 'https://api.example.test/v1' }],
    paths: { '/users/{id}': { get: { operationId: 'getUser', summary: 'Get user', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } } } } } },
    components: { schemas: { User: { type: 'object', properties: { id: { type: 'string' }, email: { type: 'string', format: 'email' } }, required: ['id', 'email'] } } } };
  const preview = previewOpenApi(spec);
  assert.equal(preview.tools.length, 0);
  assert.equal(preview.skipped[0].reason, 'unsupported_parameter_location');
  assert.match(preview.baseUrlSuggestion, /api\.example\.test\/v1$/);
  assert.ok(preview.specHash);
});

test('mock baseline OpenAPI produces supported body tools and reports operations outside executor scope', async () => {
  const [{ previewOpenApi }, { buildOpenApi }] = await Promise.all([
    import('../src/features/apis/import/openapi-import.js'), import('../../demo-server-and-client/server/src/mutations/openapi.js'),
  ]);
  const preview = previewOpenApi(buildOpenApi());
  assert.ok(preview.tools.some((tool) => tool.path === '/api/users/update-email'));
  assert.ok(preview.tools.some((tool) => tool.path === '/api/users/set-status'));
  assert.ok(preview.tools.some((item) => item.path === '/api/users/get'));
  const m5 = previewOpenApi(buildOpenApi('M5'));
  assert.ok(m5.skipped.some((item) => item.path === '/api/users/get' && item.reason === 'unsupported_parameter_location'));
});

test('OpenAPI import preview includes supported JSON body operations and response mappings', async () => {
  const { previewOpenApi } = await import('../src/features/apis/import/openapi-import.js');
  const spec = {
    openapi: '3.0.3', info: { title: 'Fixture', version: '1' }, servers: [{ url: 'https://api.example.test' }],
    paths: {
      '/users': {
        post: {
          operationId: 'create-user', summary: 'Create user',
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { email: { type: 'string', format: 'email' } }, required: ['email'] } } } },
          responses: { 201: { content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'integer' }, email: { type: 'string', format: 'email' } }, required: ['id'] } } } } },
        },
      },
    },
  };
  const preview = previewOpenApi(spec);
  assert.equal(preview.tools.length, 1);
  assert.equal(preview.tools[0].name, 'create_user');
  assert.equal(preview.tools[0].risk, 'medium');
  assert.equal(preview.tools[0].sideEffects, 'write');
  assert.deepEqual(preview.tools[0].parameters.required, ['email']);
  assert.equal(preview.tools[0].response.fields.id.path, 'id');
  assert.equal(preview.tools[0].response.fields.id.required, true);
});

<<<<<<< HEAD
=======
test('OpenAPI import carries an explicitly declared idempotency header into tool configuration', async () => {
  const { previewOpenApi } = await import('../src/features/apis/import/openapi-import.js');
  const operation = {
    operationId: 'create-payment',
    parameters: [{ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string' } }],
    requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { amount: { type: 'number' } } } } } },
    responses: { 201: { description: 'Created' } },
  };
  const preview = previewOpenApi({ openapi: '3.0.3', info: { title: 'Payments' }, paths: { '/payments': { post: operation } } });
  assert.equal(preview.tools.length, 1);
  assert.equal(preview.tools[0].idempotencyKeyHeader, 'Idempotency-Key');
  assert.equal(preview.tools[0].sideEffects, 'write');
});

>>>>>>> origin/main
test('OpenAPI importer rejects unsupported formats and malformed schemas safely', async () => {
  const { previewOpenApi } = await import('../src/features/apis/import/openapi-import.js');
  assert.throws(() => previewOpenApi({ swagger: '2.0', info: {}, paths: {} }), /Swagger 2\.0/);
  assert.throws(() => previewOpenApi('openapi: 3.0.0'), /JSON/);
  assert.throws(() => previewOpenApi({ openapi: '3.0.3', paths: { '/x': { post: { requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Loop' } } } } } } }, components: { schemas: { Loop: { $ref: '#/components/schemas/Loop' } } } }), /cyclic_ref/);
});

test('OpenAPI importer enforces the byte and operation caps and makes names unique', async () => {
  const { previewOpenApi } = await import('../src/features/apis/import/openapi-import.js');
  const operation = { requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' } } } } } }, responses: {} };
  const spec = { openapi: '3.0.3', paths: { '/one': { post: { ...operation, operationId: 'same' } }, '/two': { post: { ...operation, operationId: 'same' } } } };
  const preview = previewOpenApi(spec);
  assert.deepEqual(preview.tools.map((tool) => tool.name), ['same', 'same_2']);
  assert.equal(previewOpenApi({ openapi: '3.0.3', paths: { '/x': { post: operation } } }).tools.length, 1);
  assert.throws(() => previewOpenApi(' '.repeat(1_000_001)), /1 MB/);
  const many = { openapi: '3.0.3', paths: Object.fromEntries(Array.from({ length: 201 }, (_, index) => [`/items${index}`, { post: { ...operation, operationId: `create${index}` } }])) };
  const capped = previewOpenApi(many);
  assert.equal(capped.tools.length, 200);
  assert.ok(capped.warnings.some((warning) => warning.includes('Operation cap')));
});

test('URL import is bounded even if fetch ignores abort and refuses redirects and oversized bodies', async () => {
  const { previewOpenApiUrl } = await import('../src/features/apis/import/openapi-import.js');
  await assert.rejects(previewOpenApiUrl('https://example.com/spec.json', { timeoutMs: 50, fetchImpl: () => new Promise(() => {}) }), /time limit/);
  await assert.rejects(previewOpenApiUrl('https://example.com/spec.json', { fetchImpl: async () => new Response('', { status: 302, headers: { location: 'http://127.0.0.1/' } }) }), /redirects are not followed/);
  await assert.rejects(previewOpenApiUrl('https://example.com/spec.json', { fetchImpl: async () => new Response(' '.repeat(1_000_001), { headers: { 'content-type': 'application/json' } }) }), /1 MB/);
});

test('an imported API heals an M1 rename through Tier 0 and invokes successfully', async () => {
  const [{ previewOpenApi }, { registryStore }, { invoke }] = await Promise.all([
    import('../src/features/apis/import/openapi-import.js'), import('../src/features/registry/store.js'), import('../src/features/executor/invoke.js'),
  ]);
  const baseline = { openapi: '3.0.3', info: { title: 'M1 fixture', version: '1' }, paths: { '/users': { post: {
    operationId: 'getUser', requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { user_id: { type: 'string' } }, required: ['user_id'] } } } },
    responses: { 200: { content: { 'application/json': { schema: { type: 'object', properties: { result: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } }, required: ['result'] } } } } },
  } } } };
  const active = structuredClone(baseline);
  const bodySchema = active.paths['/users'].post.requestBody.content['application/json'].schema;
  bodySchema.properties = { userId: { type: 'string' } }; bodySchema.required = ['userId'];
  const preview = previewOpenApi(baseline);
  assert.equal(preview.tools[0].response.fields.id.required, true);
<<<<<<< HEAD
=======
  // This POST endpoint is semantically read-only even though OpenAPI uses POST.
  preview.tools[0].sideEffects = 'none';
>>>>>>> origin/main
  registryStore.reset();
  registryStore.registerApi('imported-m1', { baseUrl: 'https://import.example.test', specUrl: 'https://import.example.test/openapi.json', healing: { enabled: true, maxRounds: 3 }, tools: preview.tools });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    if (url.pathname === '/openapi.json') return Response.json(active);
    const request = JSON.parse(init.body);
    if (request.userId === '123') return Response.json({ result: { id: '123' } });
    return Response.json({ detail: [
      { loc: ['body', 'userId'], msg: 'field required', type: 'value_error.missing' },
      { loc: ['body', 'user_id'], msg: 'extra fields not permitted', type: 'value_error.extra' },
    ] }, { status: 422 });
  };
  try {
    const result = await invoke({ apiId: 'imported-m1', toolName: 'getUser', args: { user_id: '123' } });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.meta.tier, 0);
    assert.equal(result.meta.rounds, 1);
    assert.deepEqual(result.meta.ops.map((op) => op.op), ['rename_field']);
  } finally { globalThis.fetch = originalFetch; registryStore.reset(); }
});

test.after(() => rmSync(dataDir, { recursive: true, force: true }));
