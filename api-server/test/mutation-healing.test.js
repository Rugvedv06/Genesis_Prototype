import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const previousDataDir = process.env.HEALR_DATA_DIR;
const dataDir = mkdtempSync(join(tmpdir(), 'healr-mutation-healing-'));
process.env.HEALR_DATA_DIR = dataDir;
const [{ invoke }, { registryStore }] = await Promise.all([
  import('../src/features/executor/invoke.js'),
  import('../src/features/registry/store.js'),
]);
test.after(() => {
  if (previousDataDir === undefined) delete process.env.HEALR_DATA_DIR;
  else process.env.HEALR_DATA_DIR = previousDataDir;
  rmSync(dataDir, { recursive: true, force: true });
});

const getSchema = { type: 'object', properties: { user_id: { type: 'string' } }, required: ['user_id'], additionalProperties: false };
const responseFields = {
  id: { path: 'result.id', type: 'string', required: true },
  name: { path: 'result.name', type: 'string', required: true },
  email: { path: 'result.email', type: 'string', format: 'email', required: true },
};

const cases = [
  { id: 'M1', args: { user_id: '123' }, expected: ['rename_field'], tier: 1 },
  { id: 'M2', args: { user_id: '123' }, expected: ['coerce_type'], tier: 1 },
  { id: 'M3', args: { user_id: '123' }, expected: ['move_field'], tier: 1 },
  { id: 'M4', args: { user_id: '123' }, expected: ['add_header'], tier: 1 },
  { id: 'M7', args: { user_id: '123' }, expected: ['add_field'], tier: 0 },
  { id: 'M8', args: { user_id: '123', status: 'active' }, expected: ['set_enum_map'], tier: 0 },
];

function schemaFor(id) {
  if (id === 'M8') return {
    type: 'object', properties: { user_id: { type: 'string' }, status: { type: 'string' } },
    required: ['user_id', 'status'], additionalProperties: false,
  };
  return getSchema;
}

function operationSpec(id) {
  const properties = id === 'M8'
    ? { status: { type: 'string', enum: ['ENABLED', 'DISABLED'], 'x-healr-enum-aliases': { active: 'ENABLED' } } }
    : { region: { type: 'string', default: 'IN' } };
  return { paths: { [id === 'M8' ? '/api/users/set-status' : '/api/users/get']: {
    post: { requestBody: { content: { 'application/json': { schema: { type: 'object', properties } } } } },
  } } };
}

function installUpstream(id) {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    if (String(url) === 'https://spec.example/openapi.json') {
      return new Response(JSON.stringify(operationSpec(id)), { status: 200 });
    }
    const body = JSON.parse(init.body ?? '{}');
    const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
    requests.push({ url: String(url), body, headers });
    const json = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

    if (id === 'M1' && body.userId === undefined) return json({ detail: [
      { loc: ['body', 'userId'], msg: 'field required', type: 'value_error.missing' },
      { loc: ['body', 'user_id'], msg: 'extra fields not permitted', type: 'value_error.extra' },
    ] }, 422);
    if (id === 'M2' && !Number.isInteger(body.user_id)) return json({ detail: [
      { loc: ['body', 'user_id'], msg: 'value is not a valid integer', type: 'type_error.integer' },
    ] }, 422);
    if (id === 'M3' && body.target === undefined) return json({ detail: [
      { loc: ['body', 'target'], msg: 'field required', type: 'value_error.missing' },
      { loc: ['body', 'user_id'], msg: 'extra fields not permitted', type: 'value_error.extra' },
    ] }, 422);
    if (id === 'M4' && headers['x-api-version'] !== '2') return json({ error: 'missing_header', header: 'X-API-Version', allowed: ['2'] }, 400);
    if (id === 'M7' && body.region === undefined) return json({ detail: [
      { loc: ['body', 'region'], msg: 'field required', type: 'value_error.missing' },
    ] }, 422);
    if (id === 'M8' && !['ENABLED', 'DISABLED'].includes(body.status)) return json({ detail: [
      { loc: ['body', 'status'], msg: 'invalid enum', type: 'type_error.enum', ctx: { enum_values: ['ENABLED', 'DISABLED'] } },
    ] }, 422);
    if (id === 'M8') return json({ result: { id: body.user_id, status: body.status } });
    const userId = body.target?.id ?? body.target?.user_id ?? body.userId ?? body.user_id;
    return json({ result: { id: String(userId), name: 'Asha Rao', email: 'asha@example.com' } });
  };
  return { requests, restore: () => { globalThis.fetch = originalFetch; } };
}

for (const scenario of cases) {
  test(`${scenario.id} heals deterministically with the exact spec/rule operation`, async () => {
    const fixture = installUpstream(scenario.id);
    const apiId = `mutation-${scenario.id.toLowerCase()}`;
    try {
      registryStore.reset();
      registryStore.registerApi(apiId, {
        baseUrl: 'https://api.example',
        ...(scenario.tier === 0 ? { specUrl: 'https://spec.example/openapi.json' } : {}),
        credentials: {}, healing: { enabled: true, mode: 'enforce', maxRounds: 4 },
        tools: [{
          name: 'invoke', method: 'POST', path: scenario.id === 'M8' ? '/api/users/set-status' : '/api/users/get',
          sideEffects: scenario.id === 'M8' ? 'write' : 'none', parameters: schemaFor(scenario.id),
          response: { fields: scenario.id === 'M8'
            ? { id: { path: 'result.id', type: 'string', required: true }, status: { path: 'result.status', type: 'string', required: true } }
            : responseFields },
        }],
      });

      const result = await invoke({ apiId, toolName: 'invoke', args: scenario.args });
      assert.equal(result.ok, true, JSON.stringify(result.error));
      assert.deepEqual(result.meta.ops.map((operation) => operation.op), scenario.expected);
      assert.equal(result.meta.tier, scenario.tier);
      assert.equal(registryStore.current(apiId, 'invoke').version, 2);
      assert.ok(fixture.requests.length >= 2, 'one failed request and one verified replay are expected');
      if (scenario.id === 'M2') assert.equal(typeof fixture.requests.at(-1).body.user_id, 'number');
      if (scenario.id === 'M4') assert.equal(fixture.requests.at(-1).headers['x-api-version'], '2');
      if (scenario.id === 'M7') assert.equal(fixture.requests.at(-1).body.region, 'IN');
      if (scenario.id === 'M8') assert.equal(fixture.requests.at(-1).body.status, 'ENABLED');
    } finally {
      fixture.restore();
    }
  });
}
