import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function responseCapture() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

test('settings PATCH merges and persists through a core registry reload', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'healr-settings-persistence-test-'));
  const previousDataDir = process.env.HEALR_DATA_DIR;
  process.env.HEALR_DATA_DIR = dataDir;

  try {
    const [{ apisRoutes }, { registryStore, RegistryStore }, { bus }] = await Promise.all([
      import('../src/features/apis/routes.js'),
      import('../src/features/registry/store.js'),
      import('../src/features/events/bus.js'),
    ]);
    const apiId = 'settings-persistence-test';
    registryStore.registerApi(apiId, {
      baseUrl: 'http://localhost:5999',
      specUrl: 'http://localhost:5999/openapi.json',
      credentials: { API_TOKEN: { env: 'SETTINGS_API_TOKEN' } },
      healing: {
        enabled: true,
        mode: 'enforce',
        maxRounds: 4,
        confidenceThreshold: 0.72,
        timeoutMs: 900,
        tier2: true,
        unrelatedPolicy: { retain: 'before' },
      },
      tools: [{ name: 'lookup', path: '/lookup', parameters: { type: 'object' } }],
    });
    bus.clear();

    const routes = new Map();
    apisRoutes({
      get(path, handler) { routes.set(`GET ${path}`, handler); },
      patch(path, handler) { routes.set(`PATCH ${path}`, handler); },
      post() {},
      delete() {},
    });
    const call = (method, path, req = {}) => {
      const handler = routes.get(`${method} ${path}`);
      assert.equal(typeof handler, 'function', `missing route ${method} ${path}`);
      const res = responseCapture();
      handler({ params: { apiId }, body: {}, ...req }, res);
      return res;
    };

    const patch = call('PATCH', '/apis/:apiId/config', {
      body: {
        mode: 'log',
        confidenceThreshold: 0.91,
        maxRounds: 8,
        tier2: false,
        healing: {
          enabled: false,
          timeoutMs: 1500,
          newlyAddedOption: 'preserved',
        },
      },
    });
    assert.equal(patch.statusCode, 200);
    assert.equal(patch.body.ok, true);

    const settings = call('GET', '/apis/:apiId').body.config;
    assert.equal(settings.confidenceThreshold, 0.91);
    assert.equal(settings.maxRounds, 8);
    assert.equal(settings.tier2, false);
    assert.equal(settings.healing.enabled, false);
    assert.equal(settings.healing.mode, 'log');
    assert.equal(settings.healing.timeoutMs, 1500);
    assert.equal(settings.healing.maxRounds, 4);
    assert.equal(settings.healing.confidenceThreshold, 0.72);
    assert.deepEqual(settings.healing.unrelatedPolicy, { retain: 'before' });
    assert.equal(settings.healing.newlyAddedOption, 'preserved');
    assert.equal(settings.credentials, undefined, 'API credentials stay server-side and are omitted from GET settings');
    assert.equal(patch.body.config.credentials, undefined, 'PATCH response must not expose credential references');
    assert.equal(settings.specUrl, 'http://localhost:5999/openapi.json');

    const configEvent = bus.since(0).find((event) => event.type === 'config.changed' && event.apiId === apiId);
    assert.ok(configEvent);
    assert.equal(configEvent.config.credentials, undefined);
    assert.equal(JSON.stringify(configEvent).includes('SETTINGS_API_TOKEN'), false);

    const reloaded = new RegistryStore();
    registryStore._byApi = reloaded._byApi;
    registryStore._compiled = reloaded._compiled;
    const afterRestart = call('GET', '/apis/:apiId').body.config;
    assert.equal(afterRestart.confidenceThreshold, 0.91);
    assert.equal(afterRestart.maxRounds, 8);
    assert.equal(afterRestart.tier2, false);
    assert.equal(afterRestart.healing.enabled, false);
    assert.equal(afterRestart.healing.mode, 'log');
    assert.equal(afterRestart.healing.timeoutMs, 1500);
    assert.equal(afterRestart.healing.newlyAddedOption, 'preserved');
    assert.deepEqual(afterRestart.healing.unrelatedPolicy, { retain: 'before' });
    assert.equal(afterRestart.credentials, undefined, 'reloaded API settings still omit credentials');
    assert.deepEqual(registryStore.config(apiId).credentials, { API_TOKEN: { env: 'SETTINGS_API_TOKEN' } }, 'credentials remain persisted on the server');
  } finally {
    if (previousDataDir === undefined) delete process.env.HEALR_DATA_DIR;
    else process.env.HEALR_DATA_DIR = previousDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  }
});
