import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function responseCapture() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    type(value) { this.contentType = value; return this; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; },
  };
}

test('audit routes expose matching records, detect delete tampering, and restore the chain', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'healr-audit-routes-test-'));
  const previousDataDir = process.env.HEALR_DATA_DIR;
  const previousDevRoutes = process.env.ENABLE_DEV_ROUTES;
  process.env.HEALR_DATA_DIR = dataDir;
  process.env.ENABLE_DEV_ROUTES = '1';

  try {
    const [{ auditRoutes }, audit] = await Promise.all([
      import('../src/features/audit/routes.js'),
      import('../src/features/audit/index.js'),
    ]);
    const routes = new Map();
    auditRoutes({
      get(path, handler) { routes.set(`GET ${path}`, handler); },
      post(path, handler) { routes.set(`POST ${path}`, handler); },
    });
    const call = (method, path, req = {}) => {
      const handler = routes.get(`${method} ${path}`);
      assert.equal(typeof handler, 'function', `missing route ${method} ${path}`);
      const res = responseCapture();
      handler({ query: {}, ...req }, res);
      return res;
    };
    const assertExportMatches = (listing) => {
      const exported = call('GET', '/audit/export').body;
      assert.equal(typeof exported, 'string');
      const records = exported.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
      assert.deepEqual(records, listing.records);
    };

    audit.append({ decision: 'halt', apiId: 'audit-routes-test', tool: 'lookup' });
    audit.append({ decision: 'rollback', apiId: 'audit-routes-test', tool: 'lookup' });

    const initialListing = call('GET', '/audit').body;
    assert.equal(initialListing.count, 2);
    assert.equal(initialListing.verified, true);
    assertExportMatches(initialListing);
    assert.equal(call('GET', '/audit/verify').body.ok, true);

    const tamper = call('POST', '/dev/tamper', { body: { index: 0, mode: 'delete' } });
    assert.equal(tamper.statusCode, 200);
    assert.deepEqual(tamper.body, { ok: true });

    const corruptedVerification = call('GET', '/audit/verify').body;
    assert.equal(corruptedVerification.ok, false);
    assert.equal(corruptedVerification.reason, 'hash_mismatch');
    assert.equal(corruptedVerification.brokenAt, 0);
    const corruptedListing = call('GET', '/audit').body;
    assert.equal(corruptedListing.verified, false);
    assertExportMatches(corruptedListing);

    const restored = call('POST', '/dev/tamper/restore');
    assert.deepEqual(restored.body, { ok: true });
    const restoredVerification = call('GET', '/audit/verify').body;
    assert.equal(restoredVerification.ok, true);
    const restoredListing = call('GET', '/audit').body;
    assert.equal(restoredListing.records.length, 2);
    assert.equal(restoredListing.verified, true);
    assertExportMatches(restoredListing);
  } finally {
    if (previousDataDir === undefined) delete process.env.HEALR_DATA_DIR;
    else process.env.HEALR_DATA_DIR = previousDataDir;
    if (previousDevRoutes === undefined) delete process.env.ENABLE_DEV_ROUTES;
    else process.env.ENABLE_DEV_ROUTES = previousDevRoutes;
    rmSync(dataDir, { recursive: true, force: true });
  }
});
