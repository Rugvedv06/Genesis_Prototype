import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
<<<<<<< HEAD
import { createIsolatedDatabase } from './helpers/isolated-database.js';
=======
>>>>>>> origin/main

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CORE_ENTRY = join(ROOT, 'api-server/src/server.js');
const MOCK_ENTRY = join(ROOT, 'demo-server-and-client/server/src/server.js');

async function freePort(excluded = []) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const port = await new Promise((resolve, reject) => {
      const probe = createServer();
      probe.once('error', reject);
      probe.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
        const value = probe.address().port;
        probe.close((error) => error ? reject(error) : resolve(value));
      });
    });
    if (!excluded.includes(port)) return port;
  }
  throw new Error('Could not allocate distinct local test ports');
}

function start(entry, cwd, env) {
  return spawn(process.execPath, [entry], { cwd, env, stdio: 'ignore' });
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(2500).then(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }),
  ]);
}

async function request(url, options) {
  const response = await fetch(url, options);
  return { status: response.status, body: await response.json() };
}

async function openPolicyEvents(coreUrl, apiId) {
  const controller = new AbortController();
  const response = await fetch(`${coreUrl}/events?since=0&apiId=${encodeURIComponent(apiId)}&types=halt,heal.finished`, {
    signal: controller.signal,
  });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const events = (async () => {
    let buffer = '';
    const received = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new Error(`SSE stream closed before halt completion for ${apiId}`);
      buffer += new TextDecoder().decode(value, { stream: true });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const dataLine = frame.split(/\r?\n/).find((line) => line.startsWith('data:'));
        if (dataLine) {
          received.push(JSON.parse(dataLine.slice(5).trim()));
          if (received.some((event) => event.type === 'halt') && received.some((event) => event.type === 'heal.finished')) return received;
        }
      }
    }
  })();
  return {
    events,
    close: async () => {
      controller.abort();
      await reader.cancel().catch(() => {});
    },
  };
}

async function post(url, body) {
  return request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function waitForHealth(url, children) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (children.some((child) => child.exitCode !== null)) throw new Error('A test server exited before becoming healthy');
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${url}/health`);
}

<<<<<<< HEAD
test('M5 policy modes enforce, log, and disable adapter changes with auditable outcomes', {
  skip: !process.env.HEALR_TEST_DATABASE_URL && 'set HEALR_TEST_DATABASE_URL to run isolated PostgreSQL runtime coverage',
}, async (t) => {
  const isolatedDb = await createIsolatedDatabase('policy');
  let dataDir;
  let core;
  let mock;
  t.after(async () => {
    await Promise.all([stop(core), stop(mock)]);
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
    assert.deepEqual(await isolatedDb.drop(), { dropped: true, databaseExists: false }, 'isolated policy database is dropped');
  });
  dataDir = mkdtempSync(join(tmpdir(), 'healr-policy-modes-'));
=======
test('M5 policy modes enforce, log, and disable adapter changes with auditable outcomes', async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'healr-policy-modes-'));
>>>>>>> origin/main
  const corePort = await freePort();
  const mockPort = await freePort([corePort]);
  const coreUrl = `http://127.0.0.1:${corePort}`;
  const mockUrl = `http://127.0.0.1:${mockPort}`;
  const env = {
    ...process.env,
<<<<<<< HEAD
    DATABASE_URL: isolatedDb.url,
    REDIS_URL: '',
    HEALR_TEST_DATABASE_URL: '',
=======
>>>>>>> origin/main
    PORT: String(corePort),
    CORE_URL: coreUrl,
    MOCK_URL: mockUrl,
    HEALR_DATA_DIR: dataDir,
    ALLOW_LOCAL_UPSTREAMS: '1',
    TENANT_ID: 'policy-test-tenant',
    MAX_HEAL_ROUNDS: '5',
    HEAL_TIMEOUT_MS: '3000',
  };
<<<<<<< HEAD
  core = start(CORE_ENTRY, join(ROOT, 'api-server'), env);
  mock = start(MOCK_ENTRY, join(ROOT, 'demo-server-and-client/server'), { ...env, PORT: String(mockPort) });
=======
  const core = start(CORE_ENTRY, join(ROOT, 'api-server'), env);
  const mock = start(MOCK_ENTRY, join(ROOT, 'demo-server-and-client/server'), { ...env, PORT: String(mockPort) });
  t.after(async () => {
    await Promise.all([stop(core), stop(mock)]);
    rmSync(dataDir, { recursive: true, force: true });
  });
>>>>>>> origin/main

  await Promise.all([waitForHealth(coreUrl, [core]), waitForHealth(mockUrl, [mock])]);

  const cases = [
    { mode: 'enforce', enabled: true, risk: 'low', apiId: 'policy-enforce' },
    { mode: 'log', enabled: true, apiId: 'policy-log' },
    { mode: 'off', enabled: true, apiId: 'policy-off' },
    { mode: 'enforce', enabled: false, apiId: 'policy-disabled-enforce' },
    { mode: 'enforce', enabled: true, risk: 'high', apiId: 'policy-gate-rejected' },
  ];
  for (const { mode, enabled, risk = 'low', apiId } of cases) {
    await post(`${mockUrl}/admin/reset`, {});
    await post(`${mockUrl}/admin/mutate`, { id: 'M5' });
    const registration = await post(`${coreUrl}/apis`, {
      apiId,
      baseUrl: mockUrl,
      specUrl: `${mockUrl}/openapi.json`,
      credentials: { 'X-Tenant': { env: 'TENANT_ID' } },
      healing: { enabled, mode, maxRounds: 5, confidenceThreshold: 0.85 },
      tools: [{
        name: 'get_user',
        method: 'POST',
        path: '/api/users/get',
        risk,
        sideEffects: 'none',
        parameters: {
          type: 'object',
          properties: { user_id: { type: 'string' } },
          required: ['user_id'],
          additionalProperties: false,
        },
        response: {
          fields: {
            id: { path: 'result.id', type: 'string' },
            name: { path: 'result.name', type: 'string' },
            email: { path: 'result.email', type: 'string', format: 'email' },
          },
        },
      }],
    });
    assert.equal(registration.status, 200, `registration failed for ${mode}: ${JSON.stringify(registration.body)}`);

    const policyStream = (mode !== 'enforce' || !enabled || risk === 'high') ? await openPolicyEvents(coreUrl, apiId) : null;

    const invocation = await post(`${coreUrl}/apis/${apiId}/tools/get_user/invoke`, {
      args: { user_id: '123' },
      runId: `policy-${mode}`,
    });
    const versions = await request(`${coreUrl}/apis/${apiId}/tools/get_user/versions`);
    const audit = await request(`${coreUrl}/audit?apiId=${encodeURIComponent(apiId)}`);
    const mockState = await request(`${mockUrl}/admin/state`);
    const records = audit.body.records;

    if (policyStream) {
      try {
        const events = await Promise.race([
          policyStream.events,
          delay(4000).then(() => { throw new Error(`Timed out waiting for halt completion for ${apiId}`); }),
        ]);
        const haltEvent = events.find((event) => event.type === 'halt');
        const finishedEvent = events.find((event) => event.type === 'heal.finished');
        assert.equal(haltEvent.apiId, apiId);
        assert.equal(haltEvent.retryable, false);
        assert.equal(finishedEvent.outcome, 'halted');
        if (mode !== 'log' && risk !== 'high') assert.equal(haltEvent.reason, 'healing_disabled');
        if (mode === 'log') assert.equal(haltEvent.reason, 'drift_unresolved');
        if (risk === 'high') assert.equal(haltEvent.reason, 'requires_approval');
      } finally {
        await policyStream.close();
      }
    }

    if (!enabled) {
      assert.equal(invocation.body.ok, false);
      assert.equal(invocation.body.error.details?.reason, 'healing_disabled');
      assert.equal(versions.body.versions.length, 1, 'disabled healing must leave the registered adapter unchanged');
      assert.equal(mockState.body.lastRequests.length, 1, 'disabled healing must not replay a proposed patch');
      assert.equal(mockState.body.lastRequests[0].status, 400);
      assert.ok(records.some((record) => record.decision === 'halt' && record.reason === 'healing_disabled'));
      assert.equal(records.some((record) => record.decision === 'proposed' || record.decision === 'commit'), false);
    } else if (mode === 'enforce' && risk === 'low') {
<<<<<<< HEAD
      assert.equal(invocation.body.ok, true, JSON.stringify(invocation.body));
=======
      assert.equal(invocation.body.ok, true);
>>>>>>> origin/main
      assert.equal(invocation.body.meta.healed, true);
      assert.equal(invocation.body.meta.version, 2);
      assert.equal(versions.body.versions.length, 2);
      assert.equal(versions.body.versions[1].origin, 'heal');
<<<<<<< HEAD
      const persistedHeaderOp = versions.body.versions[1].adapter.request.find((operation) => operation.op === 'add_header');
      assert.ok(persistedHeaderOp, 'enforce mode persists the validated header adapter operation');
      assert.equal(Object.hasOwn(persistedHeaderOp, 'evidence'), false, 'evidence must not be stored in the executable adapter');
      const commitAudit = records.find((record) => record.decision === 'commit');
      assert.ok(commitAudit?.evidenceCount > 0, 'proposal evidence remains in durable provenance');
=======
>>>>>>> origin/main
      assert.ok(mockState.body.lastRequests.length > 1, 'enforce should replay after each verified patch');
      assert.equal(mockState.body.lastRequests.at(-1).status, 200);
      assert.ok(records.some((record) => record.decision === 'commit' && record.versionAfter === 2));
    } else if (mode === 'log') {
      assert.equal(invocation.body.ok, false);
      assert.equal(invocation.body.error.details?.reason, 'drift_unresolved');
      assert.equal(versions.body.versions.length, 1, 'log mode must leave the registered adapter unchanged');
      assert.equal(mockState.body.lastRequests.length, 1, 'log mode must not replay the proposed patch');
      assert.equal(mockState.body.lastRequests[0].status, 400);
      assert.ok(records.some((record) => record.decision === 'proposed' && record.versionBefore === 1));
    } else if (mode === 'off') {
      assert.equal(invocation.body.ok, false);
      assert.equal(invocation.body.error.details?.reason, 'healing_disabled');
      assert.equal(versions.body.versions.length, 1, 'off mode must leave the registered adapter unchanged');
      assert.equal(mockState.body.lastRequests.length, 1, 'off mode must not replay a patch');
      assert.equal(mockState.body.lastRequests[0].status, 400);
      assert.ok(records.some((record) => record.decision === 'halt' && record.reason === 'healing_disabled'));
      assert.equal(records.some((record) => record.decision === 'proposed' || record.decision === 'commit'), false);
    } else {
      assert.equal(invocation.body.ok, false);
      assert.equal(invocation.body.error.details?.reason, 'requires_approval');
      assert.equal(versions.body.versions.length, 1);
      assert.deepEqual(mockState.body.lastRequests.map((entry) => entry.status), [400, 422]);
      assert.ok(records.some((record) => record.decision === 'halt' && record.reason === 'requires_approval'));
    }
  }
});
