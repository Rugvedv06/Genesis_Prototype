// Phase 1 Track C: data-driven mutation catalogue (§6 Phase 1, §11).
// Each mutation is pure data; a single generic validator (validator.js) drives
// every mutation. No if/else per mutation ID. Additional mutations (M1-M4, M6-M10)
// are added here in later phases; only M5 is required for the Phase 1 slice.
//
// M5: { "target": { "id": 123 } } plus mandatory X-Tenant header.
// Realistic error order: header check first (400), then layered body 422s.
export const M5 = {
  id: 'M5',
  label: 'target nesting + rename + string->integer coerce + tenant header',
  route: { method: 'POST', path: '/api/users/get' },
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
      id: String(b.target?.id ?? b.user_id ?? 'unknown'),
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
  headers: [
    { name: 'Authorization', required: true, error: { error: 'missing_auth', scheme: 'Bearer', header: 'Authorization' } },
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
  headers: [],
  body: { layers: [] },
  responseOps: [{ op: 'move', from: 'result.name', to: 'result.full_name' }],
  expectedOps: [{ op: 'remap_response_path', logical: 'name', from: 'result.name', to: 'result.full_name' }],
};

export const CATALOGUE = { M5, M9, M6, M10 };
export function get(id) {
  return CATALOGUE[id];
}
export function ids() {
  return Object.keys(CATALOGUE);
}
