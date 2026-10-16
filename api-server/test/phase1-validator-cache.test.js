import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('re-registering an API invalidates logical and response validators for reused tool versions', async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'healr-validator-cache-test-'));
  const previousDataDir = process.env.HEALR_DATA_DIR;
  const originalFetch = globalThis.fetch;
  process.env.HEALR_DATA_DIR = dataDir;

  try {
    const [{ invoke }, { registryStore }, { validateResponse }] = await Promise.all([
      import('../src/features/executor/invoke.js'),
      import('../src/features/registry/store.js'),
      import('../src/features/executor/invoke.js'),
    ]);

    const apiId = 'validator-cache-re-registration';
    const toolName = 'lookup';
    const register = (parameters, fields) => registryStore.registerApi(apiId, {
      baseUrl: 'http://localhost:5999',
      tools: [{
        name: toolName,
        path: '/lookup',
        method: 'POST',
        parameters,
        ...(fields ? { response: { fields } } : {}),
      }],
    });

    globalThis.fetch = async () => new Response(JSON.stringify({ result: { value: 'ok', status: 200 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

    await t.test('logical schema changes apply immediately after re-registration', async () => {
      register({ type: 'object', properties: { oldId: { type: 'string' } }, required: ['oldId'], additionalProperties: false });
      const first = await invoke({ apiId, toolName, args: { oldId: 'a' } });
      assert.equal(first.ok, true);

      register({ type: 'object', properties: { newId: { type: 'string' } }, required: ['newId'], additionalProperties: false });
      const afterRegistration = await invoke({ apiId, toolName, args: { newId: 'b' } });
      assert.equal(afterRegistration.ok, true, JSON.stringify(afterRegistration.error));
    });

    await t.test('response schema changes apply immediately after re-registration', () => {
      register({ type: 'object', additionalProperties: true }, {
        value: { path: 'result.value', type: 'string', required: true },
      });
      const original = registryStore.current(apiId, toolName);
      const response = { ok: true, json: { result: { value: 'ok', status: 200 } } };
      assert.equal(validateResponse({ ...original, apiId, name: toolName }, response).ok, true);

      register({ type: 'object', additionalProperties: true }, {
        status: { path: 'result.status', type: 'number', required: true },
      });
      const updated = registryStore.current(apiId, toolName);
      assert.equal(validateResponse({ ...updated, apiId, name: toolName }, response).ok, true);
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (previousDataDir === undefined) delete process.env.HEALR_DATA_DIR;
    else process.env.HEALR_DATA_DIR = previousDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  }
});
