import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AGENT_SYSTEM_PROMPT, buildAgentTaskPrompt } from '@healr/llm/prompts';
import { runTask } from '../src/baseline-agent/index.js';
import { baselineRoutes } from '../src/baseline-agent/routes.js';
process.env.DATABASE_URL = '';
process.env.HEALR_DATA_DIR = mkdtempSync(join(tmpdir(), 'healr-baseline-test-'));
const dataDir = process.env.HEALR_DATA_DIR;
const [{ registryStore }, { toolCatalogue }] = await Promise.all([
  import('../../../api-server/src/features/registry/store.js'), import('../../../api-server/src/features/orchestrator/index.js'),
]);

const details = { apiId: 'baseline-fixture', config: { baseUrl: 'https://api.example.test' }, tools: [
  { tool: 'get_user', description: 'Get user', method: 'POST', path: '/users/get', risk: 'low', sideEffects: 'none', parameters: { type: 'object', properties: { user_id: { type: 'string' } }, required: ['user_id'] } },
  { tool: 'update_user_email', description: 'Update email', method: 'POST', path: '/users/email', risk: 'medium', sideEffects: 'write', parameters: { type: 'object', properties: { user_id: { type: 'string' }, email: { type: 'string' } }, required: ['user_id', 'email'] } },
] };
const call = (name, args, id) => ({ name, args, id });
const coreFetchImpl = async () => Response.json(details);

test('baseline shares the agent prompts and logical tool declarations and completes the full task', async () => {
  const calls = [];
  registryStore.reset();
  registryStore.registerApi(details.apiId, { baseUrl: details.config.baseUrl, tools: details.tools.map(({ tool, name, ...rest }) => ({ ...rest, name: name ?? tool })) });
  const provider = { provider: 'gemini', model: 'same-model', generate: async (request) => {
    calls.push(request);
    if (calls.length === 1) return { toolCalls: [call('get_user', { user_id: '123' }, '1')], usage: { inputTokens: 3, outputTokens: 2 } };
    if (calls.length === 2) return { toolCalls: [call('update_user_email', { user_id: '123', email: 'asha.new@example.com' }, '2')], usage: { inputTokens: 4, outputTokens: 2 } };
    if (calls.length === 3) return { toolCalls: [call('get_user', { user_id: '123' }, '3')], usage: { inputTokens: 3, outputTokens: 1 } };
    return { text: 'Asha Rao now has asha.new@example.com.', toolCalls: [], usage: { inputTokens: 2, outputTokens: 4 } };
  } };
  const upstream = [];
  const result = await runTask({ apiId: details.apiId, prompt: 'Fetch user 123, change email and report name and email.', mode: 'llm', provider, coreFetchImpl, upstreamFetchImpl: async (url, init) => {
    upstream.push({ url: String(url), body: init.body && JSON.parse(init.body) });
    return Response.json({ result: upstream.length === 3 ? { id: '123', name: 'Asha Rao', email: 'asha.new@example.com' } : { id: '123' } });
  }, emitEvent: () => {} });
  assert.equal(result.outcome, 'completed');
  assert.equal(result.mode, 'llm');
  assert.equal(result.iterations, 4);
  assert.equal(result.provider, 'gemini');
  assert.equal(result.model, 'same-model');
  assert.equal(result.tokens.inputTokens, 12);
  assert.equal(upstream.length, 3);
  assert.deepEqual(calls[0].tools.map((tool) => tool.name), ['get_user', 'update_user_email']);
  assert.equal(calls[0].system, AGENT_SYSTEM_PROMPT);
  assert.equal(calls[0].messages[0].text, buildAgentTaskPrompt('Fetch user 123, change email and report name and email.'));
  assert.equal(JSON.stringify(calls[0].tools).includes('/users/get'), false);
  assert.deepEqual(calls[0].tools, toolCatalogue(details.apiId).map(({ name, description, parameters }) => ({ name, description, parameters })));
});

test('baseline raw executor never applies healing and transparently reaches the iteration cap under M5', async () => {
  const m5Tool = { ...details.tools[0], parameters: { type: 'object', properties: { user_id: { type: 'string' } }, required: ['user_id'] } };
  const upstreamBodies = [];
  let modelCalls = 0;
  const result = await runTask({ apiId: details.apiId, prompt: 'Get user 123', mode: 'llm', provider: { provider: 'gemini', model: 'same-model', generate: async () => {
    modelCalls += 1;
    return { toolCalls: [call('get_user', { user_id: '123' }, String(modelCalls))], usage: { inputTokens: 1, outputTokens: 1 } };
  } }, coreFetchImpl: async () => Response.json({ ...details, tools: [m5Tool] }), upstreamFetchImpl: async (_url, init) => {
    upstreamBodies.push(JSON.parse(init.body));
    return Response.json({ detail: [{ loc: ['body', 'target'], msg: 'field required' }] }, { status: 422 });
  }, emitEvent: () => {} });
  assert.equal(result.outcome, 'step_limit');
  assert.equal(result.mode, 'llm');
  assert.equal(result.iterations, 10);
  assert.equal(modelCalls, 10);
  assert.ok(upstreamBodies.every((body) => JSON.stringify(body) === '{"user_id":"123"}'));
  assert.deepEqual(registrationAdapterKeys(result), []);
});

test('scripted backup mode is visible in result and emitted events', async () => {
  const events = [];
  const result = await runTask({ apiId: details.apiId, prompt: 'Get user', mode: 'scripted', taskArgs: { user_id: '123' }, coreFetchImpl, upstreamFetchImpl: async () => new Response('bad', { status: 422 }), emitEvent: (event) => events.push(event) });
  assert.equal(result.mode, 'scripted');
  assert.ok(events.filter((event) => ['agent.step', 'agent.final'].includes(event.type)).every((event) => event.mode === 'scripted'));
});

test('baseline reports a confident model answer separately from wrong M10 response data', async () => {
  const result = await runTask({ apiId: details.apiId, prompt: 'Get user 123, update email, and report the name and email.', mode: 'llm', provider: {
    provider: 'gemini', model: 'same-model', generate: async (request) => request.messages.some((message) => message.role === 'tool')
      ? { text: 'Asha Rao has asha.new@example.com.', toolCalls: [], usage: {} }
      : { toolCalls: [call('get_user', { user_id: '123' }, 'm10')], usage: {} },
  }, coreFetchImpl, upstreamFetchImpl: async () => Response.json({ result: { id: '123', full_name: 'Asha Rao', email: 'asha@example.com' } }), emitEvent: () => {} });
  assert.equal(result.outcome, 'completed');
  assert.match(result.answer, /Asha Rao/);
  assert.equal(result.data.result.name, undefined);
  assert.equal(result.data.result.full_name, 'Asha Rao');
});

test('baseline HTTP route returns mode, model, answer, token totals and trace', async () => {
  let handler;
  baselineRoutes({ post: (path, callback) => { assert.equal(path, '/demo/run'); handler = callback; } }, { runTask: async (input) => ({
    ...input, ok: true, outcome: 'completed', mode: 'llm', provider: 'gemini', model: 'same-model', answer: 'done', iterations: 2,
    tokens: { inputTokens: 4, outputTokens: 3, totalTokens: 7 }, trace: [],
  }) });
  let response;
  const res = { status(code) { this.statusCode = code; return this; }, json(body) { response = body; return this; } };
  await handler({ body: { apiId: 'api', prompt: 'task', runId: 'baseline-route' } }, res);
  assert.equal(res.statusCode, undefined);
  assert.equal(response.mode, 'llm');
  assert.equal(response.model, 'same-model');
  assert.equal(response.answer, 'done');
  assert.equal(response.tokens.totalTokens, 7);
});

test.after(() => rmSync(dataDir, { recursive: true, force: true }));

function registrationAdapterKeys(result) { return Object.keys(result).filter((key) => /adapter|wire/i.test(key)); }
