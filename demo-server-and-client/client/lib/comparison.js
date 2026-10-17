function errorMessage(payload, status) {
  if (typeof payload?.error === 'string') return payload.error;
  if (payload?.error?.message) return payload.error.message;
  if (typeof payload?.message === 'string') return payload.message;
  return `Request failed with HTTP ${status}`;
}

export function describeAgentFinal(event = {}) {
  const completed = event.outcome === 'success' || event.outcome === 'completed';
  const code = typeof event.error === 'string' ? event.error : event.error?.code;
  if (event.mode === 'direct') {
    return {
      label: completed ? 'Direct baseline request accepted' : 'Direct baseline request failed',
      detail: `Raw API request · HTTP ${event.status ?? 0}`,
      success: completed,
    };
  }
  if (completed) return {
    label: `Baseline completed in ${event.iterations ?? 0} iterations`,
    detail: 'Agent returned a final answer.',
    success: true,
  };
  if (code === 'quota_or_rate_limit') return {
    label: 'Baseline agent stopped: provider rate limit',
    detail: 'The model provider throttled the agent; this does not mean the API rejected the upstream requests.',
    success: false,
  };
  if (code === 'iteration_limit' || event.outcome === 'step_limit') return {
    label: `Baseline agent stopped at iteration limit (${event.iterations ?? 0})`,
    detail: 'The agent did not finish; upstream results are shown separately above.',
    success: false,
  };
  return {
    label: `Baseline agent stopped${code ? `: ${code}` : ''}`,
    detail: event.error?.message ?? 'The agent did not return a final answer; inspect upstream results above.',
    success: false,
  };
}

export function describeFailureNotice(error, side, mode) {
  const code = error?.code ?? error?.error ?? (typeof error === 'string' ? error : null);
  if (code === 'quota_or_rate_limit') return side === 'healed'
    ? 'Provider rate limit stopped healing; no verified commit was completed.'
    : 'Provider rate limit stopped the baseline agent; upstream HTTP results are shown separately.';
  if (code === 'iteration_limit' || code === 'step_limit') return side === 'healed'
    ? 'Agent iteration limit reached before the task completed.'
    : 'Baseline agent iteration limit reached; upstream HTTP results are shown separately.';
  if (mode === 'direct') return 'Direct request was rejected by the API.';
  return side === 'healed'
    ? 'Healing stopped before a verified request completed.'
    : 'Baseline task did not complete.';
}

async function readPayload(response) {
  try { return await response.json(); } catch { return null; }
}

export async function runHealthyComparison({
  mockUrl, coreUrl, apiId, tool, args, baselineRunId, healedRunId, fetchImpl = fetch,
}) {
  const method = String(tool.method ?? 'POST').toUpperCase();
  const baselineStarted = Date.now();
  let baselineResponse;
  let baselinePayload;
  try {
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
    statusCode: baselineResponse?.status ?? 0,
    data: baselineOk ? baselinePayload : null,
    error: baselineOk ? null : errorMessage(baselinePayload, baselineResponse?.status ?? 0),
    mode: 'direct', provider: null, model: null,
    request: { method, url: `${mockUrl.replace(/\/$/, '')}${tool.path}`, body: method === 'GET' || method === 'HEAD' ? undefined : (args ?? {}) },
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
    healedResponse = await fetchImpl(`${coreUrl.replace(/\/$/, '')}/apis/${encodeURIComponent(apiId)}/tools/${encodeURIComponent(tool.name)}/invoke`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ args: args ?? {}, runId: healedRunId }),
    });
    healedPayload = await readPayload(healedResponse);
  } catch (error) {
    healedPayload = { error: String(error?.message ?? error) };
  }
  const healedOk = Boolean(healedResponse?.ok && healedPayload?.ok);
  const healed = {
    status: healedOk ? 'ok' : 'fail', mode: 'gateway', gatewayCalls: 1, rounds: 0,
    statusCode: healedResponse?.status ?? 0,
    elapsed: Date.now() - healedStarted, data: healedPayload?.data ?? null,
    error: healedOk ? null : errorMessage(healedPayload, healedResponse?.status ?? 0),
    ops: [], version: healedPayload?.meta?.version ?? null,
    request: {
      method: 'POST',
      url: `${coreUrl.replace(/\/$/, '')}/apis/${encodeURIComponent(apiId)}/tools/${encodeURIComponent(tool.name)}/invoke`,
      logicalMethod: method, logicalPath: tool.path, args: args ?? {},
    },
  };
  return { baseline, healed };
}
