import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('restore rejects malformed or hash-invalid backups without changing current audit state', async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'healr-audit-backup-test-'));
  const previousDataDir = process.env.HEALR_DATA_DIR;
  process.env.HEALR_DATA_DIR = dataDir;

  try {
    const audit = await import('../src/features/audit/index.js');
    const seed = audit.append({ decision: 'current', apiId: 'audit-backup-test' });
    const auditPath = join(dataDir, 'audit.jsonl');
    const headPath = join(dataDir, 'audit.head.json');
    const backupPath = `${auditPath}.bak`;
    const beforeFile = readFileSync(auditPath, 'utf8');
    const beforeHead = readFileSync(headPath, 'utf8');

    await t.test('malformed JSONL backup is rejected and current files remain byte-identical', () => {
      writeFileSync(backupPath, '{"index":0,"decision":"truncated"\n');

      assert.equal(audit.restore(), false);
      assert.equal(readFileSync(auditPath, 'utf8'), beforeFile);
      assert.equal(readFileSync(headPath, 'utf8'), beforeHead);
      assert.equal(audit.verify().ok, true);
    });

    await t.test('parseable but hash-invalid backup is rejected without changing current files', () => {
      const invalidRecord = { ...seed, decision: 'tampered-without-rehash' };
      writeFileSync(backupPath, `${JSON.stringify(invalidRecord)}\n`);

      assert.equal(audit.restore(), false);
      assert.equal(readFileSync(auditPath, 'utf8'), beforeFile);
      assert.equal(readFileSync(headPath, 'utf8'), beforeHead);
      assert.equal(audit.verify().ok, true);
    });
  } finally {
    if (previousDataDir === undefined) delete process.env.HEALR_DATA_DIR;
    else process.env.HEALR_DATA_DIR = previousDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  }
});
