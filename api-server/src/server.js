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
import { registryStore } from './features/registry/store.js';
import { bus } from './features/events/bus.js';
import { get as getTrace } from './features/events/trace-store.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'api-server', port: cfg.port, version: '0.1.0', apis: registryStore.list().length, auditHead: null, time: new Date().toISOString() });
});

app.get('/state', (_req, res) => {
  const apis = registryStore.list();
  const grouped = new Map();
  for (const item of apis) {
    if (!grouped.has(item.apiId)) grouped.set(item.apiId, { apiId: item.apiId, baseUrl: registryStore.config(item.apiId)?.baseUrl, mode: registryStore.config(item.apiId)?.healing?.mode ?? 'enforce', tools: [] });
    const current = registryStore.current(item.apiId, item.tool);
    grouped.get(item.apiId).tools.push({
      name: item.tool,
      version: item.version,
      status: 'healthy',
      risk: item.risk,
      sideEffects: current?.versionObj?.meta?.sideEffects ?? current?.versionObj?.adapter?.sideEffects ?? 'write',
    });
  }
  res.json({ lastEventId: bus.since(0).at(-1)?.id ?? 0, apis: [...grouped.values()], metrics: {}, audit: { count: 0, headHash: null, verified: true }, cache: { entries: 0, hits: 0 }, circuit: [] });
});

app.get('/traces/:callId', (req, res) => {
  const trace = getTrace(req.params.callId);
  if (!trace) return res.status(404).json({ ok: false, error: 'not_found' });
  res.json(trace);
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
