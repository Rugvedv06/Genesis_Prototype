// Phase 1 Track B: POST /apis, DELETE /apis/:id, GET /apis (§4.1, §4.5).
// Registration payload: { apiId, baseUrl, specUrl, credentials, healing, tools[] }.
import { registryStore } from '../registry/store.js';
import { emit } from '../events/bus.js';

export function apisRoutes(app) {
  // GET /apis — list registered APIs and current versions
  app.get('/apis', (_req, res) => {
    res.json({ apis: registryStore.list() });
  });

  // POST /apis — register an API (§4.1 payload). Re-registering replaces atomically.
  app.post('/apis', (req, res) => {
    const { apiId, baseUrl, specUrl, credentials, healing, tools } = req.body ?? {};
    if (!apiId || !baseUrl || !Array.isArray(tools) || tools.length === 0) {
      return res.status(400).json({ ok: false, error: 'invalid_arguments', message: 'apiId, baseUrl and tools[] are required' });
    }
    const result = registryStore.registerApi(apiId, { apiId, baseUrl, specUrl, credentials, healing, tools });
    emit({ type: 'api.registered', apiId, baseUrl, specUrl, credentials, healing, toolCount: tools.length, epoch: result.epoch });
    res.json({ ok: true, apiId, tools: result.tools, epoch: result.epoch });
  });

  // DELETE /apis/:apiId — remove (demo reset)
  app.delete('/apis/:apiId', (req, res) => {
    const { apiId } = req.params;
    const removed = registryStore.removeApi(apiId);
    if (!removed) {
      return res.status(404).json({ ok: false, error: 'not_found', message: `api ${apiId} not registered` });
    }
    emit({ type: 'api.removed', apiId });
    res.json({ ok: true, apiId });
  });

  // GET /apis/:apiId/tools/:tool/versions — version history
  app.get('/apis/:apiId/tools/:tool/versions', (req, res) => {
    const { apiId, tool } = req.params;
    const versions = registryStore.versions(apiId, tool);
    if (versions === null) {
      return res.status(404).json({ ok: false, error: 'not_found', message: `tool ${tool} not found in ${apiId}` });
    }
    res.json({ apiId, tool, versions });
  });

  // GET /apis/:apiId/tools/:tool/versions/:n — single version record
  app.get('/apis/:apiId/tools/:tool/versions/:n', (req, res) => {
    const { apiId, tool, n } = req.params;
    const version = registryStore.version(apiId, tool, Number(n));
    if (version === null) {
      return res.status(404).json({ ok: false, error: 'not_found', message: `version ${n} not found` });
    }
    res.json(version);
  });

  // POST /apis/:apiId/tools/:tool/rollback — { "toVersion": 2 }
  app.post('/apis/:apiId/tools/:tool/rollback', (req, res) => {
    const { apiId, tool } = req.params;
    const { toVersion } = req.body ?? {};
    if (toVersion === undefined) {
      return res.status(400).json({ ok: false, error: 'invalid_arguments', message: 'toVersion is required' });
    }
    try {
      const committed = registryStore.rollback(apiId, tool, toVersion);
      res.json({ ok: true, version: committed.version, rollbackOf: committed.rollbackOf });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  // POST /tasks — scripted (non-LLM) task runner (§6 Phase 1 Track B)
  app.post('/tasks', async (req, res) => {
    const { apiId, runId, email } = req.body ?? {};
    if (!apiId) {
      return res.status(400).json({ ok: false, error: 'invalid_arguments', message: 'apiId is required' });
    }
    const { invoke } = await import('../executor/invoke.js');
    const taskRunId = runId ?? `task_${Date.now()}`;
    const { emit: emitTask } = await import('../events/bus.js');

    emitTask({ type: 'agent.step', runId: taskRunId, callId: 'c_task', apiId, tool: 'get_user', iteration: 1 });
    let r1;
    try {
      r1 = await invoke({ apiId, toolName: 'get_user', args: { user_id: '123' }, runId: taskRunId });
    } catch (err) {
      emitTask({ type: 'agent.final', runId: taskRunId, callId: 'c_task', apiId, tool: 'get_user', iteration: 1, outcome: 'error', error: err.message });
      return res.json({ ok: false, runId: taskRunId, error: err.message, step: 1 });
    }
    if (!r1.ok) {
      emitTask({ type: 'agent.final', runId: taskRunId, callId: 'c_task', apiId, tool: 'get_user', iteration: 1, outcome: 'fail', error: r1.error });
      return res.json({ ok: false, runId: taskRunId, error: r1.error, step: 1, data: r1.data });
    }

    emitTask({ type: 'agent.step', runId: taskRunId, callId: 'c_task', apiId, tool: 'update_user_email', iteration: 2 });
    const targetEmail = email ?? 'asha.new@example.com';
    let r2;
    try {
      r2 = await invoke({ apiId, toolName: 'update_user_email', args: { user_id: '123', email: targetEmail }, runId: taskRunId });
    } catch (err) {
      emitTask({ type: 'agent.final', runId: taskRunId, callId: 'c_task', apiId, tool: 'update_user_email', iteration: 2, outcome: 'error', error: err.message });
      return res.json({ ok: false, runId: taskRunId, error: err.message, step: 2, data: r1.data });
    }

    emitTask({ type: 'agent.step', runId: taskRunId, callId: 'c_task', apiId, tool: 'get_user', iteration: 3 });
    let r3;
    try {
      r3 = await invoke({ apiId, toolName: 'get_user', args: { user_id: '123' }, runId: taskRunId });
    } catch (err) {
      emitTask({ type: 'agent.final', runId: taskRunId, callId: 'c_task', apiId, tool: 'get_user', iteration: 3, outcome: 'error', error: err.message });
      return res.json({ ok: false, runId: taskRunId, error: err.message, step: 3, data: r3?.data ?? r1.data });
    }

    emitTask({ type: 'agent.final', runId: taskRunId, callId: 'c_task', apiId, tool: 'get_user', iteration: 3, outcome: r3.ok ? 'success' : 'fail', data: r3.data });
    res.json({ ok: true, runId: taskRunId, step: 3, data: r3.data, results: [r1, r2, r3] });
  });
}
