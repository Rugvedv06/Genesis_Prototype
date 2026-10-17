function errorMessage(payload, status) {
  if (typeof payload?.error === 'string') return payload.error;
  if (payload?.error?.message) return payload.error.message;
  if (typeof payload?.message === 'string') return payload.message;
  return `Request failed with HTTP ${status}`;
}

async function readPayload(response) {
  try { return await response.json(); } catch { return null; }
}

export async function runUnmutatedComparison({
  mockUrl, coreUrl, apiId, tool, args, baselineRunId, healedRunId, fetchImpl = fetch,
}) {
  const baselineStarted = Date.now();
  let baselineResponse;
  let baselinePayload;
  try {
    const method = String(tool.method ?? 'POST').toUpperCase();
    baselineResponse = await fetchImpl(`${mockUrl.replace(/\/$/, '')}${tool.path}`, {
      method,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      ...(method === 'GET' || method === 'HEAD' ? {} : { body: JSON.stringify(args ?? {}) }),
    });
    baselinePayload = await readPayload(baselineResponse);
  } catch (error) {
    baselinePayload = { error: String(error?.message ?? error) };
  }
  const baselineOk = Boolean(baselineResponse?.ok);
  const baselineElapsed = Date.now() - baselineStarted;
  const baseline = {
    status: baselineOk ? 'ok' : 'fail', iterations: 1, elapsed: baselineElapsed,
    data: baselineOk ? baselinePayload : null,
    error: baselineOk ? null : errorMessage(baselinePayload, baselineResponse?.status ?? 0),
    mode: 'direct', provider: null, model: null,
    events: [
      { type: 'agent.step', runId: baselineRunId, iteration: 1, tool: tool.name, mode: 'direct' },
      { type: baselineOk ? 'call.succeeded' : 'call.failed', runId: baselineRunId, tool: tool.name, status: baselineResponse?.status ?? 0, mode: 'direct' },
      { type: 'agent.final', runId: baselineRunId, outcome: baselineOk ? 'success' : 'error', status: baselineResponse?.status ?? 0, iterations: 1, mode: 'direct' },
    ],
  };

  const healedStarted = Date.now();
  let healedResponse;
  let healedPayload;
  try {
    healedResponse = await fetchImpl(`${coreUrl.replace(/\/$/, '')}/tasks`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiId, runId: healedRunId }),
    });
    healedPayload = await readPayload(healedResponse);
  } catch (error) {
    healedPayload = { error: String(error?.message ?? error) };
  }
  const healedOk = Boolean(healedResponse?.ok && healedPayload?.ok);
  const healed = {
    status: healedOk ? 'ok' : 'fail', rounds: healedPayload?.step ?? 0,
    elapsed: Date.now() - healedStarted, data: healedPayload?.data ?? null,
    error: healedOk ? null : errorMessage(healedPayload, healedResponse?.status ?? 0),
    ops: [], version: null,
  };
  return { baseline, healed };
}
