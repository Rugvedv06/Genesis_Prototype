// Phase 1 golden tests: Tier 1 rules produce the expected M5 ops (§6 Phase 1, §5.4 example).
// Error records are derived from golden fixtures, not inline copies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseErrors } from '../src/features/classifier/index.js';
import { wrapRule } from '../src/features/diagnoser/tier1-rules/wrap.js';
import { renameRule } from '../src/features/diagnoser/tier1-rules/rename.js';
import { typeRule } from '../src/features/diagnoser/tier1-rules/type.js';
import { headerRule } from '../src/features/diagnoser/tier1-rules/header.js';
import { enumRule } from '../src/features/diagnoser/tier1-rules/enum.js';
import { loadGolden, goldenBody } from './helpers/golden.js';

function errorsFrom(style, id, status) {
  const g = loadGolden(style, id);
  return parseErrors(g.body, status ?? g._status);
}

const baseReq = { user_id: '123' };

test('wrap rule: move root leaf into missing target object (M5 round 1 body)', () => {
  const errors = errorsFrom('pydantic-v1', 'm5');
  // Round 1: target missing + user_id extra (first two records)
  const round1 = errors.slice(0, 2);
  const prop = wrapRule({ errors: round1, request: baseReq });
  assert.ok(prop, 'wrap should propose');
  assert.strictEqual(prop.tier, 1);
  assert.deepStrictEqual(prop.ops, [{ op: 'move_field', from: 'user_id', to: 'target.user_id' }]);
});

test('rename rule: rename inside target after wrap (M5 round 2)', () => {
  const g = loadGolden('pydantic-v1', 'm5');
  const all = parseErrors(g.body, g._status);
  // Round 2: target.id missing (detail[2]) + target.user_id extra (synthesised)
  const round2 = [
    all[2],
    { kind: 'extra', path: ['target', 'user_id'], raw: { loc: ['body', 'target', 'user_id'], msg: 'extra fields not permitted', type: 'value_error.extra' } },
  ];
  const prop = renameRule({ errors: round2, request: { target: { user_id: '123' } } });
  assert.ok(prop, 'rename should propose');
  assert.strictEqual(prop.tier, 1);
  assert.deepStrictEqual(prop.ops, [{ op: 'rename_field', path: 'target', from: 'user_id', to: 'id' }]);
});

test('root rename omits an empty path while nested rename retains its parent', () => {
  const errors = [
    { kind: 'missing', path: ['user_id'], raw: {} },
    { kind: 'extra', path: ['userId'], raw: {} },
  ];
  const proposal = renameRule({ errors, request: { userId: '123' } });
  assert.deepStrictEqual(proposal.ops, [{ op: 'rename_field', from: 'userId', to: 'user_id' }]);
});

test('type rule: lossless coerce string->integer (M5 round 3)', () => {
  const g = loadGolden('pydantic-v1', 'm5');
  // Round 3: target.id type error (synthesised from golden context)
  const round3 = [{
    kind: 'type',
    path: ['target', 'id'],
    received: '123',
    raw: { loc: ['body', 'target', 'id'], msg: 'value is not a valid integer', type: 'type_error.integer' },
  }];
  const prop = typeRule({ errors: round3, request: { target: { id: '123' } } });
  assert.ok(prop, 'type should propose');
  assert.deepStrictEqual(prop.ops, [{ op: 'coerce_type', path: 'target.id', from: 'string', to: 'integer' }]);
});

test('type rule rejects non-lossless (007 -> 7 halts)', () => {
  const errors = [{ kind: 'type', path: ['target', 'id'], received: '007', raw: {} }];
  assert.strictEqual(typeRule({ errors, request: { target: { id: '007' } } }), null);
});

test('header rule: add_header from missing_header (M5 round 0 header)', () => {
  const g = loadGolden('pydantic-v1', 'm5');
  const headerRecs = parseErrors(g.header, g._status);
  const prop = headerRule({ errors: headerRecs, request: baseReq, resolveCredential: () => 'demo-tenant-01' });
  assert.ok(prop, 'header should propose');
  assert.strictEqual(prop.tier, 1);
  assert.deepStrictEqual(prop.ops, [{
    op: 'add_header',
    name: 'X-Tenant',
    source: { type: 'credential', ref: 'X-Tenant' },
  }]);
  assert.deepStrictEqual(prop.evidence, [g.header]);
  assert.equal(Object.hasOwn(prop.ops[0], 'evidence'), false);
});

test('header rule uses an explicitly documented singleton value without guessing', () => {
  const errors = parseErrors({ error: 'missing_header', header: 'X-API-Version', allowed: ['2'] }, 400);
  const proposal = headerRule({ errors, request: baseReq });
  assert.deepStrictEqual(proposal.ops[0].source, { type: 'error_enum', value: '2' });
  assert.deepStrictEqual(proposal.evidence[0].allowed, ['2']);
  assert.equal(Object.hasOwn(proposal.ops[0], 'evidence'), false);
});

test('header rule does not choose between multiple allowed values', () => {
  const errors = parseErrors({ error: 'missing_header', header: 'X-API-Version', allowed: ['2', '3'] }, 400);
  const proposal = headerRule({ errors, request: baseReq });
  assert.deepStrictEqual(proposal.ops[0].source, { type: 'credential', ref: 'X-API-Version' });
});

test('enum rule maps a unique lossless case variant from the allowed list', () => {
  const errors = parseErrors({ detail: [{
    loc: ['body', 'status'], msg: 'Input should be ENABLED or DISABLED',
    type: 'enum', ctx: { allowed_values: ['ENABLED', 'DISABLED'] },
  }] }, 422);
  assert.equal(errors[0].kind, 'enum');
  const proposal = enumRule({ errors, request: { status: 'active' } });
  // Semantic changes are not guessed: active -> ENABLED must remain unresolved.
  assert.equal(proposal, null);
  const caseOnly = enumRule({ errors, request: { status: 'enabled' } });
  assert.deepStrictEqual(caseOnly.ops, [{ op: 'set_enum_map', path: 'status', map: { enabled: 'ENABLED' } }]);
});

test('rename rule returns null when ambiguous (two equal candidates, no singleton)', () => {
  const errors = [
    { kind: 'missing', path: ['userId'], raw: {} },
    { kind: 'missing', path: ['UserID'], raw: {} },
    { kind: 'extra', path: ['user_id'], raw: {} },
  ];
  assert.strictEqual(renameRule({ errors, request: baseReq }), null);
});

test('rename rule singleton pairing by elimination (one missing, one extra)', () => {
  const errors = [
    { kind: 'missing', path: ['target', 'login'], raw: {} },
    { kind: 'extra', path: ['target', 'user_id'], raw: {} },
  ];
  const prop = renameRule({ errors, request: { target: { user_id: '123' } } });
  assert.ok(prop);
  assert.deepStrictEqual(prop.ops, [{ op: 'rename_field', path: 'target', from: 'user_id', to: 'login' }]);
});
