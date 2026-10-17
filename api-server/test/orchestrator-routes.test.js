import { test as nodeTest, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DATABASE_URL = '';
process.env.HEALR_DATA_DIR = mkdtempSync(join(tmpdir(), 'healr-agent-routes-'));
const dataDir = process.env.HEALR_DATA_DIR;
const [{ default: express }, { apisRoutes }, { registryStore }, { cfg }, { activeRunCount }] = await Promise.all([
  import('express'), import('../src/features/apis/routes.js'), import('../src/features/registry/store.js'),
  import('../src/config.js'), import('../src/features/orchestrator/runs.js'),
]);
const dependencies = { runTask: async ({ runId }) => ({ runId, outcome: 'completed', steps: 1, data: { id: '123' } }) };
const app = express();
app.use(express.json());
apisRoutes(app, dependencies);
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const httpFetch = globalThis.fetch;
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
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(dataDir, { recursive: true, force: true });
});

async function post(path, body) {
  const response = await httpFetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, json: await response.json() };
}

test('prompt tasks support wait mode and preserve scripted POST /tasks without a prompt', async () => {
  const waitResult = await post('/tasks', { apiId: 'unused', prompt: 'do something', runId: 'route-wait', wait: true });
  assert.equal(waitResult.status, 200);
  assert.equal(waitResult.json.outcome, 'completed');
  assert.deepEqual(waitResult.json.data, { id: '123' });
  assert.equal((await fetch(`${baseUrl}/tasks/route-wait`).then((response) => response.json())).status, 'completed');

  registryStore.reset();
  registryStore.registerApi('scripted-route', { baseUrl: 'https://api.example.com', tools: [
    { name: 'get_user', method: 'POST', path: '/get', parameters: { type: 'object', properties: { user_id: { type: 'string' } }, required: ['user_id'] }, response: { fields: { id: { path: 'result.id', type: 'string' }, name: { path: 'result.name', type: 'string' }, email: { path: 'result.email', type: 'string' } } } },
    { name: 'update_user_email', method: 'POST', path: '/update', parameters: { type: 'object', properties: { user_id: { type: 'string' }, email: { type: 'string' } }, required: ['user_id', 'email'] }, response: { fields: { id: { path: 'result.id', type: 'string' }, email: { path: 'result.email', type: 'string' } } } },
  ] });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ result: { id: '123', name: 'Asha', email: 'asha@example.com' } }), { status: 200 });
  try {
    const scripted = await post('/tasks', { apiId: 'scripted-route', runId: 'scripted-no-prompt' });
    assert.equal(scripted.status, 200);
    assert.equal(scripted.json.ok, true, JSON.stringify(scripted.json));
    assert.equal(scripted.json.step, 3);
  } finally { globalThis.fetch = originalFetch; registryStore.reset(); }
});

test('async task status, idempotent cancel, and per-process concurrent-run cap work', async () => {
  const oldCap = cfg.agentMaxConcurrentRuns;
  cfg.agentMaxConcurrentRuns = 1;
  let cancelled = false;
  dependencies.runTask = ({ runId, signal }) => new Promise((resolve) => {
    signal.addEventListener('abort', () => { cancelled = true; resolve({ runId, outcome: 'cancelled', steps: 0 }); }, { once: true });
  });
  try {
    const started = await post('/tasks', { apiId: 'unused', prompt: 'wait', runId: 'route-async' });
    assert.equal(started.status, 202);
    assert.equal((await fetch(`${baseUrl}/tasks/route-async`).then((response) => response.json())).status, 'running');
    const capped = await post('/tasks', { apiId: 'unused', prompt: 'second', runId: 'route-over-cap' });
    assert.equal(capped.status, 429);
    assert.equal(capped.json.error, 'agent_run_limit');
    const cancelledResponse = await fetch(`${baseUrl}/tasks/route-async`, { method: 'DELETE' }).then((response) => response.json());
    assert.equal(cancelledResponse.cancelled, true);
    const repeated = await fetch(`${baseUrl}/tasks/route-async`, { method: 'DELETE' }).then((response) => response.json());
    assert.equal(repeated.ok, true);
    assert.equal(cancelled, true);
  } finally {
    cfg.agentMaxConcurrentRuns = oldCap;
    dependencies.runTask = async ({ runId }) => ({ runId, outcome: 'completed', steps: 1 });
  }
});

test('task status falls back to durable run-scoped final events after local retention misses', async () => {
  const oldDatabaseUrl = process.env.DATABASE_URL;
  const originalReader = dependencies.listRunEvents;
  let queriedRunId;
  dependencies.listRunEvents = async (_pool, runId) => {
    queriedRunId = runId;
    return [{ type: 'agent.step', runId, apiId: 'durable-api' }, {
      type: 'agent.final', runId, apiId: 'durable-api', outcome: 'completed', steps: 2,
      tokens: { input: 5, output: 3 }, tokensByRole: { agent: { input: 5, output: 3 } }, provider: 'gemini', model: 'fake', mode: 'llm',
    }];
  };
  process.env.DATABASE_URL = 'postgres://test.invalid/db';
  try {
    const response = await httpFetch(`${baseUrl}/tasks/durable-replay`).then((value) => value.json());
    assert.equal(queriedRunId, 'durable-replay');
    assert.equal(response.status, 'completed');
    assert.equal(response.result.tokens.input, 5);
    assert.equal(response.result.mode, 'llm');
  } finally {
    dependencies.listRunEvents = originalReader;
    if (oldDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = oldDatabaseUrl;
  }
});

test('OpenAPI preview route returns a reviewable preview and never registers state', async () => {
  const response = await httpFetch(`${baseUrl}/apis/import/openapi/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    spec: { openapi: '3.0.3', info: { title: 'Preview only', version: '1' }, paths: { '/items': { post: {
      operationId: 'createItem', requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' } } } } } }, responses: { 200: { description: 'ok' } },
    } } } },
  }) });
  const preview = await response.json();
  assert.equal(response.status, 200);
  assert.equal(preview.title, 'Preview only');
  assert.equal(preview.tools[0].name, 'createItem');
  assert.equal(preview.warnings[0].includes('no_response_schema'), true);
  assert.equal(registryStore.list().some((item) => item.apiId === 'Preview only'), false);
  const invalid = await httpFetch(`${baseUrl}/apis/import/openapi/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'file:///etc/passwd' }) });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error, 'invalid_openapi');
});

test('API detail exposes logical tool schemas and raw contract fields without adapter or credentials', async () => {
  registryStore.reset();
  registryStore.registerApi('baseline-details', { baseUrl: 'https://api.example.test', credentials: { Authorization: { env: 'SECRET_TOKEN' } }, tools: [
    { name: 'read', description: 'ignored product copy', method: 'POST', path: '/read', sideEffects: 'none', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  ] });
  const response = await httpFetch(`${baseUrl}/apis/baseline-details`).then((value) => value.json());
  assert.equal(response.tools[0].name, 'read');
  assert.equal(response.tools[0].method, 'POST');
  assert.equal(response.tools[0].path, '/read');
  assert.deepEqual(response.tools[0].parameters.required, ['id']);
  assert.equal(JSON.stringify(response).includes('adapter'), false);
  assert.equal(JSON.stringify(response).includes('SECRET_TOKEN'), false);
  assert.equal(JSON.stringify(response).includes('Authorization'), false);
  registryStore.reset();
});
