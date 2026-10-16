import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SERVER_ENTRY = fileURLToPath(new URL('../src/server.js', import.meta.url));
const SERVER_CWD = dirname(dirname(SERVER_ENTRY));

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
      const port = probe.address().port;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForHealth(url, child) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('demo server exited before becoming healthy');
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('timed out waiting for isolated demo server');
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      resolve();
    }, 2500)),
  ]);
}

test('GET /admin/mutations exposes the ordered M1-M10 catalogue contract', async (t) => {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: SERVER_CWD,
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore',
  });
  t.after(() => stop(child));
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(baseUrl, child);

  const response = await fetch(`${baseUrl}/admin/mutations`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.mutations.map(({ id }) => id), [
    'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'M10',
  ]);

  const expected = {
    M1: { category: 'request', method: 'POST', path: '/api/users/get', recoverable: true, expected: 'heal', expectedOps: ['rename_field'], args: { user_id: '123' } },
    M2: { category: 'request', method: 'POST', path: '/api/users/get', recoverable: true, expected: 'heal', expectedOps: ['coerce_type'], args: { user_id: '123' } },
    M3: { category: 'request', method: 'POST', path: '/api/users/get', recoverable: true, expected: 'heal', expectedOps: ['move_field'], args: { user_id: '123' } },
    M4: { category: 'request', method: 'POST', path: '/api/users/get', recoverable: true, expected: 'heal', expectedOps: ['add_header'], args: { user_id: '123' } },
    M5: { category: 'request', method: 'POST', path: '/api/users/get', recoverable: true, expected: 'heal', expectedOps: ['add_header', 'move_field', 'rename_field', 'coerce_type'], args: { user_id: '123' } },
    M6: { category: 'response', method: 'POST', path: '/api/users/get', recoverable: true, expected: 'heal', expectedOps: [{ op: 'remap_response_path', logical: 'name', from: 'result.name', to: 'result.data.profile.name' }], args: { user_id: '123' } },
    M7: { category: 'request', method: 'POST', path: '/api/users/get', recoverable: true, expected: 'heal', expectedOps: ['add_field'], args: { user_id: '123' } },
    M8: { category: 'request', method: 'POST', path: '/api/users/set-status', recoverable: true, expected: 'heal', expectedOps: ['set_enum_map'], args: { user_id: '123', status: 'active' } },
    M9: { category: 'unrecoverable', method: 'POST', path: '/api/users/update-email', recoverable: false, expected: 'halt', expectedOps: [], args: { user_id: '123', email: 'asha+demo@example.com' } },
    M10: { category: 'response', method: 'POST', path: '/api/users/get', recoverable: true, expected: 'heal', expectedOps: [{ op: 'remap_response_path', logical: 'name', from: 'result.name', to: 'result.full_name' }], args: { user_id: '123' } },
  };

  for (const mutation of payload.mutations) {
    const contract = expected[mutation.id];
    assert.ok(mutation.label.length > 0, `${mutation.id} label is required`);
    assert.ok(mutation.category.length > 0, `${mutation.id} category is required`);
    assert.deepEqual(mutation.route, { method: contract.method, path: contract.path }, `${mutation.id} route`);
    assert.equal(mutation.category, contract.category, `${mutation.id} category`);
    assert.equal(mutation.recoverable, contract.recoverable, `${mutation.id} recoverability`);
    assert.equal(mutation.expected, contract.expected, `${mutation.id} expected result`);
    assert.deepEqual(mutation.expectedOps, contract.expectedOps, `${mutation.id} exact expected operations`);
    assert.deepEqual(mutation.fixture, { args: contract.args }, `${mutation.id} demo fixture args`);
    assert.deepEqual(mutation.specVariants, [
      { id: 'active', specAvailable: true, specStale: false },
      { id: 'stale', specAvailable: true, specStale: true, description: 'OpenAPI remains at the baseline contract' },
      { id: 'unavailable', specAvailable: false, specStale: false, description: 'OpenAPI endpoint returns spec_unavailable' },
    ], `${mutation.id} exact spec variant states`);
  }
  assert.deepEqual(payload.mutations.filter(({ expected: outcome }) => outcome === 'halt').map(({ id }) => id), ['M9']);

  const postJson = (path, body) => fetch(`${baseUrl}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const readSpec = async (expectedStatus = 200) => {
    const result = await fetch(`${baseUrl}/openapi.json`);
    assert.equal(result.status, expectedStatus);
    return result.json();
  };

  const reset = await postJson('/admin/reset', {});
  assert.equal(reset.status, 200);
  const baseline = await readSpec();
  assert.equal(baseline['x-healr-active-mutation'], null);
  assert.equal(baseline['x-healr-spec-stale'], undefined);
  assert.equal(baseline.paths['/api/users/get'].post.requestBody.content['application/json'].schema.properties.region, undefined);
  const baselineStatus = baseline.paths['/api/users/set-status'].post.requestBody.content['application/json'].schema.properties.status;
  assert.equal(baselineStatus.enum, undefined);
  assert.equal(baselineStatus['x-healr-enum-aliases'], undefined);

  const selectM7 = await postJson('/admin/mutate', { id: 'M7' });
  assert.equal(selectM7.status, 200);
  const activeM7 = await readSpec();
  assert.equal(activeM7['x-healr-active-mutation'], 'M7');
  const region = activeM7.paths['/api/users/get'].post.requestBody.content['application/json'].schema.properties.region;
  assert.equal(region.type, 'string');
  assert.equal(region.default, 'IN');
  assert.deepEqual(activeM7.paths['/api/users/get'].post.requestBody.content['application/json'].schema.required, ['user_id', 'region']);

  const selectM8 = await postJson('/admin/mutate', { id: 'M8' });
  assert.equal(selectM8.status, 200);
  const activeM8 = await readSpec();
  assert.equal(activeM8['x-healr-active-mutation'], 'M8');
  const status = activeM8.paths['/api/users/set-status'].post.requestBody.content['application/json'].schema.properties.status;
  assert.deepEqual(status.enum, ['ENABLED', 'DISABLED']);
  assert.deepEqual(status['x-healr-enum-aliases'], { active: 'ENABLED', inactive: 'DISABLED' });

  await postJson('/admin/mutate', { id: 'M7' });
  const staleConfig = await postJson('/admin/config', { specStale: true });
  assert.deepEqual((await staleConfig.json()).config, { errorStyle: 'pydantic-v1', specAvailable: true, specStale: true });
  const stale = await readSpec();
  assert.equal(stale['x-healr-spec-stale'], true);
  assert.equal(stale['x-healr-active-mutation'], null, 'stale response must not expose active mutation details');
  const staleRegion = stale.paths['/api/users/get'].post.requestBody.content['application/json'].schema.properties.region;
  assert.equal(staleRegion, undefined, 'stale response is baseline and has no M7 default');
  assert.equal(stale.paths['/api/users/set-status'].post.requestBody.content['application/json'].schema.properties.status.enum, undefined);

  const unavailableConfig = await postJson('/admin/config', { specAvailable: false });
  assert.deepEqual((await unavailableConfig.json()).config, { errorStyle: 'pydantic-v1', specAvailable: false, specStale: true });
  assert.deepEqual(await readSpec(404), { error: 'spec_unavailable' });
  const availableAgain = await postJson('/admin/config', { specAvailable: true });
  assert.deepEqual((await availableAgain.json()).config, { errorStyle: 'pydantic-v1', specAvailable: true, specStale: true });
  const stillStale = await readSpec();
  assert.equal(stillStale['x-healr-spec-stale'], true, 'changing availability must preserve the explicit stale toggle');

  const finalReset = await postJson('/admin/reset', {});
  assert.equal(finalReset.status, 200);
  const resetSpec = await readSpec();
  assert.equal(resetSpec['x-healr-active-mutation'], null);
  assert.equal(resetSpec['x-healr-spec-stale'], undefined);
  assert.equal(resetSpec.paths['/api/users/get'].post.requestBody.content['application/json'].schema.properties.region, undefined);
  assert.equal(resetSpec.paths['/api/users/set-status'].post.requestBody.content['application/json'].schema.properties.status.enum, undefined);
});

test('M6 and M10 change observed response paths while admin truth stays canonical', async (t) => {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: SERVER_CWD,
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore',
  });
  t.after(() => stop(child));
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(baseUrl, child);

  const postJson = (path, body) => fetch(`${baseUrl}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const readTruth = async () => {
    const response = await fetch(`${baseUrl}/admin/truth/users/123`);
    assert.equal(response.status, 200);
    return response.json();
  };

  for (const { mutation, observed } of [
    {
      mutation: 'M6',
      observed: { result: { id: '123', email: 'asha@example.com', data: { profile: { name: 'Asha Rao' } } } },
    },
    {
      mutation: 'M10',
      observed: { result: { id: '123', email: 'asha@example.com', full_name: 'Asha Rao' } },
    },
  ]) {
    const reset = await postJson('/admin/reset', {});
    assert.equal(reset.status, 200);
    const selectMutation = await postJson('/admin/mutate', { id: mutation });
    assert.equal(selectMutation.status, 200);

    const response = await postJson('/api/users/get', { user_id: '123' });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), observed, `${mutation} exact observed response paths`);

    assert.deepEqual(await readTruth(), {
      id: '123', name: 'Asha Rao', email: 'asha@example.com', status: 'active',
    }, `${mutation} must not mutate canonical admin truth`);
  }
});
