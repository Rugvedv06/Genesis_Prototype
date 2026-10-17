// Phase 0: env parsing + defaults (ports fixed by plan: core 8000, mock 5001, dashboards 3000/3001)
import './lib/env.js';

export function config(env = process.env) {
  return {
    port: Number(env.PORT ?? 8000),
    coreUrl: env.CORE_URL ?? `http://localhost:${Number(env.PORT ?? 8000)}`,
    mockUrl: env.MOCK_URL ?? 'http://localhost:5001',
    tenantId: env.TENANT_ID,
    geminiApiKey: env.GEMINI_API_KEY,
    geminiApiKeys: env.GEMINI_API_KEYS,
    llmMaxConcurrency: Number(env.LLM_MAX_CONCURRENCY ?? 4),
    tier2TimeoutMs: Number(env.TIER2_TIMEOUT_MS ?? 2500),
    tier2MaxCallsPerHeal: Number(env.TIER2_MAX_CALLS_PER_HEAL ?? 2),
    specCacheTtlMs: Number(env.SPEC_CACHE_TTL_MS ?? 5000),
    openapiImportTimeoutMs: Number(env.OPENAPI_IMPORT_TIMEOUT_MS ?? 1800),
    agentMaxSteps: Number(env.AGENT_MAX_STEPS ?? 8),
    agentRunTimeoutMs: Number(env.AGENT_RUN_TIMEOUT_MS ?? 60000),
    agentMaxConcurrentRuns: Number(env.AGENT_MAX_CONCURRENT_RUNS ?? 8),
    baselineMode: env.BASELINE_MODE ?? 'llm',
    agentLlm: env.AGENT_LLM ?? 'gemini:gemini-2.5-flash',
    diagnoserLlm: env.DIAGNOSER_LLM ?? 'gemini:gemini-2.5-flash',
    enableDevRoutes: env.ENABLE_DEV_ROUTES === '1',
    maxHealRounds: Number(env.MAX_HEAL_ROUNDS ?? 5),
    healTimeoutMs: Number(env.HEAL_TIMEOUT_MS ?? 5000),
    confidenceThreshold: Number(env.CONFIDENCE_THRESHOLD ?? 0.85),
    dataDir: env.HEALR_DATA_DIR,
    allowLocalUpstreams: env.ALLOW_LOCAL_UPSTREAMS !== '0',
    patchRolloutMode: env.PATCH_ROLLOUT_MODE ?? 'immediate',
  };
}

export const cfg = config();
