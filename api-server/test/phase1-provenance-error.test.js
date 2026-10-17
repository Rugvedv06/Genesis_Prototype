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
<<<<<<< HEAD
import { createIsolatedDatabase } from './helpers/isolated-database.js';
=======
>>>>>>> origin/main
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

async function readHaltEvents(url, apiId, runId) {
  const controller = new AbortController();
  const response = await fetch(`${url}/events?since=0&apiId=${encodeURIComponent(apiId)}&types=call.failed,halt,heal.finished`, { signal: controller.signal });
  const reader = response.body.getReader();
  const found = (async () => {
    let buffer = '';
    const events = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) return events;
      buffer += new TextDecoder().decode(value, { stream: true });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const line = frame.split(/\r?\n/).find((part) => part.startsWith('data:'));
        if (line) {
          const event = JSON.parse(line.slice(5).trim());
          if (event.runId === runId) events.push(event);
          const types = new Set(events.map((item) => item.type));
          if (['call.failed', 'halt', 'heal.finished'].every((type) => types.has(type))) return events;
        }
      }
    }
  })();
  return {
    found,
    close: async () => {
      controller.abort();
      await reader.cancel().catch(() => {});
    },
  };
}

<<<<<<< HEAD
=======
<<<<<<< HEAD
>>>>>>> origin/main
test('provenance domain errors return a structured safe halt without changing history', {
  skip: !process.env.HEALR_TEST_DATABASE_URL && 'set HEALR_TEST_DATABASE_URL to run isolated PostgreSQL runtime coverage',
}, async (t) => {
  const isolatedDb = await createIsolatedDatabase('provenance');
  let dataDir;
  let core;
  let mock;
  t.after(async () => {
    await Promise.all([stop(core), stop(mock)]);
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
    assert.deepEqual(await isolatedDb.drop(), { dropped: true, databaseExists: false }, 'isolated provenance database is dropped');
  });
  dataDir = mkdtempSync(join(tmpdir(), 'healr-provenance-'));
<<<<<<< HEAD
=======
=======
test('provenance domain errors return a structured safe halt without changing history', async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'healr-provenance-'));
>>>>>>> origin/main
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
<<<<<<< HEAD
    DATABASE_URL: isolatedDb.url,
    REDIS_URL: '',
    HEALR_TEST_DATABASE_URL: '',
=======
>>>>>>> origin/main
>>>>>>> origin/main
    PORT: String(corePort),
    CORE_URL: coreUrl,
    MOCK_URL: mockUrl,
    HEALR_DATA_DIR: dataDir,
    ALLOW_LOCAL_UPSTREAMS: '1',
  };
<<<<<<< HEAD
  core = start(CORE_ENTRY, join(ROOT, 'api-server'), env);
  mock = start(MOCK_ENTRY, join(ROOT, 'demo-server-and-client/server'), { ...env, PORT: String(mockPort) });
=======
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
>>>>>>> origin/main

  await Promise.all([waitForHealth(coreUrl, [core]), waitForHealth(mockUrl, [mock])]);
  await post(`${mockUrl}/admin/reset`, {});
  const apiId = 'provenance-domain-error';
  const registered = await post(`${coreUrl}/apis`, {
    apiId,
    baseUrl: mockUrl,
    credentials: {},
    healing: { enabled: true, mode: 'enforce' },
    tools: [{
      name: 'update_user',
      method: 'POST',
      path: '/api/users/update-email',
      risk: 'low',
      sideEffects: 'write',
      adapter: {
        // This puts an untraceable undefined leaf into the outbound body.
        // The compiler must reject it before sending any request.
        request: [{ op: 'move_field', from: 'missing_source', to: 'injected' }],
      },
      parameters: {
        type: 'object',
        properties: { user_id: { type: 'string' }, email: { type: 'string' } },
        required: ['user_id', 'email'],
        additionalProperties: false,
      },
    }],
  });
  assert.equal(registered.status, 200);

  const historyBefore = await request(`${coreUrl}/apis/${apiId}/tools/update_user/versions`);
  const stream = await readHaltEvents(coreUrl, apiId, 'provenance-regression');
  const result = await post(`${coreUrl}/apis/${apiId}/tools/update_user/invoke`, {
    args: { user_id: '123', email: 'new@example.com' },
    runId: 'provenance-regression',
  });
  const events = await Promise.race([
    stream.found,
    delay(1500).then(() => { throw new Error('Timed out waiting for terminal provenance events'); }),
  ]);
  await stream.close();
  const audit = await request(`${coreUrl}/audit?apiId=${encodeURIComponent(apiId)}`);
  const historyAfter = await request(`${coreUrl}/apis/${apiId}/tools/update_user/versions`);
  const mockState = await request(`${mockUrl}/admin/state`);

  assert.equal(result.status, 200, 'domain errors must not escape as HTTP 500');
  assert.equal(result.body.ok, false);
  assert.equal(result.body.error.code, 'tool_unavailable');
  assert.equal(result.body.error.details?.reason, 'provenance_violation');
  assert.equal(result.body.error.retryable, false);
  assert.equal(historyBefore.body.versions.length, 1);
  assert.deepEqual(historyAfter.body.versions, historyBefore.body.versions, 'a rejected provenance op must not change adapter history');
  assert.deepEqual(mockState.body.lastRequests, [], 'the invalid request must be rejected before reaching the upstream');
  assert.deepEqual(mockState.body.writes, []);
  const haltAudits = audit.body.records.filter((record) => record.decision === 'halt' && record.reason === 'provenance_violation');
  assert.equal(haltAudits.length, 1, 'one domain halt should create exactly one audit decision');
  const haltEvent = events.find((event) => event.type === 'halt');
  assert.equal(events.filter((event) => event.type === 'call.failed').length, 1);
  assert.equal(events.filter((event) => event.type === 'heal.finished').length, 1);
  assert.equal(haltEvent.reason, 'provenance_violation');
  assert.equal(haltEvent.retryable, false);
  assert.ok(events.every((event) => event.runId === 'provenance-regression'));
});
