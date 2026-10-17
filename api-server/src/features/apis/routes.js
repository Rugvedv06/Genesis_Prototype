// Phase 1 Track B: POST /apis, DELETE /apis/:id, GET /apis (§4.1, §4.5).
// Registration payload: { apiId, baseUrl, specUrl, credentials, healing, tools[] }.
import { registryStore } from '../registry/store.js';
import { emit } from '../events/bus.js';
import { append as appendAudit } from '../audit/index.js';
import { cfg } from '../../config.js';
import { validateUpstreamUrl } from '../http/url-policy.js';
<<<<<<< HEAD
=======
<<<<<<< HEAD
>>>>>>> origin/main
import { getPool } from '../../db/pool.js';
import { withTransaction } from '../../db/transaction.js';
import { getApiConfig, listApiTools, listToolVersions } from '../../db/registry-repository.js';
import { listRunEvents } from '../../db/event-repository.js';
import { commitFromCache, registerApi as registerApiInDatabase, removeApi as removeApiInDatabase,
  rollbackFromCache, updateApiConfig as updateApiConfigInDatabase } from '../../db/registry-service.js';
import { randomUUID } from 'node:crypto';
import { activeRunCount, cancelRun, getRun, startRun } from '../orchestrator/runs.js';
import { previewOpenApi, previewOpenApiUrl } from './import/openapi-import.js';
<<<<<<< HEAD
=======
=======
>>>>>>> origin/main
>>>>>>> origin/main

function publicConfig(config) {
  const safe = { ...config };
  delete safe.credentials;
  return safe;
}
<<<<<<< HEAD
=======
<<<<<<< HEAD
>>>>>>> origin/main

export function apisRoutes(app, dependencies = {}) {
  app.post('/apis/import/openapi/preview', async (req, res) => {
    const { url, spec } = req.body ?? {};
    if ((url === undefined) === (spec === undefined)) return res.status(400).json({ ok: false, error: 'invalid_arguments', message: 'Provide exactly one of url or spec.' });
    try {
      const preview = url !== undefined
        ? await (dependencies.previewOpenApiUrl ?? previewOpenApiUrl)(url, { fetchImpl: dependencies.fetchImpl })
        : previewOpenApi(spec);
      return res.json(preview);
    } catch (error) {
      return res.status(400).json({ ok: false, error: 'invalid_openapi', message: String(error.message ?? 'OpenAPI document is invalid').slice(0, 500) });
    }
  });
<<<<<<< HEAD
=======
=======
>>>>>>> origin/main
>>>>>>> origin/main

  // GET /apis — list registered APIs and current versions
  app.get('/apis', async (_req, res, next) => {
    try { res.json({ apis: process.env.DATABASE_URL ? await listApiTools(getPool()) : registryStore.list() }); }
    catch (error) { next(error); }
  });

  app.get('/apis/:apiId', async (req, res, next) => {
    try {
    const api = process.env.DATABASE_URL ? await getApiConfig(getPool(), req.params.apiId) : registryStore.config(req.params.apiId);
    if (!api) return res.status(404).json({ ok: false, error: 'not_found' });
    const allTools = process.env.DATABASE_URL ? await listApiTools(getPool()) : registryStore.list();
    const tools = allTools.filter((item) => item.apiId === req.params.apiId).map((item) => {
      const current = registryStore.current(req.params.apiId, item.tool);
      const meta = current?.versionObj?.meta ?? {};
      return {
        ...item,
        name: item.tool,
        description: `Invoke ${item.tool} using its logical arguments.`,
        method: meta.method ?? 'POST',
        path: meta.path ?? '',
        parameters: meta.logicalSchema ?? { type: 'object', properties: {}, required: [] },
        sideEffects: meta.sideEffects ?? current?.versionObj?.adapter?.sideEffects ?? 'write',
      };
    });
    res.json({ apiId: req.params.apiId, config: publicConfig(api.config ?? api), tools });
    } catch (error) { next(error); }
  });

  app.patch('/apis/:apiId/config', async (req, res, next) => {
    const allowed = ['mode', 'confidenceThreshold', 'maxRounds', 'tier2', 'healing'];
    const patch = Object.fromEntries(Object.entries(req.body ?? {}).filter(([key]) => allowed.includes(key)));
    if (patch.mode) patch.healing = { ...(patch.healing ?? {}), mode: patch.mode };
    let config;
    try {
      if (process.env.DATABASE_URL) {
        const result = await updateApiConfigInDatabase(req.params.apiId, patch);
        config = result.value?.config;
      } else config = registryStore.setConfig(req.params.apiId, patch);
    } catch (error) {
      if (error instanceof TypeError) return res.status(400).json({ ok: false, error: 'invalid_arguments' });
      return next(error);
    }
    if (!config) return res.status(404).json({ ok: false, error: 'not_found' });
    const safeConfig = publicConfig(config);
    if (!process.env.DATABASE_URL) emit({ type: 'config.changed', apiId: req.params.apiId, config: safeConfig });
    res.json({ ok: true, apiId: req.params.apiId, config: safeConfig });
<<<<<<< HEAD
=======
  });

  app.get('/apis/:apiId', (req, res) => {
    const api = registryStore.config(req.params.apiId);
    if (!api) return res.status(404).json({ ok: false, error: 'not_found' });
    res.json({ apiId: req.params.apiId, config: publicConfig(api), tools: registryStore.list().filter((item) => item.apiId === req.params.apiId) });
  });

  app.patch('/apis/:apiId/config', (req, res) => {
    const allowed = ['mode', 'confidenceThreshold', 'maxRounds', 'tier2', 'healing'];
    const patch = Object.fromEntries(Object.entries(req.body ?? {}).filter(([key]) => allowed.includes(key)));
    if (patch.mode) patch.healing = { ...(patch.healing ?? {}), mode: patch.mode };
    const config = registryStore.setConfig(req.params.apiId, patch);
    if (!config) return res.status(404).json({ ok: false, error: 'not_found' });
    const safeConfig = publicConfig(config);
    emit({ type: 'config.changed', apiId: req.params.apiId, config: safeConfig });
    res.json({ ok: true, apiId: req.params.apiId, config: safeConfig });
>>>>>>> origin/main
  });

  // POST /apis — register an API (§4.1 payload). Re-registering replaces atomically.
  app.post('/apis', async (req, res, next) => {
    const { apiId, baseUrl, specUrl, credentials, healing, tools } = req.body ?? {};
    if (!apiId || !baseUrl || !Array.isArray(tools) || tools.length === 0) {
      return res.status(400).json({ ok: false, error: 'invalid_arguments', message: 'apiId, baseUrl and tools[] are required' });
    }
    try {
      validateUpstreamUrl(baseUrl, { allowLocal: cfg.allowLocalUpstreams });
      if (specUrl) validateUpstreamUrl(specUrl, { allowLocal: cfg.allowLocalUpstreams });
    } catch (error) {
      return res.status(400).json({ ok: false, error: 'invalid_upstream_url', message: error.message });
    }
<<<<<<< HEAD
=======
<<<<<<< HEAD
>>>>>>> origin/main
    try {
      const payload = { apiId, baseUrl, specUrl, credentials, healing, tools };
      const result = process.env.DATABASE_URL
        ? (await registerApiInDatabase(payload)).value
        : registryStore.registerApi(apiId, payload);
      if (!process.env.DATABASE_URL) emit({ type: 'api.registered', apiId, baseUrl, specUrl, healing, toolCount: tools.length, epoch: result.epoch });
      res.json({ ok: true, apiId, tools: result.tools, epoch: result.epoch });
    } catch (error) {
      if (error instanceof TypeError) return res.status(400).json({ ok: false, error: 'invalid_arguments' });
      next(error);
    }
<<<<<<< HEAD
=======
=======
    const result = registryStore.registerApi(apiId, { apiId, baseUrl, specUrl, credentials, healing, tools });
    emit({ type: 'api.registered', apiId, baseUrl, specUrl, healing, toolCount: tools.length, epoch: result.epoch });
    res.json({ ok: true, apiId, tools: result.tools, epoch: result.epoch });
>>>>>>> origin/main
>>>>>>> origin/main
  });

  // DELETE /apis/:apiId — remove (demo reset)
  app.delete('/apis/:apiId', async (req, res, next) => {
    const { apiId } = req.params;
    let removed;
    try {
      removed = process.env.DATABASE_URL
        ? (await removeApiInDatabase(apiId)).value.removed
        : registryStore.removeApi(apiId);
    } catch (error) { return next(error); }
    if (!removed) {
      return res.status(404).json({ ok: false, error: 'not_found', message: `api ${apiId} not registered` });
    }
    if (!process.env.DATABASE_URL) emit({ type: 'api.removed', apiId });
    res.json({ ok: true, apiId });
  });

  // GET /apis/:apiId/tools/:tool/versions — version history
  app.get('/apis/:apiId/tools/:tool/versions', async (req, res, next) => {
    const { apiId, tool } = req.params;
    let versions;
    try { versions = process.env.DATABASE_URL ? await listToolVersions(getPool(), apiId, tool) : registryStore.versions(apiId, tool); }
    catch (error) { return next(error); }
    if (versions === null) {
      return res.status(404).json({ ok: false, error: 'not_found', message: `tool ${tool} not found in ${apiId}` });
    }
    res.json({ apiId, tool, versions });
  });

  // GET /apis/:apiId/tools/:tool/versions/:n — single version record
  app.get('/apis/:apiId/tools/:tool/versions/:n', async (req, res, next) => {
    const { apiId, tool, n } = req.params;
    if (!/^\d{1,9}$/.test(n) || Number(n) < 1) return res.status(400).json({ ok: false, error: 'invalid_arguments' });
    let version;
    try {
      if (process.env.DATABASE_URL) version = (await listToolVersions(getPool(), apiId, tool)).find((item) => item.version === Number(n));
      else version = registryStore.version(apiId, tool, Number(n));
    } catch (error) { return next(error); }
    if (version == null) {
      return res.status(404).json({ ok: false, error: 'not_found', message: `version ${n} not found` });
    }
    res.json(version);
  });

<<<<<<< HEAD
=======
<<<<<<< HEAD
>>>>>>> origin/main
  app.get('/apis/:apiId/tools/:tool/diff', async (req, res, next) => {
    let diff;
    try {
      if (process.env.DATABASE_URL) {
        const versions = await listToolVersions(getPool(), req.params.apiId, req.params.tool);
        const before = versions.find((item) => item.version === Number(req.query.from));
        const after = versions.find((item) => item.version === Number(req.query.to));
        if (before && after) {
          const beforeOps = before.adapter.request ?? [];
          const afterOps = after.adapter.request ?? [];
          const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
          diff = { added: afterOps.filter((op) => !beforeOps.some((old) => same(old, op))), removed: beforeOps.filter((op) => !afterOps.some((nextOp) => same(nextOp, op))), requestBefore: before.adapter, requestAfter: after.adapter };
        }
      } else diff = registryStore.diff(req.params.apiId, req.params.tool, Number(req.query.from), Number(req.query.to));
    } catch (error) { return next(error); }
<<<<<<< HEAD
=======
=======
  app.get('/apis/:apiId/tools/:tool/diff', (req, res) => {
    const diff = registryStore.diff(req.params.apiId, req.params.tool, Number(req.query.from), Number(req.query.to));
>>>>>>> origin/main
>>>>>>> origin/main
    if (!diff) return res.status(404).json({ ok: false, error: 'not_found' });
    res.json(diff);
  });

  // POST /apis/:apiId/tools/:tool/rollback — { "toVersion": 2 }
  app.post('/apis/:apiId/tools/:tool/rollback', async (req, res, next) => {
    const { apiId, tool } = req.params;
    const { toVersion } = req.body ?? {};
    if (toVersion === undefined) {
      return res.status(400).json({ ok: false, error: 'invalid_arguments', message: 'toVersion is required' });
    }
    if (!Number.isSafeInteger(Number(toVersion)) || Number(toVersion) < 1) {
      return res.status(400).json({ ok: false, error: 'invalid_arguments', message: 'toVersion must be a positive integer' });
    }
    try {
<<<<<<< HEAD
=======
<<<<<<< HEAD
>>>>>>> origin/main
      let committed;
      if (process.env.DATABASE_URL) {
        const current = registryStore.current(apiId, tool);
        committed = (await rollbackFromCache({ apiId, toolName: tool, toVersion: Number(toVersion), current })).value;
      } else {
        committed = registryStore.rollback(apiId, tool, toVersion);
        appendAudit({ decision: 'rollback', apiId, tool, versionBefore: committed.parent, versionAfter: committed.version, adapterHash: committed.adapterHash, rollbackOf: committed.rollbackOf });
        emit({ type: 'registry.rollback', apiId, tool, version: committed.version, rollbackOf: committed.rollbackOf });
      }
<<<<<<< HEAD
=======
=======
      const committed = registryStore.rollback(apiId, tool, toVersion);
      appendAudit({ decision: 'rollback', apiId, tool, versionBefore: committed.parent, versionAfter: committed.version, rollbackOf: committed.rollbackOf });
      emit({ type: 'registry.rollback', apiId, tool, version: committed.version, rollbackOf: committed.rollbackOf });
>>>>>>> origin/main
>>>>>>> origin/main
      res.json({ ok: true, version: committed.version, rollbackOf: committed.rollbackOf });
    } catch (err) {
      if (err.code === 'stale_adapter_version') return res.status(409).json({ ok: false, error: 'stale_adapter_version' });
      if (process.env.DATABASE_URL && !['TypeError'].includes(err.name)) return next(err);
      res.status(400).json({ ok: false, error: err.message });
    }
  });

<<<<<<< HEAD
  app.post('/dev/force-bad-commit', async (req, res, next) => {
=======
<<<<<<< HEAD
  app.post('/dev/force-bad-commit', async (req, res, next) => {
=======
  app.post('/dev/force-bad-commit', (req, res) => {
>>>>>>> origin/main
>>>>>>> origin/main
    if (!cfg.enableDevRoutes) return res.status(404).json({ ok: false, error: 'not_found' });
    const { apiId, tool } = req.body ?? {};
    const current = registryStore.current(apiId, tool);
    if (!current) return res.status(404).json({ ok: false, error: 'not_found' });
    const adapter = {
      ...current.versionObj.adapter,
      request: [...(current.versionObj.adapter.request ?? []), { op: 'rename_field', from: '__healr_bad_field__', to: '__healr_bad_field__' }],
    };
<<<<<<< HEAD
=======
<<<<<<< HEAD
>>>>>>> origin/main
    let committed;
    try {
      const change = { ops: adapter.request.slice(-1), tier: 1, confidence: 1, evidence: ['developer forced bad commit'] };
      committed = process.env.DATABASE_URL
        ? (await commitFromCache({ apiId, toolName: tool, adapter, change, origin: 'dev', current })).value
        : registryStore.commit(apiId, tool, adapter, change, 'dev');
      if (!process.env.DATABASE_URL) emit({ type: 'patch.committed', apiId, tool, version: committed.version, ops: committed.change.ops, dev: true });
    } catch (error) { return next(error); }
<<<<<<< HEAD
=======
=======
    const committed = registryStore.commit(apiId, tool, adapter, { ops: adapter.request.slice(-1), tier: 1, confidence: 1, evidence: ['developer forced bad commit'] }, 'dev');
    emit({ type: 'patch.committed', apiId, tool, version: committed.version, ops: committed.change.ops, dev: true });
>>>>>>> origin/main
>>>>>>> origin/main
    res.json({ ok: true, version: committed.version });
  });

  // POST /tasks — scripted (non-LLM) task runner (§6 Phase 1 Track B)
  app.post('/tasks', async (req, res) => {
    const { apiId, runId, email, prompt, wait } = req.body ?? {};
    if (!apiId) {
      return res.status(400).json({ ok: false, error: 'invalid_arguments', message: 'apiId is required' });
    }
    if (Object.hasOwn(req.body ?? {}, 'prompt')) {
      if (typeof prompt !== 'string' || !prompt.trim()) return res.status(400).json({ ok: false, error: 'invalid_arguments', message: 'prompt must be a non-empty string' });
      const taskRunId = String(runId ?? `agent_${randomUUID()}`);
      if (taskRunId.length > 128) return res.status(400).json({ ok: false, error: 'invalid_arguments', message: 'runId exceeds 128 characters' });
      const existing = getRun(taskRunId);
      if (existing) return wait === true && existing.result ? res.json(existing.result) : res.status(202).json({ runId: taskRunId });
      if (activeRunCount() >= cfg.agentMaxConcurrentRuns) return res.status(429).json({ ok: false, error: 'agent_run_limit', retryable: true });
      const { run } = startRun({ runId: taskRunId, apiId, execute: async (signal) => {
        const runTask = dependencies.runTask ?? (await import('../orchestrator/index.js')).runTask;
        return runTask({ apiId, prompt, runId: taskRunId, signal });
      } });
      if (wait === true) return res.json(await run.promise);
      return res.status(202).json({ runId: taskRunId });
    }
    if (runId && typeof runId !== 'string') return res.status(400).json({ ok: false, error: 'invalid_arguments', message: 'runId must be a string' });
    const { invoke } = await import('../executor/invoke.js');
    const taskRunId = runId ?? `task_${Date.now()}`;
    const { emit: emitTask } = await import('../events/bus.js');

    emitTask({ type: 'agent.step', runId: taskRunId, apiId, tool: 'get_user', iteration: 1 });
    let r1;
    try {
      r1 = await invoke({ apiId, toolName: 'get_user', args: { user_id: '123' }, runId: taskRunId });
    } catch (err) {
      emitTask({ type: 'agent.final', runId: taskRunId, apiId, tool: 'get_user', iteration: 1, outcome: 'error', error: err.message });
      return res.json({ ok: false, runId: taskRunId, error: err.message, step: 1 });
    }
    if (!r1.ok) {
      emitTask({ type: 'agent.final', runId: taskRunId, apiId, tool: 'get_user', iteration: 1, outcome: 'fail', error: r1.error });
      return res.json({ ok: false, runId: taskRunId, error: r1.error, step: 1, data: r1.data });
    }

    emitTask({ type: 'agent.step', runId: taskRunId, apiId, tool: 'update_user_email', iteration: 2 });
    const targetEmail = email ?? 'asha.new@example.com';
    let r2;
    try {
      r2 = await invoke({ apiId, toolName: 'update_user_email', args: { user_id: '123', email: targetEmail }, runId: taskRunId });
    } catch (err) {
      emitTask({ type: 'agent.final', runId: taskRunId, apiId, tool: 'update_user_email', iteration: 2, outcome: 'error', error: err.message });
      return res.json({ ok: false, runId: taskRunId, error: err.message, step: 2, data: r1.data });
    }

    emitTask({ type: 'agent.step', runId: taskRunId, apiId, tool: 'get_user', iteration: 3 });
    let r3;
    try {
      r3 = await invoke({ apiId, toolName: 'get_user', args: { user_id: '123' }, runId: taskRunId });
    } catch (err) {
      emitTask({ type: 'agent.final', runId: taskRunId, apiId, tool: 'get_user', iteration: 3, outcome: 'error', error: err.message });
      return res.json({ ok: false, runId: taskRunId, error: err.message, step: 3, data: r3?.data ?? r1.data });
    }

    emitTask({ type: 'agent.final', runId: taskRunId, apiId, tool: 'get_user', iteration: 3, outcome: r3.ok ? 'success' : 'fail', data: r3.data });
    res.json({ ok: true, runId: taskRunId, step: 3, data: r3.data, results: [r1, r2, r3] });
  });

  app.get('/tasks/:runId', async (req, res, next) => {
    const local = getRun(req.params.runId);
    if (local) return res.json(local);
    try {
      const events = process.env.DATABASE_URL
        ? await (dependencies.listRunEvents ?? listRunEvents)(getPool(), req.params.runId)
        : (await import('../events/bus.js')).since(0).filter((event) => event.runId === req.params.runId);
      if (!events.length) return res.status(404).json({ ok: false, error: 'not_found', runId: req.params.runId });
      const final = [...events].reverse().find((event) => event.type === 'agent.final');
      return res.json({ runId: req.params.runId, status: final?.outcome ?? 'running', result: final ? {
        runId: req.params.runId, apiId: final.apiId, outcome: final.outcome, steps: final.steps,
        tokens: final.tokens, provider: final.provider, model: final.model, mode: final.mode,
      } : null });
    } catch (error) { return next(error); }
  });

  app.delete('/tasks/:runId', (req, res) => {
    const result = cancelRun(req.params.runId);
    return res.json({ ok: true, runId: req.params.runId, cancelled: result.cancelled });
  });
}
