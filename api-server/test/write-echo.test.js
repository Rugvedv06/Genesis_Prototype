process.env.DATABASE_URL = '';
import test from 'node:test';
import assert from 'node:assert/strict';
const { matchesWriteEcho } = await import('../src/features/executor/invoke.js');

const tool = {
  versionObj: { meta: { method: 'POST', sideEffects: 'write' }, adapter: { response: { map: { email: 'result.email' } } } },
  compiled: { extract: (body) => ({ email: body.result.email }) },
};

test('write replay requires matching declared request and response fields', () => {
  assert.equal(matchesWriteEcho(tool, { email: 'new@example.com' }, { json: { result: { email: 'new@example.com' } } }, 2), true);
  assert.equal(matchesWriteEcho(tool, { email: 'new@example.com' }, { json: { result: { email: 'old@example.com' } } }, 2), false);
  assert.equal(matchesWriteEcho(tool, { email: 'new@example.com' }, { json: { result: { email: 'old@example.com' } } }, 1), true);
  assert.equal(matchesWriteEcho(tool, { user_id: '123' }, { json: { result: { email: 'anything@example.com' } } }, 2), true);
});

test('unsafe write failures are not automatically replayed', async () => {
  const { invoke } = await import('../src/features/executor/invoke.js');
  const { registryStore } = await import('../src/features/registry/store.js');
  const oldAllow = process.env.ALLOW_LOCAL_UPSTREAMS;
  const oldDatabaseUrl = process.env.DATABASE_URL;
  const oldFetch = globalThis.fetch;
  process.env.ALLOW_LOCAL_UPSTREAMS = '1';
  process.env.DATABASE_URL = '';
  registryStore.reset();
  registryStore.registerApi('unsafe-write-replay', {
    baseUrl: 'http://localhost:5998',
    healing: { enabled: true, mode: 'enforce' },
    tools: [{ name: 'create', path: '/records', method: 'POST', sideEffects: 'write',
      parameters: { type: 'object', properties: { value: { type: 'string' } } },
      adapter: { request: [], response: { fields: {} } } }],
  });
  let attempts = 0;
  globalThis.fetch = async () => { attempts += 1; return new Response('temporary failure', { status: 503 }); };
  try {
    const result = await invoke({ apiId: 'unsafe-write-replay', toolName: 'create', args: { value: 'once' } });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'outcome_uncertain');
    assert.equal(result.error.details.reason, 'unsafe_write_replay');
    assert.equal(attempts, 1);
  } finally {
    globalThis.fetch = oldFetch;
    registryStore.reset();
    if (oldAllow === undefined) delete process.env.ALLOW_LOCAL_UPSTREAMS; else process.env.ALLOW_LOCAL_UPSTREAMS = oldAllow;
    if (oldDatabaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldDatabaseUrl;
  }
});

test('declared idempotency support reuses one invocation key across transient replay', async () => {
  const { invoke } = await import('../src/features/executor/invoke.js');
  const { registryStore } = await import('../src/features/registry/store.js');
  const oldAllow = process.env.ALLOW_LOCAL_UPSTREAMS;
  const oldDatabaseUrl = process.env.DATABASE_URL;
  const oldFetch = globalThis.fetch;
  process.env.ALLOW_LOCAL_UPSTREAMS = '1';
  process.env.DATABASE_URL = '';
  registryStore.reset();
  registryStore.registerApi('safe-write-replay', {
    baseUrl: 'http://localhost:5997',
    healing: { enabled: true, mode: 'enforce' },
    tools: [{ name: 'create', path: '/records', method: 'POST', sideEffects: 'write', idempotencyKeyHeader: 'Idempotency-Key',
      parameters: { type: 'object', properties: { value: { type: 'string' } } },
      adapter: { request: [], response: { fields: {} } } }],
  });
  const keys = [];
  globalThis.fetch = async (_url, init) => {
    keys.push(init.headers['Idempotency-Key']);
    return keys.length === 1
      ? new Response('temporary failure', { status: 503 })
      : new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const request = { apiId: 'safe-write-replay', toolName: 'create', args: { value: 'once' }, idempotencyKey: 'client-order-789' };
    const result = await invoke(request);
    const duplicateClientAttempt = await invoke(request);
    assert.equal(result.ok, true);
    assert.equal(duplicateClientAttempt.ok, true);
    assert.equal(keys.length, 3);
    assert.ok(keys[0]);
    assert.equal(keys[1], keys[0]);
    assert.equal(keys[2], keys[0], 'client retries reuse the same upstream key');
    assert.notEqual(keys[0], request.idempotencyKey, 'raw client keys are not sent upstream');
  } finally {
    globalThis.fetch = oldFetch;
    registryStore.reset();
    if (oldAllow === undefined) delete process.env.ALLOW_LOCAL_UPSTREAMS; else process.env.ALLOW_LOCAL_UPSTREAMS = oldAllow;
    if (oldDatabaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldDatabaseUrl;
  }
});
