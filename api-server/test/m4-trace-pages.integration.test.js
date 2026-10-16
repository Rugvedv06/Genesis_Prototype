import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import pg from 'pg';
import { createIsolatedDatabase } from './helpers/isolated-database.js';
import { loadEnv } from '../src/lib/env.js';

loadEnv();

const { Pool } = pg;

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
      if ((await fetch(`${baseUrl}/ready`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('api-server did not become ready');
}

async function stopServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 5000))]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await once(child, 'exit');
  }
}

test('M4.4 durable trace pages are bounded and report missing stages and retention', {
  skip: !process.env.HEALR_TEST_DATABASE_URL,
}, async () => {
  const isolated = await createIsolatedDatabase('m44_traces');
  const seedPool = new Pool({ connectionString: isolated.url });
  let child;
  let stderr = '';

  try {
    const { rows: [{ id: workspaceId }] } = await seedPool.query(
      "SELECT id FROM workspaces WHERE slug = 'local' AND deleted_at IS NULL",
    );
    const now = new Date();
    const calls = [
      ['m44-pages', 'succeeded'],
      ['m44-retained-prefix', 'succeeded'],
      ['m44-no-start', 'succeeded'],
      ['m44-no-terminal', 'running'],
      ['m44-pruned-all', 'succeeded'],
    ];
    for (const [callId, outcome] of calls) {
      await seedPool.query(
        `INSERT INTO invocations(call_id, workspace_id, started_at, outcome)
         VALUES ($1, $2, $3, $4)`, [callId, workspaceId, now, outcome],
      );
    }

    async function insertEvents(callId, types) {
      for (let sequence = 0; sequence < types.length; sequence += 1) {
        const type = types[sequence];
        const payload = { callId, type, ts: now.getTime() + sequence, sequenceInCall: sequence };
        await seedPool.query(
          `INSERT INTO gateway_events(event_id, call_id, workspace_id, event_type, occurred_at, sequence_in_call, payload)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
          [`${callId}-${sequence}`, callId, workspaceId, type, now, sequence, JSON.stringify(payload)],
        );
      }
    }

    const manyEvents = ['call.started', ...Array.from({ length: 110 }, () => 'upstream.request'), 'call.succeeded'];
    await insertEvents('m44-pages', manyEvents);
    await insertEvents('m44-retained-prefix', ['call.started', 'upstream.request', 'upstream.request', 'call.succeeded']);
    await insertEvents('m44-no-start', ['upstream.request', 'call.succeeded']);
    await insertEvents('m44-no-terminal', ['call.started', 'upstream.request']);
    await insertEvents('m44-pruned-all', ['call.started', 'upstream.request', 'call.succeeded']);

    const { rows: deletedRows } = await seedPool.query(
      `DELETE FROM gateway_events WHERE call_id = 'm44-retained-prefix' AND sequence_in_call < 2 RETURNING id`,
    );
    assert.equal(deletedRows.length, 2, 'retention setup must remove both prefix rows');
    // The deleted event ID is the floor; other seeded calls are intentionally left intact.
    const floor = deletedRows.reduce((max, row) => BigInt(row.id) > max ? BigInt(row.id) : max, 0n);
    await seedPool.query(
      `UPDATE gateway_event_cursors SET retention_floor = $2, last_committed_id = GREATEST(last_committed_id, $2)
       WHERE workspace_id = $1`, [workspaceId, floor.toString()],
    );
    const { rows: allPruned } = await seedPool.query(
      `DELETE FROM gateway_events WHERE call_id = 'm44-pruned-all' RETURNING id`,
    );
    const allPrunedFloor = allPruned.reduce((max, row) => BigInt(row.id) > max ? BigInt(row.id) : max, floor);
    await seedPool.query(
      `UPDATE gateway_event_cursors SET retention_floor = $2, last_committed_id = GREATEST(last_committed_id, $2)
       WHERE workspace_id = $1`, [workspaceId, allPrunedFloor.toString()],
    );

    const port = await unusedPort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const spawnApi = () => {
      const server = spawn(process.execPath, ['src/server.js'], {
        cwd: new URL('..', import.meta.url),
        env: { ...process.env, DATABASE_URL: isolated.url, REDIS_URL: '', PORT: String(port), HEALR_CACHE_NAMESPACE: `healr:m44:${isolated.databaseName}` },
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      server.stderr.setEncoding('utf8');
      server.stderr.on('data', (chunk) => { stderr += chunk; });
      return server;
    };
    child = spawnApi();
    await waitReady(baseUrl, child);

    const getTrace = async (callId, query = '') => {
      const response = await fetch(`${baseUrl}/traces/${callId}${query}`);
      const body = await response.json();
      return { status: response.status, body };
    };

    const first = await getTrace('m44-pages', '?limit=100&cursor=0');
    assert.equal(first.status, 200, stderr);
    assert.equal(first.body.spans.length, 100, 'first response must not exceed the 100-span cap');
    assert.deepEqual(first.body.spans.map((span) => span.type), Array(100).fill('upstream.request'));
    assert.equal(first.body.complete, false);
    assert.equal(first.body.incompleteReason, 'page_truncated');
    assert.equal(first.body.nextCursor, '101');

    await stopServer(child);
    child = spawnApi();
    await waitReady(baseUrl, child);
    const second = await getTrace('m44-pages', `?limit=100&cursor=${first.body.nextCursor}`);
    assert.equal(second.status, 200);
    assert.equal(second.body.spans.length, 11);
    assert.deepEqual(second.body.spans.slice(-1).map((span) => span.type), ['call.succeeded']);
    assert.equal(second.body.complete, false, 'a later page is not independently a complete trace');
    assert.equal(second.body.incompleteReason, 'page_continues');
    assert.equal(second.body.nextCursor, null);

    const retained = await getTrace('m44-retained-prefix');
    assert.equal(retained.status, 200);
    assert.equal(retained.body.complete, false);
    assert.equal(retained.body.incompleteReason, 'retention_boundary');
    assert.deepEqual(retained.body.spans.map((span) => span.type), ['upstream.request', 'call.succeeded']);
    const retentionGap = await getTrace('m44-retained-prefix', '?cursor=1');
    assert.equal(retentionGap.body.incomplete, true);
    assert.equal(retentionGap.body.incompleteReason, 'retention_boundary', 'a missing continuation prefix is explicit');
    const fullyPruned = await getTrace('m44-pruned-all');
    assert.equal(fullyPruned.status, 200, 'an invocation whose events were entirely pruned retains an incomplete trace shell');
    assert.equal(fullyPruned.body.incompleteReason, 'retention_boundary');
    assert.deepEqual(fullyPruned.body.spans, []);

    const noStart = await getTrace('m44-no-start');
    assert.equal(noStart.body.complete, false);
    assert.equal(noStart.body.incompleteReason, 'start_event_missing');
    const noTerminal = await getTrace('m44-no-terminal');
    assert.equal(noTerminal.body.complete, false);
    assert.equal(noTerminal.body.incompleteReason, 'terminal_event_missing');

    for (const query of ['?limit=0', '?limit=101', '?limit=nope', '?cursor=-1', '?cursor=1.5']) {
      const malformed = await getTrace('m44-pages', query);
      assert.equal(malformed.status, 400, `${query} must be rejected`);
    }
  } finally {
    await stopServer(child);
    await seedPool.end();
    const cleanup = await isolated.drop();
    assert.deepEqual(cleanup, { dropped: true, databaseExists: false });
  }
});
