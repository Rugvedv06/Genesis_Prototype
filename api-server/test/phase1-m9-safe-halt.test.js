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
  return spawn(process.execPath, [entry], {
    cwd,
    env,
    stdio: 'ignore',
  });
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

async function readEventSnapshot(url, expectedReason, expectedCount = 2) {
  const controller = new AbortController();
  let body = '';
  const timer = setTimeout(() => controller.abort(), 1000);
  try {
    const eventUrl = url.replace('types=halt', 'types=halt,heal.finished');
    const response = await fetch(eventUrl, { signal: controller.signal });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (
      (body.match(new RegExp(`\\"reason\\":\\"${expectedReason}\\"`, 'g')) ?? []).length < expectedCount
      || (body.match(/"type":"heal\.finished"/g) ?? []).length < expectedCount
    ) {
      const { value, done } = await reader.read();
      if (done) break;
      body += decoder.decode(value, { stream: true });
    }
    return body;
  } catch (error) {
    if (error.name === 'AbortError') return body;
    throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function waitForHealth(url, children) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (children.some((child) => child.exitCode !== null)) {
      throw new Error('A test server exited before becoming healthy');
    }
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${url}/health`);
}

<<<<<<< HEAD
test('M9 authorization and approval-code failures halt safely and remain write-free on repeat', {
  skip: !process.env.HEALR_TEST_DATABASE_URL && 'set HEALR_TEST_DATABASE_URL to run isolated PostgreSQL runtime coverage',
}, async (t) => {
  const isolatedDb = await createIsolatedDatabase('m9');
  let dataDir;
  let core;
  let mock;
  t.after(async () => {
    await Promise.all([stop(core), stop(mock)]);
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
    assert.deepEqual(await isolatedDb.drop(), { dropped: true, databaseExists: false }, 'isolated M9 database is dropped');
  });
  dataDir = mkdtempSync(join(tmpdir(), 'healr-m9-safe-halt-'));
=======
test('M9 authorization and approval-code failures halt safely and remain write-free on repeat', async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'healr-m9-safe-halt-'));
>>>>>>> origin/main
  const corePort = await freePort();
  const mockPort = await freePort([corePort]);
  const coreUrl = `http://127.0.0.1:${corePort}`;
  const mockUrl = `http://127.0.0.1:${mockPort}`;
  const baseEnv = { ...process.env };
  delete baseEnv.M9_TEST_BEARER;
  delete baseEnv.M9_MISSING_BEARER;
  const env = {
    ...baseEnv,
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
    MAX_HEAL_ROUNDS: '2',
    HEAL_TIMEOUT_MS: '2000',
    M9_TEST_BEARER: 'test-only-bearer',
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
  await post(`${mockUrl}/admin/reset`, {});
  await post(`${mockUrl}/admin/mutate`, { id: 'M9' });

  const tool = {
    name: 'update_user_email',
    method: 'POST',
    path: '/api/users/update-email',
    risk: 'high',
    sideEffects: 'write',
    adapter: {
      request: [{ op: 'add_header', name: 'Authorization', source: { type: 'credential', ref: 'Authorization' } }],
    },
    parameters: {
      type: 'object',
      properties: { user_id: { type: 'string' }, email: { type: 'string' } },
      required: ['user_id', 'email'],
      additionalProperties: false,
    },
  };

  const registrations = [
    {
      apiId: 'm9-missing-auth',
      credentials: { Authorization: { env: 'M9_MISSING_BEARER' } },
      healing: { enabled: true, mode: 'enforce', maxRounds: 2 },
      tools: [tool],
    },
    {
      apiId: 'm9-missing-approval',
      credentials: { Authorization: { env: 'M9_TEST_BEARER' } },
      healing: { enabled: true, mode: 'enforce', maxRounds: 2 },
      tools: [tool],
    },
  ];

  // For the first API the credential source is deliberately unset. This proves
  // that the gateway fails closed before it can send an unauthenticated write.
  for (const registration of registrations) {
    const response = await post(`${coreUrl}/apis`, { ...registration, baseUrl: mockUrl, specUrl: `${mockUrl}/openapi.json` });
    assert.equal(response.status, 200, `registration failed for ${registration.apiId}: ${JSON.stringify(response.body)}`);
  }

  const args = { user_id: '123', email: 'new@example.com' };
  const missingAuthResults = [];
  missingAuthResults.push(await post(
    `${coreUrl}/apis/m9-missing-auth/tools/update_user_email/invoke`,
    { args, runId: 'm9-auth-1' },
  ));
  const authRepeatStarted = performance.now();
  missingAuthResults.push(await post(
    `${coreUrl}/apis/m9-missing-auth/tools/update_user_email/invoke`,
    { args, runId: 'm9-auth-2' },
  ));
  const authRepeatMs = performance.now() - authRepeatStarted;

  for (const result of missingAuthResults) {
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, false);
    assert.equal(result.body.error.details?.reason, 'credential_unavailable');
    assert.equal(result.body.error.retryable, false);
  }
  assert.ok(authRepeatMs < 50, `cached missing credential halt took ${authRepeatMs.toFixed(1)}ms`);

  const authAudit = await request(`${coreUrl}/audit?apiId=m9-missing-auth`);
<<<<<<< HEAD
  const authHalts = authAudit.body.records.filter((record) => record.decision === 'halt');
  assert.equal(authHalts.length, 2, 'each missing credential attempt should have a halt decision');
  assert.ok(authHalts.every((record) => record.reason === 'credential_unavailable'));
=======
  assert.equal(authAudit.body.records.length, 2, 'each missing credential halt should be audited');
  assert.ok(authAudit.body.records.every((record) => record.decision === 'halt' && record.reason === 'credential_unavailable'));
>>>>>>> origin/main
  assert.equal((await request(`${coreUrl}/audit/verify`)).body.ok, true);
  const authEvents = await readEventSnapshot(`${coreUrl}/events?apiId=m9-missing-auth&types=halt`, 'credential_unavailable');
  assert.equal((authEvents.match(/"reason":"credential_unavailable"/g) ?? []).length, 2, 'each missing credential halt should emit an event');
  assert.equal((authEvents.match(/"type":"heal\.finished"/g) ?? []).length, 2, 'each missing credential call should finish its lifecycle');

  const stateAfterMissingAuth = await request(`${mockUrl}/admin/state`);
  assert.deepEqual(stateAfterMissingAuth.body.writes, [], 'missing Authorization must not issue a write');
  assert.deepEqual(stateAfterMissingAuth.body.lastRequests, [], 'missing Authorization must halt before sending upstream');

  const repairedConfig = await post(`${coreUrl}/apis`, {
    ...registrations[0],
    credentials: { Authorization: { env: 'M9_TEST_BEARER' } },
    baseUrl: mockUrl,
    specUrl: `${mockUrl}/openapi.json`,
  });
  assert.equal(repairedConfig.body.ok, true, 'API re-registration should accept repaired credentials');
  await post(`${mockUrl}/admin/reset`, {});
  const afterCredentialRepair = await post(
    `${coreUrl}/apis/m9-missing-auth/tools/update_user_email/invoke`,
    { args, runId: 'm9-auth-repaired' },
  );
  assert.equal(afterCredentialRepair.body.ok, true, `a repaired credential must bypass stale negative-cache state: ${JSON.stringify(afterCredentialRepair.body)}`);
  await post(`${mockUrl}/admin/reset`, {});
  await post(`${mockUrl}/admin/mutate`, { id: 'M9' });

  // The approval-code case is independent: provide a valid configured bearer
  // credential so M9 reaches its body validation, while omitting approval_code.
  const missingApprovalResults = [];
  missingApprovalResults.push(await post(
    `${coreUrl}/apis/m9-missing-approval/tools/update_user_email/invoke`,
    { args, runId: 'm9-approval-1' },
  ));
  const approvalRepeatStarted = performance.now();
  missingApprovalResults.push(await post(
    `${coreUrl}/apis/m9-missing-approval/tools/update_user_email/invoke`,
    { args, runId: 'm9-approval-2' },
  ));
  const approvalRepeatMs = performance.now() - approvalRepeatStarted;
  for (const [index, result] of missingApprovalResults.entries()) {
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, false);
    assert.equal(result.body.error.details?.reason, 'no_diagnosis');
    assert.equal(result.body.error.retryable, false);
  }
  assert.ok(approvalRepeatMs < 50, `cached approval-code halt took ${approvalRepeatMs.toFixed(1)}ms`);
  const approvalAudit = await request(`${coreUrl}/audit?apiId=m9-missing-approval`);
<<<<<<< HEAD
  const approvalHalts = approvalAudit.body.records.filter((record) => record.decision === 'halt');
  assert.equal(approvalHalts.length, 2, 'each approval-code attempt should have a halt decision');
  assert.ok(approvalHalts.every((record) => record.reason === 'no_diagnosis'));
=======
  assert.equal(approvalAudit.body.records.length, 2, 'each approval-code halt should be audited');
  assert.ok(approvalAudit.body.records.every((record) => record.decision === 'halt' && record.reason === 'no_diagnosis'));
>>>>>>> origin/main
  const approvalEvents = await readEventSnapshot(`${coreUrl}/events?apiId=m9-missing-approval&types=halt`, 'no_diagnosis');
  assert.equal((approvalEvents.match(/"reason":"no_diagnosis"/g) ?? []).length, 2, 'each approval-code halt should emit an event');
  assert.equal((approvalEvents.match(/"type":"heal\.finished"/g) ?? []).length, 2, 'each cached approval-code halt should finish its lifecycle');

  const deleteApi = await request(`${coreUrl}/apis/m9-missing-approval`, { method: 'DELETE' });
  assert.equal(deleteApi.body.ok, true);
  const reRegistered = await post(`${coreUrl}/apis`, {
    ...registrations[1],
    baseUrl: mockUrl,
    specUrl: `${mockUrl}/openapi.json`,
  });
  assert.equal(reRegistered.body.ok, true);
  const afterReset = await post(
    `${coreUrl}/apis/m9-missing-approval/tools/update_user_email/invoke`,
    { args, runId: 'm9-approval-reregistered' },
  );
  assert.equal(afterReset.body.error.details?.reason, 'no_diagnosis');

  const finalMockState = await request(`${mockUrl}/admin/state`);
  assert.deepEqual(finalMockState.body.writes, [], 'missing approval_code must not issue a write');
  assert.equal(finalMockState.body.lastRequests.length, 2, 'the cached repeat is skipped; deleting and re-registering clears the negative cache');
  assert.deepEqual(finalMockState.body.lastRequests.map((entry) => entry.status), [422, 422]);
  assert.equal((await request(`${mockUrl}/admin/truth/users/123`)).body.email, 'asha@example.com');
});
