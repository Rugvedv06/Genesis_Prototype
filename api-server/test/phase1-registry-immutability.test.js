import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function initialAdapter() {
  return {
    request: [{ op: 'add_header', name: 'x-mode', source: { type: 'spec_default', value: 'original' } }],
    response: { map: { value: 'result.value' } },
    _path: '/lookup',
    _method: 'POST',
    _logicalSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  };
}

test('registry versions are isolated from caller-owned and returned objects', async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'healr-registry-immutability-test-'));
  const previousDataDir = process.env.HEALR_DATA_DIR;
  process.env.HEALR_DATA_DIR = dataDir;

  try {
    const { RegistryStore } = await import('../src/features/registry/store.js');

    await t.test('register copies the supplied adapter and its metadata inputs', () => {
      const store = new RegistryStore();
      const adapter = initialAdapter();
      store.register('register-input', 'lookup', adapter);

      adapter.request[0].source.value = 'mutated-after-register';
      adapter._logicalSchema.properties.id.type = 'number';

      const version = store.version('register-input', 'lookup', 1);
      assert.equal(version.adapter.request[0].source.value, 'original');
      assert.equal(version.meta.logicalSchema.properties.id.type, 'string');
    });

    await t.test('commit copies the supplied adapter and change payload', () => {
      const store = new RegistryStore();
      store.register('commit-input', 'lookup', initialAdapter());
      const adapter = {
        request: [{ op: 'add_field', path: 'metadata.source', source: { type: 'spec_default', value: 'generated' } }],
        response: { map: {} },
      };
      const change = { ops: [{ op: 'add_field', path: 'metadata.source' }], evidence: ['verified'] };
      store.commit('commit-input', 'lookup', adapter, change);

      adapter.request[0].source.value = 'mutated-after-commit';
      change.ops[0].path = 'tampered.path';
      change.evidence[0] = 'tampered';

      const version = store.version('commit-input', 'lookup', 2);
      assert.equal(version.adapter.request[0].source.value, 'generated');
      assert.equal(version.change.ops[0].path, 'metadata.source');
      assert.equal(version.change.evidence[0], 'verified');
    });

    const createCommittedStore = (apiId) => {
      const store = new RegistryStore();
      store.register(apiId, 'lookup', initialAdapter());
      store.commit(apiId, 'lookup', {
        request: [{ op: 'add_field', path: 'metadata.source', source: { type: 'spec_default', value: 'current' } }],
        response: { map: {} },
      }, { ops: [{ op: 'add_field', path: 'metadata.source' }], evidence: ['safe'] });
      return store;
    };

    await t.test('objects returned by current cannot mutate stored versions', () => {
      const store = createCommittedStore('current-snapshot');
      const current = store.current('current-snapshot', 'lookup');
      current.versionObj.adapter.request[0].source.value = 'changed-through-current';
      current.versionObj.meta.logicalSchema.properties.id.type = 'boolean';
      current.versions[1].change.evidence.push('changed-through-current-history');

      const fresh = store.current('current-snapshot', 'lookup');
      assert.equal(fresh.versionObj.adapter.request[0].source.value, 'current');
      assert.equal(fresh.versionObj.meta.logicalSchema.properties.id.type, 'string');
      assert.deepEqual(fresh.versions[1].change.evidence, ['safe']);
    });

    await t.test('objects returned by versions cannot mutate stored metadata or changes', () => {
      const store = createCommittedStore('versions-snapshot');
      const history = store.versions('versions-snapshot', 'lookup');
      history[1].meta.logicalSchema.properties.id.type = 'null';
      history[1].change.evidence[0] = 'changed-through-versions';

      const fresh = store.versions('versions-snapshot', 'lookup');
      assert.equal(fresh[1].meta.logicalSchema.properties.id.type, 'string');
      assert.deepEqual(fresh[1].change.evidence, ['safe']);
    });

    await t.test('objects returned by version cannot mutate stored adapter or metadata', () => {
      const store = createCommittedStore('version-snapshot');
      const version = store.version('version-snapshot', 'lookup', 2);
      version.adapter.request[0].source.value = 'changed-through-version';
      version.meta.logicalSchema.properties.id.type = 'array';

      const fresh = store.version('version-snapshot', 'lookup', 2);
      assert.equal(fresh.adapter.request[0].source.value, 'current');
      assert.equal(fresh.meta.logicalSchema.properties.id.type, 'string');
    });

    await t.test('diff results cannot mutate current or historical adapters', () => {
      const store = createCommittedStore('diff-snapshot');
      const diff = store.diff('diff-snapshot', 'lookup', 1, 2);
      diff.added[0].source.value = 'changed-through-diff-added';
      diff.requestBefore.request[0].source.value = 'changed-through-diff-before';
      diff.requestAfter.request[0].source.value = 'changed-through-diff-after';

      assert.equal(store.version('diff-snapshot', 'lookup', 1).adapter.request[0].source.value, 'original');
      assert.equal(store.current('diff-snapshot', 'lookup').versionObj.adapter.request[0].source.value, 'current');
    });

    await t.test('current compiled facade cannot alter behavior for later callers', () => {
      const store = new RegistryStore();
      const adapter = {
        request: [{ op: 'rename_field', from: 'id', to: 'user.id' }],
        response: { map: {} },
      };
      store.register('compiled-snapshot', 'lookup', adapter);
      const exposed = store.current('compiled-snapshot', 'lookup').compiled;
      try {
        exposed.buildRequest = () => ({ body: { corrupted: true }, headers: {} });
      } catch {
        // A read-only compiled facade may reject mutation; later behavior must still be stable.
      }

      const request = store.current('compiled-snapshot', 'lookup').compiled.buildRequest({ id: '42' });
      assert.deepEqual(request.body, { user: { id: '42' } });
    });
  } finally {
    if (previousDataDir === undefined) delete process.env.HEALR_DATA_DIR;
    else process.env.HEALR_DATA_DIR = previousDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  }
});
