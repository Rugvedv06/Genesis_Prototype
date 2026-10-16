// Phase 1: api-server (core healing gateway), port 8000.
// Routes wiring for apis, events, and invoke. Feature internals land track-by-track.
import { loadEnv } from './lib/env.js';
loadEnv();

import express from 'express';
import cors from 'cors';
import { cfg } from './config.js';
import { log, configureLogPersistence, logPersistenceStatus, flushLogPersistence } from './lib/log.js';
import { apisRoutes } from './features/apis/routes.js';
import { eventsRoute } from './features/events/routes.js';
import { invoke } from './features/executor/invoke.js';
import { registryStore } from './features/registry/store.js';
import { bus, configureEventPersistence } from './features/events/bus.js';
import { get as getTrace, traceFromEvents } from './features/events/trace-store.js';
import { auditRoutes } from './features/audit/routes.js';
import { snapshot as metricsSnapshot, timeseries as metricsTimeseries } from './features/metrics/index.js';
import { head as auditHead } from './features/audit/index.js';
import { snapshot as circuitSnapshot } from './features/safety/circuit.js';
import { getProvider } from './features/llm/provider.js';
import { closePool, databaseStatus, getPool, poolStatus } from './db/pool.js';
import { migrationStatus } from './db/migrate.js';
import { refreshRegistryCache } from './db/registry-service.js';
import { withTransaction } from './db/transaction.js';
import { appendGatewayEventInTransaction } from './db/event-repository.js';
import { listCallEvents, getEventCursor, listRecentEvents } from './db/event-repository.js';
import { getAuditHead } from './db/audit-repository.js';
import { snapshotMetrics, metricsTimeseries as readMetricsTimeseries } from './db/metrics-repository.js';
import { closeRedisMirror, redisMirrorStatus, probeRedisMirror } from './features/patch-cache/redis-mirror.js';
import { flushDurableEvents } from './features/events/bus.js';
import { appendServiceLog, searchServiceLogs } from './db/service-log-repository.js';
import { reconcileStaleInvocations } from './db/invocation-recovery.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required; file-backed runtime fallback is disabled');
const startupDatabase = await databaseStatus();
if (!startupDatabase.ok) throw new Error('PostgreSQL is unavailable; api-server will not start with file-backed state');
const startupMigrations = await migrationStatus();
if (!startupMigrations.ok) throw new Error('PostgreSQL migrations are missing or inconsistent; api-server will not start');
await refreshRegistryCache();
configureEventPersistence((event) => withTransaction((client) => appendGatewayEventInTransaction(client, event)));
configureLogPersistence((record) => appendServiceLog(getPool(), record));

const CORE_INSTANCE_LOCK_KEY = 741903214;
const coreLeaseClient = await getPool().connect();
let coreLeaseHealthy = false;
coreLeaseClient.on('error', () => { coreLeaseHealthy = false; });
const { rows: coreLockRows } = await coreLeaseClient.query('SELECT pg_try_advisory_lock($1) AS acquired', [CORE_INSTANCE_LOCK_KEY]);
if (!coreLockRows[0]?.acquired) {
  coreLeaseClient.release();
  throw new Error('Another api-server instance already owns the local database lease');
}
coreLeaseHealthy = true;
const recoveredInvocations = await reconcileStaleInvocations();
if (recoveredInvocations.reconciled) {
  log({ level: 'warn', service: 'api-server', code: 'stale_invocations_reconciled', count: recoveredInvocations.reconciled });
}

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'api-server', port: cfg.port, version: '0.1.0', apis: registryStore.list().length, time: new Date().toISOString() });
});

app.get('/ready', async (_req, res) => {
  if (!coreLeaseHealthy) return res.status(503).json({ ok: false, database: { configured: true, ok: true }, pool: poolStatus(), code: 'single_core_lease_lost' });
  if (!process.env.DATABASE_URL) return res.status(503).json({ ok: false, database: { configured: false, required: true } });
  const database = await databaseStatus();
  if (!database.ok) return res.status(503).json({ ok: false, database, pool: poolStatus() });
  try {
    const redis = await probeRedisMirror();
    const migrations = await migrationStatus();
    const ok = migrations.ok;
    return res.status(ok ? 200 : 503).json({ ok, database: { configured: true, ok: true }, migrations, pool: poolStatus(), redis, logs: logPersistenceStatus(), events: bus.durableEventStatus() });
  } catch {
    return res.status(503).json({ ok: false, database: { configured: true, ok: true }, migrations: { ok: false, code: 'migration_state_unavailable' }, pool: poolStatus(), redis: redisMirrorStatus(), logs: logPersistenceStatus(), events: bus.durableEventStatus() });
  }
});

app.get('/logs', async (req, res, next) => {
  try {
    const limit = Number(req.query.limit ?? 100);
    const beforeId = req.query.beforeId === undefined ? undefined : String(req.query.beforeId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500
      || (beforeId !== undefined && (!/^\d{1,19}$/.test(beforeId) || BigInt(beforeId) > 9_223_372_036_854_775_807n))
      || (req.query.level !== undefined && !['info', 'warn', 'error', 'fatal'].includes(req.query.level))
      || (req.query.code !== undefined && (typeof req.query.code !== 'string' || !/^[a-z0-9_.:-]{1,96}$/i.test(req.query.code)))) {
      return res.status(400).json({ ok: false, error: 'invalid_arguments' });
    }
    res.json({ records: await searchServiceLogs(getPool(), { limit, beforeId, level: req.query.level, code: req.query.code }) });
  } catch (error) { next(error); }
});

app.get('/state', async (_req, res, next) => {
  try {
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
  const [metrics, audit, eventCursor] = process.env.DATABASE_URL
    ? await Promise.all([snapshotMetrics(getPool()), getAuditHead(getPool()), getEventCursor(getPool())])
    : [metricsSnapshot(), auditHead(), { last_event_id: String(bus.since(0).at(-1)?.id ?? 0) }];
  res.json({ lastEventId: eventCursor.last_event_id, apis: [...grouped.values()], metrics, audit, cache: { entries: safety.negativeEntries, hits: 0 }, circuit: safety.open });
  } catch (error) { next(error); }
});

app.get('/events/recent', async (req, res, next) => {
  try {
    const limit = req.query.limit === undefined ? 5000 : Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) {
      return res.status(400).json({ ok: false, error: 'invalid_arguments' });
    }
    res.json(await listRecentEvents(getPool(), limit));
  } catch (error) { next(error); }
});

app.get('/metrics', async (_req, res, next) => {
  try { res.json(process.env.DATABASE_URL ? await snapshotMetrics(getPool()) : metricsSnapshot()); }
  catch (error) { next(error); }
});
app.get('/metrics/timeseries', async (req, res, next) => {
  try {
    const series = process.env.DATABASE_URL
      ? await readMetricsTimeseries(getPool(), req.query.window ?? 300, req.query.step ?? 5)
      : metricsTimeseries(Number(req.query.window ?? 300), Number(req.query.step ?? 5));
    res.json({ series });
  } catch (error) { next(error); }
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

app.get('/traces/:callId', async (req, res, next) => {
  let trace;
  try {
    trace = process.env.DATABASE_URL
      ? traceFromEvents(req.params.callId, await listCallEvents(getPool(), req.params.callId))
      : getTrace(req.params.callId);
  } catch (error) { return next(error); }
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
    if (['outcome_uncertain', 'persistence_unavailable'].includes(result.error.code)) return res.status(503).json({ ok: false, error: result.error });
    const status = result.error.retryable === false && result.error.code === 'invalid_arguments' ? 400 : 200;
    return res.status(status).json({ ok: false, error: result.error });
  } catch (err) {
    log({ level: 'error', code: err.code ?? 'invoke_failed', errorClass: err.name ?? 'Error', apiId, tool });
    if (err.code === 'database_commit_outcome_uncertain') {
      return res.status(503).json({ ok: false, error: { code: 'outcome_uncertain', message: 'The write outcome could not be durably confirmed. Do not retry automatically.', retryable: false } });
    }
    return res.status(500).json({ ok: false, error: { code: 'upstream_error', message: 'internal', retryable: false } });
  }
});

app.use((err, _req, res, _next) => {
  if (err?.code === 'database_commit_outcome_uncertain') {
    log({ level: 'error', code: 'database_commit_outcome_uncertain', errorClass: err?.name ?? 'Error' });
    return res.status(503).json({ ok: false, error: { code: 'outcome_uncertain', retryable: false } });
  }
  const databaseUnavailable = ['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ECONNREFUSED', '57P01', '57P02', '57P03'].includes(err?.code)
    || String(err?.code ?? '').startsWith('08');
  const conflict = ['23505', '23503', '40001'].includes(err?.code);
  const invalid = ['23514', '22P02', '22007'].includes(err?.code);
  log({ level: 'error', code: databaseUnavailable ? 'database_unavailable' : err?.code ?? 'request_failed', errorClass: err?.name ?? 'Error' });
  if (databaseUnavailable) return res.status(503).json({ ok: false, error: { code: 'database_unavailable', retryable: true } });
  if (conflict) return res.status(409).json({ ok: false, error: { code: 'conflict', retryable: false } });
  if (invalid) return res.status(400).json({ ok: false, error: { code: 'invalid_arguments', retryable: false } });
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
    try { await flushDurableEvents(); }
    catch { log({ level: 'warn', service: 'api-server', code: 'event_queue_flush_failed' }); }
    try { await closeRedisMirror(); }
    catch { log({ level: 'error', service: 'api-server', code: 'redis_shutdown_error' }); }
    log({ level: 'info', service: 'api-server', code: 'shutdown_complete' });
    await flushLogPersistence();
    try {
      await coreLeaseClient.query('SELECT pg_advisory_unlock($1)', [CORE_INSTANCE_LOCK_KEY]);
      coreLeaseHealthy = false;
      coreLeaseClient.release();
    } catch {
      coreLeaseHealthy = false;
      coreLeaseClient.release(new Error('Discarding PostgreSQL lease connection'));
    }
    try { await closePool(); }
    catch { log({ level: 'error', service: 'api-server', code: 'postgres_pool_shutdown_error' }); }
  })();
  return shutdownPromise;
}

process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
process.once('SIGINT', () => { void shutdown('SIGINT'); });

export { server, app, cfg };
