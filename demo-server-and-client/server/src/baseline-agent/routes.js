// Phase 1 Track C: POST /demo/run — run the baseline task with raw HTTP (no healing).
import { runTask, MAX_ITERATIONS } from './index.js';

export function baselineRoutes(app) {
  app.post('/demo/run', async (req, res) => {
    const { apiId, tool, args, baseUrl, runId } = req.body ?? {};
    if (!apiId || !tool || !baseUrl) {
      return res.status(400).json({ ok: false, error: 'apiId, tool and baseUrl are required' });
    }
    let result;
    try {
      result = await runTask({ apiId, tool, args: args ?? {}, baseUrl, runId: runId ?? `b_${Date.now()}` });
    } catch (err) {
      return res.status(500).json({ ok: false, outcome: 'error', iterations: 0, error: String(err?.message ?? err), maxIterations: MAX_ITERATIONS });
    }
    res.json({ ok: result.ok, outcome: result.outcome, iterations: result.iterations, data: result.data, error: result.error, maxIterations: MAX_ITERATIONS });
  });
}
