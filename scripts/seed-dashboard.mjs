// Registers the demo API, then produces a healed call, a halt, a bad-input halt, parallel calls, and a passthrough.
const CORE = process.env.CORE_URL ?? 'http://localhost:8000';
const MOCK = process.env.MOCK_URL ?? 'http://localhost:5001';
const J = { 'content-type': 'application/json' };
const post = async (base, path, body) => (await fetch(`${base}${path}`, { method: 'POST', headers: J, body: JSON.stringify(body ?? {}) })).json();
const invoke = (tool, args, runId) => post(CORE, `/apis/demo-users/tools/${tool}/invoke`, { args, runId });

const registration = {
  apiId: 'demo-users', baseUrl: MOCK, specUrl: `${MOCK}/openapi.json`,
  credentials: { 'X-Tenant': { env: 'TENANT_ID' } },
  healing: { enabled: true, confidenceThreshold: 0.85, maxRounds: 5, tier2: true },
  tools: [
    { name: 'get_user', description: 'Fetch a user by id', method: 'POST', path: '/api/users/get', risk: 'low', sideEffects: 'none', identity: { user_id: 'id' },
      parameters: { type: 'object', properties: { user_id: { type: 'string' } }, required: ['user_id'], additionalProperties: false },
      response: { fields: { id: { path: 'result.id', type: 'string', required: true }, name: { path: 'result.name', type: 'string', required: true }, email: { path: 'result.email', type: 'string', format: 'email', required: true } } } },
    { name: 'update_user_email', description: "Update a user's email", method: 'POST', path: '/api/users/update-email', risk: 'medium', sideEffects: 'write', identity: { user_id: 'id' },
      parameters: { type: 'object', properties: { user_id: { type: 'string' }, email: { type: 'string', format: 'email' } }, required: ['user_id', 'email'], additionalProperties: false },
      response: { fields: { id: { path: 'result.id', type: 'string', required: true }, email: { path: 'result.email', type: 'string', format: 'email', required: true }, updated_at: { path: 'result.updated_at', type: 'string', required: true } } } },
  ],
};

const show = (label, r) => console.log(label.padEnd(34), r.ok ? `ok healed=${r.meta?.healed} v${r.meta?.version} rounds=${r.meta?.rounds}` : `FAIL ${r.error?.code} ${r.error?.details?.reason ?? ''}`);

await post(MOCK, '/admin/reset');
console.log('register'.padEnd(34), JSON.stringify(await post(CORE, '/apis', registration)));
show('1 passthrough (no drift)', await invoke('get_user', { user_id: '1' }, 'seed_1'));
await post(MOCK, '/admin/mutate', { id: 'M5' });
show('2 M5 drift, expect healed', await invoke('get_user', { user_id: '2' }, 'seed_2'));
show('3 healed version reused', await invoke('get_user', { user_id: '3' }, 'seed_3'));
show('4 bad input "abc", expect halt', await invoke('get_user', { user_id: 'abc' }, 'seed_4'));
await post(MOCK, '/admin/mutate', { id: 'M9' });
show('5 M9 drift, expect halt', await invoke('update_user_email', { user_id: '1', email: 'a@b.co' }, 'seed_5'));
const par = await Promise.all(['11', '22', '33'].map((id, i) => invoke('get_user', { user_id: id }, `seed_p${i}`)));
console.log('6 parallel ids returned'.padEnd(34), par.map((r) => r.data?.id ?? 'none').join(', '), '(expect 11, 22, 33)');
console.log('audit verify'.padEnd(34), JSON.stringify(await (await fetch(`${CORE}/audit/verify`)).json()));
