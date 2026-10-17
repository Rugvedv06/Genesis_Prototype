import { createKeyPool, isPlaceholderKey } from './keypool.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const SCHEMA_KEYS = new Set(['type','format','title','description','nullable','enum','maxItems','minItems','properties','required','minProperties','maxProperties','minLength','maxLength','pattern','example','anyOf','propertyOrdering','default','items','minimum','maximum']);

export function toGeminiSchema(schema = {}) {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const result = {};
  for (const [key, value] of Object.entries(schema)) {
    if (!SCHEMA_KEYS.has(key)) continue;
    result[key] = key === 'properties' ? Object.fromEntries(Object.entries(value ?? {}).map(([name, child]) => [name, toGeminiSchema(child)])) : key === 'items' ? toGeminiSchema(value) : key === 'anyOf' ? value.map(toGeminiSchema) : value;
  }
  return result;
}


async function readJsonBounded(response, maxBytes = 2_000_000) {
  if (!response.body?.getReader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw Object.assign(new Error('Gemini response exceeded the size limit'), { code: 'invalid_response' });
    return JSON.parse(text);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw Object.assign(new Error('Gemini response exceeded the size limit'), { code: 'invalid_response' });
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return JSON.parse(chunks.join(''));
  } finally { reader.releaseLock(); }
}

async function readErrorBody(response, maxBytes = 8192) {
  if (!response.body?.getReader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) return {};
    try { return JSON.parse(text); } catch { return {}; }
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parts = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); return {}; }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    try { return JSON.parse(parts.join('')); } catch { return {}; }
  } finally { reader.releaseLock(); }
}

function errorFor(response, body, keys = []) {
  const error = new Error(`Gemini request failed (${response.status})`);
  error.status = response.status;
  error.code = response.status === 401 || response.status === 403 ? 'invalid_or_unauthorized_key' : response.status === 429 ? 'quota_or_rate_limit' : response.status >= 500 ? 'provider_unavailable' : 'provider_request_failed';
  if (response.status === 429) {
    const raw = response.headers?.get?.('retry-after');
    const seconds = raw === null ? NaN : Number(raw);
    const dateDelay = raw === null || Number.isFinite(seconds) ? NaN : Date.parse(raw) - Date.now();
    const delay = Number.isFinite(seconds) ? seconds * 1000 : dateDelay;
    error.retryAfterMs = Number.isFinite(delay) && delay > 0 ? Math.min(delay, 120000) : undefined;
  }
  let providerMessage = String(body?.error?.message ?? '').slice(0, 1000);
  for (const key of keys) if (key) providerMessage = providerMessage.split(key).join('[redacted]');
  if (providerMessage) error.providerMessage = providerMessage;
  return error;
}

function contentsFrom(messages = []) {
  return messages.map((message) => {
    if (message.rawContent) return message.rawContent;
    if (message.role === 'tool') return { role: 'user', parts: [{ functionResponse: { id: message.toolResult?.id, name: message.toolResult?.name, response: message.toolResult?.content } }] };
    const role = message.role === 'assistant' ? 'model' : 'user';
    const parts = [];
    if (message.text) parts.push({ text: message.text });
    for (const call of message.toolCalls ?? []) parts.push({ functionCall: { id: call.id, name: call.name, args: call.args } });
    return { role, parts };
  });
}

export function createGeminiProvider({ model = 'gemini-2.5-flash', apiKey, keys = apiKey ? [apiKey] : [], keyPool, startIndex, fetchImpl = fetch } = {}) {
  const usableKeys = keys.filter((key) => key && !isPlaceholderKey(key));
  const pool = keyPool ?? createKeyPool(usableKeys, { startIndex });
  return {
    provider: 'gemini', model,
    keyPool: pool,
    async generate({ system, messages = [], tools = [], temperature = 0, maxOutputTokens, jsonSchema, signal, thinkingBudget } = {}) {
      const selected = pool.next();
      if (!selected) { const error = new Error('No healthy Gemini API key is configured'); error.code = pool.size ? 'invalid_or_unauthorized_key' : 'missing_api_key'; throw error; }
      const started = Date.now();
      const body = { contents: contentsFrom(messages), generationConfig: { temperature } };
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      if (maxOutputTokens) body.generationConfig.maxOutputTokens = maxOutputTokens;
      if (thinkingBudget !== undefined) body.generationConfig.thinkingConfig = { thinkingBudget };
      if (tools.length) body.tools = [{ functionDeclarations: tools.map((tool) => ({ name: tool.name, description: tool.description ?? '', parameters: toGeminiSchema(tool.parameters ?? { type: 'object', properties: {} }) })) }];
      if (jsonSchema) body.generationConfig.responseFormat = { text: { mimeType: 'APPLICATION_JSON', schema: toGeminiSchema(jsonSchema) } };
      let response;
      try {
        response = await fetchImpl(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': selected.key }, body: JSON.stringify(body), signal });
      } catch (cause) {
        const error = new Error(signal?.aborted ? 'Gemini request aborted' : 'Gemini network request failed');
        error.code = signal?.aborted ? 'aborted' : 'network_error';
        error.cause = cause;
        throw error;
      }
      if (!response.ok) {
        const error = errorFor(response, await readErrorBody(response), usableKeys);
        if (error.code === 'invalid_or_unauthorized_key') pool.markUnauthorized(selected.slot);
        if (error.code === 'quota_or_rate_limit') pool.markRateLimited(selected.slot, error.retryAfterMs);
        throw error;
      }
      let payload;
      try { payload = await readJsonBounded(response); }
      catch (cause) { const error = new Error('Gemini returned an invalid response'); error.code = 'invalid_response'; error.cause = cause; throw error; }
      const candidate = payload?.candidates?.[0];
      if (!candidate || !Array.isArray(candidate.content?.parts)) { const error = new Error('Gemini returned an invalid response'); error.code = 'invalid_response'; throw error; }
      const calls = candidate.content.parts.filter((part) => part.functionCall).map((part, index) => ({ id: part.functionCall.id ?? `call_${index}`, name: part.functionCall.name, args: part.functionCall.args ?? {} }));
      const text = candidate.content.parts.filter((part) => typeof part.text === 'string').map((part) => part.text).join('');
      const usage = payload.usageMetadata ?? {};
      const inputTokens = Number(usage.promptTokenCount ?? 0) + Number(usage.toolUsePromptTokenCount ?? 0);
      const thinkingTokens = Number(usage.thoughtsTokenCount ?? 0);
      const outputTokens = Number(usage.candidatesTokenCount ?? 0) + thinkingTokens;
      const totalTokens = Number(usage.totalTokenCount ?? inputTokens + outputTokens);
      return { text, toolCalls: calls, usage: { inputTokens, outputTokens, totalTokens, thinkingTokens }, provider: 'gemini', model, finishReason: candidate.finishReason ?? null, latencyMs: Date.now() - started, keySlot: selected.slot, rawContent: candidate.content };
    },
    async health() {
      if (!pool.size) return { ok: false, provider: 'gemini', model, code: 'missing_api_key' };
      const selection = pool.next();
      if (!selection) return { ok: false, provider: 'gemini', model, code: 'invalid_or_unauthorized_key', keyPool: pool.health() };
      try {
        const response = await fetchImpl(`${BASE}/models/${encodeURIComponent(model)}`, { headers: { 'x-goog-api-key': selection.key } });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw errorFor(response, body, usableKeys);
        const methods = body.supportedGenerationMethods ?? [];
        return methods.includes('generateContent') ? { ok: true, provider: 'gemini', model, keyPool: pool.health() } : { ok: false, provider: 'gemini', model, code: 'unsupported_model_method', keyPool: pool.health() };
      } catch (error) { return { ok: false, provider: 'gemini', model, code: error.code ?? 'network_error', keyPool: pool.health() }; }
    },
  };
}
