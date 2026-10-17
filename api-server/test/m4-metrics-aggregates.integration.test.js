import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import pg from 'pg';
import { createIsolatedDatabase } from './helpers/isolated-database.js';

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
      const response = await fetch(`${baseUrl}/ready`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('api-server did not become ready');
}

async function stopServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 5000))]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await once(child, 'exit');
  }
}

test('M4.3 durable metrics expose persisted rounds, tiers and time-bucket token totals', {
  skip: !process.env.HEALR_TEST_DATABASE_URL,
}, async () => {
  const isolated = await createIsolatedDatabase('m43_aggregates');
  const seedPool = new Pool({ connectionString: isolated.url });
  let child;
  let stderr = '';

  try {
    const { rows: workspaceRows } = await seedPool.query("SELECT id FROM workspaces WHERE slug = 'local' AND deleted_at IS NULL");
    assert.equal(workspaceRows.length, 1);
    const workspaceId = workspaceRows[0].id;
    const now = Date.now();
    const stepSeconds = 3600;
    const currentBucket = Math.floor(now / (stepSeconds * 1000)) * stepSeconds;
    const samples = [
      { suffix: 'a', offset: 0, outcome: 'healed', tier: 'T1', rounds: 2, duration: 120, cache: true, input: 11, output: 7, tokenUsage: { byRole: { diagnoser: { input: 11, output: 7 } }, byTier: { '1': { input: 11, output: 7 } } } },
      { suffix: 'b', offset: 0, outcome: 'halted', tier: null, rounds: 1, duration: 80, cache: false, input: 5, output: 3, summary: { tier2Outcome: 'timeout' } },
      { suffix: 'c', offset: -3600, outcome: 'succeeded', tier: 'T0', rounds: 0, duration: 40, cache: false, input: 2, output: 1 },
    ];
    for (const sample of samples) {
      const startedAt = new Date((currentBucket + sample.offset) * 1000 + 1000).toISOString();
      await seedPool.query(
        `INSERT INTO invocations
          (call_id, workspace_id, started_at, finished_at, outcome, tier, rounds, duration_ms, cache_hit, input_tokens, output_tokens, token_usage, summary)
         VALUES ($1, $2, $3, $3::timestamptz + interval '1 second', $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb)`,
        [`m43-aggregate-${sample.suffix}`, workspaceId, startedAt, sample.outcome, sample.tier, sample.rounds, sample.duration, sample.cache, sample.input, sample.output, JSON.stringify(sample.tokenUsage ?? {}), JSON.stringify(sample.summary ?? {})],
      );
    }
    const { rows: sqlTruth } = await seedPool.query(
      `SELECT count(*)::int AS calls, sum(rounds)::int AS rounds,
         sum(input_tokens)::int AS tokens_in, sum(output_tokens)::int AS tokens_out,
         count(*) FILTER (WHERE tier = 'T0')::int AS tier_t0,
         count(*) FILTER (WHERE tier = 'T1')::int AS tier_t1,
         count(*) FILTER (WHERE tier IS NULL)::int AS tier_unknown
       FROM invocations WHERE workspace_id = $1 AND call_id LIKE 'm43-aggregate-%'`, [workspaceId],
    );
    assert.deepEqual(sqlTruth[0], { calls: 3, rounds: 3, tokens_in: 18, tokens_out: 11, tier_t0: 1, tier_t1: 1, tier_unknown: 1 });

    const port = await unusedPort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const spawnApi = () => spawn(process.execPath, ['src/server.js'], {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, DATABASE_URL: isolated.url, REDIS_URL: '', PORT: String(port), HEALR_CACHE_NAMESPACE: `healr:m43:${isolated.databaseName}` },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    child = spawnApi();
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    await waitReady(baseUrl, child);

    const snapshotResponse = await fetch(`${baseUrl}/metrics`);
    assert.equal(snapshotResponse.status, 200, await snapshotResponse.clone().text());
    const snapshot = await snapshotResponse.json();
    assert.equal(snapshot.calls, 3);
    assert.equal(snapshot.rounds, sqlTruth[0].rounds, 'snapshot rounds should match persisted invocation rows');
    assert.equal(snapshot.tokensIn, sqlTruth[0].tokens_in);
    assert.equal(snapshot.tokensOut, sqlTruth[0].tokens_out);
    assert.equal(snapshot.averageRounds, 1);
    assert.equal(snapshot.averageDurationMs, 80);
    assert.deepEqual(snapshot.tierCounts, { T0: 1, T1: 1, T2: 0, unknown: 1, other: 0 });
    assert.deepEqual(snapshot.tokensByRole.diagnoser, { input: 11, output: 7 });
    assert.deepEqual(snapshot.tokensByTier['1'], { input: 11, output: 7 });
    assert.equal(snapshot.tier2Outcomes.timeout, 1);

    await stopServer(child);
    child = spawnApi();
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    await waitReady(baseUrl, child);
    const restartedSnapshot = await fetch(`${baseUrl}/metrics`).then((response) => response.json());
    assert.deepEqual(restartedSnapshot, snapshot, 'durable metrics must survive an API process restart');

    await seedPool.query(
      `INSERT INTO invocations
        (call_id, workspace_id, started_at, finished_at, outcome, tier, rounds, duration_ms, cache_hit, input_tokens, output_tokens)
       VALUES ($1, $2, $3, $3::timestamptz + interval '1 second', 'succeeded', 'T1', 9, 1000, false, 99, 99)`,
      ['m43-aggregate-future', workspaceId, new Date((currentBucket + stepSeconds + 1) * 1000).toISOString()],
    );

    const seriesResponse = await fetch(`${baseUrl}/metrics/timeseries?window=86400&step=${stepSeconds}`);
    assert.equal(seriesResponse.status, 200, await seriesResponse.clone().text());
    const seriesPayload = await seriesResponse.json();
    const current = seriesPayload.series.find((bucket) => bucket.t === currentBucket);
    const previous = seriesPayload.series.find((bucket) => bucket.t === currentBucket - stepSeconds);
    assert.ok(current, 'current time bucket should include the two current samples');
    assert.ok(previous, 'previous time bucket should include the prior sample');
    assert.equal(current.calls, 2);
    assert.equal(current.rounds, 3);
    assert.equal(current.averageRounds, 1.5);
    assert.equal(current.averageDurationMs, 100);
    assert.equal(current.tokensIn, 16);
    assert.equal(current.tokensOut, 10);
    assert.deepEqual(current.tierCounts, { T0: 0, T1: 1, T2: 0, unknown: 1, other: 0 });
    assert.deepEqual(current.tokensByRole.diagnoser, { input: 11, output: 7 });
    assert.deepEqual(current.tokensByTier['1'], { input: 11, output: 7 });
    assert.equal(current.tier2Outcomes.timeout, 1);
    assert.equal(previous.calls, 1);
    assert.equal(previous.rounds, 0);
    assert.equal(previous.averageRounds, 0);
    assert.equal(previous.averageDurationMs, 40);
    assert.equal(previous.tokensIn, 2);
    assert.equal(previous.tokensOut, 1);
    assert.equal(seriesPayload.series.some((bucket) => bucket.t === currentBucket + stepSeconds), false,
      'future-dated invocations must not appear in the recent time window');
  } catch (error) {
    if (stderr) error.message += `\napi-server stderr:\n${stderr}`;
    throw error;
  } finally {
    if (child) await stopServer(child);
    await seedPool.end();
    const cleanup = await isolated.drop();
    assert.deepEqual(cleanup, { dropped: true, databaseExists: false });
  }
});
