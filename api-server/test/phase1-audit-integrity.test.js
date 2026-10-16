import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('audit detects tail truncation against its anchor and restores the backed-up chain', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'healr-audit-integrity-test-'));
  const previousDataDir = process.env.HEALR_DATA_DIR;
  process.env.HEALR_DATA_DIR = dataDir;

  try {
    const audit = await import('../src/features/audit/index.js');
    audit.append({ decision: 'first', apiId: 'audit-integrity-test' });
    audit.append({ decision: 'second', apiId: 'audit-integrity-test' });
    audit.backup();

    const auditPath = join(dataDir, 'audit.jsonl');
    const fullChain = readFileSync(auditPath, 'utf8');
    const lines = fullChain.trimEnd().split('\n');
    assert.equal(lines.length, 2);
    writeFileSync(auditPath, `${lines[0]}\n`);

    const truncated = audit.verify();
    assert.equal(truncated.ok, false);
    assert.equal(truncated.reason, 'tail_truncated');
    assert.deepEqual(truncated.anchor, { index: 1, hash: JSON.parse(lines[1]).hash });

    assert.equal(audit.restore(), true);
    assert.equal(readFileSync(auditPath, 'utf8'), fullChain);
    assert.equal(audit.verify().ok, true);
    assert.equal(audit.verify().count, 2);
  } finally {
    if (previousDataDir === undefined) delete process.env.HEALR_DATA_DIR;
    else process.env.HEALR_DATA_DIR = previousDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  }
});
