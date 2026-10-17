import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findKnownVariant, structuralFingerprint, validateVariantConfig } from '../src/features/response-variants/index.js';
import { registryStore } from '../src/features/registry/store.js';
import { invoke } from '../src/features/executor/invoke.js';

const canonical = {
  type: 'object',
  required: ['userId', 'name'],
  properties: {
    userId: { type: 'string' },
    name: { type: 'string' },
    nickname: { type: 'string' },
  },
};

test('recognizes a verified response variant and omits missing optional fields', () => {
  const variants = validateVariantConfig([{
    id: 'legacy-v1',
    status: 'verified',
    map: { userId: { from: 'user.id', type: 'string' }, name: { from: 'user.name', type: 'string' }, nickname: { from: 'user.nickname', type: 'string' } },
  }]);
  const result = findKnownVariant({ user: { id: '123', name: 'Asha' } }, variants, canonical);
  assert.equal(result.kind, 'known_variant');
  assert.deepEqual(result.data, { userId: '123', name: 'Asha' });
});

test('rejects ambiguous variants and dangerous paths', () => {
  const variants = validateVariantConfig([
    { id: 'a', status: 'verified', map: { userId: 'data.userId', name: 'data.fullName' } },
    { id: 'b', status: 'verified', map: { userId: 'data.userId', name: 'data.fullName' } },
  ]);
  assert.equal(findKnownVariant({ data: { userId: '123', fullName: 'Asha' } }, variants, canonical).kind, 'ambiguous_variant');
  assert.throws(() => validateVariantConfig([{ id: 'bad', map: { userId: '__proto__.id' } }]), /unsafe response variant path/);
});

test('uses contract-relevant selector context before recognizing a variant', () => {
  const variants = validateVariantConfig([
    { id: 'v1', selector: { args: { version: '1' } }, map: { userId: 'user.id', name: 'user.name' } },
    { id: 'v2', selector: { args: { version: '2' } }, map: { userId: 'data.userId', name: 'data.fullName' } },
  ]);
  assert.equal(findKnownVariant({ data: { userId: '123', fullName: 'Asha' } }, variants, canonical, { args: { version: '2' } }).variant.id, 'v2');
  assert.equal(findKnownVariant({ data: { userId: '123', fullName: 'Asha' } }, variants, canonical, { args: { version: '1' } }).kind, 'variant_mismatch');
});

test('fingerprints are stable across object key order and exclude raw values', () => {
  assert.equal(
    structuralFingerprint({ data: { name: 'Asha', id: '123' } }),
    structuralFingerprint({ data: { id: '999', name: 'Other' } }),
  );
  assert.notEqual(structuralFingerprint({ data: { id: '123' } }), structuralFingerprint({ data: { id: 123 } }));
});

test('known variants normalize without creating a new adapter version', async () => {
  const originalFetch = globalThis.fetch;
  registryStore.reset();
  registryStore.registerApi('variant-runtime', {
    baseUrl: 'https://api.example.test',
    healing: { enabled: true, mode: 'enforce' },
    tools: [{
      name: 'get_user',
      method: 'GET',
      path: '/user',
      sideEffects: 'none',
      parameters: { type: 'object', properties: {}, required: [] },
      response: {
        fields: {
          userId: { path: 'userId', type: 'string', required: true },
          name: { path: 'name', type: 'string', required: true },
        },
        variants: [{
          id: 'nested-user',
          status: 'verified',
          map: { userId: { from: 'data.userId', type: 'string' }, name: { from: 'data.fullName', type: 'string' } },
        }],
      },
    }],
  });
  globalThis.fetch = async () => new Response(JSON.stringify({ data: { userId: '123', fullName: 'Asha' } }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
  try {
    const result = await invoke({ apiId: 'variant-runtime', toolName: 'get_user', args: {} });
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, { userId: '123', name: 'Asha' });
    assert.equal(result.meta.classification, 'known_variant');
    assert.equal(result.meta.variantId, 'nested-user');
    assert.equal(registryStore.current('variant-runtime', 'get_user').version, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
