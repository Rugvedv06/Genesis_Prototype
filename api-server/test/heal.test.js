// Phase 1 golden test: full M5 heal loop end-to-end (§5.1-5.3, §6 Phase 1 exit gate).
// Stubbed fetch returns layered errors round by round, then 200 on the 5th call.
// Expects 4 committed ops: add_header, move_field, rename_field, coerce_type.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invoke } from '../src/features/executor/invoke.js';
import { registryStore } from '../src/features/registry/store.js';
import { emit, clear as clearBus } from '../src/features/events/bus.js';
import { loadGolden, goldenBody } from './helpers/golden.js';

const API_ID = 'demo-users';
const TOOL = 'get_user';

const v1Adapter = {
  request: [],
  response: { map: { id: 'result.id', name: 'result.name', email: 'result.email' } },
  _path: '/api/users/get',
  _method: 'POST',
  sideEffects: 'none',
  _logicalSchema: {
    type: 'object',
    properties: { user_id: { type: 'string' } },
    required: ['user_id'],
    additionalProperties: false,
  },
};

function registerAPI() {
  registryStore.reset();
  registryStore.register(API_ID, TOOL, v1Adapter, 'low', {
    baseUrl: 'http://localhost:5001',
    credentials: { 'X-Tenant': { env: 'TENANT_ID' } },
    healing: { enabled: true, maxRounds: 5, tier2: true },
  });
}

// Round-by-round stub derived from golden fixtures: header missing ->
// target missing+user_id extra -> target.id missing+user_id extra ->
// target.id type error -> 200 success
const m5 = goldenBody('pydantic-v1', 'm5');
const responses = [
  // Round 0: header missing (from the header key in golden)
  { ok: false, status: 400, json: { error: 'missing_header', header: 'X-Tenant' }, text: '{"error":"missing_header","header":"X-Tenant"}' },
  // Round 1: target missing + user_id extra (first two detail entries)
  {
    ok: false, status: 422,
    json: { detail: m5.detail.slice(0, 2) },
    text: JSON.stringify({ detail: m5.detail.slice(0, 2) }),
  },
  // Round 2: target.id missing + target.user_id extra (detail[2] + a synthesized extra)
  {
    ok: false, status: 422,
    json: { detail: [m5.detail[2], { loc: ['body', 'target', 'user_id'], msg: 'extra fields not permitted', type: 'value_error.extra' }] },
    text: JSON.stringify({ detail: [m5.detail[2], { loc: ['body', 'target', 'user_id'], msg: 'extra fields not permitted', type: 'value_error.extra' }] }),
  },
  // Round 3: target.id type error
  {
    ok: false, status: 422,
    json: { detail: [m5.detail.filter((d) => d.type === 'type_error.integer')[0] ?? { loc: ['body', 'target', 'id'], msg: 'value is not a valid integer', type: 'type_error.integer' }] },
    text: JSON.stringify({ detail: [{ loc: ['body', 'target', 'id'], msg: 'value is not a valid integer', type: 'type_error.integer' }] }),
  },
  { ok: true, status: 200, json: { result: { id: '123', name: 'Asha Rao', email: 'asha@example.com' } }, text: '{"result":{"id":"123","name":"Asha Rao","email":"asha@example.com"}}' },
];
let callCount = 0;

test('M5 heals in 4 rounds, commits 4 ops, succeeds under 3s', async (t) => {
  const origFetch = globalThis.fetch;
  callCount = 0;
  globalThis.fetch = async (url, init) => {
    callCount += 1;
    const r = responses[Math.min(callCount - 1, responses.length - 1)];
    return new Response(r.text, { status: r.status, headers: { 'content-type': 'application/json' } });
  };
  process.env.TENANT_ID = 'demo-tenant-01';

  try {
    registerAPI();
    clearBus();
    const t0 = Date.now();
    const result = await invoke({ apiId: API_ID, toolName: TOOL, args: { user_id: '123' } });
    const elapsed = Date.now() - t0;

    assert.strictEqual(result.ok, true, JSON.stringify(result.error));
    assert.strictEqual(result.meta.healed, true);
    assert.strictEqual(result.meta.rounds, 4);
    assert.strictEqual(result.meta.tier, 1);
    assert.ok(elapsed < 3000, `heal took ${elapsed}ms, expected < 3000`);
    assert.deepStrictEqual(result.data, { id: '123', name: 'Asha Rao', email: 'asha@example.com' });

    // Committed adapter should hold exactly the 4 expected ops, in order.
    const cur = registryStore.current(API_ID, TOOL);
    const ops = cur.versionObj.adapter.request;
    assert.strictEqual(ops.length, 4, `expected 4 ops, got ${ops.length}: ${JSON.stringify(ops)}`);
    assert.strictEqual(ops[0].op, 'add_header');
    assert.strictEqual(ops[0].name, 'X-Tenant');
    assert.strictEqual(ops[1].op, 'move_field');
    assert.strictEqual(ops[1].from, 'user_id');
    assert.strictEqual(ops[1].to, 'target.user_id');
    assert.strictEqual(ops[2].op, 'rename_field');
    assert.strictEqual(ops[2].path, 'target');
    assert.strictEqual(ops[2].from, 'user_id');
    assert.strictEqual(ops[2].to, 'id');
    assert.strictEqual(ops[3].op, 'coerce_type');
    assert.strictEqual(ops[3].path, 'target.id');
    assert.strictEqual(ops[3].from, 'string');
    assert.strictEqual(ops[3].to, 'integer');

    assert.strictEqual(callCount, 5, 'one initial call + 4 replays');
  } finally {
    globalThis.fetch = origFetch;
    delete process.env.TENANT_ID;
  }
});

test('invalid args are never healed (bad input passthrough)', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}', { status: 200 });
  try {
    registerAPI();
    const result = await invoke({ apiId: API_ID, toolName: TOOL, args: {} });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error.code, 'invalid_arguments');
    assert.strictEqual(result.error.retryable, false);
  } finally {
    globalThis.fetch = origFetch;
  }
});
