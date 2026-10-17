import { runTask, MAX_ITERATIONS } from './index.js';

export function baselineRoutes(app, dependencies = {}) {
  app.post('/demo/run', async (req, res) => {
    const { apiId, prompt, args, runId } = req.body ?? {};
    if (!apiId) return res.status(400).json({ ok: false, outcome: 'error', error: 'apiId is required' });
    try {
      const result = await (dependencies.runTask ?? runTask)({ apiId, prompt, args: args ?? {}, runId: runId ?? `b_${Date.now()}` });
      return res.json({
        ok: result.ok, runId: result.runId, apiId: result.apiId, answer: result.answer,
        outcome: result.outcome, iterations: result.iterations, steps: result.steps,
        tokens: result.tokens, provider: result.provider, model: result.model, mode: result.mode,
        data: result.data, error: result.error, trace: result.trace, maxIterations: MAX_ITERATIONS,
      });
    } catch (error) {
      return res.status(500).json({ ok: false, outcome: 'error', iterations: 0, error: { code: 'baseline_error', message: String(error?.message ?? error).slice(0, 500) }, maxIterations: MAX_ITERATIONS });
    }
  });
}
