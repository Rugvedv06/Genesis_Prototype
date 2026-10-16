import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('audit verification reports malformed JSONL as invalid instead of throwing', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'healr-audit-malformed-test-'));
  const previousDataDir = process.env.HEALR_DATA_DIR;
  process.env.HEALR_DATA_DIR = dataDir;

  try {
    const audit = await import('../src/features/audit/index.js');
    writeFileSync(join(dataDir, 'audit.jsonl'), '{"index":0,"decision":"partial"\n');

    let verification;
    assert.doesNotThrow(() => {
      verification = audit.verify();
    });
    assert.equal(verification.ok, false);
    assert.equal(verification.reason, 'malformed_json');
    assert.equal(verification.malformed, true);
  } finally {
    if (previousDataDir === undefined) delete process.env.HEALR_DATA_DIR;
    else process.env.HEALR_DATA_DIR = previousDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  }
});
