import test from 'node:test';
import assert from 'node:assert/strict';
import { invoke, validateResponse } from '../src/features/executor/invoke.js';
import { registryStore } from '../src/features/registry/store.js';
import { compileAdapter } from '../src/features/registry/compile.js';

function registerResponseContract() {
  registryStore.reset();
  registryStore.registerApi('response-test', {
    baseUrl: 'https://api.example.com',
    credentials: {},
    healing: { maxRounds: 2 },
    tools: [{
      name: 'get',
      method: 'GET',
      path: '/items/1',
      sideEffects: 'none',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      response: {
        fields: {
          id: { path: 'id', type: 'integer', required: true },
          name: { path: 'name', type: 'string', required: true },
        },
      },
    }],
  });
}

test('HTTP 200 response drift halts without replacing the active adapter', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ id: '1', name: 'Asha' }), { status: 200 });
  };
  try {
    registerResponseContract();
    const result = await invoke({ apiId: 'response-test', toolName: 'get', args: {} });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'tool_unavailable');
    assert.equal(result.error.details.reason, 'no_diagnosis');
    assert.equal(calls, 1);
    assert.equal(registryStore.versions('response-test', 'get').length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('valid typed response passes logical response validation', () => {
  const tool = {
    apiId: 'response-test',
    name: 'get',
    version: 1,
    versionObj: {
      adapter: { response: { map: { id: 'id', name: 'name' } } },
      meta: {
        responseSchema: {
          type: 'object',
          properties: { id: { type: 'integer' }, name: { type: 'string' } },
          required: ['id', 'name'],
        },
      },
    },
    compiled: compileAdapter({ response: { map: { id: 'id', name: 'name' } } }),
  };
  assert.deepEqual(validateResponse(tool, { ok: true, json: { id: 1, name: 'Asha' } }), { ok: true, errors: [] });
});
