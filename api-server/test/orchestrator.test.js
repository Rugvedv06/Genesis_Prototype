import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DATABASE_URL = '';
process.env.HEALR_DATA_DIR = mkdtempSync(join(tmpdir(), 'healr-agent-test-'));
const dataDir = process.env.HEALR_DATA_DIR;
const [{ runTask }, { registryStore }, { bus }, { invoke }] = await Promise.all([
  import('../src/features/orchestrator/index.js'),
  import('../src/features/registry/store.js'),
  import('../src/features/events/bus.js'),
  import('../src/features/executor/invoke.js'),
]);

test.after(() => rmSync(dataDir, { recursive: true, force: true }));

function register(sideEffects = 'none') {
  registryStore.reset();
  registryStore.registerApi('agent-test', { baseUrl: 'https://api.example.com', tools: [
    { name: 'get_user', method: 'POST', path: '/users/get', sideEffects: 'none', parameters: { type: 'object', properties: { user_id: { type: 'string' } }, required: ['user_id'] } },
    { name: 'update_email', method: 'POST', path: '/users/email', sideEffects, parameters: { type: 'object', properties: { user_id: { type: 'string' }, email: { type: 'string' } }, required: ['user_id', 'email'] } },
  ] });
}

const call = (name, args, id = 'call-1') => ({ id, name, args });

test('agent builds declarations from logical schemas and completes tool rounds', async () => {
  register();
  const providerCalls = [];
  const provider = { provider: 'gemini', model: 'fake', generate: async (request) => {
    providerCalls.push(request);
    if (providerCalls.length === 1) return { toolCalls: [call('get_user', { user_id: '123' })], usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 }, provider: 'gemini', model: 'fake', keySlot: 1 };
    if (providerCalls.length === 2) return { toolCalls: [call('update_email', { user_id: '123', email: 'asha@example.com' })], usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 }, provider: 'gemini', model: 'fake', keySlot: 2 };
    return { text: 'Done. The user was updated.', usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 }, provider: 'gemini', model: 'fake', keySlot: 3 };
  } };
  const invocations = [];
  const result = await runTask({ apiId: 'agent-test', prompt: 'Update this user', runId: 'agent-complete', provider, invokeTool: async (input) => { invocations.push(input); return { ok: true, data: { id: '123' } }; } });
  assert.equal(result.outcome, 'completed');
  assert.equal(result.steps, 3);
  assert.equal(result.tokens.input, 9);
  assert.equal(result.tokens.output, 7);
  assert.equal(result.provider, 'gemini');
  assert.equal(result.model, 'fake');
  assert.equal(result.mode, 'llm');
  assert.deepEqual(result.data, { id: '123' }, 'final successful logical tool data is returned for truth checking');
  assert.deepEqual(invocations.map(({ toolName }) => toolName), ['get_user', 'update_email']);
  assert.deepEqual(providerCalls[0].tools.map(({ name }) => name), ['get_user', 'update_email']);
  assert.equal(JSON.stringify(providerCalls[0].tools).includes('/users/get'), false);
  assert.equal(JSON.stringify(providerCalls[0].tools).includes('adapter'), false);
  assert.ok(providerCalls[1].messages.some((message) => message.role === 'tool'));
});

test('agent runs read calls in parallel and writes in model order', async () => {
  register('write');
  let active = 0;
  let peak = 0;
  const order = [];
  const provider = { provider: 'gemini', model: 'fake', generate: async () => ({
    toolCalls: [call('get_user', { user_id: 'a' }, 'a'), call('get_user', { user_id: 'b' }, 'b')], provider: 'gemini', model: 'fake',
  }) };
  const result = await runTask({ apiId: 'agent-test', prompt: 'Read both', runId: 'agent-parallel', provider, maxSteps: 1, invokeTool: async ({ args }) => {
    active += 1; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 10)); active -= 1; order.push(args.user_id); return { ok: true, data: args };
  } });
  assert.equal(result.outcome, 'step_limit');
  assert.equal(peak, 2);

  const writeOrder = [];
  const writeProvider = { provider: 'gemini', model: 'fake', generate: async () => ({ toolCalls: [call('update_email', { user_id: '1', email: 'a@x.co' }, '1'), call('update_email', { user_id: '2', email: 'b@x.co' }, '2')], provider: 'gemini', model: 'fake' }) };
  await runTask({ apiId: 'agent-test', prompt: 'Write twice', runId: 'agent-sequential', maxSteps: 1, provider: writeProvider, invokeTool: async ({ args }) => { writeOrder.push(args.user_id); return { ok: true, data: {} }; } });
  assert.deepEqual(writeOrder, ['1', '2']);
});

test('agent stops after the same non-retryable tool call fails twice', async () => {
  register();
  let modelCalls = 0;
  let toolCalls = 0;
  const provider = { provider: 'gemini', model: 'fake', generate: async () => { modelCalls += 1; return { toolCalls: [call('get_user', { user_id: 'bad' })], provider: 'gemini', model: 'fake' }; } };
  const result = await runTask({ apiId: 'agent-test', prompt: 'Try once', runId: 'agent-duplicate', provider, invokeTool: async () => { toolCalls += 1; return { ok: false, error: { code: 'invalid_arguments', retryable: false, message: 'invalid' } }; } });
  assert.equal(result.outcome, 'halted');
  assert.equal(toolCalls, 2);
  assert.equal(modelCalls, 2);
});

test('agent enforces the step cap, run deadline, caller cancellation and provider error result', async () => {
  register();
  const stepResult = await runTask({ apiId: 'agent-test', prompt: 'loop', runId: 'agent-limit', maxSteps: 1, provider: { provider: 'gemini', model: 'fake', generate: async () => ({ toolCalls: [call('get_user', { user_id: '123' })], provider: 'gemini', model: 'fake' }) }, invokeTool: async () => ({ ok: true, data: {} }) });
  assert.equal(stepResult.outcome, 'step_limit');
  const timeoutResult = await runTask({ apiId: 'agent-test', prompt: 'wait', runId: 'agent-timeout', timeoutMs: 3, provider: { provider: 'gemini', model: 'fake', generate: () => new Promise(() => {}) } });
  assert.equal(timeoutResult.outcome, 'halted');
  const controller = new AbortController();
  const pending = runTask({ apiId: 'agent-test', prompt: 'cancel', runId: 'agent-cancel', signal: controller.signal, provider: { provider: 'gemini', model: 'fake', generate: () => new Promise(() => {}) } });
  controller.abort();
  assert.equal((await pending).outcome, 'cancelled');
  const providerError = await runTask({ apiId: 'agent-test', prompt: 'error', runId: 'agent-error', provider: { provider: 'gemini', model: 'fake', generate: async () => { const error = new Error('offline'); error.code = 'provider_unavailable'; throw error; } } });
  assert.equal(providerError.outcome, 'error');
  assert.equal(providerError.error.code, 'provider_unavailable');
});

test('agent public events include argument keys but never raw tool arguments', async () => {
  register();
  bus.clear();
  const secret = 'private-agent-argument';
  const provider = { provider: 'gemini', model: 'fake', generate: async () => ({ toolCalls: [call('get_user', { user_id: secret })], provider: 'gemini', model: 'fake' }) };
  await runTask({ apiId: 'agent-test', prompt: 'find', runId: 'agent-redaction', maxSteps: 1, provider, invokeTool: async () => ({ ok: true, data: {} }) });
  const events = bus.since(0).filter((event) => event.runId === 'agent-redaction');
  assert.ok(events.some((event) => event.type === 'agent.step' && event.toolCalls?.[0]?.argKeys?.includes('user_id')));
  assert.equal(JSON.stringify(events).includes(secret), false);
});

test('agent completes an M5-healed logical call without seeing adapter details or mixing heal tokens', async () => {
  registryStore.reset();
  const oldTenant = process.env.M5_AGENT_TENANT;
  process.env.M5_AGENT_TENANT = 'tenant-agent-test';
  registryStore.registerApi('agent-m5', {
    baseUrl: 'https://api.example.com', credentials: { 'X-Tenant': { env: 'M5_AGENT_TENANT' } }, healing: { mode: 'auto', tier2: false },
    tools: [{ name: 'get_user', method: 'POST', path: '/api/users/get', sideEffects: 'none', risk: 'low',
      parameters: { type: 'object', properties: { user_id: { type: 'string' } }, required: ['user_id'], additionalProperties: false },
      response: { fields: { id: { path: 'result.id', type: 'string', required: true }, name: { path: 'result.name', type: 'string' }, email: { path: 'result.email', type: 'string' } } } }],
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/openapi.json') || url.pathname.endsWith('/swagger.json')) return new Response('not found', { status: 404 });
    const headers = new Headers(options.headers);
    if (!headers.has('X-Tenant')) return Response.json({ detail: [{ loc: ['header', 'X-Tenant'], msg: 'field required', type: 'value_error.missing' }] }, { status: 400 });
    const body = JSON.parse(options.body ?? '{}');
    if (body.user_id !== undefined) return Response.json({ detail: [
      { loc: ['body', 'target'], msg: 'field required', type: 'value_error.missing' },
      { loc: ['body', 'user_id'], msg: 'extra fields not permitted', type: 'value_error.extra' },
    ] }, { status: 422 });
    if (body.target?.user_id !== undefined) return Response.json({ detail: [
      { loc: ['body', 'target', 'id'], msg: 'field required', type: 'value_error.missing' },
      { loc: ['body', 'target', 'user_id'], msg: 'extra fields not permitted', type: 'value_error.extra' },
    ] }, { status: 422 });
    if (typeof body.target?.id !== 'number') return Response.json({ detail: [{ loc: ['body', 'target', 'id'], msg: 'value is not a valid integer', type: 'type_error.integer' }] }, { status: 422 });
    return Response.json({ result: { id: String(body.target.id), name: 'Asha Rao', email: 'asha@example.com' } });
  };
  const providerRequests = [];
  const provider = { provider: 'gemini', model: 'fake-m5', generate: async (request) => {
    providerRequests.push(request);
    if (providerRequests.length === 1) return { toolCalls: [call('get_user', { user_id: '123' })], usage: { inputTokens: 8, outputTokens: 3 }, provider: 'gemini', model: 'fake-m5' };
    return { text: 'Asha Rao was found.', usage: { inputTokens: 4, outputTokens: 5 }, provider: 'gemini', model: 'fake-m5' };
  } };
  try {
    bus.clear();
    const result = await runTask({ apiId: 'agent-m5', prompt: 'Find user 123', runId: 'agent-m5-heal', provider, invokeTool: invoke });
    assert.equal(result.outcome, 'completed');
    assert.equal(result.steps, 2);
    assert.equal(result.tokens.input, 12);
    assert.equal(result.tokens.output, 8);
    assert.ok(providerRequests[1].messages.some((message) => message.role === 'tool' && message.toolResult.content.ok));
    assert.deepEqual(registryStore.current('agent-m5', 'get_user').versionObj.change.ops.map((op) => op.op), ['add_header', 'move_field', 'rename_field', 'coerce_type']);
    assert.equal(JSON.stringify(providerRequests[0].tools).includes('adapter'), false);
    const agentEvents = bus.since(0).filter((event) => event.runId === 'agent-m5-heal' && ['agent.step', 'agent.final'].includes(event.type));
    assert.equal(JSON.stringify(agentEvents).includes('123'), false, JSON.stringify(agentEvents));
    const agentFinal = bus.since(0).findLast((event) => event.runId === 'agent-m5-heal' && event.type === 'agent.final');
    assert.equal(agentFinal.tokensByRole.agent.input, 12);
    assert.equal(agentFinal.tokensByRole.diagnoser, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    registryStore.reset();
    if (oldTenant === undefined) delete process.env.M5_AGENT_TENANT;
    else process.env.M5_AGENT_TENANT = oldTenant;
  }
});
