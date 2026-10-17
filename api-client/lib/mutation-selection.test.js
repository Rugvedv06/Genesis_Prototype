import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMutationTool } from './mutation-selection.js';

test('mutation selection resolves the registered tool by method and path with its fixture args', () => {
  const tools = [
    { name: 'get_user', method: 'POST', path: '/api/users/get' },
    { name: 'update_user_email', method: 'POST', path: '/api/users/update-email' },
  ];
  assert.deepEqual(resolveMutationTool({ route: { method: 'POST', path: '/api/users/update-email' }, fixture: { args: { user_id: '123', email: 'asha+demo@example.com' } } }, tools), {
    name: 'update_user_email',
    args: { user_id: '123', email: 'asha+demo@example.com' },
  });
});

test('mutation selection reports when its route has no registered tool', () => {
  assert.equal(resolveMutationTool({ route: { method: 'POST', path: '/api/users/set-status' } }, [
    { name: 'get_user', method: 'POST', path: '/api/users/get' },
  ]), null);
});
