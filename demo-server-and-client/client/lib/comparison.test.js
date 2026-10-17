import test from 'node:test';
import assert from 'node:assert/strict';
import { describeAgentFinal, describeFailureNotice, runHealthyComparison } from './comparison.js';

test('agent completion display separates provider throttling from upstream rejection', () => {
  const throttled = describeAgentFinal({ outcome: 'error', error: 'quota_or_rate_limit', iterations: 3, mode: 'llm' });
  assert.match(throttled.label, /provider rate limit/i);
  assert.match(throttled.detail, /does not mean the API rejected/i);
  assert.equal(throttled.success, false);

  const capped = describeAgentFinal({ outcome: 'step_limit', error: 'iteration_limit', iterations: 10, mode: 'llm' });
  assert.match(capped.detail, /upstream results are shown separately/i);
  assert.equal(capped.success, false);

  const completed = describeAgentFinal({ outcome: 'completed', iterations: 3, mode: 'llm' });
  assert.equal(completed.success, true);
  assert.match(describeFailureNotice({ code: 'quota_or_rate_limit' }, 'healed'), /provider rate limit stopped healing/i);
});

test('unmutated comparison accepts a direct request and runs the core healthy task', async () => {
  const requests = [];
  const result = await runHealthyComparison({
    mockUrl: 'http://localhost:5001/',
    coreUrl: 'http://localhost:8000',
    apiId: 'demo-users',
    tool: { name: 'get_user', path: '/api/users/get', method: 'POST' },
    args: { user_id: '123' },
    baselineRunId: 'b_test',
    healedRunId: 'h_test',
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      return requests.length === 1
        ? Response.json({ result: { id: '123', name: 'Asha Rao' } })
        : Response.json({ ok: true, data: { id: '123', name: 'Asha Rao' }, meta: { version: 0 } });
    },
  });

  assert.equal(result.baseline.status, 'ok');
  assert.equal(result.baseline.mode, 'direct');
  assert.equal(result.baseline.iterations, 1);
  assert.equal(result.baseline.data.result.id, '123');
  assert.deepEqual(result.baseline.request.body, result.healed.request.args);
  assert.equal(result.healed.status, 'ok');
  assert.equal(result.healed.mode, 'gateway');
  assert.equal(result.healed.gatewayCalls, 1);
  assert.equal(result.healed.version, 0);
  assert.equal(requests[0].url, 'http://localhost:5001/api/users/get');
  assert.equal(requests[1].url, 'http://localhost:8000/apis/demo-users/tools/get_user/invoke');
  assert.deepEqual(JSON.parse(requests[0].init.body), JSON.parse(requests[1].init.body).args);
  assert.equal(JSON.parse(requests[1].init.body).runId, 'h_test');
});

test('unmutated comparison reports rejected direct calls as failures', async () => {
  const result = await runHealthyComparison({
    mockUrl: 'http://localhost:5001', coreUrl: 'http://localhost:8000', apiId: 'demo-users',
    tool: { name: 'get_user', path: '/api/users/get', method: 'POST' }, args: { user_id: '123' },
    baselineRunId: 'b_test', healedRunId: 'h_test',
    fetchImpl: async (_url, init) => init.body?.includes('runId')
      ? Response.json({ ok: false, error: { code: 'upstream_rejected' } })
      : new Response(JSON.stringify({ error: 'bad_request' }), { status: 400 }),
  });
  assert.equal(result.baseline.status, 'fail');
  assert.equal(result.baseline.error, 'bad_request');
  assert.equal(result.healed.status, 'fail');
});
