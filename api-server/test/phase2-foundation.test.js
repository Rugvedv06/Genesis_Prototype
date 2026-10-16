import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newId, resetIds } from '../src/lib/ids.js';
import { bus } from '../src/features/events/bus.js';
import { registryStore } from '../src/features/registry/store.js';

test('ids remain unique after the in-process counter is reset', () => {
  const first = newId('call');
  resetIds();
  const second = newId('call');
  assert.notEqual(first, second);
});

test('clearing the event buffer does not disconnect subscribers', () => {
  const received = [];
  const off = bus.on((event) => received.push(event.type));
  try {
    bus.clear();
    bus.emit({ type: 'after.clear' });
    assert.deepEqual(received, ['after.clear']);
  } finally {
    off();
    bus.clear();
  }
});

test('registered tool metadata lives outside the adapter', () => {
  registryStore.reset();
  registryStore.registerApi('phase2-foundation', {
    baseUrl: 'http://localhost:5001',
    tools: [{
      name: 'lookup',
      path: '/lookup',
      method: 'GET',
      parameters: { type: 'object' },
      identity: { user_id: 'id' },
      sideEffects: 'none',
    }],
  });
  const current = registryStore.current('phase2-foundation', 'lookup');
  assert.equal(current.versionObj.meta.path, '/lookup');
  assert.equal(current.versionObj.meta.method, 'GET');
  assert.deepEqual(current.versionObj.meta.identity, { user_id: 'id' });
  assert.equal(current.versionObj.adapter._path, undefined);
  registryStore.reset();
});
