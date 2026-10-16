// Phase 0: env parsing + defaults (ports fixed by plan: core 8000, mock 5001, dashboards 3000/3001)
export function config(env = process.env) {
  return {
    port: Number(env.PORT ?? 8000),
    coreUrl: env.CORE_URL ?? `http://localhost:${Number(env.PORT ?? 8000)}`,
    mockUrl: env.MOCK_URL ?? 'http://localhost:5001',
    tenantId: env.TENANT_ID,
    geminiApiKey: env.GEMINI_API_KEY,
    agentLlm: env.AGENT_LLM ?? 'gemini:default',
    diagnoserLlm: env.DIAGNOSER_LLM ?? 'gemini:default',
    enableDevRoutes: env.ENABLE_DEV_ROUTES === '1',
    maxHealRounds: Number(env.MAX_HEAL_ROUNDS ?? 5),
    healTimeoutMs: Number(env.HEAL_TIMEOUT_MS ?? 5000),
    confidenceThreshold: Number(env.CONFIDENCE_THRESHOLD ?? 0.85),
    dataDir: env.HEALR_DATA_DIR,
  };
}

export const cfg = config();
