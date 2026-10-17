import { getProvider } from '@healr/llm';
import { AGENT_SYSTEM_PROMPT, buildAgentTaskPrompt } from '@healr/llm/prompts';
import { emit } from '../events/bus.js';
import { newId } from '../lib/ids.js';

export const MAX_ITERATIONS = 10;
const MAX_TOOL_CALLS = 16;
const CORE_URL = () => process.env.CORE_URL ?? 'http://localhost:8000';
const taskPrompt = (email = 'asha.new@example.com') => `Fetch user 123, then update their email to "${email}", then report the user's name and email.`;

function safeError(error) {
  return { code: String(error?.code ?? 'baseline_error').slice(0, 80), message: String(error?.message ?? 'Baseline agent failed').slice(0, 500) };
<<<<<<< HEAD
}

async function readJson(response, maxBytes = 1_000_000) {
  const text = await response.text();
  if (Buffer.byteLength(text) > maxBytes) throw Object.assign(new Error('Core API detail exceeded the response size limit.'), { code: 'response_too_large' });
  try { return JSON.parse(text); } catch { throw Object.assign(new Error('Core API returned invalid JSON.'), { code: 'invalid_core_response' }); }
}

async function loadApi(apiId, coreFetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await coreFetchImpl(`${CORE_URL()}/apis/${encodeURIComponent(apiId)}`, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw Object.assign(new Error(`Core API detail returned HTTP ${response.status}.`), { code: 'api_not_found' });
    const detail = await readJson(response);
    if (!detail.config?.baseUrl || !Array.isArray(detail.tools)) throw Object.assign(new Error('Core API detail is missing its base URL or logical tools.'), { code: 'invalid_core_response' });
    const tools = detail.tools.map((tool) => ({
      name: tool.name ?? tool.tool,
      description: `Invoke ${tool.name ?? tool.tool} using its logical arguments.`,
      parameters: tool.parameters,
      sideEffects: tool.sideEffects ?? 'write',
      method: tool.method ?? 'POST', path: tool.path,
    })).filter((tool) => typeof tool.name === 'string' && tool.parameters?.type === 'object' && tool.path);
    if (!tools.length) throw Object.assign(new Error('No supported logical tools are registered for this API.'), { code: 'no_tools' });
    return { baseUrl: detail.config.baseUrl, tools };
  } finally { clearTimeout(timer); }
}

async function rawSend(baseUrl, tool, args, fetchImpl) {
  const base = new URL(baseUrl);
  if (!['http:', 'https:'].includes(base.protocol)) throw Object.assign(new Error('Registered base URL must use HTTP or HTTPS.'), { code: 'invalid_base_url' });
  let path = tool.path;
  const body = structuredClone(args ?? {});
  path = path.replace(/\{([^}]+)\}/g, (_match, key) => {
    if (body[key] === undefined) throw Object.assign(new Error(`Missing path argument ${key}.`), { code: 'missing_path_argument' });
    const value = encodeURIComponent(String(body[key])); delete body[key]; return value;
  });
  const url = new URL(path, base);
  if (url.origin !== base.origin) throw Object.assign(new Error('Registered tool path changes the upstream origin.'), { code: 'invalid_tool_path' });
  const method = String(tool.method ?? 'POST').toUpperCase();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetchImpl(url, { method, headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: ['GET', 'HEAD'].includes(method) ? undefined : JSON.stringify(body), signal: controller.signal, redirect: 'error' });
    const text = await response.text();
    const bounded = text.slice(0, 16_384);
    let json;
    try { json = bounded ? JSON.parse(bounded) : null; } catch { json = bounded; }
    return { ok: response.ok, status: response.status, body: json };
  } finally { clearTimeout(timer); }
}

=======
}

async function readJson(response, maxBytes = 1_000_000) {
  const text = await response.text();
  if (Buffer.byteLength(text) > maxBytes) throw Object.assign(new Error('Core API detail exceeded the response size limit.'), { code: 'response_too_large' });
  try { return JSON.parse(text); } catch { throw Object.assign(new Error('Core API returned invalid JSON.'), { code: 'invalid_core_response' }); }
}

async function loadApi(apiId, coreFetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await coreFetchImpl(`${CORE_URL()}/apis/${encodeURIComponent(apiId)}`, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw Object.assign(new Error(`Core API detail returned HTTP ${response.status}.`), { code: 'api_not_found' });
    const detail = await readJson(response);
    if (!detail.config?.baseUrl || !Array.isArray(detail.tools)) throw Object.assign(new Error('Core API detail is missing its base URL or logical tools.'), { code: 'invalid_core_response' });
    const tools = detail.tools.map((tool) => ({
      name: tool.name ?? tool.tool,
      description: `Invoke ${tool.name ?? tool.tool} using its logical arguments.`,
      parameters: tool.parameters,
      sideEffects: tool.sideEffects ?? 'write',
      method: tool.method ?? 'POST', path: tool.path,
    })).filter((tool) => typeof tool.name === 'string' && tool.parameters?.type === 'object' && tool.path);
    if (!tools.length) throw Object.assign(new Error('No supported logical tools are registered for this API.'), { code: 'no_tools' });
    return { baseUrl: detail.config.baseUrl, tools };
  } finally { clearTimeout(timer); }
}

async function rawSend(baseUrl, tool, args, fetchImpl) {
  const base = new URL(baseUrl);
  if (!['http:', 'https:'].includes(base.protocol)) throw Object.assign(new Error('Registered base URL must use HTTP or HTTPS.'), { code: 'invalid_base_url' });
  let path = tool.path;
  const body = structuredClone(args ?? {});
  path = path.replace(/\{([^}]+)\}/g, (_match, key) => {
    if (body[key] === undefined) throw Object.assign(new Error(`Missing path argument ${key}.`), { code: 'missing_path_argument' });
    const value = encodeURIComponent(String(body[key])); delete body[key]; return value;
  });
  const url = new URL(path, base);
  if (url.origin !== base.origin) throw Object.assign(new Error('Registered tool path changes the upstream origin.'), { code: 'invalid_tool_path' });
  const method = String(tool.method ?? 'POST').toUpperCase();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetchImpl(url, { method, headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: ['GET', 'HEAD'].includes(method) ? undefined : JSON.stringify(body), signal: controller.signal, redirect: 'error' });
    const text = await response.text();
    const bounded = text.slice(0, 16_384);
    let json;
    try { json = bounded ? JSON.parse(bounded) : null; } catch { json = bounded; }
    return { ok: response.ok, status: response.status, body: json };
  } finally { clearTimeout(timer); }
}

>>>>>>> origin/main
function usage(value = {}) {
  return { inputTokens: Number(value.inputTokens ?? 0), outputTokens: Number(value.outputTokens ?? 0), totalTokens: Number(value.totalTokens ?? Number(value.inputTokens ?? 0) + Number(value.outputTokens ?? 0)) };
}

function isReadOnly(calls, tools) { return calls.every((call) => tools.get(call.name)?.sideEffects === 'none'); }

export async function runTask({
  apiId, prompt, runId, args, mode: requestedMode, provider: injectedProvider,
  coreFetchImpl = fetch, upstreamFetchImpl = fetch, emitEvent = emit, maxIterations = MAX_ITERATIONS,
} = {}) {
  const id = String(runId ?? `b_${Date.now()}`);
  const callId = newId('c');
<<<<<<< HEAD
=======
<<<<<<< HEAD
>>>>>>> origin/main
  const started = Date.now();
  const resultTrace = [];
  const tokenTotal = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const traces = [];
  let modelName = process.env.AGENT_LLM?.split(':').slice(1).join(':') || 'gemini-2.5-flash';
  let providerName = 'gemini';
  let mode = requestedMode ?? process.env.BASELINE_MODE ?? 'llm';
  let lastError;
  let finalAnswer = '';
  let data;
  const finalize = (outcome, extra = {}) => {
    const ms = Date.now() - started;
    emitEvent({ type: 'agent.final', runId: id, callId, apiId, outcome, iterations: traces.length, steps: traces.length, tokens: tokenTotal, tokensByRole: { agent: { input: tokenTotal.inputTokens, output: tokenTotal.outputTokens } }, provider: providerName, model: modelName, mode, ms, ...(extra.error ? { error: extra.error.code } : {}) });
    return { ok: outcome === 'completed', runId: id, apiId, answer: finalAnswer, ...(data !== undefined ? { data } : {}), iterations: traces.length, steps: traces.length, tokens: tokenTotal, provider: providerName, model: modelName, mode, outcome, ms, trace: resultTrace, ...extra };
  };
<<<<<<< HEAD
=======
=======
  const iterations = [];
  let totalTokens = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let lastResult = null;
  const baselineMode = process.env.BASELINE_MODE ?? 'scripted';
  const llm = createGemini(
    baselineMode === 'gemini'
      ? (process.env.AGENT_LLM ?? 'gemini:gemini-2.5-flash')
      : 'scripted',
  );
>>>>>>> origin/main
>>>>>>> origin/main

  let api;
  try { api = await loadApi(apiId, coreFetchImpl); }
  catch (error) { lastError = safeError(error); return finalize('error', { error: lastError }); }
  const toolByName = new Map(api.tools.map((tool) => [tool.name, tool]));
  const declarations = api.tools.map(({ name, description, parameters }) => ({ name, description, parameters }));
  const taskText = prompt?.trim() ? prompt : taskPrompt(args?.email);
  let llm = injectedProvider;
  if (mode === 'llm' && !llm) {
    try {
      llm = getProvider('agent');
      if (!llm.keyPool?.size) { mode = 'scripted'; llm = null; }
    } catch { mode = 'scripted'; llm = null; }
  } else if (mode !== 'llm') {
    mode = 'scripted';
    llm = null;
  }
  if (llm) { providerName = llm.provider ?? providerName; modelName = llm.model ?? modelName; }
  const messages = [{ role: 'user', text: buildAgentTaskPrompt(taskText) }];
  const cap = Math.max(1, Math.min(10, Math.trunc(Number(maxIterations) || MAX_ITERATIONS)));

  for (let iteration = 1; iteration <= cap; iteration += 1) {
    let response;
    if (mode === 'scripted') {
      const candidate = api.tools.find((tool) => tool.name === 'get_user') ?? api.tools[0];
      response = { text: '', toolCalls: [{ id: `scripted-${iteration}`, name: candidate.name, args: args ?? { user_id: '123' } }], usage: {} };
    } else {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      try { response = await llm.generate({ system: AGENT_SYSTEM_PROMPT, messages, tools: declarations, temperature: 0, maxOutputTokens: 1200, signal: controller.signal }); }
      catch (error) { lastError = safeError(error); return finalize('error', { error: lastError }); }
      finally { clearTimeout(timer); }
    }
    const consumed = usage(response.usage);
    for (const key of Object.keys(tokenTotal)) tokenTotal[key] += consumed[key];
    const modelCalls = Array.isArray(response.toolCalls) ? response.toolCalls : [];
    if (modelCalls.length > MAX_TOOL_CALLS) return finalize('error', { error: { code: 'tool_call_limit', message: 'Model returned too many tool calls in one step.' } });
    emitEvent({ type: 'agent.step', runId: id, callId, apiId, iteration, toolCalls: modelCalls.map((call) => ({ name: String(call.name ?? '').slice(0, 128), argKeys: Object.keys(call.args ?? {}).slice(0, 64) })), tokens: consumed, cumulative: { ...tokenTotal }, provider: providerName, model: modelName, mode });
    traces.push({ iteration, toolCount: modelCalls.length, tokens: consumed });
    if (!modelCalls.length) {
      finalAnswer = String(response.text ?? '').slice(0, 4000);
      return finalize('completed');
    }
    const validCalls = modelCalls.map((call) => ({ ...call, args: call.args && typeof call.args === 'object' && !Array.isArray(call.args) ? call.args : {}, id: call.id ?? `${iteration}-${modelCalls.indexOf(call)}` }));
    messages.push({ role: 'assistant', ...(response.text ? { text: response.text } : {}), toolCalls: validCalls, ...(response.rawContent ? { rawContent: response.rawContent } : {}) });
    const execute = async (call) => {
      const tool = toolByName.get(call.name);
      if (!tool) return { call, result: { ok: false, status: 0, body: { error: 'unknown_tool' } } };
      try { return { call, result: await rawSend(api.baseUrl, tool, call.args, upstreamFetchImpl) }; }
      catch (error) { return { call, result: { ok: false, status: 0, body: { error: safeError(error) } } }; }
    };
    const results = isReadOnly(validCalls, toolByName)
      ? await Promise.all(validCalls.map(execute))
      : await validCalls.reduce(async (prior, call) => [...await prior, await execute(call)], Promise.resolve([]));
    for (const { call, result } of results) {
      if (call.name === 'get_user' && result.ok) data = result.body;
      resultTrace.push({ iteration, tool: call.name, argKeys: Object.keys(call.args), ok: result.ok, status: result.status });
      emitEvent({ type: result.ok ? 'call.succeeded' : 'call.failed', runId: id, callId, apiId, tool: call.name, iteration, status: result.status, mode });
      messages.push({ role: 'tool', toolResult: { id: call.id, name: call.name, content: result } });
    }
    if (mode === 'scripted' && results.some(({ result }) => result.ok)) return finalize('completed', { data: results.find(({ result }) => result.ok)?.result.body });
  }
  lastError = { code: 'iteration_limit', message: `Baseline reached its ${cap} model-call limit.` };
  return finalize('step_limit', { error: lastError });
}

export { AGENT_SYSTEM_PROMPT, buildAgentTaskPrompt };
