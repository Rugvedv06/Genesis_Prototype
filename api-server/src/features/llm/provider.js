const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const PLACEHOLDER_KEYS = new Set(['', 'your_gemini_api_key_here', 'changeme', 'xxx']);

export function parseProviderSpec(value, fallbackModel = DEFAULT_GEMINI_MODEL) {
  const raw = String(value ?? '').trim();
  const separator = raw.indexOf(':');
  if (separator < 1) return { provider: raw || 'gemini', model: fallbackModel };
  const provider = raw.slice(0, separator).trim().toLowerCase();
  const requestedModel = raw.slice(separator + 1).trim();
  return { provider, model: !requestedModel || requestedModel === 'default' ? fallbackModel : requestedModel };
}

function apiKeyAvailable(apiKey) {
  return Boolean(apiKey) && !PLACEHOLDER_KEYS.has(String(apiKey).trim().toLowerCase());
}

function providerError(status, body) {
  const message = typeof body === 'string' ? body : body?.error?.message ?? 'Gemini request failed';
  const code = status === 401 || status === 403
    ? 'invalid_or_unauthorized_key'
    : status === 429
      ? 'quota_or_rate_limit'
      : status >= 500
        ? 'provider_unavailable'
        : 'provider_request_failed';
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

export function createGeminiProvider({ model, apiKey, fetchImpl = fetch } = {}) {
  const selectedModel = model || DEFAULT_GEMINI_MODEL;
  return {
    provider: 'gemini',
    model: selectedModel,
    async health() {
      if (!apiKeyAvailable(apiKey)) {
        return { ok: false, provider: 'gemini', model: selectedModel, code: 'missing_api_key' };
      }
      try {
        const response = await fetchImpl(`${GEMINI_BASE}/models/${encodeURIComponent(selectedModel)}?key=${encodeURIComponent(apiKey)}`);
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw providerError(response.status, body);
        const methods = body.supportedGenerationMethods ?? [];
        if (!methods.includes('generateContent')) {
          return { ok: false, provider: 'gemini', model: selectedModel, code: 'unsupported_model_method', supportedGenerationMethods: methods };
        }
        return { ok: true, provider: 'gemini', model: selectedModel, supportedGenerationMethods: methods };
      } catch (error) {
        return {
          ok: false,
          provider: 'gemini',
          model: selectedModel,
          code: error.code ?? 'network_error',
          message: error.message,
        };
      }
    },
  };
}

export function getProvider(role = 'diagnoser', env = process.env) {
  const configured = role === 'agent' ? env.AGENT_LLM : env.DIAGNOSER_LLM;
  const spec = parseProviderSpec(configured);
  if (spec.provider !== 'gemini') {
    throw new Error(`Unsupported LLM provider: ${spec.provider}`);
  }
  return createGeminiProvider({ model: spec.model, apiKey: env.GEMINI_API_KEY });
}
