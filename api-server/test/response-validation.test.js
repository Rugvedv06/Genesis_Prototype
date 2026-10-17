import test from 'node:test';
import assert from 'node:assert/strict';
<<<<<<< HEAD
=======
<<<<<<< HEAD
>>>>>>> origin/main
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const previousDataDir = process.env.HEALR_DATA_DIR;
const dataDir = mkdtempSync(join(tmpdir(), 'healr-response-validation-'));
process.env.HEALR_DATA_DIR = dataDir;
const [{ invoke, validateResponse }, { registryStore }, { compileAdapter }, { bus }, audit] = await Promise.all([
  import('../src/features/executor/invoke.js'),
  import('../src/features/registry/store.js'),
  import('../src/features/registry/compile.js'),
  import('../src/features/events/bus.js'),
  import('../src/features/audit/index.js'),
]);
test.after(() => {
  if (previousDataDir === undefined) delete process.env.HEALR_DATA_DIR;
  else process.env.HEALR_DATA_DIR = previousDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});
<<<<<<< HEAD
=======
=======
import { invoke, validateResponse } from '../src/features/executor/invoke.js';
import { registryStore } from '../src/features/registry/store.js';
import { compileAdapter } from '../src/features/registry/compile.js';
>>>>>>> origin/main
>>>>>>> origin/main

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

test('inconclusive HTTP 200 response drift halts without replacing the active adapter or replaying', async () => {
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
<<<<<<< HEAD
    assert.equal(result.error.details.reason, 'response_mapping_unresolved');
=======
<<<<<<< HEAD
    assert.equal(result.error.details.reason, 'response_mapping_unresolved');
=======
    assert.equal(result.error.details.reason, 'response_mapping_ambiguous');
>>>>>>> origin/main
>>>>>>> origin/main
    assert.equal(calls, 1);
    assert.equal(registryStore.versions('response-test', 'get').length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('HTTP 200 read response remaps a unique compatible field without a second request', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ id: '1', full_name: 'Asha Rao' }), { status: 200 });
  };
  try {
<<<<<<< HEAD
    bus.clear();
=======
<<<<<<< HEAD
    bus.clear();
=======
>>>>>>> origin/main
>>>>>>> origin/main
    registryStore.reset();
    registryStore.registerApi('response-remap-test', {
      baseUrl: 'https://api.example.com',
      credentials: {},
      healing: { mode: 'enforce' },
      tools: [{
        name: 'get', method: 'GET', path: '/items/1', sideEffects: 'none',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        response: { fields: {
          id: { path: 'id', type: 'string', required: true },
          name: { path: 'name', type: 'string', required: true },
        } },
      }],
    });
    const result = await invoke({ apiId: 'response-remap-test', toolName: 'get', args: {} });
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, { id: '1', name: 'Asha Rao' });
    assert.equal(result.meta.healed, true);
    assert.equal(result.meta.rounds, 0);
    assert.equal(calls, 1);
    assert.equal(registryStore.current('response-remap-test', 'get').version, 2);
    assert.equal(registryStore.current('response-remap-test', 'get').versionObj.adapter.response.map.name, 'full_name');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('response remap with a mismatched identity echo halts without committing', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ id: '999', full_name: 'Asha Rao' }), { status: 200 });
  };
  try {
    registryStore.reset();
    registryStore.registerApi('response-identity-test', {
      baseUrl: 'https://api.example.com', credentials: {}, healing: { mode: 'enforce' },
      tools: [{
        name: 'get', method: 'GET', path: '/items/{id}', sideEffects: 'none', identity: { id: 'id' },
        parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
        response: { fields: {
          id: { path: 'id', type: 'string', required: true },
          name: { path: 'name', type: 'string', required: true },
        } },
      }],
    });
    const result = await invoke({ apiId: 'response-identity-test', toolName: 'get', args: { id: '123' } });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'tool_unavailable');
    assert.equal(calls, 1);
    assert.equal(registryStore.current('response-identity-test', 'get').version, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

<<<<<<< HEAD
=======
<<<<<<< HEAD
>>>>>>> origin/main
test('schema-valid HTTP 200 with a mismatched identity echo halts before returning success', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ id: '999', name: 'Asha' }), { status: 200 });
  };
  try {
    registryStore.reset();
    registryStore.registerApi('valid-response-identity-test', {
      baseUrl: 'https://api.example.com', credentials: {}, healing: { mode: 'enforce' },
      tools: [{
        name: 'get', method: 'GET', path: '/items/{id}', sideEffects: 'none', identity: { id: 'id' },
        parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
        response: { fields: {
          id: { path: 'id', type: 'string', required: true },
          name: { path: 'name', type: 'string', required: true },
        } },
      }],
    });
    const originalAdapter = structuredClone(registryStore.current('valid-response-identity-test', 'get').versionObj.adapter);
    const result = await invoke({ apiId: 'valid-response-identity-test', toolName: 'get', args: { id: '123' } });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'tool_unavailable');
    assert.equal(result.error.retryable, false);
    assert.equal(result.error.details.reason, 'response_identity_mismatch');
    assert.equal(calls, 1);
    assert.equal(registryStore.current('valid-response-identity-test', 'get').version, 1);
    assert.deepEqual(registryStore.current('valid-response-identity-test', 'get').versionObj.adapter, originalAdapter);
    assert.deepEqual(bus.since(0).filter((event) => event.apiId === 'valid-response-identity-test').map((event) => event.type), [
      'call.started', 'drift.silent', 'call.failed', 'halt', 'heal.finished',
    ]);
    assert.equal(audit.list({ decision: 'halt', apiId: 'valid-response-identity-test' }).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('M6 nested response field remaps from the same HTTP 200 payload', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ result: {
      id: '123', email: 'asha@example.com', data: { profile: { name: 'Asha Rao' } },
    } }), { status: 200 });
  };
  try {
    registryStore.reset();
    registryStore.registerApi('response-m6-test', {
      baseUrl: 'https://api.example.com', credentials: {}, healing: { mode: 'enforce' },
      tools: [{
        name: 'get', method: 'GET', path: '/users/{user_id}', sideEffects: 'none', identity: { user_id: 'id' },
        parameters: { type: 'object', properties: { user_id: { type: 'string' } }, required: ['user_id'], additionalProperties: false },
        response: { fields: {
          id: { path: 'result.id', type: 'string', required: true },
          name: { path: 'result.name', type: 'string', required: true },
          email: { path: 'result.email', type: 'string', format: 'email', required: true },
        } },
      }],
    });
    const result = await invoke({ apiId: 'response-m6-test', toolName: 'get', args: { user_id: '123' } });
    assert.equal(result.ok, true);
    assert.equal(result.data.name, 'Asha Rao');
    assert.equal(result.meta.ops[0].to, 'result.data.profile.name');
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('write response drift remaps the original response without replaying the write', async () => {
  const originalFetch = globalThis.fetch;
  let writes = 0;
  globalThis.fetch = async (_url, init) => {
    assert.equal(init.method, 'POST');
    writes += 1;
    return new Response(JSON.stringify({ result: {
      id: '123', full_name: 'Asha Rao', email: 'asha+demo@example.com', updated_at: '2026-10-16T00:00:00.000Z',
    } }), { status: 200 });
  };
  try {
    registryStore.reset();
    registryStore.registerApi('response-write-test', {
      baseUrl: 'https://api.example.com', credentials: {}, healing: { mode: 'enforce' },
      tools: [{
        name: 'update', method: 'POST', path: '/users/{user_id}/email', sideEffects: 'write', identity: { user_id: 'id' },
        parameters: {
          type: 'object', properties: { user_id: { type: 'string' }, email: { type: 'string', format: 'email' } },
          required: ['user_id', 'email'], additionalProperties: false,
        },
        response: { fields: {
          id: { path: 'result.id', type: 'string', required: true },
          name: { path: 'result.name', type: 'string', required: true },
          email: { path: 'result.email', type: 'string', format: 'email', required: true },
          updated_at: { path: 'result.updated_at', type: 'string', required: true },
        } },
      }],
    });
    const result = await invoke({ apiId: 'response-write-test', toolName: 'update', args: { user_id: '123', email: 'asha+demo@example.com' } });
    assert.equal(result.ok, true);
    assert.equal(result.data.name, 'Asha Rao');
    assert.equal(writes, 1);
    assert.equal(registryStore.current('response-write-test', 'update').version, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('M3.1 malformed required email remaps only to a unique valid contact_email on the original response', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ id: '123', email: 'not-an-email', contact_email: 'asha@example.com' }), { status: 200 });
  };
  try {
    registryStore.reset();
    registryStore.registerApi('response-format-remap-test', {
      baseUrl: 'https://api.example.com', credentials: {}, healing: { mode: 'enforce' },
      tools: [{
        name: 'get', method: 'GET', path: '/users/{id}', sideEffects: 'none', identity: { id: 'id' },
        parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
        response: { fields: {
          id: { path: 'id', type: 'string', required: true },
          email: { path: 'email', type: 'string', format: 'email', required: true },
        } },
      }],
    });

    const result = await invoke({ apiId: 'response-format-remap-test', toolName: 'get', args: { id: '123' } });

    assert.equal(result.ok, true);
    assert.deepEqual(result.data, { id: '123', email: 'asha@example.com' });
    assert.deepEqual(result.meta.ops.map(({ op, logical, from, to }) => ({ op, logical, from, to })), [{
      op: 'remap_response_path', logical: 'email', from: 'email', to: 'contact_email',
    }]);
    assert.equal(calls, 1);
    assert.equal(registryStore.current('response-format-remap-test', 'get').version, 2);
    assert.equal(registryStore.current('response-format-remap-test', 'get').versionObj.adapter.response.map.email, 'contact_email');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('M3.1 malformed email with no format-compatible alternate safe halts without replay or commit', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ id: '123', email: 'not-an-email', contact_email: 'also-not-an-email' }), { status: 200 });
  };
  try {
    registryStore.reset();
    registryStore.registerApi('response-format-halt-test', {
      baseUrl: 'https://api.example.com', credentials: {}, healing: { mode: 'enforce' },
      tools: [{
        name: 'get', method: 'GET', path: '/users/{id}', sideEffects: 'none', identity: { id: 'id' },
        parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
        response: { fields: {
          id: { path: 'id', type: 'string', required: true },
          email: { path: 'email', type: 'string', format: 'email', required: true },
        } },
      }],
    });
    const originalAdapter = structuredClone(registryStore.current('response-format-halt-test', 'get').versionObj.adapter);

    const result = await invoke({ apiId: 'response-format-halt-test', toolName: 'get', args: { id: '123' } });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'tool_unavailable');
    assert.equal(result.error.retryable, false);
    assert.equal(result.error.details.reason, 'response_mapping_unresolved');
    assert.equal(calls, 1);
    assert.equal(registryStore.current('response-format-halt-test', 'get').version, 1);
    assert.deepEqual(registryStore.current('response-format-halt-test', 'get').versionObj.adapter, originalAdapter);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('M3.1 equal-ranked compatible response paths remain explicitly ambiguous', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ id: '123', full_name: 'Asha Rao', display_name: 'Asha' }), { status: 200 });
  };
  try {
    registryStore.reset();
    registryStore.registerApi('response-format-ambiguous-test', {
      baseUrl: 'https://api.example.com', credentials: {}, healing: { mode: 'enforce' },
      tools: [{
        name: 'get', method: 'GET', path: '/users/{id}', sideEffects: 'none', identity: { id: 'id' },
        parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
        response: { fields: {
          id: { path: 'id', type: 'string', required: true },
          name: { path: 'name', type: 'string', required: true },
        } },
      }],
    });

    const result = await invoke({ apiId: 'response-format-ambiguous-test', toolName: 'get', args: { id: '123' } });

    assert.equal(result.ok, false);
    assert.equal(result.error.details.reason, 'response_mapping_ambiguous');
    assert.equal(result.error.retryable, false);
    assert.equal(calls, 1);
    assert.equal(registryStore.current('response-format-ambiguous-test', 'get').version, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

<<<<<<< HEAD
=======
=======
>>>>>>> origin/main
>>>>>>> origin/main
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
