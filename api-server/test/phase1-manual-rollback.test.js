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

test('manual rollback appends a persisted version and matching event and audit record', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'healr-manual-rollback-test-'));
  const previousDataDir = process.env.HEALR_DATA_DIR;
  process.env.HEALR_DATA_DIR = dataDir;

  try {
    const [{ apisRoutes }, { registryStore, RegistryStore }, { bus }, audit] = await Promise.all([
      import('../src/features/apis/routes.js'),
      import('../src/features/registry/store.js'),
      import('../src/features/events/bus.js'),
      import('../src/features/audit/index.js'),
    ]);
    const apiId = 'manual-rollback-regression';
    const tool = 'lookup';
    bus.clear();
    registryStore.registerApi(apiId, {
      baseUrl: 'http://localhost:5999',
      tools: [{
        name: tool,
        path: '/lookup',
        method: 'POST',
        parameters: { type: 'object', properties: { id: { type: 'string' } } },
        adapter: { request: [] },
      }],
    });
    registryStore.commit(apiId, tool, {
      request: [{ op: 'rename_field', from: 'id', to: 'user_id' }],
      response: { map: {} },
    }, { ops: [{ op: 'rename_field', from: 'id', to: 'user_id' }], evidence: ['version two'] });

    const versionOneBefore = registryStore.version(apiId, tool, 1);
    const versionTwoBefore = registryStore.version(apiId, tool, 2);
    const routes = new Map();
    apisRoutes({
      get(path, handler) { routes.set(`GET ${path}`, handler); },
      post(path, handler) { routes.set(`POST ${path}`, handler); },
      patch(path, handler) { routes.set(`PATCH ${path}`, handler); },
      delete(path, handler) { routes.set(`DELETE ${path}`, handler); },
    });
    const handler = routes.get('POST /apis/:apiId/tools/:tool/rollback');
    assert.equal(typeof handler, 'function');
    const response = responseCapture();
    handler({ params: { apiId, tool }, body: { toVersion: 1 } }, response);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { ok: true, version: 3, rollbackOf: 1 });
    const versionThree = registryStore.version(apiId, tool, 3);
    assert.equal(versionThree.rollbackOf, 1);
    assert.equal(versionThree.adapterHash, versionOneBefore.adapterHash);
    assert.deepEqual(registryStore.version(apiId, tool, 1), versionOneBefore);
    assert.deepEqual(registryStore.version(apiId, tool, 2), versionTwoBefore);

    const rollbackEvents = bus.since(0).filter((event) => event.type === 'registry.rollback');
    assert.equal(rollbackEvents.length, 1);
    assert.deepEqual({
      apiId: rollbackEvents[0].apiId,
      tool: rollbackEvents[0].tool,
      version: rollbackEvents[0].version,
      rollbackOf: rollbackEvents[0].rollbackOf,
    }, { apiId, tool, version: 3, rollbackOf: 1 });

    const rollbackRecords = audit.list({ decision: 'rollback', apiId, tool });
    assert.equal(rollbackRecords.length, 1);
    assert.equal(rollbackRecords[0].versionBefore, 2);
    assert.equal(rollbackRecords[0].versionAfter, 3);
    assert.equal(rollbackRecords[0].rollbackOf, 1);

    const reloaded = new RegistryStore();
    const persistedVersions = reloaded.versions(apiId, tool);
    assert.deepEqual(persistedVersions.map(({ version }) => version), [1, 2, 3]);
    assert.equal(persistedVersions[2].rollbackOf, 1);
    assert.equal(persistedVersions[2].adapterHash, versionOneBefore.adapterHash);
    assert.deepEqual(reloaded.version(apiId, tool, 1), versionOneBefore);
    assert.deepEqual(reloaded.version(apiId, tool, 2), versionTwoBefore);
  } finally {
    if (previousDataDir === undefined) delete process.env.HEALR_DATA_DIR;
    else process.env.HEALR_DATA_DIR = previousDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  }
});
