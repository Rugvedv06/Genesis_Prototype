// Declarative mock mutation catalogue (§11). Shared validators and transformers
// consume these records; mutation IDs do not introduce route-specific branches.
//
// M5: { "target": { "id": 123 } } plus mandatory X-Tenant header.
// Realistic error order: header check first (400), then layered body 422s.
const specVariants = () => [
  { id: 'active', specAvailable: true, specStale: false },
  { id: 'stale', specAvailable: true, specStale: true, description: 'OpenAPI remains at the baseline contract' },
  { id: 'unavailable', specAvailable: false, specStale: false, description: 'OpenAPI endpoint returns spec_unavailable' },
];

export const M1 = {
  id: 'M1', label: 'user_id renamed to userId', category: 'request', expected: 'heal',
  expectedOps: ['rename_field'], route: { method: 'POST', path: '/api/users/get' }, headers: [],
  fixture: { args: { user_id: '123' } }, specVariants: specVariants(),
  body: { layers: [{
    when: (body) => body?.user_id !== undefined,
    check: (body) => body?.userId !== undefined,
    errors: () => [
      { loc: ['body', 'userId'], msg: 'field required', type: 'value_error.missing' },
      { loc: ['body', 'user_id'], msg: 'extra fields not permitted', type: 'value_error.extra' },
    ],
  }] },
};

export const M2 = {
  id: 'M2', label: 'user_id requires an integer', category: 'request', expected: 'heal',
  expectedOps: ['coerce_type'], route: { method: 'POST', path: '/api/users/get' }, headers: [],
  fixture: { args: { user_id: '123' } }, specVariants: specVariants(),
  body: { layers: [{
    when: (body) => body?.user_id !== undefined,
    check: (body) => Number.isInteger(body.user_id),
    errors: () => [{ loc: ['body', 'user_id'], msg: 'value is not a valid integer', type: 'type_error.integer' }],
  }] },
};

export const M3 = {
  id: 'M3', label: 'user_id moved under target', category: 'request', expected: 'heal',
  expectedOps: ['move_field'], route: { method: 'POST', path: '/api/users/get' }, headers: [],
  fixture: { args: { user_id: '123' } }, specVariants: specVariants(),
  body: { layers: [{
    when: (body) => body?.user_id !== undefined,
    check: (body) => body?.target?.user_id !== undefined,
    errors: () => [
      { loc: ['body', 'target'], msg: 'field required', type: 'value_error.missing' },
      { loc: ['body', 'user_id'], msg: 'extra fields not permitted', type: 'value_error.extra' },
    ],
  }] },
};

export const M4 = {
  id: 'M4', label: 'X-API-Version header required', category: 'request', expected: 'heal',
  expectedOps: ['add_header'], route: { method: 'POST', path: '/api/users/get' },
  fixture: { args: { user_id: '123' } }, specVariants: specVariants(),
  headers: [{ name: 'X-API-Version', required: true, error: { error: 'missing_header', header: 'X-API-Version', allowed: ['2'] } }],
  body: { layers: [] },
};

export const M7 = {
  id: 'M7', label: 'region field added with documented default', category: 'request', expected: 'heal',
  expectedOps: ['add_field'], route: { method: 'POST', path: '/api/users/get' }, headers: [],
  fixture: { args: { user_id: '123' } },
  specVariants: specVariants(),
  body: { layers: [{
    when: () => true,
    check: (body) => body?.region !== undefined,
    errors: () => [{ loc: ['body', 'region'], msg: 'field required', type: 'value_error.missing' }],
  }] },
};

export const M8 = {
  id: 'M8', label: 'status enum uses ENABLED or DISABLED', category: 'request', expected: 'heal',
  expectedOps: ['set_enum_map'], route: { method: 'POST', path: '/api/users/set-status' }, headers: [],
  fixture: { args: { user_id: '123', status: 'active' } },
  specVariants: specVariants(),
  provenanceAliases: { active: 'ENABLED', inactive: 'DISABLED' },
  body: { layers: [{
    when: (body) => body?.status !== undefined,
    check: (body) => ['ENABLED', 'DISABLED'].includes(body.status),
    errors: () => [{
      loc: ['body', 'status'], msg: 'Input should be ENABLED or DISABLED', type: 'type_error.enum',
      ctx: { enum_values: ['ENABLED', 'DISABLED'] },
    }],
  }] },
};

export const M5 = {
  id: 'M5',
  label: 'target nesting + rename + string->integer coerce + tenant header',
  category: 'request',
  expected: 'heal',
  route: { method: 'POST', path: '/api/users/get' },
<<<<<<< HEAD
  fixture: { args: { user_id: '123' } },
  specVariants: specVariants(),
=======
<<<<<<< HEAD
  fixture: { args: { user_id: '123' } },
  specVariants: specVariants(),
=======
>>>>>>> origin/main
>>>>>>> origin/main
  expectedOps: ['add_header', 'move_field', 'rename_field', 'coerce_type'],
  // what the mutated contract expects
  headers: [
    { name: 'X-Tenant', required: true,
      error: { error: 'missing_header', header: 'X-Tenant' } },
  ],
  body: {
    // layered validation: a strict validator reports one layer at a time.
    // each layer: `when` (applies to this request shape), `check` (passes?),
    // `errors` (pydantic-v1 records to return when check fails).
    layers: [
      // Round 1 after header fixed: body must nest user_id under target
      {
        when: (b) => b.user_id !== undefined, // root user_id present (pre-wrap)
        check: (b) => b.target !== undefined,
        errors: () => [
          { loc: ['body', 'target'], msg: 'field required', type: 'value_error.missing' },
          { loc: ['body', 'user_id'], msg: 'extra fields not permitted', type: 'value_error.extra' },
        ],
      },
      // Round 2 after wrap: target.id required, target.user_id extra
      {
        when: (b) => b.target && b.target.user_id !== undefined,
        check: (b) => b.target && b.target.id !== undefined,
        errors: () => [
          { loc: ['body', 'target', 'id'], msg: 'field required', type: 'value_error.missing' },
          { loc: ['body', 'target', 'user_id'], msg: 'extra fields not permitted', type: 'value_error.extra' },
        ],
      },
      // Round 3 after rename: target.id must be integer
      {
        when: (b) => b.target && b.target.id !== undefined,
        check: (b) => b.target && Number.isInteger(b.target.id),
        errors: () => [
          { loc: ['body', 'target', 'id'], msg: 'value is not a valid integer', type: 'type_error.integer' },
        ],
      },
    ],
  },
  // v1 response shape the healed call must produce
  transformResponse: (b) => ({
    result: {
      id: String(b.target?.id ?? b.target?.user_id ?? b.userId ?? b.user_id ?? 'unknown'),
      name: 'Asha Rao',
      email: 'asha@example.com',
    },
  }),
};

export const M9 = {
  id: 'M9',
  label: 'unconfigured bearer auth + approval code',
  category: 'unrecoverable',
  expected: 'halt',
  expectedOps: [],
  route: { method: 'POST', path: '/api/users/update-email' },
<<<<<<< HEAD
=======
<<<<<<< HEAD
>>>>>>> origin/main
  fixture: { args: { user_id: '123', email: 'asha+demo@example.com' } },
  specVariants: specVariants(),
  headers: [
    { name: 'Authorization', required: true, status: 401, error: { error: 'missing_auth', scheme: 'Bearer', header: 'Authorization' } },
<<<<<<< HEAD
=======
=======
  headers: [
    { name: 'Authorization', required: true, error: { error: 'missing_auth', scheme: 'Bearer', header: 'Authorization' } },
>>>>>>> origin/main
>>>>>>> origin/main
  ],
  body: {
    layers: [{
      when: () => true,
      check: (body) => body?.approval_code !== undefined,
      errors: () => [{ loc: ['body', 'approval_code'], msg: 'field required', type: 'value_error.missing' }],
    }],
  },
};

// Response mutations are declarative path operations applied by the shared
// mock response transformer. Their truth remains the unmutated user record.
export const M6 = {
  id: 'M6',
  label: 'response name moved under result.data.profile',
  category: 'response',
  expected: 'heal',
  route: { method: 'POST', path: '/api/users/get' },
<<<<<<< HEAD
  fixture: { args: { user_id: '123' } },
  specVariants: specVariants(),
=======
<<<<<<< HEAD
  fixture: { args: { user_id: '123' } },
  specVariants: specVariants(),
=======
>>>>>>> origin/main
>>>>>>> origin/main
  headers: [],
  body: { layers: [] },
  responseOps: [{ op: 'move', from: 'result.name', to: 'result.data.profile.name' }],
  expectedOps: [{ op: 'remap_response_path', logical: 'name', from: 'result.name', to: 'result.data.profile.name' }],
};

export const M10 = {
  id: 'M10',
  label: 'response name renamed to full_name',
  category: 'response',
  expected: 'heal',
  route: { method: 'POST', path: '/api/users/get' },
<<<<<<< HEAD
  fixture: { args: { user_id: '123' } },
  specVariants: specVariants(),
=======
<<<<<<< HEAD
  fixture: { args: { user_id: '123' } },
  specVariants: specVariants(),
=======
>>>>>>> origin/main
>>>>>>> origin/main
  headers: [],
  body: { layers: [] },
  responseOps: [{ op: 'move', from: 'result.name', to: 'result.full_name' }],
  expectedOps: [{ op: 'remap_response_path', logical: 'name', from: 'result.name', to: 'result.full_name' }],
};

<<<<<<< HEAD
=======
<<<<<<< HEAD
>>>>>>> origin/main
export const M11 = {
  id: 'M11', label: 'update-email fields renamed to subscriber_ref and contact_address',
  category: 'request', expected: 'heal', expectedOps: ['rename_field', 'rename_field'], expectedTier: 2, llmRequired: true,
  route: { method: 'POST', path: '/api/users/update-email' },
  fixture: { args: { user_id: '123', email: 'asha+demo@example.com' } }, specVariants: specVariants(), headers: [],
  body: { layers: [{
    when: () => true,
    check: (body) => body?.subscriber_ref !== undefined && body?.contact_address !== undefined,
    errors: (body) => [
      ...(body?.subscriber_ref === undefined ? [{ loc: ['body', 'subscriber_ref'], msg: 'field required', type: 'value_error.missing' }] : []),
      ...(body?.contact_address === undefined ? [{ loc: ['body', 'contact_address'], msg: 'field required', type: 'value_error.missing' }] : []),
      ...(body?.user_id !== undefined ? [{ loc: ['body', 'user_id'], msg: 'extra fields not permitted', type: 'value_error.extra' }] : []),
      ...(body?.email !== undefined ? [{ loc: ['body', 'email'], msg: 'extra fields not permitted', type: 'value_error.extra' }] : []),
    ],
  }] },
  normalizeRequest: (body) => ({ user_id: body.subscriber_ref, email: body.contact_address }),
};


export const CATALOGUE = { M1, M2, M3, M4, M5, M6, M7, M8, M9, M10, M11 };
<<<<<<< HEAD
=======
=======
export const CATALOGUE = { M5, M9, M6, M10 };
>>>>>>> origin/main
>>>>>>> origin/main
export function get(id) {
  return CATALOGUE[id];
}
export function ids() {
  return Object.keys(CATALOGUE).sort((left, right) => Number(left.slice(1)) - Number(right.slice(1)));
}
