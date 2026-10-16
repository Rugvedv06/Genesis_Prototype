import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('audit records redact secrets and detect tampering in an isolated data directory', async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'healr-audit-test-'));
  const previousDataDir = process.env.HEALR_DATA_DIR;
  process.env.HEALR_DATA_DIR = dataDir;

  try {
    const audit = await import('../src/features/audit/index.js');

    const first = audit.append({
      decision: 'halt',
      apiId: 'audit-test',
      credential: 'must-not-be-stored',
      nested: { authorization: 'Bearer must-not-be-stored' },
    });
    audit.append({ decision: 'call', apiId: 'audit-test', tool: 'lookup' });

    assert.equal(first.credential, '[redacted]');
    assert.equal(first.nested.authorization, '[redacted]');
    assert.equal(audit.exportNdjson().includes('must-not-be-stored'), false);
    assert.equal(audit.verify().ok, true);

    assert.equal(audit.tamper(0, 'edit'), true);
    const verification = audit.verify();
    assert.equal(verification.ok, false);
    assert.equal(verification.brokenAt, 0);
    assert.equal(verification.reason, 'hash_mismatch');
  } finally {
    if (previousDataDir === undefined) delete process.env.HEALR_DATA_DIR;
    else process.env.HEALR_DATA_DIR = previousDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  }
});
