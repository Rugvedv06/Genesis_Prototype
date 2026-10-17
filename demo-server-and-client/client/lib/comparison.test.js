import test from 'node:test';
import assert from 'node:assert/strict';
import { runUnmutatedComparison } from './comparison.js';

test('unmutated comparison accepts a direct request and runs the core healthy task', async () => {
  const requests = [];
  const result = await runUnmutatedComparison({
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
        : Response.json({ ok: true, step: 3, data: { id: '123', name: 'Asha Rao' } });
    },
  });

  assert.equal(result.baseline.status, 'ok');
  assert.equal(result.baseline.mode, 'direct');
  assert.equal(result.baseline.iterations, 1);
  assert.equal(result.baseline.data.result.id, '123');
  assert.equal(result.healed.status, 'ok');
  assert.equal(result.healed.rounds, 3);
  assert.equal(requests[0].url, 'http://localhost:5001/api/users/get');
  assert.equal(requests[1].url, 'http://localhost:8000/tasks');
  assert.deepEqual(JSON.parse(requests[1].init.body), { apiId: 'demo-users', runId: 'h_test' });
});

test('unmutated comparison reports rejected direct calls as failures', async () => {
  const result = await runUnmutatedComparison({
    mockUrl: 'http://localhost:5001', coreUrl: 'http://localhost:8000', apiId: 'demo-users',
    tool: { name: 'get_user', path: '/api/users/get', method: 'POST' }, args: { user_id: '123' },
    baselineRunId: 'b_test', healedRunId: 'h_test',
    fetchImpl: async () => new Response(JSON.stringify({ error: 'bad_request' }), { status: 400 }),
  });
  assert.equal(result.baseline.status, 'fail');
  assert.equal(result.baseline.error, 'bad_request');
  assert.equal(result.healed.status, 'fail');
});
