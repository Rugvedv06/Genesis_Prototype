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
import { auditRoutes } from './features/audit/routes.js';
import { snapshot as metricsSnapshot, timeseries as metricsTimeseries } from './features/metrics/index.js';
import { head as auditHead } from './features/audit/index.js';
import { snapshot as circuitSnapshot } from './features/safety/circuit.js';
import { getProvider } from './features/llm/provider.js';
import { closePool, databaseStatus, getPool } from './db/pool.js';
import { migrationStatus } from './db/migrate.js';
import { snapshotMetrics, metricsTimeseries as databaseMetricsTimeseries } from './db/metrics-repository.js';
import { promotePatchCandidate, updatePatchCandidateRollout } from './db/registry-service.js';
import { candidate as getPatchCacheCandidate } from './features/patch-cache/index.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'api-server', port: cfg.port, version: '0.1.0', apis: registryStore.list().length, auditHead: auditHead(), time: new Date().toISOString() });
});

app.get('/patch-candidates/:id', async (req, res, next) => {
  try {
    const candidate = await getPatchCacheCandidate(req.params.id);
    if (!candidate) return res.status(404).json({ ok: false, error: 'not_found' });
    res.json({ candidate });
  } catch (error) { next(error); }
});

app.post('/patch-candidates/:id/rollout', async (req, res, next) => {
  const { state, reason, metrics } = req.body ?? {};
  if (!['regression_verified', 'shadow', 'canary', 'rejected', 'rolled_back'].includes(state)) {
    return res.status(400).json({ ok: false, error: 'invalid_rollout_state' });
  }
  try {
    const candidate = await updatePatchCandidateRollout(req.params.id, state, reason, metrics);
    if (!candidate) return res.status(404).json({ ok: false, error: 'not_found' });
    res.json({ ok: true, candidate });
  } catch (error) { next(error); }
});

app.post('/patch-candidates/:id/promote', async (req, res, next) => {
  try {
    const result = await promotePatchCandidate(req.params.id);
    if (!result) return res.status(404).json({ ok: false, error: 'not_found' });
    res.json({ ok: true, version: result.committed.version, candidate: result.rollout });
  } catch (error) {
    if (['candidate_not_promotable', 'candidate_adapter_missing', 'stale_candidate_source'].includes(error.code)) {
      return res.status(409).json({ ok: false, error: error.code, message: error.message });
    }
    next(error);
  }
});

app.get('/ready', async (_req, res) => {
  if (!process.env.DATABASE_URL) return res.json({ ok: true, database: { configured: false, required: false } });
  const database = await databaseStatus();
  if (!database.ok) return res.status(503).json({ ok: false, database });
  try {
    const migrations = await migrationStatus();
    const ok = migrations.ok;
    return res.status(ok ? 200 : 503).json({ ok, database: { configured: true, ok: true }, migrations });
  } catch {
    return res.status(503).json({ ok: false, database: { configured: true, ok: true }, migrations: { ok: false, code: 'migration_state_unavailable' } });
  }
});

app.get('/state', async (_req, res) => {
  const apis = registryStore.list();
  const safety = circuitSnapshot();
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
  const state = { lastEventId: bus.since(0).at(-1)?.id ?? 0, apis: [...grouped.values()], audit: auditHead(), cache: { entries: safety.negativeEntries, hits: 0 }, circuit: safety.open };
  if (process.env.DATABASE_URL) {
    try { return res.json({ ...state, metrics: await snapshotMetrics(getPool()) }); }
    catch (error) {
      log({ level: 'warn', code: 'metrics_database_fallback', err: error.message });
      return res.json({ ...state, metrics: metricsSnapshot() });
    }
  }
  res.json({ ...state, metrics: metricsSnapshot() });
});

app.get('/metrics', async (_req, res) => {
  if (process.env.DATABASE_URL) {
    try { return res.json(await snapshotMetrics(getPool())); }
    catch (error) { log({ level: 'warn', code: 'metrics_database_fallback', err: error.message }); }
  }
  return res.json(metricsSnapshot());
});
app.get('/metrics/timeseries', async (req, res) => {
  if (process.env.DATABASE_URL) {
    try { return res.json({ series: await databaseMetricsTimeseries(getPool(), Number(req.query.window ?? 300), Number(req.query.step ?? 5)) }); }
    catch (error) { log({ level: 'warn', code: 'metrics_database_fallback', err: error.message }); }
  }
  return res.json({ series: metricsTimeseries(Number(req.query.window ?? 300), Number(req.query.step ?? 5)) });
});

app.get('/provider/health', async (_req, res) => {
  try {
    const provider = getProvider('diagnoser');
    const result = await provider.health();
    res.status(result.ok ? 200 : 503).json(result);
  } catch (error) {
    res.status(503).json({ ok: false, code: 'provider_configuration_error', message: error.message });
  }
});

app.get('/traces/:callId', (req, res) => {
  const trace = getTrace(req.params.callId);
  if (!trace) return res.status(404).json({ ok: false, error: 'not_found' });
  res.json(trace);
});

// §4.5 core endpoints
apisRoutes(app);
eventsRoute(app);
auditRoutes(app);

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

let shutdownPromise;
async function shutdown(signal) {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    log({ level: 'info', service: 'api-server', code: 'shutdown_started', signal });
    const httpClosed = new Promise((resolve) => {
      server.close((error) => {
        if (error) log({ level: 'error', service: 'api-server', code: 'http_shutdown_error' });
        resolve();
      });
    });
    const forceCloseTimer = setTimeout(() => server.closeAllConnections?.(), 10_000);
    forceCloseTimer.unref();
    await httpClosed;
    clearTimeout(forceCloseTimer);
    try { await closePool(); }
    catch { log({ level: 'error', service: 'api-server', code: 'postgres_pool_shutdown_error' }); }
    log({ level: 'info', service: 'api-server', code: 'shutdown_complete' });
  })();
  return shutdownPromise;
}

process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
process.once('SIGINT', () => { void shutdown('SIGINT'); });

export { server, app, cfg };
