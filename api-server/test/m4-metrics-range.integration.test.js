import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { createIsolatedDatabase } from './helpers/isolated-database.js';

async function unusedPort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitReady(baseUrl, child) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`api-server exited early (${child.exitCode})`);
    try {
      const response = await fetch(`${baseUrl}/ready`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('api-server did not become ready');
}

test('M4.3 timeseries HTTP route accepts defaults and bounds, rejects invalid range arguments', {
  skip: !process.env.HEALR_TEST_DATABASE_URL,
}, async () => {
  const isolated = await createIsolatedDatabase('m43_metrics');
  let child;
  let stderr = '';

  try {
    const port = await unusedPort();
    const baseUrl = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ['src/server.js'], {
      cwd: new URL('..', import.meta.url),
      env: {
        ...process.env,
        DATABASE_URL: isolated.url,
        REDIS_URL: '',
        PORT: String(port),
        HEALR_CACHE_NAMESPACE: `healr:m43:${isolated.databaseName}`,
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    await waitReady(baseUrl, child);
    const validQueries = [
      ['', 'defaults'],
      ['?window=1&step=1', 'minimum bounds'],
      ['?window=2592000&step=86400', 'maximum bounds'],
    ];
    for (const [query, label] of validQueries) {
      const response = await fetch(`${baseUrl}/metrics/timeseries${query}`);
      assert.equal(response.status, 200, `${label} should be accepted`);
      assert.ok(Array.isArray((await response.json()).series), `${label} should return a series`);
    }

    const invalidQueries = [
      '?window=nope', '?window=1.5', '?window=0', '?window=-1', '?window=2592001',
      '?window=9007199254740992', '?window=1&window=2',
      '?window=2592000&step=1', '?window=10000&step=1',
      '?step=nope', '?step=1.5', '?step=0', '?step=-1', '?step=86401',
      '?step=9007199254740992', '?step=1&step=2',
    ];
    for (const query of invalidQueries) {
      const response = await fetch(`${baseUrl}/metrics/timeseries${query}`);
      assert.equal(response.status, 400, `${query} should be rejected; received ${response.status}`);
      assert.deepEqual(await response.json(), { ok: false, error: 'invalid_arguments' });
    }
  } catch (error) {
    if (stderr) error.message += `\napi-server stderr:\n${stderr}`;
    throw error;
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 5000))]);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await once(child, 'exit');
      }
    }
    const cleanup = await isolated.drop();
    assert.deepEqual(cleanup, { dropped: true, databaseExists: false });
  }
});
