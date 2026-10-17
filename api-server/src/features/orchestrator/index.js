import { createHash } from 'node:crypto';
import { getProvider } from '../../features/llm/provider.js';
import { AGENT_SYSTEM_PROMPT, buildAgentTaskPrompt } from '@healr/llm/prompts';
import { buildToolDeclarations } from './tools.js';
import { emit } from '../events/bus.js';
import { cfg } from '../../config.js';
import { stableStringify } from '../../lib/hash.js';

const MAX_TOOL_CALLS_PER_STEP = 16;
const MAX_STEPS = 32;

function publicToolResult(result) {
  if (result?.ok) return { ok: true, data: result.data };
  const error = result?.error ?? {};
  return {
    ok: false,
    error: String(error.code ?? 'tool_error'),
    message: String(error.message ?? 'Tool call failed').slice(0, 1000),
    retryable: false,
  };
}

function abortError(reason = 'aborted') {
  const error = new Error(reason);
  error.code = reason;
  return error;
}

function raceSignal(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError('cancelled'));
  return new Promise((resolve, reject) => {
    const onAbort = () => { signal.removeEventListener('abort', onAbort); reject(abortError('cancelled')); };
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (error) => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}

function summarizeUsage(usage = {}) {
  return {
    inputTokens: Number(usage.inputTokens ?? 0),
    outputTokens: Number(usage.outputTokens ?? 0),
    totalTokens: Number(usage.totalTokens ?? Number(usage.inputTokens ?? 0) + Number(usage.outputTokens ?? 0)),
  };
}

export async function runTask({
  apiId, prompt, runId, maxSteps, signal, provider: injectedProvider,
  invokeTool: injectedInvoke, emitEvent = emit, timeoutMs, providerCallTimeoutMs = 15_000,
} = {}) {
  const startedAt = Date.now();
  const id = String(runId ?? `agent_${startedAt}`);
  const totalTokens = { input: 0, output: 0 };
  const cumulative = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let provider = injectedProvider;
  let lastProvider = 'gemini';
  let lastModel = cfg.agentLlm?.split(':').slice(1).join(':') || 'gemini-2.5-flash';
  let steps = 0;
  let answer = '';
  let lastToolData;
  let outcome = 'error';
  let errorResult;
  let abortReason;
  const deadlineMs = Math.max(1, Math.min(Number(timeoutMs ?? cfg.agentRunTimeoutMs) || 60_000, 300_000));
  const controller = new AbortController();
  const abortCaller = () => { abortReason = 'cancelled'; controller.abort(signal?.reason); };
  if (signal?.aborted) abortCaller();
  else signal?.addEventListener('abort', abortCaller, { once: true });
  const deadline = setTimeout(() => { abortReason = 'run_timeout'; controller.abort(); }, deadlineMs);
  const callTool = injectedInvoke ?? (await import('../executor/invoke.js')).invoke;
  const tools = buildToolDeclarations(apiId);
  const toolByName = new Map(tools.map((tool) => [tool.name, tool]));
  if (!tools.length) {
    clearTimeout(deadline);
    signal?.removeEventListener('abort', abortCaller);
    const result = { runId: id, apiId, outcome: 'error', error: { code: 'no_tools', message: 'No registered logical tools are available.' }, steps, tokens: totalTokens, provider: lastProvider, model: lastModel, mode: 'llm', ms: Date.now() - startedAt };
    emitEvent({ type: 'agent.final', runId: id, apiId, outcome: 'error', steps, tokens: totalTokens, tokensByRole: { agent: totalTokens }, provider: lastProvider, model: lastModel, mode: 'llm', ms: result.ms, error: 'no_tools' });
    return result;
  }
  try {
    if (controller.signal.aborted) throw abortError(abortReason);
    provider ??= getProvider('agent'); // Pin provider/model object for the whole run.
    lastProvider = provider.provider ?? 'gemini';
    lastModel = provider.model ?? lastModel;
    const messages = [{ role: 'user', text: buildAgentTaskPrompt(prompt) }];
    const configuredSteps = Number(maxSteps ?? cfg.agentMaxSteps);
    const stepCap = Math.max(1, Math.min(Number.isFinite(configuredSteps) ? Math.trunc(configuredSteps) : 8, MAX_STEPS));
    const failures = new Map();

    for (steps = 1; steps <= stepCap; steps += 1) {
      if (controller.signal.aborted) throw abortError(abortReason);
      const callTimeoutMs = Math.max(1, Math.min(Number(providerCallTimeoutMs) || 15_000, deadlineMs));
      const providerTimeout = setTimeout(() => { abortReason = 'provider_timeout'; controller.abort(); }, callTimeoutMs);
      let response;
      try {
        response = await raceSignal(provider.generate({
          system: AGENT_SYSTEM_PROMPT,
          messages,
          tools: tools.map(({ name, description, parameters }) => ({ name, description, parameters })),
          temperature: 0,
          maxOutputTokens: 1200,
          signal: controller.signal,
        }), controller.signal);
      } finally { clearTimeout(providerTimeout); }
      lastProvider = response.provider ?? lastProvider;
      lastModel = response.model ?? lastModel;
      const usage = summarizeUsage(response.usage);
      cumulative.inputTokens += usage.inputTokens;
      cumulative.outputTokens += usage.outputTokens;
      cumulative.totalTokens += usage.totalTokens;
      totalTokens.input += usage.inputTokens;
      totalTokens.output += usage.outputTokens;
      const toolCalls = Array.isArray(response.toolCalls) ? response.toolCalls : [];
      const safeCalls = toolCalls.slice(0, MAX_TOOL_CALLS_PER_STEP);
      const stepEvent = {
        type: 'agent.step', runId: id, apiId, iteration: steps,
        toolCalls: safeCalls.map((item) => ({ name: String(item.name ?? '').slice(0, 128), argKeys: Object.keys(item.args ?? {}).slice(0, 64) })),
        tokens: usage, cumulative: { ...cumulative }, provider: lastProvider, model: lastModel,
      };
      emitEvent(stepEvent);
      if (toolCalls.length > MAX_TOOL_CALLS_PER_STEP) {
        outcome = 'halted'; errorResult = { code: 'tool_call_limit', message: 'Too many tool calls in one model step.' }; break;
      }
      if (!toolCalls.length) {
        answer = String(response.text ?? '').slice(0, 4000);
        outcome = 'completed';
        break;
      }

      messages.push({ role: 'assistant', ...(response.text ? { text: response.text } : {}), toolCalls: safeCalls, ...(response.rawContent ? { rawContent: response.rawContent } : {}) });
      const knownCalls = safeCalls.map((item) => ({ call: item, tool: toolByName.get(item.name) }));
      const calls = knownCalls.map(({ call, tool }) => async () => {
        if (!tool || !call.args || typeof call.args !== 'object' || Array.isArray(call.args)) {
          return { call, result: { ok: false, error: { code: 'invalid_tool_call', message: 'Tool name or arguments are invalid.' } } };
        }
        const signature = `${call.name}|${createHash('sha256').update(stableStringify(call.args)).digest('hex')}`;
        try {
          const result = await raceSignal(Promise.resolve(callTool({ apiId, toolName: call.name, args: call.args, runId: id, signal: controller.signal })), controller.signal);
          const visible = publicToolResult(result);
          if (!visible.ok) {
            const count = (failures.get(signature) ?? 0) + 1;
            failures.set(signature, count);
          }
          return { call, signature, result: visible };
        } catch (error) {
          const visible = { ok: false, error: String(error.code ?? 'tool_error'), message: String(error.message ?? 'Tool call failed').slice(0, 1000), retryable: false };
          const count = (failures.get(signature) ?? 0) + 1;
          failures.set(signature, count);
          return { call, signature, result: visible };
        }
      });
      const readOnly = knownCalls.every(({ tool }) => tool?.sideEffects === 'none');
      const results = readOnly
        ? await Promise.all(calls.map((run) => run()))
        : await calls.reduce(async (previous, run) => [...await previous, await run()], Promise.resolve([]));
      for (const item of results) {
        const callResult = item.result;
        if (callResult?.ok && Object.hasOwn(callResult, 'data')) lastToolData = callResult.data;
        messages.push({ role: 'tool', toolResult: { id: item.call.id, name: item.call.name, content: callResult } });
        if (item.signature && (failures.get(item.signature) ?? 0) >= 2) {
          outcome = 'halted';
          errorResult = { code: 'repeated_tool_failure', message: 'The same tool call failed twice.' };
          break;
        }
      }
      if (outcome === 'halted') break;
    }
    if (outcome === 'error' && !errorResult) outcome = 'step_limit';
  } catch (error) {
    if (abortReason === 'cancelled' || signal?.aborted) {
      outcome = 'cancelled'; errorResult = { code: 'cancelled', message: 'Agent run was cancelled.' };
    } else if (abortReason === 'provider_timeout') {
      outcome = 'halted'; errorResult = { code: 'provider_timeout', message: 'Agent provider call exceeded its deadline.' };
    } else if (abortReason === 'run_timeout' || error.code === 'run_timeout') {
      outcome = 'halted'; errorResult = { code: 'run_timeout', message: 'Agent run exceeded its deadline.' };
    } else if (error.code === 'cancelled') {
      outcome = 'cancelled'; errorResult = { code: 'cancelled', message: 'Agent run was cancelled.' };
    } else {
      outcome = 'error'; errorResult = { code: String(error.code ?? 'provider_error'), message: String(error.message ?? 'Agent provider failed').slice(0, 1000) };
    }
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener('abort', abortCaller);
  }
  const result = { runId: id, apiId, outcome, ...(answer ? { answer } : {}), ...(lastToolData !== undefined ? { data: lastToolData } : {}), steps: Math.min(steps, Number(maxSteps ?? cfg.agentMaxSteps) || 8), tokens: totalTokens, provider: lastProvider, model: lastModel, mode: 'llm', ms: Date.now() - startedAt, ...(errorResult ? { error: errorResult } : {}) };
  emitEvent({ type: 'agent.final', runId: id, apiId, outcome, steps: result.steps, tokens: totalTokens, tokensByRole: { agent: totalTokens }, provider: lastProvider, model: lastModel, mode: 'llm', ms: result.ms, ...(errorResult ? { error: errorResult.code } : {}) });
  return result;
}

export { buildToolDeclarations as toolCatalogue };
