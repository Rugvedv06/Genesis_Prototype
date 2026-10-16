// Phase 1: api-server (core healing gateway), port 8000.
// Routes wiring for apis, events, and invoke. Feature internals land track-by-track.
import { loadEnv } from './lib/env.js';
loadEnv();

import express from 'express';
import cors from 'cors';
import { cfg } from './config.js';
import { log } from './lib/log.js';
import { apisRoutes } from './features/apis/routes.js';
import { eventsRoute } from './features/events/routes.js';
import { invoke } from './features/executor/invoke.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'api-server', port: cfg.port, time: new Date().toISOString() });
});

// §4.5 core endpoints
apisRoutes(app);
eventsRoute(app);

app.post('/apis/:apiId/tools/:tool/invoke', async (req, res) => {
  const { apiId, tool } = req.params;
  const { args, runId: bodyRunId } = req.body ?? {};
  const runId = bodyRunId ?? req.get('x-run-id');
  try {
    const result = await invoke({ apiId, toolName: tool, args, runId });
    if (result.ok) return res.json({ ok: true, data: result.data, meta: result.meta });
    const status = result.error.retryable === false && result.error.code === 'invalid_arguments' ? 400 : 200;
    return res.status(status).json({ ok: false, error: result.error });
  } catch (err) {
    log({ level: 'error', err: err.message, apiId, tool });
    return res.status(500).json({ ok: false, error: { code: 'upstream_error', message: 'internal', retryable: false } });
  }
});

app.use((err, _req, res, _next) => {
  log({ level: 'error', err: err.message });
  res.status(500).json({ ok: false, error: 'internal' });
});

const server = app.listen(cfg.port, () => {
  log({ level: 'info', service: 'api-server', port: cfg.port, msg: 'listening' });
});

export { server, app, cfg };
