import { getProvider } from '../../llm/provider.js';
import { buildTier2Prompt, tier2SystemPrompt } from './prompt.js';
import { tier2OutputSchema } from './schema.js';
import { validateTier2Output } from './validate.js';

function parseOutput(text) {
  try { return JSON.parse(text); }
  catch { const error = new Error('Tier 2 returned malformed JSON'); error.code = 'invalid_response'; throw error; }
}

export async function propose({ tool, args, failure, kind, specExcerpt = '', budgetMs = 2500, signal, provider = getProvider('diagnoser') }) {
  const { content, observedNames, evidenceSources } = buildTier2Prompt({ tool, args, failure, specExcerpt });
  const controller = new AbortController();
  const timeoutMs = Math.max(1, Math.min(Number(budgetMs) || 2500, 30000));
  const abortFromCaller = () => controller.abort(signal?.reason);
  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener('abort', abortFromCaller, { once: true });
  let timeout;
  let timedOut = false;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
        const error = new Error('Tier 2 diagnosis timed out'); error.code = 'timeout'; reject(error);
      }, timeoutMs);
    });
    const response = await Promise.race([provider.generate({
      system: tier2SystemPrompt,
      messages: [{ role: 'user', text: `${kind ?? 'request'} drift context:\n${content}` }],
      temperature: 0,
      maxOutputTokens: 700,
      jsonSchema: tier2OutputSchema,
      thinkingBudget: 0,
      signal: controller.signal,
    }), timeoutPromise]);
    const output = parseOutput(response.text ?? '');
    const checked = validateTier2Output({ output, sentText: content, evidenceSources, observedNames, args, tool });
    if (!checked.ok) return { failure: checked.reason, usage: response.usage, provider: response.provider, model: response.model, keySlot: response.keySlot, latencyMs: response.latencyMs };
    return { ...checked.value, evidence: checked.value.evidence.map((item) => ({ kind: 'llm_quote', ...item })), tier: 2, usage: response.usage, provider: response.provider, model: response.model, keySlot: response.keySlot, latencyMs: response.latencyMs };
  } catch (error) {
    return { failure: timedOut || error.code === 'timeout' ? 'tier2_timeout' : error.code === 'invalid_response' ? 'tier2_invalid_output' : 'tier2_unavailable', errorCode: error.code ?? 'provider_error', ...(error.providerMessage ? { providerMessage: error.providerMessage } : {}) };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}
