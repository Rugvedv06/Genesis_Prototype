import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'healr-upstream-classification-'));
const [{ invoke }, { registryStore }, { bus }] = await Promise.all([
  import('../src/features/executor/invoke.js'),
  import('../src/features/registry/store.js'),
  import('../src/features/events/bus.js'),
]);
test.after(() => rmSync(dataDir, { recursive: true, force: true }));
process.env.HEALR_DATA_DIR = dataDir;

function register(apiId, { method = 'GET', sideEffects = 'none', fields = { value: { path: 'value', type: 'string', required: true } } } = {}) {
  registryStore.reset();
  bus.clear();
  registryStore.registerApi(apiId, {
    baseUrl: 'http://localhost:5999',
    credentials: {},
    retry: { maxRetries: 1, maxDelayMs: 20 },
    healing: { enabled: true, mode: 'enforce' },
    tools: [{
      name: 'read',
      method,
      path: '/value',
      sideEffects,
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      response: { fields },
    }],
  });
}

async function invokeWith(fetchImpl, apiId, args = {}) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await invoke({ apiId, toolName: 'read', args });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('transient upstream failures never enter schema healing or increment versions', async () => {
  const scenarios = [
    ['timeout', async () => { throw new Error('network timeout'); }, 'transport_error'],
    ['rate-limit', async () => new Response('busy', { status: 429, headers: { 'retry-after': '0' } }), 'rate_limited'],
    ['server-error', async () => new Response('unavailable', { status: 503 }), 'upstream_error'],
    ['auth-error', async () => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'content-type': 'application/json' } }), 'auth_error'],
    ['request-error', async () => new Response(JSON.stringify({ error: 'invalid input' }), { status: 422, headers: { 'content-type': 'application/json' } }), 'request_error'],
    ['html-error', async () => new Response('<html>proxy failure</html>', { status: 200, headers: { 'content-type': 'text/html' } }), 'invalid_upstream_response'],
  ];

  for (const [name, fetchImpl, classification] of scenarios) {
    register(`failure-${name}`);
    const result = await invokeWith(fetchImpl, `failure-${name}`);
    assert.equal(result.ok, false, name);
    assert.equal(result.error.details.classification, classification, name);
    assert.equal(registryStore.current(`failure-${name}`, 'read').version, 1, name);
    assert.equal(bus.since(0).some((event) => event.type === 'diagnosis.started'), false, name);
  }
});

test('empty success is not drift and valid responses are reported as no drift', async () => {
  register('empty-response');
  const empty = await invokeWith(async () => new Response(null, { status: 204 }), 'empty-response');
  assert.equal(empty.ok, true);
  assert.equal(empty.meta.classification, 'valid_empty_response');
  assert.equal(registryStore.current('empty-response', 'read').version, 1);

  register('no-drift');
  const valid = await invokeWith(async () => new Response(JSON.stringify({ value: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } }), 'no-drift');
  assert.equal(valid.ok, true);
  assert.equal(valid.meta.classification, 'no_drift');
  assert.equal(registryStore.current('no-drift', 'read').version, 1);
});

test('renamed and nested successful fields reach response drift diagnosis', async () => {
  register('renamed-field', { fields: { name: { path: 'name', type: 'string', required: true } } });
  const renamed = await invokeWith(async () => new Response(JSON.stringify({ full_name: 'Asha' }), { status: 200, headers: { 'content-type': 'application/json' } }), 'renamed-field');
  assert.equal(renamed.ok, true);
  assert.equal(renamed.meta.healed, true);
  assert.equal(registryStore.current('renamed-field', 'read').version, 2);

  register('nested-field', { fields: { temperature: { path: 'current.temperature', type: 'number', required: true } } });
  const nested = await invokeWith(async () => new Response(JSON.stringify({ data: { current: { temperature: 24.5 } } }), { status: 200, headers: { 'content-type': 'application/json' } }), 'nested-field');
  assert.equal(nested.ok, true);
  assert.equal(nested.meta.healed, true);
  assert.equal(registryStore.current('nested-field', 'read').version, 2);
});

test('non-idempotent writes are never blindly retried', async () => {
  register('write-no-retry', { method: 'POST', sideEffects: 'write' });
  let calls = 0;
  const result = await invokeWith(async () => {
    calls += 1;
    return new Response('temporary failure', { status: 503 });
  }, 'write-no-retry');
  assert.equal(result.ok, false);
  assert.equal(result.error.details.classification, 'upstream_error');
  assert.equal(calls, 1);
  assert.equal(registryStore.current('write-no-retry', 'read').version, 1);
});
