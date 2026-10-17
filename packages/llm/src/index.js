import { createKeyPool, parseKeys } from './keypool.js';
import { createGeminiProvider } from './gemini.js';
import { createLimiter } from './limiter.js';

export { createGeminiProvider } from './gemini.js';
export { createKeyPool, parseKeys, isPlaceholderKey } from './keypool.js';
export { toGeminiSchema } from './gemini.js';
export { createLimiter } from './limiter.js';

export function parseProviderSpec(value, fallbackModel = 'gemini-2.5-flash') {
  const raw = String(value ?? '').trim();
  const separator = raw.indexOf(':');
  if (separator < 1) return { provider: raw || 'gemini', model: fallbackModel };
  const provider = raw.slice(0, separator).trim().toLowerCase();
  const requestedModel = raw.slice(separator + 1).trim();
  return { provider, model: !requestedModel || requestedModel === 'default' ? fallbackModel : requestedModel };
}

const providerCache = new WeakMap();
const limiterCache = new WeakMap();
const keyPoolCache = new WeakMap();

export function getProvider(role = 'diagnoser', env = process.env, options = {}) {
  const configured = role === 'agent' ? env.AGENT_LLM : env.DIAGNOSER_LLM;
  const spec = parseProviderSpec(configured);
  if (spec.provider !== 'gemini') throw new Error(`Unsupported LLM provider: ${spec.provider}`);
  if (Object.keys(options).length) return createGeminiProvider({ model: spec.model, keys: parseKeys(env), ...options });
  let byRole = providerCache.get(env);
  if (!byRole) { byRole = new Map(); providerCache.set(env, byRole); }
  if (!byRole.has(role)) {
    let limiter = limiterCache.get(env);
    if (!limiter) { limiter = createLimiter(Number(env.LLM_MAX_CONCURRENCY ?? 4)); limiterCache.set(env, limiter); }
    let keyPool = keyPoolCache.get(env);
    if (!keyPool) { keyPool = createKeyPool(parseKeys(env)); keyPoolCache.set(env, keyPool); }
    const provider = createGeminiProvider({ model: spec.model, keyPool });
    const generate = provider.generate.bind(provider);
    provider.generate = (request = {}) => limiter.run(() => generate(request), { signal: request.signal });
    byRole.set(role, provider);
  }
  return byRole.get(role);
}
