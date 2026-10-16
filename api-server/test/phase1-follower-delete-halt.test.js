import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('heal-lock follower deleted API receives terminal not_registered halt lifecycle', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'healr-follower-delete-'));
  const previousDataDir = process.env.HEALR_DATA_DIR;
  process.env.HEALR_DATA_DIR = dataDir;
  try {
    const [{ withHealLock }, { registryStore }, { bus }, audit] = await Promise.all([
      import('../src/features/executor/invoke.js'),
      import('../src/features/registry/store.js'),
      import('../src/features/events/bus.js'),
      import('../src/features/audit/index.js'),
    ]);
    const apiId = 'deleted-follower-regression';
    const toolName = 'write_record';
    registryStore.reset();
    bus.clear();
    registryStore.registerApi(apiId, {
      baseUrl: 'http://localhost:5999',
      tools: [{ name: toolName, path: '/records', method: 'POST', parameters: { type: 'object' } }],
    });

    let releaseLeader;
    const leaderBarrier = new Promise((resolve) => { releaseLeader = resolve; });
    const leaderRun = withHealLock(apiId, toolName, () => leaderBarrier, {}, {
      callId: 'delete-race-leader', runId: 'delete-race-leader-run', t0: Date.now(),
    });
    const followerRun = withHealLock(apiId, toolName, async () => ({ ok: true }), { id: 2 }, {
      callId: 'delete-race-follower', runId: 'delete-race-follower-run', t0: Date.now(),
    });

    registryStore.removeApi(apiId);
    releaseLeader({ ok: true });
    await leaderRun;
    const follower = await followerRun;

    assert.equal(follower.follower, true);
    assert.equal(follower.result.error.details.reason, 'not_registered');
    const events = bus.since(0).filter((event) => event.runId === 'delete-race-follower-run');
    const failed = events.find((event) => event.type === 'call.failed');
    const halted = events.find((event) => event.type === 'halt');
    const finished = events.find((event) => event.type === 'heal.finished');
    assert.ok(failed);
    assert.ok(halted);
    assert.ok(finished);
    assert.equal(failed.reason, 'not_registered');
    assert.equal(halted.reason, 'not_registered');
    assert.equal(finished.outcome, 'halted');
    assert.equal(failed.callId, halted.callId);
    assert.equal(halted.callId, finished.callId);
    const records = audit.list({ decision: 'halt', apiId, tool: toolName });
    assert.equal(records.length, 1);
    assert.equal(records[0].reason, 'not_registered');
  } finally {
    if (previousDataDir === undefined) delete process.env.HEALR_DATA_DIR;
    else process.env.HEALR_DATA_DIR = previousDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  }
});
