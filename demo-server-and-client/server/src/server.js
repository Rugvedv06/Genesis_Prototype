// Phase 1: demo-server (mock API + data-driven mutation engine), port 5001.
// Track C: mutations/catalogue.js + mutations/validator.js drive all mutations.
// Health endpoint + admin routes. M5 active for the Phase 1 slice.
import { loadEnv } from './lib/env.js';
loadEnv();

import express from 'express';
import cors from 'cors';
import { get as getMutation, ids as mutationIds } from './mutations/catalogue.js';
import { validateRequest, applyResponseMutation } from './mutations/validator.js';
import { buildOpenApi } from './mutations/openapi.js';
import { eventsRoute } from './events/routes.js';
import { baselineRoutes } from './baseline-agent/routes.js';

function log(record) {
  const line = typeof record === 'string' ? { msg: record } : record;
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...line }));
}

const PORT = Number(process.env.PORT ?? 5001);
const app = express();
app.use(cors());
app.use(express.json());

let state = {
  mutation: null,
  errorStyle: 'pydantic-v1',
  specAvailable: true,
  specStale: false,
  writes: [],
  lastRequests: [],
  taskValues: new Set(),
};

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'demo-server', port: PORT, time: new Date().toISOString() });
});

app.get('/admin/state', (_req, res) => {
  res.json({
    mutation: state.mutation,
    errorStyle: state.errorStyle,
    specAvailable: state.specAvailable,
    writes: state.writes,
    lastRequests: state.lastRequests,
    corruptedWrites: state.writes.filter((w) => w.provenance === 'foreign').length,
  });
});

app.get('/admin/mutations', (_req, res) => {
  res.json({
    mutations: mutationIds().map((id) => {
      const m = getMutation(id);
      return {
        id, label: m.label, category: m.category ?? 'contract', route: m.route,
        recoverable: (m.expected ?? 'heal') !== 'halt', expected: m.expected ?? 'heal',
        expectedOps: m.expectedOps ?? [],
      };
    }),
  });
});

app.post('/admin/mutate', (req, res) => {
  const id = req.body && req.body.id ? String(req.body.id) : null;
  if (id && !getMutation(id)) {
    return res.status(400).json({ ok: false, error: 'unknown_mutation', message: `mutation ${id} not in catalogue` });
  }
  state.mutation = id;
  log({ admin: 'mutate', mutation: state.mutation });
  res.json({ ok: true, mutation: state.mutation });
});

app.post('/admin/reset', (_req, res) => {
  state = { mutation: null, errorStyle: 'pydantic-v1', specAvailable: true, specStale: false, writes: [], lastRequests: [], taskValues: new Set() };
  log({ admin: 'reset' });
  res.json({ ok: true });
});

app.post('/admin/config', (req, res) => {
  if (req.body && ['pydantic-v1', 'pydantic-v2', 'problem-json'].includes(req.body.errorStyle)) state.errorStyle = req.body.errorStyle;
  if (req.body && typeof req.body.specAvailable === 'boolean') state.specAvailable = req.body.specAvailable;
  if (req.body && typeof req.body.specStale === 'boolean') state.specStale = req.body.specStale;
  res.json({ ok: true, config: { errorStyle: state.errorStyle, specAvailable: state.specAvailable, specStale: state.specStale } });
});

app.post('/admin/task', (req, res) => {
  const { values } = req.body ?? {};
  if (Array.isArray(values)) {
    values.forEach((v) => state.taskValues.add(String(v)));
    const aliases = getMutation(state.mutation)?.provenanceAliases ?? {};
    values.forEach((v) => {
      if (Object.hasOwn(aliases, String(v))) state.taskValues.add(String(aliases[String(v)]));
    });
  }
  res.json({ ok: true, taskValues: Array.from(state.taskValues) });
});

app.get('/admin/truth/users/:id', (_req, res) => {
  const { id } = _req.params;
  // The mock DB is authoritative. Start from v1 truth; writes may have mutated email.
  const write = [...state.writes].reverse().find((w) => w.args.user_id === id && w.route === '/api/users/update-email');
  const statusWrite = [...state.writes].reverse().find((w) => w.args.user_id === id && w.route === '/api/users/set-status');
  const email = write ? write.args.email : 'asha@example.com';
  const status = statusWrite?.args.status ?? 'active';
  res.json({ id, name: 'Asha Rao', email, status });
});

eventsRoute(app);
baselineRoutes(app);

app.get('/openapi.json', (_req, res) => {
  if (!state.specAvailable) return res.status(404).json({ error: 'spec_unavailable' });
  const spec = buildOpenApi(state.specStale ? null : state.mutation);
  if (state.specStale) spec['x-healr-spec-stale'] = true;
  res.json(spec);
});

// ---- domain routes ----

// Helper: check if the active mutation applies to this route.
function mutationForRoute(path) {
  const m = state.mutation ? getMutation(state.mutation) : null;
  if (!m) return null;
  const routePath = m.route?.path;
  if (routePath && path === routePath) return m;
  // Also match if route is an array
  if (Array.isArray(m.route?.path) && m.route.path.includes(path)) return m;
  return null;
}

function recordRequest(route, status, startedAt) {
  state.lastRequests.push({ route, status, ms: Date.now() - startedAt });
  if (state.lastRequests.length > 50) state.lastRequests.shift();
}

// POST /api/users/get — subject to active mutation
app.post('/api/users/get', (req, res) => {
  const startedAt = Date.now();
  const mutation = mutationForRoute(req.path);
  const violated = mutation ? validateRequest(mutation, req.body, req.headers, state.errorStyle) : null;
  if (violated) {
    log({ route: '/api/users/get', mutation: state.mutation, status: violated.status });
    recordRequest(req.path, violated.status, startedAt);
    return res.status(violated.status).json(violated.body);
  }
  const baseResponse = mutation?.transformResponse
    ? mutation.transformResponse(req.body)
    : { result: { id: req.body.user_id ?? 'unknown', name: 'Asha Rao', email: 'asha@example.com' } };
  const body = applyResponseMutation(baseResponse, mutation?.responseOps);
  recordRequest(req.path, 200, startedAt);
  res.json(body);
});

// POST /api/users/update-email — write, recorded with provenance
app.post('/api/users/update-email', (req, res) => {
  const startedAt = Date.now();
  const mutation = mutationForRoute(req.path);
  const violated = mutation ? validateRequest(mutation, req.body, req.headers, state.errorStyle) : null;
  if (violated) {
    recordRequest(req.path, violated.status, startedAt);
    return res.status(violated.status).json(violated.body);
  }
  const args = req.body ?? {};
  // Real provenance: stamp 'foreign' if any write value is not in taskValues.
  const allValues = Object.values(args).filter((v) => v !== undefined && v !== null).map(String);
  const foreign = allValues.some((v) => !state.taskValues.has(v));
  const write = {
    route: '/api/users/update-email',
    args,
    ts: new Date().toISOString(),
    provenance: foreign ? 'foreign' : 'task',
  };
  state.writes.push(write);
  log({ admin: 'write', write });
  recordRequest(req.path, 200, startedAt);
  res.json({ result: { id: args.user_id, email: args.email, updated_at: new Date().toISOString() } });
});

// POST /api/users/set-status — write
app.post('/api/users/set-status', (req, res) => {
  const mutation = mutationForRoute(req.path);
  const violated = mutation ? validateRequest(mutation, req.body, req.headers, state.errorStyle) : null;
  if (violated) {
    return res.status(violated.status).json(violated.body);
  }
  const args = req.body ?? {};
  const allValues = Object.values(args).filter((v) => v !== undefined && v !== null).map(String);
  const foreign = allValues.some((v) => !state.taskValues.has(v));
  const write = { route: '/api/users/set-status', args, ts: new Date().toISOString(), provenance: foreign ? 'foreign' : 'task' };
  state.writes.push(write);
  res.json({ result: { id: args.user_id, status: args.status } });
});

// POST /api/orders/get
app.post('/api/orders/get', (req, res) => {
  res.json({ result: { order_id: req.body.order_id, status: 'fulfilled' } });
});

const server = app.listen(PORT, () => {
  log({ level: 'info', service: 'demo-server', port: PORT, msg: 'listening' });
});

export { server, app };
