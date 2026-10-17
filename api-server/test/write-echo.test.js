import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesWriteEcho } from '../src/features/executor/invoke.js';

const tool = {
  versionObj: { meta: { method: 'POST', sideEffects: 'write' }, adapter: { response: { map: { email: 'result.email' } } } },
  compiled: { extract: (body) => ({ email: body.result.email }) },
};

test('write replay requires matching declared request and response fields', () => {
  assert.equal(matchesWriteEcho(tool, { email: 'new@example.com' }, { json: { result: { email: 'new@example.com' } } }, 2), true);
  assert.equal(matchesWriteEcho(tool, { email: 'new@example.com' }, { json: { result: { email: 'old@example.com' } } }, 2), false);
  assert.equal(matchesWriteEcho(tool, { email: 'new@example.com' }, { json: { result: { email: 'old@example.com' } } }, 1), true);
  assert.equal(matchesWriteEcho(tool, { user_id: '123' }, { json: { result: { email: 'anything@example.com' } } }, 2), true);
});
