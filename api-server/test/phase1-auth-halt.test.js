import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('rejected configured bearer halts once without retry, write, or registry mutation', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'healr-auth-halt-test-'));
  const previousDataDir = process.env.HEALR_DATA_DIR;
  const previousBearer = process.env.REJECTED_BEARER;
  const originalFetch = globalThis.fetch;
  process.env.HEALR_DATA_DIR = dataDir;
  process.env.REJECTED_BEARER = 'configured-but-rejected-token';

  try {
    const [{ invoke }, { registryStore }, { bus }, circuit, audit] = await Promise.all([
      import('../src/features/executor/invoke.js'),
      import('../src/features/registry/store.js'),
      import('../src/features/events/bus.js'),
      import('../src/features/safety/circuit.js'),
      import('../src/features/audit/index.js'),
    ]);
    const apiId = 'auth-halt-regression';
    const toolName = 'write_record';
    const adapter = {
      request: [{
        op: 'add_header',
        name: 'Authorization',
        source: { type: 'credential', ref: 'BearerToken' },
      }],
      response: { map: {} },
      sideEffects: 'write',
    };
    registryStore.reset();
    circuit.reset();
    bus.clear();
    registryStore.registerApi(apiId, {
      baseUrl: 'http://localhost:5999',
      credentials: { BearerToken: { env: 'REJECTED_BEARER' } },
      healing: { enabled: true, mode: 'enforce' },
      tools: [{ name: toolName, path: '/records', method: 'POST', parameters: { type: 'object' }, adapter }],
    });
    const before = registryStore.version(apiId, toolName, 1);

    let requestCount = 0;
    globalThis.fetch = async (_url, init) => {
      requestCount += 1;
      assert.equal(init.headers.Authorization, 'configured-but-rejected-token');
      return new Response(JSON.stringify({ error: 'missing_auth' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    };

    const args = { record: 'no-write-on-auth-failure' };
    const firstRunId = 'auth-first-run';
    const first = await invoke({ apiId, toolName, args, runId: firstRunId });
    assert.equal(first.ok, false);
    assert.equal(first.error.code, 'tool_unavailable');
    assert.equal(first.error.details.reason, 'credential_unavailable');
    assert.equal(requestCount, 1, '401 must not retry a write request');
    assert.deepEqual(registryStore.versions(apiId, toolName).map(({ version }) => version), [1]);
    assert.deepEqual(registryStore.version(apiId, toolName, 1), before);

    const firstEvents = bus.since(0).filter((event) => event.runId === firstRunId);
    const failed = firstEvents.find((event) => event.type === 'call.failed');
    const halted = firstEvents.find((event) => event.type === 'halt');
    const finished = firstEvents.find((event) => event.type === 'heal.finished');
    assert.ok(failed);
    assert.equal(failed.reason, 'credential_unavailable');
    assert.ok(halted);
    assert.equal(halted.reason, 'credential_unavailable');
    assert.ok(finished);
    assert.equal(finished.outcome, 'halted');
    assert.equal(failed.callId, halted.callId);
    assert.equal(halted.callId, finished.callId);

    const firstAudit = audit.list({ decision: 'halt', apiId, tool: toolName });
    assert.equal(firstAudit.length, 1);
    assert.equal(firstAudit[0].reason, 'credential_unavailable');
    assert.equal(firstAudit[0].callId, failed.callId);
    assert.equal(audit.exportNdjson().includes('configured-but-rejected-token'), false);

    const secondRunId = 'auth-cached-run';
    const cached = await invoke({ apiId, toolName, args, runId: secondRunId });
    assert.equal(cached.ok, false);
    assert.equal(cached.error.details.reason, 'credential_unavailable');
    assert.equal(requestCount, 1, 'negative cache should avoid another upstream request');
    const cachedEvents = bus.since(0).filter((event) => event.runId === secondRunId);
    assert.equal(cachedEvents.find((event) => event.type === 'call.failed')?.cacheHit, true);
    assert.equal(audit.list({ decision: 'halt', apiId, tool: toolName }).length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousDataDir === undefined) delete process.env.HEALR_DATA_DIR;
    else process.env.HEALR_DATA_DIR = previousDataDir;
    if (previousBearer === undefined) delete process.env.REJECTED_BEARER;
    else process.env.REJECTED_BEARER = previousBearer;
    rmSync(dataDir, { recursive: true, force: true });
  }
});
