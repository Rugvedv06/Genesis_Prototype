import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('dev bad commit is rolled back on failed upstream replay and is recorded', async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'healr-watchdog-test-'));
  const previousDataDir = process.env.HEALR_DATA_DIR;
  const previousDevRoutes = process.env.ENABLE_DEV_ROUTES;
  const originalFetch = globalThis.fetch;
  process.env.HEALR_DATA_DIR = dataDir;
  process.env.ENABLE_DEV_ROUTES = '1';

  try {
    const [{ apisRoutes }, { registryStore }, { invoke }, audit, events] = await Promise.all([
      import('../src/features/apis/routes.js'),
      import('../src/features/registry/store.js'),
      import('../src/features/executor/invoke.js'),
      import('../src/features/audit/index.js'),
      import('../src/features/events/bus.js'),
    ]);
    const apiId = 'watchdog-regression';
    const toolName = 'lookup';
    registryStore.registerApi(apiId, {
      baseUrl: 'http://localhost:5999',
      tools: [{ name: toolName, path: '/lookup', method: 'POST', parameters: { type: 'object' } }],
    });
    events.clear();

    const routes = new Map();
    const app = {
      get() {},
      patch() {},
      delete() {},
      post(path, handler) { routes.set(path, handler); },
    };
    apisRoutes(app);
    const forceBadCommit = routes.get('/dev/force-bad-commit');
    assert.equal(typeof forceBadCommit, 'function');
    const forceResponse = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    forceBadCommit({ body: { apiId, tool: toolName } }, forceResponse);
    assert.equal(forceResponse.statusCode, 200);
    assert.equal(forceResponse.body.ok, true);
    assert.equal(registryStore.current(apiId, toolName).version, 2);

    let upstreamCalls = 0;
    globalThis.fetch = async (_url, init) => {
      upstreamCalls += 1;
      const requestBody = JSON.parse(init.body);
      const badCommitDroppedMarker = !Object.hasOwn(requestBody, '__healr_bad_field__');
      return badCommitDroppedMarker
        ? new Response(JSON.stringify({ error: 'fixture rejection' }), { status: 400 })
        : new Response(JSON.stringify({ result: 'ok' }), { status: 200 });
    };

    const runId = 'watchdog-run';
    const result = await invoke({ apiId, toolName, runId, args: { query: 'hello', __healr_bad_field__: 'watchdog-marker' } });
    assert.equal(result.ok, true);
    assert.equal(result.meta.version, 3);
    assert.equal(upstreamCalls, 2);

    const history = registryStore.versions(apiId, toolName);
    assert.deepEqual(history.map(({ version }) => version), [1, 2, 3]);
    const current = registryStore.current(apiId, toolName);
    assert.equal(current.version, 3);
    assert.equal(current.versionObj.origin, 'rollback');
    assert.equal(current.versionObj.rollbackOf, 1);

    const callEvents = events.bus.since(0).filter((event) => event.callId && event.runId === runId);
    const rollbackEvents = callEvents.filter((event) => event.type === 'patch.rolledback');
    assert.equal(rollbackEvents.length, 1);
    assert.equal(rollbackEvents[0].fromVersion, 2);
    assert.equal(rollbackEvents[0].toVersion, 3);

    const rollbackIndex = callEvents.findIndex((event) => event.type === 'patch.rolledback');
    const successIndex = callEvents.findIndex((event) => event.type === 'call.succeeded');
    assert.ok(rollbackIndex >= 0);
    assert.ok(successIndex > rollbackIndex, 'call.succeeded should follow patch.rolledback');
    assert.equal(callEvents[successIndex].callId, rollbackEvents[0].callId);
    assert.equal(callEvents[successIndex].runId, runId);

    const rollbackRecords = audit.list({ decision: 'rollback', apiId, tool: toolName });
    assert.equal(rollbackRecords.length, 1);
    assert.equal(rollbackRecords[0].versionBefore, 2);
    assert.equal(rollbackRecords[0].versionAfter, 3);
    assert.equal(rollbackRecords[0].rollbackOf, 1);
    assert.equal(rollbackRecords[0].auto, true);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousDataDir === undefined) delete process.env.HEALR_DATA_DIR;
    else process.env.HEALR_DATA_DIR = previousDataDir;
    if (previousDevRoutes === undefined) delete process.env.ENABLE_DEV_ROUTES;
    else process.env.ENABLE_DEV_ROUTES = previousDevRoutes;
    rmSync(dataDir, { recursive: true, force: true });
  }
});
