const FINISHED_TTL_MS = 10 * 60_000;
const MAX_RETAINED_RUNS = 256;
const runs = new Map();

function prune(now = Date.now()) {
  for (const [id, run] of runs) if (run.status !== 'running' && now - run.finishedAt > FINISHED_TTL_MS) runs.delete(id);
  while (runs.size > MAX_RETAINED_RUNS) {
    const oldest = [...runs].find(([, run]) => run.status !== 'running');
    if (!oldest) break;
    runs.delete(oldest[0]);
  }
}

export function activeRunCount() {
  return [...runs.values()].filter((run) => run.status === 'running').length;
}

export function startRun({ runId, apiId, execute }) {
  prune();
  if (runs.has(runId)) return { duplicate: true, run: runs.get(runId) };
  const run = { runId, apiId, status: 'running', startedAt: Date.now(), finishedAt: null, result: null, controller: new AbortController() };
  runs.set(runId, run);
  run.promise = Promise.resolve().then(() => execute(run.controller.signal)).then((result) => {
    run.status = result.outcome === 'completed' ? 'completed' : result.outcome;
    run.result = result;
    return result;
  }).catch((error) => {
    run.status = 'error';
    run.result = { runId, apiId, outcome: 'error', error: { code: error.code ?? 'agent_error', message: error.message ?? 'Agent run failed' } };
    return run.result;
  }).finally(() => {
    run.finishedAt = Date.now();
    prune();
  });
  return { duplicate: false, run };
}

export function getRun(runId) {
  prune();
  const run = runs.get(runId);
  if (!run) return null;
  return { runId: run.runId, apiId: run.apiId, status: run.status, startedAt: run.startedAt, finishedAt: run.finishedAt, result: run.result };
}

export function cancelRun(runId) {
  const run = runs.get(runId);
  if (!run) return { found: false, cancelled: false };
  if (run.status !== 'running') return { found: true, cancelled: false, status: run.status };
  run.controller.abort();
  return { found: true, cancelled: true, status: 'cancelling' };
}

export function getRunPromise(runId) { return runs.get(runId)?.promise ?? null; }
